import { useCallback, useEffect, useRef } from 'react'
import { useQuery, useInfiniteQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { apiCall } from '../lib/api'
import type { Offer } from '../types/api'

export interface SearchParams {
  q?: string
  offerType?: string
  country?: string
  categoryCode?: string
  language?: string
  sort?: string
  companyId?: string
  creatorPubkey?: string
  // ADR-313 D2: AGENT_SETUP-only filters.
  capability?: string[]
  minReputation?: number
  agentBillingModel?: string
  // ADR-370 D6 (Phase 2, FU-671): collaboration-canvas provider filter
  // ('doop-local' | 'doop-hosted').
  canvasProvider?: string
}

export interface SearchResult {
  hits: Offer[]
  estimatedTotalHits: number
  processingTimeMs: number
  // ADR-335 D1/D2: additive — old clients ignore it, new clients (D3 below)
  // use it to paginate past the 100-row cap. Absent on responses served
  // before this field existed (defensive-optional, never assumed present).
  pageInfo?: { hasNextPage: boolean; endCursor: string | null }
  // ADR-403: Meili facet distribution (also emitted by the DB fallback for
  // offerType). `offerType` powers the /search subtab counts + auto-switch.
  facetDistribution?: Record<string, Record<string, number>>
}

const POLL_INTERVAL = Number(import.meta.env.VITE_POLL_INTERVAL_MS) || 30_000

// Shared query-string serializer for the /api/search filter set. Used by the
// list fetcher and the ADR-418 facets fetcher so both speak the same filter
// vocabulary. Callers append their own paging params (first/after).
function serializeSearchParams(params: SearchParams): URLSearchParams {
  const queryParams = new URLSearchParams()
  if (params.q) queryParams.set('q', params.q)
  if (params.offerType) queryParams.set('offerType', params.offerType)
  if (params.country) queryParams.set('country', params.country)
  if (params.categoryCode) queryParams.set('categoryCode', params.categoryCode)
  if (params.language) queryParams.set('language', params.language)
  if (params.sort) queryParams.set('sort', params.sort)
  if (params.companyId) queryParams.set('companyId', params.companyId)
  if (params.creatorPubkey) queryParams.set('creatorPubkey', params.creatorPubkey)
  if (params.capability) params.capability.forEach(c => queryParams.append('capability', c))
  if (params.minReputation !== undefined) queryParams.set('minReputation', String(params.minReputation))
  if (params.agentBillingModel) queryParams.set('agentBillingModel', params.agentBillingModel)
  if (params.canvasProvider) queryParams.set('canvasProvider', params.canvasProvider)
  return queryParams
}

// Shared fetcher, exported so the Home dock prefetch (ADR-324 D4) warms
// exactly the cache entry useOfferSearch reads.
//
// ADR-334 D6 follow-up (FU-522): /api/search already returns estimatedTotalHits
// (the filter-aware total count, NOT the 100-cap on `take` — computed via
// prisma.offer.count({ where }) in parallel with the findMany). We return it
// to callers now so KPI strips show the real total, not the 100-row window
// they loaded.
export async function fetchOfferSearch(params: SearchParams, first = 20, after?: string): Promise<SearchResult> {
  const queryParams = serializeSearchParams(params)
  queryParams.set('first', String(first))
  if (after) queryParams.set('after', after)

  const res = await apiCall(`/api/search?${queryParams.toString()}`)
  if (!res.ok) throw new Error('Search failed')
  return (await res.json()) as SearchResult
}

// ADR-418 D1/D3: server-side facet counts for the Location filter. The country
// facet is disjunctive: it is counted with every filter EXCEPT country, so the
// option list does not collapse when a country is selected.
export interface SearchFacets {
  country: Record<string, number>
  countryless: number
  total: number
}

// Returns a copy of the params without `country` (the disjunctive facet axis).
export function withoutCountry(params: SearchParams): SearchParams {
  const next = { ...params }
  delete next.country
  return next
}

// Query key for the facet cache entry. `country` is excluded on purpose:
// choosing a country must neither refetch nor re-key the option list.
export function searchFacetsQueryKey(params: SearchParams) {
  return ['search-facets', withoutCountry(params)] as const
}

export async function fetchSearchFacets(params: SearchParams): Promise<SearchFacets> {
  const queryParams = serializeSearchParams(withoutCountry(params))
  const res = await apiCall(`/api/search/facets?${queryParams.toString()}`)
  if (!res.ok) throw new Error('Search facets failed')
  return (await res.json()) as SearchFacets
}

// ADR-418 D3: no refetchInterval (the list feed has none either, ADR-335).
export function useSearchFacets(params: SearchParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: searchFacetsQueryKey(params),
    queryFn: () => fetchSearchFacets(params),
    staleTime: POLL_INTERVAL,
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
  })
}

// Flat-shape return: spreads the most-used fields (hits + total + loading state)
// without forcing callers to dig into `query.data` + nested `data.hits`. The
// full TanStack Query result is still available via `query` for advanced use
// cases (refetch, isFetching, placeholderData).
export function useOfferSearch(params: SearchParams, first = 20) {
  const query = useQuery({
    queryKey: ['offer-search', params],
    queryFn: () => fetchOfferSearch(params, first),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
    placeholderData: keepPreviousData,
  })
  return {
    query,
    hits: query.data?.hits ?? [],
    total: query.data?.estimatedTotalHits ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  } as const
}

// ADR-363 D2: dedup across pages by offer id. Meilisearch paginates by a
// plain offset cursor (routes/search.ts), so when the outbox worker indexes a
// new offer between two page loads the offset shifts and the same id can
// appear on two consecutive pages. First occurrence wins, order preserved.
// This is the load-bearing display layer: the server-side keyset paths (D2)
// keep scroll stable on an unchanged dataset, Meili has no search_after
// primitive, so a mid-batch insert is neutralized here instead (FU-635 tracks
// the upgrade path).
export function dedupeHits(hits: Offer[]): Offer[] {
  const seen = new Set<string>()
  const out: Offer[] = []
  for (const hit of hits) {
    if (seen.has(hit.id)) continue
    seen.add(hit.id)
    out.push(hit)
  }
  return out
}

// ADR-363 D1: canonical listing feed for the marketplace surfaces. Home
// sliders (useAllOffers/useOffersByType in useEntityQueries.ts), /buy and
// /search all read this SAME cache family (['listings', 'marketplace', params])
// backed by /api/search — one data source, one versioned server cache (the
// shared `offers` tag), one invalidation family. Identical params share one
// cache entry; filtered views get their own params-keyed entry.
//
// ADR-335 D3: cursor-paginated, lifting the 100-row hard cap. Mirrors
// useDmInbox.ts — the codebase's one existing useInfiniteQuery consumer.
// Deliberately no refetchInterval: useInfiniteQuery re-fetches EVERY
// already-loaded page on each tick, not just the first — a user who loaded 10
// batches would trigger 10 sequential requests every 30s. staleTime alone
// still keeps data fresh on refocus/remount.
export function getListingNextPageParam(lastPage: SearchResult): string | undefined {
  return lastPage.pageInfo?.hasNextPage ? (lastPage.pageInfo.endCursor ?? undefined) : undefined
}

export function useListingFeed(
  params: SearchParams,
  batchSize = 100,
  options?: { refetchInterval?: number; autoPrefetchNextPage?: boolean; enabled?: boolean },
) {
  const queryClient = useQueryClient()
  const queryKey = ['listings', 'marketplace', params] as const

  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchOfferSearch(params, batchSize, pageParam),
    getNextPageParam: getListingNextPageParam,
    staleTime: POLL_INTERVAL,
    placeholderData: (prev) => prev,
    enabled: options?.enabled ?? true,
    // ADR-363 review fix: optional polling for non-scroll consumers. Home's
    // sliders (useAllOffers/useOffersByType) pass 5 min to restore their
    // pre-D1 self-refresh. /buy and /search deliberately pass none (ADR-335:
    // refetching every already-loaded page on a scroll feed is wasteful).
    refetchInterval: options?.refetchInterval,
  })

  // ADR-335 FU-531: prefetch the page AFTER the one a human actually requested,
  // so "Load more" feels instant. This MUST be keyed on an explicit user action
  // (review fix 2026-09-02): an unguarded pages.length effect would chain —
  // each prefetch appends its page to this same cache entry, which grows the
  // effect's dependency, which prefetches the next page, walking the entire
  // catalog in the background even for scroll-less consumers.
  const userFetchRef = useRef(false)
  const fetchNextPage = useCallback(() => {
    userFetchRef.current = true
    return query.fetchNextPage()
  }, [query.fetchNextPage])

  useEffect(() => {
    if (options?.autoPrefetchNextPage === false) return
    if (!userFetchRef.current) return
    if (!query.data || query.isFetchingNextPage || !query.hasNextPage) return
    userFetchRef.current = false
    queryClient.prefetchInfiniteQuery({
      queryKey,
      queryFn: ({ pageParam }) => fetchOfferSearch(params, batchSize, pageParam as string | undefined),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: getListingNextPageParam,
      pages: query.data.pages.length + 1,
      // Without an explicit staleTime the prefetch defaults to 0 and re-fetches
      // every already-loaded page on each step (the same cost the file's own
      // comment on useInfiniteQuery warns about) — pin it to the feed's.
      staleTime: POLL_INTERVAL,
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data?.pages.length, query.hasNextPage, query.isFetchingNextPage])

  return {
    query,
    // ADR-363 D2: flat pages through dedupeHits so an offset-shifted Meili
    // cursor can never render the same offer twice (see dedupeHits above).
    hits: dedupeHits(query.data?.pages.flatMap((p) => p.hits) ?? []),
    // Page 1 only — later pages omit estimatedTotalHits server-side (D2), so
    // this always reflects the first page's filter-aware total.
    total: query.data?.pages[0]?.estimatedTotalHits ?? 0,
    // ADR-403: per-offerType facets from page 1 (absent on later pages), used
    // by /search for the subtab result counts + auto-switch.
    facetDistribution: query.data?.pages[0]?.facetDistribution,
    hasNextPage: query.hasNextPage ?? false,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    fetchNextPage,
  } as const
}

// ADR-363 D1: compatibility wrapper — every marketplace surface (BuyDashboard,
// Search) mounts the canonical ['listings', 'marketplace', params] feed under
// the pre-ADR-335 name so the unified cache is shared without touching their
// call sites.
export function useOfferSearchInfinite(
  params: SearchParams,
  batchSize = 100,
  options?: { enabled?: boolean },
) {
  return useListingFeed(params, batchSize, options)
}
