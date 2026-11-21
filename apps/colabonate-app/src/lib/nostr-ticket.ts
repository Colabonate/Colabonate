/**
 * NIP-B Client-Side Signing & Publishing
 *
 * Handles Kind 30407 (Ticket Created) and Kind 30408 (Ticket Status Update)
 * as defined in docs/plans/NIP-B-transaction-layer.md (ADR-107).
 *
 * Signing strategy (priority order):
 *   1. NIP-07 browser extension (window.nostr.signEvent) — real user key
 *   2. Burner key from localStorage['nostr_burner_key'] — persistent session key
 *
 * The server independently publishes both events with an ephemeral key as fallback (ADR-106).
 * Client-published events carry the user's real Nostr identity (or burner key), which is
 * preferred by NIP-B-aware clients over the server's ephemeral-key events.
 */

import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import type { EventTemplate, Event } from 'nostr-tools'
import { apiCall } from './api'
import { sendChatMessage } from './nostr'
import {
  buildTicketCreatedTags,
  buildTicketStatusTags,
  buildCooperationProposalTags,
  buildMilestoneTags,
} from '@col/nostr-schema'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Unsigned event template as returned by the server in ticket API responses. */
export interface NostrEventTemplate {
  kind: number
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
}

export type SigningMethod = 'nip07' | 'burner'

export interface SignResult {
  event: Event
  method: SigningMethod
}

// ---------------------------------------------------------------------------
// Relay configuration
// ---------------------------------------------------------------------------

function getRelayUrls(): string[] {
  const env = (import.meta as { env?: Record<string, string> }).env
  const fromEnv = env?.VITE_NOSTR_RELAY_URLS
  if (fromEnv) return fromEnv.split(',').map(u => u.trim())
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  return [`ws://${host}:4001`]
}

const pool = new SimplePool()

// ---------------------------------------------------------------------------
// Burner key helpers (persistent random key per browser session)
// ---------------------------------------------------------------------------

function getBurnerKey(): Uint8Array {
  let skHex = localStorage.getItem('nostr_burner_key')
  if (!skHex || skHex.length !== 64) {
    const sk = generateSecretKey()
    skHex = Array.from(sk).map(b => b.toString(16).padStart(2, '0')).join('')
    localStorage.setItem('nostr_burner_key', skHex)
  }
  return new Uint8Array(skHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)))
}

export function getBurnerPubkey(): string {
  return getPublicKey(getBurnerKey())
}

// ---------------------------------------------------------------------------
// NIP-07 detection
// ---------------------------------------------------------------------------

export function isNip07Available(): boolean {
  return typeof window !== 'undefined' && typeof (window as Window & { nostr?: unknown }).nostr !== 'undefined'
}

// ---------------------------------------------------------------------------
// Core: sign an event template with NIP-07 or burner key
// ---------------------------------------------------------------------------

/**
 * Signs an event template using NIP-07 if available, falls back to burner key.
 *
 * Note: The `pubkey` field in the template represents the authorised party
 * (buyer for 30407, buyer/seller for 30408). NIP-07 ignores this field and
 * replaces it with the extension key. The `buyer`/`seller` tags remain
 * authoritative for identifying transaction parties regardless of who signs.
 */
export async function signEventNip07OrBurner(template: NostrEventTemplate): Promise<SignResult> {
  // Strip pubkey — NIP-07 adds its own; finalizeEvent derives it from the secret key
  const { pubkey: _pubkey, ...eventBody } = template

  if (isNip07Available()) {
    try {
      const nostr = (window as Window & {
        nostr: {
          signEvent(event: object): Promise<{ id: string; pubkey: string; sig: string; kind: number; created_at: number; tags: string[][]; content: string }>
        }
      }).nostr

      const signed = await nostr.signEvent(eventBody)
      return { event: signed as Event, method: 'nip07' }
    } catch (err) {
      // NIP-07 signing was rejected or extension unavailable — fall through to burner
      console.warn('[nostr-ticket] NIP-07 signing failed, falling back to burner key:', err)
    }
  }

  // Burner key fallback
  const sk = getBurnerKey()
  const event = finalizeEvent(eventBody as EventTemplate, sk)
  return { event, method: 'burner' }
}

// ---------------------------------------------------------------------------
// Relay publishing
// ---------------------------------------------------------------------------

/**
 * Publishes a signed event directly to the configured Nostr relays.
 * Fire-and-forget: resolves true if at least one relay accepted the event.
 */
export async function publishToRelays(event: Event): Promise<boolean> {
  const relays = getRelayUrls()
  try {
    const pubs = pool.publish(relays, event)
    const results = await Promise.allSettled(pubs)
    const succeeded = results.filter(r => r.status === 'fulfilled').length
    return succeeded > 0
  } catch (err) {
    console.error('[nostr-ticket] Relay publish failed:', err)
    return false
  }
}

/**
 * Server-assisted relay publishing: POSTs a signed event to the server,
 * which forwards it to its relay pool. Used as a redundancy layer when
 * direct client-to-relay publishing fails or is unavailable.
 */
export async function publishSignedEventToServer(event: Event): Promise<boolean> {
  try {
    const res = await apiCall('/api/nostr/relay-signed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event }),
    })
    return res.ok
  } catch (err) {
    console.error('[nostr-ticket] Server relay publish failed:', err)
    return false
  }
}

// ---------------------------------------------------------------------------
// High-level: sign + publish (direct relay first, server fallback)
// ---------------------------------------------------------------------------

async function signAndPublish(template: NostrEventTemplate): Promise<SignResult & { relayReached: boolean }> {
  const signResult = await signEventNip07OrBurner(template)

  // 1. Publish directly to relay
  const relayReached = await publishToRelays(signResult.event)

  // 2. Send to server for redundant relay publishing (non-blocking)
  publishSignedEventToServer(signResult.event).catch(() => {
    // Server relay publish is best-effort
  })

  console.log(
    `[nostr-ticket] Kind ${template.kind} published via ${signResult.method}`,
    `relay=${relayReached}`,
    `event=${signResult.event.id}`,
  )

  return { ...signResult, relayReached }
}

// ---------------------------------------------------------------------------
// NIP-B: Kind 30407 — Ticket Created
// ---------------------------------------------------------------------------

export interface TicketCreatedParams {
  ticketId: string
  offerId: string
  buyerPubkey: string
  sellerPubkey: string
  status: string
  offerType?: string
  ticketType?: string
  content?: string
  visibility?: 0 | 1 | 2
  payloadCommitment?: string
}

/**
 * Builds and publishes a Kind 30407 (Ticket Created) event.
 * Called by the buyer after successful ticket creation via POST /api/tickets.
 *
 * If the server returned a nostrEventTemplate in the API response, prefer that
 * (use signAndPublishFromTemplate) — it has the exact same tags as the server event.
 * This function is the fallback for constructing the event locally.
 */
export async function signAndPublishTicketCreated(params: TicketCreatedParams): Promise<SignResult | null> {
  try {
    // ADR-150: tags built from the shared @col/nostr-schema builder (same source as the server).
    const tags = buildTicketCreatedTags({
      id: params.ticketId,
      offerId: params.offerId,
      buyerPubkey: params.buyerPubkey,
      sellerPubkey: params.sellerPubkey,
      status: params.status,
      offerType: params.offerType,
      ticketType: params.ticketType,
      visibility: params.visibility,
      payloadCommitment: params.payloadCommitment,
    })

    const template: NostrEventTemplate = {
      kind: 30407,
      pubkey: params.buyerPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: params.content ?? '',
    }

    return await signAndPublish(template)
  } catch (err) {
    console.error('[nostr-ticket] Failed to publish Kind 30407:', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// NIP-B: Kind 30408 — Ticket Status Update
// ---------------------------------------------------------------------------

export interface TicketStatusParams {
  ticketId: string
  status: string
  buyerPubkey: string
  sellerPubkey: string
  signerPubkey: string
  offerId?: string
  offerType?: string
  invoice?: string
  paymentHash?: string
  preimage?: string
  content?: string
  visibility?: 0 | 1 | 2
}

/**
 * Builds and publishes a Kind 30408 (Ticket Status Update) event.
 * Called after PATCH /api/tickets/:id.
 */
export async function signAndPublishTicketStatus(params: TicketStatusParams): Promise<SignResult | null> {
  try {
    // ADR-150: tags built from the shared @col/nostr-schema builder. This also aligns the
    // client fallback's `payment` tag to the server's NIP-115 form (ADR-149): the client
    // previously emitted the older 4-element ['payment','lightning',invoice,preimage] tuple
    // here, which had drifted from the server's ['payment','lightning',preimage,...] form.
    const tags = buildTicketStatusTags({
      id: params.ticketId,
      status: params.status,
      buyerPubkey: params.buyerPubkey,
      sellerPubkey: params.sellerPubkey,
      offerId: params.offerId,
      offerType: params.offerType,
      invoice: params.invoice,
      paymentHash: params.paymentHash,
      preimage: params.preimage,
      visibility: params.visibility,
    })

    const template: NostrEventTemplate = {
      kind: 30408,
      pubkey: params.signerPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: params.content ?? '',
    }

    return await signAndPublish(template)
  } catch (err) {
    console.error('[nostr-ticket] Failed to publish Kind 30408:', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// NIP-C: Kind 30414 — Cooperation Proposal
// ---------------------------------------------------------------------------

export interface CooperationProposalParams {
  cooperationId: string
  type: 'proposal' | 'acceptance'
  initiatorPubkey: string
  partnerPubkey: string
  title: string
  budgetSats: number
  timeline?: string
  status: string
  cooperationType?: string
  skills?: string[]
  content?: string
}


export async function signAndPublishCooperationProposal(
  params: CooperationProposalParams
): Promise<SignResult | null> {
  try {
    const template: NostrEventTemplate = {
      kind: 30414,
      pubkey: params.type === 'proposal' ? params.initiatorPubkey : params.partnerPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: buildCooperationProposalTags(params),
      content: params.content ?? '',
    }

    return await signAndPublish(template)
  } catch (err) {
    console.error('[nostr-ticket] Failed to publish Kind 30414:', err)
    return null
  }
}

/**
 * Phase 3.2 — PRIVATE cooperation proposal/acceptance.
 *
 * Replicates the NIP-C dual-signature pattern as a NIP-17 gift-wrapped DM
 * (Kind 14) instead of a public addressable Kind 30414 event. The DM carries
 * the identical NIP-C tag set inside an encrypted JSON payload so the
 * counterparty can reconstruct the agreement — no logic duplication, the tag
 * set comes from the shared `buildCooperationProposalTags` helper.
 *
 * Recipient = the counterparty: for a `proposal` that's the partner, for an
 * `acceptance` that's the initiator (mirrors the public `p`-tag direction).
 */
export async function sendPrivateCooperationProposal(
  params: CooperationProposalParams
): Promise<{ id: string; createdAt: number } | null> {
  try {
    const tags = buildCooperationProposalTags(params)
    const recipient = params.type === 'proposal' ? params.partnerPubkey : params.initiatorPubkey
    const sender = params.type === 'proposal' ? params.initiatorPubkey : params.partnerPubkey
    const payload = JSON.stringify({
      type: 'cooperation_proposal',
      subType: params.type,
      cooperationId: params.cooperationId,
      title: params.title,
      budgetSats: params.budgetSats,
      initiatorPubkey: params.initiatorPubkey,
      partnerPubkey: params.partnerPubkey,
      nip_c: { kind: 30414, tags, content: params.content ?? '' },
      timestamp: Math.floor(Date.now() / 1000),
    })
    return await sendChatMessage(recipient, payload, params.cooperationId, sender)
  } catch (err) {
    console.error('[nostr-ticket] Failed to send PRIVATE cooperation proposal DM:', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// NIP-C: Kind 30415 — Milestone Event
// ---------------------------------------------------------------------------

export interface MilestoneEventParams {
  cooperationId: string
  milestoneId: string
  milestoneIndex: number
  initiatorPubkey: string
  partnerPubkey: string
  signerPubkey: string
  title: string
  status: string
  amountSats: number
  evidence?: string
  released?: boolean
  content?: string
}


export async function signAndPublishMilestone(
  params: MilestoneEventParams
): Promise<SignResult | null> {
  try {
    const template: NostrEventTemplate = {
      kind: 30415,
      pubkey: params.signerPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: buildMilestoneTags(params),
      content: params.content ?? '',
    }

    return await signAndPublish(template)
  } catch (err) {
    console.error('[nostr-ticket] Failed to publish Kind 30415:', err)
    return null
  }
}

/**
 * Phase 3.3 — PRIVATE milestone event (completion / release) via NIP-17 DM.
 *
 * Replicates the public Kind-30415 milestone event as a gift-wrapped Kind-14
 * DM. The encrypted payload carries a `t=colabonate-milestone` marker plus the
 * identical NIP-C tag set (shared `buildMilestoneTags` helper). Recipient is
 * the counterparty: a partner's COMPLETED event goes to the initiator; the
 * initiator's ACCEPTED/release event goes to the partner.
 */
export async function sendPrivateMilestone(
  params: MilestoneEventParams
): Promise<{ id: string; createdAt: number } | null> {
  try {
    const tags = buildMilestoneTags(params)
    // `p`-tag direction = recipient (COMPLETED → initiator, else → partner)
    const recipient = params.status === 'COMPLETED' ? params.initiatorPubkey : params.partnerPubkey
    const payload = JSON.stringify({
      type: 'milestone',
      t: 'colabonate-milestone',
      cooperationId: params.cooperationId,
      milestoneId: params.milestoneId,
      milestoneIndex: params.milestoneIndex,
      status: params.status,
      amountSats: params.amountSats,
      released: params.released ?? false,
      nip_c: { kind: 30415, tags, content: params.content ?? '' },
      timestamp: Math.floor(Date.now() / 1000),
    })
    return await sendChatMessage(recipient, payload, params.cooperationId, params.signerPubkey)
  } catch (err) {
    console.error('[nostr-ticket] Failed to send PRIVATE milestone DM:', err)
    return null
  }
}

/**
 * Phase 3.2 — route a server-returned Kind-30414 cooperation proposal/acceptance
 * template either to the public relay (PUBLIC) or to a NIP-17 gift-wrapped DM
 * (PRIVATE), reconstructing the private params from the template's NIP-C tags.
 */
export async function deliverCooperationTemplate(
  template: NostrEventTemplate,
  visibility: 'PUBLIC' | 'PRIVATE' | undefined,
): Promise<void> {
  if (visibility !== 'PRIVATE') {
    await signAndPublishFromTemplate(template).catch(() => {})
    return
  }
  const tag = (name: string) => template.tags.find(t => t[0] === name)?.[1]
  const cooperationId = tag('cooperation')
  const initiatorPubkey = tag('initiator')
  const partnerPubkey = tag('partner')
  if (!cooperationId || !initiatorPubkey || !partnerPubkey) {
    console.warn('[nostr-ticket] PRIVATE cooperation template missing tags — skipping DM')
    return
  }
  await sendPrivateCooperationProposal({
    cooperationId,
    type: (tag('type') as 'proposal' | 'acceptance') ?? 'acceptance',
    initiatorPubkey,
    partnerPubkey,
    title: tag('title') ?? '',
    budgetSats: parseInt(tag('budget') ?? '0', 10),
    timeline: tag('timeline') || undefined,
    status: tag('status') ?? 'OPEN',
    cooperationType: tag('cooperation_type') || undefined,
    content: template.content || undefined,
  })
}

/**
 * Phase 3.3 — route a server-returned Kind-30415 milestone template either to
 * the public relay (PUBLIC cooperations) or to a NIP-17 gift-wrapped DM
 * (PRIVATE cooperations). The private params are reconstructed from the
 * template's NIP-C tags so call sites stay minimal.
 */
export async function deliverMilestoneTemplate(
  template: NostrEventTemplate,
  visibility: 'PUBLIC' | 'PRIVATE' | undefined,
): Promise<void> {
  if (visibility !== 'PRIVATE') {
    await signAndPublishFromTemplate(template).catch(() => {})
    return
  }
  const tag = (name: string) => template.tags.find(t => t[0] === name)?.[1]
  const cooperationId = tag('cooperation')
  const milestoneId = tag('milestone')
  const initiatorPubkey = tag('initiator')
  const partnerPubkey = tag('partner')
  if (!cooperationId || !milestoneId || !initiatorPubkey || !partnerPubkey) {
    console.warn('[nostr-ticket] PRIVATE milestone template missing tags — skipping DM')
    return
  }
  await sendPrivateMilestone({
    cooperationId,
    milestoneId,
    milestoneIndex: parseInt(tag('milestone_index') ?? '0', 10),
    initiatorPubkey,
    partnerPubkey,
    signerPubkey: template.pubkey,
    title: tag('title') ?? '',
    status: tag('status') ?? '',
    amountSats: parseInt(tag('amount') ?? '0', 10),
    evidence: tag('evidence') || undefined,
    content: template.content || undefined,
  })
}

// ---------------------------------------------------------------------------
// Server-template path: sign a template that was returned by the server API
// ---------------------------------------------------------------------------

/**
 * Signs and publishes a nostrEventTemplate returned directly from a ticket API response.
 * This guarantees tag consistency between the server's ephemeral-key event and the
 * client's NIP-07-signed event.
 */
export async function signAndPublishFromTemplate(template: NostrEventTemplate): Promise<(SignResult & { relayReached: boolean }) | null> {
  try {
    return await signAndPublish(template)
  } catch (err) {
    console.error('[nostr-ticket] Failed to publish from server template:', err)
    return null
  }
}
