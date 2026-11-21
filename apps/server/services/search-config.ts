import type { Settings } from 'meilisearch'

// ADR-342 D1 (amendment A1): v3 adds the flat `canvasProvider` facet.
// ADR-370 D6 (Phase 2, FU-671): v4 adds `canvasAgentInCanvas` (opt-in flag,
// indexed next to the provider facet so a future "agent works on canvas"
// filter can narrow without a schema change).
// NOTE: on an existing deployment the `offers` alias keeps pointing at the
// previous physical index — ensureIndex (outbox-worker.ts) only re-applies
// settings to the alias and never creates offers_v4. Existing documents
// therefore lack `canvasAgentInCanvas` until re-upserted or
// `scripts/reindex-offers.ts --all` runs; new attributes need that manual
// reindex before a filter on them ships (unlike pure settings changes).
export const OFFER_INDEX_VERSION = 4
export const OFFER_INDEX_ALIAS = 'offers'
export const OFFER_INDEX_NAME = `offers_v${OFFER_INDEX_VERSION}`

export const OFFER_INDEX_SETTINGS: Settings = {
  searchableAttributes: [
    'title',
    'description',
    'category',
    'subcategory',
    'companyName',
    'city',
    'region',
  ],
  filterableAttributes: [
    'offerType',
    'country',
    'region',
    'categoryCode',
    'gammaTags',
    'status',
    'source',
    'priceSats',
    'companyId',
    'creatorPubkey',
    'language',
    // ADR-313 D1
    'agentCapabilities',
    'agentBillingModel',
    'agentReputationScore',
    // ADR-315 D3: facet for "Verified only" agent filter.
    'agentIsVerified',
    // ADR-342 D1 (A1): facet for "has a collaboration canvas" filtering.
    'canvasProvider',
    // ADR-370 D6 (Phase 2): opt-in agent-in-canvas flag next to the provider.
    'canvasAgentInCanvas',
  ],
  // ADR-363 D2: `id` is the deterministic tiebreaker for every sort — with a
  // stable total order, offset pagination cannot reorder rows within an
  // unchanged dataset. Settings are re-applied on every server boot
  // (outbox-worker.ts), no manual reindex required.
  sortableAttributes: ['priceSats', 'publishedAt', 'createdAt', 'agentReputationScore', 'id'],
  displayedAttributes: [
    'id',
    'title',
    'description',
    'priceSats',
    'offerType',
    'category',
    'categoryCode',
    'gammaTags',
    'images',
    'country',
    'region',
    'city',
    'companyName',
    'companyLogoUrl',
    'creatorPubkey',
    'publishedAt',
    'source',
    'isRemote',
    'language',
    'status',
    // ADR-313 D1
    'agentCapabilities',
    'agentBillingModel',
    'agentReputationScore',
    // ADR-315 D3
    'agentIsVerified',
    // ADR-342 D1 (A1)
    'canvasProvider',
    // ADR-370 D6 (Phase 2)
    'canvasAgentInCanvas',
  ],
  pagination: { maxTotalHits: 10000 },
  typoTolerance: { enabled: true },
  // ADR-418 D2: Meili's default is 100 values per facet, and ISO 3166 has 249
  // country codes. Without the raise, the country distribution silently
  // truncates and the countryless arithmetic in GET /api/search/facets is wrong.
  // Applied on every boot (outbox-worker ensureIndex); no reindex needed.
  faceting: { maxValuesPerFacet: 300 },
}

export interface OfferSearchDocument {
  id: string
  title: string
  description: string
  priceSats: number
  offerType: string
  category: string | null
  categoryCode: string | null
  gammaTags: string[]
  subcategory: string | null
  images: string[] | null
  country: string | null
  region: string | null
  city: string | null
  companyName: string | null
  companyLogoUrl: string | null
  creatorPubkey: string
  publishedAt: number | null
  createdAt: number
  source: string
  isRemote: boolean
  language: string | null
  status: string
  // ADR-313 D1: null/[] for every non-AGENT_SETUP offer.
  agentCapabilities: string[]
  agentBillingModel: string | null
  agentReputationScore: number | null
  // ADR-315 D3: false for every non-AGENT_SETUP offer + every unverified agent.
  agentIsVerified: boolean
  // ADR-342 D1 (A1): flat denormalized canvas provider — null for every
  // non-AGENT_SETUP offer and every setup without a canvas.
  canvasProvider: string | null
  // ADR-370 D6 (Phase 2): opt-in agent-in-canvas flag (only meaningful when
  // canvasProvider === 'doop-hosted'); false for everything else.
  canvasAgentInCanvas: boolean
}