// Manage Cooperations – mounted as the `cooperations` tab of /coop/manage
// (ADR-368 D1; the legacy /coop/offers route now redirects there).
// One merged feed (cooperations + applications + COOP networks) filtered by
// the executor axis All | Human | AI Agent (ListHeader tabs) and by status
// (KPI strip). Type browsing lives in Cooperate Explore.

import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { gsap } from 'gsap'
import {
  ArrowRight, Handshake, FolderKanban,
  Search, TrendingUp, X, ChevronLeft, ChevronRight,
  Pencil, Archive, Zap, Clock, Send,
  Eye, Trash2, MoreVertical, Play,
} from 'lucide-react'
import { Menu, MenuItem, ListItemIcon, ListItemText, Divider } from '@mui/material'
import { ListHeader } from '@ds/ui'
import type { KPIItem } from '@ds/ui'
import { SearchInput } from '../../components/ui/SearchInput'
import { cn } from '@ds/utils'
import { apiCall } from '../../lib/api'
import { formatSats } from '../../lib/currency'
import { FiatHint } from '../../components/currency/FiatHint'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { useSessionState } from '../../hooks/useSessionState'
import { useFABActions } from '../../context/FABContext'
import { useCooperations, useApplications, useOffers, invalidateCooperations, invalidateOffers } from '../../hooks/useEntityQueries'
import { useQueryClient } from '@tanstack/react-query'
import type { CoopTabProps } from '../sell/sell.types'
import {
  CoopGalleryCard, CoopListRow, CoopEmptyState,
  type CoopItem, type CardSize,
} from './coop-cards'
import { FullEditConfirmDialog } from '../../components/coop/FullEditConfirmDialog'

// ── Types ─────────────────────────────────────────────────────────────────────

type ViewMode = 'gallery' | 'list'
type SortOption = 'newest' | 'name'
type StatusGroup = null | 'open' | 'active' | 'disputed' | 'completed' | 'closed'
// ADR-328 D4 + CoopManageView precedent + ADR-368 follow-up (2026-09-05): the
// executor kind is now the manage list's single filter axis, folded into the
// ListHeader as All | Human | AI Agent (uniform with Services / Agent Stack).
// 'human' = cooperations without an AgentProfile milestone, 'agent' =
// cooperations whose CoopMilestones include an AgentProfile assignee.
// Network/offer rows (managed COOP offers) and applications carry no agent
// indicator and are always treated as human.
type KindFilter = null | 'human' | 'agent'

type UnifiedItemType = 'project' | 'tender' | 'application' | 'network'

interface UnifiedItem {
  id: string
  type: UnifiedItemType
  title: string
  subtitle?: string
  status?: string
  statusStyle?: { bg: string; color: string; label: string }
  priceSats?: number
  createdAt?: string
  detailPath?: string
  coopItem?: CoopItem
  appData?: MyApplication
  offerData?: ManagedOffer
  // ADR-328 D4: cached `isAgentOrchestration` from the source CoopItem so
  // computing the Mensch/Agent filter doesn't reach back through the type
  // narrow on every render. Undefined for non-cooperation rows (those are
  // always treated as 'human' — see `isAgent` helper).
  isAgent?: boolean
}

// Exported for the Manage "All" overview tab (same merged-feed shapes).
export interface ManagedOffer {
  id: string
  title: string
  description?: string
  priceSats?: number
  status?: string
  createdAt?: string
  categoryCode?: string
  ticketType?: string
  images?: string[]
  networkType?: string | null
  // ADR-386: server-derived owner gate for COOP networks (unengaged + ACTIVE).
  canFullEdit?: boolean
}

// Exported for the Manage "All" overview tab (same merged-feed shapes).
export interface MyApplication {
  id: string
  cooperationId: string
  cooperationTitle: string
  cooperationType?: string
  cooperationStatus?: string
  cooperationCategoryCode?: string
  cooperationImages?: string[]
  milestoneId: string
  milestoneTitle: string
  milestoneIndex: number
  applicantPubkey: string
  message?: string
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED'
  createdAt: string
  updatedAt: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

// ADR-368 follow-up (2026-09-05): the manage list's single filter axis is the
// executor kind — All | Human | AI Agent — rendered as the ListHeader tabs
// exactly like Services (All/Private/Corporate) and Agent Stack
// (All/Online/Offline). The former item-type tabs (Projects/Tenders/Networks/
// Applications) leave the manage list: type browsing lives in Cooperate
// Explore, and applications stay visible as badges in the merged All feed.
const KIND_TABS: Array<{ key: string; label: string }> = [
  { key: 'all',   label: 'All'      },
  { key: 'human', label: 'Human'    },
  { key: 'agent', label: 'AI Agent' },
]
const KIND_KEY_TO_FILTER: Record<string, KindFilter> = { all: null, human: 'human', agent: 'agent' }

// Exported for the Manage "All" overview tab (same merged-feed shapes).
export const COOP_STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  OPEN:        { bg: 'rgba(72,187,120,0.12)',  color: 'var(--color-status-success)',   label: 'Open'        },
  ACCEPTED:    { bg: 'rgba(99,179,237,0.12)',  color: 'var(--color-primary-50)',       label: 'Accepted'    },
  IN_PROGRESS: { bg: 'rgba(99,179,237,0.12)',  color: 'var(--color-primary-50)',       label: 'In Progress' },
  PAID:        { bg: 'rgba(255,192,57,0.12)',  color: 'var(--color-warning-primary)',  label: 'Paid'        },
  COMPLETED:   { bg: 'rgba(159,122,234,0.12)', color: 'var(--color-secondary-50)',     label: 'Completed'   },
  DISPUTED:    { bg: 'rgba(239,68,68,0.12)',   color: 'var(--color-error-primary)',    label: 'Disputed'    },
  CANCELLED:   { bg: 'rgba(113,128,150,0.12)', color: 'var(--theme-text-muted)',       label: 'Cancelled'   },
  DRAFT:       { bg: 'rgba(113,128,150,0.12)', color: 'var(--theme-text-muted)',       label: 'Draft'       },
  ACTIVE:      { bg: 'rgba(72,187,120,0.12)',  color: 'var(--color-status-success)',   label: 'Active'      },
  CLOSED:      { bg: 'rgba(113,128,150,0.12)', color: 'var(--theme-text-muted)',       label: 'Closed'      },
}

export const APP_STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  PENDING:   { bg: 'rgba(255,192,57,0.12)',  color: 'var(--color-warning-primary)', label: 'Pending'   },
  ACCEPTED:  { bg: 'rgba(72,187,120,0.12)',  color: 'var(--color-status-success)', label: 'Accepted'  },
  DECLINED:  { bg: 'rgba(113,128,150,0.12)', color: 'var(--theme-text-muted)',     label: 'Declined'  },
}

// Colors mirror coop-cards.tsx's typeColor/typeBg so a given cooperation type
// reads the same way here as on the /coop Explore cards.
export const TYPE_BADGE: Record<UnifiedItemType, { label: string; bg: string; color: string }> = {
  project:     { label: 'Project',     bg: 'rgba(72,187,120,0.12)',  color: 'var(--color-status-success)' },
  tender:      { label: 'Tender',      bg: 'rgba(56,189,248,0.12)',  color: 'var(--color-info-primary)' },
  network:     { label: 'Network',     bg: 'rgba(255,192,57,0.14)',  color: 'var(--color-warning-primary)' },
  application: { label: 'Application', bg: 'rgba(159,122,234,0.12)', color: 'var(--color-secondary-50)' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusToGroup(status: string | undefined): StatusGroup {
  switch (status?.toUpperCase()) {
    case 'OPEN':
      return 'open'
    case 'ACCEPTED':
    case 'PAID':
    case 'IN_PROGRESS':
      return 'active'
    case 'COMPLETED':
      return 'completed'
    case 'CANCELLED':
    case 'CLOSED':
    case 'DRAFT':
    case 'ACTIVE':
      return 'closed'
    case 'DISPUTED':
      return 'disputed'
    case 'PENDING':
      return 'open'
    default:
      return null
  }
}

// ── ActionMenuButton (inline, like SellListings) ──────────────────────

function ActionMenuButton({
  menuAnchor,
  onOpen,
  onClose,
  items,
}: {
  menuAnchor: HTMLElement | null
  onOpen: (el: HTMLElement) => void
  onClose: () => void
  items: Array<{ key: string; label: string; icon: ReactNode; color?: string; divider?: boolean; onClick?: () => void }>
}) {
  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); onOpen(e.currentTarget) }}
        className="flex items-center justify-center transition-colors duration-150 rounded-lg cursor-pointer"
        style={{
          width: 32, height: 32,
          background: 'var(--theme-bg-subtle)',
          border: '1px solid var(--theme-border)',
          color: 'var(--theme-text-muted)',
        }}
        aria-label="Options"
      >
        <MoreVertical size={15} strokeWidth={2.5} />
      </button>
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={onClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { borderRadius: 2, minWidth: 160 } } }}
      >
        {items.flatMap((a, idx) => [
          ...(a.divider && idx > 0 ? [<Divider key={`d-${a.key}`} />] : []),
          <MenuItem
            key={a.key}
            onClick={(e) => {
              // Every row is itself a react-router <Link> (CoopListRow/CoopGalleryCard);
              // Menu is portaled to document.body but stays a React child of that Link,
              // so the click still bubbles through React's synthetic event tree into the
              // Link's own onClick and fires its default navigation right after this
              // action's — silently double-navigating every menu action, not just Edit.
              e.stopPropagation()
              e.preventDefault()
              onClose()
              a.onClick?.()
            }}
            sx={a.color ? { color: a.color } : undefined}
          >
            <ListItemIcon sx={a.color ? { color: a.color } : undefined}>{a.icon}</ListItemIcon>
            <ListItemText>{a.label}</ListItemText>
          </MenuItem>,
        ])}
      </Menu>
    </>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CoopOffers({ pubkey, onKpiChange, headerPrefix }: CoopTabProps) {
  const navigate = useNavigate()
  const containerRef = usePageAnimation([
    { selector: '.manage-animate', from: { duration: 0.4, stagger: 0.08, y: 16 } },
  ])

  const queryClient = useQueryClient()
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'cooperation' | 'offer'; id: string; title: string } | null>(null)
  // ADR-386 D4: pending full-form edit, confirmed before switching to the guide.
  const [fullEditConfirm, setFullEditConfirm] = useState<{ id: string; kind: 'cooperation' | 'network' } | null>(null)

  const [statusFilter, setStatusFilter] = useSessionState<StatusGroup>('coopManage:statusFilter', null)
  const [kindFilter, setKindFilter] = useSessionState<KindFilter>('coopManage:kindFilter', null)

  // ── Data Fetching via TanStack Query ────────────────────────────────

  const { data: coopData = [], isLoading: coopsLoading } = useCooperations(pubkey)
  const { data: appData = [], isLoading: appsLoading } = useApplications(pubkey)
  const { data: offerData = [], isLoading: offersLoading } = useOffers(pubkey)

  const cooperations = useMemo(() => coopData as CoopItem[], [coopData])
  const applications = useMemo(() => appData as MyApplication[], [appData])
  const offers = useMemo(() => offerData as ManagedOffer[], [offerData])

  // Query + committed-query + sort persist across in-app navigation within
  // the session (sessionStorage, ADR-242). viewMode/scrollMode already persist
  // (localStorage), pageSize already persists (sessionStorage coopManage_pageSize).
  const [query, setQuery] = useSessionState<string>('coopManage:query', '')
  const [activeQuery, setActiveQuery] = useSessionState<string>('coopManage:activeQuery', '')
  const [sortBy, setSortBy] = useSessionState<SortOption>('coopManage:sortBy', 'newest')
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('coopManage_viewMode')
    return (saved === 'list' || saved === 'gallery') ? saved : 'list'
  })
  const [cardSize] = useState<CardSize>('M')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    const stored = sessionStorage.getItem('coopManage_pageSize')
    return stored ? Number(stored) : 10
  })
  const [scrollMode, setScrollMode] = useState<'paginated' | 'unlimited'>(() => {
    const saved = localStorage.getItem('coopManage_scrollMode')
    return (saved === 'unlimited') ? 'unlimited' : 'paginated'
  })
  const [visibleCount, setVisibleCount] = useState(() => {
    const stored = sessionStorage.getItem('coopManage_pageSize')
    return stored ? Number(stored) : 10
  })
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [menuAnchors, setMenuAnchors] = useState<Record<string, HTMLElement | null>>({})
  const { setActions: setFABActions, clear: clearFAB } = useFABActions()

  function setMenuAnchor(id: string, el: HTMLElement | null) {
    setMenuAnchors(prev => ({ ...prev, [id]: el }))
  }

  // ADR-368 D5 FAB matrix — Cooperations tab: Coop Guide · Service
  // (context=coop) · Agent · Bounty.
  useEffect(() => {
    setFABActions([
      { id: 'coop-guide', label: 'Coop Guide', info: 'Start cooperation', group: 'Cooperate', icon: 'handshake', onClick: () => navigate('/coop/guide') },
      { id: 'create-service', label: 'Service', info: 'Offer your expertise', group: 'Cooperate', icon: 'briefcase', onClick: () => navigate('/offers/new?type=service&context=coop') },
      { id: 'create-agent', label: 'Agent', info: 'Offer a new agent', group: 'Cooperate', icon: 'bot', onClick: () => navigate('/coop/agents/new') },
      { id: 'post-bounty', label: 'Bounty', info: 'Post a bounty for agents to apply to', group: 'Create', icon: 'plus', onClick: () => navigate('/bounties/new') },
    ])
    return () => clearFAB()
  }, [setFABActions, clearFAB, navigate])

  // ── Build unified "All" list ─────────────────────────────────────────

  const allItems = useMemo((): UnifiedItem[] => {
    const items: UnifiedItem[] = []

    for (const coop of cooperations) {
      items.push({
        id: `coop-${coop.id}`,
        type: coop.itemType === 'tender' ? 'tender' : 'project',
        title: coop.title,
        status: coop.status,
        statusStyle: COOP_STATUS_STYLES[coop.status ?? ''] ?? undefined,
        priceSats: coop.budgetSats,
        createdAt: coop.createdAt,
        detailPath: coop.detailPath,
        coopItem: coop,
        isAgent: coop.isAgentOrchestration ?? false,
      })
    }

    for (const app of applications) {
      items.push({
        id: `app-${app.id}`,
        type: 'application',
        title: app.cooperationTitle,
        subtitle: `M${app.milestoneIndex + 1}: ${app.milestoneTitle}`,
        status: app.status,
        statusStyle: APP_STATUS_STYLES[app.status] ?? APP_STATUS_STYLES.PENDING,
        createdAt: app.createdAt,
        detailPath: `/coop/${app.cooperationId}`,
        appData: app,
      })
    }

    for (const offer of offers) {
      items.push({
        id: `offer-${offer.id}`,
        type: 'network',
        title: offer.title,
        status: offer.status,
        statusStyle: COOP_STATUS_STYLES[offer.status ?? 'DRAFT'] ?? COOP_STATUS_STYLES.DRAFT,
        priceSats: offer.priceSats,
        createdAt: offer.createdAt,
        detailPath: `/coop/${offer.id}`,
        offerData: offer,
      })
    }

    return items
  }, [cooperations, applications, offers])

  // ── Filtering & Sorting ─────────────────────────────────────────────

  const currentItems = useMemo((): UnifiedItem[] => {
    let items = [...allItems]
    // Kind filter (All | Human | AI Agent — the ListHeader axis). Only
    // cooperation rows carry a meaningful agent indicator (offered
    // cooperations are always human because useOffers() only fetches
    // offerType=COOP, and applications inherit none).
    if (kindFilter) {
      items = items.filter(i => (i.isAgent ?? false) === (kindFilter === 'agent'))
    }
    if (statusFilter) {
      items = items.filter(i => statusToGroup(i.status) === statusFilter)
    }
    if (activeQuery.trim()) {
      const q = activeQuery.toLowerCase()
      items = items.filter(i =>
        i.title.toLowerCase().includes(q) || (i.subtitle ?? '').toLowerCase().includes(q)
      )
    }
    if (sortBy === 'name') {
      items.sort((a, b) => a.title.localeCompare(b.title))
    } else {
      items.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
    }
    return items
  }, [allItems, activeQuery, sortBy, statusFilter, kindFilter])

  const currentLoading = coopsLoading || appsLoading || offersLoading

  useEffect(() => { setPage(1) }, [kindFilter, activeQuery, sortBy, pageSize])
  useEffect(() => {
    const tp = Math.max(1, Math.ceil(currentItems.length / pageSize))
    if (page > tp) setPage(tp)
  }, [page, currentItems.length, pageSize])

  const totalPages = Math.max(1, Math.ceil(currentItems.length / pageSize))
  const paginatedItems = useMemo(
    () => scrollMode === 'unlimited'
      ? currentItems.slice(0, visibleCount)
      : currentItems.slice((page - 1) * pageSize, page * pageSize),
    [currentItems, scrollMode, visibleCount, page, pageSize],
  )

  // ── GSAP stagger ────────────────────────────────────────────────────

  useEffect(() => {
    if (currentLoading || !listRef.current) return
    const ctx = gsap.from('.manage-list-item-animate', {
      y: 20, opacity: 0, duration: 0.4, stagger: 0.06, ease: 'power2.out', clearProps: 'all',
    })
    return () => { ctx.revert() }
  }, [currentLoading, kindFilter, viewMode, page])

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
  }, [kindFilter, activeQuery, sortBy, pageSize, scrollMode])

  // ── KPI ─────────────────────────────────────────────────────────────

  const kpiItems = useMemo<KPIItem[]>(() => {
    const openCount = allItems.filter(i => statusToGroup(i.status) === 'open').length
    const activeCount = allItems.filter(i => statusToGroup(i.status) === 'active').length
    const disputedCount = allItems.filter(i => statusToGroup(i.status) === 'disputed').length
    const completedCount = allItems.filter(i => statusToGroup(i.status) === 'completed').length
    const closedCount = allItems.filter(i => statusToGroup(i.status) === 'closed').length

    const incomeSats = cooperations
      .filter(c => c.initiatorPubkey === pubkey && c.status !== 'CANCELLED' && c.status !== 'DRAFT')
      .reduce((sum, c) => sum + (c.budgetSats ?? 0), 0)
    const expenseSats = cooperations
      .filter(c => c.partnerPubkey === pubkey && c.status !== 'CANCELLED' && c.status !== 'DRAFT')
      .reduce((sum, c) => sum + (c.budgetSats ?? 0), 0)

    return [
      { icon: <Handshake size={14} />,   value: allItems.length,  label: 'All',       active: statusFilter === null,       onClick: () => setStatusFilter(null), heading: 'Status' },
      { icon: <Send size={14} />,         value: openCount,        label: 'Open',      color: 'var(--color-status-success)',  active: statusFilter === 'open',      onClick: () => setStatusFilter(prev => prev === 'open' ? null : 'open') },
      { icon: <TrendingUp size={14} />,   value: activeCount,      label: 'Active',    color: 'var(--color-primary-50)',      active: statusFilter === 'active',    onClick: () => setStatusFilter(prev => prev === 'active' ? null : 'active') },
      { icon: <Zap size={14} />,          value: disputedCount,    label: 'Disputed',  color: 'var(--color-error-primary)',   active: statusFilter === 'disputed',  onClick: () => setStatusFilter(prev => prev === 'disputed' ? null : 'disputed') },
      { icon: <FolderKanban size={14} />, value: completedCount,   label: 'Completed', color: 'var(--color-secondary-50)',    active: statusFilter === 'completed', onClick: () => setStatusFilter(prev => prev === 'completed' ? null : 'completed') },
      { icon: <Archive size={14} />,      value: closedCount,       label: 'Closed',    color: 'var(--theme-text-muted)',       active: statusFilter === 'closed',    onClick: () => setStatusFilter(prev => prev === 'closed' ? null : 'closed') },
      { icon: <TrendingUp size={14} />,   value: incomeSats,       label: 'Income',    color: 'var(--color-status-success)',  tooltip: `${formatSats(incomeSats, { compact: false })} received as initiator`, heading: 'Finances', separator: true },
      { icon: <TrendingUp size={14} />,   value: expenseSats,      label: 'Expenses',  color: 'var(--color-error-primary)',   tooltip: `${formatSats(expenseSats, { compact: false })} committed as partner` },
    ]
  }, [allItems, cooperations, statusFilter, pubkey])

  // ADR-368 D1: lift KPIs to the /coop/manage shell (it renders the strip).
  useEffect(() => {
    onKpiChange(kpiItems, coopsLoading || appsLoading || offersLoading)
  }, [onKpiChange, kpiItems, coopsLoading, appsLoading, offersLoading])

  // ── Handlers ────────────────────────────────────────────────────────

  function handleSearch() { setActiveQuery(query) }
  function handleClear() { setQuery(''); setActiveQuery('') }
  function handleTabChange(key: string) {
    setKindFilter(KIND_KEY_TO_FILTER[key] ?? null)
    setActiveQuery('')
    setQuery('')
  }
  function handleViewModeChange(mode: ViewMode) {
    setViewMode(mode)
    localStorage.setItem('coopManage_viewMode', mode)
  }

  function handleCoopAction(action: string, item: UnifiedItem) {
    if (!item.coopItem) return
    const id = item.coopItem.id
    if (action === 'view') {
      navigate(`/coop/${id}`)
      return
    }
    if (action === 'edit') {
      // ADR-296: a DRAFT was never finished in the Coop-Guide — resume the guide
      // itself (hydrated from the saved draft) instead of the read-only detail page.
      // ADR-386: a published but still unengaged cooperation (server canFullEdit)
      // also opens the full form, behind a confirmation.
      const isDraft = item.coopItem.status?.toUpperCase() === 'DRAFT'
      if (isDraft) {
        navigate('/coop/guide', { state: { editId: id } })
      } else if (item.coopItem.canFullEdit) {
        setFullEditConfirm({ id, kind: 'cooperation' })
      } else {
        navigate(`/coop/${id}`)
      }
      return
    }
    if (action === 'publish') {
      apiCall(`/api/cooperations/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'OPEN' }) })
        .then(() => invalidateCooperations(queryClient, pubkey)).catch(console.error)
      return
    }
    if (action === 'cancel') {
      apiCall(`/api/cooperations/${id}/cancel`, { method: 'POST' })
        .then(() => invalidateCooperations(queryClient, pubkey)).catch(console.error)
      return
    }
    if (action === 'delete') {
      setDeleteConfirm({ type: 'cooperation', id, title: item.title })
      return
    }
  }

  function handleOfferAction(action: string, item: UnifiedItem) {
    if (!item.offerData) return
    const id = item.offerData.id
    if (action === 'view') {
      navigate(`/coop/${id}`)
      return
    }
    if (action === 'edit') {
      // ADR-296: a DRAFT was never finished in the Coop-Guide — resume the guide
      // itself (hydrated from the saved draft) instead of the read-only detail page.
      // ADR-386: a published but still unengaged network (server canFullEdit)
      // also opens the full form, behind a confirmation.
      const isDraft = item.offerData.status?.toUpperCase() === 'DRAFT'
      if (isDraft) {
        navigate('/coop/guide', { state: { editId: id } })
      } else if (item.offerData.canFullEdit) {
        setFullEditConfirm({ id, kind: 'network' })
      } else {
        navigate(`/coop/${id}`)
      }
      return
    }
    if (action === 'publish') {
      apiCall(`/api/offers/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE', creatorPubkey: pubkey }) })
        .then(() => invalidateOffers(queryClient, pubkey)).catch(console.error)
      return
    }
    if (action === 'archive') {
      apiCall(`/api/offers/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ARCHIVED', creatorPubkey: pubkey }) })
        .then(() => invalidateOffers(queryClient, pubkey)).catch(console.error)
      return
    }
    if (action === 'delete') {
      setDeleteConfirm({ type: 'offer', id, title: item.title })
      return
    }
  }

  async function confirmDelete() {
    if (!deleteConfirm) return
    try {
      if (deleteConfirm.type === 'cooperation') {
        await apiCall(`/api/cooperations/${deleteConfirm.id}/cancel`, { method: 'POST' })
        invalidateCooperations(queryClient, pubkey)
      } else {
        await apiCall(`/api/offers/${deleteConfirm.id}`, { method: 'DELETE', body: JSON.stringify({ creatorPubkey: pubkey }) })
        invalidateOffers(queryClient, pubkey)
      }
    } catch (err) {
      console.error('Failed to delete:', err)
    }
    setDeleteConfirm(null)
  }

  const galleryCols = 'grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4'

  // ── Render: Unified row (works for all tabs) ─────────────────────────

  function renderItem(item: UnifiedItem) {
    const badge = TYPE_BADGE[item.type]

    if (item.coopItem) {
      const status = item.coopItem.status?.toUpperCase() ?? 'DRAFT'
      const isDraft = status === 'DRAFT'
      const isOpen = status === 'OPEN'
      const isActive = ['ACCEPTED', 'PAID', 'IN_PROGRESS'].includes(status)
      const isClosed = ['COMPLETED', 'CANCELLED', 'DISPUTED'].includes(status)
      const menuId = `coop-${item.coopItem.id}`

      const menuItems = [
        { key: 'view', label: 'View', icon: <Eye size={16} />, onClick: () => handleCoopAction('view', item) },
        { key: 'edit', label: 'Edit', icon: <Pencil size={16} />, onClick: () => handleCoopAction('edit', item), show: !isClosed },
        { key: 'publish', label: 'Publish', icon: <Play size={16} />, onClick: () => handleCoopAction('publish', item), show: isDraft, color: 'success.main' },
        { key: 'cancel', label: 'Cancel', icon: <Archive size={16} />, onClick: () => handleCoopAction('cancel', item), show: isOpen || isActive, color: 'text.secondary' },
        { key: 'delete', label: 'Cancel & Remove', icon: <Trash2 size={16} />, onClick: () => handleCoopAction('delete', item), show: isDraft, color: 'error.main', divider: true },
      ].filter(a => a.show !== false)

      const actions = (
        <ActionMenuButton
          menuAnchor={menuAnchors[menuId] ?? null}
          onOpen={(el) => setMenuAnchor(menuId, el)}
          onClose={() => setMenuAnchor(menuId, null)}
          items={menuItems.map(m => ({ key: m.key, label: m.label, icon: m.icon, onClick: m.onClick, color: (m as { color?: string }).color, divider: (m as { divider?: boolean }).divider }))}
        />
      )

      return (
        <div onClick={(e) => {
          const target = e.target as HTMLElement
          if (target.closest('[aria-label="Options"]') || target.closest('.MuiMenu-root') || target.closest('.MuiBackdrop-root')) return
          handleCoopAction('view', item)
        }}>
          {viewMode === 'gallery'
            ? <CoopGalleryCard item={item.coopItem} size={cardSize} actions={actions} />
            : <CoopListRow item={item.coopItem} size={cardSize} actions={actions} />
          }
        </div>
      )
    }

    if (item.appData) {
      const app = item.appData
      const hasImage = app.cooperationImages?.[0]
      return (
        <Link
          to={item.detailPath ?? '#'}
          className={cn(
            'flex items-center gap-4 p-4 rounded-xl border no-underline',
            'transition-all duration-200 hover:shadow-sm',
          )}
          style={{
            border: '1px solid var(--theme-border)',
            background: 'var(--theme-surface)',
          }}
        >
          <div
            className="flex items-center justify-center shrink-0 overflow-hidden rounded-lg"
            style={{ width: 64, height: 64, background: hasImage ? 'var(--theme-bg-subtle)' : badge.bg }}
          >
            {hasImage ? (
              <img
                src={app.cooperationImages?.[0]}
                alt={item.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <Send size={18} style={{ color: badge.color }} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span
                className="px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0"
                style={{ background: badge.bg, color: badge.color }}
              >
                {badge.label}
              </span>
              <h4 className="text-[14px] font-semibold truncate" style={{ color: 'var(--theme-text)' }}>
                {item.title}
              </h4>
              {item.statusStyle && (
                <span
                  className="px-2 py-0.5 rounded text-[11px] font-medium shrink-0"
                  style={{ background: item.statusStyle.bg, color: item.statusStyle.color }}
                >
                  {item.statusStyle.label}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }}>
                {item.subtitle}
              </span>
              {item.createdAt && (
                <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
                  <Clock size={11} />
                  {new Date(item.createdAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
          <ArrowRight size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        </Link>
      )
    }

    const offer = item.offerData!
    const offerStatus = offer.status?.toUpperCase() ?? 'DRAFT'
    const offerIsDraft = offerStatus === 'DRAFT'
    const offerIsActive = offerStatus === 'ACTIVE'
    // item.type is always 'network' here — useOffers() only ever returns
    // offerType=COOP records (see hooks/useEntityQueries.ts).
    const typeColor = badge.color
    const typeBg = badge.bg
    const menuId = `offer-${offer.id}`

    const menuItems = [
      { key: 'view', label: 'View', icon: <Eye size={16} />, onClick: () => handleOfferAction('view', item) },
      { key: 'edit', label: 'Edit', icon: <Pencil size={16} />, onClick: () => handleOfferAction('edit', item) },
      { key: 'publish', label: 'Publish', icon: <Play size={16} />, onClick: () => handleOfferAction('publish', item), show: offerIsDraft, color: 'success.main' },
      { key: 'archive', label: 'Archive', icon: <Archive size={16} />, onClick: () => handleOfferAction('archive', item), show: offerIsActive, color: 'text.secondary' },
      { key: 'delete', label: 'Delete', icon: <Trash2 size={16} />, onClick: () => handleOfferAction('delete', item), show: offerIsDraft, color: 'error.main', divider: true },
    ].filter(a => a.show !== false)

    if (viewMode === 'gallery') {
      return (
        <Link
          to={item.detailPath ?? `/coop/${offer.id}`}
          className={cn(
            'flex flex-col rounded-xl border overflow-hidden no-underline cursor-pointer',
            'shadow-[0_2px_8px_rgba(0,0,0,0.08)]',
            'transition-all duration-300 ease-out',
            'hover:z-10 hover:scale-[1.03] hover:shadow-[0_12px_32px_rgba(0,0,0,0.18)]',
            'active:scale-[0.99] h-full relative',
          )}
          style={{
            background: 'var(--theme-surface)',
            border: '1px solid var(--theme-border)',
          }}
        >
          <div
            className="relative flex items-center justify-center shrink-0 overflow-hidden"
            style={{ height: 110, background: offer.images?.length ? 'var(--theme-bg-subtle)' : typeBg }}
          >
            {offer.images?.[0] ? (
              <img src={offer.images[0]} alt={offer.title} className="w-full h-full object-cover" style={{ opacity: 0.9 }} />
            ) : (
              <FolderKanban size={40} style={{ color: typeColor, opacity: 0.85 }} />
            )}
            <span className="absolute top-2 left-2 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.28)', color: 'white', backdropFilter: 'blur(4px)' }}>
              {badge.label}
            </span>
            {item.statusStyle && (
              <span className="absolute top-2 right-2 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ background: item.statusStyle.bg, color: item.statusStyle.color }}>
                {item.statusStyle.label}
              </span>
            )}
          </div>
          <div className="flex flex-col flex-1 p-3 gap-1.5">
            <h4 className="text-[14px] font-semibold leading-snug" style={{ color: 'var(--theme-text)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {offer.title}
            </h4>
            <div className="flex items-center justify-between gap-1 mt-auto">
              <div className="flex items-center gap-3">
                {offer.priceSats && offer.priceSats > 0 && (
                  <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded" style={{ background: 'rgba(99,179,237,0.10)', color: 'var(--color-primary-50)', fontWeight: 700 }}>
                    <Zap size={11} />
                    {formatSats(offer.priceSats, { compact: false })}
                    <FiatHint sats={offer.priceSats} className="text-[0.9em] ml-[3px]" />
                  </span>
                )}
                {offer.createdAt && (
                  <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
                    <Clock size={10} />
                    {new Date(offer.createdAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              <ActionMenuButton
                menuAnchor={menuAnchors[menuId] ?? null}
                onOpen={(el) => setMenuAnchor(menuId, el)}
                onClose={() => setMenuAnchor(menuId, null)}
                items={menuItems.map(m => ({ key: m.key, label: m.label, icon: m.icon, onClick: m.onClick, color: (m as { color?: string }).color, divider: (m as { divider?: boolean }).divider }))}
              />
            </div>
          </div>
        </Link>
      )
    }

    return (
      <div
        className={cn(
          'flex items-center gap-4 p-4 rounded-xl border',
          'transition-all duration-200 hover:shadow-sm cursor-pointer',
        )}
        style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('[aria-label="Options"]') || (e.target as HTMLElement).closest('.MuiMenu-root') || (e.target as HTMLElement).closest('.MuiBackdrop-root')) return
          handleOfferAction('view', item)
        }}
      >
        <div
          className="flex items-center justify-center shrink-0 overflow-hidden rounded-lg"
          style={{ width: 64, height: 64, background: offer.images?.length ? 'var(--theme-bg-subtle)' : typeBg }}
        >
          {offer.images?.[0] ? (
            <img src={offer.images[0]} alt={offer.title} className="w-full h-full object-cover" />
          ) : (
            <FolderKanban size={22} style={{ color: typeColor, opacity: 0.85 }} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0" style={{ background: badge.bg, color: badge.color }}>
              {badge.label}
            </span>
            <h4 className="text-[14px] font-semibold truncate" style={{ color: 'var(--theme-text)' }}>
              {offer.title}
            </h4>
            {item.statusStyle && (
              <span className="px-2 py-0.5 rounded text-[11px] font-medium shrink-0" style={{ background: item.statusStyle.bg, color: item.statusStyle.color }}>
                {item.statusStyle.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {offer.priceSats && offer.priceSats > 0 && (
              <span className="flex items-center gap-1 text-[12px]" style={{ color: 'var(--color-warning-primary)' }}>
                <Zap size={11} />
                {formatSats(offer.priceSats, { compact: false })}
                <FiatHint sats={offer.priceSats} className="text-[11px] ml-0.5" style={{ color: 'var(--theme-text-muted)' }} />
              </span>
            )}
            {offer.createdAt && (
              <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
                <Clock size={11} />
                {new Date(offer.createdAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        <ActionMenuButton
          menuAnchor={menuAnchors[menuId] ?? null}
          onOpen={(el) => setMenuAnchor(menuId, el)}
          onClose={() => setMenuAnchor(menuId, null)}
          items={menuItems.map(m => ({ key: m.key, label: m.label, icon: m.icon, onClick: m.onClick, color: (m as { color?: string }).color, divider: (m as { divider?: boolean }).divider }))}
        />
      </div>
    )
  }

  // ── Render: Results ─────────────────────────────────────────────────

  function renderResults() {
    if (currentLoading) {
      if (viewMode === 'gallery') {
        return (
          <div className={`grid gap-2 ${galleryCols}`}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl animate-pulse"
                style={{ height: 190, background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}
              />
            ))}
          </div>
        )
      }
      return (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl animate-pulse"
              style={{ height: 72, background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}
            />
          ))}
        </div>
      )
    }

    if (currentItems.length === 0) {
      const emptyMsg = activeQuery
        ? 'No results found. Try different filters.'
        : kindFilter === 'agent'
          ? 'No AI-agent cooperations yet.'
          : kindFilter === 'human'
            ? 'No human-led cooperations yet.'
            : 'No cooperations, applications, or networks yet.'
      const emptySub = activeQuery
        ? 'Try clearing the search.'
        : kindFilter
          ? 'Switch to “All” to see all rows.'
          : ''
      return <CoopEmptyState message={emptyMsg} sub={emptySub} />
    }

    if (viewMode === 'gallery') {
      return (
        <div ref={listRef} className={`grid gap-2 ${galleryCols}`} style={{ perspective: 800 }}>
          {paginatedItems.map(item => (
            <div key={item.id} className="manage-list-item-animate">
              {renderItem(item)}
            </div>
          ))}
        </div>
      )
    }

    return (
      <div ref={listRef} className="flex flex-col gap-2">
        {paginatedItems.map(item => (
          <div key={item.id} className="manage-list-item-animate">
            {renderItem(item)}
          </div>
        ))}
      </div>
    )
  }

  // ── Main Render ─────────────────────────────────────────────────────

  return (
    <>
    {/* ADR-368 D1: content of the `cooperations` tab of /coop/manage. The
        shell owns the page chrome (PageContainer/PageHeader/KPIStrip/FAB);
        this child lifts KPIs via onKpiChange and renders the shell's sub-tab
        pill inline with its own ListHeader (uniform Manage header line). */}
    <div ref={containerRef} className="flex flex-col gap-2">
      <div className="manage-animate">
        {/* ADR-368 follow-up (2026-09-05): uniform header line like every
            other Manage tab — the shell SubTabPill sits NEXT to the
            ListHeader in one row on desktop (>=600px), stacked above it on
            mobile (SubTabPill arrangement contract, ListBrowser style). The
            ListHeader tabs ARE the executor filter (All | Human | AI Agent);
            the former separate kind pill row below is gone. */}
        <div className="flex flex-col md:flex-row md:items-center gap-2">
          <div className="shrink-0">{headerPrefix}</div>
          <div className="flex-1 min-w-0">
            <ListHeader
              tabs={KIND_TABS}
              activeTab={kindFilter ?? 'all'}
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
                      placeholder="Search…"
                      autoFocus
                      ariaLabel="Search manage"
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
                      <option value="name">Name A–Z</option>
                    </select>
                  ),
                },
              ]}
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
              mt={0}
            />
          </div>
        </div>

        {activeQuery && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <div
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg"
              style={{ background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.20)' }}
            >
              <Search size={11} style={{ color: 'var(--color-primary-50)' }} />
              <span className="text-[11px]" style={{ color: 'var(--color-primary-50)' }}>"{activeQuery}"</span>
              <button
                onClick={handleClear}
                className="cursor-pointer"
                style={{ background: 'none', border: 'none', padding: 1 }}
                aria-label="Clear search"
              >
                <X size={11} style={{ color: 'var(--color-primary-50)' }} />
              </button>
            </div>
            <span className="text-[11px] ml-1" style={{ color: 'var(--theme-text-muted)' }}>
              {currentItems.length} result{currentItems.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        <div className="flex flex-col gap-2 mt-3">
          <div>{renderResults()}</div>

          {scrollMode === 'unlimited' && !currentLoading && visibleCount < currentItems.length && (
            <div ref={loadMoreRef} className="flex items-center justify-center py-2">
              {isLoadingMore && (
                <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>Loading more…</span>
              )}
            </div>
          )}

          {!currentLoading && currentItems.length > 0 && (
            <div
              className={`shrink-0 flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl${scrollMode === 'unlimited' ? ' sticky bottom-0 z-10' : ''}`}
              style={{
                color: 'var(--theme-text-muted)',
                background: 'var(--theme-surface)',
                border: '1px solid var(--theme-border)',
              }}
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px]">Show</span>
                {scrollMode === 'paginated' ? (
                  <select
                    value={pageSize}
                    onChange={e => {
                      const size = Number(e.target.value)
                      sessionStorage.setItem('coopManage_pageSize', String(size))
                      setPageSize(size)
                    }}
                    className="text-[11px] rounded-md px-1.5 py-1 cursor-pointer"
                    style={{
                      background: 'var(--theme-bg-subtle)',
                      border: '1px solid var(--theme-border)',
                      color: 'var(--theme-text)',
                    }}
                  >
                    {[5, 10, 20, 50, 100, 200].map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-[11px]" style={{ color: 'var(--color-primary-50)', fontWeight: 600 }}>
                    All ({currentItems.length})
                  </span>
                )}
                <span className="text-[11px]">per page</span>
                <div style={{ width: 1, height: 14, background: 'var(--theme-border)', margin: '0 4px' }} />
                <button
                  onClick={() => {
                    const next = scrollMode === 'paginated' ? 'unlimited' : 'paginated'
                    setScrollMode(next)
                    localStorage.setItem('coopManage_scrollMode', next)
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
                  ? `${Math.min(visibleCount, currentItems.length)} / ${currentItems.length}`
                  : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, currentItems.length)} of ${currentItems.length}`
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
                  {visibleCount >= currentItems.length ? 'End of results' : 'Scroll for more…'}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-sm p-5 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
            <h3 className="text-[16px] font-semibold mb-2" style={{ color: 'var(--theme-text)' }}>{deleteConfirm.type === 'cooperation' ? 'Cancel Cooperation' : 'Delete Offer'}?</h3>
            <p className="text-[13px] mb-4" style={{ color: 'var(--theme-text-muted)' }}>&quot;{deleteConfirm.title}&quot; will be {deleteConfirm.type === 'cooperation' ? 'cancelled' : 'deleted'} and cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 cursor-pointer hover:opacity-90" style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text)' }}>
                Cancel
              </button>
              <button onClick={confirmDelete} className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 cursor-pointer hover:opacity-90" style={{ background: 'var(--color-status-error)', color: 'white' }}>
                {deleteConfirm?.type === 'cooperation' ? 'Cancel' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADR-386 D4: confirm before switching to the full Coop-Guide form. */}
      <FullEditConfirmDialog
        open={!!fullEditConfirm}
        entityLabel={fullEditConfirm?.kind ?? 'cooperation'}
        onClose={() => setFullEditConfirm(null)}
        onConfirm={() => {
          const pending = fullEditConfirm
          setFullEditConfirm(null)
          if (pending) navigate('/coop/guide', { state: { editId: pending.id } })
        }}
      />
    </>
  )
}
