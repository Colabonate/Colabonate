/**
 * Kind Mapping Constants for NIP-15 Conflict Resolution
 *
 * ADR-101: NIP-15 Kind Conflict Resolution
 * https://github.com/nostr-protocol/nips/blob/master/15.md (NIP-15 Marketplace)
 * https://github.com/nostr-protocol/nips/blob/master/99.md (NIP-99 Classified Listings)
 *
 * IMPORTANT: Kind range 30017-30019 collides with NIP-15 (Nostr Marketplace):
 *   - 30017: NIP-15 Stall (Colabonate: Offer) ❌ CONFLICT
 *   - 30018: NIP-15 Product (Colabonate: Ticket Created) ❌ CONFLICT
 *   - 30019: NIP-15 Marketplace UI/UX (Colabonate: Ticket Status) ❌ CONFLICT
 *
 * Resolution: Dual-publishing to both internal (legacy) and external (NIP-compliant) kinds.
 */

export const NOSTR_KINDS = {
  OFFER_LEGACY: 30017,
  OFFER_NIP99: 30402,

  TICKET_CREATED_LEGACY: 30018,
  TICKET_STATUS_LEGACY: 30019,
  DISPUTE_LEGACY: 30020,

  TICKET_CREATED_NEW: 30407,
  TICKET_STATUS_NEW: 30408,
  DISPUTE_NEW: 30409,

  COMPANY_LEGACY: 30027,
  COMPANY_NEW: 30404,

  CREDENTIAL_LEGACY: 30021,
  CREDENTIAL_NEW: 30410,

  REVIEW_LEGACY: 30024,
  REVIEW_NEW: 30411,

  HID_ATTESTATION: 30023,
  GOVERNANCE_VOTE: 30022,
  COLA_STAKE: 30025,
  PROXIMITY_PROOF: 30026,

  COOPERATION_PROPOSAL_LEGACY: 30028,
  COOPERATION_PROPOSAL_NEW: 30414,

  MILESTONE_LEGACY: 30029,
  MILESTONE_NEW: 30415,

  // FU-617 (ADR-357 D3): escrow authorization events verified by the ICP escrow
  // canister (packages/icp-escrow-canister/src/sig.rs — the canister's kind constants
  // are the source of truth; these entries reserve the numbers so no other surface
  // allocates them). Never publish these to public relays as user content: a leaked
  // authorization is a citable artifact, but a relay-visible stream invites phishing
  // signEvent prompts.
  ESCROW_TERMS: 30416,
  ESCROW_ACTION: 30417,

  MARKET_SPEC_ORDER: 16,
  MARKET_SPEC_RECEIPT: 17,

  // ADR-277 D0: 30405/30406 are reserved exclusively for the Gamma-Markets
  // object graph (Product Collection / Shipping Option) — never reuse these
  // for Colabonate-internal kinds. Credential/Review moved to 30410/30411
  // to resolve the collision (was 30405/30406 pre-ADR-277).
  PRODUCT_COLLECTION: 30405,
  SHIPPING_OPTION: 30406,
} as const

export const CONFLICTED_KINDS = [30017, 30018, 30019] as const

export const KIND_MAPPING: Record<number, number> = {
  [NOSTR_KINDS.OFFER_LEGACY]: NOSTR_KINDS.OFFER_NIP99,
  [NOSTR_KINDS.COMPANY_LEGACY]: NOSTR_KINDS.COMPANY_NEW,
  [NOSTR_KINDS.CREDENTIAL_LEGACY]: NOSTR_KINDS.CREDENTIAL_NEW,
  [NOSTR_KINDS.REVIEW_LEGACY]: NOSTR_KINDS.REVIEW_NEW,
  [NOSTR_KINDS.TICKET_CREATED_LEGACY]: NOSTR_KINDS.TICKET_CREATED_NEW,
  [NOSTR_KINDS.TICKET_STATUS_LEGACY]: NOSTR_KINDS.TICKET_STATUS_NEW,
  [NOSTR_KINDS.DISPUTE_LEGACY]: NOSTR_KINDS.DISPUTE_NEW,
  [NOSTR_KINDS.COOPERATION_PROPOSAL_LEGACY]: NOSTR_KINDS.COOPERATION_PROPOSAL_NEW,
  [NOSTR_KINDS.MILESTONE_LEGACY]: NOSTR_KINDS.MILESTONE_NEW,
}

export const getMappedKind = (kind: number): number | undefined => {
  return KIND_MAPPING[kind]
}

export const isKindConflicted = (kind: number): boolean => {
  return CONFLICTED_KINDS.includes(kind as typeof CONFLICTED_KINDS[number])
}

export const OFFER_KINDS = [NOSTR_KINDS.OFFER_LEGACY, NOSTR_KINDS.OFFER_NIP99] as const

/**
 * Publishing-client attribution tag emitted on marketplace listing events
 * (Kind 30017/30402). NIP-99 leaves it unspecified, but ecosystem stats
 * (nostrolo.gy/marketplaces "Who publishes") group listings by this optional
 * tag — without it our listings count as "untagged" and Colabonate never
 * appears as a publishing app. ADR-412 amendment 2026-11-20.
 */
export const NOSTR_CLIENT_TAG = 'Colabonate'
export const COMPANY_KINDS = [NOSTR_KINDS.COMPANY_LEGACY, NOSTR_KINDS.COMPANY_NEW] as const
export const TICKET_CREATED_KINDS = [NOSTR_KINDS.TICKET_CREATED_LEGACY, NOSTR_KINDS.TICKET_CREATED_NEW] as const
export const TICKET_STATUS_KINDS = [NOSTR_KINDS.TICKET_STATUS_LEGACY, NOSTR_KINDS.TICKET_STATUS_NEW] as const
export const DISPUTE_KINDS = [NOSTR_KINDS.DISPUTE_LEGACY, NOSTR_KINDS.DISPUTE_NEW] as const
export const CREDENTIAL_KINDS = [NOSTR_KINDS.CREDENTIAL_LEGACY, NOSTR_KINDS.CREDENTIAL_NEW] as const
export const REVIEW_KINDS = [NOSTR_KINDS.REVIEW_LEGACY, NOSTR_KINDS.REVIEW_NEW] as const
export const COOPERATION_PROPOSAL_KINDS = [NOSTR_KINDS.COOPERATION_PROPOSAL_LEGACY, NOSTR_KINDS.COOPERATION_PROPOSAL_NEW] as const
export const MILESTONE_KINDS = [NOSTR_KINDS.MILESTONE_LEGACY, NOSTR_KINDS.MILESTONE_NEW] as const
