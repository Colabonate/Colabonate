// Search & Explore – /search (ADR-237)
//
// Unified discovery surface combining the Marketplace (Buy) and Cooperate
// (Coop) contexts behind a single shared search query. A top-level segmented
// control (D2) swaps the ListBrowser's filter tabs, categories, items, cards,
// sort options and KPIs without touching ListBrowser itself (D3 — surgical).
//
// Both contexts pre-fetch on mount (D7) so switching context is an instant
// client-side prop swap with no loading spinner. The query is shared (D4) —
// type "Bitcoin" once, flip between marketplace and coop results.
//
// URL is the source of truth for context + sub-tab (D5); query + category are
// local state initialised from the URL on mount (ADR-236 hero deep-link compat).

import { useEffect, useState, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button } from '@mui/material'
import {
  ShoppingBag, Search as SearchIcon, Store,
  TrendingUp,
  Tag, Handshake, FolderKanban, Network, Bitcoin, Layers, Users, Target, Bot,
  MapPin, Filter, Hash,
} from 'lucide-react'
import { PageContainer, FloatingAddButton } from '@ds/ui'
import { KPIStrip } from '../../components/kpi/KpiStrip'
import type { KPIItem } from '@ds/ui'
import { cn } from '@ds/utils'
import { PageHeader } from '../../components/PageHeader'
import { CartFAB, CoopFAB } from '../../components/ui'
import { SearchHeroBar } from '../../components/home/SearchHeroBar'
import { Seo } from '../../components/Seo'
import { ListBrowser } from '../../components/list-browser'
import type { ListBrowserSortOption, TaxonomyAxis } from '../../components/list-browser'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { usePref } from '../../utils/userPreferences'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { useCart } from '../../context/CartContext'
import { useNotification } from '../../context/NotificationContext'
import { useFABActions } from '../../context/FABContext'
import { useFavoritesWithUndo } from '../../hooks/useFavorites'
import { useFilterFavorites } from '../../hooks/useFilterFavorites'
import { useOfferSearchInfinite, useSearchFacets } from '../../hooks/useOfferSearch'
import { useImageValidity } from '../../hooks/useImageValidity'
import { useSessionState } from '../../hooks/useSessionState'
import { initialCountryFilter } from '../../lib/initial-country-filter'
import { useCoopExploreData } from '../../hooks/useCoopExploreData'
import { useAgentTaskCounts } from '../../hooks/useAgentTaskQueries'
import { COUNTRIES } from '../../components/offers/offerFormConstants'
import {
  useStandardCategories,
  useCompanies,
  useCategoryCounts,
  useEcosystemStats,
} from '../../hooks/useEntityQueries'
import type { Offer, Company, StandardCategory } from '../../types/api'
import {
  OfferGalleryCard, OfferListRow, EmptyState,
} from '../buy/marketplace-cards'
import { VendorGalleryCard, VendorListRow, makeBasketItem, AgentFilterPanel, SaveFilterAction, ImagesFilterPanel, LocationsFilterPanel, CategoriesFilterPanel, type SidebarPanelId } from '../buy/components'
import { ListingFilterSidebar } from '../../components/listings/ListingFilterSidebar'
import type { ActiveFilterChip } from '../../components/list-browser/list-browser.types'
import {
  buildFilteredOffers, buildFilteredVendors, buildVendorOfferCounts,
  buildGammaTagFacets, buildAgentCapabilityFacets,
} from '../../components/marketplace/filterPipeline'
import { buildMarketplaceKpi } from '../../components/marketplace/kpiItems'
import {
  CoopGalleryCard, CoopListRow, CoopEmptyState,
  type CoopItem,
} from '../coop/coop-cards'
import { useCoopFilters } from '../coop/coop-filters'
import { coopItemMatchesTab, pickBestTab, type CoopTab } from '../../lib/search-tab-counts'

// ── Types ──────────────────────────────────────────────────────────────
type SearchContext = 'marketplace' | 'coop'
type MarketplaceTab = 'all' | 'products' | 'services' | 'vendors'
type SortOption = 'newest' | 'price-asc' | 'price-desc' | 'name'

// ── Filter tabs (context-specific sub-tab sets, D1 level-2) ────────────
const MARKETPLACE_TABS: Array<{ key: MarketplaceTab; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'products', label: 'Products' },
  { key: 'services', label: 'Services' },
  { key: 'vendors', label: 'Vendors' },
]

const COOP_TABS: Array<{ key: CoopTab; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'tenders', label: 'Tenders' },
  { key: 'bounties', label: 'Bounties' },
  { key: 'projects', label: 'Projects' },
  { key: 'network', label: 'Network' },
  { key: 'partners', label: 'Partners' },
  { key: 'agents', label: 'Agents' },
  { key: 'services', label: 'Services' },
]

// ── Sort options (D3 — context-specific labels, shared sort *values*) ──
const MARKETPLACE_SORT_OPTIONS: ListBrowserSortOption[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'price-asc', label: 'Price ↑' },
  { value: 'price-desc', label: 'Price ↓' },
  { value: 'name', label: 'Name A–Z' },
]

const VENDOR_SORT_OPTIONS: ListBrowserSortOption[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'name', label: 'Name A–Z' },
]

const COOP_SORT_OPTIONS: ListBrowserSortOption[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'price-asc', label: 'Budget ↑' },
  { value: 'price-desc', label: 'Budget ↓' },
  { value: 'name', label: 'Name A–Z' },
]

const MARKETPLACE_TAB_KEYS = MARKETPLACE_TABS.map(t => t.key)
const COOP_TAB_KEYS = COOP_TABS.map(t => t.key)

// Coop-type category constants + filter/sort memos are shared with CoopExplore
// via ../coop/coop-filters (ADR-237 review finding #2). makeBasketItem +
// SidebarSavedFilters are shared with BuyDashboard via ../buy/components
// (ADR-237 review findings #1 + #3).

export function Search() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { isMobile } = useBreakpoint()

  // ── URL-derived state (single source of truth for context + tab, D5) ──
  const context: SearchContext = searchParams.get('context') === 'marketplace' ? 'marketplace' : 'coop'
  const urlTab = searchParams.get('tab') || ''
  const offerTypeParam = searchParams.get('offerType')

  // Each context resolves its own tab from the URL; the inactive context
  // defaults to 'all' so its background memos always see a valid tab value.
  const marketplaceTab: MarketplaceTab = MARKETPLACE_TAB_KEYS.includes(urlTab as MarketplaceTab)
    ? (urlTab as MarketplaceTab)
    : offerTypeParam === 'PRODUCT' ? 'products'
      : offerTypeParam === 'SERVICE' ? 'services'
        : 'all'
  const coopTab: CoopTab = COOP_TAB_KEYS.includes(urlTab as CoopTab) ? (urlTab as CoopTab) : 'all'

  // ── Local state (initialised from URL deep-link → session → default, D4/D5) ─
  // Query + category persist across in-app navigation within the session
  // (sessionStorage) so flipping to a detail page and back keeps the user's
  // filters. URL deep-links (q / categoryCode from the hero, proximity=world
  // from Home) win on mount and become the new session value.
  const [query, setQuery] = useSessionState<string>(
    'search:query',
    '',
    () => searchParams.get('q') ?? undefined,
  )
  const [selectedCategory, setSelectedCategory] = useSessionState<string>(
    'search:selectedCategory',
    '',
    () => searchParams.get('categoryCode') ?? undefined,
  )
  const [sortBy, setSortBy] = useSessionState<SortOption>('search:sortBy', 'newest')
  // ADR-277 D7: taxonomy defaults to 'standard' — ListBrowser hydrates it from
  // localStorage on mount if the user previously switched to 'gamma'. Shared across
  // both contexts (mirrors selectedCategory), reset on context switch below.
  const [taxonomy, setTaxonomy] = useState<TaxonomyAxis>('standard')
  const [selectedGammaTags, setSelectedGammaTags] = useSessionState<string[]>('search:selectedGammaTags', [])
  // ADR-313 D2/D3 (FU-421): AGENT_SETUP-only filters, mirrors BuyDashboard.
  // Only meaningful on the marketplace context's 'all' tab (the only tab
  // AGENT_SETUP offers appear under today).
  const [selectedCapabilities, setSelectedCapabilities] = useSessionState<string[]>('search:selectedCapabilities', [])
  const [agentBillingModel, setAgentBillingModel] = useSessionState<string>('search:agentBillingModel', '')
  const [minReputation, setMinReputation] = useSessionState<number>('search:minReputation', 0)
  // ADR-370 D6 (Phase 2): canvas axis — '' = any canvas.
  const [canvasProvider, setCanvasProvider] = useSessionState<string>('search:canvasProvider', '')
  const [categoryOpen, setCategoryOpen] = useState(true)
  const [showSaveFilterDialog, setShowSaveFilterDialog] = useState(false)
  const [saveFilterName, setSaveFilterName] = useState('')

  // ADR-333 D1: which marketplace sidebar panels are visible, in click order —
  // array order IS the render order (position 1, 2, 3… top to bottom).
  // Toggling off removes from the array; toggling on appends to the end.
  // Initially visible: Locations, Categories, Agent Filters. Images hidden.
  const [enabledSidebarPanels, setEnabledSidebarPanels] = useSessionState<SidebarPanelId[]>(
    'search:sidebarPanels',
    ['locations', 'categories', 'agentFilters'],
  )
  function toggleSidebarPanel(id: SidebarPanelId) {
    setEnabledSidebarPanels(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id],
    )
  }

  const [userCountry] = usePref('userCountry', '')
  const [hideEmptyCategories] = usePref('hideEmptyCategories', false)
  const [showOfferCounts] = usePref('showOfferCounts', true)
  // Shared pref key with BuyDashboard — offers without images are hidden by
  // default, the sidebar Images toggle (marketplace context) re-shows them.
  const [hideNoImageOffers, setHideNoImageOffers] = usePref('hideNoImageOffers', true)

  const [countryFilter, setCountryFilter] = useSessionState<string>(
    'search:countryFilter',
    // ADR-418 D6: All countries unless a Home Nearby/Region link asks for the profile scope.
    () => initialCountryFilter(userCountry, searchParams.get('proximity')),
    () => (searchParams.get('proximity') === 'world' ? '' : undefined),
  )

  // ADR-363 D6: the coop context renders the SAME filter SidePanel as
  // CoopExplore (ListingFilterSidebar, filterModel="client"). Country +
  // panel-toggle state is kept separate from the marketplace keys
  // (searchCoop:*) so the two lens-specific country pools (offer vs
  // offer+company) never leak into each other. hideNoImageOffers stays the
  // shared pref above — one user preference across both contexts, same as
  // CoopExplore.
  // The coop category tree is now a regular toggleable panel (same as the
  // marketplace context), so only Categories starts enabled — the secondary
  // panels (Locations/Images/Agent Filters) stay off until the user turns them
  // on, and the category tree is visible immediately.
  const [enabledCoopSidebarPanels, setEnabledCoopSidebarPanels] = useSessionState<SidebarPanelId[]>(
    'searchCoop:sidebarPanels',
    ['categories'],
  )
  const [coopCountryFilter, setCoopCountryFilter] = useSessionState<string>('searchCoop:countryFilter', '')
  // ADR-368 follow-up: coop-side agent axis (mirror of the marketplace
  // AgentFilterPanel) — separate keys from the marketplace agent filters so
  // the two lenses never leak into each other, same as coopCountryFilter.
  const [coopSelectedCapabilities, setCoopSelectedCapabilities] = useSessionState<string[]>('searchCoop:selectedCapabilities', [])
  const [coopAgentBillingModel, setCoopAgentBillingModel] = useSessionState<string>('searchCoop:agentBillingModel', '')
  const [coopMinReputation, setCoopMinReputation] = useSessionState<number>('searchCoop:minReputation', 0)
  const [coopCanvasProvider, setCoopCanvasProvider] = useSessionState<string>('searchCoop:canvasProvider', '')

  function toggleCoopSidebarPanel(id: SidebarPanelId) {
    setEnabledCoopSidebarPanels(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id],
    )
  }

  function clearCoopAgentFilters() {
    setCoopSelectedCapabilities([])
    setCoopAgentBillingModel('')
    setCoopMinReputation(0)
    setCoopCanvasProvider('')
  }

  // ── Autofocus when arriving via the MainMenu search icon button ──
  // Only fires when ?focus=1 is present, so direct loads / back-button restores
  // don't steal focus. Strips the param so a refresh or share doesn't re-trigger.
  useEffect(() => {
    if (searchParams.get('focus') !== '1') return
    const id = requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>('input[aria-label="Search"]')?.focus()
    })
    const next = new URLSearchParams(searchParams)
    next.delete('focus')
    setSearchParams(next, { replace: true })
    return () => cancelAnimationFrame(id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Hooks (all run unconditionally — D7: both contexts pre-fetch) ─────
  const { showSnackbarWithUndo } = useNotification()
  const { isFavorite, toggleFavorite } = useFavoritesWithUndo({
    entityType: 'offer',
    showSnackbarWithUndo,
  })
  const { savedFilters, saveFilter, deleteFilter } = useFilterFavorites({ route: '/search/marketplace' })
  const { addItem, itemCount } = useCart()
  const { actions: fabActions, setActions: setFABActions, clear: clearFAB } = useFABActions()

  // ADR-277 D7: the two axes are mutually exclusive — only the active axis's
  // selection narrows the server-side search.
  const marketplaceSearchParams = useMemo(() => ({
    q: query || undefined,
    offerType: marketplaceTab === 'products' ? 'PRODUCT' : marketplaceTab === 'services' ? 'SERVICE' : undefined,
    categoryCode: taxonomy === 'standard' ? (selectedCategory || undefined) : undefined,
    country: countryFilter || undefined,
    // ADR-313 D2 (FU-421): only meaningful on the 'all' tab — mirrors
    // BuyDashboard (products/services have no agentProfile to filter on).
    ...(marketplaceTab === 'all' ? {
      capability: selectedCapabilities.length > 0 ? selectedCapabilities : undefined,
      minReputation: minReputation > 0 ? minReputation : undefined,
      agentBillingModel: agentBillingModel || undefined,
      canvasProvider: canvasProvider || undefined,
    } : {}),
  }), [query, marketplaceTab, selectedCategory, countryFilter, taxonomy, selectedCapabilities, minReputation, agentBillingModel, canvasProvider])

  // ADR-335 D3/D5: cursor-paginated — lifts the 100-row hard cap (mirrors BuyDashboard).
  const {
    hits: searchResults = [],
    total: marketplaceTotal = 0,
    isLoading: searchLoading,
    hasNextPage: searchHasMore,
    fetchNextPage: fetchMoreOffers,
  } = useOfferSearchInfinite(marketplaceSearchParams, 100)

  // ADR-418 D1/D3: server-side country facet for the Location panel. The hook
  // strips `country` itself (disjunctive facet, excluded from the cache key),
  // so the option list does not depend on loaded rows or the selected country.
  // Marketplace only: the coop context keeps its own client-side list (D5).
  const { data: locationFacet, isLoading: locationFacetLoading } = useSearchFacets(marketplaceSearchParams, { enabled: context === 'marketplace' })

  // ADR-403: unscoped probe (same shared ['listings','marketplace',…] cache)
  // supplying the per-offerType facets used by the Cooperate/Marketplace
  // badges and the subtab auto-switch. Runs once a query is active; when the
  // active marketplace tab is already unscoped (All/Vendors) the params match
  // the main query, so it shares that cache entry — no extra request.
  const marketplaceProbeParams = useMemo(() => ({
    ...marketplaceSearchParams,
    offerType: undefined,
  }), [marketplaceSearchParams])
  const {
    total: marketplaceProbeTotal = 0,
    facetDistribution: marketplaceProbeFacets,
    isLoading: marketplaceProbeLoading,
  } = useOfferSearchInfinite(marketplaceProbeParams, 1, { enabled: Boolean(query.trim()) })

  // Probes first-image URLs so the Images toggle also catches dead URLs and
  // 1x1 placeholder pixels, not just empty arrays (see useImageValidity).
  const searchImageUrls = useMemo(() => searchResults.map(o => Array.isArray(o.images) ? o.images[0] : (typeof o.images === 'string' ? o.images : undefined)), [searchResults])
  const { isUsableImage } = useImageValidity(searchImageUrls)
  const { data: categories = [] } = useStandardCategories()
  const { data: companies = [] } = useCompanies()
  const countParams = useMemo(() => ({
    q: marketplaceSearchParams.q,
    offerType: marketplaceSearchParams.offerType,
    country: marketplaceSearchParams.country,
  }), [marketplaceSearchParams])
  const { data: categoryCounts = {} } = useCategoryCounts(countParams)

  // Coop data — shared hook (FU-237-C). Polling disabled: the unified page
  // relies on mount-fetch + TanStack invalidation for the marketplace side;
  // coop data is relatively static and /coop remains the polling route.
  const { categories: coopRawCategories, cooperations, loading: coopLoading } = useCoopExploreData({ pollInterval: 0 })
  // ADR-334 D5: server-aggregated coop totals for the coop-context KPI strip
  // (same source as CoopExplore — one number across all three surfaces).
  const { data: ecosystemStats, isLoading: statsLoading } = useEcosystemStats()
  // ADR-338: live open-bounty count for the coop-context KPI strip's
  // "Bounties" chip — the agent-native sibling of "Tenders" (ADR-328's own
  // projects/tenders/network ↔ Agent Orchestration/Bounty Board/Agent
  // Network framing). Bounty rows themselves now flow through the same
  // useCoopExploreData → CoopItem pipeline as every other coop item
  // (agentTaskToCoopItem, useCoopExploreData.ts), so the 'bounties' tab
  // renders real cards; this hook only supplies the exact unwindowed OPEN
  // count for the KPI number (ecosystemStats has no bounty count to reuse,
  // same shape as how Tenders/Projects/etc. read from /api/stats instead of
  // the windowed pool).
  const { data: bountyCounts } = useAgentTaskCounts()

  const dashboardRef = usePageAnimation([
    { selector: '.dashboard-animate', from: { duration: 0.5, stagger: 0.12, y: 24 } },
  ])

  // Unified Add-FAB — identical action set as CoopExplore (ADR-368): Items,
  // Product, Service, Agent, Bounty, Coop Guide across every surface.
  useEffect(() => {
    setFABActions([
      { id: 'create-item', label: 'Items', info: 'Sell items directly', group: 'Sell', icon: 'plus', onClick: () => navigate('/offers/new?type=item') },
      { id: 'create-offer', label: 'Product', info: 'Add to catalog', group: 'Sell', icon: 'package', onClick: () => navigate('/sell/listings/new?type=PRODUCT&mode=listings') },
      { id: 'create-service', label: 'Service', info: 'Offer your expertise', group: 'Cooperate', icon: 'briefcase', onClick: () => navigate('/offers/new?type=service&context=coop') },
      { id: 'create-agent', label: 'Agent', info: 'Offer a new agent', group: 'Cooperate', icon: 'bot', onClick: () => navigate('/coop/agents/new') },
      { id: 'post-bounty', label: 'Bounty', info: 'Post a bounty for agents to apply to', group: 'Create', icon: 'plus', onClick: () => navigate('/bounties/new') },
      { id: 'coop-guide', label: 'Coop Guide', info: 'Start cooperation', group: 'Cooperate', icon: 'handshake', onClick: () => navigate('/coop/guide') },
    ])
    return () => clearFAB()
  }, [setFABActions, clearFAB, navigate])

  // ADR-277 D4/D7: frequency-sorted gamma tag facets, computed from the SAME
  // pre-gamma-filter set used everywhere else (mirrors BuyDashboard).
  // ADR-335 FU-532: shared pure helper (mirrors BuyDashboard's identical copy).
  const gammaTagFacets = useMemo(() => buildGammaTagFacets(searchResults), [searchResults])

  // ADR-313 D2/D3 (FU-421): frequency-sorted capability facets, mirrors
  // gammaTagFacets above + BuyDashboard's own agentCapabilityFacets.
  const agentCapabilityFacets = useMemo(() => buildAgentCapabilityFacets(searchResults), [searchResults])

  // ADR-313 D2 (FU-421): reset agent filters when leaving the only tab they
  // apply to (mirrors BuyDashboard's clearAgentFilters).
  function clearAgentFilters() {
    setSelectedCapabilities([])
    setAgentBillingModel('')
    setMinReputation(0)
    setCanvasProvider('')
  }

  // ── Marketplace memos (shared pure helpers, ADR-335 FU-532) ───────────
  // Note: the previous local copy here also re-filtered by countryFilter
  // client-side — a no-op, since marketplaceSearchParams (above) already
  // sends the identical `country` param to the server; dropped as dead code
  // during unification (buildFilteredOffers takes no country param).
  const filteredOffers = useMemo(() => buildFilteredOffers({
    searchResults, hideNoImageOffers, isUsableImage, taxonomy, selectedGammaTags, sortBy,
  }), [searchResults, sortBy, taxonomy, selectedGammaTags, hideNoImageOffers, isUsableImage])

  const vendorOfferCounts = useMemo(() => buildVendorOfferCounts(searchResults), [searchResults])

  const filteredVendors = useMemo(() => buildFilteredVendors({
    companies, query, countryFilter, selectedCategory, searchResults, sortBy,
  }), [companies, query, countryFilter, selectedCategory, searchResults, sortBy])

  const offersForPanel = useMemo(() =>
    Object.entries(categoryCounts).flatMap(([categoryCode, count]) =>
      Array.from({ length: count }, () => ({ categoryCode })),
    ), [categoryCounts])

  const allCountries = useMemo(() => {
    const set = new Set<string>()
    searchResults.forEach(o => { if (o.country) set.add(o.country) })
    return Array.from(set).sort()
  }, [searchResults])

  // ── Coop filter/sort pipeline (shared with CoopExplore via useCoopFilters) ──
  const {
    coopCategories,
    categoryCountItems: coopCategoryCountItems,
    allItems: coopAllItems,
    gammaTagFacets: coopGammaTagFacets,
    agentCapabilityFacets: coopAgentCapabilityFacets,
    preCategoryItems: coopPreCategoryItems,
  } = useCoopFilters({
    cooperations,
    categories: coopRawCategories,
    filterTab: coopTab,
    query,
    selectedCategory,
    sortBy,
    taxonomy,
    selectedGammaTags,
    // ADR-363 D6: coop client-pipeline mirror of the shared Locations/Images
    // panels — country + no-image hiding drive useCoopFilters instead of
    // /api/search params, identical to CoopExplore.
    selectedCountry: coopCountryFilter,
    hideNoImageOffers,
    selectedCapabilities: coopSelectedCapabilities,
    agentBillingModel: coopAgentBillingModel,
    minReputation: coopMinReputation,
    canvasProvider: coopCanvasProvider,
  })

  // ADR-363 review fix (mirrors CoopExplore): the coop Locations panel lists
  // countries from the TAB-scoped pre-filter pool, so e.g. the tenders tab
  // never offers countries that only companies/offers carry.
  const coopCountries = useMemo(
    () => Array.from(new Set(coopPreCategoryItems.map(i => i.country).filter((c): c is string => Boolean(c)))).sort(),
    [coopPreCategoryItems],
  )

  // ADR-363 review fix: when the active coop tab/pool no longer contains the
  // selected country, reset it instead of silently showing an empty list.
  useEffect(() => {
    if (coopCountryFilter && !coopPreCategoryItems.some(i => i.country === coopCountryFilter)) {
      setCoopCountryFilter('')
    }
  }, [coopCountryFilter, coopPreCategoryItems, setCoopCountryFilter])

  // ── Context-aware active props (D3 prop-swap) ────────────────────────
  const isVendorsTab = context === 'marketplace' && marketplaceTab === 'vendors'
  const activeTab = context === 'coop' ? coopTab : marketplaceTab
  const activeFilterTabs = context === 'coop' ? COOP_TABS : MARKETPLACE_TABS
  const activeItems = context === 'coop' ? coopAllItems : (isVendorsTab ? filteredVendors : filteredOffers)
  const activeLoading = context === 'coop' ? coopLoading : (isVendorsTab ? false : searchLoading)
  const activeCategories: StandardCategory[] = context === 'coop' ? coopCategories : categories
  const activeCategoryCountItems = context === 'coop'
    ? coopCategoryCountItems
    : (isVendorsTab ? searchResults : offersForPanel)
  const activeSortOptions = context === 'coop'
    ? COOP_SORT_OPTIONS
    : (isVendorsTab ? VENDOR_SORT_OPTIONS : MARKETPLACE_SORT_OPTIONS)
  const activeStorageKey = context === 'coop' ? 'searchCoop' : 'searchMarketplace'
  // ADR-277 D8: Vendors are Companies, not NIP-99 listings — no gamma axis for them.
  const activeGammaTagFacets = context === 'coop' ? coopGammaTagFacets : (isVendorsTab ? [] : gammaTagFacets)
  // ADR-333 D5a: mirrors the identical computation ListBrowser does internally
  // (not exposed as a prop back out) — duplicating one boolean is simpler than
  // adding a callback prop to ListBrowser for it.
  const gammaAxisAvailable = activeGammaTagFacets.length > 0
  const effectiveTaxonomy: TaxonomyAxis = gammaAxisAvailable ? taxonomy : 'standard'

  // Active filters as dismissible chips — shown by the search input (on focus)
  // and under the list header, so the user can see and clear the scope the
  // autosuggest/results actually use (notably the persisted country filter,
  // which silently hides cross-border + country-less results otherwise).
  const activeCountry = context === 'coop' ? coopCountryFilter : countryFilter
  const activeCountryLabel = activeCountry
    ? (COUNTRIES.find(c => c.code === activeCountry)?.name ?? activeCountry)
    : ''
  const activeCategoryLabel = activeCategories.find(c => c.slug === selectedCategory)?.name ?? selectedCategory
  const countryFilterChip: ActiveFilterChip | null = activeCountry ? {
    id: 'country',
    label: activeCountryLabel,
    icon: <MapPin size={11} />,
    onRemove: () => { if (context === 'coop') setCoopCountryFilter(''); else setCountryFilter('') },
  } : null
  // Everything scoping the results — for the search input.
  const inputFilterChips: ActiveFilterChip[] = [
    ...(countryFilterChip ? [countryFilterChip] : []),
    ...(selectedCategory ? [{
      id: 'category',
      label: activeCategoryLabel,
      icon: <Filter size={11} />,
      onRemove: () => setSelectedCategory(''),
    }] : []),
    ...(selectedGammaTags ?? []).map(tag => ({
      id: `tag:${tag}`,
      label: `#${tag}`,
      icon: <Hash size={11} />,
      onRemove: () => setSelectedGammaTags((selectedGammaTags ?? []).filter(t => t !== tag)),
    })),
  ]
  // Only the extras the built-in header row doesn't already render.
  const listFilterChips: ActiveFilterChip[] = countryFilterChip ? [countryFilterChip] : []

  // ── ADR-403: search-aware subtab counts ─────────────────────────────
  // Coop is fully client-side: the loaded pool IS what the tabs render, so
  // counting it is exact relative to the visible results. Marketplace counts
  // come from the unscoped probe's `offerType` facets + estimatedTotalHits.
  const coopSearchMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    return cooperations.filter(i =>
      i.title.toLowerCase().includes(q) || (i.description ?? '').toLowerCase().includes(q))
  }, [cooperations, query])

  const coopTabCounts = useMemo<Record<CoopTab, number>>(() => {
    const base = coopSearchMatches ?? cooperations
    const counts = { all: 0, tenders: 0, projects: 0, network: 0, partners: 0, bounties: 0, agents: 0, services: 0 } as Record<CoopTab, number>
    for (const item of base) {
      for (const tab of COOP_TAB_KEYS) {
        if (coopItemMatchesTab(item, tab)) counts[tab] += 1
      }
    }
    return counts
  }, [coopSearchMatches, cooperations])

  const marketplaceTabCounts = useMemo<Record<MarketplaceTab, number>>(() => {
    const facet = marketplaceProbeFacets?.offerType ?? {}
    return {
      all: marketplaceProbeTotal,
      products: facet.PRODUCT ?? 0,
      services: facet.SERVICE ?? 0,
      vendors: filteredVendors.length,
    }
  }, [marketplaceProbeFacets, marketplaceProbeTotal, filteredVendors.length])

  // Context badges (D2): the REAL query match count when a query is active,
  // otherwise the pre-existing totals. Marketplace's query total is the
  // unscoped probe total (Products + Services + Agent Setups matching the
  // query); coop's is the count of matching items in the loaded coop pool.
  const marketplaceCount = query.trim()
    ? marketplaceProbeTotal
    : (isVendorsTab ? filteredVendors.length : marketplaceTotal)
  const coopCount = coopSearchMatches
    ? coopSearchMatches.length
    : (ecosystemStats?.cooperations?.open ?? 0)
      + (ecosystemStats?.cooperations?.network ?? 0)
      + (ecosystemStats?.offers?.services ?? 0)
      + (ecosystemStats?.offers?.agents ?? 0)

  // ── Auto-switch context when the current one has no results ──────────
  // Both contexts pre-fetch (D7), so the other context's count is already
  // known (now the real query-aware totals). Trigger only when a query is
  // active and both contexts finished loading — avoids switching on initial
  // empty DB or during the first paint.
  useEffect(() => {
    if (!query.trim()) return
    if (searchLoading || coopLoading || marketplaceProbeLoading) return
    if (context === 'coop' && coopCount === 0 && marketplaceCount > 0) {
      setContext('marketplace')
    } else if (context === 'marketplace' && marketplaceCount === 0 && coopCount > 0) {
      setContext('coop')
    }
  }, [query, searchLoading, coopLoading, marketplaceProbeLoading, context, marketplaceCount, coopCount]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── ADR-403: auto-switch the active subtab to where the query matches ──
  // Only when the active subtab has NO matches and another subtab in the same
  // context does — never yanks the user off a tab that still has results.
  useEffect(() => {
    if (!query.trim()) return
    if (context === 'marketplace') {
      if (searchLoading || marketplaceProbeLoading) return
      const best = pickBestTab(marketplaceTabCounts, marketplaceTab, MARKETPLACE_TAB_KEYS, 'all')
      if (best && best !== marketplaceTab) setFilterTab(best)
    } else {
      if (coopLoading) return
      const best = pickBestTab(coopTabCounts, coopTab, COOP_TAB_KEYS, 'all')
      if (best && best !== coopTab) setFilterTab(best)
    }
  }, [query, context, marketplaceTab, coopTab, marketplaceTabCounts, coopTabCounts, searchLoading, marketplaceProbeLoading, coopLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── KPI strip (D6 — context-aware) ───────────────────────────────────
  // ADR-334 D5: coop-context type counts + budgets come from /api/stats'
  // ecosystemStats (honest totals, same source as CoopExplore); "Results" and
  // "Categories" stay list-scoped. Marketplace context keeps its list-scoped
  // counts (FU-522 will add the "X of Y" affordance).
  const kpiItems = useMemo<KPIItem[]>(() => {
    if (context === 'coop') {
      const cs = ecosystemStats?.cooperations
      const totalBudget = cs?.totalBudgetSats ?? 0
      const openBudget = cs?.openBudgetSats ?? 0
      const partners = (ecosystemStats?.vendors ?? 0) + (ecosystemStats?.providers ?? 0)
      const offerServices = ecosystemStats?.offers?.services ?? 0
      const offerAgents = ecosystemStats?.offers?.agents ?? 0
      // ADR-334 D6 follow-up + ADR-368 D4: Results = the real total of browseable
      // cooperation opportunities — OPEN cooperations (incl. Service Bundles) +
      // COOP-type network offers + active SERVICE offers + active AGENT_SETUP
      // offers, not the windowed allItems.length.
      const coopResultsTotal = (cs?.open ?? 0) + (cs?.network ?? 0) + offerServices + offerAgents
      return [
        { icon: <Tag size={14} />, value: coopCategories.filter(c => c.level === 1).length, label: 'Categories', onClick: () => setCategoryOpen(v => !v), active: categoryOpen, heading: 'Browse' },
        { icon: <TrendingUp size={14} />, value: coopResultsTotal, label: 'Results', onClick: () => setFilterTab('all'), active: coopTab === 'all', tooltip: `${coopAllItems.length} of ${coopResultsTotal} loaded${coopAllItems.length < coopResultsTotal ? ' — load more below' : ''}` },
        { icon: <Handshake size={14} />, value: cs?.tenders ?? 0, label: 'Tenders', onClick: () => setFilterTab('tenders'), active: coopTab === 'tenders' },
        // ADR-338: agent-native sibling of Tenders — an open call any AI agent
        // can apply to and win. Filters in-place exactly like Tenders/Projects/
        // Network/Partners (bounty rows are real CoopItems now).
        { icon: <Target size={14} />, value: bountyCounts?.byStatus.OPEN ?? 0, label: 'Bounties', onClick: () => setFilterTab('bounties'), active: coopTab === 'bounties', tooltip: 'Open bounties — AI agents apply, you pick the winner' },
        { icon: <FolderKanban size={14} />, value: cs?.projects ?? 0, label: 'Projects', onClick: () => setFilterTab('projects'), active: coopTab === 'projects' },
        { icon: <Network size={14} />, value: cs?.network ?? 0, label: 'Network', onClick: () => setFilterTab('network'), active: coopTab === 'network' },
        { icon: <Users size={14} />, value: partners, label: 'Partners', onClick: () => setFilterTab('partners'), active: coopTab === 'partners' },
        // ADR-368 D4 (FU-659): unwindowed /api/stats counts, same as CoopExplore.
        // Services = SERVICE offers + Service Bundles — the tab's pool.
        { icon: <Bot size={14} />, value: offerAgents, label: 'Agents', onClick: () => setFilterTab('agents'), active: coopTab === 'agents', tooltip: 'AI Agent Setups ready to hire' },
        { icon: <Handshake size={14} />, value: offerServices + (cs?.service ?? 0), label: 'Services', onClick: () => setFilterTab('services'), active: coopTab === 'services', tooltip: 'Service Offers + Service Bundles' },
        { icon: <Bitcoin size={14} />, value: totalBudget, label: 'Total Budget', color: 'var(--color-warning-primary)', tooltip: `${totalBudget.toLocaleString('de-DE')} sats across all cooperations`, heading: 'Finances', separator: true },
        { icon: <Layers size={14} />, value: openBudget, label: 'Open Budget', color: 'var(--color-status-success)', tooltip: `${openBudget.toLocaleString('de-DE')} sats in open cooperations` },
      ]
    }
    // ADR-335 FU-532: shared helper (mirrors BuyDashboard's identical copy).
    return buildMarketplaceKpi({
      categoriesLevel1Count: categories.filter(c => c.level === 1).length,
      onToggleCategoryOpen: () => setCategoryOpen(v => !v),
      categoryOpen,
      marketplaceTotal,
      filteredOffers,
      filteredVendorsCount: filteredVendors.length,
      activeTab: marketplaceTab,
      onSetTab: setFilterTab,
      itemCount,
      onGoToCart: () => navigate('/buy/cart'),
    })
  }, [context, coopCategories, coopAllItems.length, coopTab, categoryOpen, categories, filteredOffers, filteredVendors.length, marketplaceTab, itemCount, navigate, ecosystemStats, marketplaceTotal, bountyCounts])

  // ── Handlers ─────────────────────────────────────────────────────────
  function setContext(next: SearchContext) {
    if (next === context) return
    const p = new URLSearchParams(searchParams)
    if (next === 'coop') p.delete('context')
    else p.set('context', next)
    // Validate tab for the new context; reset to 'all' if invalid (D5)
    const currentTab = p.get('tab') || ''
    const validKeys: string[] = next === 'coop' ? COOP_TAB_KEYS : MARKETPLACE_TAB_KEYS
    if (!validKeys.includes(currentTab)) {
      p.delete('tab')
      p.delete('offerType')
    }
    // Category trees differ between contexts — clear the stale selection
    setSelectedCategory('')
    // ADR-277 D7: gamma facets differ between contexts too — clear the stale axis/selection
    // so switching contexts can't leak a selection that means nothing in the new one.
    setTaxonomy('standard')
    setSelectedGammaTags([])
    // ADR-313 D2 (FU-421): agent filters only mean anything in marketplace — clear on switch.
    clearAgentFilters()
    // ADR-368 follow-up: same for the coop-side agent axis.
    clearCoopAgentFilters()
    setSearchParams(p, { replace: true })
  }

  function setFilterTab(next: string) {
    // ADR-313 D2 (FU-421): leaving the marketplace 'all' tab clears any
    // agent filter selection so it can't silently narrow other tabs.
    if (context === 'marketplace' && next !== 'all') clearAgentFilters()
    // ADR-368 follow-up: leaving a coop agent-bearing tab (agents/all) clears
    // the coop agent axis so it can't silently empty the other coop tabs.
    if (context === 'coop' && next !== 'agents' && next !== 'all') clearCoopAgentFilters()
    const p = new URLSearchParams(searchParams)
    if (next === 'all') {
      p.delete('tab')
      p.delete('offerType')
    } else {
      p.set('tab', next)
      p.delete('offerType')
    }
    setSearchParams(p, { replace: true })
  }

  function handleSaveFilter() {
    if (!saveFilterName.trim()) return
    saveFilter(saveFilterName.trim(), {
      filterTab: marketplaceTab,
      activeQuery: query,
      selectedCategory,
      sortBy,
    })
    setSaveFilterName('')
    setShowSaveFilterDialog(false)
  }

  function handleAddToCoop(item: CoopItem) {
    navigate('/coop/guide', { state: { prefill: { title: item.title, cooperationType: item.cooperationType } } })
  }
  function canAddToCoop(item: CoopItem) {
    // ADR-338: bounties have their own Apply flow at /bounties/:id — "Add to
    // Coop" (prefill a new human cooperation) doesn't apply.
    // ADR-368 D4: agent/service/bundle items are browseable units with their
    // own buy/coop detail flows — not cooperations to prefill into the guide.
    return item.itemType !== 'network' && item.itemType !== 'vendor' && item.itemType !== 'partner' && item.itemType !== 'bounty' && item.itemType !== 'agent' && item.itemType !== 'service' && item.itemType !== 'bundle'
  }

  const currentFilters = { filterTab: marketplaceTab, activeQuery: query, selectedCategory, sortBy }

  // ADR-333 D5b: marketplace-context sidebar panel renderer. Array order of
  // enabledSidebarPanels IS the top-to-bottom render order. Agent Filters
  // only exist on the 'all' tab (ADR-313 D2 — FU-421), so it collapses to
  // null there and drops out of the stack without leaving a gap.
  function renderSidebarPanel(id: SidebarPanelId) {
    switch (id) {
      case 'locations':
        return <LocationsFilterPanel countryFilter={countryFilter} onCountryChange={setCountryFilter} allCountries={allCountries} facet={locationFacet} loading={locationFacetLoading} />
      case 'images':
        return <ImagesFilterPanel hideNoImageOffers={hideNoImageOffers} onHideNoImageOffersChange={setHideNoImageOffers} />
      case 'categories':
        return (
          <CategoriesFilterPanel
            effectiveTaxonomy={effectiveTaxonomy}
            categories={activeCategories}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
            activeFilterTab={activeTab}
            categoryCountItems={activeCategoryCountItems}
            hideEmptyCategories={hideEmptyCategories}
            showOfferCounts={showOfferCounts}
            gammaTagFacets={activeGammaTagFacets}
            selectedGammaTags={selectedGammaTags}
            onSelectGammaTags={setSelectedGammaTags}
          />
        )
      case 'agentFilters':
        return marketplaceTab === 'all' ? (
          <AgentFilterPanel
            capabilityFacets={agentCapabilityFacets}
            selectedCapabilities={selectedCapabilities}
            onSelectCapabilities={setSelectedCapabilities}
            billingModel={agentBillingModel}
            onBillingModelChange={setAgentBillingModel}
            minReputation={minReputation}
            onMinReputationChange={setMinReputation}
            canvasProvider={canvasProvider}
            onCanvasProviderChange={setCanvasProvider}
            showDivider={false}
          />
        ) : null
    }
  }

  // ADR-363 D6: coop-context panel renderer — the SAME SidebarPanelId contract
  // as the marketplace context, but driving the client pipeline (useCoopFilters)
  // via coopCountryFilter + the shared hideNoImageOffers pref. Locations +
  // Images are the panels the coop item shape supports, identical to
  // CoopExplore.
  function renderCoopSidebarPanel(id: SidebarPanelId) {
    switch (id) {
      case 'locations':
        return <LocationsFilterPanel countryFilter={coopCountryFilter} onCountryChange={setCoopCountryFilter} allCountries={coopCountries} />
      case 'images':
        return <ImagesFilterPanel hideNoImageOffers={hideNoImageOffers} onHideNoImageOffersChange={setHideNoImageOffers} />
      // Coop category tree as a regular toggleable panel (same combined
      // Standard/Gamma entry as the marketplace context) instead of an
      // always-on built-in below the stack.
      case 'categories':
        return (
          <CategoriesFilterPanel
            effectiveTaxonomy={effectiveTaxonomy}
            categories={activeCategories}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
            activeFilterTab={activeTab}
            categoryCountItems={activeCategoryCountItems}
            hideEmptyCategories={hideEmptyCategories}
            showOfferCounts={showOfferCounts}
            gammaTagFacets={activeGammaTagFacets}
            selectedGammaTags={selectedGammaTags}
            onSelectGammaTags={setSelectedGammaTags}
          />
        )
      // ADR-368 follow-up: the coop agent axis only exists on agent-bearing
      // tabs (agents + all) — collapses to null elsewhere so it drops out of
      // the ordered panel stack without leaving a gap.
      case 'agentFilters':
        return coopTab === 'agents' || coopTab === 'all' ? (
          <AgentFilterPanel
            capabilityFacets={coopAgentCapabilityFacets}
            selectedCapabilities={coopSelectedCapabilities}
            onSelectCapabilities={setCoopSelectedCapabilities}
            billingModel={coopAgentBillingModel}
            onBillingModelChange={setCoopAgentBillingModel}
            minReputation={coopMinReputation}
            onMinReputationChange={setCoopMinReputation}
            canvasProvider={coopCanvasProvider}
            onCanvasProviderChange={setCoopCanvasProvider}
            showDivider={false}
          />
        ) : null
      default:
        return null
    }
  }

  return (
    <PageContainer size="wide" spacing="lg" gap="none" className="pt-0!" ref={dashboardRef}>
      {/* ADR-287 / ADR-303 D12 — public read tier gets indexable metadata. */}
      <Seo
        title="Search"
        description="Search products, services, vendors and cooperations across Colabonate. One query, two lenses."
        path="/search"
      />
      <div className="dashboard-animate">
        <PageHeader
          icon={
            <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 9H2V7h5zm0 3H2v2h5zm13.59 7-3.83-3.83c-.8.52-1.74.83-2.76.83-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5c0 1.02-.31 1.96-.83 2.75L22 17.59zM17 11c0-1.65-1.35-3-3-3s-3 1.35-3 3 1.35 3 3 3 3-1.35 3-3M2 19h10v-2H2z" /></svg>
          }
          title="Search & Explore"
          subtitle="One query, two lenses — marketplace and cooperations"
          onBack={() => window.history.back()}
        />

        {!isMobile && (
          <KPIStrip
            items={kpiItems}
            loading={context === 'coop' ? (coopLoading || statsLoading) : searchLoading}
            skeletonCount={6}
            wrap
            collapsible
            storageKey="kpi-search-strip"
            className="mb-2"
          />
        )}

        <SearchHeroBar
          value={query}
          onChange={setQuery}
          onSubmit={(v) => setQuery(v.trim())}
          onOfferSelect={(id) => navigate(`/offers/${id}`)}
          filterChips={inputFilterChips}
        />

        {/* D2 — Context switcher (segmented control, above ListBrowser) */}
        <div className={cn('mt-3', isMobile && 'sticky top-0 z-10 -mx-3 px-3 py-2')}>
          <ContextSwitcher
            context={context}
            onContextChange={setContext}
            marketplaceCount={marketplaceCount}
            coopCount={coopCount}
          />
        </div>

        <div className={isMobile ? 'mt-2' : 'mt-4'}>
          <ListBrowser<Offer | Company | CoopItem>
            items={activeItems}
            loading={activeLoading}
            categoryCountItems={activeCategoryCountItems}
            filterTabs={activeFilterTabs}
            activeFilterTab={activeTab}
            onFilterTabChange={(key) => setFilterTab(key)}
            categories={activeCategories}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
            activeFilterChips={listFilterChips}
            taxonomy={taxonomy}
            onTaxonomyChange={setTaxonomy}
            gammaTagFacets={activeGammaTagFacets}
            selectedGammaTags={selectedGammaTags}
            onSelectGammaTags={setSelectedGammaTags}
            searchQuery={query}
            onSearchQueryChange={setQuery}
            sortBy={sortBy}
            onSortChange={(s) => setSortBy(s as SortOption)}
            sortOptions={activeSortOptions}
            resetDeps={[context, countryFilter, coopCountryFilter, selectedCapabilities, agentBillingModel, minReputation, canvasProvider, coopSelectedCapabilities, coopAgentBillingModel, coopMinReputation, coopCanvasProvider]}
            hideEmptyCategories={hideEmptyCategories}
            showOfferCounts={showOfferCounts}
            categoryOpen={categoryOpen}
            onCategoryOpenChange={setCategoryOpen}
            sidebarExtraTop={
              // ADR-363 D6: the marketplace filter SidePanel is the shared
              // ListingFilterSidebar component (icon toggle group + saved-filter
              // chips + ordered panel stack). The coop context renders the
              // IDENTICAL stack with filterModel="client" — locations + images
              // driving useCoopFilters via coopCountryFilter + the shared
              // hideNoImageOffers pref, exactly like CoopExplore.
              context === 'marketplace' ? (
                <ListingFilterSidebar
                  filterModel="server"
                  availablePanels={['locations', 'images', 'categories', 'agentFilters']}
                  enabledPanels={enabledSidebarPanels}
                  onTogglePanel={toggleSidebarPanel}
                  effectiveTaxonomy={effectiveTaxonomy}
                  onSaveFilter={() => setShowSaveFilterDialog(true)}
                  savedFilterChips={savedFilters.length > 0 ? (
                    <div className="shrink-0 flex flex-col gap-1.5 pb-1.5 mb-1.5" style={{ borderBottom: '1px solid var(--theme-border)' }}>
                      <SaveFilterAction
                        savedFilters={savedFilters}
                        currentFilters={currentFilters}
                        onApplyFilter={(id) => {
                          const filter = savedFilters.find(f => f.id === id)
                          if (filter) {
                            if (filter.filters.filterTab) setFilterTab(filter.filters.filterTab as string)
                            if (filter.filters.selectedCategory) setSelectedCategory(filter.filters.selectedCategory as string)
                            if (filter.filters.activeQuery) setQuery(filter.filters.activeQuery as string)
                            if (filter.filters.sortBy) setSortBy(filter.filters.sortBy as SortOption)
                          }
                        }}
                        onDeleteFilter={deleteFilter}
                        onSaveFilter={() => setShowSaveFilterDialog(true)}
                        showButton={false}
                      />
                    </div>
                  ) : undefined}
                  renderPanel={renderSidebarPanel}
                />
              ) : (
                <ListingFilterSidebar
                  filterModel="client"
                  availablePanels={['locations', 'images', 'categories', 'agentFilters']}
                  enabledPanels={enabledCoopSidebarPanels}
                  onTogglePanel={toggleCoopSidebarPanel}
                  effectiveTaxonomy={taxonomy}
                  renderPanel={renderCoopSidebarPanel}
                />
              )
            }
            hideBuiltinTaxonomyPanel
            renderCard={(item, size, viewMode) => {
              if (context === 'coop') {
                const ci = item as CoopItem
                const onAdd = canAddToCoop(ci) ? () => handleAddToCoop(ci) : undefined
                return viewMode === 'gallery'
                  ? <CoopGalleryCard item={ci} size={size} onAddToCoop={onAdd} />
                  : <CoopListRow item={ci} size={size} onAddToCoop={onAdd} />
              }
              if (isVendorsTab) {
                const company = item as Company
                const oc = vendorOfferCounts.get(company.id) ?? vendorOfferCounts.get(company.ownerPubkey) ?? 0
                return viewMode === 'gallery'
                  ? <VendorGalleryCard company={company} size={size as 'S' | 'M' | 'L'} offerCount={oc} />
                  : <VendorListRow company={company} size={size as 'S' | 'M' | 'L'} offerCount={oc} />
              }
              const offer = item as Offer
              return viewMode === 'gallery'
                ? <OfferGalleryCard offer={offer} size={size} isFavorite={isFavorite(offer.id)} onFavoriteToggle={() => toggleFavorite(offer.id)} onAddToBasket={() => addItem(makeBasketItem(offer))} />
                : <OfferListRow offer={offer} size={size} isFavorite={isFavorite(offer.id)} onFavoriteToggle={() => toggleFavorite(offer.id)} onAddToBasket={() => addItem(makeBasketItem(offer))} />
            }}
            cardKey={(item) => {
              if (context === 'coop') return (item as CoopItem).id
              if (isVendorsTab) return (item as Company).id
              return (item as Offer).id
            }}
            emptyState={
              context === 'coop' ? (
                <CoopEmptyState
                  message={query || selectedCategory ? 'No results found. Try different filters.' : 'No cooperations yet.'}
                  sub={query || selectedCategory ? 'Try clearing some filters.' : 'Use the Coop Guide to start your first cooperation.'}
                />
              ) : (
                <EmptyState
                  icon={isVendorsTab
                    ? <Store size={28} style={{ color: 'var(--theme-text-muted)' }} />
                    : <SearchIcon size={28} style={{ color: 'var(--theme-text-muted)' }} />}
                  message={isVendorsTab
                    ? (query || selectedCategory || countryFilter ? 'No vendors match your filters.' : 'No vendors available yet.')
                    : (query || selectedCategory ? 'No results found. Try different filters.' : 'No offers available yet.')}
                />
              )
            }
            storageKeyPrefix={activeStorageKey}
            defaultScrollMode="unlimited"
            filterFab={isMobile}
            filterFabAlwaysVisible
            // ADR-335 D4/D5: server-driven pagination only for the marketplace
            // offer results — coop items (useCoopFilters) and the Vendors tab
            // (Companies, fully loaded client-side) have no cursor to page through.
            onLoadMore={context === 'marketplace' && !isVendorsTab ? async () => { await fetchMoreOffers() } : undefined}
            hasMore={context === 'marketplace' && !isVendorsTab ? searchHasMore : undefined}
          />
        </div>
      </div>

      {/* D10 — context-aware secondary FAB (tier 2, below the unified Add-FAB) */}
      {context === 'coop'
        ? <CoopFAB topOffset={190} bottomOffset="calc(58px + env(safe-area-inset-bottom, 0px) + 132px)" />
        : <CartFAB topOffset={190} bottomOffset="calc(58px + env(safe-area-inset-bottom, 0px) + 132px)" />}

      {/* Unified Add-FAB (tier 1) — identical action set as CoopExplore. */}
      <FloatingAddButton
        offsetRight={40}
        offsetTop={130}
        actions={fabActions}
      />

      {/* Save-filter dialog (marketplace context, mirrors BuyDashboard) */}
      <Dialog
        open={showSaveFilterDialog}
        onClose={() => setShowSaveFilterDialog(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontSize: 16, fontWeight: 600 }}>
          Save Filter
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            variant="outlined"
            size="small"
            placeholder="e.g. Vegan products under 5000 sats"
            value={saveFilterName}
            onChange={(e) => setSaveFilterName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveFilter()}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowSaveFilterDialog(false)} sx={{ color: 'var(--theme-text-muted)' }}>
            Cancel
          </Button>
          <Button
            onClick={handleSaveFilter}
            variant="contained"
            disabled={!saveFilterName.trim()}
            sx={{ backgroundColor: 'var(--color-primary-50)' }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  )
}

// ── Context switcher (D2 — segmented control, local to Search.tsx) ─────

function ContextSwitcher({
  context, onContextChange, marketplaceCount, coopCount,
}: {
  context: SearchContext
  onContextChange: (c: SearchContext) => void
  marketplaceCount: number
  coopCount: number
}) {
  return (
    <div
      className="flex gap-1 p-1 rounded-xl w-full"
      style={{ background: 'var(--theme-bg-subtle)' }}
      role="tablist"
      aria-label="Search context"
    >
      <ContextSegment
        active={context === 'coop'}
        onClick={() => onContextChange('coop')}
        icon={<Handshake size={14} />}
        label="Cooperate"
        count={coopCount}
      />
      <ContextSegment
        active={context === 'marketplace'}
        onClick={() => onContextChange('marketplace')}
        icon={<ShoppingBag size={14} />}
        label="Marketplace"
        count={marketplaceCount}
      />
    </div>
  )
}

function ContextSegment({
  active, onClick, icon, label, count,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  count: number
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg',
        'text-sm font-semibold cursor-pointer transition-all duration-150',
      )}
      style={{
        background: active ? 'var(--color-primary-50)' : 'transparent',
        color: active ? 'white' : 'var(--theme-text-muted)',
        boxShadow: active ? '0 1px 4px rgba(0,0,0,0.12)' : 'none',
      }}
    >
      {icon}
      <span>{label}</span>
      {count > 0 && (
        <span
          className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold"
          style={{
            background: active ? 'rgba(255,255,255,0.25)' : 'var(--theme-bg)',
            color: active ? 'white' : 'var(--theme-text)',
          }}
        >
          {count}
        </span>
      )}
    </button>
  )
}
