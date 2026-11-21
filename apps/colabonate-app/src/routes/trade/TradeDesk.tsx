// ADR-355 D1 / ADR-362: the Escrow Trade Desk — a full list surface, not a
// wallet sub-flow. Mirrors the BountyBoard list-page rhythm (PageContainer
// gap="none" + pt-0, clickable-filter KPIStrip, ListHeader, list/gallery
// cards, EmptyStateGuide) so a buyer or seller sees every state of their
// non-custodial escrow trades in one place, with a clear entry point to start
// a new trade and to verify the canister.
//
// Every row's state is a mirrored app record (ADR-355 D4): the canister is the
// source of truth and the cockpit re-reads it; the list is a convenience view.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Handshake, ShieldCheck, Clock3, Wallet, Gavel, CheckCircle2, RotateCcw, Scale,
  Search, X, ChevronLeft, ChevronRight, Sparkles, User,
} from 'lucide-react'
import { PageContainer, ListHeader, type KPIItem } from '@ds/ui'
import { KPIStrip } from '../../components/kpi/KpiStrip'
import { PageHeader } from '../../components/PageHeader'
import { Seo } from '../../components/Seo'
import { SearchInput } from '../../components/ui/SearchInput'
import { EmptyStateGuide } from '../../components/EmptyStateGuide'
import { TradeStateBadge } from '../../components/trade/TradeStateBadge'
import { ProvenanceChip } from '../../components/trust/ProvenanceChip'
import { SatsAmount } from '../../components/currency/SatsAmount'
import { FiatHint } from '../../components/currency/FiatHint'
import { useTranslation } from '../../contexts/LocaleContext'
import { useSessionState } from '../../hooks/useSessionState'
import { fetchEscrowTrades, counterpartyOf, shortPubkey, type EscrowTrade, type EscrowTradeState } from '../../lib/escrow-trade'

// ── Status meta (KPI strip + gallery corner badge) ─────────────────────────

type StatusIconType = typeof Clock3

const STATUS_META: Record<EscrowTradeState, { label: string; color: string; bg: string; border: string; icon: StatusIconType }> = {
  PENDING_FUNDING: { label: 'Awaiting funding', color: 'var(--color-status-info)', bg: 'rgba(99,179,237,0.16)', border: 'rgba(99,179,237,0.40)', icon: Clock3 },
  FUNDED:          { label: 'Funded',          color: 'var(--color-status-info)', bg: 'rgba(99,179,237,0.16)', border: 'rgba(99,179,237,0.40)', icon: Wallet },
  RELEASED:        { label: 'Released',        color: 'var(--color-status-success)', bg: 'rgba(72,187,120,0.16)', border: 'rgba(72,187,120,0.40)', icon: CheckCircle2 },
  REFUNDED:        { label: 'Refunded',        color: 'var(--theme-text-muted)', bg: 'rgba(113,128,150,0.16)', border: 'rgba(113,128,150,0.40)', icon: RotateCcw },
  DISPUTED:        { label: 'Disputed',        color: 'var(--color-status-warning)', bg: 'rgba(245,166,35,0.16)', border: 'rgba(245,166,35,0.40)', icon: Gavel },
  DISPUTE_SETTLED: { label: 'Settled',         color: 'var(--color-status-success)', bg: 'rgba(72,187,120,0.16)', border: 'rgba(72,187,120,0.40)', icon: Scale },
}

type StatusFilter = 'ALL' | EscrowTradeState

function roleOf(trade: EscrowTrade, viewerPubkey: string | null): string {
  if (viewerPubkey && trade.buyerPubkey === viewerPubkey) return 'Buyer'
  if (viewerPubkey && trade.sellerPubkey === viewerPubkey) return 'Seller'
  return 'Counterparty'
}

// ── List row ────────────────────────────────────────────────────────────────

function TradeListRow({ trade, viewerPubkey, onOpen }: { trade: EscrowTrade; viewerPubkey: string | null; onOpen: () => void }) {
  const { formatDate } = useTranslation()
  const role = roleOf(trade, viewerPubkey)

  return (
    <div
      onClick={onOpen}
      className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.99]"
      style={{
        background: 'var(--theme-surface)',
        border: '1px solid var(--theme-border)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)',
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 25px rgba(0,0,0,0.10)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)' }}
    >
      <div
        className="flex items-center justify-center shrink-0 rounded-lg"
        style={{ width: 44, height: 44, background: 'rgba(99,179,237,0.10)' }}
      >
        <Handshake size={20} style={{ color: 'var(--color-primary-50)' }} />
      </div>

      <div className="flex flex-col flex-1 min-w-0 py-0.5 gap-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <TradeStateBadge state={trade.state} />
          <ProvenanceChip provenance="app-record" />
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
            style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-secondary)', border: '1px solid var(--theme-border)' }}
          >
            <User size={9} />
            {role}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold" style={{ color: 'var(--theme-text)', fontVariantNumeric: 'tabular-nums' }}>
            <SatsAmount sats={trade.expectedAmountSats} showUnit />
          </span>
          <FiatHint sats={trade.expectedAmountSats} />
        </div>

        <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
          with {shortPubkey(counterpartyOf(trade, viewerPubkey))} · #{trade.canisterTradeId} · {formatDate(new Date(trade.createdAt), { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      </div>

      <ChevronRight size={16} style={{ color: 'var(--theme-text-muted)' }} />
    </div>
  )
}

// ── Gallery card ────────────────────────────────────────────────────────────

function TradeGalleryCard({ trade, viewerPubkey, onOpen }: { trade: EscrowTrade; viewerPubkey: string | null; onOpen: () => void }) {
  const { formatDate } = useTranslation()
  const meta = STATUS_META[trade.state]
  const role = roleOf(trade, viewerPubkey)

  return (
    <div
      onClick={onOpen}
      className="flex flex-col rounded-xl border overflow-hidden cursor-pointer transition-all duration-300 ease-out hover:z-10 hover:scale-[1.03] hover:shadow-[0_12px_32px_rgba(0,0,0,0.18)] active:scale-[0.99] h-full relative"
      style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
    >
      <div className="relative flex items-center justify-center shrink-0 overflow-hidden" style={{ height: 72, background: 'rgba(99,179,237,0.10)' }}>
        <Handshake size={30} style={{ color: 'var(--color-primary-50)', opacity: 0.85 }} />
        <span className="absolute top-2 right-2 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ background: meta.bg, color: meta.color }}>
          {meta.label}
        </span>
      </div>
      <div className="flex flex-col flex-1 p-3 gap-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <TradeStateBadge state={trade.state} />
          <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--theme-text-muted)' }}>{role}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[14px] font-semibold" style={{ color: 'var(--theme-text)', fontVariantNumeric: 'tabular-nums' }}>
            <SatsAmount sats={trade.expectedAmountSats} showUnit />
          </span>
          <FiatHint sats={trade.expectedAmountSats} />
        </div>
        <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
          with {shortPubkey(counterpartyOf(trade, viewerPubkey))} · #{trade.canisterTradeId}
        </span>
        <span className="text-[10px] mt-auto" style={{ color: 'var(--theme-text-muted)' }}>
          {formatDate(new Date(trade.createdAt), { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      </div>
    </div>
  )
}

// ── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl animate-pulse" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
      <div className="shrink-0 rounded-lg" style={{ width: 44, height: 44, background: 'var(--color-neutral-8)' }} />
      <div className="flex flex-col flex-1 gap-2 py-1">
        <div className="h-3 w-1/2 rounded" style={{ background: 'var(--color-neutral-8)' }} />
        <div className="h-4 w-1/3 rounded" style={{ background: 'var(--color-neutral-9)' }} />
        <div className="h-3 w-2/3 rounded" style={{ background: 'var(--color-neutral-9)' }} />
      </div>
    </div>
  )
}

// ── TradeDesk ───────────────────────────────────────────────────────────────

export function TradeDesk() {
  const navigate = useNavigate()
  const viewerPubkey = localStorage.getItem('pubkey')

  const [statusFilter, setStatusFilter] = useSessionState<StatusFilter>('escrowTradeDesk:status', 'ALL')
  const [query, setQuery] = useSessionState<string>('escrowTradeDesk:query', '')
  const [activeQuery, setActiveQuery] = useSessionState<string>('escrowTradeDesk:activeQuery', '')
  const [viewMode, setViewMode] = useState<'gallery' | 'list'>(() => {
    const saved = localStorage.getItem('escrowTradeDesk_viewMode')
    return (saved === 'gallery' || saved === 'list') ? saved : 'list'
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    const stored = sessionStorage.getItem('escrowTradeDesk_pageSize')
    return stored ? Number(stored) : 10
  })
  const [trades, setTrades] = useState<EscrowTrade[] | null>(null)

  useEffect(() => {
    let active = true
    fetchEscrowTrades(50)
      .then((t) => { if (active) setTrades(t) })
      .catch(() => { if (active) setTrades([]) })
    return () => { active = false }
  }, [])

  const isLoading = trades === null
  const all = trades ?? []

  const counts = useMemo(() => {
    const byState: Record<EscrowTradeState, number> = {
      PENDING_FUNDING: 0, FUNDED: 0, RELEASED: 0, REFUNDED: 0, DISPUTED: 0, DISPUTE_SETTLED: 0,
    }
    for (const t of all) byState[t.state] = (byState[t.state] ?? 0) + 1
    return { all: all.length, byState }
  }, [all])

  const visible = useMemo(() => {
    let list = all
    if (statusFilter !== 'ALL') list = list.filter((t) => t.state === statusFilter)
    if (activeQuery.trim()) {
      const q = activeQuery.toLowerCase()
      list = list.filter((t) =>
        t.canisterTradeId.toLowerCase().includes(q)
        || counterpartyOf(t, viewerPubkey).toLowerCase().includes(q)
        || t.btcAddress.toLowerCase().includes(q)
      )
    }
    return list
  }, [all, statusFilter, activeQuery, viewerPubkey])

  const total = visible.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const paged = visible.slice((page - 1) * pageSize, page * pageSize)

  useEffect(() => { setPage(1) }, [statusFilter, pageSize, activeQuery])

  function handleNewTrade() {
    navigate('/trade/new')
  }
  function handleSearch() { setActiveQuery(query) }
  function handleClear() { setQuery(''); setActiveQuery('') }
  function handleViewModeChange(mode: 'gallery' | 'list') {
    setViewMode(mode)
    localStorage.setItem('escrowTradeDesk_viewMode', mode)
  }

  // ── KPI ────────────────────────────────────────────────────────────────

  const kpiItems = useMemo<KPIItem[]>(() => {
    const c = counts.byState
    return [
      { icon: <Handshake size={14} />, value: counts.all, label: 'All', active: statusFilter === 'ALL', onClick: () => setStatusFilter('ALL'), heading: 'Status' },
      { icon: <Clock3 size={14} />, value: c.PENDING_FUNDING, label: 'Awaiting', color: 'var(--color-status-info)', active: statusFilter === 'PENDING_FUNDING', onClick: () => setStatusFilter('PENDING_FUNDING') },
      { icon: <Wallet size={14} />, value: c.FUNDED, label: 'Funded', color: 'var(--color-status-info)', active: statusFilter === 'FUNDED', onClick: () => setStatusFilter('FUNDED') },
      { icon: <Gavel size={14} />, value: c.DISPUTED, label: 'Disputed', color: 'var(--color-status-warning)', active: statusFilter === 'DISPUTED', onClick: () => setStatusFilter('DISPUTED') },
      { icon: <CheckCircle2 size={14} />, value: c.RELEASED, label: 'Released', color: 'var(--color-status-success)', active: statusFilter === 'RELEASED', onClick: () => setStatusFilter('RELEASED') },
      { icon: <RotateCcw size={14} />, value: c.REFUNDED, label: 'Refunded', color: 'var(--theme-text-muted)', active: statusFilter === 'REFUNDED', onClick: () => setStatusFilter('REFUNDED') },
      { icon: <Scale size={14} />, value: c.DISPUTE_SETTLED, label: 'Settled', color: 'var(--color-status-success)', active: statusFilter === 'DISPUTE_SETTLED', onClick: () => setStatusFilter('DISPUTE_SETTLED') },
    ]
  }, [counts, statusFilter, setStatusFilter])

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
      return <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}</div>
    }

    if (visible.length === 0) {
      if (activeQuery) {
        return (
          <div className="flex flex-col items-center py-12 gap-2">
            <span className="text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>
              No results found for &quot;{activeQuery}&quot;. Try clearing the search.
            </span>
          </div>
        )
      }
      return (
        <EmptyStateGuide
          icon={<Handshake size={26} />}
          accent="var(--color-primary-50)"
          accentSoft="rgba(99,179,237,0.12)"
          title={statusFilter === 'ALL' ? "No escrow trades yet" : `No ${STATUS_META[statusFilter].label.toLowerCase()} trades`}
          intro="The Escrow Trade Desk is where non-custodial Bitcoin escrow lives. You and a counterparty sign identical terms, the ICP canister derives a unique Bitcoin address and holds the funds, and it can only ever pay to three fixed addresses — you can verify the code holding your money yourself, any time, without an account."
          features={[
            { icon: <Sparkles size={16} />, title: 'Start a trade', text: 'Set the counterparty, amount, milestone split and timeout, verify the canister, then sign — both parties sign the same canonical terms before anything is created.', color: 'var(--color-primary-50)', bg: 'rgba(99,179,237,0.12)' },
            { icon: <Wallet size={16} />, title: 'Fund it', text: 'The canister derives a trade-specific Bitcoin address and verifies its own funding on-chain. No platform holds your money.', color: 'var(--color-status-info)', bg: 'rgba(56,189,248,0.12)' },
            { icon: <CheckCircle2 size={16} />, title: 'Release milestones', text: 'Only the buyer can release a milestone, signed with their own identity key. A timeout refund is permissionless — anyone may claim it.', color: 'var(--color-status-success)', bg: 'rgba(72,187,120,0.12)' },
            { icon: <Gavel size={16} />, title: 'Dispute & settle', text: 'Either party can open a dispute; the DAO verdict settles the split on-chain when a governance key is configured.', color: 'var(--color-status-warning)', bg: 'rgba(245,166,35,0.12)' },
            { icon: <ShieldCheck size={16} />, title: 'Verify the code', text: 'Check the canister module hash and controller set directly from the Internet Computer — no account, no trust in Colabonate.', color: 'var(--color-status-success)', bg: 'rgba(72,187,120,0.12)' },
            { icon: <Scale size={16} />, title: 'Every state, one list', text: 'Awaiting funding, funded, disputed, released, refunded and settled — filter and search across all of them here.', color: 'var(--theme-text-muted)', bg: 'rgba(113,128,150,0.12)' },
          ]}
          helpLinks={[
            { label: 'Verify the canister', to: '/trade/verify' },
            { label: 'How escrow works', to: '/help/escrow' },
          ]}
          ctaLabel="Start an escrow trade"
          onCta={handleNewTrade}
          secondaryCtaLabel="Verify the canister"
          secondaryCtaTo="/trade/verify"
        />
      )
    }

    if (viewMode === 'gallery') {
      return (
        <div className={`grid gap-2 ${galleryCols}`}>
          {paged.map((trade) => <TradeGalleryCard key={trade.id} trade={trade} viewerPubkey={viewerPubkey} onOpen={() => navigate(`/trade/${trade.id}`)} />)}
        </div>
      )
    }

    return (
      <div className="flex flex-col gap-2">
        {paged.map((trade) => <TradeListRow key={trade.id} trade={trade} viewerPubkey={viewerPubkey} onOpen={() => navigate(`/trade/${trade.id}`)} />)}
      </div>
    )
  }

  return (
    <>
      <PageContainer size="wide" spacing="lg" gap="none" className="px-0.5! md:px-6! pb-6! pt-0!">
        <Seo title="Escrow trade desk" description="Your non-custodial Bitcoin escrow trades — start a trade, track every state, and verify the canister holding the funds." path="/trade" />
        <PageHeader
          icon={<Handshake size={18} />}
          title="Escrow trade desk"
          subtitle="Non-custodial Bitcoin escrow — start a trade, watch every state, and check the code holding your funds"
          actionsFit="inline"
          actions={
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate('/trade/verify')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition-all duration-200 hover:opacity-80"
                style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)' }}
              >
                <ShieldCheck size={14} /> Verify canister
              </button>
              <button
                onClick={handleNewTrade}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer transition-all duration-200 hover:opacity-90 active:scale-95"
                style={{ background: 'var(--color-primary-50)', color: 'white' }}
              >
                <Sparkles size={14} /> New escrow trade
              </button>
            </div>
          }
        />

        <div className="mb-2">
          <KPIStrip items={kpiItems} loading={isLoading} skeletonCount={7} wrap collapsible storageKey="kpi-escrow-trade-desk-strip" />
        </div>

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
                  placeholder="Search trades…"
                  ariaLabel="Search escrow trades"
                />
              ),
            },
          ]}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          mb={2}
        />

        <div className="flex flex-col gap-2">
          {activeQuery && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg" style={{ background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.20)' }}>
                <Search size={11} style={{ color: 'var(--color-primary-50)' }} />
                <span className="text-[11px]" style={{ color: 'var(--color-primary-50)' }}>"{activeQuery}"</span>
                <button onClick={handleClear} className="cursor-pointer" style={{ background: 'none', border: 'none', padding: 1 }} aria-label="Clear search">
                  <X size={11} style={{ color: 'var(--color-primary-50)' }} />
                </button>
              </div>
              <span className="text-[11px] ml-1" style={{ color: 'var(--theme-text-muted)' }}>
                {visible.length} of {all.length} trades
              </span>
            </div>
          )}

          <div>{renderResults()}</div>

          {!isLoading && visible.length > 0 && (
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
                    sessionStorage.setItem('escrowTradeDesk_pageSize', String(size))
                    setPageSize(size)
                  }}
                  className="text-[11px] rounded-md px-1.5 py-1 cursor-pointer"
                  style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
                >
                  {[5, 10, 20, 50].map(n => (<option key={n} value={n}>{n}</option>))}
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
      </PageContainer>
    </>
  )
}
