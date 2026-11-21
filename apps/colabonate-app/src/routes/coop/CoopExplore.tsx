// Cooperation Explore – /coop (ADR-218 D3/D4; ADR-220 — unified filter tree)
//
// ADR-220 (revised): the cooperation types are folded INTO the existing category
// filter as synthetic level-1 entries, so `CategorySidebar` (Desktop) and
// `CategoryTopPanel` (Mobile) render them natively — no extra filter section.
// The Goods/Digital subtrees are dropped for the coop context; only the
// Services subtree remains alongside the cooperation types.

import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Handshake, FolderKanban, Network, Bitcoin, Layers, Tag, TrendingUp, Users, Target, Bot, MapPin,
} from 'lucide-react'
import { PageContainer, FloatingAddButton } from '@ds/ui'
import { KPIStrip } from '../../components/kpi/KpiStrip'
import type { KPIItem } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { CoopFAB } from '../../components/ui'
import { SearchInput } from '../../components/ui/SearchInput'
import { Seo } from '../../components/Seo'
import { ListBrowser } from '../../components/list-browser'
import type { ListBrowserSortOption, TaxonomyAxis } from '../../components/list-browser'
import type { ActiveFilterChip } from '../../components/list-browser/list-browser.types'
import { COUNTRIES } from '../../components/offers/offerFormConstants'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useSessionState } from '../../hooks/useSessionState'
import { usePref } from '../../utils/userPreferences'
import { useFABActions } from '../../context/FABContext'
import { useCoopExploreData } from '../../hooks/useCoopExploreData'
import { useEcosystemStats } from '../../hooks/useEntityQueries'
import { useAgentTaskCounts } from '../../hooks/useAgentTaskQueries'
import { ListingFilterSidebar } from '../../components/listings/ListingFilterSidebar'
import { LocationsFilterPanel, ImagesFilterPanel, AgentFilterPanel, CategoriesFilterPanel, type SidebarPanelId } from '../buy/components'
import {
  CoopGalleryCard, CoopListRow, CoopEmptyState,
  type CoopItem,
} from './coop-cards'
import { useCoopFilters } from './coop-filters'

// ADR-368 D4: filter tabs extended with `agents` (AGENT_SETUP offers) and
// `services` (SERVICE offers + Service Bundles) — order mirrors the ADR.
type FilterTab = 'all' | 'tenders' | 'bounties' | 'projects' | 'network' | 'partners' | 'agents' | 'services'
type SortOption = 'newest' | 'name' | 'price-asc' | 'price-desc'

// Coop filter tabs (mirrors BuyDashboard's `FILTER_TABS` pattern).
const FILTER_TABS: Array<{ key: FilterTab; label: string }> = [
  { key: 'all',      label: 'All'      },
  { key: 'tenders',  label: 'Tenders'  },
  { key: 'bounties', label: 'Bounties' },
  { key: 'projects', label: 'Projects' },
  { key: 'network',  label: 'Network'  },
  { key: 'partners', label: 'Partners' },
  { key: 'agents',   label: 'Agents'   },
  { key: 'services', label: 'Services' },
]

// ADR-218 D11: full 4-option sort menu (was Newest/Name only), keyed on cooperations.budgetSats.
const SORT_OPTIONS: ListBrowserSortOption[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'price-asc', label: 'Budget ↑' },
  { value: 'price-desc', label: 'Budget ↓' },
  { value: 'name', label: 'Name A–Z' },
]

const POLL_INTERVAL = Number(import.meta.env.VITE_POLL_INTERVAL_MS) || 30_000

// Coop-type category constants + filter/sort memos are shared with /search
// via ./coop-filters (ADR-237 review finding #2 — prevents drift between the
// two coop surfaces).

function mapFilterParam(param: string | null): FilterTab {
  if (param === 'projects') return 'projects'
  if (param === 'tenders' || param === 'offers') return 'tenders'
  if (param === 'bounties' || param === 'bounty') return 'bounties'
  if (param === 'networks') return 'network'
  if (param === 'partners' || param === 'vendors') return 'partners'
  if (param === 'agents' || param === 'agent') return 'agents'
  if (param === 'services' || param === 'service') return 'services'
  return 'all'
}

export function CoopExplore() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { isMobile } = useBreakpoint()

  // Data fetching — shared with /search via useCoopExploreData (ADR-237 FU-237-C).
  const { categories, cooperations, loading } = useCoopExploreData({ pollInterval: POLL_INTERVAL })
  // ADR-334 D5: server-aggregated coop totals for the KPI strip — the windowed
  // useCoopExploreData pool (≤100 per source) keeps feeding the result list.
  const { data: ecosystemStats, isLoading: statsLoading } = useEcosystemStats()
  // ADR-338: exact unwindowed open-bounty count for the "Bounties" KPI chip —
  // ecosystemStats has no bounty count; bounty rows themselves render inline
  // via agentTaskToCoopItem (useCoopExploreData.ts), same as Search.tsx.
  const { data: bountyCounts } = useAgentTaskCounts()

  // Filter state persists across in-app navigation within the session
  // (sessionStorage, ADR-242) so visiting a detail page and coming back keeps
  // the user's query / tab / sort / category. `filter` URL deep-link wins on
  // mount (and becomes the new session value); otherwise the previous session
  // selection resumes.
  const [query, setQuery] = useSessionState<string>('coop:query', '')
  const [activeQuery, setActiveQuery] = useSessionState<string>('coop:activeQuery', '')
  const [filterTab, setFilterTab] = useSessionState<FilterTab>(
    'coop:filterTab',
    'all',
    () => {
      const f = mapFilterParam(searchParams.get('filter'))
      return f === 'all' ? undefined : f
    },
  )
  const [sortBy, setSortBy] = useSessionState<SortOption>('coop:sortBy', 'newest')
  const [selectedCategory, setSelectedCategory] = useSessionState<string>('coop:selectedCategory', '')
  // ADR-277 D7: taxonomy defaults to 'standard' — ListBrowser hydrates it from
  // localStorage on mount if the user previously switched to 'gamma'.
  const [taxonomy, setTaxonomy] = useState<TaxonomyAxis>('standard')
  const [selectedGammaTags, setSelectedGammaTags] = useSessionState<string[]>('coop:selectedGammaTags', [])
  const [categoryOpen, setCategoryOpen] = useState(true)

  const [hideEmptyCategories] = usePref('hideEmptyCategories', false)
  const [showOfferCounts] = usePref('showOfferCounts', true)
  // ADR-363 D6: the coop surface renders the SAME filter SidePanel as the
  // marketplace (ListingFilterSidebar), driven by the client pipeline.
  // Locations + Images are the panels the coop item shape supports. The coop
  // category tree is now a regular toggleable panel too (same combined
  // Standard/Gamma entry as Search's Cooperate context) — only Categories
  // starts enabled so the tree is visible immediately and the rest stay off.
  // hideNoImageOffers shares the marketplace pref key (intended — one user
  // preference across surfaces) with the SAME default (true) so first-time
  // behavior is consistent everywhere.
  const [enabledSidebarPanels, setEnabledSidebarPanels] = useSessionState<SidebarPanelId[]>(
    'coop:sidebarPanels',
    ['categories'],
  )
  const [countryFilter, setCountryFilter] = useSessionState<string>('coop:countryFilter', '')
  const [hideNoImageOffers, setHideNoImageOffers] = usePref('hideNoImageOffers', true)
  // ADR-368 follow-up: agent axis (coop-side mirror of the marketplace
  // AgentFilterPanel, ADR-313) — client-side via useCoopFilters.
  const [selectedCapabilities, setSelectedCapabilities] = useSessionState<string[]>('coop:selectedCapabilities', [])
  const [agentBillingModel, setAgentBillingModel] = useSessionState<string>('coop:agentBillingModel', '')
  const [minReputation, setMinReputation] = useSessionState<number>('coop:minReputation', 0)
  const [canvasProvider, setCanvasProvider] = useSessionState<string>('coop:canvasProvider', '')

  function toggleSidebarPanel(id: SidebarPanelId) {
    setEnabledSidebarPanels(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id],
    )
  }

  // ── Add-FAB submenu (mirrors CoopManage / Home.tsx) ───────────────────
  const { actions: fabActions, setActions: setFABActions, clear: clearFAB } = useFABActions()
  // ADR-368 D5: CoopExplore carries the complete Cooperate action set —
  // Service (context=coop → lands in Manage), Agent, Bounty, Coop Guide —
  // exactly as Sell Listings used to carry the Agent action.
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

  const dashboardRef = usePageAnimation([
    { selector: '.dashboard-animate', from: { duration: 0.5, stagger: 0.12, y: 24 } },
  ])

  // ── Coop filter/sort pipeline (shared with /search via useCoopFilters) ──
  const { coopCategories, categoryCountItems, allItems, gammaTagFacets, agentCapabilityFacets, preCategoryItems } = useCoopFilters({
    cooperations,
    categories,
    filterTab,
    query: activeQuery,
    selectedCategory,
    sortBy,
    taxonomy,
    selectedGammaTags,
    selectedCountry: countryFilter,
    hideNoImageOffers,
    selectedCapabilities,
    agentBillingModel,
    minReputation,
    canvasProvider,
  })

  // ADR-363 review fix: country list for the shared LocationsFilterPanel —
  // derived from the TAB-scoped pre-filter pool (offers + companies map
  // `country`; tenders/projects/bounties carry none and only appear under
  // "All countries"), so e.g. the tenders tab never offers countries that
  // only companies/offers carry.
  const coopCountries = useMemo(
    () => Array.from(new Set(preCategoryItems.map(i => i.country).filter((c): c is string => Boolean(c)))).sort(),
    [preCategoryItems],
  )

  // ADR-363 review fix: when the active tab/pool no longer contains the
  // selected country, reset it instead of silently showing an empty list.
  useEffect(() => {
    if (countryFilter && !preCategoryItems.some(i => i.country === countryFilter)) {
      setCountryFilter('')
    }
  }, [countryFilter, preCategoryItems, setCountryFilter])

  // ADR-368 follow-up: clear the agent axis when leaving a tab where agent
  // items appear, so stale agent filters can't silently empty tenders/
  // projects/network/partners/services (their items carry no agent signals).
  useEffect(() => {
    if (filterTab === 'agents' || filterTab === 'all') return
    if (selectedCapabilities.length === 0 && !agentBillingModel && minReputation === 0 && !canvasProvider) return
    setSelectedCapabilities([])
    setAgentBillingModel('')
    setMinReputation(0)
    setCanvasProvider('')
  }, [filterTab, selectedCapabilities, agentBillingModel, minReputation, canvasProvider, setSelectedCapabilities, setAgentBillingModel, setMinReputation, setCanvasProvider])

  // ADR-363 D6: panel renderer — same SidebarPanelId contract as Search's
  // marketplace context, but driving the client pipeline.
  const effectiveTaxonomy: TaxonomyAxis = gammaTagFacets.length > 0 ? taxonomy : 'standard'

  // Persisted country scope as a dismissible chip under the list header.
  const activeFilterChips: ActiveFilterChip[] = countryFilter ? [{
    id: 'country',
    label: COUNTRIES.find(c => c.code === countryFilter)?.name ?? countryFilter,
    icon: <MapPin size={11} />,
    onRemove: () => setCountryFilter(''),
  }] : []

  function renderSidebarPanel(id: SidebarPanelId) {
    switch (id) {
      case 'locations':
        return <LocationsFilterPanel countryFilter={countryFilter} onCountryChange={setCountryFilter} allCountries={coopCountries} />
      case 'images':
        return <ImagesFilterPanel hideNoImageOffers={hideNoImageOffers} onHideNoImageOffersChange={setHideNoImageOffers} />
      // Coop category tree as a regular toggleable panel (same combined
      // Standard/Gamma entry as the marketplace context) instead of an
      // always-on built-in below the stack.
      case 'categories':
        return (
          <CategoriesFilterPanel
            effectiveTaxonomy={effectiveTaxonomy}
            categories={coopCategories}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
            activeFilterTab={filterTab}
            categoryCountItems={categoryCountItems}
            hideEmptyCategories={hideEmptyCategories}
            showOfferCounts={showOfferCounts}
            gammaTagFacets={gammaTagFacets}
            selectedGammaTags={selectedGammaTags}
            onSelectGammaTags={setSelectedGammaTags}
          />
        )
      // ADR-368 follow-up: the agent axis only exists on the tabs where agent
      // items appear (agents + all) — collapses to null elsewhere so it drops
      // out of the ordered panel stack without leaving a gap.
      case 'agentFilters':
        return filterTab === 'agents' || filterTab === 'all' ? (
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
      default:
        return null
    }
  }

  // ── KPI items ───────────────────────────────────────────────────────
  // ADR-334 D5 + D6 follow-up: tenders/projects/network/partners + budgets
  // come from /api/stats (honest ecosystem totals). Partners = vendors +
  // providers (mirrors the merged pool's itemType composition, unwindowed).
  // Results = the real total of cooperation opportunities (OPEN
  // cooperations + COOP-type network offers) — was allItems.length which is
  // capped at ~360 across 4 sources via useCoopExploreData.
  const kpiItems = useMemo<KPIItem[]>(() => {
    const cs = ecosystemStats?.cooperations
    const totalBudget = cs?.totalBudgetSats ?? 0
    const openBudget = cs?.openBudgetSats ?? 0
    const partners = (ecosystemStats?.vendors ?? 0) + (ecosystemStats?.providers ?? 0)
    const offerServices = ecosystemStats?.offers?.services ?? 0
    const offerAgents = ecosystemStats?.offers?.agents ?? 0
    // ADR-368 D4: Results = every browseable cooperation opportunity on the
    // coop surface — OPEN cooperations (incl. Service Bundles) + COOP-type
    // network offers + active SERVICE offers + active AGENT_SETUP offers.
    const resultsTotal = (cs?.open ?? 0) + (cs?.network ?? 0) + offerServices + offerAgents
    return [
      { icon: <Tag size={14} />, value: coopCategories.filter(c => c.level === 1).length, label: 'Categories', onClick: () => setCategoryOpen(v => !v), active: categoryOpen, heading: 'Browse' },
      { icon: <TrendingUp size={14} />, value: resultsTotal, label: 'Results', onClick: () => setFilterTab('all'), active: filterTab === 'all', tooltip: `${allItems.length} of ${resultsTotal} loaded${allItems.length < resultsTotal ? ' — load more below' : ''}` },
      { icon: <Handshake size={14} />, value: cs?.tenders ?? 0, label: 'Tenders', onClick: () => setFilterTab('tenders'), active: filterTab === 'tenders' },
      // ADR-338: agent-native sibling of Tenders — filters in-place exactly
      // like Tenders/Projects/Network/Partners.
      { icon: <Target size={14} />, value: bountyCounts?.byStatus.OPEN ?? 0, label: 'Bounties', onClick: () => setFilterTab('bounties'), active: filterTab === 'bounties', tooltip: 'Open bounties — AI agents apply, you pick the winner' },
      { icon: <FolderKanban size={14} />, value: cs?.projects ?? 0, label: 'Projects', onClick: () => setFilterTab('projects'), active: filterTab === 'projects' },
      { icon: <Network size={14} />, value: cs?.network ?? 0, label: 'Network', onClick: () => setFilterTab('network'), active: filterTab === 'network' },
      { icon: <Users size={14} />, value: partners, label: 'Partners', onClick: () => setFilterTab('partners'), active: filterTab === 'partners' },
      // ADR-368 D4 (FU-659): Agents/Services chips from the unwindowed
      // /api/stats counts. Services = SERVICE offers + Service Bundles
      // (cooperationType === 'SERVICE' cooperations) — the tab's pool.
      { icon: <Bot size={14} />, value: offerAgents, label: 'Agents', onClick: () => setFilterTab('agents'), active: filterTab === 'agents', tooltip: 'AI Agent Setups ready to hire' },
      { icon: <Handshake size={14} />, value: offerServices + (cs?.service ?? 0), label: 'Services', onClick: () => setFilterTab('services'), active: filterTab === 'services', tooltip: 'Service Offers + Service Bundles' },
      { icon: <Bitcoin size={14} />, value: totalBudget, label: 'Total Budget', color: 'var(--color-warning-primary)', tooltip: `${totalBudget.toLocaleString('de-DE')} sats across all cooperations`, heading: 'Finances', separator: true },
      { icon: <Layers size={14} />, value: openBudget, label: 'Open Budget', color: 'var(--color-status-success)', tooltip: `${openBudget.toLocaleString('de-DE')} sats in open cooperations` },
    ]
  }, [coopCategories, allItems.length, filterTab, categoryOpen, ecosystemStats, bountyCounts])

  // ── Handlers ────────────────────────────────────────────────────────
  function handleSearch() { setActiveQuery(query) }
  function handleClear() { setQuery(''); setActiveQuery('') }
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

  return (
    // gap="none" + explicit section margins mirrors BountyBoard's vertical
    // rhythm (user feedback 2026-08-24): KPI strip sits 8px (mb-2) above the
    // list header — the default PageContainer gap (24/32px) + wrapper mt-4
    // had it floating 40-48px below when collapsed.
    <PageContainer size="wide" spacing="lg" gap="none" className="!mt-0 pt-0!" ref={dashboardRef}>
      {/* ADR-287 / ADR-303 D12 — public read tier gets indexable metadata. */}
      <Seo
        title="Cooperate"
        description="Explore cooperations, tenders, projects and partner networks on Colabonate. Pool demand, share budgets and build together — no account required to browse."
        path="/coop"
      />
      <PageHeader
        icon={<Handshake size={18} />}
        title="Cooperate"
        subtitle="Explore cooperations, tenders and networks"
        onBack={() => navigate('/')}
      />

      {!isMobile && (
        <div className="mb-2">
          <KPIStrip
            items={kpiItems}
            loading={loading || statsLoading}
            skeletonCount={6}
            wrap
            collapsible
            storageKey="kpi-coop-dashboard"
          />
        </div>
      )}

      {/* PageHeader + KPIStrip both render nothing on mobile (title lives in the
          bottom nav instead) — no top margin so the category panel starts
          flush. Desktop spacing comes from the KPI wrapper's mb-2 above (same
          as BountyBoard's ListHeader slot). */}
      <div className="dashboard-animate">
        <ListBrowser
          items={allItems}
          loading={loading}
          filterTabs={FILTER_TABS}
          activeFilterTab={filterTab}
          onFilterTabChange={(key) => setFilterTab(key as FilterTab)}
          categories={coopCategories}
          categoryCountItems={categoryCountItems}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          taxonomy={taxonomy}
          onTaxonomyChange={setTaxonomy}
          gammaTagFacets={gammaTagFacets}
          selectedGammaTags={selectedGammaTags}
          onSelectGammaTags={setSelectedGammaTags}
          searchQuery={activeQuery}
          onSearchQueryChange={(q) => { setQuery(q); setActiveQuery(q) }}
          sortBy={sortBy}
          onSortChange={(s) => setSortBy(s as SortOption)}
          sortOptions={SORT_OPTIONS}
          hideEmptyCategories={hideEmptyCategories}
          showOfferCounts={showOfferCounts}
          categoryOpen={categoryOpen}
          onCategoryOpenChange={setCategoryOpen}
          headerActions={[
            <SearchInput
              key="search"
              variant="toggle"
              size="md"
              value={query}
              onChange={setQuery}
              onSearch={handleSearch}
              onClear={handleClear}
              placeholder="Search cooperations…"
              ariaLabel="Search cooperations"
            />,
          ]}
          renderCard={(item, size, viewMode) => viewMode === 'gallery' ? (
            <CoopGalleryCard
              item={item}
              size={size}
              onAddToCoop={canAddToCoop(item) ? () => handleAddToCoop(item) : undefined}
            />
          ) : (
            <CoopListRow
              item={item}
              size={size}
              onAddToCoop={canAddToCoop(item) ? () => handleAddToCoop(item) : undefined}
            />
          )}
          cardKey={(item) => item.id}
          emptyState={
            <CoopEmptyState
              message={activeQuery || selectedCategory ? 'No results found. Try different filters.' : 'No cooperations yet.'}
              sub={activeQuery || selectedCategory ? 'Try clearing some filters.' : 'Use the Coop Guide to start your first cooperation.'}
            />
          }
          storageKeyPrefix="coopDashboard"
          defaultScrollMode="unlimited"
          filterFab={isMobile}
          sidebarExtraTop={
            // ADR-363 D6: identical filter SidePanel as the marketplace, but
            // with filterModel="client" — the panels drive useCoopFilters
            // instead of /api/search params. The category tree is a toggleable
            // panel in this stack (hideBuiltinTaxonomyPanel below).
            <ListingFilterSidebar
              filterModel="client"
              availablePanels={['locations', 'images', 'categories', 'agentFilters']}
              enabledPanels={enabledSidebarPanels}
              onTogglePanel={toggleSidebarPanel}
              effectiveTaxonomy={effectiveTaxonomy}
              renderPanel={renderSidebarPanel}
            />
          }
          hideBuiltinTaxonomyPanel
          activeFilterChips={activeFilterChips}
        />
      </div>

      <FloatingAddButton
        offsetRight={40}
        offsetTop={130}
        actions={fabActions}
      />
      {/* Desktop has no FilterFAB here (filterFab is mobile-only below), so tier 2
          (190) is free — unlike Home.tsx, where the route-gated AI-FAB occupies
          tier 2 and pushes its secondary FAB to tier 3 (250). Mobile still needs
          tier 3 since the FilterFAB does render there. */}
      <CoopFAB
        topOffset={190}
        bottomOffset="calc(58px + env(safe-area-inset-bottom, 0px) + 132px)"
      />
    </PageContainer>
  )
}