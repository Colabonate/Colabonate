// Gemeinsame API-Response-Typen für alle Pages/Komponenten.
// Diese spiegeln exakt die Backend-Antworten wider (nicht das Domain-Modell aus types/ticket.ts).

import type { BountyBrief } from '../hooks/useAgentTaskQueries'
export interface OfferMilestone {
  id: string
  title: string
  description?: string
  percentage: number
  sortOrder: number
}

export interface TicketMilestone {
  id: string
  title: string
  description?: string
  status: string
  dueDate?: string
  amountSats?: number
}

export interface SellerStats {
  rating?: number
  reviewCount?: number
  completionRate?: number
}

// ADR-313 D5: agent card display data, joined onto AGENT_SETUP offers server-side.
// ADR-315 D3: isVerified + verifiedAt surface here so the badge renders on
// every AGENT_SETUP offer card + applicant row without a follow-up fetch.
export interface AgentProfileSummary {
  id: string
  name: string
  avatarUrl?: string | null
  capabilities: string[]
  reputationScore?: number | null
  trustScore?: number | null
  isVerified?: boolean
  verifiedAt?: string | null
  // ADR-396 D2 (FU-849): public facts for the buyer-side Agent section.
  tools?: Array<{ name: string; description?: string }> | null
  requireHumanApproval?: boolean
  humanInLoop?: boolean
  isPioneer?: boolean
}

export interface ProductSpec {
  key: string
  value: string
}

export interface VariantAxis {
  name: string
  values: string[]
}

export type VariantValues = Record<string, string>

export interface VariationItem {
  id?: string
  title?: string
  priceSats: number
  stock?: number | null
  sku?: string
  images?: string[]
  variantValues: VariantValues
  listingVisibility?: string
  isAvailable?: boolean
}

export interface Offer {
  id: string
  title: string
  description: string
  priceSats: number
  // ADR-277 D9.1/R5: set only for non-sats foreign listings (REMOTE source). priceSats is 0
  // (sentinel, not a real free price) whenever priceCurrency is set — always check
  // priceCurrency before trusting priceSats for display or purchase.
  priceAmount?: string | null
  priceCurrency?: string | null
  // ADR-415: origin URL of a REMOTE listing (the `r` tag of the Kind-30402 event),
  // null when the publisher gave none. Drives the "origin-link" purchase path.
  originUrl?: string | null
  // ADR-145: 'REMOTE' = mirrored from another Nostr marketplace (Kind 30402 published by a
  // foreign pubkey; creatorPubkey is the publisher, remoteDTag the listing's `d` tag).
  source?: 'LOCAL' | 'REMOTE'
  remoteDTag?: string | null
  category: string         // Legacy: derived from categoryCode
  categoryCode: string     // ADR-078: mandatory StandardCategory slug
  gammaTags?: string[]     // ADR-277: free-form NIP-99 `t` tags — the gamma axis, emergent & flat
  subcategory?: string     // Legacy: derived from categoryCode
  subcategoryCode?: string  // Legacy: derived from categoryCode
  ticketType?: string
  offerType?: 'SERVICE' | 'PRODUCT' | 'ITEM' | 'COOP' | 'AGENT_SETUP'
  status?: 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED'
  // ADR-386: server-derived owner gate (creator-scoped list only) — true while
  // a COOP network is published, has no member and no ticket, so it can be
  // edited via the full Coop-Guide form again.
  canFullEdit?: boolean
  creatorPubkey: string
  createdAt: string
  creator?: {
    lnAddress?: string
  }
  location?: string
  country?: string | null
  region?: string | null
  city?: string | null
  lat?: number | null
  lng?: number | null
  isRemote?: boolean
  language?: string | null
  images?: string[]
  offerMilestones?: OfferMilestone[]
  sellerStats?: SellerStats
  agentProfile?: AgentProfileSummary | null
  companyId?: string | null
  company?: { id: string; name: string; logoUrl?: string } | null
  productId?: string | null
  product?: { id: string; stock?: number; isAvailable?: boolean } | null
  deliveryTimeDays?: number | null
  deliveryCostSats?: number | null
  deliveryNotes?: string | null
  // ADR-152: Trade visibility + dispute mode
  visibility?: 'PUBLIC' | 'PRIVATE'
  disputeMode?: 'PUBLIC' | 'PRIVATE' | 'NONE'
  // lightningSubWalletId/-AdminKey are server-only (FU-233-D) and stripped
  // from every offer response.
  // ADR-183 Phase 2: per-buyer tier selection. Array of allowed tiers
  // (0 = public, 1 = semi-private, 2 = private). Schema default is null = [0].
  allowedVisibility?: number[] | null
  // ADR-184: three-phase escrow opt-in per offer.
  useEscrow?: boolean
  phase2WindowHours?: number | null
  // ADR-210: network-type cooperation membership config (offerType=COOP only).
  networkType?: 'open' | 'closed' | null
  membershipCriteria?: string | null
  maxMembers?: number | null

  // ADR-156 / ADR-270: Product variations & attributes
  productType?: 'simple' | 'variable' | 'variation' | string | null
  physicalType?: 'digital' | 'physical' | string | null
  listingVisibility?: 'hidden' | 'on-sale' | 'pre-order' | string | null
  parentOfferId?: string | null
  parentOffer?: {
    id: string
    title: string
    description?: string
    variantAxes?: VariantAxis[]
    images?: string[]
  } | null
  specs?: ProductSpec[] | null
  stock?: number | null
  variantAxes?: VariantAxis[] | null
  variantValues?: VariantValues | null
  variations?: Offer[] | null

  // ADR-271: bookable-resource linking + time-based pricing. bookingMode null
  // = ordinary offer; DATE_RANGE = SPACE (nights), SESSION = fixed occurrence.
  resourceId?: string | null
  bookingMode?: 'DATE_RANGE' | 'SESSION' | null
  priceUnit?: 'per_night' | 'per_day' | 'per_hour' | 'per_seat' | 'flat' | null
  bookingMinUnits?: number | null
  bookingMaxUnits?: number | null
  confirmationWindowHours?: number
  autoConfirm?: boolean
  // ADR-370 D6 (Phase 2, FU-671): the declarative, cleartext half of an
  // AGENT_SETUP config — carries the collaboration-canvas declaration that
  // drives pre-purchase disclosure chips + the canvasProvider search filter.
  // Only present on AGENT_SETUP offers that were saved with a canvas block.
  agentConfigMeta?: {
    capabilities?: string[]
    canvas?: import('../lib/agentConfig').AgentCanvasConfig | null
    // ADR-396 D2: seller's public provider/model disclosure.
    runtime?: { provider?: string; model?: string } | null
  } | null
  agentBillingModel?: string | null
  estimatedWorkspaceHours?: number | null
  agentWorkspaceTTL?: number | null
}

export type TicketStatus = 'PENDING' | 'ACCEPTED' | 'PAID' | 'IN_PROGRESS' | 'COMPLETED' | 'DISPUTED' | 'CANCELLED'

export type TicketType = 'SMART_ORDER' | 'MILESTONE' | 'DISPUTE' | 'GOVERNANCE' | 'VERIFICATION' | 'ROYALTY'

export interface Ticket {
  id: string
  offerId: string
  /** ADR-397 D6: the bounty brief frozen at creation (bounty tickets only). */
  bountyBrief?: BountyBrief | null
  // ADR-342 D5: agentConfigMeta carries the declarative canvas config that
  // drives the "Open Canvas" action (server sends the full offer row).
  offer: {
    title: string
    description?: string
    priceSats: number
    images?: string[]
    agentConfigMeta?: { canvas?: import('../lib/agentConfig').AgentCanvasConfig } | null
  }
  buyerPubkey: string
  sellerPubkey: string
  status: TicketStatus
  ticketType: TicketType
  offerType?: 'SERVICE' | 'PRODUCT' | 'ITEM' | 'AGENT_SETUP'
  lightningInvoice?: string
  paymentHash?: string
  amountSats?: number
  nostrEventId?: string
  escrowStatus?: string
  // Populated by GET /api/tickets/:id only when this ticket was resolved via
  // a DAO Arbitration Council dispute — surfaces the outcome + arbitrator's
  // reasoning to buyer/seller (previously only visible on the Council-only
  // dispute detail page).
  disputeResolution?: { outcome: string; reasoning: string | null; resolvedAt: string | null }
  phase1Invoice?: string
  phase2Invoice?: string
  phase3Invoice?: string
  milestones?: TicketMilestone[]
  createdAt: string
  updatedAt?: string
  deliveryAddress?: DeliveryAddress
  deliveryTimeDays?: number
  deliveryCostSats?: number
  totalHours?: number
  deliveryNotes?: string
  // ADR-152: Trade visibility + dispute mode (inherited from parent Offer in Phase 1.2c)
  visibility?: 'PUBLIC' | 'PRIVATE'
  disputeMode?: 'PUBLIC' | 'PRIVATE' | 'NONE'
  escrowSubWalletId?: string | null
  /** Server-returned role of the requesting pubkey (Phase 2.8) */
  viewerRole?: 'buyer' | 'seller' | 'arbiter'
  // ADR-342 D3/D5 (Phase B) + ADR-370 D2 (Phase 1): provisioning snapshot of
  // the doop-hosted canvas. Since Phase 1 it is bound at the TICKET level
  // (snapshotted at purchase, auto-provisioned at PAID), so it is present for
  // AGENT_SETUP tickets with canvas.provider 'doop-hosted' even before any
  // Workspace exists (canvas-only setups). Drives the hosted "Open Canvas"
  // button states (pending → disabled, failed → retry, ready → SSO handoff).
  workspaceCanvas?: {
    provider: 'doop-hosted'
    provisioningStatus: 'pending' | 'ready' | 'failed' | null
    canvasId: string | null
    buyerAccess: 'edit' | 'none' | null
  }
  // ADR-370 D6 (Phase 2): doop-local binding rendered from the TICKET snapshot
  // (instanceUrl/canvasId captured at purchase), so the post-purchase card is
  // immune to later offer edits (G3 client half). Only present on AGENT_SETUP
  // tickets whose purchase-time snapshot carried provider 'doop-local'.
  ticketCanvas?: {
    provider: 'doop-local'
    instanceUrl: string | null
    canvasId: string | null
  }
  // ADR-370 D4/D5 (Phase 4/5): canvas-agent-runner state (server bookkeeping
  // mirror). Only present on doop-hosted AGENT_SETUP tickets that opted into
  // agentInCanvas — drives the seller's "Activate agent" row in the
  // hosted-canvas card (Phase 5 / FU-674).
  agentRunnerStatus?: 'none' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | null
  agentRunnerStartedAt?: string | null
  agentRunnerStoppedAt?: string | null
  agentRunnerLastError?: string | null
  // ADR-184/253: mirrors Offer.useEscrow — true only for the (currently
  // everywhere-disabled) three-phase hold-invoice escrow path. ADR-255 D7:
  // release-payment (a second, platform-issued invoice) only applies when
  // this is true; a non-escrow ticket confirms receipt via a plain PATCH.
  escrowEnabled?: boolean
  // ADR-253/255: non-escrow direct-pay rail this ticket resolved to
  // ('LN' | 'CASHU' | 'DEMO'), null for escrow/legacy custodial tickets.
  directPayRail?: string | null
  cashuMintUrl?: string | null
  cashuSellerPubkey?: string | null
  // ADR-399 D1: which seller rail minted the LN invoice ('LNURL' | 'NWC' |
  // 'ALBY_OAUTH'); the server detects settlement at that source.
  sellerInvoiceSource?: string | null
  sellerVerifyUrl?: string | null
  // ADR-399 D3: the buyer's P2PK-locked Cashu token (buyer + seller only).
  cashuToken?: string | null
  cashuTokenSentAt?: string | null
  // ADR-270: Frozen variant label at ticket creation (e.g. "Size: M · Colour: blue")
  variantLabel?: string | null
  // Preimage of the settled seller invoice (ADR-241: set by the single
  // confirm path). Non-null means the seller leg is confirmed — the ticket
  // itself can still sit on PENDING while the hosted-canvas fee is open, so
  // the payment card must not read the ticket status as "unpaid".
  preimage?: string | null
  // ADR-372 D3 (FU-697): 1:1 hosted-canvas fee collection row (doop-hosted
  // AGENT_SETUP only). Present when the ticket carries a fee; drives the
  // ticket-page fee status + "confirm fee" action for the abandoned-checkout
  // / demo-balance-exhausted edge case.
  platformFee?: {
    id: string
    amountSats: number
    feeBps: number
    rail: string
    status: 'PENDING' | 'PAID'
    memo?: string | null
    invoice?: string | null
    paymentHash?: string | null
    confirmedAt?: string | null
    sellerLegConfirmedAt?: string | null
    createdAt?: string
  } | null
}

// =============================================================================
// ADR-152 §A4 / PROB-002 A2: Mutual-Arbiter Pattern for private-mode disputes
// =============================================================================

/** Server response row shape for a `PrivateArbiter` nomination (Phase 1.6) */
export interface PrivateArbiterNomination {
  id: string
  ticketId: string
  arbiterPubkey: string
  /** Buyer has nominated this arbiter (server flag) */
  nominatedByBuyer: boolean
  /** Seller has nominated this arbiter (server flag) */
  nominatedBySeller: boolean
  /** Set when the nominated arbiter accepted the role */
  acceptedAt: string | null
  rejectedAt: string | null
  /** Future-phase fields — set when the arbiter issues a verdict */
  verdictNostrEventId: string | null
  verdictOutcome: 'RELEASE' | 'CANCEL' | 'SPLIT' | null
  verdictReasoning: string | null
  createdAt: string
  updatedAt: string
}

/** Server response for `GET /api/tickets/:id/arbiters` */
export interface ArbitersState {
  ticket: {
    id: string
    disputeMode: 'PUBLIC' | 'PRIVATE' | 'NONE'
    buyerPubkey: string
    sellerPubkey: string
  }
  nominations: PrivateArbiterNomination[]
  /** True once any nomination row has `acceptedAt !== null` */
  ready_for_dispute: boolean
}

/** Convenience phase derived client-side from `ArbitersState.nominations` */
export type MutualArbiterPhase =
  | 'NONE'             // no nominations yet
  | 'ONE_NOMINATED'    // 1 of {buyer, seller} nominated
  | 'BOTH_NOMINATED'   // both nominated the same arbiter, awaiting acceptance
  | 'ACCEPTED'         // arbiter accepted; dispute-ready
  | 'REJECTED'         // arbiter explicitly rejected


// =============================================================================
// ADR-031: Company & Catalog Types
// =============================================================================

export interface Company {
  id: string
  ownerPubkey: string
  name: string
  description?: string
  address?: string
  city?: string
  zipCode?: string
  country?: string
  openingHours?: Record<string, { start: string; end: string } | null>
  businessFields?: { id: string; name: string; slug: string; unspscCode: string | null }[]
  coopRadius?: number
  terms?: string
  logoUrl?: string
  bannerUrl?: string
  images?: string[]
  website?: string
  email?: string
  phone?: string
  socialLinks?: string
  isActive: boolean
  hourlyRateSats?: number
  lat?: number
  lng?: number
  createdAt: string
  updatedAt: string
  catalogs?: Catalog[]
  deliveryTemplates?: DeliveryTemplate[]
}

export interface DeliveryTemplate {
  id: string
  companyId: string
  name: string
  deliveryTimeDays: number
  deliveryCostSats: number
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

/** ADR-340 D1: one Catalog entity, typed by `catalogType`. PRODUCT catalogs
 *  carry `companyId`; AGENT_SETUP catalogs carry `ownerPubkey`. Memberships
 *  live on `agentMembers` for AGENT_SETUP (PRODUCT catalogs have no members). */
export type CatalogType = 'PRODUCT' | 'AGENT_SETUP'

export interface Catalog {
  id: string
  companyId: string | null
  ownerPubkey?: string | null
  catalogType: CatalogType
  standardCategoryId?: string | null
  name: string
  description?: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  products?: Product[]
  agentMembers?: Array<{ agentProfileId: string; addedAt: string }>
  standardCategory?: { id: string; slug: string; name: string } | null
  company?: { id: string; name?: string; logoUrl?: string | null; ownerPubkey: string } | null
}

/** @deprecated ADR-078: Vendor categories removed. Use StandardCategory instead. */
export interface Category {
  id: string
  catalogId: string
  parentId?: string
  name: string
  description?: string
  sortOrder: number
  unspscCode?: string
  unspscLabel?: string
  standardCategoryId?: string
  standardCategory?: StandardCategory
  createdAt: string
  updatedAt: string
  products?: Product[]
}

// =============================================================================
// ADR-078: Standard Category Types (v2 – UNSPSC-referenced)
// =============================================================================

export interface StandardCategory {
  id: string
  slug: string
  name: string
  nameKey: string
  unspscCode?: string
  offerType: 'PRODUCT' | 'SERVICE'
  level: 1 | 2 | 3
  sortOrder: number
  parentId?: string
  parent?: StandardCategory
  children?: StandardCategory[]
  createdAt: string
  updatedAt: string
}

export interface Product {
  id: string
  /** ADR-395: null = company product without a catalog. */
  catalogId: string | null
  companyId?: string | null
  standardCategoryId?: string
  standardCategory?: StandardCategory
  name: string
  description?: string
  priceSats: number
  images?: string
  sku?: string
  stock?: number
  isAvailable: boolean
  metadata?: string
  offerId?: string | null
  createdAt: string
  updatedAt: string
}

// =============================================================================
// ADR-277 D5/D10/C1-C2: Gamma Product Collection (30405) + Shipping Option (30406)
// =============================================================================

export type ShippingServiceType = 'STANDARD' | 'EXPRESS' | 'OVERNIGHT' | 'PICKUP'

export interface ShippingOption {
  id: string
  d: string
  companyId: string
  title: string
  baseCost: string
  currency: string
  countries: string // comma-separated ISO-3166-1 alpha-2
  service: ShippingServiceType
  carrier?: string | null
  regions?: string | null
  durationMin?: number | null
  durationMax?: number | null
  durationUnit?: string | null
  location?: string | null
  geohash?: string | null
  weightMin?: string | null
  weightMax?: string | null
  weightUnit?: string | null
  dimMin?: string | null
  dimMax?: string | null
  dimUnit?: string | null
  nostrEventId?: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface ProductCollectionMember {
  id: string
  collectionId: string
  productId: string
  product: Product
  sortOrder: number
}

export interface CollectionShippingOption {
  id: string
  collectionId: string
  shippingOptionId: string
  shippingOption: ShippingOption
}

export interface ProductCollection {
  id: string
  d: string
  companyId: string
  title: string
  summary?: string | null
  image?: string | null
  location?: string | null
  geohash?: string | null
  nostrEventId?: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  products: ProductCollectionMember[]
  shippingOptions: CollectionShippingOption[]
}

// =============================================================================
// ADR-113: Cooperation Types (v2 – Tender + Project + MilestoneApplications)
// =============================================================================

export type CooperationStatus = 'OPEN' | 'ACCEPTED' | 'PAID' | 'IN_PROGRESS' | 'COMPLETED' | 'DISPUTED' | 'CANCELLED'
export type CoopMilestoneStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'ACCEPTED' | 'DISPUTED'

export interface CoopMilestone {
  id: string
  cooperationId: string
  milestoneIndex: number
  title: string
  description?: string
  acceptanceCriteria?: string
  dueDate?: string
  amountSats: number
  status: CoopMilestoneStatus
  partnerPubkey?: string
  evidence?: string
  nostrEventId?: string
  completedAt?: string
  // Direct-pay (escrow off): set once the partner was paid / confirmed receipt.
  paidAt?: string | null
  paidRail?: 'LN_PREIMAGE' | 'PARTNER_CONFIRMED' | null
  createdAt: string
  updatedAt: string
  // ADR-310 D2/D4: which AgentProfile is matched/assigned to execute this
  // milestone. Null for human-MILESTONE cooperations. The CoopGuide resume
  // effect (ADR-331 D2.1) restores this from the persisted column.
  assigneeAgentProfileId?: string | null
  // ADR-352 D1a: the specific Offer backing assigneeAgentProfileId (legacy
  // flat/pre-ADR-332 milestones only — the live Coop Guide always authors
  // the nested `steps` path below instead).
  assigneeOfferId?: string | null
  // ADR-331 D5.1: nested include on the GET response. Only `companyId` is
  // fetched (select, not include) — used by the resume helper to recover
  // the Corporate role when an AgentProfile carries a Company.
  assigneeAgentProfile?: { companyId: string | null } | null
  // ADR-331 D1: per-step capability requirements for the agent-orchestration
  // flow. Null for human-MILESTONE cooperations and legacy rows. JSON-decoded
  // server-side at write + read; client treats as plain string[].
  requiredCapabilities?: string[] | null
  // ADR-332 D2: nested agent pipeline steps inside this milestone. Absent
  // for human milestones and legacy (pre-ADR-332) rows — legacy agent rows
  // keep milestone-level assigneeAgentProfileId/requiredCapabilities instead.
  steps?: CoopMilestoneStep[]
}

// ADR-332 D2: client view of the nested CoopMilestoneStep row.
export interface CoopMilestoneStep {
  id: string
  stepIndex: number
  title: string
  requiredCapabilities?: string[] | null
  assigneeAgentProfileId?: string | null
  // ADR-352 D1a (FU-606): the specific Offer backing assigneeAgentProfileId.
  assigneeOfferId?: string | null
  // ADR-352 D4: server-derived pipeline progress (PENDING | IN_PROGRESS | COMPLETED).
  status?: string
}

export interface CoopMilestoneApplication {
  id: string
  cooperationId: string
  milestoneId: string
  applicantPubkey: string
  message?: string
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED'
  createdAt: string
  updatedAt: string
}

export interface Cooperation {
  id: string
  title: string
  description?: string
  initiatorPubkey: string
  partnerPubkey?: string
  cooperationType?: 'TRANSACTIONAL' | 'PRODUCTION' | 'SALES' | 'SERVICE' | 'EDUCATIONAL' | 'CROWDFUNDING' | 'BARTER' | 'TENDER'
  budgetSats: number
  timeline?: string
  skills?: string
  status: CooperationStatus
  nostrProposalId?: string
  nostrAcceptId?: string
  categoryCode?: string
  images?: string
  deadline?: string
  requirements?: string
  offerId?: string
  milestones: CoopMilestone[]
  milestoneApplications?: CoopMilestoneApplication[]
  // ADR-152: trade visibility + dispute mode (default PUBLIC)
  visibility?: 'PUBLIC' | 'PRIVATE'
  disputeMode?: 'PUBLIC' | 'PRIVATE' | 'NONE'
  // ADR-329: payment structure — SMART_ORDER (3 auto phases 25/50/25) vs.
  // MILESTONE (custom phases). Server default MILESTONE; optional here for
  // back-compat with older cached payloads.
  ticketType?: 'SMART_ORDER' | 'MILESTONE'
  // ADR-328 D4: server-derived snapshot — true if any CoopMilestone of this
  // Cooperation was assigned an AgentProfile at creation time.
  isAgentOrchestration?: boolean
  // ADR-331 D1: snapshot of the Guide's agentSupervision axis at creation.
  // Null for executor='human' cooperations and for legacy rows (server
  // treats null as 'human' on resume — CoopGuide.tsx resume helper).
  agentSupervision?: 'human' | 'autonomous' | null
  // FU-511 (ADR-331 K): the initiator's own Company, snapshot at POST.
  // Recovers the Corporate role on resume for human-only cooperations.
  companyId?: string | null
  // ADR-386: server-derived owner gate — true only while the cooperation is
  // published, unengaged and non-agent, so it can be edited via the full
  // Coop-Guide form again. Absent/false on every other path.
  canFullEdit?: boolean
  createdAt: string
  updatedAt: string
}

// =============================================================================
// ADR-030: Cart Types
// =============================================================================

export interface CartItem {
  offerId: string
  title: string
  priceSats: number
  offerType: 'SERVICE' | 'PRODUCT' | 'ITEM' | 'COOP' | 'AGENT_SETUP'
  category?: string
  image?: string
  company?: { id: string; name: string; logoUrl?: string } | null
  sellerPubkey: string
  quantity: number
  stock?: number | null
  deliveryTimeDays?: number
  deliveryCostSats?: number
  deliveryNotes?: string
  // ADR-183 Phase 2: per-offer allowed tiers from Offer.allowedVisibility.
  // Optional for backward-compat with persisted carts that predate Phase 2;
  allowedVisibility?: number[] | null  // missing/null is treated as [0] (Tier 0 / public only).
  // ADR-270: Selected variant information
  variantLabel?: string | null
  variantValues?: VariantValues | null
  // ADR-370 D6 (Phase 2): canvas declaration carried from the AGENT_SETUP
  // offer into the cart so the order-review step can repeat the pre-purchase
  // disclosure ("collaboration canvas included"). Absent for non-agent items.
  canvasProvider?: 'doop-local' | 'doop-hosted' | null
  canvasAgentInCanvas?: boolean | null
  // ADR-415: origin of the offer. Remote offers (mirrored from other Nostr marketplaces) can
  // never be ordered through Colabonate, so addItem refuses them. Absent on carts persisted
  // before this field existed: the provider checks those once against the server and stores
  // the result here.
  source?: 'LOCAL' | 'REMOTE'
}

export interface DeliveryAddress {
  fullName: string
  street: string
  zipCode: string
  city: string
  country: string
  phone?: string
}

// =============================================================================
// ADR-091: Wallet Dashboard Phase 1 Types
// =============================================================================

export type TransactionType = 'SENT' | 'RECEIVED' | 'ESCROW_HOLD' | 'ESCROW_RELEASE' | 'ESCROW_REFUND'

export interface Transaction {
  id: string
  type: TransactionType
  amountSats: number
  offerTitle: string
  // null/undefined on non-ticket platform payments (AI credits, MCP passes,
  // workspace funding, support tips) — those render as plain history rows.
  ticketId?: string | null
  status: 'COMPLETED' | 'PENDING' | 'REFUNDED'
  paymentHash?: string | null
  createdAt: string
  phase?: 1 | 2 | 3
  // ADR-152 (Phase 4.4): trade visibility, so the wallet can flag private tickets
  visibility?: 'PUBLIC' | 'PRIVATE'
  // Ticket-derived history dimensions (ADR-240/253): which rail paid the ticket
  // (DEMO is beta-only), the raw ticket state and the escrow phase — used for
  // the rail badge, the human status wording and the "Open" filter.
  directPayRail?: 'LN' | 'CASHU' | 'DEMO' | null
  escrowEnabled?: boolean
  escrowStatus?: string | null
  ticketStatus?: string
  // Which source produced this row. Absent/`ticket` = marketplace ticket.
  source?: 'ticket' | 'ai-credits' | 'mcp-pass' | 'workspace-recharge' | 'support-tip'
}

export interface LNBitsDemoValidation {
  valid: boolean
  balance?: number
  error?: string
}

// =============================================================================
// User Profile Types (Public Profile Page)
// =============================================================================

export type ProfileVisibility = 'PUBLIC' | 'PSEUDO_PRIVATE' | 'PRIVATE'

export interface UserProfileStats {
  offersCreated: number
  completedTickets: number
  completionRate: number | null
  completedAsBuyer: number
  completedAsSeller: number
}

export interface UserProfileResponse {
  pubkey: string
  lnAddress?: string | null
  identityLevel: number
  colPoints?: number
  reputationScore?: number
  reviewCount?: number
  // Nostr Kind 0 display metadata (visibility-gated: only set for PUBLIC profiles)
  picture?: string | null
  name?: string | null
  about?: string | null
  banner?: string | null
  nip05?: string | null
  stats?: UserProfileStats
  company?: { id: string; name: string; logoUrl: string | null; city: string | null } | null
  visibility: ProfileVisibility
  walletModeStrategy?: WalletModeStrategy
}

export type WalletModeStrategy = 'HYBRID' | 'CUSTODIAL_ONLY' | 'NONCUSTODIAL_ONLY'

export interface StrategyExplanation {
  strategy: WalletModeStrategy
  label: string
  summary: string
  publicMode: 'CUSTODIAL' | 'NON_CUSTODIAL'
  privateMode: 'CUSTODIAL' | 'NON_CUSTODIAL'
  caveat: string | null
}

// ── ADR-156: GDPR Art. 17 account deletion ────────────────────────────────────
export interface DeletionBlockers {
  activeEscrows: number
  openDisputes: number
}

export interface DeletionPreCheck {
  pubkey: string
  canDelete: boolean
  blockers: DeletionBlockers
  /** Nostr event ids the client signs + publishes as a Kind 5 (NIP-09). */
  eventIds: string[]
  /** Coarse preview of what would be anonymized / deleted. */
  summary: Record<string, number>
}

export interface DeletionCounts {
  ticketsAnonymized: number
  offersAnonymized: number
  cooperationsAnonymized: number
  reviewsRevieweeAnonymized: number
  arbitersAnonymized: number
  reviewsDeleted: number
  dmMessagesDeleted: number
  companiesDeleted: number
  walletsDeleted: number
  newsletterRowsDeleted: number
}

export interface DeletionResult {
  deletionId: string
  pubkeyHash: string
  eventIds: string[]
  counts: DeletionCounts
  nip09: { kind5EventId: string | null; relaysOk: number }
}
