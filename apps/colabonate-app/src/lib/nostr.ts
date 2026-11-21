/**
 * Nostr Client (ADR-153 — NIP-17 E2E + Gift Wrap + NIP-42 AUTH)
 *
 * Public API (unchanged from ADR-061 to keep TicketChat compatible):
 *   - signAndPublishEvent, signAndPublishWithNip07
 *   - publishTicketRequest, publishTicketUpdate
 *   - publishNostrProfile, publishIdentityCredential, publishReview, publishProximityProofMock
 *   - getMyPubkey
 *   - sendChatMessage, decryptChatMessage, subscribeToChatMessages, fetchChatMessages
 *   - subscribeToCallEvents, publishCallOffer, publishCallAnswer, publishIceCandidate, publishCallHangup
 *
 * Chat internals (Phase 0 of ADR-153):
 *   - sendChatMessage builds rumor (Kind 14) -> seal (Kind 13, NIP-44 ECDH) ->
 *     gift wrap (Kind 1059, NIP-59, signed with one-time key)
 *   - decryptChatMessage unwraps the gift wrap, verifies seal.pubkey == rumor.pubkey
 *     (NIP-17 anti-spoofing), decrypts the rumor content with NIP-44 v2
 *   - subscribeToChatMessages / fetchChatMessages query Kind 1059 with #p: [myLoginPubkey]
 *   - Legacy plaintext Kind-14 messages from ADR-061 are still readable
 *     (decryptChatMessage falls back when event.kind === 14)
 *
 * Requires a Burner-Pubkey-Handshake (lib/nostr-handshake.ts) for E2E between
 * two new peers. Without an existing handshake, the message still publishes,
 * but the recipient cannot decrypt it until they receive the handshake and
 * the sender re-sends (or a handshake-init is accepted at read time).
 */
import { finalizeEvent, getPublicKey, verifyEvent, type EventTemplate, type Filter, type UnsignedEvent } from 'nostr-tools'
import * as nip44 from 'nostr-tools/nip44'
import * as nip59 from 'nostr-tools/nip59'
import { getPool, getRelays } from './nostr-relay-config'
import { getPrivkeyBytes, getMyLoginPubkey, getMyPubkeySync, isValidHex64 } from './nostr-identity'
import { isNip46Active, nip46SignEvent } from './nostr-nip46'
import { ensureHandshake, getPeerChatPubkey, acceptHandshakeEvent, isHandshakeEvent } from './nostr-handshake'
import { ensureDmRelayList } from './nostr-dm-relays'
import { apiCall } from './api'
import { AGENT_REVIEW_ATTESTATION_KIND, buildAgentReviewAttestationTags } from '@col/nostr-schema'
import type { IdentityData } from '../types/identity'

// --- Backwards-compat re-exports for callers that import these directly ---
export { getMyPubkey, getPrivkeyHex, isValidHex64 } from './nostr-identity'
export { getRelays } from './nostr-relay-config'

export interface NostrProfileData {
  name: string
  picture: string
  about: string
  nip05: string
  lud16: string
}

export async function fetchNostrProfile(hexPubkey: string): Promise<NostrProfileData> {
  const res = await fetch(`/api/nostr/profile/${hexPubkey}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { message?: string }).message ?? `Failed to fetch profile (${res.status})`)
  }
  return res.json() as Promise<NostrProfileData>
}

/**
 * Server-side profile sync: asks the server to fetch the Kind 0 metadata for
 * `nostrPubkey` from relays and persist the display fields (picture, name,
 * about, banner, nip05 — fill-once, only fields that are still null). Returns
 * the updated identity payload, or null when nothing changed / the call failed.
 */
export async function syncNostrProfile(pubkey: string, nostrPubkey?: string): Promise<IdentityData | null> {
  try {
    const res = await fetch('/api/identity/sync-nostr-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pubkey, nostrPubkey }),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Generic event publishing
// ---------------------------------------------------------------------------

export async function signAndPublishEvent(template: Omit<EventTemplate, 'created_at'>) {
  // ADR-154: when a NIP-46 bunker is connected, sign with the user's REAL key
  // (reputation accrues to their real identity); otherwise keep the existing
  // burner-key behaviour exactly (no NIP-07 fallback — avoids changing the
  // pubkey of commerce events for extension users).
  const createdAt = Math.floor(Date.now() / 1000)
  const event = isNip46Active()
    ? await nip46SignEvent({ ...template, created_at: createdAt })
    : finalizeEvent({ ...template, created_at: createdAt }, getPrivkeyBytes())

  const pool = getPool()
  const pubs = pool.publish(getRelays(), event)
  const results = await Promise.allSettled(pubs)

  const succeeded = results.filter(r => r.status === 'fulfilled').length
  if (succeeded === 0) {
    throw new Error('Event was rejected by all relays. Make sure the server is running and try again.')
  }

  return event
}

/**
 * Signs an event with the NIP-07 browser extension (window.nostr) and publishes it.
 *
 * Unlike signAndPublishEvent, this does NOT fall back to the burner key: identity events
 * (Kind 0 profile, Kind 30021/30405 credential) MUST be signed by the same key the user
 * later proves ownership of via NIP-98 in the Level 1 upgrade. Using the burner key here
 * caused the L1 upgrade to always fail with NOSTR_KEY_MISMATCH (ADR-141 Issue 1).
 *
 * ADR-225 D1: an optional `secretKey` (from the browser-only keygen) signs the event
 * locally via `finalizeEvent` instead — the key never leaves the browser or reaches
 * the server, only the resulting signed event does.
 */
export async function signAndPublishWithNip07(template: Omit<EventTemplate, 'created_at'>, secretKey?: Uint8Array) {
  const createdAt = Math.floor(Date.now() / 1000)

  // ADR-154: a connected NIP-46 bunker holds the user's REAL identity key, so
  // identity events (Kind 0 profile, Kind 30021/30405 credential) should be
  // signed by it. Falls back to a NIP-07 extension, but NEVER the burner key.
  let event
  if (secretKey) {
    event = finalizeEvent({ ...template, created_at: createdAt }, secretKey)
  } else if (isNip46Active()) {
    event = await nip46SignEvent({ ...template, created_at: createdAt })
  } else if (typeof window !== 'undefined' && window.nostr) {
    event = await window.nostr.signEvent({ ...template, created_at: createdAt })
  } else {
    throw new Error('A Nostr signer (NIP-46 bunker or NIP-07 extension, e.g. Alby) is required to link your identity. Please connect one and try again.')
  }

  const pool = getPool()
  const pubs = pool.publish(getRelays(), event)
  const results = await Promise.allSettled(pubs)
  const succeeded = results.filter(r => r.status === 'fulfilled').length
  if (succeeded === 0) {
    throw new Error('Event was rejected by all relays. Make sure the server is running and try again.')
  }

  return event
}

// ---------------------------------------------------------------------------
// Ticket / offer publishing (NIP-B v2 + NIP-C)
// ---------------------------------------------------------------------------

export type TicketType = 'SMART_ORDER' | 'MILESTONE'

export async function publishTicketRequest(
  offerId: string,
  sellerPubkey: string,
  options?: { type?: TicketType; milestones?: Array<{ title: string; amountSats: number; dueDate?: string }> }
) {
  const isMilestone = options?.type === 'MILESTONE'
  const payload = isMilestone && options?.milestones
    ? JSON.stringify(options.milestones)
    : 'Ticket Request'

  const tags: string[][] = [
    ['d', offerId],
    ['p', sellerPubkey],
  ]

  if (options?.type) {
    tags.push(['type', options.type])
  }

  const template = {
    kind: 30407,
    tags,
    content: payload,
  }
  return signAndPublishEvent(template)
}

export async function publishTicketUpdate(refEventId: string, status: string, invoice?: string, preimage?: string) {
  const tags: string[][] = [
    ['e', refEventId],
    ['status', status],
  ]
  if (invoice) tags.push(['invoice', invoice])
  if (preimage) tags.push(['preimage', preimage])

  const template = {
    kind: 30408,
    tags,
    content: 'Ticket Status Update',
  }
  return signAndPublishEvent(template)
}

// ---------------------------------------------------------------------------
// Phase 3: Identity & Reputation (unchanged)
// ---------------------------------------------------------------------------

export interface NostrProfile {
  name: string
  /**
   * Lightning Address (lud16) is optional: a fresh Email/Nostr onboarding user
   * has no receiving address yet, and identity (L1) does not depend on one.
   * Only added to the kind:0 content when present (ADR-240 D0).
   */
  lud16?: string
  colabonatePubkey: string
  nip05?: string
  picture?: string
}

export async function publishNostrProfile(profile: NostrProfile, secretKey?: Uint8Array) {
  const content: Record<string, string> = {
    name: profile.name,
    colabonate_pubkey: profile.colabonatePubkey,
    colabonate_protocol_version: '1.0.0-draft',
  }
  if (profile.lud16) content.lud16 = profile.lud16
  if (profile.nip05) content.nip05 = profile.nip05
  if (profile.picture) content.picture = profile.picture

  const template = {
    kind: 0,
    tags: [],
    content: JSON.stringify(content),
  }
  return signAndPublishWithNip07(template, secretKey)
}

/**
 * ADR-240 addendum — set `lud16` on an existing Kind-0 content string while
 * preserving every other field (name, about, banner, colabonate_pubkey, …), so
 * republishing the profile never clobbers data the user set elsewhere. Pure and
 * sync so it is unit-testable; malformed/empty input degrades to `{ lud16 }`.
 */
export function mergeLud16IntoKind0Content(content: string | null | undefined, lud16: string): string {
  let parsed: unknown = null
  try {
    parsed = content ? JSON.parse(content) : null
  } catch {
    parsed = null
  }
  const base =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  return JSON.stringify({ ...base, lud16 })
}

/**
 * ADR-240 addendum — publish the self-serve `<handle>@<domain>` address as the
 * `lud16` on the user's existing Kind-0 profile, so Nostr clients can discover
 * and zap it. Reads the latest Kind-0 from the relays first and only replaces
 * `lud16`. Signed through `signAndPublishWithNip07` (NIP-46 bunker or NIP-07
 * extension — never the burner key), because the profile must stay under the
 * user's real identity key; callers must surface the no-signer error honestly.
 */
export async function publishLnAddressToProfile(lud16: string): Promise<{ pubkey: string; lud16: string }> {
  const hexPubkey = await getMyLoginPubkey()
  if (!isValidHex64(hexPubkey)) {
    throw new Error('Cannot determine your Nostr pubkey — connect a signer and try again.')
  }

  let currentContent: string | null = null
  try {
    const events = await getPool().querySync(getRelays(), { kinds: [0], authors: [hexPubkey], limit: 5 })
    // SECURITY (pentest G3, FU-720): never trust unverified relay content.
    const verified = events.filter(e => verifyEvent(e))
    if (verified.length > 0) {
      const latest = verified.reduce((a, b) => (b.created_at > a.created_at ? b : a), verified[0])
      currentContent = latest.content
    }
  } catch {
    // Relay read failed — publish `lud16` on a minimal profile rather than
    // blocking the user; the merge degrades to `{ lud16 }`.
  }

  const event = await signAndPublishWithNip07({
    kind: 0,
    tags: [],
    content: mergeLud16IntoKind0Content(currentContent, lud16),
  })
  return { pubkey: event.pubkey, lud16 }
}

export async function publishIdentityCredential(colabonatePubkey: string, secretKey?: Uint8Array) {
  const dTag = `identity-l1-${colabonatePubkey}`
  const tags: string[][] = [
    ['d', dTag],
    ['credential_type', 'identity_level_1'],
    ['hid_level', '1'],
    ['issued_by', colabonatePubkey],
  ]
  const content = JSON.stringify({
    credential_type: 'identity_level_1',
    subject: colabonatePubkey,
    issued_at: Math.floor(Date.now() / 1000),
    expires_at: null,
  })

  const templateLegacy = { kind: 30021, tags, content: String(content) }
  const templateNew = { kind: 30405, tags, content: String(content) }

  const eventLegacy = await signAndPublishWithNip07(templateLegacy, secretKey)
  const eventNew = await signAndPublishWithNip07(templateNew, secretKey)

  console.log('[NIP-15 CONFLICT] Credential dual-published:', { legacy: eventLegacy.id, new: eventNew.id })
  return eventNew
}

export interface UpgradeIdentityToL1Input {
  pubkey: string
  nostrPubkey: string
  nip05?: string
  picture?: string
  secretKey?: Uint8Array
}

/**
 * Signs a NIP-98 HTTP-auth event for `POST /api/identity/upgrade-l1` and calls it,
 * then fetches the resulting identity record. Shared by `NostrProfileForm` (NIP-07/
 * NIP-46 extension path) and the onboarding sovereign-keygen flow (ADR-225/240) so
 * the signing logic exists in exactly one place.
 */
export async function upgradeIdentityToL1({
  pubkey,
  nostrPubkey,
  nip05,
  picture,
  secretKey,
}: UpgradeIdentityToL1Input): Promise<import('../types/identity').IdentityData> {
  if (!secretKey && typeof window !== 'undefined' && !window.nostr && !isNip46Active()) {
    throw new Error('A Nostr signer (NIP-46 bunker or NIP-07 extension, e.g. Alby) is required for the Level 1 upgrade')
  }

  const absoluteUrl = new URL('/api/identity/upgrade-l1', window.location.href).toString()
  const eventTemplate = {
    kind: 22242,
    created_at: Math.floor(Date.now() / 1000),
    content: `colabonate-l1-upgrade:${pubkey}:${Date.now()}`,
    tags: [['u', absoluteUrl], ['method', 'POST']],
  }
  // Sign with the same signer that published the Kind-0 profile/credential —
  // the server requires the NIP-98 event's pubkey to equal `nostrPubkey`
  // (NOSTR_KEY_MISMATCH). Precedence matches signAndPublishWithNip07:
  // local key → NIP-46 bunker → NIP-07 extension.
  const event = secretKey
    ? finalizeEvent(eventTemplate, secretKey)
    : isNip46Active()
      ? await nip46SignEvent(eventTemplate)
      : await window.nostr!.signEvent(eventTemplate)

  const authHeader = `Nostr ${btoa(JSON.stringify(event))}`

  // FU-749: the upgrade needs BOTH the session (Authorization: Bearer — proves ownership of the
  // Colabonate account) and the NIP-98 event (X-Nostr-Auth — proves control of nostrPubkey).
  // The two cannot share the Authorization header (mutually exclusive schemes, see
  // apps/server/middleware/require-admin.ts), so the NIP-98 event goes in its own header.
  // apiCall() supplies the `Authorization: Bearer <session>` header.
  await apiCall('/api/identity/upgrade-l1', {
    method: 'POST',
    headers: { 'X-Nostr-Auth': authHeader },
    body: JSON.stringify({ pubkey, nostrPubkey, nip05: nip05 || undefined, picture: picture || undefined }),
  })

  const identRes = await apiCall(`/api/identity/${pubkey}`)
  return identRes.json()
}

export interface PublishReviewInput {
  ticketId: string
  revieweePubkey: string
  reviewerPubkey: string
  stars: number
  content: string
  colPoints?: number
}

export async function publishReview(review: PublishReviewInput) {
  const dTag = `review-${review.ticketId}-${review.reviewerPubkey.slice(0, 8)}`
  const tags: string[][] = [
    ['d', dTag],
    ['review_for', review.revieweePubkey],
    ['ticket', review.ticketId],
    ['stars', review.stars.toString()],
  ]
  if (review.colPoints !== undefined) {
    tags.push(['col_points', review.colPoints.toString()])
  }

  const templateLegacy = { kind: 30024, tags, content: review.content }
  const templateNew = { kind: 30406, tags, content: review.content }

  const eventLegacy = await signAndPublishEvent(templateLegacy)
  const eventNew = await signAndPublishEvent(templateNew)

  console.log('[NIP-15 CONFLICT] Review dual-published:', { legacy: eventLegacy.id, new: eventNew.id })
  return eventNew
}

export interface AgentReviewAttestationInput {
  ticketId: string
  reviewerPubkey: string
  revieweePubkey: string
  content: string
  accuracy?: number | null
  speed?: number | null
  reliability?: number | null
  quality?: number | null
  wouldReuse?: boolean | null
  amountSats?: number | null
}

// ADR-307 D4: portable multi-dimension review attestation (Kind 31419) for
// AGENT_SETUP tickets, published alongside the star review above.
export async function publishAgentReviewAttestation(input: AgentReviewAttestationInput) {
  const tags = buildAgentReviewAttestationTags(input)
  return signAndPublishEvent({ kind: AGENT_REVIEW_ATTESTATION_KIND, tags, content: input.content })
}

export async function publishProximityProofMock(subjectPubkey: string) {
  const template = {
    kind: 30026,
    tags: [
      ['d', `proximity-mock-${subjectPubkey.slice(0, 8)}-${Date.now()}`],
      ['p', subjectPubkey],
      ['location_hash', 'mock-location-hash-for-dev'],
    ],
    content: JSON.stringify({
      attestation_version: '1.0',
      subject_pubkey: subjectPubkey,
      encounter_type: 'mock',
      document_partial_match: true,
      joint_scan_validated: true,
      attested_at: Math.floor(Date.now() / 1000),
    }),
  }
  return signAndPublishEvent(template)
}

// ---------------------------------------------------------------------------
// NIP-17: Chat Service — Gift Wrap + NIP-44 E2E (ADR-153 Phase 0)
// ---------------------------------------------------------------------------

export interface ChatMessageEvent {
  id: string
  pubkey: string
  content: string
  created_at: number
  kind: number
  tags: string[][]
}

/**
 * Send a NIP-17 Gift-Wrapped chat message.
 *
 * Flow (NIP-59):
 *   1. Build a "rumor" (unsigned Kind 14) carrying the NIP-44-encrypted content
 *      and standard chat tags. rumor.pubkey = our login pubkey.
 *   2. Wrap rumor in a "seal" (Kind 13), encrypted to recipient's chat pubkey,
 *      signed by our login pubkey.
 *   3. Wrap seal in a "gift wrap" (Kind 1059) with a one-time random key,
 *      encrypted to recipient's chat pubkey, with randomized created_at.
 *
 * Returns the gift-wrap event id (the user-visible id on the relay).
 */
export async function sendChatMessage(
  recipientLoginPubkey: string,
  content: string,
  ticketId: string,
  loginPubkey?: string,
  scopeTag?: [string, string],
): Promise<{ id: string; createdAt: number; relayCount: number }> {
  if (!recipientLoginPubkey) {
    throw new Error('No recipient pubkey provided')
  }
  if (!isValidHex64(recipientLoginPubkey)) {
    console.warn(`[chat] Recipient pubkey is not a valid 64-char hex string: "${recipientLoginPubkey}". Message will be sent but relay delivery may be limited.`)
  }

  // Ensure the peer has our burner pubkey (best-effort, non-blocking)
  await ensureHandshake(recipientLoginPubkey)

  // Phase 0 onboarding (ADR-153 step 0.10): publish our DM relay list
  // idempotently on first chat use. Fire-and-forget; failures are non-fatal
  // because the chat message itself does not depend on it (we use our own
  // configured relays via getRelays()).
  ensureDmRelayList().catch((e) => {
    console.warn('[nostr] Failed to publish DM relay list:', e)
  })

  const senderChatPubkey = getMyPubkeySync()

  // We use the burner key as the "chat identity" in seal/rumor. This means
  // seal.pubkey === rumor.pubkey === burner pubkey, which is what the
  // NIP-17 anti-spoofing check requires. The login pubkey is recorded as
  // a `login_pubkey` tag for cross-referencing but is not the author of
  // the inner event (see ADR-153 — would require NIP-07 signEvent for the
  // seal which is a future enhancement for ADR-154 NIP-46 bunksign path).
  const senderSk = getPrivkeyBytes()

  // Resolve the peer's chat pubkey. If we don't have it yet (handshake not
  // completed), we cannot compute the conversation key and the message would
  // be un-decryptable on the other side. In that case we fall back to the
  // peer's login pubkey so a deterministic-but-weak shared secret still
  // exists. The handshake retry will resolve the asymmetry on the next send.
  const peerChatPubkey = getPeerChatPubkey(recipientLoginPubkey) ?? recipientLoginPubkey

  // 1) Encrypt the chat content with NIP-44 v2 ECDH (burner priv <-> peer chat pub)
  const conversationKey = nip44.getConversationKey(senderSk, peerChatPubkey)
  const encryptedContent = nip44.v2.encrypt(content, conversationKey)

  // 2) Build the rumor (Kind 14, unsigned, pubkey = burner pubkey so anti-spoofing passes).
  // Use Partial<UnsignedEvent> here because we need to set `pubkey`; nip59.createRumor
  // will overwrite it with getPublicKey(senderSk) which equals senderChatPubkey.
  const rumorTemplate: Partial<UnsignedEvent> = {
    kind: 14,
    pubkey: senderChatPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['p', recipientLoginPubkey],
      // ADR-358 D2: scope tag binds the message to a ticket (default) or an
      // escrow trade ('trade_id') so a dispute can attribute it to one trade.
      scopeTag ?? ['ticket_id', ticketId],
      ['sender_chat_pubkey', senderChatPubkey],
      ...(loginPubkey ? [['login_pubkey', loginPubkey] as string[]] : []),
    ],
    content: encryptedContent,
  }

  // 3) Seal (Kind 13): NIP-59 wrap of the rumor, encrypted to peer chat pub, signed by burner
  const seal = nip59.createSeal(
    nip59.createRumor(rumorTemplate, senderSk),
    senderSk,
    peerChatPubkey,
  )

  // 4) Gift Wrap (Kind 1059): nip59.createWrap handles key generation + random timestamp
  // automatically per NIP-59 metadata-hiding rules. No double-wrapping needed.
  const giftWrap = nip59.createWrap(seal, peerChatPubkey)

  const pool = getPool()
  const pubs = pool.publish(getRelays(), giftWrap)
  const results = await Promise.allSettled(pubs)
  const succeeded = results.filter(r => r.status === 'fulfilled').length
  if (succeeded === 0) {
    throw new Error('Could not publish message to any relay')
  }

  // Use the rumor's created_at as the user-visible timestamp; gift wrap's
  // created_at is randomized to obscure real send time. relayCount is the
  // number of relays that acknowledged the publish (ADR-358 D4 — honest
  // durability is only as strong as the acknowledgements actually observed).
  return { id: giftWrap.id, createdAt: rumorTemplate.created_at!, relayCount: succeeded }
}

/**
 * Decrypt a NIP-17 Gift-Wrapped chat event, with backwards-compat for
 * legacy plaintext Kind-14 events (ADR-061).
 *
 * For Kind 1059 (gift wrap):
 *   1. Unwrap to seal using nip59.unwrapEvent with our burner privkey
 *   2. Open the seal to reveal the rumor (Kind 14, encrypted content)
 *   3. Verify seal.pubkey === rumor.pubkey (NIP-17 anti-spoofing)
 *   4. Decrypt content with NIP-44 v2 using ECDH(our priv, rumor.pubkey)
 *
 * For Kind 14 (legacy plaintext): return content as-is.
 */
export async function decryptChatMessage(
  event: ChatMessageEvent,
  _myPrivkeyHex: string,
): Promise<{ content: string; createdAt: number; isGiftWrap: boolean; tradeId: string | null }> {
  // Legacy ADR-061 plaintext path
  if (event.kind === 14) {
    return {
      content: event.content,
      createdAt: event.created_at,
      isGiftWrap: false,
      tradeId: event.tags.find((t) => t[0] === 'trade_id')?.[1] ?? null,
    }
  }

  if (event.kind !== 1059) {
    throw new Error(`Unsupported event kind for chat: ${event.kind}`)
  }

  const mySk = getPrivkeyBytes()
  // nip59.unwrapEvent peels gift wrap -> seal -> rumor in one call, returning
  // the inner Kind 14 rumor. seal.pubkey === rumor.pubkey is enforced inside
  // nip59 (NIP-17 anti-spoofing) by virtue of the seal being signed with the
  // same key the rumor attributes authorship to.
  const giftWrapEvent = {
    id: event.id,
    kind: 1059,
    pubkey: event.pubkey,
    created_at: event.created_at,
    tags: event.tags,
    content: event.content,
    sig: (event as unknown as { sig: string }).sig ?? '',
  }
  const rumor = nip59.unwrapEvent(giftWrapEvent, mySk)

  // Decrypt content with NIP-44 v2
  const conversationKey = nip44.getConversationKey(mySk, rumor.pubkey)
  const content = nip44.v2.decrypt(rumor.content, conversationKey)

  // Scope tags (ticket_id / trade_id) live inside the rumor — the kind-1059
  // envelope only carries `p`/`nonce`, so callers scoping a thread MUST read
  // the trade id from here, never from the envelope's tags.
  return { content, createdAt: rumor.created_at, isGiftWrap: true, tradeId: rumor.tags.find((t) => t[0] === 'trade_id')?.[1] ?? null }
}

/**
 * Subscribe to NIP-17 Gift-Wrapped chat messages addressed to us.
 * Also picks up legacy Kind-14 messages (for migration) and handshake
 * events (so we can refresh the peer's chat pubkey automatically).
 */
export function subscribeToChatMessages(
  pubkey: string,
  onMessage: (event: ChatMessageEvent) => void,
  otherPubkey: string,
  _ticketId: string,
  options?: { since?: number; limit?: number },
  chatPubkey?: string,
): () => void {
  const since = options?.since ?? Math.floor(Date.now() / 1000) - 86400 * 7
  const limit = options?.limit ?? 50
  const myChatPubkey = chatPubkey ?? getMyPubkeySync()

  // NIP-17: gifts wraps addressed to us (p = our login pubkey) and to our burner (chat pubkey)
  const pTags = chatPubkey && chatPubkey !== pubkey ? [pubkey, chatPubkey] : [pubkey]

  const filters: Filter[] = [
    // Gift wraps addressed to us
    { kinds: [1059], '#p': pTags, since, limit } as Filter,
    // Legacy Kind-14 messages authored by the peer (legacy ADR-061 path)
    { kinds: [14], authors: [myChatPubkey], since, limit } as Filter,
    // Legacy Kind-14 messages addressed to us (fallback for messages from other peers)
    { kinds: [14], '#p': pTags, since, limit } as Filter,
  ]

  const pool = getPool()
  const subs = filters.map(f =>
    pool.subscribe(getRelays(), f, {
      onevent: (event: ChatMessageEvent) => {
        // Handshake pings are infrastructure, not chat content: cache the
        // peer's chat pubkey (skip our own echoed handshakes) and never
        // forward them to the UI.
        if (isHandshakeEvent(event)) {
          if (event.pubkey !== myChatPubkey) acceptHandshakeEvent(event, otherPubkey)
          return
        }
        onMessage(event)
      },
    })
  )

  return () => subs.forEach(s => s.close())
}

export async function fetchChatMessages(
  loginPubkey: string,
  otherPubkey: string | undefined,
  _ticketId: string,
  since?: number,
  chatPubkey?: string,
): Promise<ChatMessageEvent[]> {
  const sinceTs = since ?? Math.floor(Date.now() / 1000) - 86400 * 7
  const myChatPubkey = chatPubkey ?? getMyPubkeySync()

  const pTags = chatPubkey && chatPubkey !== loginPubkey ? [loginPubkey, chatPubkey] : [loginPubkey]

  // Announce our chat pubkey to the peer as soon as the conversation is
  // opened, not only when we send our first message — otherwise the peer's
  // very first outgoing message races our handshake and can never be
  // decrypted on our side. ensureHandshake() is a no-op once a handshake is
  // already cached, so this is safe to call on every load/poll.
  if (otherPubkey) {
    ensureHandshake(otherPubkey).catch(e => console.warn('[nostr] Failed to ensure handshake:', e))
  }

  const filters: Filter[] = [
    { kinds: [1059], '#p': pTags, since: sinceTs, limit: 100 } as unknown as Filter,
    { kinds: [14], authors: [myChatPubkey], since: sinceTs, limit: 100 } as unknown as Filter,
    { kinds: [14], '#p': pTags, since: sinceTs, limit: 100 } as unknown as Filter,
  ]

  const pool = getPool()
  return new Promise((resolve) => {
    const events: ChatMessageEvent[] = []
    const seen = new Set<string>()

    const addEvent = (event: ChatMessageEvent) => {
      // Handshake pings are infrastructure, not chat content: cache the
      // peer's chat pubkey (skip our own echoed handshakes) and never
      // surface them as messages.
      if (isHandshakeEvent(event)) {
        if (otherPubkey && event.pubkey !== myChatPubkey) acceptHandshakeEvent(event, otherPubkey)
        return
      }
      if (!seen.has(event.id)) {
        seen.add(event.id)
        events.push(event)
      }
    }

    let closedCount = 0
    const totalSubs = filters.length
    const onClose = () => {
      closedCount++
      if (closedCount >= totalSubs) resolve(events)
    }

    const subs = filters.map(f => pool.subscribe(getRelays(), f, { onevent: addEvent, onclose: onClose }))

    setTimeout(() => {
      subs.forEach(s => s.close())
      resolve(events)
    }, 5000)
  })
}

// ---------------------------------------------------------------------------
// NIP-10050: DM-Relay-Liste — see ./nostr-dm-relays.ts
// (Re-exported for backwards compat)
// ---------------------------------------------------------------------------
export { publishDmRelayList, ensureDmRelayList, getDmRelayList } from './nostr-dm-relays'

// ---------------------------------------------------------------------------
// WebRTC Call Signaling (unchanged from ADR-062)
// ---------------------------------------------------------------------------

export type CallType = 'audio' | 'video' | 'audiovideo'

export type HangupReason = 'busy' | 'rejected' | 'timeout' | 'ended' | 'normal' | undefined

export interface CallEvent {
  id: string
  pubkey: string
  created_at: number
  sessionId?: string
  peerPubkey?: string
  ticketId?: string
  kind: number
  tags: string[][]
  content: string
}

export function subscribeToCallEvents(
  myPubkey: string,
  onEvent: (event: CallEvent) => void
): () => void {
  const filter = {
    kinds: [30027, 30028, 30029, 30030],
    '#p': [myPubkey],
  }

  const sub = getPool().subscribe(getRelays(), filter, {
    onevent: (event: any) => {
      const callEvent: CallEvent = {
        id: event.id,
        pubkey: event.pubkey,
        created_at: event.created_at,
        kind: event.kind,
        tags: event.tags,
        content: event.content,
        sessionId: event.tags.find((t: string[]) => t[0] === 'd')?.[1],
        peerPubkey: event.tags.find((t: string[]) => t[0] === 'p')?.[1],
        ticketId: event.tags.find((t: string[]) => t[0] === 'ticket')?.[1],
      }
      onEvent(callEvent)
    },
  })

  return () => sub.close()
}

export async function publishCallOffer(
  sessionId: string,
  peerPubkey: string,
  ticketId: string,
  sdp: string,
  callType: CallType
): Promise<string> {
  const tags: string[][] = [
    ['d', sessionId],
    ['p', peerPubkey],
    ['ticket', ticketId],
    ['type', callType],
  ]
  const template = {
    kind: 30027,
    tags,
    content: sdp,
  }
  const event = await signAndPublishEvent(template)
  return event.id
}

export async function publishCallAnswer(
  sessionId: string,
  peerPubkey: string,
  ticketId: string,
  _extra: string,
  sdp: string
): Promise<string> {
  const tags: string[][] = [
    ['d', sessionId],
    ['p', peerPubkey],
    ['ticket', ticketId],
  ]
  const template = {
    kind: 30028,
    tags,
    content: sdp,
  }
  const event = await signAndPublishEvent(template)
  return event.id
}

export async function publishIceCandidate(
  sessionId: string,
  peerPubkey: string,
  ticketId: string,
  candidate: string,
  _mid: string
): Promise<string> {
  const tags: string[][] = [
    ['d', sessionId],
    ['p', peerPubkey],
    ['ticket', ticketId],
    ['candidate', candidate],
  ]
  const template = {
    kind: 30029,
    tags,
    content: '',
  }
  const event = await signAndPublishEvent(template)
  return event.id
}

export async function publishCallHangup(
  sessionId: string,
  peerPubkey: string,
  ticketId: string,
  reason?: HangupReason
): Promise<string> {
  const tags: string[][] = [
    ['d', sessionId],
    ['p', peerPubkey],
    ['ticket', ticketId],
  ]
  if (reason) tags.push(['reason', reason])
  const template = {
    kind: 30030,
    tags,
    content: '',
  }
  const event = await signAndPublishEvent(template)
  return event.id
}

// ---------------------------------------------------------------------------
// ADR-152 §A4 / Phase 2.8 — Mutual-Arbiter Private Verdict Signing
// ---------------------------------------------------------------------------

/**
 * Sign a private-arbiter verdict intent client-side.
 *
 * Returns a Kind 30022 Nostr event template with a valid Schnorr signature
 * (signed by the user's burner privkey via `finalizeEvent`). The signature
 * proves the caller controls the privkey for `arbiterPubkey`, which is the
 * trust anchor for the server's verdict-submission endpoint.
 *
 * The event is NOT published to any relay by this function — the verdict
 * stays private. The server only stores the verdict metadata and the
 * event id (for replay/audit purposes).
 *
 * Note: Kind 30022 is the same kind used by the public DAO-Council verdict
 * path. The `sub_type: 'private_arbiter_verdict'` tag distinguishes the
 * two flows server-side.
 *
 * @param arbiterPubkey  the 64-char hex pubkey that was nominated + accepted
 * @param ticketId       the ticket being arbitrated
 * @param outcome        'RELEASE' | 'CANCEL'
 * @param reasoning      optional free-text reasoning shown to buyer + seller
 * @returns              the finalized Nostr event (with .id, .sig, .pubkey)
 */
export async function signVerdictIntent(
  arbiterPubkey: string,
  ticketId: string,
  outcome: 'RELEASE' | 'CANCEL',
  reasoning?: string,
) {
  if (!/^[0-9a-fA-F]{64}$/.test(arbiterPubkey)) {
    throw new Error('arbiterPubkey must be a 64-char hex string')
  }
  if (!['RELEASE', 'CANCEL'].includes(outcome)) {
    throw new Error("outcome must be 'RELEASE' or 'CANCEL'")
  }

  // The signature must come from the privkey that controls `arbiterPubkey`.
  // In the typical flow, the user IS the arbiter (their burner privkey's
  // pubkey equals arbiterPubkey). The server verifies via verifyEvent.
  //
  // For NIP-07 setups where the user signs with a hardware-backed key, the
  // event is signed with `window.nostr.signEvent` instead of the burner
  // key. Phase 4+ will wire that path; for now we sign with the burner
  // key (which is the standard private-mode identity).
  const skBytes = getPrivkeyBytes()
  const derivedPubkey = getPublicKey(skBytes)
  if (derivedPubkey.toLowerCase() !== arbiterPubkey.toLowerCase()) {
    throw new Error(
      `Cannot sign verdict: burner pubkey (${derivedPubkey.slice(0, 8)}…) does not match ` +
        `arbiter pubkey (${arbiterPubkey.slice(0, 8)}…). ` +
        `This usually means the user is not logged in as the nominated arbiter.`,
    )
  }

  const verdictId = `verdict-${Date.now()}-${ticketId.slice(0, 8)}`
  const createdAt = Math.floor(Date.now() / 1000)

  const template: Omit<EventTemplate, 'created_at'> = {
    kind: 30022,
    tags: [
      ['d', verdictId],
      ['sub_type', 'private_arbiter_verdict'],
      ['ticket_id', ticketId],
      ['outcome', outcome],
      ['arbiter_pubkey', arbiterPubkey.toLowerCase()],
      ['visibility', 'PRIVATE'],
    ],
    content: JSON.stringify({
      type: 'private_arbiter_verdict',
      ticket_id: ticketId,
      arbiter_pubkey: arbiterPubkey.toLowerCase(),
      outcome,
      reasoning: reasoning ?? '',
      timestamp: createdAt,
    }),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const event = finalizeEvent({ ...template, created_at: createdAt } as any, skBytes)
  return event
}

