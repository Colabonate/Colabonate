// Ticket event tag builders — single source of truth for Kind 30407/30408 tags (ADR-150).
//
// Used by both the server-side ephemeral publish path (publishTicketCreated /
// publishTicketStatus, ADR-106) and the client-signed template path (nostrEventTemplate
// returned by the ticket routes, ADR-107). Sharing the builder guarantees the two events
// carry identical tags. market-spec vocabulary tags (a/item/order/payment) per ADR-142/143;
// NIP-115 payment-agnostic `payment` tag + public `escrow_status` projection per ADR-149.

import { toEscrowState } from '../status.js'
import { parseVisibilityTier } from '../visibility.js'
import type { VisibilityTier } from '../visibility.js'

export interface TicketCreatedTagInput {
  id: string
  // ADR-204: either offerId OR cooperationId must be set (xor).
  // Accept null (from Prisma) and undefined (from caller); builder treats both as absent.
  offerId?: string | null
  cooperationId?: string | null
  buyerPubkey: string
  sellerPubkey: string
  status: string
  offerType?: string
  ticketType?: string
  visibility?: VisibilityTier
  payloadCommitment?: string
}

export function buildTicketCreatedTags(t: TicketCreatedTagInput): string[][] {
  // ADR-204: xor — cooperation tickets have no offerId; offer tickets have no cooperationId.
  const tags: string[][] = [
    ['d', t.id],
    ['ticket', t.id],
    ['buyer', t.buyerPubkey],
    ['seller', t.sellerPubkey],
    ['p', t.sellerPubkey],  // NIP-01 contact tag; seller receives event via #p relay filter
    ['status', t.status],
    ['order', t.id],
  ]
  // ADR-204: emit the appropriate entity ref based on ticket kind.
  if (t.cooperationId) {
    tags.push(['cooperation', t.cooperationId])
    // NIP-C addressable ref for cooperation tickets.
    tags.push(['a', `30414:${t.sellerPubkey}:${t.cooperationId}`])
    tags.push(['item', `30414:${t.sellerPubkey}:${t.cooperationId}`, '1'])
  } else if (t.offerId) {
    tags.push(['offer', t.offerId])
    // market-spec vocabulary (ADR-142/143): NIP-01 addressable ref + market-spec `item`/`order`.
    tags.push(['a', `30402:${t.sellerPubkey}:${t.offerId}`])
    tags.push(['item', `30402:${t.sellerPubkey}:${t.offerId}`, '1'])
  }
  if (t.offerType) tags.push(['offer_type', t.offerType.toLowerCase()])
  if (t.ticketType) tags.push(['ticket_type', t.ticketType.toLowerCase()])

  // Tiered visibility (ADR-151): visibility tag on every ticket; payload_commitment
  // anchors the (possibly encrypted) commercial payload to the skeleton.
  const tier = parseVisibilityTier(t.visibility)
  tags.push(['visibility', String(tier)])
  if (t.payloadCommitment) tags.push(['payload_commitment', t.payloadCommitment])

  return tags
}

export interface TicketStatusTagInput {
  id: string
  status: string
  buyerPubkey: string
  sellerPubkey: string
  // ADR-204: xor — cooperation tickets have no offerId; offer tickets have no cooperationId.
  // Accept null (from Prisma) and undefined (from caller); builder treats both as absent.
  offerId?: string | null
  cooperationId?: string | null
  offerType?: string
  invoice?: string
  paymentHash?: string
  preimage?: string
  paymentType?: string
  amountSats?: number
  escrowStatus?: string
  visibility?: VisibilityTier
  // ADR-184: escrow-phase payment proofs
  escrowPhase1Preimage?: string | null
  escrowPhase2Preimage?: string | null
  escrowPhase3Preimage?: string | null
  escrowPhase1Amount?: number
  escrowPhase2Amount?: number
  escrowPhase3Amount?: number
}

export function buildTicketStatusTags(t: TicketStatusTagInput): string[][] {
  // Server publishes with an ephemeral key, so both parties are listed under #p
  // (seller actions notify the buyer; buyer actions notify the seller).
  const tags: string[][] = [
    ['d', t.id],
    ['ticket', t.id],
    ['status', t.status],
    ['buyer', t.buyerPubkey],
    ['seller', t.sellerPubkey],
    ['p', t.buyerPubkey],
    ['p', t.sellerPubkey],
    // market-spec `order` coordinate (ADR-143, additive). `a`/`item` added below when offerId is known.
    ['order', t.id],
  ]
  // ADR-204: emit the appropriate entity ref based on ticket kind.
  // offerId is optional on 30408; emit the listing ref only when it is available.
  if (t.cooperationId) {
    tags.push(['cooperation', t.cooperationId])
    tags.push(['a', `30414:${t.sellerPubkey}:${t.cooperationId}`])
    tags.push(['item', `30414:${t.sellerPubkey}:${t.cooperationId}`, '1'])
  } else if (t.offerId) {
    tags.push(['a', `30402:${t.sellerPubkey}:${t.offerId}`])
    tags.push(['item', `30402:${t.sellerPubkey}:${t.offerId}`, '1'])
  }
  if (t.offerType) tags.push(['offer_type', t.offerType.toLowerCase()])
  if (t.invoice) tags.push(['invoice', t.invoice])
  if (t.paymentHash) tags.push(['payment_hash', t.paymentHash])
  if (t.preimage) tags.push(['preimage', t.preimage])
  // NIP-115 payment-agnostic proof tag: ["payment", "<type>", "<proof>", "<amount>", "<unit>"].
  // `type` determines how `proof` is read (lightning → preimage, cashu → token, onchain → txid),
  // so a new mechanism is a new `type` value, not a schema change. Emitted only when actual
  // payment proof exists (preimage for lightning); the legacy invoice/preimage/payment_hash tags
  // above are kept during the dual-publish window (ADR-133).
  if (t.preimage) {
    const paymentTag = ['payment', t.paymentType ?? 'lightning', t.preimage]
    if (t.amountSats != null) paymentTag.push(String(t.amountSats), 'sat')
    tags.push(paymentTag)
  }
  // ADR-184: emit one payment tag per escrow phase that has been paid (preimage known).
  const escrowPhasePayments: Array<{ preimage?: string | null; amount?: number }> = [
    { preimage: t.escrowPhase1Preimage, amount: t.escrowPhase1Amount },
    { preimage: t.escrowPhase2Preimage, amount: t.escrowPhase2Amount },
    { preimage: t.escrowPhase3Preimage, amount: t.escrowPhase3Amount },
  ]
  for (const phase of escrowPhasePayments) {
    if (!phase.preimage) continue
    const paymentTag = ['payment', t.paymentType ?? 'lightning', phase.preimage]
    if (phase.amount != null) paymentTag.push(String(phase.amount), 'sat')
    tags.push(paymentTag)
  }
  // Public 4-state escrow projection (NIP-115): expose the funds lifecycle on-graph so any
  // client/arbitrator can read it without Colabonate's internal phase machine (ADR-142/143).
  const escrowState = toEscrowState(t.escrowStatus)
  if (escrowState) tags.push(['escrow_status', escrowState])

  // Tiered visibility (ADR-151): mirror the ticket's visibility on status events
  // so any observer can determine the payload's accessibility without fetching the
  // original 30407.
  if (t.visibility != null) tags.push(['visibility', String(parseVisibilityTier(t.visibility))])

  return tags
}
