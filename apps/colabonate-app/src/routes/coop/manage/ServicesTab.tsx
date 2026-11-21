// ESCROW-COPY (ADR-397): payment wording here assumes Direct-Pay. On escrow activation follow docs/plans/ESCROW-COPY-REACTIVATION.md.
// ADR-368 D3: Cooperate Manage "Services" tab (`/coop/manage?tab=services`) —
// manages the caller's OWN `Offer.offerType='SERVICE'` offers (ADR-366:
// Service = SERVICE offer, distinct from Service Bundle = SERVICE cooperation).
//
// Reuses the Sell ListingsTab machinery (SellGalleryCard / SellListRow —
// exported by the main ADR-368 session) over a SINGLE data source,
// `useUserServiceOffers(pubkey)`. The user's Private/Corporate offer axis
// (`offer.companyId` presence) stays a sub-context within Cooperate: it rides
// ListBrowser's `filterTabs` exactly like ListingsTab's `contextTabs`, while
// the Active/Drafts status axis is an internal extra data filter (filterTab)
// that the KPI chips jump to. KPI strip + FAB are owned by the shell; this tab
// only lifts KPI items up via `onKpiChange` and registers its two FAB actions.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Briefcase, Eye, EyeOff, Radio, ShieldCheck, Tag } from 'lucide-react'
import type { KPIItem } from '@ds/ui'
import { ListBrowser } from '../../../components/list-browser'
import { ApiError } from '../../../lib/api'
import { useNotification } from '../../../context/NotificationContext'
import { SearchInput } from '../../../components/ui/SearchInput'
import { useFABActions } from '../../../context/FABContext'
import { useUserServiceOffers } from '../../../hooks/useEntityQueries'
import { useOfferListActions } from '../../../hooks/useOfferListActions'
import { usePageListViewMode } from '../../../hooks/usePageListViewMode'
import type { Offer } from '../../../types/api'
import type { CoopTabProps } from '../../sell/sell.types'
// ADR-368 D3: card components stay in the sell module (single source); the
// main ADR-368 session adds `export` to them in ListingsTab.tsx.
import { SellGalleryCard, SellListRow } from '../../sell/tabs/ListingsTab'
import { EmptyStateGuide } from '../../../components/EmptyStateGuide'

// Private = no `offer.companyId`, corporate = has `companyId` — the user's
// "Corporate/Private offer axis stays a sub-context within Cooperate"
// requirement (ADR-368). Rendered as ListBrowser `filterTabs`, exactly like
// ListingsTab's `contextTabs`.
type ContextTab = 'all' | 'private' | 'corporate'
// Status data filter, separate from the context axis — the KPI chips
// (Active/Drafts) jump to these values.
type FilterTab = 'all' | 'active' | 'drafts'
type SortOption = 'newest' | 'price-asc' | 'price-desc' | 'name'

export function ServicesTab({ pubkey, onKpiChange, headerPrefix }: CoopTabProps) {
  const navigate = useNavigate()
  const { showSnackbar } = useNotification()
  const [deleteConfirm, setDeleteConfirm] = useState<Offer | null>(null)
  const { setActions: setFABActions, clear: clearFAB } = useFABActions()
  const { setStatus, toggleActive, deleteOffer } = useOfferListActions(pubkey)

  // ADR-366 D2: SERVICE offers only — no product/agent pools, no merge.
  const { data: offers = [], isLoading: loading } = useUserServiceOffers(pubkey)

  // ADR-368 feedback (2026-09-05): the category/taxonomy filter axis was too
  // much for the first cut of this surface — categories are dropped until the
  // service catalog taxonomy actually exists. ListBrowser still requires the
  // categories props; an empty tree renders no panel and no taxonomy switch.
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [contextTab, setContextTab] = useState<ContextTab>('all')
  // ?filter= deep-link support (active/drafts) — same pattern as ListingsTab:
  // pre-filled, not locked; in-tab clicks call setFilterTab directly and never
  // touch the URL. Re-synced on every `searchParams` change, not just mount.
  const [searchParams] = useSearchParams()
  const [filterTab, setFilterTab] = useState<FilterTab>(() => {
    const raw = searchParams.get('filter')
    return raw === 'active' || raw === 'drafts' ? raw : 'all'
  })
  useEffect(() => {
    const raw = searchParams.get('filter')
    const next = raw === 'active' || raw === 'drafts' ? raw : 'all'
    setFilterTab(prev => (prev === next ? prev : next))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  // ADR-368 follow-up: Grid/List is a page-level preference — shared with the
  // other /coop/manage subtabs via the 'coopManage_viewMode' key.
  const [viewMode, setViewMode] = usePageListViewMode({
    storageKey: 'coopManage_viewMode',
    legacyKey: 'coopServices_viewMode',
    initial: 'list',
  })

  function handleSearch() { setActiveQuery(query) }
  function handleClear() { setQuery(''); setActiveQuery('') }

  const contextTabs = [
    { key: 'all', label: 'All' },
    { key: 'private', label: 'Private' },
    { key: 'corporate', label: 'Corporate' },
  ]

  // ADR-368 D5 (services tab): the FAB offers exactly two Cooperate actions.
  useEffect(() => {
    setFABActions([
      { id: 'create-service', label: 'Service', info: 'Offer your expertise', group: 'Cooperate', icon: 'briefcase', onClick: () => navigate('/offers/new?type=service&context=coop') },
      { id: 'coop-guide', label: 'Coop Guide', info: 'Start cooperation', group: 'Cooperate', icon: 'handshake', onClick: () => navigate('/coop/guide') },
    ])
    return () => clearFAB()
  }, [setFABActions, clearFAB, navigate])

  const filteredItems = useMemo(() => {
    let filtered = offers
    if (activeQuery.trim()) {
      const q = activeQuery.toLowerCase()
      filtered = filtered.filter(o =>
        o.title.toLowerCase().includes(q) ||
        o.description?.toLowerCase().includes(q) ||
        o.category?.toLowerCase().includes(q),
      )
    }
    if (contextTab === 'private') filtered = filtered.filter(o => !o.companyId)
    else if (contextTab === 'corporate') filtered = filtered.filter(o => !!o.companyId)
    if (filterTab === 'active') filtered = filtered.filter(o => o.status === 'ACTIVE')
    else if (filterTab === 'drafts') filtered = filtered.filter(o => o.status === 'DRAFT')
    switch (sortBy) {
      case 'price-asc': filtered.sort((a, b) => a.priceSats - b.priceSats); break
      case 'price-desc': filtered.sort((a, b) => b.priceSats - a.priceSats); break
      case 'name': filtered.sort((a, b) => a.title.localeCompare(b.title)); break
      default: filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); break
    }
    return filtered
  }, [offers, filterTab, contextTab, activeQuery, sortBy])

  const kpiItems = useMemo<KPIItem[]>(() => {
    const base = offers
    return [
      { icon: <Briefcase size={14} />, value: base.length, label: 'All', onClick: () => setFilterTab('all'), active: filterTab === 'all', heading: 'Services' },
      { icon: <Eye size={14} />, value: base.filter(o => o.status === 'ACTIVE').length, label: 'Active', onClick: () => setFilterTab('active'), active: filterTab === 'active' },
      { icon: <EyeOff size={14} />, value: base.filter(o => o.status === 'DRAFT').length, label: 'Drafts', onClick: () => setFilterTab('drafts'), active: filterTab === 'drafts' },
      { icon: <Briefcase size={14} />, value: base.filter(o => !o.companyId).length, label: 'Private', onClick: () => setContextTab('private'), active: contextTab === 'private' },
      { icon: <Briefcase size={14} />, value: base.filter(o => !!o.companyId).length, label: 'Corporate', onClick: () => setContextTab('corporate'), active: contextTab === 'corporate', separator: true },
    ]
  }, [offers, filterTab, contextTab])

  // Lift KPIs to the parent shell's KPIStrip.
  useEffect(() => {
    onKpiChange(kpiItems, loading)
  }, [onKpiChange, kpiItems, loading])

  function handleAction(action: 'view' | 'edit' | 'archive' | 'delete' | 'publish' | 'toggle-active', offer: Offer) {
    // ADR-366: SERVICE is a real Offer now (D2) — `offer.id` is an offer id,
    // so it routes through the same generic offer detail/edit routes as every
    // other offerType. All SERVICE offers are non-AGENT_SETUP, so the generic
    // Publish/Archive pair applies (the card menus hide the agent toggle).
    if (action === 'view') { navigate(`/buy/product/${offer.id}`); return }
    if (action === 'delete') { setDeleteConfirm(offer); return }
    if (action === 'edit') {
      // Defensive guard: SellListingDetail explicitly doesn't support
      // AGENT_SETUP offers; every SERVICE offer is fine, keep the check in
      // case an agent offer ever lands in this list.
      if (offer.offerType === 'AGENT_SETUP') return
      navigate(`/sell/listings/${offer.id}`)
      return
    }
    if (action === 'toggle-active') {
      const willBeActive = offer.status !== 'ACTIVE'
      toggleActive(offer)
        .then(() => showSnackbar(willBeActive ? 'Agent activated' : 'Agent deactivated', 'success'))
        .catch((err) => {
          console.error(err)
          const message = err instanceof ApiError ? (err.data?.message || err.message) : 'Failed to update agent listing'
          showSnackbar(message, 'error')
        })
      return
    }
    if (action === 'archive') {
      setStatus(offer, 'ARCHIVED')
        .then(() => showSnackbar('Listing archived', 'success'))
        .catch((err) => {
          console.error(err)
          const message = err instanceof ApiError ? (err.data?.message || err.message) : 'Failed to archive listing'
          showSnackbar(message, 'error')
        })
      return
    }
    if (action === 'publish') {
      setStatus(offer, 'ACTIVE')
        .then(() => showSnackbar('Listing published', 'success'))
        .catch((err) => {
          console.error(err)
          const message = err instanceof ApiError ? (err.data?.message || err.message) : 'Failed to publish listing'
          showSnackbar(message, 'error')
        })
      return
    }
  }

  async function confirmDelete() {
    if (!deleteConfirm || !pubkey) return
    try {
      await deleteOffer(deleteConfirm)
      setDeleteConfirm(null)
    } catch (error) {
      console.error('Failed to delete service:', error)
      showSnackbar(error instanceof Error ? error.message : 'Failed to delete service', 'error')
    }
  }

  return (
    <>
      <ListBrowser
        items={filteredItems}
        loading={loading}
        headerPrefix={headerPrefix}
        controlledViewMode={viewMode}
        onControlledViewModeChange={setViewMode}
        filterTabs={contextTabs}
        activeFilterTab={contextTab}
        onFilterTabChange={(key) => setContextTab(key as ContextTab)}
        categories={[]}
        selectedCategory=""
        onSelectCategory={() => {}}
        searchQuery={activeQuery}
        onSearchQueryChange={(q) => { setQuery(q); setActiveQuery(q) }}
        sortBy={sortBy}
        onSortChange={(s) => setSortBy(s as SortOption)}
        sortOptions={[
          { value: 'newest', label: 'Newest' },
          { value: 'price-asc', label: 'Price ↑' },
          { value: 'price-desc', label: 'Price ↓' },
          { value: 'name', label: 'Name A–Z' },
        ]}
        categoryOpen={categoryOpen}
        onCategoryOpenChange={setCategoryOpen}
        defaultPanelMode="top"
        headerActions={[
          <SearchInput
            key="search"
            variant="toggle"
            size="md"
            value={query}
            onChange={setQuery}
            onSearch={handleSearch}
            onClear={handleClear}
            placeholder="Search services…"
            ariaLabel="Search"
          />,
        ]}
        renderCard={(offer, size, viewMode) => viewMode === 'gallery' ? (
          <SellGalleryCard offer={offer} size={size} onAction={handleAction} />
        ) : (
          <SellListRow offer={offer} size={size} onAction={handleAction} />
        )}
        cardKey={(offer) => offer.id}
        emptyState={
          <EmptyStateGuide
            icon={<Briefcase size={26} />}
            accent="var(--color-secondary-50)"
            accentSoft="rgba(159,122,234,0.12)"
            title="No services yet"
            intro="A service is an offer of your expertise — coaching, design, writing, code. Buyers pay you directly over Lightning, milestone by milestone as you deliver. Publish to Nostr so your services stay portable and censorship-resistant."
            features={[
              { icon: <Briefcase size={16} />, title: 'Milestone Delivery', text: 'Price work in milestones. Clients pay into escrow up front and each phase releases only once both sides confirm the step.', color: 'var(--color-secondary-50)', bg: 'rgba(159,122,234,0.12)' },
              { icon: <ShieldCheck size={16} />, title: 'Phased Payments', text: 'Pay milestone by milestone, directly to the provider, so neither side is exposed to the full amount at once. Escrow is planned for later.', color: 'var(--color-accent-primary)', bg: 'rgba(245,166,35,0.12)' },
              { icon: <Radio size={16} />, title: 'Nostr Publishing', text: 'Services sync to Nostr relays — decentralized, portable, and discoverable across the network without a central server.', color: 'var(--color-secondary-50)', bg: 'rgba(159,122,234,0.08)' },
              { icon: <Tag size={16} />, title: 'Status Lifecycle', text: 'Keep a service as Draft while you refine it, set it Active to sell, or Archive when done. Use the KPI strip above to jump between states.', color: 'var(--color-primary-50)', bg: 'rgba(232,69,65,0.10)' },
              { icon: <Eye size={16} />, title: 'Private or Corporate', text: 'Sell as an individual with no company, or attach the service to one of your companies so clients see a branded business presence.', color: 'var(--color-status-success)', bg: 'rgba(72,187,120,0.12)' },
            ]}
            helpLinks={[
              { label: 'List products & services', to: '/help/selling#sell-4' },
              { label: 'Cooperation guide', to: '/coop/guide' },
              { label: 'Selling guide', to: '/help/selling' },
            ]}
            ctaLabel="Offer a Service"
            ctaTo="/offers/new?type=service&context=coop"
            secondaryCtaLabel="Set up company"
            secondaryCtaTo="/sell/company/setup"
          />
        }
        storageKeyPrefix="coopServices"
      />

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-sm p-5 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
            <h3 className="text-[16px] font-semibold mb-2" style={{ color: 'var(--theme-text)' }}>Delete Service?</h3>
            <p className="text-[13px] mb-4" style={{ color: 'var(--theme-text-muted)' }}>This action cannot be undone. &quot;{deleteConfirm.title}&quot; will be permanently removed.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 cursor-pointer hover:opacity-90" style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text)' }}>
                Cancel
              </button>
              <button onClick={confirmDelete} className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 cursor-pointer hover:opacity-90" style={{ background: 'var(--color-status-error)', color: 'white' }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
