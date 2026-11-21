import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation, formatLocaleDate } from '../../contexts/LocaleContext'
import { FiatHint } from '../../components/currency/FiatHint'
import { cn, getOfferTypeLabel } from '@ds/utils'
import { PageContainer } from '@ds/ui'
import {
  Clock, ChevronRight, Search, ReceiptText,
  Zap, CheckCircle2, RotateCw,
  Hourglass, Star, X, Filter, Package, Layers,
  ShieldAlert,
} from 'lucide-react'
import { PageHeader } from '../../components/PageHeader'
import { ReviewForm } from '../../components/reputation/ReviewForm'
import { UserLink } from '../../components/user/UserLink'
import { apiCall } from '../../lib/api'
import { usePollingBar } from '../../context/NotificationContext'
import type { Ticket, TicketStatus } from '../../types/api'

const REVIEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

const STATUS_TABS = ['all', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'DISPUTED'] as const
type StatusTab = (typeof STATUS_TABS)[number]

// ─── Status config (token-based, no hardcoded MUI colors) ─────────────────────
const STATUS_CFG: Record<TicketStatus, { bar: string; bg: string; text: string; label: string; icon: React.ReactNode }> = {
  PENDING:     { bar: '#F5A623', bg: 'rgba(245,166,35,0.12)',  text: '#92600A',                        label: 'Pending',     icon: <Hourglass size={10} /> },
  ACCEPTED:    { bar: 'var(--color-primary-50)', bg: 'rgba(99,179,237,0.12)', text: 'var(--color-primary-50)', label: 'Accepted',    icon: <CheckCircle2 size={10} /> },
  PAID:        { bar: '#10B981', bg: 'rgba(16,185,129,0.12)',  text: '#065F46',                        label: 'Paid',        icon: <Zap size={10} /> },
  IN_PROGRESS: { bar: 'var(--color-primary-50)', bg: 'rgba(99,179,237,0.12)', text: 'var(--color-primary-50)', label: 'In Progress', icon: <RotateCw size={10} /> },
  COMPLETED:   { bar: 'var(--color-status-success)', bg: 'rgba(72,187,120,0.12)', text: '#276749',    label: 'Completed',   icon: <CheckCircle2 size={10} /> },
  DISPUTED:    { bar: 'var(--color-status-error)',   bg: 'rgba(245,101,101,0.12)', text: '#C53030',   label: 'Disputed',    icon: <ShieldAlert size={10} /> },
  CANCELLED:   { bar: 'var(--color-neutral-6)',      bg: 'rgba(113,128,150,0.1)', text: 'var(--color-neutral-5)', label: 'Cancelled', icon: <X size={10} /> },
}

// ─── Tab labels ───────────────────────────────────────────────────────────────
const TAB_LABEL: Record<StatusTab, string> = {
  all:         'All',
  PENDING:     'Pending',
  IN_PROGRESS: 'Active',
  COMPLETED:   'Completed',
  DISPUTED:    'Disputed',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatRelTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return formatLocaleDate(new Date(dateStr), { day: '2-digit', month: 'short' })
}

// ─── KPI Bar ──────────────────────────────────────────────────────────────────
function KpiBar({ tickets, activeTab, onTabClick }: {
  tickets: Ticket[]
  activeTab: StatusTab
  onTabClick: (tab: StatusTab) => void
}) {
  const items = useMemo(() => {
    const c: Record<string, number> = {}
    for (const t of tickets) c[t.status] = (c[t.status] ?? 0) + 1
    return [
      { id: 'all'         as StatusTab, label: 'Total',    value: tickets.length,    color: 'var(--theme-text)',              dim: 'var(--theme-text-muted)' },
      { id: 'PENDING'     as StatusTab, label: 'Pending',  value: c['PENDING'] ?? 0, color: '#B87A00',                        dim: 'rgba(184,122,0,0.6)' },
      { id: 'IN_PROGRESS' as StatusTab, label: 'Active',   value: c['IN_PROGRESS'] ?? 0, color: 'var(--color-primary-50)',    dim: 'var(--color-primary-60)' },
      { id: 'COMPLETED'   as StatusTab, label: 'Done',     value: c['COMPLETED'] ?? 0,   color: 'var(--color-status-success)', dim: 'rgba(72,187,120,0.65)' },
      { id: 'DISPUTED'    as StatusTab, label: 'Disputed', value: c['DISPUTED'] ?? 0,    color: 'var(--color-status-error)',   dim: 'rgba(245,101,101,0.65)' },
    ]
  }, [tickets])

  return (
    <div
      className="flex items-stretch overflow-hidden rounded-xl"
      style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
    >
      {items.map((item, i) => {
        const isActive = activeTab === item.id
        return (
          <button
            key={item.id}
            onClick={() => onTabClick(item.id)}
            aria-pressed={isActive}
            className={cn(
              'flex flex-col items-center justify-center flex-1 py-3 px-1.5 gap-0.5 cursor-pointer',
              'transition-all duration-200 hover:bg-[var(--theme-bg-subtle)]',
              i > 0 && 'border-l border-[var(--theme-border)]',
              isActive && 'bg-[var(--theme-bg-subtle)]',
            )}
          >
            <span
              className="text-[20px] font-black leading-none tabular-nums"
              style={{ color: item.color }}
            >
              {item.value}
            </span>
            <span
              className="text-[9px] font-semibold uppercase tracking-widest leading-none"
              style={{ color: item.dim, fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              {item.label}
            </span>
            {isActive && (
              <div className="w-4 h-[2px] rounded-full mt-0.5" style={{ backgroundColor: item.color }} />
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── Skeleton Row ─────────────────────────────────────────────────────────────
function TicketRowSkeleton() {
  return (
    <div
      className="flex items-stretch gap-0 rounded-xl overflow-hidden animate-pulse"
      style={{ border: '1px solid var(--theme-border)' }}
    >
      <div className="w-[3px] shrink-0 bg-[var(--color-neutral-8)]" />
      <div className="flex flex-1 items-center gap-3 px-4 py-3.5">
        <div className="flex-1 flex flex-col gap-2">
          <div className="h-3.5 w-3/5 rounded bg-[var(--color-neutral-8)]" />
          <div className="h-2.5 w-2/5 rounded bg-[var(--color-neutral-8)]" />
          <div className="h-2.5 w-1/3 rounded bg-[var(--color-neutral-9)]" />
        </div>
        <div className="h-6 w-20 rounded-full bg-[var(--color-neutral-8)] shrink-0" />
      </div>
    </div>
  )
}

// ─── Ticket Row ───────────────────────────────────────────────────────────────
function TicketRow({
  ticket,
  userPubkey,
  onClick,
  canReview,
  onReview,
}: {
  ticket: Ticket
  userPubkey: string | null
  onClick: () => void
  canReview?: boolean
  onReview?: () => void
}) {
  const { formatNumber } = useTranslation()
  const amount  = ticket.amountSats ?? ticket.offer.priceSats
  const role    = ticket.buyerPubkey === userPubkey ? 'Buyer' : 'Seller'
  const counterpartyPubkey = ticket.buyerPubkey === userPubkey ? ticket.sellerPubkey : ticket.buyerPubkey
  const cfg     = STATUS_CFG[ticket.status] ?? STATUS_CFG.CANCELLED
  const typeLabel = getOfferTypeLabel(ticket.offerType)
  const TypeIcon  = ticket.offerType === 'SERVICE' ? Layers : Package

  const thumbSrc = ticket.offer.images?.[0]

  return (
    <div className="group flex flex-col">
      <button
        onClick={onClick}
        className={cn(
          'w-full text-left flex items-stretch gap-0 overflow-hidden',
          'transition-all duration-200 cursor-pointer',
          'hover:shadow-[0_4px_20px_rgba(0,0,0,0.1)] hover:-translate-y-px',
          canReview ? 'rounded-t-xl' : 'rounded-xl',
        )}
        style={{
          background: 'var(--theme-surface)',
          border: `1px solid var(--theme-border)`,
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-primary-50)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--theme-border)' }}
      >
        {/* Status accent bar */}
        <div className="w-[3px] shrink-0 self-stretch rounded-l-xl" style={{ backgroundColor: cfg.bar }} />

        {/* Offer thumbnail */}
        <div
          className="w-[62px] shrink-0 self-stretch overflow-hidden"
          style={{ background: 'var(--theme-bg-subtle)' }}
        >
          {thumbSrc ? (
            <img
              src={thumbSrc}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <TypeIcon size={20} style={{ color: 'var(--theme-text-muted)', opacity: 0.4 }} />
            </div>
          )}
        </div>

        {/* Main content */}
        <div className="flex flex-1 items-center gap-3 px-3.5 py-3 min-w-0">

          {/* Left column */}
          <div className="flex flex-col flex-1 gap-1 min-w-0">

            {/* Title + role badge */}
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span
                className="text-[15px] font-semibold leading-none truncate"
                style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}
              >
                {ticket.offer.title}
              </span>
              {ticket.variantLabel && (
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold"
                  style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-secondary)', border: '1px solid var(--theme-border)' }}
                >
                  {ticket.variantLabel}
                </span>
              )}
              <span
                className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-widest leading-none"
                style={{
                  background: role === 'Buyer' ? 'rgba(99,179,237,0.13)' : 'rgba(159,122,234,0.13)',
                  color:      role === 'Buyer' ? 'var(--color-primary-50)'  : '#805AD5',
                  border: `1px solid ${role === 'Buyer' ? 'rgba(99,179,237,0.28)' : 'rgba(159,122,234,0.28)'}`,
                }}
              >
                {role}
              </span>
            </div>

            {/* Meta: type · id · amount */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-widest"
                style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
              >
                <TypeIcon size={9} />
                {typeLabel}
              </span>
              <span className="text-[10px] opacity-30" style={{ color: 'var(--theme-text)' }}>·</span>
              <span
                className="text-[10px] font-mono opacity-60"
                style={{ color: 'var(--theme-text-muted)' }}
              >
                #{ticket.id.slice(0, 8)}
              </span>
              <span className="text-[10px] opacity-30" style={{ color: 'var(--theme-text)' }}>·</span>
              <span className="inline-flex items-center gap-0.5">
                <Zap size={9} style={{ fill: 'var(--color-primary-50)', color: 'var(--color-primary-50)' }} />
                <span
                  className="text-[11px] font-bold tabular-nums leading-none"
                  style={{ color: 'var(--color-primary-50)', fontFamily: 'var(--typography-fontfamily-barlow, Barlow, sans-serif)' }}
                >
                  {formatNumber(amount)}
                </span>
                <span
                  className="text-[9px] font-semibold uppercase"
                  style={{ color: 'var(--color-primary-50)', opacity: 0.7, fontFamily: 'var(--typography-fontfamily-sans)' }}
                >
                  sats
                </span>
                <FiatHint sats={amount} className="text-[10px] ml-0.5" style={{ color: 'var(--theme-text-muted)' }} />
              </span>
            </div>

            {/* Activity + timestamp */}
            <div className="flex items-center gap-1.5 mt-0.5">
              <Clock size={9} className="shrink-0" style={{ color: 'var(--theme-text-muted)' }} />
              <span
                className="text-[10px] shrink-0 tabular-nums"
                style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
              >
                {formatRelTime(ticket.createdAt)}
              </span>
              <span className="text-[9px] opacity-30" style={{ color: 'var(--theme-text)' }}>·</span>
              <span className="text-[10px] truncate" style={{ color: 'var(--theme-text-muted)' }}>
                with <UserLink pubkey={counterpartyPubkey} size="small" />
              </span>
            </div>
          </div>

          {/* Right column: status badge + chevron */}
          <div className="flex flex-col items-end gap-2 shrink-0">
            <span
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide leading-none"
              style={{
                background: cfg.bg,
                color: cfg.text,
                fontFamily: 'var(--typography-fontfamily-sans)',
              }}
            >
              {cfg.icon}
              {cfg.label}
            </span>
            <ChevronRight
              size={14}
              className="transition-transform duration-200 group-hover:translate-x-0.5"
              style={{ color: 'var(--theme-text-muted)' }}
            />
          </div>
        </div>
      </button>

      {/* Inline review CTA – attached below the card */}
      {canReview && onReview && (
        <div
          className="flex items-center justify-between gap-3 px-4 py-2 rounded-b-xl"
          style={{
            background: 'rgba(72,187,120,0.07)',
            border: '1px solid rgba(72,187,120,0.22)',
            borderTop: 'none',
          }}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <Star size={11} style={{ fill: '#F5A623', color: '#F5A623', flexShrink: 0 }} />
            <span
              className="text-[10px] truncate"
              style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              Rate this collaboration · earn COL-Points
            </span>
          </div>
          <button
            onClick={e => { e.stopPropagation(); onReview() }}
            className="shrink-0 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all duration-200 hover:opacity-90 active:scale-95"
            style={{
              background: 'var(--color-status-success)',
              color: 'white',
              fontFamily: 'var(--typography-fontfamily-sans)',
            }}
          >
            Review
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ title, description, action }: {
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center py-16 gap-3">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: 'var(--theme-bg-subtle)' }}
      >
        <Filter size={28} style={{ color: 'var(--theme-text-muted)' }} />
      </div>
      <span className="text-[15px] font-semibold" style={{ color: 'var(--theme-text)' }}>{title}</span>
      <span
        className="text-[13px] text-center max-w-[260px]"
        style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
      >
        {description}
      </span>
      {action}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function Tickets() {
  const navigate = useNavigate()
  const { pollTick } = usePollingBar()
  const [userPubkey] = useState<string | null>(() => localStorage.getItem('pubkey'))
  const [tickets, setTickets]                   = useState<Ticket[]>([])
  const [loading, setLoading]                   = useState(true)
  const [activeTab, setActiveTab]               = useState<StatusTab>('all')
  const [searchQuery, setSearchQuery]           = useState('')
  const [reviewTicket, setReviewTicket]         = useState<Ticket | null>(null)
  const [reviewedTicketIds, setReviewedTicketIds] = useState<Set<string>>(new Set())

  const fetchTickets = useCallback(async (silent = false) => {
    if (!userPubkey) return
    if (!silent) setLoading(true)
    try {
      const response = await apiCall(`/api/tickets?pubkey=${userPubkey}`)
      const data = await response.json()
      setTickets(data.tickets || [])
    } catch {
      console.error('Failed to fetch tickets')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [userPubkey])

  useEffect(() => {
    if (userPubkey) fetchTickets(false)
    else setLoading(false)
  }, [fetchTickets, userPubkey])

  // Silent background poll
  useEffect(() => {
    if (pollTick > 0 && userPubkey) fetchTickets(true)
  }, [pollTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: tickets.length }
    for (const t of tickets) counts[t.status] = (counts[t.status] ?? 0) + 1
    return counts
  }, [tickets])

  const filteredTickets = useMemo(() => {
    let list = activeTab === 'all' ? tickets : tickets.filter(t => t.status === activeTab)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(t =>
        t.offer.title.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        t.ticketType.toLowerCase().replace(/_/g, ' ').includes(q) ||
        (ticket => (STATUS_CFG[ticket.status]?.label ?? '').toLowerCase().includes(q))(t)
      )
    }
    return list
  }, [tickets, activeTab, searchQuery])

  const hasActiveFilters = searchQuery.trim() !== '' || activeTab !== 'all'

  return (
    <PageContainer size="wide" spacing="lg">

      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <PageHeader
        icon={<ReceiptText size={18} />}
        title="My Tickets"
        subtitle="Manage your purchases, sales, and disputes"
        onBack={() => navigate('/')}
      />

      {/* ── KPI Bar ─────────────────────────────────────────────────────── */}
      {loading ? (
        <div
          className="h-[72px] rounded-xl animate-pulse"
          style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
        />
      ) : (
        <KpiBar tickets={tickets} activeTab={activeTab} onTabClick={setActiveTab} />
      )}

      {/* ── Search ──────────────────────────────────────────────────────── */}
      <div className="relative">
        <Search
          size={14}
          className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: 'var(--theme-text-muted)' }}
        />
        <input
          type="search"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search by title, ID, type…"
          className={cn(
            'w-full pl-9 pr-9 py-2.5 rounded-xl text-[13px] outline-none transition-all duration-200',
            'placeholder:text-[var(--theme-text-muted)]',
            'focus:ring-2 focus:ring-[var(--color-primary-50)]/25 focus:border-[var(--color-primary-50)]/50',
          )}
          style={{
            background: 'var(--theme-surface)',
            border: '1px solid var(--theme-border)',
            color: 'var(--theme-text)',
            fontFamily: 'var(--typography-fontfamily-sans)',
          }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full transition-colors hover:bg-[var(--theme-bg-subtle)]"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* ── Status Tabs ─────────────────────────────────────────────────── */}
      <div
        className="flex gap-1.5 overflow-x-auto pb-0.5"
        style={{ scrollbarWidth: 'none' } as React.CSSProperties}
      >
        {STATUS_TABS.map(tab => {
          const isActive = activeTab === tab
          const count    = tabCounts[tab] ?? 0
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              aria-pressed={isActive}
              className={cn(
                'shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full',
                'text-[11px] font-semibold uppercase tracking-widest whitespace-nowrap',
                'border transition-all duration-200',
                isActive
                  ? 'border-[var(--color-primary-50)] text-[var(--color-primary-50)] bg-[var(--color-primary-50)]/8'
                  : 'border-[var(--theme-border)] text-[var(--theme-text-muted)] hover:border-[var(--color-primary-50)] hover:text-[var(--color-primary-50)]',
              )}
              style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              {TAB_LABEL[tab]}
              {count > 0 && (
                <span
                  className={cn(
                    'inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold tabular-nums',
                    isActive
                      ? 'bg-[var(--color-primary-50)] text-white'
                      : 'bg-[var(--theme-bg-subtle)] text-[var(--theme-text-muted)]',
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Ticket List ─────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => <TicketRowSkeleton key={i} />)}
        </div>
      ) : !userPubkey ? (
        <EmptyState
          title="Not logged in"
          description="Please log in to see your tickets."
        />
      ) : filteredTickets.length === 0 ? (
        <EmptyState
          title={searchQuery ? 'No matches found' : activeTab === 'all' ? 'No tickets yet' : `No ${TAB_LABEL[activeTab]} tickets`}
          description={
            searchQuery
              ? 'Try a different search term or clear the filter.'
              : activeTab === 'all'
              ? 'Buy an offer or become a seller to receive tickets.'
              : `No tickets with status "${TAB_LABEL[activeTab]}" found.`
          }
          action={
            hasActiveFilters ? (
              <button
                onClick={() => { setSearchQuery(''); setActiveTab('all') }}
                className="mt-1 px-4 py-2 rounded-full text-[11px] font-bold uppercase tracking-widest transition-all duration-200 hover:opacity-90 active:scale-95"
                style={{
                  background: 'var(--color-primary-50)',
                  color: 'white',
                  fontFamily: 'var(--typography-fontfamily-sans)',
                }}
              >
                Clear filters
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {/* Result count */}
          <p
            className="text-[11px] font-semibold uppercase tracking-widest mb-0.5"
            style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            {filteredTickets.length} {filteredTickets.length === 1 ? 'ticket' : 'tickets'}
            {searchQuery && ` · "${searchQuery}"`}
          </p>

          {filteredTickets.map(ticket => {
            const isCompleted  = ticket.status === 'COMPLETED'
            const withinWindow = Date.now() - new Date(ticket.createdAt).getTime() < REVIEW_WINDOW_MS
            const canReview    = isCompleted && withinWindow && !reviewedTicketIds.has(ticket.id) && !!userPubkey
            return (
              <TicketRow
                key={ticket.id}
                ticket={ticket}
                userPubkey={userPubkey}
                onClick={() => navigate(`/tickets/${ticket.id}`)}
                canReview={canReview}
                onReview={() => setReviewTicket(ticket)}
              />
            )
          })}
        </div>
      )}

      {/* ── Review Dialog ───────────────────────────────────────────────── */}
      {reviewTicket && userPubkey && (
        <ReviewForm
          ticketId={reviewTicket.id}
          offerType={reviewTicket.offerType}
          reviewerPubkey={userPubkey}
          revieweePubkey={
            userPubkey === reviewTicket.buyerPubkey
              ? reviewTicket.sellerPubkey
              : reviewTicket.buyerPubkey
          }
          onSuccess={() => {
            setReviewedTicketIds(prev => new Set(prev).add(reviewTicket.id))
            setReviewTicket(null)
          }}
          onCancel={() => setReviewTicket(null)}
        />
      )}

    </PageContainer>
  )
}
