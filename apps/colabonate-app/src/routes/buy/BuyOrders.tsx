// My Orders – /buy/orders
// Mirrors the CoopOffers ("Manage Cooperations") page structure: PageHeader,
// KPIStrip (clickable status filters), a secondary pill filter row, ListHeader
// (tabs + search + sort + view toggle), gallery/list rendering, and the same
// pagination/infinite-scroll footer.

import { useState, useEffect, useMemo, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { gsap } from 'gsap'
import {
  Package, CheckCircle, XCircle, AlertCircle,
  ArrowRight, Zap, Store, Briefcase, RefreshCw, Clock,
  Search, TrendingUp, X, ChevronLeft, ChevronRight, Send,
  ShoppingBag,
} from 'lucide-react'
import { PageContainer, ListHeader } from '@ds/ui'
import { KPIStrip } from '../../components/kpi/KpiStrip'
import type { KPIItem } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { SubTabPill } from '../../components/SubTabPill'
import { SearchInput } from '../../components/ui/SearchInput'
import { cn } from '@ds/utils'
import { useTranslation } from '../../contexts/LocaleContext'
import { formatSats } from '../../lib/currency'
import { FiatHint } from '../../components/currency/FiatHint'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { useSessionState } from '../../hooks/useSessionState'
import { useUserTickets, invalidateUserTickets } from '../../hooks/useEntityQueries'
import { useQueryClient } from '@tanstack/react-query'
import type { Ticket, TicketStatus } from '../../types/api'

// ── Types ─────────────────────────────────────────────────────────────

type TabKey = 'all' | 'open' | 'completed' | 'cancelled'
type ViewMode = 'gallery' | 'list'
type SortOption = 'newest' | 'oldest' | 'price'
type StatusGroup = null | 'pending' | 'active' | 'paid' | 'completed' | 'disputed' | 'cancelled'
type TypeFilter = null | 'PRODUCT' | 'SERVICE'

// ── Status Config ─────────────────────────────────────────────────────

type StatusIconType = typeof Clock

const STATUS_CONFIG: Record<TicketStatus, { label: string; bg: string; color: string; border: string; icon: StatusIconType }> = {
  PENDING:     { label: 'Pending',     bg: 'rgba(245,166,35,0.18)',  color: '#F5A623', border: 'rgba(245,166,35,0.40)', icon: Clock },
  ACCEPTED:    { label: 'Accepted',    bg: 'rgba(99,179,237,0.18)',  color: '#63B3ED', border: 'rgba(99,179,237,0.40)', icon: CheckCircle },
  IN_PROGRESS: { label: 'In Progress', bg: 'rgba(99,179,237,0.18)',  color: '#63B3ED', border: 'rgba(99,179,237,0.40)', icon: RefreshCw },
  PAID:        { label: 'Paid',        bg: 'rgba(72,187,120,0.18)',  color: '#48B978', border: 'rgba(72,187,120,0.40)', icon: CheckCircle },
  COMPLETED:   { label: 'Completed',   bg: 'rgba(72,187,120,0.18)',  color: '#48B978', border: 'rgba(72,187,120,0.40)', icon: CheckCircle },
  DISPUTED:    { label: 'Disputed',    bg: 'rgba(245,101,101,0.18)', color: '#F56565', border: 'rgba(245,101,101,0.40)', icon: AlertCircle },
  CANCELLED:   { label: 'Cancelled',   bg: 'rgba(113,128,150,0.18)', color: '#718096', border: 'rgba(113,128,150,0.40)', icon: XCircle },
}

const TABS: { key: TabKey; label: string; statuses: TicketStatus[] }[] = [
  { key: 'all',        label: 'All',       statuses: [] },
  { key: 'open',       label: 'Open',      statuses: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'] },
  { key: 'completed',  label: 'Completed', statuses: ['COMPLETED', 'PAID'] },
  { key: 'cancelled',  label: 'Cancelled', statuses: ['CANCELLED'] },
]

function statusToGroup(status: TicketStatus): StatusGroup {
  switch (status) {
    case 'PENDING': return 'pending'
    case 'ACCEPTED':
    case 'IN_PROGRESS': return 'active'
    case 'PAID': return 'paid'
    case 'COMPLETED': return 'completed'
    case 'DISPUTED': return 'disputed'
    case 'CANCELLED': return 'cancelled'
    default: return null
  }
}

// ── Order Card (list row) ───────────────────────────────────────────────

function OrderListRow({ ticket }: { ticket: Ticket }) {
  const { formatDate } = useTranslation()
  const statusCfg = STATUS_CONFIG[ticket.status] ?? STATUS_CONFIG.PENDING
  const isService = ticket.offerType === 'SERVICE'
  const StatusIcon = statusCfg.icon
  const hasImage = ticket.offer?.images && ticket.offer.images.length > 0

  return (
    <Link
      to={`/tickets/${ticket.id}`}
      className="flex items-start gap-3 p-3 rounded-xl no-underline cursor-pointer transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.99]"
      style={{
        background: 'var(--theme-surface)',
        border: '1px solid var(--theme-border)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)',
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 25px rgba(0,0,0,0.10)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)' }}
    >
      <div
        className="self-stretch shrink-0 overflow-hidden rounded-lg flex items-center justify-center"
        style={{ width: 52, height: 52, background: 'var(--theme-bg-subtle)' }}
      >
        {hasImage
          ? <img src={ticket.offer?.images?.[0]} alt={ticket.offer?.title} className="object-cover w-full h-full" />
          : isService
            ? <Briefcase size={18} style={{ color: 'var(--color-secondary-50)' }} />
            : <Package size={18} style={{ color: 'var(--color-status-success)' }} />}
      </div>

      <div className="flex flex-col flex-1 min-w-0 py-0.5">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <span className="truncate" style={{ fontSize: 13, fontWeight: 600, color: 'var(--theme-text)' }}>
            {ticket.offer?.title ?? 'Unknown'}
          </span>
          {ticket.variantLabel && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0"
              style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-secondary)', border: '1px solid var(--theme-border)' }}
            >
              {ticket.variantLabel}
            </span>
          )}
          {isService && (
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm uppercase leading-none shrink-0"
              style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.07em',
                backgroundColor: 'rgba(159,122,234,0.20)',
                color: 'var(--color-secondary-50)',
                border: '1px solid rgba(159,122,234,0.35)',
              }}
            >
              <Briefcase size={9} />
              Service
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm uppercase leading-none"
            style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.07em',
              background: statusCfg.bg, color: statusCfg.color, border: `1px solid ${statusCfg.border}`,
            }}
          >
            <StatusIcon size={9} />
            {statusCfg.label}
          </span>

          {ticket.amountSats != null && (
            <span
              className="inline-flex items-center gap-0.5"
              style={{
                padding: '2px 8px', borderRadius: 6,
                background: 'rgba(99,179,237,0.10)', fontSize: 11, fontWeight: 700,
                fontVariantNumeric: 'tabular-nums', color: 'var(--color-primary-50)', whiteSpace: 'nowrap',
              }}
            >
              <Zap size={11} />
              {formatSats(ticket.amountSats, { compact: false })}
              <FiatHint sats={ticket.amountSats} className="text-[0.9em] ml-[3px]" />
            </span>
          )}

          <span style={{ fontSize: 10, color: 'var(--theme-text-muted)' }}>
            {formatDate(new Date(ticket.createdAt), { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </div>
      </div>

      <div className="flex items-center self-center shrink-0">
        <ArrowRight size={16} style={{ color: 'var(--theme-text-muted)' }} />
      </div>
    </Link>
  )
}

// ── Order Card (gallery) ─────────────────────────────────────────────────

function OrderGalleryCard({ ticket }: { ticket: Ticket }) {
  const { formatDate } = useTranslation()
  const statusCfg = STATUS_CONFIG[ticket.status] ?? STATUS_CONFIG.PENDING
  const isService = ticket.offerType === 'SERVICE'
  const hasImage = ticket.offer?.images && ticket.offer.images.length > 0

  return (
    <Link
      to={`/tickets/${ticket.id}`}
      className={cn(
        'flex flex-col rounded-xl border overflow-hidden no-underline cursor-pointer',
        'shadow-[0_2px_8px_rgba(0,0,0,0.08)]',
        'transition-all duration-300 ease-out',
        'hover:z-10 hover:scale-[1.03] hover:shadow-[0_12px_32px_rgba(0,0,0,0.18)]',
        'active:scale-[0.99] h-full relative',
      )}
      style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
    >
      <div
        className="relative flex items-center justify-center shrink-0 overflow-hidden"
        style={{ height: 110, background: 'var(--theme-bg-subtle)' }}
      >
        {hasImage
          ? <img src={ticket.offer?.images?.[0]} alt={ticket.offer?.title} className="w-full h-full object-cover" style={{ opacity: 0.9 }} />
          : isService
            ? <Briefcase size={36} style={{ color: 'var(--color-secondary-50)', opacity: 0.85 }} />
            : <Package size={36} style={{ color: 'var(--color-status-success)', opacity: 0.85 }} />}
        <span
          className="absolute top-2 right-2 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full"
          style={{ background: statusCfg.bg, color: statusCfg.color }}
        >
          {statusCfg.label}
        </span>
      </div>
      <div className="flex flex-col flex-1 p-3 gap-1.5">
        <h4
          className="text-[14px] font-semibold leading-snug"
          style={{ color: 'var(--theme-text)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {ticket.offer?.title ?? 'Unknown'}
        </h4>
        <div className="flex items-center justify-between gap-1 mt-auto">
          {ticket.amountSats != null && (
            <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded" style={{ background: 'rgba(99,179,237,0.10)', color: 'var(--color-primary-50)', fontWeight: 700 }}>
              <Zap size={11} />
              {formatSats(ticket.amountSats, { compact: false })}
              <FiatHint sats={ticket.amountSats} className="text-[0.9em] ml-[3px]" />
            </span>
          )}
          <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
            <Clock size={10} />
            {formatDate(new Date(ticket.createdAt), { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </div>
      </div>
    </Link>
  )
}

// ── Skeleton ─────────────────────────────────────────────────────────

function SkeletonOrderCard() {
  return (
    <div
      className="flex items-start gap-3 p-3 rounded-xl animate-pulse"
      style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
    >
      <div className="shrink-0 rounded-lg" style={{ width: 52, height: 52, background: 'var(--color-neutral-8)' }} />
      <div className="flex flex-col flex-1 gap-2 py-1">
        <div className="h-4 w-3/5 rounded" style={{ background: 'var(--color-neutral-8)' }} />
        <div className="h-3 w-2/5 rounded" style={{ background: 'var(--color-neutral-9)' }} />
      </div>
    </div>
  )
}

// ── BuyOrders Component ───────────────────────────────────────────────

export function BuyOrders() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [pubkey] = useState(() => localStorage.getItem('pubkey') ?? '')
  const containerRef = usePageAnimation([
    { selector: '.orders-animate', from: { duration: 0.4, stagger: 0.08, y: 16 } },
  ])

  const { data: ticketData = [], isLoading } = useUserTickets(pubkey)

  const tickets = useMemo(
    () => (ticketData as Ticket[])
      .filter(t => t.buyerPubkey === pubkey)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [ticketData, pubkey],
  )

  const [activeTab, setActiveTab] = useSessionState<TabKey>('buyOrders:activeTab', 'all')
  const [statusFilter, setStatusFilter] = useSessionState<StatusGroup>('buyOrders:statusFilter', null)
  const [typeFilter, setTypeFilter] = useSessionState<TypeFilter>('buyOrders:typeFilter', null)
  const [query, setQuery] = useSessionState<string>('buyOrders:query', '')
  const [activeQuery, setActiveQuery] = useSessionState<string>('buyOrders:activeQuery', '')
  const [sortBy, setSortBy] = useSessionState<SortOption>('buyOrders:sortBy', 'newest')
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('buyOrders_viewMode')
    return (saved === 'gallery' || saved === 'list') ? saved : 'list'
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    const stored = sessionStorage.getItem('buyOrders_pageSize')
    return stored ? Number(stored) : 10
  })
  const [scrollMode, setScrollMode] = useState<'paginated' | 'unlimited'>(() => {
    const saved = localStorage.getItem('buyOrders_scrollMode')
    return saved === 'unlimited' ? 'unlimited' : 'paginated'
  })
  const [visibleCount, setVisibleCount] = useState(() => {
    const stored = sessionStorage.getItem('buyOrders_pageSize')
    return stored ? Number(stored) : 10
  })
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // ── Filtering & Sorting ─────────────────────────────────────────────

  const currentTickets = useMemo(() => {
    const tab = TABS.find(t => t.key === activeTab)
    let items = (!tab || tab.statuses.length === 0) ? [...tickets] : tickets.filter(t => tab.statuses.includes(t.status))
    if (typeFilter) {
      items = items.filter(t => t.offerType === typeFilter)
    }
    if (statusFilter) {
      items = items.filter(t => statusToGroup(t.status) === statusFilter)
    }
    if (activeQuery.trim()) {
      const q = activeQuery.toLowerCase()
      items = items.filter(t => (t.offer?.title ?? '').toLowerCase().includes(q))
    }
    if (sortBy === 'oldest') {
      items = [...items].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    } else if (sortBy === 'price') {
      items = [...items].sort((a, b) => (b.amountSats ?? 0) - (a.amountSats ?? 0))
    } else {
      items = [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    }
    return items
  }, [tickets, activeTab, typeFilter, statusFilter, activeQuery, sortBy])

  useEffect(() => { setPage(1) }, [activeTab, activeQuery, sortBy, pageSize, statusFilter, typeFilter])
  useEffect(() => {
    const tp = Math.max(1, Math.ceil(currentTickets.length / pageSize))
    if (page > tp) setPage(tp)
  }, [page, currentTickets.length, pageSize])

  const totalPages = Math.max(1, Math.ceil(currentTickets.length / pageSize))
  const paginatedTickets = useMemo(
    () => scrollMode === 'unlimited'
      ? currentTickets.slice(0, visibleCount)
      : currentTickets.slice((page - 1) * pageSize, page * pageSize),
    [currentTickets, scrollMode, visibleCount, page, pageSize],
  )

  // ── GSAP stagger ────────────────────────────────────────────────────

  useEffect(() => {
    if (isLoading || !listRef.current) return
    const ctx = gsap.from('.order-list-item-animate', {
      y: 20, opacity: 0, duration: 0.4, stagger: 0.06, ease: 'power2.out', clearProps: 'all',
    })
    return () => { ctx.revert() }
  }, [isLoading, activeTab, viewMode, page])

  // ── Unlimited scroll ────────────────────────────────────────────────

  useEffect(() => {
    if (scrollMode !== 'unlimited') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingMore) {
          setIsLoadingMore(true)
          setTimeout(() => {
            setVisibleCount(prev => prev + pageSize)
            setIsLoadingMore(false)
          }, 150)
        }
      },
      { rootMargin: '200px' },
    )
    const target = loadMoreRef.current
    if (target) observer.observe(target)
    return () => { if (target) observer.unobserve(target) }
  }, [scrollMode, isLoadingMore, pageSize])

  useEffect(() => {
    if (scrollMode === 'unlimited') setVisibleCount(pageSize)
  }, [activeTab, activeQuery, sortBy, pageSize, scrollMode, statusFilter, typeFilter])

  // ── KPI ─────────────────────────────────────────────────────────────

  const kpiItems = useMemo<KPIItem[]>(() => {
    const pendingCount = tickets.filter(t => statusToGroup(t.status) === 'pending').length
    const activeCount = tickets.filter(t => statusToGroup(t.status) === 'active').length
    const paidCount = tickets.filter(t => statusToGroup(t.status) === 'paid').length
    const completedCount = tickets.filter(t => statusToGroup(t.status) === 'completed').length
    const disputedCount = tickets.filter(t => statusToGroup(t.status) === 'disputed').length
    const cancelledCount = tickets.filter(t => statusToGroup(t.status) === 'cancelled').length
    const totalSpent = tickets
      .filter(t => t.status !== 'CANCELLED')
      .reduce((sum, t) => sum + (t.amountSats ?? 0), 0)

    return [
      { icon: <ShoppingBag size={14} />, value: tickets.length,   label: 'All',       active: statusFilter === null,        onClick: () => setStatusFilter(null), heading: 'Status' },
      { icon: <Send size={14} />,        value: pendingCount,     label: 'Pending',   color: 'var(--color-warning-primary)', active: statusFilter === 'pending',   onClick: () => setStatusFilter(prev => prev === 'pending' ? null : 'pending') },
      { icon: <TrendingUp size={14} />,  value: activeCount,      label: 'Active',    color: 'var(--color-primary-50)',      active: statusFilter === 'active',    onClick: () => setStatusFilter(prev => prev === 'active' ? null : 'active') },
      { icon: <Zap size={14} />,         value: paidCount,        label: 'Paid',      color: 'var(--color-status-success)',  active: statusFilter === 'paid',      onClick: () => setStatusFilter(prev => prev === 'paid' ? null : 'paid') },
      { icon: <CheckCircle size={14} />, value: completedCount,   label: 'Completed', color: 'var(--color-secondary-50)',    active: statusFilter === 'completed', onClick: () => setStatusFilter(prev => prev === 'completed' ? null : 'completed') },
      { icon: <AlertCircle size={14} />, value: disputedCount,    label: 'Disputed',  color: 'var(--color-error-primary)',   active: statusFilter === 'disputed',  onClick: () => setStatusFilter(prev => prev === 'disputed' ? null : 'disputed') },
      { icon: <XCircle size={14} />,     value: cancelledCount,   label: 'Cancelled', color: 'var(--theme-text-muted)',      active: statusFilter === 'cancelled', onClick: () => setStatusFilter(prev => prev === 'cancelled' ? null : 'cancelled') },
      { icon: <Zap size={14} />,         value: totalSpent,       label: 'Spent',     color: 'var(--color-primary-50)',      tooltip: `${formatSats(totalSpent, { compact: false })} spent across all orders`, heading: 'Finances', separator: true },
    ]
  }, [tickets, statusFilter])

  // ── Handlers ────────────────────────────────────────────────────────

  function handleSearch() { setActiveQuery(query) }
  function handleClear() { setQuery(''); setActiveQuery('') }
  function handleTabChange(key: string) {
    setActiveTab(key as TabKey)
    setActiveQuery('')
    setQuery('')
  }
  function handleViewModeChange(mode: ViewMode) {
    setViewMode(mode)
    localStorage.setItem('buyOrders_viewMode', mode)
  }

  const galleryCols = 'grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4'

  function renderResults() {
    if (isLoading) {
      if (viewMode === 'gallery') {
        return (
          <div className={`grid gap-2 ${galleryCols}`}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl animate-pulse" style={{ height: 190, background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }} />
            ))}
          </div>
        )
      }
      return (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonOrderCard key={i} />)}
        </div>
      )
    }

    if (currentTickets.length === 0) {
      const emptyMsg = activeQuery
        ? 'No results found. Try different filters.'
        : typeFilter === 'SERVICE'
          ? 'No service orders yet.'
          : typeFilter === 'PRODUCT'
            ? 'No product orders yet.'
            : 'No orders yet.'
      return (
        <div className="flex flex-col items-center py-16 gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'var(--theme-bg-subtle)' }}>
            <Package size={28} style={{ color: 'var(--theme-text-muted)' }} />
          </div>
          <span className="text-[15px] font-semibold" style={{ color: 'var(--theme-text)' }}>{emptyMsg}</span>
          <p className="text-[13px] text-center max-w-xs" style={{ color: 'var(--theme-text-muted)' }}>
            When you make a purchase, your orders will appear here.
          </p>
          <Link
            to="/buy"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 hover:opacity-90 cursor-pointer no-underline"
            style={{ background: 'var(--color-primary-50)', color: 'white' }}
          >
            <Store size={14} />
            Go to Marketplace
          </Link>
        </div>
      )
    }

    if (viewMode === 'gallery') {
      return (
        <div ref={listRef} className={`grid gap-2 ${galleryCols}`}>
          {paginatedTickets.map(ticket => (
            <div key={ticket.id} className="order-list-item-animate">
              <OrderGalleryCard ticket={ticket} />
            </div>
          ))}
        </div>
      )
    }

    return (
      <div ref={listRef} className="flex flex-col gap-2">
        {paginatedTickets.map(ticket => (
          <div key={ticket.id} className="order-list-item-animate">
            <OrderListRow ticket={ticket} />
          </div>
        ))}
      </div>
    )
  }

  return (
    // gap="none" + explicit section margins mirrors BountyBoard/CoopExplore's
    // vertical rhythm (user feedback 2026-08-24): top edge flush (pt-0!),
    // KPI strip 8px (mb-2) above the pill filter — the default PageContainer
    // gap (24/32px) had each section floating too far apart.
    <PageContainer size="wide" spacing="lg" gap="none" className="px-0.5! md:px-6! pb-6! pt-0!" ref={containerRef}>
      <div className="orders-animate">
        <PageHeader
          icon={<Package size={18} />}
          title="My Orders"
          subtitle="Track your purchases and their delivery status"
          onBack={() => navigate('/buy')}
        />
      </div>

      <div className="orders-animate mb-2">
        <KPIStrip items={kpiItems} loading={isLoading} skeletonCount={7} wrap collapsible storageKey="kpi-buy-orders-strip" />
      </div>

      {/* Sub tabs + ListHeader — shared SubTabPill (identical control to
          SellListings' sub tabs): ONE line on desktop (md:flex-row, >=600px),
          stacked on mobile. */}
      <div className="orders-animate flex flex-col md:flex-row md:items-center gap-2">
        <SubTabPill
          tabs={[
            { key: 'all', label: 'All', icon: <ShoppingBag size={14} /> },
            { key: 'PRODUCT', label: 'Items', icon: <Package size={14} /> },
            { key: 'SERVICE', label: 'Services', icon: <Briefcase size={14} /> },
          ]}
          active={typeFilter ?? 'all'}
          onChange={(key) => setTypeFilter(key === 'all' ? null : key)}
          ariaLabel="Order type"
          className="shrink-0"
        />

        <div className="flex-1 min-w-0">
          <ListHeader
            tabs={TABS.map(tab => ({ key: tab.key, label: tab.label }))}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            actions={[
              {
                key: 'search',
                element: (
                  <SearchInput
                    variant="toggle"
                    size="md"
                    value={query}
                    onChange={setQuery}
                    onSearch={handleSearch}
                    onClear={handleClear}
                    placeholder="Search orders…"
                    autoFocus
                    ariaLabel="Search orders"
                  />
                ),
              },
              {
                key: 'sort',
                element: (
                  <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value as SortOption)}
                    className="rounded-lg outline-none cursor-pointer"
                    style={{
                      fontSize: 12, height: 36, padding: '0 10px',
                      background: 'var(--theme-bg-subtle)',
                      color: 'var(--theme-text-muted)',
                      border: '1px solid var(--theme-border)',
                      minWidth: 100,
                    }}
                  >
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                    <option value="price">Price</option>
                  </select>
                ),
              },
              {
                key: 'refresh',
                element: (
                  <button
                    onClick={() => invalidateUserTickets(queryClient, pubkey)}
                    className="flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150 hover:opacity-80"
                    style={{ width: 36, height: 36, background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)' }}
                    aria-label="Refresh orders"
                  >
                    <RefreshCw size={16} />
                  </button>
                ),
              },
            ]}
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
            mt={0}
          />
        </div>
      </div>

      <div className="orders-animate">
        {activeQuery && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <div
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg"
              style={{ background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.20)' }}
            >
              <Search size={11} style={{ color: 'var(--color-primary-50)' }} />
              <span className="text-[11px]" style={{ color: 'var(--color-primary-50)' }}>"{activeQuery}"</span>
              <button onClick={handleClear} className="cursor-pointer" style={{ background: 'none', border: 'none', padding: 1 }} aria-label="Clear search">
                <X size={11} style={{ color: 'var(--color-primary-50)' }} />
              </button>
            </div>
            <span className="text-[11px] ml-1" style={{ color: 'var(--theme-text-muted)' }}>
              {currentTickets.length} result{currentTickets.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        <div className="flex flex-col gap-2 mt-3">
          <div>{renderResults()}</div>

          {scrollMode === 'unlimited' && !isLoading && visibleCount < currentTickets.length && (
            <div ref={loadMoreRef} className="flex items-center justify-center py-2">
              {isLoadingMore && <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>Loading more…</span>}
            </div>
          )}

          {!isLoading && currentTickets.length > 0 && (
            <div
              className={`shrink-0 flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl${scrollMode === 'unlimited' ? ' sticky bottom-0 z-10' : ''}`}
              style={{ color: 'var(--theme-text-muted)', background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px]">Show</span>
                {scrollMode === 'paginated' ? (
                  <select
                    value={pageSize}
                    onChange={e => {
                      const size = Number(e.target.value)
                      sessionStorage.setItem('buyOrders_pageSize', String(size))
                      setPageSize(size)
                    }}
                    className="text-[11px] rounded-md px-1.5 py-1 cursor-pointer"
                    style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
                  >
                    {[5, 10, 20, 50, 100, 200].map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-[11px]" style={{ color: 'var(--color-primary-50)', fontWeight: 600 }}>
                    All ({currentTickets.length})
                  </span>
                )}
                <span className="text-[11px]">per page</span>
                <div style={{ width: 1, height: 14, background: 'var(--theme-border)', margin: '0 4px' }} />
                <button
                  onClick={() => {
                    const next = scrollMode === 'paginated' ? 'unlimited' : 'paginated'
                    setScrollMode(next)
                    localStorage.setItem('buyOrders_scrollMode', next)
                    if (next === 'unlimited') setVisibleCount(pageSize)
                    else setPage(1)
                  }}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md cursor-pointer transition-all duration-150"
                  style={{
                    background: scrollMode === 'unlimited' ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
                    color: scrollMode === 'unlimited' ? 'white' : 'var(--theme-text)',
                    border: scrollMode === 'unlimited' ? 'none' : '1px solid var(--theme-border)',
                    fontWeight: 600,
                  }}
                >
                  <TrendingUp size={11} />
                  {scrollMode === 'unlimited' ? 'Unlimited' : 'Infinite'}
                </button>
              </div>

              <span className="text-[11px]">
                {scrollMode === 'unlimited'
                  ? `${Math.min(visibleCount, currentTickets.length)} / ${currentTickets.length}`
                  : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, currentTickets.length)} of ${currentTickets.length}`
                }
              </span>

              {scrollMode === 'paginated' ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="flex items-center justify-center rounded-md cursor-pointer disabled:opacity-30 disabled:cursor-default"
                    style={{ width: 28, height: 28, background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
                    aria-label="Previous page"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="text-[11px] px-2">Page {page} / {totalPages}</span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="flex items-center justify-center rounded-md cursor-pointer disabled:opacity-30 disabled:cursor-default"
                    style={{ width: 28, height: 28, background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
                    aria-label="Next page"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              ) : (
                <span className="text-[11px] px-2">
                  {visibleCount >= currentTickets.length ? 'End of results' : 'Scroll for more…'}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  )
}
