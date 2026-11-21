// useCoopExploreData — shared hook for /coop (CoopExplore) and /search (ADR-237
// D7 coop context). Returns the merged dataset (categories + cooperations + offers
// + companies + partner users → CoopItem[]) that both the dedicated CoopExplore
// route and the unified Search & Explore page render through ListBrowser.
//
// ADR-376 D1/D2: rewritten from an opaque 8-endpoint `Promise.all` under its own
// private key (`['coop-explore-data']`) into a COMPOSITION layer over the same
// canonical, already-shared queries Home's "Services & Collaborations" slider
// uses: `useCooperationsDiscover` (Cooperation rows), `useOffersByType`
// (COOP/SERVICE/AGENT_SETUP offers — the unified ADR-363 `['listings',
// 'marketplace', …]` feed, not the deprecated-for-browse `/api/offers` this
// hook used to call directly), `useCompanies` (already shared with
// BuyDashboard's Vendors tab), and `useStandardCategories` (already shared
// app-wide). The result: Home, CoopExplore, Search and BuyDashboard now read
// the SAME cache entries for the SAME underlying rows — navigating between them
// no longer refetches-and-reskeletons data another surface just displayed, and
// a mutation invalidating the canonical keys (useEntityMutations.ts,
// CoopGuide.tsx) reaches every consumer in one call. Only two sources have no
// existing canonical hook elsewhere (Partners full-browse, open Bounties
// full-browse) — both are deliberately kept as their OWN queries with their OWN
// caps rather than force-unified with Home's differently-parameterized sliders
// (ADR-324 already evaluated and rejected that consolidation for Partners; see
// ADR-376 Rejected Alternatives).
//
// Public contract preserved: consumers (CoopExplore, Search) keep the same
// { categories, cooperations, loading, refetch } signature — zero changes
// needed there. `loading` is now the OR of the underlying queries' isLoading
// flags (mirrors Home's own per-segment loading-gate pattern) instead of one
// flag from a single bundled fetch; for a cold mount this is indistinguishable,
// for a warm-cache mount it's a strict improvement.

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiCall } from '../lib/api'
import { richTextToPlainText } from '../components/offers'
import type { StandardCategory, Company } from '../types/api'
import {
  offerToCoopItem, companyToCoopItem, partnerUserToCoopItem,
  useCooperationsDiscover, useOffersByType, useCompanies, useStandardCategories,
  type PartnerUser,
} from './useEntityQueries'
import { useOpenBounties, type AgentTask } from './useAgentTaskQueries'
import type { CoopItem } from '../routes/coop/coop-cards'
import { parseJsonField } from '../routes/coop/coop-cards'
import { dedupeCoopItems } from '../routes/coop/coop-filters'

// ADR-338: AgentTask (Bounty Board) → CoopItem, so open bounties render
// through the exact same ListBrowser/CoopGalleryCard/CoopListRow pipeline as
// tenders/projects/network/partners, with their own 'bounties' filter tab.
// images uses the same defensive parse as offerToCoopItem (native Json array
// on new rows, tolerant of legacy stringified blobs) so bounty covers render
// exactly like offer covers.
export function agentTaskToCoopItem(task: AgentTask): CoopItem {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    itemType: 'bounty',
    status: task.status,
    budgetSats: task.budgetSats,
    createdAt: task.createdAt,
    skills: task.requiredCapabilities,
    deadline: task.deadline ?? undefined,
    initiatorPubkey: task.creatorPubkey,
    detailPath: `/bounties/${task.id}`,
    images: parseJsonField<string[]>(task.images, undefined),
    posterPaid: task.posterReliability ? { paid: task.posterReliability.paid, decided: task.posterReliability.decided } : undefined,
  }
}

// ADR-368 D4: SERVICE offers → CoopItem 'service' items, so the coop explore
// surfaces can browse single-provider service offers (ADR-366 D1 semantics)
// side by side with cooperations/network/partners under the new `services` tab.
// Field-for-field mirror of offerToCoopItem (useEntityQueries.ts) — same
// companyId forward for the dedupe collapse, same country for the Locations
// panel, same rich-text stripping for descriptions — with itemType +
// detailPath (/buy/product/:id) swapped.
export function serviceOfferToCoopItem(offer: Record<string, unknown>): CoopItem {
  return {
    id: offer.id as string,
    title: (offer.title as string) ?? 'Untitled',
    // ADR-295: list items show visible text, never stored rich-text markup
    description: offer.description ? richTextToPlainText(offer.description as string) : undefined,
    itemType: 'service',
    status: offer.status as string | undefined,
    categoryCode: offer.categoryCode as string | null | undefined,
    gammaTags: offer.gammaTags as string[] | undefined,
    priceSats: offer.priceSats as number | undefined,
    createdAt: ((offer.publishedAt ?? offer.createdAt) as string | undefined),
    initiatorPubkey: offer.creatorPubkey as string | undefined,
    companyId: (offer.company as { id?: string } | null | undefined)?.id,
    country: offer.country as string | undefined,
    images: parseJsonField<string[]>(offer.images, undefined),
    detailPath: `/buy/product/${offer.id as string}`,
  }
}

// ADR-368 D4: AGENT_SETUP offers → CoopItem 'agent' items. The browse row
// embeds its AgentProfile (apps/server/index.ts GET /api/offers include:
// agentProfile { id, name, isVerified, verifiedAt, capabilities,
// reputationScore }), so capabilities map straight to CoopItem.skills for the
// card chip row. Cover art comes from the offer's own images (the roster
// surface reads them the same way, see useAgentRosterQuery.ts); the avatarUrl
// fallback is defensive for endpoints that include it (the /api/offers browse
// route does not today, so it normally stays undefined). detailPath points at
// the buy-side product detail, matching every other AGENT_SETUP card surface.
export function agentSetupToCoopItem(offer: Record<string, unknown>): CoopItem {
  const agentProfile = offer.agentProfile as {
    capabilities?: unknown
    avatarUrl?: string | null
    isVerified?: boolean
    reputationScore?: number | null
  } | null | undefined
  const offerImages = parseJsonField<string[]>(offer.images, undefined)
  const images = offerImages?.length ? offerImages : (agentProfile?.avatarUrl ? [agentProfile.avatarUrl] : undefined)
  return {
    id: offer.id as string,
    title: (offer.title as string) ?? 'Untitled',
    // ADR-295: list items show visible text, never stored rich-text markup
    description: offer.description ? richTextToPlainText(offer.description as string) : undefined,
    itemType: 'agent',
    status: offer.status as string | undefined,
    categoryCode: offer.categoryCode as string | null | undefined,
    gammaTags: offer.gammaTags as string[] | undefined,
    priceSats: offer.priceSats as number | undefined,
    createdAt: ((offer.publishedAt ?? offer.createdAt) as string | undefined),
    initiatorPubkey: offer.creatorPubkey as string | undefined,
    // Agent offers never collapse onto a vendor card (agents are the
    // browseable unit — see dedupeCoopItems), but forwarding companyId keeps
    // the item honest for any future consumer.
    companyId: (offer.company as { id?: string } | null | undefined)?.id,
    country: offer.country as string | undefined,
    skills: Array.isArray(agentProfile?.capabilities)
      ? (agentProfile?.capabilities as string[])
      : undefined,
    // ADR-368 follow-up (2026-09-05): forward the profile's trust signals so
    // agent cards can show the Verified badge + reputation chip in grid and
    // list views (same data the roster surface reads).
    verified: agentProfile?.isVerified === true,
    reputation: typeof agentProfile?.reputationScore === 'number' ? agentProfile.reputationScore : undefined,
    // ADR-370 D6 (Phase 2): forward the offer's canvas provider for the
    // pre-purchase Canvas chip on /coop agent browse cards.
    canvasProvider: readOfferCanvasProvider(offer),
    // ADR-368 follow-up: forward the offer's billing model so the coop-side
    // Agent Filters panel can narrow by ONE_TIME/PER_HOUR/PER_TOKEN/
    // SUBSCRIPTION (client-side, mirrors the marketplace /api/search axis).
    billingModel: typeof offer.agentBillingModel === 'string' ? offer.agentBillingModel : undefined,
    images,
    detailPath: `/buy/product/${offer.id as string}`,
  }
}

// ADR-370 D6 (Phase 2): pull the canvas provider out of an offer row's
// agentConfigMeta (tolerant — the field is optional and only on AGENT_SETUP).
function readOfferCanvasProvider(offer: Record<string, unknown>): 'doop-local' | 'doop-hosted' | undefined {
  const meta = offer.agentConfigMeta as { canvas?: { provider?: string } } | null | undefined
  const provider = meta?.canvas?.provider
  if (provider === 'doop-local' || provider === 'doop-hosted') return provider
  return undefined
}

export interface UseCoopExploreDataOptions {
  /**
   * Polling interval in ms. Defaults to `VITE_POLL_INTERVAL_MS` (30s).
   * Pass `0` to disable polling (e.g. the unified Search page, which has its
   * own TanStack invalidation cadence via useOfferSearch).
   */
  pollInterval?: number
}

export interface UseCoopExploreDataResult {
  categories: StandardCategory[]
  cooperations: CoopItem[]
  loading: boolean
  refetch: () => void
}

export interface CoopExploreData {
  categories: StandardCategory[]
  cooperations: CoopItem[]
}

const DEFAULT_POLL_INTERVAL = Number(import.meta.env.VITE_POLL_INTERVAL_MS) || 30_000

const INDIVIDUAL_TIMEOUT_MS = 15_000

// ADR-376: partners have no canonical hook elsewhere. Kept deliberately
// separate from Home's own Partners slider (['partners-slider', …], limit=12,
// "recent first") — different purpose/cap (ADR-324). Open bounties now share
// Home's cache entry via useOpenBounties() (FU-870).
const PARTNERS_BROWSE_KEY = ['partners-browse'] as const

function usePartnersBrowse(refetchInterval?: number) {
  return useQuery({
    queryKey: PARTNERS_BROWSE_KEY,
    queryFn: async (): Promise<PartnerUser[]> => {
      const res = await apiCall('/api/partners?segment=users&sort=offers&limit=60', { timeoutMs: INDIVIDUAL_TIMEOUT_MS })
      const data = await res.json()
      return (data.items ?? data.edges?.map((e: { node: PartnerUser }) => e.node) ?? []) as PartnerUser[]
    },
    staleTime: DEFAULT_POLL_INTERVAL,
    refetchInterval,
  })
}

// ADR-376 D1 / FU-699: pure merge step, extracted out of the hook so the
// composition can be unit-tested without rendering a React hook tree or
// mocking eight separate TanStack queries — mirrors how dedupeCoopItems
// itself (ADR-363 D3) is a plain, independently-tested function. Every `data`
// param is the already-typed result shape its source hook returns (`?? []`
// applied by the caller), so this function only does the CoopItem mapping +
// merge + dedupe, nothing else.
export interface CoopExploreSources {
  cooperations: CoopItem[]
  networkOffers: Record<string, unknown>[]
  serviceOffers: Record<string, unknown>[]
  agentOffers: Record<string, unknown>[]
  companies: Company[]
  partners: PartnerUser[]
  bounties: AgentTask[]
}

export function mergeCoopExploreSources(sources: CoopExploreSources): CoopItem[] {
  // ADR-363 D3: run the merged pool through dedupeCoopItems so the source
  // concatenations can never render the same entity twice on one tab
  // (vendor/network/partner collapse rules live in coop-filters.ts).
  return dedupeCoopItems([
    ...sources.cooperations,
    ...sources.networkOffers.map(offerToCoopItem),
    ...sources.companies.map(companyToCoopItem),
    ...sources.partners.map(partnerUserToCoopItem),
    ...sources.bounties.map(agentTaskToCoopItem),
    ...sources.serviceOffers.map(serviceOfferToCoopItem),
    ...sources.agentOffers.map(agentSetupToCoopItem),
  ])
}

export function useCoopExploreData(options: UseCoopExploreDataOptions = {}): UseCoopExploreDataResult {
  const { pollInterval = DEFAULT_POLL_INTERVAL } = options

  // ADR-376 D1: every one of these is a canonical, already-shared query.
  // `first`/`limit` standardized to 100 (this hook's prior own cap) so Home's
  // sliders (which now request the same first=100, see Home.tsx) land on the
  // identical cache entry rather than a smaller, differently-keyed one.
  // `pollInterval` only applies to the two sources with no established
  // refetchInterval of their own (Partners/Bounties browse, and — since a
  // caller-supplied pollInterval is this hook's own explicit opt-in —
  // cooperations too); `useOffersByType`/`useCompanies` already carry their
  // own fixed 5 min self-refresh (ADR-363) that stays consumer-independent,
  // exactly the staleTime-drift class of bug D2 closes for Home.
  const pollOn = pollInterval > 0 ? pollInterval : undefined
  const categoriesQuery = useStandardCategories()
  const cooperationsQuery = useCooperationsDiscover('', true, 100, pollOn)
  const networkOffers = useOffersByType('COOP', 100)
  const serviceOffers = useOffersByType('SERVICE', 100)
  const agentOffers = useOffersByType('AGENT_SETUP', 100)
  const companiesQuery = useCompanies()
  const partnersQuery = usePartnersBrowse(pollOn)
  const bountiesQuery = useOpenBounties(pollOn)

  const cooperations = useMemo(() => mergeCoopExploreSources({
    cooperations: cooperationsQuery.data ?? [],
    networkOffers: (networkOffers.data ?? []) as unknown as Record<string, unknown>[],
    serviceOffers: (serviceOffers.data ?? []) as unknown as Record<string, unknown>[],
    agentOffers: (agentOffers.data ?? []) as unknown as Record<string, unknown>[],
    companies: companiesQuery.data ?? [],
    partners: partnersQuery.data ?? [],
    bounties: bountiesQuery.data ?? [],
  }), [
    cooperationsQuery.data, networkOffers.data, companiesQuery.data,
    partnersQuery.data, bountiesQuery.data, serviceOffers.data, agentOffers.data,
  ])

  // All-or-nothing loading, preserved from the old bundled-fetch contract —
  // any source still on its first cold fetch keeps the tab on its skeleton.
  // Each underlying query independently degrades to an empty array on
  // failure (ADR-338/ADR-363's per-source .catch()/dedupeHits contracts), so
  // one slow/failing source narrows the merged pool, never crashes the page.
  const loading = categoriesQuery.isLoading || cooperationsQuery.isLoading
    || networkOffers.isLoading || serviceOffers.isLoading || agentOffers.isLoading
    || companiesQuery.isLoading || partnersQuery.isLoading || bountiesQuery.isLoading

  return {
    categories: categoriesQuery.data ?? [],
    cooperations,
    loading,
    refetch: () => {
      void categoriesQuery.refetch()
      void cooperationsQuery.refetch()
      void networkOffers.refetch()
      void serviceOffers.refetch()
      void agentOffers.refetch()
      void companiesQuery.refetch()
      void partnersQuery.refetch()
      void bountiesQuery.refetch()
    },
  }
}
