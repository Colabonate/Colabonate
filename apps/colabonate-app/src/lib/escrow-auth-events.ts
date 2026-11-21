/**
 * Escrow authorization events (FU-618, ADR-357 D3) — the one signing path for all
 * canister trade actions that need a party's authorization.
 *
 * Since FU-617 the ICP escrow canister verifies **signed Nostr events**, not raw
 * BIP-340 digests: NIP-07 extensions and NIP-46 bunkers can only sign events
 * (`signEvent`), so the old scheme was unsignable by two of the app's three
 * identity paths (GAP F-4). This module builds the event templates the canister's
 * `sig.rs` expects (kinds 30410/30411, domain separation via kind + tags, terms
 * message as content) and signs them through `signOrDelegate` (ADR-154 dispatch:
 * NIP-46 bunker → NIP-07 extension → burner) — one path for every signer type.
 *
 * The wire format (`EscrowAuthEventWire`) is what `POST /api/escrow-trades*`
 * expects: camelCase fields, `sig` as hex. The server relays verbatim; the
 * canister recomputes the NIP-01 event id and verifies the signature over it.
 */

import { finalizeEvent, getEventHash, getPublicKey, nip19, type EventTemplate, type VerifiedEvent } from 'nostr-tools'
import { signOrDelegate } from './nostr-identity'

/** Template without `created_at` — `signOrDelegate` stamps it at signing time (ADR-154). */
export type UnsignedEventTemplate = Omit<EventTemplate, 'created_at'>

/** Trade-terms binding events (`create_trade`, FU-254-J). Mirrors `sig::TERMS_EVENT_KIND`.
 * 30416 is registered for escrow terms in kind-mapping.ts + nostr-events.md — 30410/30411 were
 * already taken by Credential/Review (ADR-277 D0, dual-published to public relays), and a
 * colliding kind would let any credential/review signer surface mint canister-valid
 * authorizations (review finding 2026-09-02). */
export const ESCROW_TERMS_EVENT_KIND = 30_416

/** State-changing action events (`release_milestone`, `open_dispute`). Mirrors `sig::ACTION_EVENT_KIND` (see above). */
export const ESCROW_ACTION_EVENT_KIND = 30_417

/**
 * Canonical trade-terms message (FU-254-J) — byte-exact mirror of the canister's
 * `sig::trade_terms_message`: fixed field order, `:` separators, milestone bps in
 * Rust slice-Debug format (`[10000]`, `[2500, 5000, 2500]` — comma + single space).
 * This string is the `content` of both parties' terms events and the preimage of
 * `Trade.trade_terms_hash`.
 */
export function escrowTradeTermsMessage(args: {
  buyerPubkey: string
  sellerPubkey: string
  buyerRefundAddress: string
  sellerPayoutAddress: string
  expectedAmountSats: number | bigint
  milestoneBps: number[]
  /** Trade timeout in nanoseconds since epoch (nat64 on the canister). */
  timeoutAt: number | bigint
}): string {
  const bps = `[${args.milestoneBps.join(', ')}]`
  return [
    'colabonate-escrow-v1',
    'create_trade',
    args.buyerPubkey,
    args.sellerPubkey,
    args.buyerRefundAddress,
    args.sellerPayoutAddress,
    args.expectedAmountSats.toString(),
    bps,
    args.timeoutAt.toString(),
  ].join(':')
}

/** Terms event template for `create_trade` — content carries the canonical terms message. */
export function buildTermsEventTemplate(args: Parameters<typeof escrowTradeTermsMessage>[0]): UnsignedEventTemplate {
  return {
    kind: ESCROW_TERMS_EVENT_KIND,
    tags: [['action', 'create_trade']],
    content: escrowTradeTermsMessage(args),
  }
}

/** Action event template for `release_milestone` — milestone index bound via the `["i", n]` tag. */
export function buildReleaseMilestoneEventTemplate(tradeId: number | bigint, milestoneIndex: number): UnsignedEventTemplate {
  return {
    kind: ESCROW_ACTION_EVENT_KIND,
    tags: [
      ['trade', tradeId.toString()],
      ['action', 'release_milestone'],
      ['i', milestoneIndex.toString()],
    ],
    content: '',
  }
}

/** Action event template for `open_dispute`. */
export function buildOpenDisputeEventTemplate(tradeId: number | bigint): UnsignedEventTemplate {
  return {
    kind: ESCROW_ACTION_EVENT_KIND,
    tags: [
      ['trade', tradeId.toString()],
      ['action', 'open_dispute'],
    ],
    content: '',
  }
}

/**
 * Signs an escrow event template with the strongest available signer (NIP-46 →
 * NIP-07 → burner, ADR-154). `signOrDelegate` computes the NIP-01 event id from
 * the canonical serialization — the same digest the canister recomputes — and
 * signs BIP-340 over it, so whatever signer produced it, the canister accepts it.
 */
export async function signEscrowEvent(template: UnsignedEventTemplate): Promise<VerifiedEvent> {
  return signOrDelegate(template)
}

/** JSON wire shape for `POST /api/escrow-trades*` (camelCase, `sig` as hex). */
export interface EscrowAuthEventWire {
  id: string
  pubkey: string
  createdAt: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

export function toAuthEventWire(event: VerifiedEvent): EscrowAuthEventWire {
  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: event.sig,
  }
}

/** Convenience: build + sign + wire in one step (the P3/P4 call sites' shape). */
export async function signTermsEvent(args: Parameters<typeof escrowTradeTermsMessage>[0]): Promise<EscrowAuthEventWire> {
  return toAuthEventWire(await signEscrowEvent(buildTermsEventTemplate(args)))
}

export async function signReleaseMilestoneEvent(tradeId: number | bigint, milestoneIndex: number): Promise<EscrowAuthEventWire> {
  return toAuthEventWire(await signEscrowEvent(buildReleaseMilestoneEventTemplate(tradeId, milestoneIndex)))
}

export async function signOpenDisputeEvent(tradeId: number | bigint): Promise<EscrowAuthEventWire> {
  return toAuthEventWire(await signEscrowEvent(buildOpenDisputeEventTemplate(tradeId)))
}

/**
 * Local recomputation of the NIP-01 event id for the built templates — used by
 * tests to pin the canister contract (the canister verifies against this same
 * digest) and available for client-side sanity checks of signer responses.
 */
export function escrowEventId(template: UnsignedEventTemplate, pubkey: string, createdAt: number): string {
  return getEventHash({ pubkey, created_at: createdAt, kind: template.kind, tags: template.tags, content: template.content })
}

/**
 * Counterparty signing for the LOCAL test path only (FU-618 dev affordance).
 *
 * `create_trade` requires BOTH parties' terms events atomically. Production
 * collects the counterparty signature via the two-session share-link handshake
 * (P3 full); the minimal start-trade wizard instead lets a single local tester
 * paste the counterparty's nsec and finalize their event on this device.
 *
 * SAFETY: the nsec is used in-memory to finalize exactly one event and is never
 * logged, stored, or sent to the server — only the resulting signed event (a
 * publishable artifact) leaves this function.
 */
export function pubkeyFromNsec(nsec: string): string {
  const decoded = decodeNsec(nsec)
  return getPublicKey(decoded.data as Uint8Array)
}

export function finalizeEscrowEventWithNsec(nsec: string, template: UnsignedEventTemplate): VerifiedEvent {
  const decoded = decodeNsec(nsec)
  return finalizeEvent(
    { created_at: Math.floor(Date.now() / 1000), ...template } as EventTemplate,
    decoded.data as Uint8Array,
  )
}

function decodeNsec(nsec: string): ReturnType<typeof nip19.decode> {
  let decoded: ReturnType<typeof nip19.decode>
  try {
    decoded = nip19.decode(nsec.trim())
  } catch {
    throw new Error('Could not decode that key — check for typos.')
  }
  if (decoded.type !== 'nsec') throw new Error('That key is not a private key (nsec).')
  return decoded
}

/** Build + sign a terms event with a counterparty nsec (local test path). */
export function signTermsEventWithNsec(nsec: string, args: Parameters<typeof escrowTradeTermsMessage>[0]): EscrowAuthEventWire {
  return toAuthEventWire(finalizeEscrowEventWithNsec(nsec, buildTermsEventTemplate(args)))
}
