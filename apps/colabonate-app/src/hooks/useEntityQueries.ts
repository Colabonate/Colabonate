import { useCallback, useRef, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { apiCall, ApiError } from '../lib/api'
import { richTextToPlainText } from '../components/offers'
import { parseJsonField } from '../routes/coop/coop-cards'
import type { CoopItem } from '../routes/coop/coop-cards'
import type { Offer, Ticket, Company, StandardCategory, Catalog } from '../types/api'
import { useListingFeed } from './useOfferSearch'

const POLL_INTERVAL = Number(import.meta.env.VITE_POLL_INTERVAL_MS) || 30_000

export interface Cooperation {
  id: string
  title: string
  description: string | null
  initiatorPubkey: string
  partnerPubkey: string | null
  cooperationType: string | null
  partnerMode?: string | null
  budgetSats: number
  status: string
  timeline?: string | null
  skills?: string[] | null
  categoryCode?: string | null
  deadline?: string | null
  requirements?: string | null
  // ADR-328 D4: server-derived snapshot — true if any CoopMilestone of this
  // Cooperation was assigned an AgentProfile at creation time. Used by
  // CoopManageView's executor-kind filter chip.
  isAgentOrchestration?: boolean
  images?: string[] | null
  offerId?: string | null
  nostrProposalId?: string | null
  nostrAcceptId?: string | null
  // ADR-152: trade visibility + dispute mode (default PUBLIC)
  visibility?: 'PUBLIC' | 'PRIVATE' | null
  disputeMode?: 'PUBLIC' | 'PRIVATE' | 'NONE' | null
  // ADR-331 D1: snapshot of the Guide's agentSupervision axis at creation.
  // Null for executor='human' cooperations and for legacy rows (server
  // treats null as 'human' on resume — CoopGuide.tsx resume helper).
  agentSupervision?: 'human' | 'autonomous' | null
  // FU-511 (ADR-331 K): the initiator's own Company, snapshot at POST.
  // Recovers the Corporate role on resume for human-only cooperations.
  companyId?: string | null
  company?: { id: string; name: string; logoUrl?: string } | null
  partner?: { id: string; name: string; logoUrl?: string } | null
  milestones: {
    id: string;
    milestoneIndex: number;
    title: string;
    description?: string | null;
    amountSats: number;
    status: string;
    completedAt?: string | null;
    partnerPubkey?: string | null;
    // ADR-310 D2/D4: which AgentProfile is matched/assigned to execute this
    // milestone. Null for non-agent-orchestration cooperations. Persists on
    // CoopMilestone.assigneeAgentProfileId; the resume mapper in CoopGuide
    // (ADR-331 D2.1) restores it from this field — do NOT strip on edit.
    assigneeAgentProfileId?: string | null
    // ADR-352 D1a: the specific Offer backing assigneeAgentProfileId (legacy
    // flat/pre-ADR-332 milestones only).
    assigneeOfferId?: string | null
    // ADR-331 D5.1: nested include on the GET response. Only `companyId` is
    // fetched (select, not include) — used by the resume helper to recover
    // the Corporate role when an AgentProfile carries a Company.
    assigneeAgentProfile?: { companyId: string | null } | null
    // ADR-331 D1: per-step capability requirements for the agent-orchestration
    // flow. Null for human-MILESTONE cooperations and for legacy rows. JSON-
    // decoded server-side at write + read; client treats as plain string[].
    requiredCapabilities?: string[] | null
    // ADR-332 D2: nested agent pipeline steps (JSON-decoded server-side).
    steps?: Array<{
      id: string
      stepIndex: number
      title: string
      requiredCapabilities?: string[] | null
      assigneeAgentProfileId?: string | null
      // ADR-352 D1a (FU-606): the specific Offer this step is assigned to.
      assigneeOfferId?: string | null
      // ADR-352 D4: server-derived pipeline progress.
      status?: string
    }>
    messages?: {
      id: string
      authorPubkey: string
      action: string | null
      message: string | null
      createdAt: string
    }[]
    applications?: {
      id: string
      applicantPubkey: string
      message: string | null
      status: 'PENDING' | 'ACCEPTED' | 'DECLINED'
      createdAt: string
    }[]
  }[]
  createdAt: string
}

export function coopToCoopItem(coop: Record<string, unknown>): CoopItem {
  const coopType = (coop.cooperationType as string | undefined) ?? ''
  const isTender = coopType === 'TENDER'
  // ADR-368 D4: Service Bundles (cooperationType === 'SERVICE') stop rendering
  // as generic 'project' items — they map to the dedicated 'bundle' type so the
  // coop explorer's new `services` tab can show Service Offers + Service Bundles
  // together while `projects` stays project-only.
  const isServiceBundle = coopType === 'SERVICE'
  const parsedSkills = parseJsonField<string[]>(coop.skills, undefined)
  return {
    id: coop.id as string,
    title: (coop.title as string) ?? 'Untitled',
    // ADR-295: list items show visible text, never stored rich-text markup
    description: coop.description ? richTextToPlainText(coop.description as string) : undefined,
    itemType: isTender ? 'tender' : isServiceBundle ? 'bundle' : 'project',
    status: coop.status as string | undefined,
    categoryCode: coop.categoryCode as string | null | undefined,
    budgetSats: coop.budgetSats as number | undefined,
    createdAt: coop.createdAt as string | undefined,
    skills: Array.isArray(parsedSkills) ? parsedSkills : undefined,
    partnerPubkey: coop.partnerPubkey as string | undefined,
    initiatorPubkey: coop.initiatorPubkey as string | undefined,
    cooperationType: coopType || undefined,
    deadline: coop.deadline as string | undefined,
    // ADR-376 D3: prefer the slim imageThumbs (native JSON array, present on
    // rows created/edited after the migration) over the raw base64 `images`
    // JSON-string column, which /api/cooperations/discover no longer even
    // sends. Falls back to `images` for any pre-migration row still only
    // reachable via GET /api/cooperations/:id (which keeps the full field).
    images: Array.isArray(coop.imageThumbs) && coop.imageThumbs.length > 0
      ? (coop.imageThumbs as string[])
      : parseJsonField<string[]>(coop.images, undefined),
    detailPath: `/coop/${coop.id}`,
    // ADR-328 D4: see Cooperation.isAgentOrchestration above. Mapper addition
    // is non-breaking — CoopItem pre-existing consumers just read undefined
    // on legacy rows (the field is genuinely absent only on the COOP/Offer path
    // where it never applied).
    isAgentOrchestration: coop.isAgentOrchestration as boolean | undefined,
    // ADR-386: owner-only full-edit gate, computed server-side.
    canFullEdit: coop.canFullEdit as boolean | undefined,
  }
}

// Network cooperations are Offer records (offerType=COOP), not Cooperation
// records — see useCoopForm.ts. Maps them into the same CoopItem shape used
// by coopToCoopItem so Explore/Find views can render both side by side.
export function offerToCoopItem(offer: Record<string, unknown>): CoopItem {
  return {
    id: offer.id as string,
    title: (offer.title as string) ?? 'Untitled',
    // ADR-295: list items show visible text, never stored rich-text markup
    description: offer.description ? richTextToPlainText(offer.description as string) : undefined,
    itemType: 'network',
    status: offer.status as string | undefined,
    categoryCode: offer.categoryCode as string | null | undefined,
    gammaTags: offer.gammaTags as string[] | undefined,
    priceSats: offer.priceSats as number | undefined,
    createdAt: ((offer.publishedAt ?? offer.createdAt) as string | undefined),
    initiatorPubkey: offer.creatorPubkey as string | undefined,
    // ADR-363 D3: forward the offer's company id (full /api/offers shape
    // includes company) so dedupeCoopItems can collapse this network card
    // into the company's vendor card. Defensive: undefined when the row has
    // no company relation or the endpoint omits it.
    companyId: (offer.company as { id?: string } | null | undefined)?.id,
    // ADR-363 D6: ISO country for the coop LocationsFilterPanel.
    country: offer.country as string | undefined,
    images: parseJsonField<string[]>(offer.images, undefined),
    detailPath: `/coop/${offer.id as string}`,
  }
}

// Companies → CoopItem, for the Partners tab in CoopExplore (ADR-227).
// Uses GET /api/companies (isActive only, no Offer requirement) so every
// published company shows up, unlike the Offer-driven /api/partners endpoint.
export function companyToCoopItem(company: Company): CoopItem {
  return {
    id: company.id,
    title: company.name,
    description: company.description,
    itemType: 'vendor',
    location: [company.city, company.country].filter(Boolean).join(', ') || undefined,
    // ADR-363 D6: ISO country for the coop LocationsFilterPanel.
    country: company.country ?? undefined,
    createdAt: company.createdAt,
    initiatorPubkey: company.ownerPubkey,
    images: company.logoUrl ? [company.logoUrl] : company.images,
    categoryCodes: parseJsonField<Company['businessFields']>(company.businessFields, [])?.map(f => f.slug),
    detailPath: `/c/${company.id}`,
  }
}

export interface PartnerUser {
  pubkey: string
  lnAddress: string | null
  picture: string | null
  offerCount: number
  firstOfferAt: string | null
  categories: string[]
}

// Individual people from GET /api/partners?segment=users → CoopItem, for the
// Partners tab. Kept Offer-driven (no unfiltered users endpoint exists yet).
export function partnerUserToCoopItem(user: PartnerUser): CoopItem {
  return {
    id: user.pubkey,
    title: user.lnAddress || `${user.pubkey.slice(0, 8)}…`,
    itemType: 'partner',
    createdAt: user.firstOfferAt ?? undefined,
    initiatorPubkey: user.pubkey,
    images: user.picture ? [user.picture] : undefined,
    categoryCodes: user.categories,
    detailPath: `/u/${user.pubkey}`,
  }
}

// ADR-206 FU-206-C/D: the canonical cache for `GET /api/cooperations?pubkey=`
// holds the RAW Cooperation[] (with milestones). NotificationContext diffs
// against it, and every consumer that needs this endpoint derives its view via
// `select` so react-query dedupes to ONE network request per poll cycle.
// Consumers: useCooperations (CoopItem[]), useManagedOffers (ManagedOfferRow[]),
// useCooperationsForProjects (Cooperation[]), NotificationContext (raw).
const coopListToCoopItems = (coops: Cooperation[]): CoopItem[] =>
  coops.map(c => coopToCoopItem(c as unknown as Record<string, unknown>))

const COOPERATIONS_QUERY_KEY = (pubkey: string) => ['cooperations', pubkey] as const

async function fetchCooperationsRaw(pubkey: string): Promise<Cooperation[]> {
  // first=100 (the server cap in parsePagination): consumers use this list for
  // badge/KPI counts, so the default page size of 20 would silently under-count.
  const res = await apiCall(`/api/cooperations?pubkey=${pubkey}&first=100`)
  const data = await res.json()
  return data.cooperations ?? []
}

export function useCooperations(pubkey: string) {
  return useQuery({
    queryKey: COOPERATIONS_QUERY_KEY(pubkey),
    queryFn: () => fetchCooperationsRaw(pubkey),
    enabled: Boolean(pubkey),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
    select: coopListToCoopItems,
  })
}

export function useApplications(pubkey: string) {
  return useQuery({
    queryKey: ['applications', pubkey],
    queryFn: async (): Promise<unknown[]> => {
      const res = await apiCall(`/api/cooperations/applications/mine?pubkey=${pubkey}`)
      const data = await res.json()
      return data.applications ?? []
    },
    enabled: Boolean(pubkey),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
}

export function useOffers(pubkey: string) {
  return useQuery({
    queryKey: ['offers', pubkey],
    queryFn: async (): Promise<unknown[]> => {
      // offerType=COOP: dedicated Prisma enum value for network cooperations
      // created via the Coop Guide (see useCoopForm.buildPayload). The former
      // filter, category=Cooperation, was stale after the ADR-078 category
      // slug migration ('Cooperation' -> 'services') and never matched anything.
      const res = await apiCall(`/api/offers?creatorPubkey=${pubkey}&offerType=COOP`)
      const data = await res.json()
      return data.offers ?? []
    },
    enabled: Boolean(pubkey),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
}

// ADR-363 D1: re-implemented as a derived view over the unified listing feed.
// Home's Marketplace slider, BuyProductDetail's and CoopDetail's sibling
// sliders all read the same ['listings', 'marketplace', {}] entry that /buy
// and /search mount, instead of the old 30-row /api/offers window — one data
// source, one cache entry, one invalidation family. Consumers only read
// `data`/`isLoading`, which this wrapper preserves.
export function useAllOffers() {
  // ADR-363 review fix: restore the pre-D1 5-minute self-refresh for Home's
  // sliders via the feed's optional refetchInterval (the old useAllOffers
  // polled every 5 min; the bare feed does not poll to avoid re-fetching every
  // loaded page on /buy's infinite scroll). Home is the only mount of this
  // key, so the interval applies only while the Home route is active.
  // autoPrefetchNextPage:false (review fix 2026-09-02) — a slider never loads
  // more pages, so the next-page prefetch must not walk the whole catalog.
  const feed = useListingFeed({}, 100, { refetchInterval: 5 * 60_000, autoPrefetchNextPage: false })
  return {
    data: feed.hits,
    isLoading: feed.isLoading,
    isError: feed.isError,
    error: feed.error,
    isFetching: feed.query.isFetching,
    refetch: feed.query.refetch,
    query: feed.query,
  }
}

// ADR-421: the visitor's own country, fetched server-side. Home's Nearby/Region
// tabs filter in the browser, and the global newest-100 window (useAllOffers) is
// dominated by foreign listings, so without this the visitor's local offers
// never reach those tabs. Same canonical ['listings','marketplace', {country}]
// entry /search and /buy mount for a country scope, so the "see all" link lands
// on a warm cache. Disabled (and never loading) without a valid country.
export function useCountryOffers(country: string) {
  const feed = useListingFeed(country ? { country } : {}, 100, {
    refetchInterval: 5 * 60_000,
    autoPrefetchNextPage: false,
    enabled: Boolean(country),
  })
  return { data: feed.hits, isLoading: feed.isLoading, isError: feed.isError }
}

// Live count of offers ingested from the wider Nostr network (ADR-145), not
// just Colabonate's own listings. `first=1` keeps the row payload minimal —
// only `totalCount` (a real Prisma count(), same as every other paginated
// list endpoint) is used.
// ADR-334 D4: superseded by useEcosystemStats().data?.remoteOffers — kept as
// a thin deprecated wrapper for any consumer that hasn't migrated (Home has).
export function useRemoteOfferCount() {
  return useQuery({
    queryKey: ['remote-offer-count'],
    queryFn: async (): Promise<number> => {
      const res = await apiCall('/api/offers?source=REMOTE&status=ACTIVE&first=1&includeCount=true')
      const data = await res.json()
      return data.totalCount ?? 0
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  })
}

// ── ADR-334: ecosystem stats (single KPI source-of-truth) ──────────────────

export interface EcosystemStats {
  offers: {
    total: number
    products: number
    services: number
    agents: number
    totalSats: number
  }
  providers: number
  vendors: number
  cooperations: {
    total: number
    open: number
    tenders: number
    projects: number
    network: number
    // ADR-368 D4 (FU-659): unwindowed count of OPEN Service Bundles
    // (cooperationType === 'SERVICE'). projects now excludes these.
    service: number
    totalBudgetSats: number
    openBudgetSats: number
  }
  remoteOffers: number
}

export const ECOSYSTEM_STATS_KEY = ['ecosystem-stats'] as const

/**
 * ADR-334 D2: server-aggregated ecosystem totals behind one query. KPI strips
 * (Home marketplaceKpiItems, CoopExplore kpiItems, /search coop context)
 * consume this instead of deriving counts from windowed result sets
 * (useAllOffers 30-cap, useOfferSearch 100-cap, useCoopExploreData 100/source).
 * Result lists keep their windows — only the headline numbers become honest.
 */
export function useEcosystemStats() {
  return useQuery({
    queryKey: ECOSYSTEM_STATS_KEY,
    queryFn: async (): Promise<EcosystemStats> => {
      const res = await apiCall('/api/stats')
      if (!res.ok) throw new Error('Failed to fetch ecosystem stats')
      return res.json()
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  })
}

// Type-filtered sibling of useAllOffers, re-implemented over the unified
// listing feed (ADR-363 D1): the segment pools (SERVICE/PRODUCT/COOP) source
// from /api/search with a server-side offerType filter — the same endpoint
// and cache family the marketplace browse uses — so a type can never be empty
// while /buy lists plenty (the ADR-297 divergence class). Same full-row shape
// as the feed returns.
export function useOffersByType(offerType: 'SERVICE' | 'PRODUCT' | 'COOP' | 'AGENT_SETUP', first = 100) {
  // Same 5-minute self-refresh as useAllOffers (ADR-363 review fix); no
  // next-page auto-prefetch — the segment pools are sliders, not scroll feeds.
  const feed = useListingFeed({ offerType }, first, { refetchInterval: 5 * 60_000, autoPrefetchNextPage: false })
  return {
    data: feed.hits,
    isLoading: feed.isLoading,
    isError: feed.isError,
    error: feed.error,
    isFetching: feed.query.isFetching,
    refetch: feed.query.refetch,
    query: feed.query,
  }
}

export function useCooperation(coopId: string) {
  return useQuery({
    queryKey: ['cooperation', coopId],
    queryFn: async (): Promise<Cooperation> => {
      const res = await apiCall(`/api/cooperations/${coopId}`)
      const data = await res.json()
      if (!data.cooperation) throw new Error('Cooperation not found')
      return data.cooperation
    },
    enabled: Boolean(coopId),
    staleTime: 60_000,
  })
}

// Shared fetchers so prefetch (usePrefetchOfferDetail) and the useQuery hooks
// below stay in sync — same endpoint, same shape, defined once.
async function fetchOffer(offerId: string): Promise<Offer> {
  const res = await apiCall(`/api/offers/${offerId}`)
  const data = await res.json()
  if (!data.offer) throw new Error('Offer not found')
  return data.offer
}

async function fetchVendorOffers(pubkey: string): Promise<Offer[]> {
  const res = await apiCall(`/api/offers?creatorPubkey=${pubkey}`)
  const data = await res.json()
  return data.offers ?? []
}

async function fetchCompany(id: string): Promise<Company | null> {
  const res = await apiCall(`/api/company/${id}`)
  const data = await res.json()
  return data.company ?? null
}

export function useOffer(offerId: string) {
  return useQuery({
    queryKey: ['offer', offerId],
    queryFn: () => fetchOffer(offerId),
    enabled: Boolean(offerId),
    staleTime: 60_000,
    // ADR-188: keep the previous offer rendered while the next one resolves
    // so the slider + page header stay mounted (no flicker on sibling click).
    placeholderData: keepPreviousData,
  })
}

/**
 * Warm the TanStack cache for a product-detail navigation before the user
 * clicks — eliminates the offer→vendor-offers waterfall on BuyProductDetail.
 * Returns a stable callback; callers wire it to onMouseEnter / onFocus on the
 * marketplace card. Both prefetches are idempotent (React Query dedupes by
 * queryKey + staleTime), and vendor-offers self-dedupes across cards that
 * share the same seller.
 */
export function usePrefetchOfferDetail() {
  const queryClient = useQueryClient()
  return useCallback(
    (offer: Pick<Offer, 'id' | 'creatorPubkey'>) => {
      queryClient.prefetchQuery({
        queryKey: ['offer', offer.id],
        queryFn: () => fetchOffer(offer.id),
        staleTime: 60_000,
      })
      if (offer.creatorPubkey) {
        queryClient.prefetchQuery({
          queryKey: ['vendor-offers', offer.creatorPubkey],
          queryFn: () => fetchVendorOffers(offer.creatorPubkey),
          staleTime: POLL_INTERVAL,
        })
      }
    },
    [queryClient],
  )
}

/**
 * Hover-intent prefetch handlers for a marketplace card. A 100ms timer debounces
 * the request storm from sweeping a dense grid; cancelled on mouse-leave and on
 * id/creatorPubkey change (the timer is cleared whenever the card re-binds to a
 * new offer so a stale prefetch never fires). Focus prefetches immediately.
 */
export function usePrefetchHandlers(id: string, creatorPubkey: string) {
  const prefetch = usePrefetchOfferDetail()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [id, creatorPubkey])
  return useMemo(
    () => ({
      onMouseEnter: () => {
        timerRef.current = setTimeout(() => prefetch({ id, creatorPubkey }), 100)
      },
      onMouseLeave: () => {
        if (timerRef.current) clearTimeout(timerRef.current)
      },
      onFocus: () => prefetch({ id, creatorPubkey }),
    }),
    [prefetch, id, creatorPubkey],
  )
}

/**
 * Hover-intent prefetch handlers for a vendor card. Mirrors the offer-card
 * prefetch pattern: debounced mouse-enter, cancelled on leave, immediate focus.
 * Warms the vendor detail query (`['company', ownerPubkey]`) and the vendor's
 * offer list (`['vendor-offers', ownerPubkey]`).
 */
export function useVendorPrefetchHandlers(ownerPubkey: string) {
  const queryClient = useQueryClient()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [ownerPubkey])

  const prefetch = useCallback(() => {
    queryClient.prefetchQuery({
      queryKey: ['company', ownerPubkey],
      queryFn: () => fetchCompany(ownerPubkey),
      staleTime: POLL_INTERVAL,
    })
    queryClient.prefetchQuery({
      queryKey: ['vendor-offers', ownerPubkey],
      queryFn: () => fetchVendorOffers(ownerPubkey),
      staleTime: POLL_INTERVAL,
    })
  }, [queryClient, ownerPubkey])

  return useMemo(
    () => ({
      onMouseEnter: () => {
        timerRef.current = setTimeout(() => prefetch(), 100)
      },
      onMouseLeave: () => {
        if (timerRef.current) clearTimeout(timerRef.current)
      },
      onFocus: () => prefetch(),
    }),
    [prefetch],
  )
}

export function invalidateCooperations(queryClient: ReturnType<typeof useQueryClient>, pubkey: string) {
  queryClient.invalidateQueries({ queryKey: ['cooperations', pubkey] })
}

export function invalidateApplications(queryClient: ReturnType<typeof useQueryClient>, pubkey: string) {
  queryClient.invalidateQueries({ queryKey: ['applications', pubkey] })
}

export function invalidateOffers(queryClient: ReturnType<typeof useQueryClient>, pubkey: string) {
  queryClient.invalidateQueries({ queryKey: ['offers', pubkey] })
}

// ADR-376 D1/D2: `first` folded into the query key so this hook can serve
// every current caller (Home's slider, useCoopExploreData's coop-context
// browse) from ONE shared cache entry as long as they agree on the same cap
// — both are standardized to 100 (see Home.tsx + useCoopExploreData.ts),
// so in practice there is exactly one live key, `['cooperations-discover',
// '', 100]`, instead of the previous two disjoint ['cooperations-discover',
// ''] (Home, first=50) and an embedded, un-keyed first=100 fetch buried
// inside useCoopExploreData's Promise.all.
// ADR-376 D5: exported as a standalone `queryOptions()`-shaped object (not
// just inlined in the hook below) so `queryClient.prefetchQuery(
// cooperationsDiscoverQueryOptions(...))` can warm this exact cache entry
// imperatively — from Home's mount effect and from the Navbar's Cooperate-tab
// hover — without needing a mounted React component. Same pattern this
// codebase already uses for `fetchOfferSearch`/`fetchCoopExploreData`
// (ADR-324 D4).
export function cooperationsDiscoverQueryOptions(query: string, first = 100) {
  return {
    queryKey: ['cooperations-discover', query, first] as const,
    queryFn: async (): Promise<CoopItem[]> => {
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      params.set('first', String(first))
      const res = await apiCall(`/api/cooperations/discover?${params.toString()}`)
      const data = await res.json()
      return (data.cooperations ?? []).map(coopToCoopItem)
    },
    staleTime: 15_000,
  }
}

// `refetchInterval` stays opt-in (undefined = no periodic refetch, the
// pre-existing behavior for every caller before Home) — Home passes its own
// POLL_INTERVAL to preserve the 30 s self-refresh its old inline query had;
// CoopDetail and useCoopExploreData deliberately don't poll this source on a
// timer (refetchOnWindowFocus/refetchOnMount + the 15 s staleTime already
// keep it reasonably fresh, and useCoopExploreData additionally gets
// invalidated by every coop mutation per ADR-376 D4).
export function useCooperationsDiscover(query: string, enabled = true, first = 100, refetchInterval?: number) {
  return useQuery({
    ...cooperationsDiscoverQueryOptions(query, first),
    enabled,
    refetchInterval,
  })
}

// Network-type cooperations: discover published Offer records (offerType=COOP)
// the same way useCooperationsDiscover browses the Cooperation model for
// projects/tenders. GET /api/offers has no free-text search, so filtering by
// query is done client-side.
export function useNetworkOffersDiscover(query: string, enabled = true) {
  return useQuery({
    queryKey: ['network-offers-discover', query],
    queryFn: async (): Promise<CoopItem[]> => {
      const res = await apiCall('/api/offers?offerType=COOP&status=ACTIVE&first=100')
      const data = await res.json()
      const items = ((data.offers ?? []) as Record<string, unknown>[]).map(offerToCoopItem)
      const q = query.trim().toLowerCase()
      if (!q) return items
      return items.filter(i =>
        i.title.toLowerCase().includes(q) || (i.description ?? '').toLowerCase().includes(q)
      )
    },
    enabled,
    staleTime: 15_000,
  })
}

// ADR-212: network membership (Offer.offerType=COOP). Fetches all membership
// rows for a network — the frontend derives "my status" / member list /
// pending-requests-for-review from this one small dataset.
export interface OfferMember {
  id: string
  offerId: string
  pubkey: string
  status: 'PENDING' | 'ACTIVE' | 'DECLINED' | 'REMOVED'
  message: string | null
  createdAt: string
  updatedAt: string
}

export function useOfferMembers(offerId: string, enabled = true) {
  return useQuery({
    queryKey: ['offer-members', offerId],
    queryFn: async (): Promise<OfferMember[]> => {
      const res = await apiCall(`/api/offers/${offerId}/members`)
      const data = await res.json()
      return data.members ?? []
    },
    enabled: enabled && Boolean(offerId),
    staleTime: 10_000,
  })
}

export function invalidateOfferMembers(queryClient: ReturnType<typeof useQueryClient>, offerId: string) {
  queryClient.invalidateQueries({ queryKey: ['offer-members', offerId] })
}

interface ManagedOfferRow {
  id: string
  title: string
  description?: string | null
  budgetSats?: number
  status?: string
  createdAt?: string
  cooperationType?: string | null
  images?: string[] | null
  initiatorPubkey?: string
  partnerPubkey?: string | null
  // ADR-331 D1/D5.1 — CoopManageView reads these off the same cached
  // `['cooperations', pubkey]` response (see useManagedOffers below) via the
  // Cooperation → ManagedOfferRow select. Keeping the type projection
  // additive; new fields show as undefined for legacy rows.
  isAgentOrchestration?: boolean
  agentSupervision?: 'human' | 'autonomous' | null
  // Mirrors Cooperation.milestones — used by CoopManageView's executor-kind
  // chip row counts (all/human/agent) and by any future per-row capability
  // affordance.
  milestones?: Array<{
    id: string
    milestoneIndex: number
    title: string
    amountSats: number
    status: string
    assigneeAgentProfileId?: string | null
    requiredCapabilities?: string[] | null
  }>
}

export function useManagedOffers(pubkey: string) {
  // ADR-206 FU-206-D: derives from the canonical `['cooperations', pubkey]`
  // raw cache (ManagedOfferRow is a strict subset of Cooperation, same API
  // response) instead of issuing a separate identical request.
  return useQuery({
    queryKey: COOPERATIONS_QUERY_KEY(pubkey),
    queryFn: () => fetchCooperationsRaw(pubkey),
    enabled: Boolean(pubkey),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
    select: (coops: Cooperation[]) => coops as unknown as ManagedOfferRow[],
  })
}

export function invalidateManagedOffers(queryClient: ReturnType<typeof useQueryClient>, pubkey: string) {
  // Repointed to the canonical cache key (FU-206-D).
  queryClient.invalidateQueries({ queryKey: COOPERATIONS_QUERY_KEY(pubkey) })
}

export function useCooperationsForProjects(pubkey: string) {
  // ADR-206 FU-206-D: derives from the canonical `['cooperations', pubkey]`
  // raw cache (identical data) instead of a separate request.
  return useQuery({
    queryKey: COOPERATIONS_QUERY_KEY(pubkey),
    queryFn: () => fetchCooperationsRaw(pubkey),
    enabled: Boolean(pubkey),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
}

export function useUserProductOffers(pubkey: string) {
  return useQuery({
    queryKey: ['user-product-offers', pubkey],
    queryFn: async (): Promise<Offer[]> => {
      const res = await apiCall(`/api/offers?creatorPubkey=${pubkey}`)
      const data = await res.json()
      return ((data.offers ?? []) as Offer[]).filter(o => o.offerType === 'PRODUCT' || o.offerType === 'ITEM')
    },
    enabled: Boolean(pubkey),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
}

export function useUserServiceOffers(pubkey: string) {
  return useQuery({
    queryKey: ['user-service-offers', pubkey],
    queryFn: async (): Promise<Offer[]> => {
      const res = await apiCall(`/api/offers?creatorPubkey=${pubkey}&offerType=SERVICE`)
      const data = await res.json()
      return data.offers ?? []
    },
    enabled: Boolean(pubkey),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
}

export function useUserAgentOffers(pubkey: string) {
  return useQuery({
    queryKey: ['user-agent-offers', pubkey],
    queryFn: async (): Promise<Offer[]> => {
      const res = await apiCall(`/api/offers?creatorPubkey=${pubkey}&offerType=AGENT_SETUP`)
      const data = await res.json()
      return data.offers ?? []
    },
    enabled: Boolean(pubkey),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
}

export function useUserAllOffers(pubkey: string) {
  return useQuery({
    queryKey: ['user-all-offers', pubkey],
    queryFn: async (): Promise<Offer[]> => {
      const res = await apiCall(`/api/offers?creatorPubkey=${pubkey}`)
      const data = await res.json()
      return data.offers ?? []
    },
    enabled: Boolean(pubkey),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
}

// ADR-422: the viewer's own ACTIVE offers for Home's "My Offers" tab and KPI tiles.
// Owner-scoped on the server (the global newest-100 window never contains an
// older seller's listings) and slim (`imageThumbs` instead of the raw base64
// `images`, measured 18.6 MB for one account without it). `totalCount` is the
// real count, not the page length.
export interface MyOfferSlim {
  id: string
  title: string
  priceSats: number
  categoryCode: string
  offerType?: string
  creatorPubkey: string
  imageThumbs?: string[]
  publishedAt?: string | null
}

export function useMyActiveOffersSlim(pubkey: string) {
  return useQuery({
    queryKey: ['user-active-offers-slim', pubkey],
    queryFn: async (): Promise<{ offers: MyOfferSlim[]; total: number }> => {
      const res = await apiCall(`/api/offers?creatorPubkey=${pubkey}&status=ACTIVE&slim=1&first=100&includeCount=true`)
      const data = await res.json()
      const offers: MyOfferSlim[] = data.offers ?? []
      return { offers, total: typeof data.totalCount === 'number' ? data.totalCount : offers.length }
    },
    enabled: Boolean(pubkey),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
}

export function invalidateUserOffers(queryClient: ReturnType<typeof useQueryClient>, pubkey: string) {
  queryClient.invalidateQueries({ queryKey: ['user-active-offers-slim', pubkey] })
  queryClient.invalidateQueries({ queryKey: ['user-product-offers', pubkey] })
  queryClient.invalidateQueries({ queryKey: ['user-service-offers', pubkey] })
  queryClient.invalidateQueries({ queryKey: ['user-agent-offers', pubkey] })
  queryClient.invalidateQueries({ queryKey: ['user-all-offers', pubkey] })
}

export function useUserTickets(pubkey: string) {
  return useQuery({
    queryKey: ['user-tickets', pubkey],
    queryFn: async (): Promise<Ticket[]> => {
      const res = await apiCall(`/api/tickets?pubkey=${pubkey}`)
      const data = await res.json()
      return Array.isArray(data.tickets) ? data.tickets : []
    },
    enabled: Boolean(pubkey),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
}

export function invalidateUserTickets(queryClient: ReturnType<typeof useQueryClient>, pubkey: string) {
  queryClient.invalidateQueries({ queryKey: ['user-tickets', pubkey] })
}

export function useStandardCategories() {
  return useQuery({
    queryKey: ['standard-categories'],
    queryFn: async (): Promise<StandardCategory[]> => {
      const res = await apiCall('/api/standard-categories/tree/flat')
      const data = await res.json()
      return data.standardCategories ?? []
    },
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
}

// ADR-376 D1/D5: exported for the same imperative-prefetch reason as
// `cooperationsDiscoverQueryOptions` — CoopDockSection's dock-approach
// prefetch warms this exact entry (shared with BuyDashboard's Vendors tab
// and useCoopExploreData's coop-context Partners/Vendors pool).
export function companiesQueryOptions() {
  return {
    queryKey: ['companies'] as const,
    queryFn: async (): Promise<Company[]> => {
      const res = await apiCall('/api/companies?first=100')
      const data = await res.json()
      return data.edges?.map((e: { node: Company }) => e.node) ?? []
    },
    staleTime: POLL_INTERVAL,
  }
}

export function useCompanies() {
  return useQuery({
    ...companiesQueryOptions(),
    refetchInterval: POLL_INTERVAL,
  })
}

export function useCompany(id: string) {
  return useQuery({
    queryKey: ['company', id],
    queryFn: () => fetchCompany(id),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
}

// ADR-180: Company lookup by Company.id (for /c/:companyId route).
// Distinct from useCompany(), which is keyed by ownerPubkey.
export function useCompanyById(id: string) {
  return useQuery({
    queryKey: ['company-by-id', id],
    queryFn: async (): Promise<Company | null> => {
      const res = await apiCall(`/api/company/by-id/${id}`)
      const data = await res.json()
      return data.company ?? null
    },
    enabled: Boolean(id),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
}

export function useEntity(id: string) {
  return useQuery({
    queryKey: ['entity', id],
    queryFn: async (): Promise<{ type: 'cooperation' | 'offer', data: Cooperation | Offer }> => {
      try {
        const resCoop = await apiCall(`/api/cooperations/${id}`)
        if (resCoop.ok) {
          const data = await resCoop.json()
          if (data.cooperation) return { type: 'cooperation', data: data.cooperation }
        }
      } catch {}

      try {
        const resOffer = await apiCall(`/api/offers/${id}`)
        if (resOffer.ok) {
          const data = await resOffer.json()
          if (data.offer) return { type: 'offer', data: data.offer }
        }
      } catch {}

      throw new Error('Entity not found')
    },
    enabled: Boolean(id),
    staleTime: 60_000,
    refetchInterval: POLL_INTERVAL,
    // ADR-188: keep the previous entity rendered while the next one resolves
    // so the slider + page header stay mounted (no flicker on sibling click).
    placeholderData: keepPreviousData,
  })
}

export function useVendorOffers(pubkey: string) {
  return useQuery({
    queryKey: ['vendor-offers', pubkey],
    queryFn: () => fetchVendorOffers(pubkey),
    enabled: Boolean(pubkey),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
}

export function useCategoryProducts(categorySlug: string) {
  return useQuery({
    queryKey: ['category-products', categorySlug],
    queryFn: async (): Promise<{ category: StandardCategory | null; offers: Offer[] }> => {
      const [catRes, offersRes] = await Promise.all([
        apiCall(`/api/standard-categories/${categorySlug}`).then(r => r.json()).catch(() => ({ category: null })),
        apiCall('/api/offers').then(r => r.json()),
      ])
      const category = catRes.category ?? null
      const allOffers = offersRes.offers ?? []
      const filtered = category
        ? allOffers.filter((o: Offer) => o.categoryCode?.startsWith(categorySlug))
        : []
      return { category, offers: filtered }
    },
    enabled: Boolean(categorySlug),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
}

export interface CategoryCountParams {
  offerType?: string
  country?: string
  q?: string
}

export function useCategoryCounts(params: CategoryCountParams = {}) {
  return useQuery({
    queryKey: ['category-counts', params],
    queryFn: async (): Promise<Record<string, number>> => {
      const queryParams = new URLSearchParams()
      if (params.offerType) queryParams.set('offerType', params.offerType)
      if (params.country) queryParams.set('country', params.country)
      if (params.q) queryParams.set('q', params.q)
      const qs = queryParams.toString()
      const res = await apiCall(`/api/offers/count-by-category${qs ? `?${qs}` : ''}`)
      const data = await res.json()
      const counts: Record<string, number> = {}
      for (const c of data.counts ?? []) {
        counts[c.categoryCode] = c._count
      }
      return counts
    },
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
}

export function useTicket(ticketId: string) {
  return useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: async (): Promise<Ticket> => {
      const res = await apiCall(`/api/tickets/${ticketId}`)
      if (!res.ok) throw new Error('Failed to fetch ticket')
      const data = await res.json()
      return data.ticket || data
    },
    enabled: !!ticketId,
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
}

// ADR-204: fetch the ticket for a cooperation (by cooperationId).
// The ticket is created by fund-escrow and tracks the cooperation's funding state.
export function useCooperationTicket(cooperationId: string) {
  return useQuery({
    queryKey: ['coop-ticket', cooperationId],
    queryFn: async (): Promise<Ticket | null> => {
      const res = await apiCall(`/api/tickets?cooperationId=${cooperationId}`)
      if (!res.ok) throw new Error('Failed to fetch cooperation ticket')
      const data = await res.json()
      return data.tickets?.[0] ?? null
    },
    enabled: !!cooperationId,
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
}

export function useDispute(disputeId: string) {
  return useQuery({
    queryKey: ['dispute', disputeId],
    queryFn: async () => {
      const res = await apiCall(`/api/disputes/${disputeId}`)
      if (!res.ok) throw new Error('Failed to fetch dispute')
      return res.json()
    },
    enabled: !!disputeId,
  })
}

export function useDaoProposal(daoId: string, proposalId: string) {
  return useQuery({
    queryKey: ['daoProposal', daoId, proposalId],
    queryFn: async () => {
      const res = await apiCall(`/api/daos/${daoId}/proposals/${proposalId}`)
      if (!res.ok) throw new Error('Failed to fetch dao proposal')
      const data = await res.json()
      return data.proposal || data
    },
    enabled: !!daoId && !!proposalId,
  })
}

export function useCooperationTemplate(templateId: string) {
  return useQuery({
    queryKey: ['cooperationTemplate', templateId],
    queryFn: async () => {
      if (templateId === 'new') return null
      const res = await apiCall(`/api/cooperation-templates/${templateId}`)
      if (!res.ok) throw new Error('Failed to fetch cooperation template')
      const data = await res.json()
      return data.template || data
    },
    enabled: !!templateId,
  })
}

// ADR-340 FU-541: the legacy `/api/catalog/categories/:id` endpoint was
// removed in ADR-078 (Vendor Category CRUD dropped — Products use
// standardCategoryId directly). The corresponding SellCategoryDetail route
// is now a no-op (POST/PATCH 404); the query is hard-resolved to null here
// so callers don't keep hitting a 404 every render. Out of scope to delete
// the dead route — keep this as a cheap null-return to satisfy consumers.
export function useCatalogCategory(_categoryId: string) {
  return useQuery({
    queryKey: ['catalogCategory', _categoryId],
    queryFn: async () => null,
    enabled: false,
  })
}

export function useIdentity(pubkey: string) {
  return useQuery({
    queryKey: ['identity', pubkey],
    queryFn: async () => {
      try {
        const res = await apiCall(`/api/identity/${pubkey}`)
        return res.json()
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
    },
    enabled: !!pubkey,
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
}

export function useWalletTransactions(pubkey: string) {
  return useQuery({
    queryKey: ['wallet-transactions', pubkey],
    queryFn: async (): Promise<import('../types/api').Transaction[]> => {
      const res = await apiCall(`/api/wallet/transactions?pubkey=${pubkey}`)
      const data = await res.json()
      return data.transactions ?? []
    },
    enabled: Boolean(pubkey),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
}

export function useWalletTickets(pubkey: string) {
  return useQuery({
    queryKey: ['wallet-tickets', pubkey],
    queryFn: async (): Promise<Ticket[]> => {
      const res = await apiCall('/api/tickets')
      const data = await res.json()
      return data.tickets ?? []
    },
    enabled: Boolean(pubkey),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
}

export interface SubWalletEntry {
  offerId: string
  offerTitle: string
  subWalletId: string | null
  latestTicket: {
    id: string
    escrowStatus: string | null
    visibility: string | null
    status: string
  } | null
}

export interface SubWalletQueryResult {
  subWallets: SubWalletEntry[]
  total: number
  warning: boolean
  limitReached: boolean
}

export function useSubWallets(pubkey: string) {
  return useQuery({
    queryKey: ['sub-wallets', pubkey],
    queryFn: async (): Promise<SubWalletQueryResult> => {
      const res = await apiCall(`/api/wallet/sub-wallets?pubkey=${pubkey}`)
      const data = await res.json()
      return {
        subWallets: data.subWallets ?? [],
        total: data.total ?? 0,
        warning: data.warning ?? false,
        limitReached: data.limitReached ?? false,
      }
    },
    enabled: Boolean(pubkey),
    staleTime: 60_000,
  })
}

// ── Sell module ───────────────────────────────────────────────────────────────

export interface CatalogWithProducts extends Catalog {
  standardCategory?: { id: string; name: string; slug: string; offerType?: string } | null
}

/** ADR-340 D6: returns the caller's own PRODUCT + AGENT_SETUP catalogs via
 *  the unified `?mine=1` endpoint. Also resolves the caller's primary
 *  Company for legacy callers that still need `company.id` (PRODUCT catalog
 *  creation gate). */
export function useUserCatalogs(pubkey: string) {
  return useQuery({
    queryKey: ['user-catalogs', pubkey],
    queryFn: async (): Promise<{ catalogs: CatalogWithProducts[]; company: Company | null }> => {
      // The Company lookup is still useful for the CreateCatalog type=PRODUCT
      // picker (one Company → one PRODUCT catalog root). For agent-setup
      // callers without a Company, we still get their AGENT_SETUP catalogs.
      const companyRes = await apiCall(`/api/company/${pubkey}`).then(r => r.json()).catch(() => ({}))
      const companyData = Array.isArray(companyRes.company) ? companyRes.company[0] : companyRes.company
      const catRes = await apiCall(`/api/catalog?mine=1`).then(r => r.json())
      return { catalogs: catRes.catalogs ?? [], company: companyData || null }
    },
    enabled: Boolean(pubkey),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
}

export interface ProductWithCatalogName {
  id: string
  name: string
  /** ADR-395: null = company product without a catalog. */
  catalogId: string | null
  catalogName: string
  isAvailable: boolean
  createdAt: string
  priceSats?: number | null
  images?: any
  standardCategory?: { id: string; name: string; slug: string; offerType?: string } | null
  // ADR-277 D-6: derived union of gammaTags across this product's offers (backfill +
  // sync-on-offer-publish, see apps/server/services/gamma-category-map.ts).
  gammaTags?: string[]
  [key: string]: unknown
}

/** Returns all products across every catalog owned by `pubkey`.
 *  Keyed so data survives tab switches (stale-while-revalidate). */
export function useCompanyProducts(pubkey: string) {
  return useQuery({
    queryKey: ['company-products', pubkey],
    queryFn: async (): Promise<{ products: ProductWithCatalogName[]; catalogCount: number }> => {
      const companyRes = await apiCall(`/api/company/${pubkey}`).then(r => r.json()).catch(() => ({}))
      const companyData = Array.isArray(companyRes.company) ? companyRes.company[0] : companyRes.company
      if (!companyData?.id) return { products: [], catalogCount: 0 }
      // ADR-340 FU-541: use the new bulk endpoint instead of an N+1 fan-out.
      const res = await apiCall(`/api/catalog/company/${companyData.id}/products`).then(r => r.json()).catch(() => ({}))
      const products: Array<ProductWithCatalogName & { catalog: { id: string; name: string } | null }> = res.products ?? []
      return {
        products: products.map(p => ({ ...p, catalogName: p.catalog?.name ?? '' })),
        catalogCount: new Set(products.map(p => p.catalogId).filter(Boolean)).size,
      }
    },
    enabled: Boolean(pubkey),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
  })
}

