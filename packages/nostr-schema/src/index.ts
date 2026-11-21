// @col/nostr-schema — single source of truth for Colabonate Nostr event tag
// vocabulary, builders, schemas, and validators (ADR-150).

// Status vocabulary + escrow projection
export { TICKET_STATUSES, toEscrowState } from './status.js'
export type { TicketStatus, EscrowState } from './status.js'

// Status vocabulary bridge — UPPERCASE ↔ market-spec lowercase (ADR-153)
export { toMarketSpecStatus, fromMarketSpecStatus } from './status-bridge.js'
export type { MarketSpecStatus } from './status-bridge.js'

// Tiered transaction visibility (ADR-151)
export {
  VISIBILITY_TIERS, VISIBILITY_LABELS, DEFAULT_VISIBILITY,
  isValidVisibilityTier, parseVisibilityTier, isTierAllowed,
} from './visibility.js'
export type { VisibilityTier } from './visibility.js'

// Tag helpers
export { findTag, hasRequiredTags } from './helpers.js'
export type { NostrTag } from './helpers.js'

// Tag builders (single source of truth, used by server publish path + client signer)
export { buildTicketCreatedTags, buildTicketStatusTags } from './builders/ticket.js'
export type { TicketCreatedTagInput, TicketStatusTagInput } from './builders/ticket.js'
export { buildCooperationProposalTags, buildMilestoneTags } from './builders/cooperation.js'
export type { CooperationProposalTagInput, MilestoneTagInput } from './builders/cooperation.js'

// Selective disclosure for dispute arbitration (ADR-152)
export {
  canonicalizePayload,
  computePayloadCommitment,
  verifyPayloadCommitment,
} from './disclosure.js'
export type { CommercialPayload, DisclosureMethod } from './disclosure.js'

// Market-spec Kind 16/17 co-emission (ADR-154)
export { buildMarketSpecOrderTags, buildMarketSpecReceiptTags } from './builders/market-spec.js'
export type { MarketSpecOrderInput, MarketSpecReceiptInput } from './builders/market-spec.js'
export { shouldCoEmit } from './co-emission.js'

// Structured shipping — Kind 30406 (ADR-155)
export {
  SHIPPING_SERVICE_TYPES, DURATION_UNITS,
  buildShippingOptionTags, buildShippingOptionRefTag,
  parseShippingOptionRef, calculateShippingPrice,
} from './shipping.js'
export type { ShippingServiceType, DurationUnit, ShippingOptionTagInput, ShippingOptionRef } from './shipping.js'

// Product variations & collections — Kind 30402 enrichment + Kind 30405 (ADR-156, ADR-270)
export {
  PRODUCT_TYPES, PHYSICAL_TYPES, LISTING_VISIBILITIES,
  buildProductListingTags, buildCollectionTags,
  parseSpecs, parseProductImages, parseShippingOptionRefs,
  formatVariantLabel,
  normalizeGammaTag, normalizeGammaTags,
} from './product.js'
export type {
  ProductType, PhysicalType, ListingVisibility, ProductSpec,
  VariantAxis, VariantValues,
  ProductListingTagInput, ProductCollectionTagInput,
} from './product.js'

// MetaMask deterministic Nostr identity derivation (ADR-196)
export {
  buildMetamaskDerivationMessage,
  deriveNostrPrivkeyFromMetamaskSignature,
  deriveNostrPubkeyFromMetamaskSignature,
} from './metamask-identity.js'

// Calendar bookings — NIP-52 kinds 31922/31923/31924/31925 (ADR-271)
export {
  CALENDAR_KINDS, BOOKING_UNITS, BOOKING_EVENT_TYPES,
  toCoord, dayTags, spaceOccurrenceD, sessionOccurrenceD,
  buildCalendarTags, buildDateOccurrenceTags, buildTimeOccurrenceTags,
  buildBookingRsvpTags, parseBookingRsvp,
  buildBookingConfirmationTags, parseBookingConfirmation,
  isValidTimezone, zonedDateToUtc, utcToZonedDate, addDays, nightsBetween,
} from './calendar.js'
export type {
  BookingUnit, BookingEventType, CalendarRef,
  CalendarTagInput, DateOccurrenceTagInput, TimeOccurrenceTagInput,
  BookingRsvpTagInput, ParsedBookingRsvp,
  BookingConfirmationTagInput, ParsedBookingConfirmation,
} from './calendar.js'

// Agent review attestation — Kind 31419 (ADR-307)
export { AGENT_REVIEW_ATTESTATION_KIND, buildAgentReviewAttestationTags } from './builders/agent-reputation.js'
export type { AgentReviewAttestationTagInput } from './builders/agent-reputation.js'

// Capability attestation — Kind 31417 (ADR-316 D2 / ADR-317 D1)
export { CAPABILITY_ATTESTATION_KIND, buildCapabilityAttestationTags } from './builders/agent-trust.js'
export type { CapabilityAttestationTagInput } from './builders/agent-trust.js'

export { VERIFIED_AGENT_BADGE_KIND, buildVerifiedBadgeAttestationTags } from './builders/agent-verification.js'
export type { VerifiedBadgeAttestationTagInput } from './builders/agent-verification.js'

// Zod schemas + validators (opt-in; not yet wired into the live publish path)
export {
  TicketCreatedEventSchema, validateTicketCreated,
  TicketStatusEventSchema, validateTicketStatus,
} from './schemas/ticket.js'
export {
  CooperationProposalEventSchema, validateCooperationProposal,
  MilestoneEventSchema, validateMilestone,
} from './schemas/cooperation.js'
export {
  ShippingOptionEventSchema, validateShippingOption,
} from './schemas/shipping.js'
export {
  ProductListingEventSchema, validateProductListing,
  ProductCollectionEventSchema, validateProductCollection,
} from './schemas/product.js'
export {
  CalendarSchema, validateCalendar,
  BookingRsvpEventSchema, validateBookingRsvp,
  BookingConfirmationSchema, validateBookingConfirmation,
} from './schemas/calendar.js'

// Purchase-path resolver (ADR-415 D7) — how can this offer be bought?
export { PURCHASE_PATHS, isLightningPayableCurrency, resolvePurchasePath } from './purchase-path.js'
export type { PurchasePath, PurchasePathReason, PurchasePathOffer, PurchasePathContext, PurchasePathResult } from './purchase-path.js'
