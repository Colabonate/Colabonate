import { z } from 'zod'
import { TICKET_STATUSES } from '@col/nostr-schema'

// ADR-139: enums dropped from Prisma schema, validated at app boundary instead.

export const OfferStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'CLOSED', 'ARCHIVED'])
export type OfferStatus = z.infer<typeof OfferStatusSchema>

// ADR-152: Trade visibility for Offers, Cooperations, Tickets.
// PUBLIC (default) is the standard mode; PRIVATE is opt-in for max privacy.
export const TradeVisibilitySchema = z.enum(['PUBLIC', 'PRIVATE'])
export type TradeVisibility = z.infer<typeof TradeVisibilitySchema>

// ADR-152: Dispute mode. PUBLIC = DAO-Council (L1+ required, default).
// PRIVATE = mutual arbiter via DM. NONE = no dispute protection.
export const DisputeModeSchema = z.enum(['PUBLIC', 'PRIVATE', 'NONE'])
export type DisputeMode = z.infer<typeof DisputeModeSchema>

export const TicketStatusSchema = z.enum([
  'PENDING', 'INTEREST_SENT', 'ACCEPTED', 'PAID', 'IN_PROGRESS',
  'COMPLETED', 'DISPUTED', 'ARBITRATION_LOST', 'ARBITRATION_WON', 'CANCELLED',
])
export type TicketStatus = z.infer<typeof TicketStatusSchema>

export const EscrowStatusSchema = z.enum([
  'NONE', 'INITIATED', 'PHASE_1_PENDING', 'RESERVED', 'PHASE_2_PENDING',
  'DELIVERY_STARTED', 'PHASE_3_PENDING', 'DELIVERY_CONFIRMED', 'RELEASED',
  'CANCELLED', 'DISPUTED', 'FUNDED', 'RELEASE_PHASE_1', 'RELEASE_PHASE_2',
  'RELEASE_PHASE_3', 'RELEASED_FULL', 'REFUNDED',
])
export type EscrowStatus = z.infer<typeof EscrowStatusSchema>

// ADR-253/FU-253-E: which escrow mechanism (if any) a ticket uses. Lets
// 'CUSTODIAL_LEGACY' (the kill-switched hold-invoice stack) and 'ICP' (the
// canister, ADR-254, not yet wired) coexist without both being inferred
// from the single escrowStatus vocabulary above.
export const EscrowProviderSchema = z.enum(['NONE', 'CUSTODIAL_LEGACY', 'ICP'])
export type EscrowProvider = z.infer<typeof EscrowProviderSchema>

// ADR-318 D5: buyer-self-reported classification for an AGENT_SETUP dispute.
// Informational only in V1 — the ADR's D1 (objective classification via
// Execution-Proof) is blocked on ADR-311/254 (no Workspace-Canister exists
// yet to produce a timeout/quality/proof signal), so this is a claim, not a
// verified fact, and does not by itself decide liability.
export const AgentDisputeTypeSchema = z.enum(['TIMEOUT', 'QUALITY', 'PROOF_MISSING', 'CONFIG_LEAK'])
export type AgentDisputeType = z.infer<typeof AgentDisputeTypeSchema>

// ADR-362 D2: ICP escrow canister TradeState — distinct from the custodial
// EscrowStatus vocabulary above (ADR-362 rejects reusing Ticket.escrowStatus:
// the two are unrelated state machines). Mirrors the canister's `TradeState`
// variant: PendingFunding, Funded, Released, Refunded, Disputed,
// DisputeSettled{buyer_bps, seller_bps}. The bps pair is stored separately as
// EscrowTrade.settledBuyerBps/settledSellerBps.
export const EscrowTradeStateSchema = z.enum([
  'PENDING_FUNDING', 'FUNDED', 'RELEASED', 'REFUNDED', 'DISPUTED', 'DISPUTE_SETTLED',
])
export type EscrowTradeState = z.infer<typeof EscrowTradeStateSchema>

export const EscrowNetworkSchema = z.enum(['ic', 'local'])
export type EscrowNetwork = z.infer<typeof EscrowNetworkSchema>

// ADR-362 D2: EscrowTradeEvent kinds — the append-only timeline/dossier backbone.
export const EscrowTradeEventKindSchema = z.enum([
  'STATE_TRANSITION', 'CANISTER_CALL', 'CHAIN_OBSERVATION', 'DRIFT_DETECTED',
])
export type EscrowTradeEventKind = z.infer<typeof EscrowTradeEventKindSchema>

// ADR-311 D2: workspace lifecycle state machine. PENDING_DEPLOY = ticket paid,
// canister deploy requested; RUNNING = agent live; SUSPENDED = cycle budget
// exhausted (resumable via reload); COMPLETED = buyer-confirmed, read-only
// until expiresAt; EXPIRED = TTL elapsed, outputs archived. Legal transitions
// are defined in apps/server/services/workspace-lifecycle.ts.
export const WorkspaceStatusSchema = z.enum(['PENDING_DEPLOY', 'RUNNING', 'SUSPENDED', 'COMPLETED', 'EXPIRED'])
export type WorkspaceStatus = z.infer<typeof WorkspaceStatusSchema>

// ── NIP-P (Phase 5): Private Commerce DM envelope schemas ────────────────────
// These validate the decrypted `content` of a NIP-59 gift-wrapped kind:14 DM
// per docs/nip-publications/NIP-P-private-commerce.md. They are the canonical
// shapes the client + server agree on; anything placed on a relay MUST first
// pass the matching schema here.

// 64-char lowercase hex pubkey.
const PubkeyHex = z.string().regex(/^[0-9a-f]{64}$/, 'expected 64-char hex pubkey')
// Positive-integer sat amount.
const Sats = z.number().int().positive()
// Unix-seconds timestamp.
const Timestamp = z.number().int().nonnegative()

/** Private service/product offer (mirror of NIP-A kind:30402 fields). */
export const PrivateOfferEnvelopeSchema = z.object({
  type: z.literal('offer'),
  offerId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  priceSats: Sats,
  categoryCode: z.string().optional(),
  images: z.array(z.string().url()).optional(),
  creatorPubkey: PubkeyHex,
  deliveryTimeDays: z.number().int().positive().optional(),
  deliveryCostSats: z.number().int().nonnegative().optional(),
  deliveryNotes: z.string().optional(),
  timestamp: Timestamp,
})
export type PrivateOfferEnvelope = z.infer<typeof PrivateOfferEnvelopeSchema>

/** Private cooperation proposal OR acceptance (carries the NIP-C tag set). */
export const PrivateCooperationEnvelopeSchema = z.object({
  type: z.literal('cooperation_proposal'),
  subType: z.enum(['proposal', 'acceptance']),
  cooperationId: z.string().min(1),
  title: z.string().min(1),
  budgetSats: Sats,
  initiatorPubkey: PubkeyHex,
  partnerPubkey: PubkeyHex,
  nip_c: z.object({
    kind: z.literal(30414),
    tags: z.array(z.array(z.string())),
    content: z.string(),
  }),
  timestamp: Timestamp,
})
export type PrivateCooperationEnvelope = z.infer<typeof PrivateCooperationEnvelopeSchema>

/** Private milestone completion/release (marker t=colabonate-milestone). */
export const PrivateMilestoneEnvelopeSchema = z.object({
  type: z.literal('milestone'),
  t: z.literal('colabonate-milestone'),
  cooperationId: z.string().min(1),
  milestoneId: z.string().min(1),
  milestoneIndex: z.number().int().nonnegative(),
  status: z.enum(['PROPOSED', 'ACCEPTED', 'COMPLETED', 'REJECTED']),
  amountSats: Sats,
  released: z.boolean().default(false),
  nip_c: z.object({
    kind: z.literal(30415),
    tags: z.array(z.array(z.string())),
    content: z.string(),
  }),
  timestamp: Timestamp,
})
export type PrivateMilestoneEnvelope = z.infer<typeof PrivateMilestoneEnvelopeSchema>

/** Mutual-arbiter dispute verdict (RELEASE | CANCEL | SPLIT). */
export const PrivateVerdictEnvelopeSchema = z.object({
  type: z.literal('verdict'),
  ticketId: z.string().min(1),
  outcome: z.enum(['RELEASE', 'CANCEL', 'SPLIT']),
  reasoning: z.string(),
  arbiterPubkey: PubkeyHex,
  verdictNostrEventId: z.string().min(1),
  timestamp: Timestamp,
})
export type PrivateVerdictEnvelope = z.infer<typeof PrivateVerdictEnvelopeSchema>

/** Counter-offer (DM-only; no public counterpart). */
export const PrivateCounterEnvelopeSchema = z.object({
  type: z.literal('counter'),
  offerId: z.string().min(1),
  counterPriceSats: Sats,
  counterNotes: z.string().optional(),
  timestamp: Timestamp.optional(),
})
export type PrivateCounterEnvelope = z.infer<typeof PrivateCounterEnvelopeSchema>

/** Free-text chat in a trade thread (DM-only). */
export const PrivateMessageEnvelopeSchema = z.object({
  type: z.literal('message'),
  offerId: z.string().optional(),
  cooperationId: z.string().optional(),
  message: z.string().min(1),
  timestamp: Timestamp.optional(),
})
export type PrivateMessageEnvelope = z.infer<typeof PrivateMessageEnvelopeSchema>

/** Discriminated union of all NIP-P envelopes. */
export const PrivateCommerceEnvelopeSchema = z.discriminatedUnion('type', [
  PrivateOfferEnvelopeSchema,
  PrivateCooperationEnvelopeSchema,
  PrivateMilestoneEnvelopeSchema,
  PrivateVerdictEnvelopeSchema,
  PrivateCounterEnvelopeSchema,
  PrivateMessageEnvelopeSchema,
])
export type PrivateCommerceEnvelope = z.infer<typeof PrivateCommerceEnvelopeSchema>

// Discriminator values the union actually recognises. An object whose `type`
// is not in this set is treated as free-text rather than a schema violation,
// so future NIP envelope types / third-party DMs cache as plain chat.
const KNOWN_COMMERCE_TYPES: Set<string> = new Set(
  PrivateCommerceEnvelopeSchema.options.map((s) => s.shape.type.value),
)

/**
 * ADR-161 / FU-08 — hard validation gate at the DM consume boundary.
 *
 * A decrypted DM `payload` may be either (a) a structured NIP-P commerce
 * envelope (JSON object with a recognised commerce `type`), or (b) legacy
 * free-text / plain chat (incl. unknown `type` strings). This helper
 * distinguishes them: commerce envelopes MUST pass
 * `PrivateCommerceEnvelopeSchema` (rejects malformed pubkeys, negative sats,
 * unknown verdict outcomes, etc.); anything without a recognised commerce
 * `type` is treated as free-text and returned as-is (null envelope).
 *
 * @throws {Error} when the payload has a recognised commerce `type` but fails
 *   schema validation.
 * @returns the parsed envelope, or `null` for non-commerce payloads.
 */
export function validateCommerceEnvelope(payloadJson: string): PrivateCommerceEnvelope | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(payloadJson)
  } catch {
    return null // free-text / non-JSON chat
  }
  if (typeof parsed !== 'object' || parsed === null || !('type' in parsed) || typeof (parsed as { type: unknown }).type !== 'string') {
    return null // structured but not a commerce envelope (e.g. legacy)
  }
  // Unknown type → free-text, not a schema violation.
  if (!KNOWN_COMMERCE_TYPES.has((parsed as { type: string }).type)) {
    return null
  }
  // Recognised commerce envelope — enforce the canonical schema.
  return PrivateCommerceEnvelopeSchema.parse(parsed)
}

// ADR-151: Allowed visibility tiers for product listings (0=public, 1=private-payload, 2=confidential).
export const AllowedVisibilitySchema = z.array(z.union([z.literal(0), z.literal(1), z.literal(2)])).optional()

// ADR-271: Bookable resources + time-based offers (NIP-52).
export const BookingModeSchema = z.enum(['DATE_RANGE', 'SESSION'])
export type BookingMode = z.infer<typeof BookingModeSchema>

export const BookingPriceUnitSchema = z.enum(['per_night', 'per_day', 'per_hour', 'per_seat', 'flat'])
export type BookingPriceUnit = z.infer<typeof BookingPriceUnitSchema>

export const BookingStatusSchema = z.enum(['REQUESTED', 'CONFIRMED', 'DECLINED', 'CANCELLED', 'LAPSED'])
export type BookingStatus = z.infer<typeof BookingStatusSchema>

// ADR-369: SESSION availability style. FIXED = fixed occurrences with seats
// (ADR-271, unchanged). OPEN = recurring windows the buyer books a start time
// + whole-hour duration inside (capacity 1 service time blocks).
export const BookingStyleSchema = z.enum(['FIXED', 'OPEN'])
export type BookingStyle = z.infer<typeof BookingStyleSchema>

// ADR-369: start-time grid step for OPEN resources. v1 exposes 60 only; 15/30
// are reserved for a later duration/pricing model (per-slot ≠ per-hour).
export const SlotMinutesSchema = z.union([z.literal(15), z.literal(30), z.literal(60)])
export type SlotMinutes = z.infer<typeof SlotMinutesSchema>

export const AvailabilityRuleKindSchema = z.enum(['WEEKLY_WINDOW', 'DATE_RANGE'])
export type AvailabilityRuleKind = z.infer<typeof AvailabilityRuleKindSchema>

// ADR-305/312: agent-setup billing model. Only ONE_TIME is functionally
// complete in V1 — see the AgentBillingModel Prisma enum comment.
export const AgentBillingModelSchema = z.enum(['ONE_TIME', 'PER_HOUR', 'PER_TOKEN', 'SUBSCRIPTION'])
export type AgentBillingModel = z.infer<typeof AgentBillingModelSchema>

// ADR-328 D1 / ADR-331 D1: coordination-layer supervision axis (orthogonal to
// per-agent AgentProfile.humanInLoop, ADR-308). Only meaningful when the
// Guide's executor axis is 'agent' — null otherwise. Server stores it as a
// nullable String column on Cooperation and parses client input through
// CoopAgentSupervisionSchema on POST.
export const CoopAgentSupervisionSchema = z.enum(['human', 'autonomous'])
export type CoopAgentSupervision = z.infer<typeof CoopAgentSupervisionSchema>
