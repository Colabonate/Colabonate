// ESCROW-COPY (ADR-397): payment wording here assumes Direct-Pay. On escrow activation follow docs/plans/ESCROW-COPY-REACTIVATION.md.
// ADR-368: the "My Bounties" board (ADR-319 / FU-428, formerly the standalone
// /bounties page) converted into a tab mounted by the Cooperate Manage shell
// (/coop/manage?tab=bounties). The shell owns the page chrome (PageContainer,
// PageHeader, KPIStrip, SubTabPill, FloatingAddButton, auth gate, <Seo
// noindex />); this tab lifts its KPI strip items up via onKpiChange and
// registers its single "Post a bounty" FAB action — the same pattern as
// ListingsTab / AgentStackTab under SellListings. All internal behavior
// (status filter, search, gallery/list view, pagination, empty-state guide)
// and the session/localStorage keys are preserved 1:1 from the standalone
// board so user preferences survive the move.
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Target, Send, Loader2, CheckCircle2, XCircle, Clock3,
  Search, X, ChevronLeft, ChevronRight, Zap, Bot, Users, Layers,
  Handshake, ShieldCheck, Sparkles,
} from 'lucide-react'
import { ListHeader, CardImage } from '@ds/ui'
import type { KPIItem } from '@ds/ui'
import { EmptyStateGuide } from '../../../components/EmptyStateGuide'
import { SearchInput } from '../../../components/ui/SearchInput'
import { FiatHint } from '../../../components/currency/FiatHint'
import { formatSats } from '../../../lib/currency'
import { useTranslation } from '../../../contexts/LocaleContext'
import { useSessionState } from '../../../hooks/useSessionState'
import { useFABActions } from '../../../context/FABContext'
import { useAgentTasks, useAgentTaskCounts } from '../../../hooks/useAgentTaskQueries'
import { usePageListViewMode } from '../../../hooks/usePageListViewMode'
import type { AgentTask, AgentTaskStatus } from '../../../hooks/useAgentTaskQueries'
import type { CoopTabProps } from '../../sell/sell.types'

// ── Status Config ─────────────────────────────────────────────────────

type StatusIconType = typeof Clock3

const STATUS_CONFIG: Record<AgentTaskStatus, { label: string; bg: string; color: string; border: string; icon: StatusIconType }> = {
  OPEN:      { label: 'Open',      bg: 'rgba(72,187,120,0.18)',  color: '#48B978', border: 'rgba(72,187,120,0.40)',  icon: Send },
  SELECTING: { label: 'Selecting', bg: 'rgba(99,179,237,0.18)',  color: '#63B3ED', border: 'rgba(99,179,237,0.40)',  icon: Loader2 },
  ASSIGNED:  { label: 'Assigned',  bg: 'rgba(159,122,234,0.18)', color: '#9F7AEA', border: 'rgba(159,122,234,0.40)', icon: CheckCircle2 },
  IN_PROGRESS: { label: 'In progress', bg: 'rgba(245,166,35,0.18)', color: '#F5A623', border: 'rgba(245,166,35,0.40)', icon: Loader2 },
  COMPLETED: { label: 'Completed', bg: 'rgba(72,187,120,0.18)',  color: '#48B978', border: 'rgba(72,187,120,0.40)',  icon: CheckCircle2 },
  CANCELLED: { label: 'Cancelled', bg: 'rgba(113,128,150,0.18)', color: '#718096', border: 'rgba(113,128,150,0.40)', icon: XCircle },
  EXPIRED:   { label: 'Expired',   bg: 'rgba(245,101,101,0.18)', color: '#F56565', border: 'rgba(245,101,101,0.40)', icon: Clock3 },
}

const SUPERVISION_BADGE: Record<'HUMAN' | 'AUTONOMOUS', string> = {
  HUMAN: 'Human-in-the-loop only',
  AUTONOMOUS: 'Fully autonomous only',
}

type ViewMode = 'gallery' | 'list'

// ── Bounty Card (list row) ────────────────────────────────────────────────
// Exported for the Manage "All" overview tab (pure Link rows, no actions).
export function BountyListRow({ bounty }: { bounty: AgentTask }) {
  const { formatDate } = useTranslation()
  const statusCfg = STATUS_CONFIG[bounty.status]
  const StatusIcon = statusCfg.icon

  return (
    <Link
      to={`/bounties/${bounty.id}`}
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
        className="self-stretch shrink-0 rounded-lg overflow-hidden"
        style={{ width: 52, height: 52, background: 'rgba(159,122,234,0.12)' }}
      >
        <CardImage
          className="w-full h-full"
          src={bounty.images?.[0]}
          alt={bounty.title}
          fallback={
            <span className="absolute inset-0 flex items-center justify-center">
              <Target size={20} style={{ color: 'var(--color-secondary-50)' }} />
            </span>
          }
        />
      </div>

      <div className="flex flex-col flex-1 min-w-0 py-0.5">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <span className="truncate" style={{ fontSize: 13, fontWeight: 600, color: 'var(--theme-text)' }}>
            {bounty.title}
          </span>
        </div>

        <p
          className="text-[12px] mb-1.5"
          style={{ color: 'var(--theme-text-muted)', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {bounty.description}
        </p>

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

          <span
            className="inline-flex items-center gap-0.5"
            style={{
              padding: '2px 8px', borderRadius: 6,
              background: 'rgba(99,179,237,0.10)', fontSize: 11, fontWeight: 700,
              fontVariantNumeric: 'tabular-nums', color: 'var(--color-primary-50)', whiteSpace: 'nowrap',
            }}
          >
            <Zap size={11} />
            {formatSats(bounty.budgetSats, { compact: false })}
            <FiatHint sats={bounty.budgetSats} className="text-[0.9em] ml-[3px]" />
          </span>

          {bounty.requiredCapabilities.slice(0, 3).map(c => (
            <span
              key={c}
              className="px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0"
              style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-secondary)', border: '1px solid var(--theme-border)' }}
            >
              {c}
            </span>
          ))}
          {bounty.requiredCapabilities.length > 3 && (
            <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
              +{bounty.requiredCapabilities.length - 3}
            </span>
          )}

          {bounty.preferredSupervision && (
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0"
              style={{ background: 'rgba(56,189,248,0.10)', color: 'var(--color-info-primary)', border: '1px solid rgba(56,189,248,0.25)' }}
            >
              {SUPERVISION_BADGE[bounty.preferredSupervision]}
            </span>
          )}

          <span style={{ fontSize: 10, color: 'var(--theme-text-muted)' }}>
            {formatDate(new Date(bounty.createdAt), { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>

          {bounty.deadline && (
            <span className="text-[10px]" style={{ color: 'var(--color-warning-primary)' }}>
              Deadline: {formatDate(new Date(bounty.deadline), { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

// ── Bounty Card (gallery) ─────────────────────────────────────────────────
// Exported for the Manage "All" overview tab (pure Link cards, no actions).
export function BountyGalleryCard({ bounty }: { bounty: AgentTask }) {
  const { formatDate } = useTranslation()
  const statusCfg = STATUS_CONFIG[bounty.status]

  return (
    <Link
      to={`/bounties/${bounty.id}`}
      className="flex flex-col rounded-xl border overflow-hidden no-underline cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all duration-300 ease-out hover:z-10 hover:scale-[1.03] hover:shadow-[0_12px_32px_rgba(0,0,0,0.18)] active:scale-[0.99] h-full relative"
      style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
    >
      <div
        className="relative flex items-center justify-center shrink-0 overflow-hidden"
        style={{ height: 90, background: 'rgba(159,122,234,0.12)' }}
      >
        <CardImage
          className="w-full h-full"
          src={bounty.images?.[0]}
          alt={bounty.title}
          fallback={
            <span className="absolute inset-0 flex items-center justify-center">
              <Target size={36} style={{ color: 'var(--color-secondary-50)', opacity: 0.85 }} />
            </span>
          }
        />
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
          {bounty.title}
        </h4>
        <p
          className="text-[11px] leading-snug"
          style={{ color: 'var(--theme-text-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {bounty.description}
        </p>
        <div className="flex flex-wrap gap-1 mt-1">
          {bounty.requiredCapabilities.slice(0, 2).map(c => (
            <span
              key={c}
              className="px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0"
              style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-secondary)', border: '1px solid var(--theme-border)' }}
            >
              {c}
            </span>
          ))}
          {bounty.preferredSupervision && (
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0"
              style={{ background: 'rgba(56,189,248,0.10)', color: 'var(--color-info-primary)', border: '1px solid rgba(56,189,248,0.25)' }}
            >
              {SUPERVISION_BADGE[bounty.preferredSupervision]}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-1 mt-auto">
          <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded" style={{ background: 'rgba(99,179,237,0.10)', color: 'var(--color-primary-50)', fontWeight: 700 }}>
            <Zap size={11} />
            {formatSats(bounty.budgetSats, { compact: false })}
            <FiatHint sats={bounty.budgetSats} className="text-[0.9em] ml-[3px]" />
          </span>
          <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
            <Clock3 size={10} />
            {formatDate(new Date(bounty.createdAt), { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </div>
      </div>
    </Link>
  )
}

// ── Skeleton ─────────────────────────────────────────────────────────

function SkeletonBountyCard() {
  return (
    <div
      className="flex items-start gap-3 p-3 rounded-xl animate-pulse"
      style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
    >
      <div className="shrink-0 rounded-lg" style={{ width: 52, height: 52, background: 'var(--color-neutral-8)' }} />
      <div className="flex flex-col flex-1 gap-2 py-1">
        <div className="h-4 w-3/5 rounded" style={{ background: 'var(--color-neutral-8)' }} />
        <div className="h-3 w-4/5 rounded" style={{ background: 'var(--color-neutral-9)' }} />
        <div className="h-3 w-2/5 rounded" style={{ background: 'var(--color-neutral-9)' }} />
      </div>
    </div>
  )
}

// ── BountiesTab Component ───────────────────────────────────────────────

export function BountiesTab({ pubkey, onKpiChange, headerPrefix }: CoopTabProps) {
  const navigate = useNavigate()
  const { setActions: setFABActions, clear: clearFAB } = useFABActions()

  const [statusFilter, setStatusFilter] = useSessionState<AgentTaskStatus>('bountyBoard:status', 'OPEN')
  const [query, setQuery] = useSessionState<string>('bountyBoard:query', '')
  const [activeQuery, setActiveQuery] = useSessionState<string>('bountyBoard:activeQuery', '')
  // ADR-368 follow-up: Grid/List is a page-level preference — shared with the
  // other /coop/manage subtabs via the 'coopManage_viewMode' key (legacy key
  // migrated once from the standalone board).
  const [viewMode, setViewMode] = usePageListViewMode({
    storageKey: 'coopManage_viewMode',
    legacyKey: 'bountyBoard_viewMode',
    initial: 'list',
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    const stored = sessionStorage.getItem('bountyBoard_pageSize')
    return stored ? Number(stored) : 10
  })

  const { data, isLoading } = useAgentTasks({ status: statusFilter, creatorPubkey: pubkey, limit: pageSize, offset: (page - 1) * pageSize })
  const { data: mineCounts } = useAgentTaskCounts(pubkey)

  const bounties = data?.tasks ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const visibleBounties = useMemo(() => {
    if (!activeQuery.trim()) return bounties
    const q = activeQuery.toLowerCase()
    return bounties.filter(b => b.title.toLowerCase().includes(q) || b.description.toLowerCase().includes(q))
  }, [bounties, activeQuery])

  useEffect(() => { setPage(1) }, [statusFilter, pageSize])

  function handlePostBounty() {
    navigate('/bounties/new')
  }

  useEffect(() => {
    setFABActions([
      { id: 'post-bounty', label: 'Bounty', info: 'Post a bounty for agents to apply to', group: 'Create', icon: 'plus', onClick: () => navigate('/bounties/new') },
    ])
    return () => clearFAB()
  }, [setFABActions, clearFAB, navigate])

  function handleSearch() { setActiveQuery(query) }
  function handleClear() { setQuery(''); setActiveQuery('') }
  function handleViewModeChange(mode: ViewMode) {
    // Persists to the page-wide 'coopManage_viewMode' key via the hook.
    setViewMode(mode)
  }

  // ── KPI (lifted to the shell's KPIStrip) ────────────────────────────

  const activeCounts = mineCounts
  const countsLoading = !mineCounts

  const kpiItems = useMemo<KPIItem[]>(() => {
    const c = activeCounts?.byStatus
    return [
      { icon: <Target size={14} />,        value: activeCounts?.all ?? 0, label: 'All',       active: false,                        onClick: undefined, heading: 'Status' },
      { icon: <Send size={14} />,          value: c?.OPEN ?? 0,      label: 'Open',       color: 'var(--color-status-success)',  active: statusFilter === 'OPEN',      onClick: () => setStatusFilter('OPEN') },
      { icon: <Loader2 size={14} />,       value: c?.SELECTING ?? 0, label: 'Selecting',  color: 'var(--color-primary-50)',      active: statusFilter === 'SELECTING', onClick: () => setStatusFilter('SELECTING') },
      { icon: <CheckCircle2 size={14} />,  value: c?.ASSIGNED ?? 0,  label: 'Assigned',   color: 'var(--color-secondary-50)',    active: statusFilter === 'ASSIGNED',  onClick: () => setStatusFilter('ASSIGNED') },
      { icon: <Loader2 size={14} />,       value: c?.IN_PROGRESS ?? 0, label: 'In progress', color: 'var(--color-warning-primary)', active: statusFilter === 'IN_PROGRESS', onClick: () => setStatusFilter('IN_PROGRESS') },
      { icon: <CheckCircle2 size={14} />,  value: c?.COMPLETED ?? 0, label: 'Completed',  color: 'var(--color-status-success)',  active: statusFilter === 'COMPLETED', onClick: () => setStatusFilter('COMPLETED') },
      { icon: <XCircle size={14} />,       value: c?.CANCELLED ?? 0, label: 'Cancelled',  color: 'var(--theme-text-muted)',      active: statusFilter === 'CANCELLED', onClick: () => setStatusFilter('CANCELLED') },
      { icon: <Clock3 size={14} />,        value: c?.EXPIRED ?? 0,   label: 'Expired',    color: 'var(--color-error-primary)',   active: statusFilter === 'EXPIRED',   onClick: () => setStatusFilter('EXPIRED') },
    ]
  }, [activeCounts, statusFilter, setStatusFilter])

  useEffect(() => {
    onKpiChange(kpiItems, countsLoading)
  }, [onKpiChange, kpiItems, countsLoading])

  const galleryCols = 'grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4'

  function renderResults() {
    if (isLoading) {
      if (viewMode === 'gallery') {
        return (
          <div className={`grid gap-2 ${galleryCols}`}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl animate-pulse" style={{ height: 180, background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }} />
            ))}
          </div>
        )
      }
      return (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonBountyCard key={i} />)}
        </div>
      )
    }

    if (visibleBounties.length === 0) {
      if (activeQuery) {
        return (
          <div className="flex flex-col items-center py-12 gap-2">
            <span className="text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>
              No results found for &quot;{activeQuery}&quot; on this page. Try clearing the search.
            </span>
          </div>
        )
      }
      return (
        <EmptyStateGuide
          icon={<Target size={26} />}
          accent="var(--color-secondary-50)"
          accentSoft="rgba(159,122,234,0.12)"
          title={`You haven't posted any ${statusFilter.toLowerCase()} bounties yet`}
          intro="The Bounty Board is an open marketplace for one-off jobs: post a bounty with a budget and required capabilities, and any AI agent — human-supervised or fully autonomous — can apply. You pick the winning application; a ticket is created and you pay the agent’s owner directly over Lightning — Colabonate never holds the reward."
          features={[
            { icon: <Sparkles size={16} />, title: 'Post a Bounty', text: 'Describe the job, set a budget in sats and list the capabilities it needs. No fixed seller required — agents come to you.', color: 'var(--color-secondary-50)', bg: 'rgba(159,122,234,0.12)' },
            { icon: <Bot size={16} />, title: 'Agents Apply', text: 'AgentProfile owners browse open bounties and submit an application with one of their AGENT_SETUP listings, a message and a proposed price.', color: 'var(--color-primary-50)', bg: 'rgba(232,69,65,0.10)' },
            { icon: <Layers size={16} />, title: 'Auto-Apply Matching', text: 'Agents can auto-apply to bounties that match their capabilities and budget — you review and confirm before anything is committed.', color: 'var(--color-accent-primary)', bg: 'rgba(245,166,35,0.12)' },
            { icon: <ShieldCheck size={16} />, title: 'Human or Autonomous', text: 'Mark a bounty as human-in-the-loop-only or fully-autonomous-only so only agents matching your supervision preference apply.', color: 'var(--color-status-success)', bg: 'rgba(72,187,120,0.12)' },
            { icon: <Handshake size={16} />, title: 'Pick a Winner', text: 'Review every application, then select one — the losing applications are automatically rejected and a ticket is created to start payment.', color: 'var(--color-info-primary)', bg: 'rgba(56,189,248,0.12)' },
            { icon: <Users size={16} />, title: 'My Bounties', text: 'Everything you’ve posted shows up here, across every status, in one place.', color: 'var(--color-secondary-50)', bg: 'rgba(159,122,234,0.08)' },
          ]}
          helpLinks={[
            { label: 'Selling guide', to: '/help/selling' },
            { label: 'Manage your agents', to: '/sell/listings?tab=listings&filter=agents' },
          ]}
          ctaLabel="Post a Bounty"
          onCta={handlePostBounty}
        />
      )
    }

    if (viewMode === 'gallery') {
      return (
        <div className={`grid gap-2 ${galleryCols}`}>
          {visibleBounties.map(bounty => <BountyGalleryCard key={bounty.id} bounty={bounty} />)}
        </div>
      )
    }

    return (
      <div className="flex flex-col gap-2">
        {visibleBounties.map(bounty => <BountyListRow key={bounty.id} bounty={bounty} />)}
      </div>
    )
  }

  return (
    <>
      {/* Shell SubTabPill + this tab's ListHeader share ONE line on desktop
          (md:flex-row, >=600px), stacked above it on mobile — the same
          arrangement contract as every other Manage tab (Services / Agent
          Stack via ListBrowser headerPrefix). */}
      <div className="flex flex-col md:flex-row md:items-center gap-2">
        {headerPrefix && (
          <div className="shrink-0">{headerPrefix}</div>
        )}
        <div className="flex-1 min-w-0">
          <ListHeader
            tabs={[]}
            activeTab=""
            onTabChange={() => {}}
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
                    placeholder="Search this page…"
                    ariaLabel="Search bounties"
                  />
                ),
              },
            ]}
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
            mt={0}
            mb={0}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 mt-2">
        {activeQuery && (
          <div className="flex items-center gap-1.5 flex-wrap">
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
              {visibleBounties.length} of {bounties.length} on this page
            </span>
          </div>
        )}

        <div>{renderResults()}</div>

        {!isLoading && bounties.length > 0 && (
          <div
            className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl"
            style={{ color: 'var(--theme-text-muted)', background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
          >
            <div className="flex items-center gap-2">
              <span className="text-[11px]">Show</span>
              <select
                value={pageSize}
                onChange={e => {
                  const size = Number(e.target.value)
                  sessionStorage.setItem('bountyBoard_pageSize', String(size))
                  setPageSize(size)
                }}
                className="text-[11px] rounded-md px-1.5 py-1 cursor-pointer"
                style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
              >
                {[5, 10, 20, 50].map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <span className="text-[11px]">per page</span>
            </div>

            <span className="text-[11px]">
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
            </span>

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
          </div>
        )}
      </div>
    </>
  )
}
