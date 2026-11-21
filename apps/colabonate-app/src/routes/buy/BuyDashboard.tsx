import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button } from '@mui/material'
import {
  ShoppingBag, Search, Store,
  X, Heart, MapPin,
} from 'lucide-react'
import { PageContainer } from '@ds/ui'
import { KPIStrip } from '../../components/kpi/KpiStrip'
import type { KPIItem } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { Seo } from '../../components/Seo'
import { CartFAB } from '../../components/ui'
import { SearchInput } from '../../components/ui/SearchInput'
import { ListBrowser } from '../../components/list-browser'
import type { ListBrowserSortOption, TaxonomyAxis } from '../../components/list-browser'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { usePref } from '../../utils/userPreferences'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { useCart } from '../../context/CartContext'
import { useNotification } from '../../context/NotificationContext'
import { useFavoritesWithUndo } from '../../hooks/useFavorites'
import { useFilterFavorites } from '../../hooks/useFilterFavorites'
import { useOfferSearchInfinite, useSearchFacets } from '../../hooks/useOfferSearch'
import { useImageValidity } from '../../hooks/useImageValidity'
import { useSessionState } from '../../hooks/useSessionState'
import { initialCountryFilter } from '../../lib/initial-country-filter'
import { COUNTRIES } from '../../components/offers/offerFormConstants'
import {
  useStandardCategories,
  useCompanies,
  useCategoryCounts,
} from '../../hooks/useEntityQueries'
import type { Offer, Company } from '../../types/api'
import {
  OfferGalleryCard, OfferListRow, EmptyState,
} from './marketplace-cards'
import { VendorGalleryCard, VendorListRow, makeBasketItem, SaveFilterAction, ImagesFilterPanel, LocationsFilterPanel, CategoriesFilterPanel, AgentFilterPanel, type SidebarPanelId } from './components'
import { ListingFilterSidebar } from '../../components/listings/ListingFilterSidebar'
import type { ActiveFilterChip } from '../../components/list-browser/list-browser.types'
import {
  buildFilteredOffers, buildFilteredVendors, buildVendorOfferCounts,
  buildGammaTagFacets, buildAgentCapabilityFacets,
} from '../../components/marketplace/filterPipeline'
import { buildMarketplaceKpi } from '../../components/marketplace/kpiItems'

export type FilterTab = 'all' | 'products' | 'services' | 'vendors'
export type SortOption = 'newest' | 'price-asc' | 'price-desc' | 'name'
export type VendorSortOption = 'newest' | 'name'

const FILTER_TABS = [
  { key: 'all', label: 'All' },
  { key: 'products', label: 'Products' },
  { key: 'services', label: 'Services' },
  { key: 'vendors', label: 'Vendors' },
]

const OFFER_SORT_OPTIONS: ListBrowserSortOption[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'price-asc', label: 'Price ↑' },
  { value: 'price-desc', label: 'Price ↓' },
  { value: 'name', label: 'Name A–Z' },
]

const VENDOR_SORT_OPTIONS: ListBrowserSortOption[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'name', label: 'Name A–Z' },
]

export function BuyDashboard() {
  // Filter state persists across in-app navigation within the session
  // (sessionStorage) so switching pages and coming back keeps the user's
  // query / sort / category / country. `filterTab` stays URL-derived below.
  const [query, setQuery] = useSessionState<string>('buy:query', '')
  const [sortBy, setSortBy] = useSessionState<SortOption | VendorSortOption>('buy:sortBy', 'newest')
  const [selectedCategory, setSelectedCategory] = useSessionState<string>('buy:selectedCategory', '')
  // ADR-277 D7: taxonomy defaults to 'standard' — ListBrowser hydrates it from
  // localStorage on mount if the user previously switched to 'gamma'.
  const [taxonomy, setTaxonomy] = useState<TaxonomyAxis>('standard')
  const [selectedGammaTags, setSelectedGammaTags] = useSessionState<string[]>('buy:selectedGammaTags', [])
  // ADR-313 D2/D3 (FU-421): AGENT_SETUP-only filters, forwarded to useOfferSearch.
  // Only meaningful on the 'all' tab (the only tab AGENT_SETUP offers appear
  // under today — see clearAgentFilters below).
  const [selectedCapabilities, setSelectedCapabilities] = useSessionState<string[]>('buy:selectedCapabilities', [])
  const [agentBillingModel, setAgentBillingModel] = useSessionState<string>('buy:agentBillingModel', '')
  const [minReputation, setMinReputation] = useSessionState<number>('buy:minReputation', 0)
  // ADR-370 D6 (Phase 2): canvas axis — '' = any canvas.
  const [canvasProvider, setCanvasProvider] = useSessionState<string>('buy:canvasProvider', '')
  const [userCountry] = usePref('userCountry', '')
  const [categoryOpen, setCategoryOpen] = useState(true)
  const [showSaveFilterDialog, setShowSaveFilterDialog] = useState(false)
  const [saveFilterName, setSaveFilterName] = useState('')

  const { isMobile } = useBreakpoint()

  const [searchParams, setSearchParams] = useSearchParams()
  const showFavoritesOnly = searchParams.get('favorites') === 'true'
  const companyIdFilter = searchParams.get('companyId') || ''
  const sellerPubkeyFilter = searchParams.get('sellerPubkey') || ''
  const urlTab = searchParams.get('tab') || ''

  // ADR-418 D6 (FU-1019): starts on All countries. The saved profile country only
  // scopes the view when Home's Nearby/Region link asks for it (`?proximity=`), and
  // only if it is a known ISO code. `proximity=world` stays unscoped. A previous
  // session selection resumes. The scope is visible and clearable in the sidebar.
  const [countryFilter, setCountryFilter] = useSessionState<string>(
    'buy:countryFilter',
    () => initialCountryFilter(userCountry, searchParams.get('proximity')),
    () => (searchParams.get('proximity') === 'world' ? '' : undefined),
  )
  const { showSnackbarWithUndo } = useNotification()
  const { isFavorite, toggleFavorite } = useFavoritesWithUndo({
    entityType: 'offer',
    showSnackbarWithUndo,
  })
  const { savedFilters, saveFilter, deleteFilter } = useFilterFavorites({ route: '/buy/dashboard' })

  const { addItem, itemCount } = useCart()
  const navigate = useNavigate()
  const dashboardRef = usePageAnimation([
    { selector: '.dashboard-animate', from: { duration: 0.5, stagger: 0.12, y: 24 } },
  ])
  const [hideEmptyCategories] = usePref('hideEmptyCategories', false)
  const [showOfferCounts] = usePref('showOfferCounts', true)
  // Offers without images are hidden by default; the sidebar Images toggle
  // re-shows them. Shared pref key with Search.tsx so the setting is
  // consistent across both marketplace surfaces.
  const [hideNoImageOffers, setHideNoImageOffers] = usePref('hideNoImageOffers', true)

  // ADR-333 D1 (same configurable panel stack as Search's marketplace context):
  // which sidebar panels are visible, in click order. Categories is the primary
  // filter; Locations starts on, Images + Agent Filters are secondary/off.
  const [enabledSidebarPanels, setEnabledSidebarPanels] = useSessionState<SidebarPanelId[]>(
    'buy:sidebarPanels',
    ['locations', 'categories', 'agentFilters'],
  )
  function toggleSidebarPanel(id: SidebarPanelId) {
    setEnabledSidebarPanels(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id])
  }

  // ── Tab state: lift from URL so /buy?tab=vendors is deep-linkable ─────
  const filterTab: FilterTab = (['all', 'products', 'services', 'vendors'] as const).includes(urlTab as FilterTab)
    ? (urlTab as FilterTab)
    : 'all'

  function setFilterTab(next: FilterTab) {
    const nextParams = new URLSearchParams(searchParams)
    if (next === 'all') {
      nextParams.delete('tab')
    } else {
      nextParams.set('tab', next)
    }
    setSearchParams(nextParams, { replace: true })
  }

  useEffect(() => {
    if (!categoryOpen && document.activeElement instanceof HTMLElement) {
      const sidebar = dashboardRef.current
      if (sidebar?.contains(document.activeElement)) {
        document.activeElement.blur()
      }
    }
  }, [categoryOpen, dashboardRef])

  // ADR-277 D7: the two axes are mutually exclusive — only the active axis's
  // selection narrows the server-side search.
  // ADR-283 D1+D5: companyId / sellerPubkey are forwarded to the server so the
  // deep-linked seller filter (BuyProductDetail → /buy?sellerPubkey=…) returns
  // the right offers instead of being applied only client-side over a 100-row
  // server cap. ADR-283 D5: when a seller filter is active, the session-stored
  // country is ignored — the user is browsing that seller's full catalogue, not
  // their own saved country. `countryFilter` stays in sessionStorage so
  // clearing the seller filter resumes the user's saved location scope.
  const searchParamsObj = useMemo(() => {
    const sellerFilterActive = !!(companyIdFilter || sellerPubkeyFilter)
    return {
      q: query || undefined,
      offerType: filterTab === 'products' ? 'PRODUCT' : filterTab === 'services' ? 'SERVICE' : undefined,
      categoryCode: taxonomy === 'standard' ? (selectedCategory || undefined) : undefined,
      country: sellerFilterActive ? undefined : (countryFilter || undefined),
      companyId: companyIdFilter || undefined,
      creatorPubkey: sellerPubkeyFilter || undefined,
      // ADR-313 D2 (FU-421): AGENT_SETUP-only filters — only meaningful on the
      // 'all' tab (the only tab where AGENT_SETUP offers appear; products/
      // services have no agentProfile, so applying these there would zero
      // out every result). AgentFilterPanel is only rendered on that tab too.
      ...(filterTab === 'all' ? {
        capability: selectedCapabilities.length > 0 ? selectedCapabilities : undefined,
        minReputation: minReputation > 0 ? minReputation : undefined,
        agentBillingModel: agentBillingModel || undefined,
        canvasProvider: canvasProvider || undefined,
      } : {}),
    }
  }, [query, filterTab, selectedCategory, countryFilter, taxonomy, companyIdFilter, sellerPubkeyFilter, selectedCapabilities, minReputation, agentBillingModel, canvasProvider])

  // ADR-335 D3/D5: cursor-paginated — lifts the 100-row hard cap. First batch
  // loads 100, "Load more"/scroll-to-end fetches the next via fetchNextPage.
  const {
    hits: searchResults = [],
    total: marketplaceTotal = 0,
    isLoading: searchLoading,
    hasNextPage: searchHasMore,
    fetchNextPage: fetchMoreOffers,
  } = useOfferSearchInfinite(searchParamsObj, 100)

  // ADR-418 D1/D3: server-side country facet for the Location panel (disjunctive:
  // the hook strips `country` from the request and the cache key).
  const { data: locationFacet, isLoading: locationFacetLoading } = useSearchFacets(searchParamsObj)
  // Probes first-image URLs so the Images toggle also catches dead URLs and
  // 1x1 placeholder pixels, not just empty arrays (see useImageValidity).
  const searchImageUrls = useMemo(() => searchResults.map(o => Array.isArray(o.images) ? o.images[0] : (typeof o.images === 'string' ? o.images : undefined)), [searchResults])
  const { isUsableImage } = useImageValidity(searchImageUrls)
  const { data: categories = [] } = useStandardCategories()
  const { data: companies = [] } = useCompanies()
  // Same filters as the offer search (minus the category itself) so the
  // per-category badges always match the visible result count.
  const countParams = useMemo(() => ({
    q: searchParamsObj.q,
    offerType: searchParamsObj.offerType,
    country: searchParamsObj.country,
    companyId: searchParamsObj.companyId,
    creatorPubkey: searchParamsObj.creatorPubkey,
  }), [searchParamsObj])
  const { data: categoryCounts = {} } = useCategoryCounts(countParams)

  const loading = searchLoading

  function clearSellerFilter() {
    if (!searchParams.has('companyId') && !searchParams.has('sellerPubkey')) return
    const next = new URLSearchParams(searchParams)
    next.delete('companyId')
    next.delete('sellerPubkey')
    setSearchParams(next, { replace: true })
  }

  // ADR-313 D2 (FU-421): reset agent filters when leaving the only tab they
  // apply to, so a stale capability/reputation/billing selection can't keep
  // silently zeroing out the products/services/vendors tabs.
  function clearAgentFilters() {
    setSelectedCapabilities([])
    setAgentBillingModel('')
    setMinReputation(0)
    setCanvasProvider('')
  }

  // ADR-277 D4/D7: frequency-sorted gamma tag facets, computed from the SAME
  // pre-gamma-filter set used everywhere else (search-filtered by query/
  // country/offerType, but NOT yet narrowed by the gamma selection itself) —
  // otherwise sibling counts would collapse to 0 as soon as one tag is picked.
  // ADR-335 FU-532: shared pure helper (mirrors Search.tsx's identical copy).
  const gammaTagFacets = useMemo(() => buildGammaTagFacets(searchResults), [searchResults])

  // ADR-313 D2/D3 (FU-421): frequency-sorted capability facets, mirrors
  // gammaTagFacets above but derived from AGENT_SETUP offers' joined
  // agentProfile.capabilities (no dedicated capability-facet endpoint exists —
  // same "derive from the loaded result set" approach as the gamma axis).
  const agentCapabilityFacets = useMemo(() => buildAgentCapabilityFacets(searchResults), [searchResults])

  const filteredOffers = useMemo(() => buildFilteredOffers({
    searchResults, showFavoritesOnly, isFavorite, hideNoImageOffers, isUsableImage,
    taxonomy, selectedGammaTags, sortBy,
  }), [searchResults, showFavoritesOnly, isFavorite, sortBy, taxonomy, selectedGammaTags, hideNoImageOffers, isUsableImage])

  // ── Vendor filtering (client-side MVP) ─────────────────────────────────
  const vendorOfferCounts = useMemo(() => buildVendorOfferCounts(searchResults), [searchResults])

  const filteredVendors = useMemo(() => buildFilteredVendors({
    companies, query, countryFilter, selectedCategory, searchResults,
    companyId: companyIdFilter, sellerPubkey: sellerPubkeyFilter, sortBy,
  }), [companies, query, countryFilter, selectedCategory, searchResults, companyIdFilter, sellerPubkeyFilter, sortBy])

  const offersForPanel = useMemo(() => {
    return Object.entries(categoryCounts).flatMap(([categoryCode, count]) =>
      Array.from({ length: count }, () => ({ categoryCode })),
    )
  }, [categoryCounts])

  const allCountries = useMemo(() => {
    const set = new Set<string>()
    searchResults.forEach(o => { if (o.country) set.add(o.country) })
    return Array.from(set).sort()
  }, [searchResults])

  // KPI "Results" reads the filter-aware total from /api/search's
  // estimatedTotalHits (ADR-334 D6 follow-up) instead of the 100-capped
  // filteredOffers.length — so the count never gets stuck at 100 when the
  // DB has 715 matching offers.
  const kpiItems = useMemo<KPIItem[]>(() => buildMarketplaceKpi({
    categoriesLevel1Count: categories.filter(c => c.level === 1).length,
    onToggleCategoryOpen: () => setCategoryOpen(v => !v),
    categoryOpen,
    marketplaceTotal,
    filteredOffers,
    filteredVendorsCount: filteredVendors.length,
    activeTab: filterTab,
    onSetTab: (tab) => setFilterTab(tab as FilterTab),
    itemCount,
    onGoToCart: () => navigate('/buy/cart'),
  }), [marketplaceTotal, filteredOffers, filteredVendors.length, categories, categoryOpen, filterTab, itemCount, navigate])

  function handleSaveFilter() {
    if (!saveFilterName.trim()) return
    saveFilter(saveFilterName.trim(), {
      filterTab,
      activeQuery: query,
      selectedCategory,
      sortBy,
    })
    setSaveFilterName('')
    setShowSaveFilterDialog(false)
  }

  const filteredCompany = companyIdFilter
    ? companies.find(c => c.id === companyIdFilter)
    : undefined

  const sellerFilterInfo = (filteredCompany || sellerPubkeyFilter)
    ? {
        label: filteredCompany ? filteredCompany.name : sellerPubkeyFilter.slice(0, 16) + '...',
        offerCount: filteredOffers.length,
      }
    : undefined

  const currentFilters = { filterTab, activeQuery: query, selectedCategory, sortBy }

  const isVendorsTab = filterTab === 'vendors'
  const activeSortOptions = isVendorsTab ? VENDOR_SORT_OPTIONS : OFFER_SORT_OPTIONS
  const activeItems = isVendorsTab ? filteredVendors : filteredOffers
  const activeLoading = isVendorsTab ? false : loading
  const activeCategoryCountItems = isVendorsTab ? searchResults : offersForPanel

  // Gamma axis is unavailable for vendors (Companies carry no gamma tags).
  const effectiveTaxonomy: TaxonomyAxis = isVendorsTab || gammaTagFacets.length === 0 ? 'standard' : taxonomy

  // Consumer-owned filters surfaced as dismissible chips under the list header
  // (ListBrowser already renders the query/category/gamma chips) so the
  // persisted country scope and any seller filter are visible + clearable.
  const activeFilterChips: ActiveFilterChip[] = [
    ...(countryFilter ? [{
      id: 'country',
      label: COUNTRIES.find(c => c.code === countryFilter)?.name ?? countryFilter,
      icon: <MapPin size={11} />,
      onRemove: () => setCountryFilter(''),
    }] : []),
    ...((filteredCompany || sellerPubkeyFilter) ? [{
      id: 'seller',
      label: filteredCompany ? filteredCompany.name : sellerPubkeyFilter.slice(0, 16) + '...',
      icon: <Store size={11} />,
      onRemove: clearSellerFilter,
    }] : []),
  ]

  // ADR-333 D5b: marketplace-context sidebar panel renderer — mirrors Search's
  // marketplace context so both surfaces use the identical configurable stack.
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
            categories={categories}
            selectedCategory={selectedCategory}
            onSelectCategory={(slug) => { clearSellerFilter(); setSelectedCategory(slug) }}
            activeFilterTab={filterTab}
            categoryCountItems={activeCategoryCountItems}
            hideEmptyCategories={hideEmptyCategories}
            showOfferCounts={showOfferCounts}
            gammaTagFacets={isVendorsTab ? [] : gammaTagFacets}
            selectedGammaTags={selectedGammaTags}
            onSelectGammaTags={(tags) => { clearSellerFilter(); setSelectedGammaTags(tags) }}
          />
        )
      // ADR-313 D2 (FU-421): AGENT_SETUP offers only surface on the 'all' tab
      // (and vendor rows carry no agent signals) — collapse to null elsewhere.
      case 'agentFilters':
        return filterTab === 'all' && !isVendorsTab ? (
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

  return (
    // gap="none" + explicit section margins mirrors BountyBoard/CoopExplore
    // (user feedback 2026-08-24): top edge flush (pt-0!), KPI strip 8px
    // (mb-2) above the list — the default PageContainer gap (24/32px) had
    // each section floating too far apart.
    <PageContainer size="wide" spacing="lg" gap="none" className="pt-0!" ref={dashboardRef}>
      {/* ADR-287 / ADR-303 D12 — public read tier gets indexable metadata. */}
      <Seo
        title="Marketplace"
        description="Browse products, services and local vendors on Colabonate. Buy with Bitcoin Lightning, no account required to browse."
        path="/buy"
      />
      <PageHeader
        icon={<ShoppingBag size={18} />}
        title={filteredCompany?.name ? `Offers by ${filteredCompany.name}` : sellerPubkeyFilter ? `Offers by ${sellerPubkeyFilter.slice(0, 16)}...` : 'Marketplace'}
        subtitle={(!filteredCompany && !sellerPubkeyFilter) ? 'Discover products, services, and local vendors' : undefined}
        onBack={() => window.history.back()}
      />

      {!isMobile && (
        <div className="mb-2">
          <KPIStrip items={kpiItems} loading={loading} skeletonCount={6} wrap collapsible storageKey="kpi-buy-dashboard-strip" />
        </div>
      )}

      {/* PageHeader + KPIStrip both render nothing on mobile (title lives in the
          bottom nav instead) — no top margin so the category panel starts
          flush. Desktop spacing comes from the KPI wrapper's mb-2 above (same
          as BountyBoard's ListHeader slot). */}
      <div className="dashboard-animate">
        <ListBrowser<Offer | Company>
          items={activeItems}
          loading={activeLoading}
          categoryCountItems={activeCategoryCountItems}
          filterTabs={FILTER_TABS}
          activeFilterTab={filterTab}
          onFilterTabChange={(key) => { clearSellerFilter(); if (key !== 'all') clearAgentFilters(); setFilterTab(key as FilterTab) }}
          categories={categories}
          selectedCategory={selectedCategory}
          onSelectCategory={(slug) => { clearSellerFilter(); setSelectedCategory(slug) }}
          taxonomy={taxonomy}
          onTaxonomyChange={setTaxonomy}
          // ADR-277 D8: Vendors are Companies, not NIP-99 listings — no gamma axis for them.
          gammaTagFacets={isVendorsTab ? [] : gammaTagFacets}
          selectedGammaTags={selectedGammaTags}
          onSelectGammaTags={(tags) => { clearSellerFilter(); setSelectedGammaTags(tags) }}
          searchQuery={query}
          onSearchQueryChange={(q) => { setQuery(q); clearSellerFilter() }}
          sortBy={sortBy}
          onSortChange={(s) => { clearSellerFilter(); setSortBy(s as SortOption | VendorSortOption) }}
          sortOptions={activeSortOptions}
          resetDeps={[companyIdFilter, sellerPubkeyFilter, countryFilter, selectedCapabilities, agentBillingModel, minReputation, canvasProvider]}
          hideEmptyCategories={hideEmptyCategories}
          showOfferCounts={showOfferCounts}
          categoryOpen={categoryOpen}
          onCategoryOpenChange={setCategoryOpen}
          sidebarExtraTop={
            // ADR-333 D5b: identical configurable panel stack as Search's
            // marketplace context (icon toggle group + saved-filter chips +
            // ordered panels). Category tree is a toggleable panel here.
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
                      clearSellerFilter()
                      const filter = savedFilters.find(f => f.id === id)
                      if (filter) {
                        if (filter.filters.filterTab) setFilterTab(filter.filters.filterTab as FilterTab)
                        if (filter.filters.selectedCategory) setSelectedCategory(filter.filters.selectedCategory as string)
                        if (filter.filters.activeQuery) setQuery(filter.filters.activeQuery as string)
                        if (filter.filters.sortBy) setSortBy(filter.filters.sortBy as SortOption | VendorSortOption)
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
          }
          sidebarExtraBottom={
            sellerFilterInfo ? (
              <SidebarSellerFilterInfo info={sellerFilterInfo} onClear={clearSellerFilter} />
            ) : undefined
          }
          hideBuiltinTaxonomyPanel
          activeFilterChips={activeFilterChips}
          headerLeadingActions={[
            <button
              key="favorites"
              onClick={() => {
                if (showFavoritesOnly) setSearchParams({})
                else setSearchParams({ favorites: 'true' })
              }}
              className="flex items-center justify-center rounded-lg cursor-pointer"
              style={{
                width: 36, height: 36,
                background: showFavoritesOnly ? '#E84541' : 'var(--theme-bg-subtle)',
                color: showFavoritesOnly ? 'white' : 'var(--theme-text-muted)',
                border: showFavoritesOnly ? 'none' : '1px solid var(--theme-border)',
              }}
              title={showFavoritesOnly ? 'Show all' : 'Show favorites only'}
            >
              <Heart size={15} className={showFavoritesOnly ? 'fill-white' : ''} />
            </button>,
          ]}
          headerActions={[
            <SearchInput
              key="search"
              variant="toggle"
              size="md"
              value={query}
              onChange={(q) => { setQuery(q); clearSellerFilter() }}
              onClear={() => { setQuery(''); clearSellerFilter() }}
              placeholder="Search products, services & vendors…"
              ariaLabel="Search offers"
            />,
          ]}
          renderCard={(item, size, viewMode) => {
            if (isVendorsTab) {
              const company = item as Company
              return viewMode === 'gallery' ? (
                <VendorGalleryCard
                  company={company}
                  size={size as 'S' | 'M' | 'L'}
                  offerCount={vendorOfferCounts.get(company.id) ?? vendorOfferCounts.get(company.ownerPubkey) ?? 0}
                />
              ) : (
                <VendorListRow
                  company={company}
                  size={size as 'S' | 'M' | 'L'}
                  offerCount={vendorOfferCounts.get(company.id) ?? vendorOfferCounts.get(company.ownerPubkey) ?? 0}
                />
              )
            }
            const offer = item as Offer
            return viewMode === 'gallery' ? (
              <OfferGalleryCard
                offer={offer}
                size={size}
                isFavorite={isFavorite(offer.id)}
                onFavoriteToggle={() => toggleFavorite(offer.id)}
                onAddToBasket={() => addItem(makeBasketItem(offer))}
              />
            ) : (
              <OfferListRow
                offer={offer}
                size={size}
                isFavorite={isFavorite(offer.id)}
                onFavoriteToggle={() => toggleFavorite(offer.id)}
                onAddToBasket={() => addItem(makeBasketItem(offer))}
              />
            )
          }}
          cardKey={(item) => isVendorsTab ? (item as Company).id : (item as Offer).id}
          emptyState={
            <EmptyState
              icon={isVendorsTab ? <Store size={28} style={{ color: 'var(--theme-text-muted)' }} /> : <Search size={28} style={{ color: 'var(--theme-text-muted)' }} />}
              message={
                isVendorsTab
                  ? (query || selectedCategory || countryFilter ? 'No vendors match your filters.' : 'No vendors available yet.')
                  : (query || selectedCategory ? 'No results found. Try different filters.' : 'No offers available yet.')
              }
            />
          }
          storageKeyPrefix="buyDashboard"
          defaultScrollMode="unlimited"
          filterFab
          // ADR-335 D4/D5: server-driven pagination only applies to the offer
          // search results — the Vendors tab (Companies) is fully loaded
          // client-side via useCompanies and has no cursor to page through.
          onLoadMore={isVendorsTab ? undefined : async () => { await fetchMoreOffers() }}
          hasMore={isVendorsTab ? undefined : searchHasMore}
        />
      </div>

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

      <CartFAB />
    </PageContainer>
  )
}

// ── Sidebar extras (Buy-specific; rendered around the shared CategorySidebar, ADR-218 D7) ──
// SidebarSavedFilters is now shared via routes/buy/components (ADR-237 review #3).
// SidebarSellerFilterInfo stays local — only BuyDashboard has seller deep-links.

function SidebarSellerFilterInfo({ info, onClear }: { info: { label: string; offerCount?: number }; onClear: () => void }) {
  return (
    <div className="mt-2 shrink-0">
      <div
        className="flex items-center w-full gap-3 text-left rounded-lg"
        style={{ padding: '10px 12px', background: 'rgba(99,179,237,0.12)', border: '1px solid rgba(99,179,237,0.30)' }}
      >
        <div
          className="flex items-center justify-center rounded-lg shrink-0"
          style={{ width: 32, height: 32, background: 'rgba(99,179,237,0.14)' }}
        >
          <Store size={16} style={{ color: 'var(--color-primary-50)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold truncate" style={{ color: 'var(--color-primary-50)' }}>
            {info.label}
          </div>
          {info.offerCount !== undefined && (
            <div className="text-[10px]" style={{ color: 'rgba(99,179,237,0.7)' }}>
              {info.offerCount} {info.offerCount === 1 ? 'item' : 'items'}
            </div>
          )}
        </div>
        <button
          onClick={onClear}
          className="flex items-center justify-center transition-opacity rounded-full cursor-pointer shrink-0 hover:opacity-70"
          style={{ width: 18, height: 18, background: 'rgba(99,179,237,0.20)', border: 'none', padding: 0 }}
          aria-label="Clear seller filter"
        >
          <X size={10} style={{ color: 'var(--color-primary-50)' }} />
        </button>
      </div>
    </div>
  )
}
