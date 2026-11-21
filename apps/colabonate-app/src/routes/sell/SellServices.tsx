import { useState, useMemo, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from '../../contexts/LocaleContext'
import { FiatHint } from '../../components/currency/FiatHint'
import { Briefcase, Zap, MoreVertical, Edit, Archive, Trash2, Plus, Eye, EyeOff, Clock } from 'lucide-react'
import { PageContainer, CARD_THEME, CardImage, ListHeader } from '@ds/ui'
import { KPIStrip } from '../../components/kpi/KpiStrip'
import type { KPIItem } from '@ds/ui'
import { useTheme } from '@ds/utils'
import { cn } from '@ds/utils'
import { apiCall } from '../../lib/api'
import { PageHeader } from '../../components/PageHeader'
import { SearchInput } from '../../components/ui/SearchInput'
import type { Offer } from '../../types/api'
import { useFABActions } from '../../context/FABContext'
import { useQueryClient } from '@tanstack/react-query'
import { useUserServiceOffers, useUserTickets } from '../../hooks/useEntityQueries'

const STATUS_BADGE_CLASS: Record<string, string> = {
  DRAFT:    'bg-[rgba(159,122,234,0.12)] text-[#9F7AEA] border-[rgba(159,122,234,0.28)]',
  ACTIVE:   'bg-[rgba(72,187,120,0.12)] text-[#276749] border-[rgba(72,187,120,0.28)]',
  CLOSED:   'bg-[rgba(245,166,35,0.12)] text-[#92600A] border-[rgba(245,166,35,0.28)]',
  ARCHIVED: 'bg-[rgba(113,128,150,0.12)] text-[#718096] border-[rgba(113,128,150,0.28)]',
}

function ServiceCard({ offer, theme, index, pendingTickets, onAction }: {
  offer: Offer
  theme: 'light' | 'dark'
  index: number
  pendingTickets: number
  onAction: (action: 'edit' | 'archive' | 'delete' | 'publish', offer: Offer) => void
}) {
  const { formatNumber } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const C = CARD_THEME.colors(theme)
  const thumbUrl = offer.images?.[0]

  return (
    <div className="relative z-0 py-1 hover:z-10" style={{ animation: `card-enter 0.38s cubic-bezier(0.22,1,0.36,1) ${index * 60}ms both` }}>
      <article className="relative rounded-xl overflow-hidden transition-all duration-300 ease-out hover:-translate-y-1.5" style={{ background: CARD_THEME.bg(theme), boxShadow: CARD_THEME.shadow }} onMouseEnter={e => (e.currentTarget.style.boxShadow = CARD_THEME.shadowHover)} onMouseLeave={e => (e.currentTarget.style.boxShadow = CARD_THEME.shadow)}>
        <div className="absolute inset-0 pointer-events-none rounded-xl" style={{ background: CARD_THEME.overlay(theme) }} />

        <div className="relative w-full overflow-hidden" style={{ height: '120px' }}>
          <CardImage
            className="w-full h-full"
            src={thumbUrl}
            alt={offer.title}
            fallback={
              <span
                className="absolute inset-0 flex items-center justify-center select-none leading-none"
                style={{ fontSize: CARD_THEME.text.placeholderSize, fontWeight: CARD_THEME.text.placeholderWeight, color: C.placeholder }}
              >
                {offer.title.charAt(0).toUpperCase()}
              </span>
            }
          />
          <div className="absolute bottom-0 left-0 right-0 pointer-events-none h-14" style={{ background: CARD_THEME.bottomScrim }} />

          <div className="absolute top-2 left-2">
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm uppercase leading-none backdrop-blur-sm" style={{ fontSize: CARD_THEME.text.badgeSize, fontWeight: CARD_THEME.text.badgeWeight, letterSpacing: CARD_THEME.text.badgeTracking, backgroundColor: 'rgba(99,179,237,0.25)', color: '#63B3ED', border: '1px solid rgba(99,179,237,0.35)' }}>
              <Briefcase size={8} strokeWidth={2.5} /> Service
            </span>
          </div>

          <div className="absolute top-2 right-2">
            <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-sm uppercase leading-none border text-[9px] font-bold tracking-widest', STATUS_BADGE_CLASS[offer.status ?? 'DRAFT'] ?? STATUS_BADGE_CLASS.DRAFT)}>
              {offer.status}
            </span>
          </div>

          {pendingTickets > 0 && offer.status === 'ACTIVE' && (
            <div className="absolute bottom-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-sm backdrop-blur-sm" style={{ background: 'rgba(245,166,35,0.20)', border: '1px solid rgba(245,166,35,0.30)' }}>
              <Clock size={10} className="text-[#F5A623]" />
              <span className="text-[10px] font-bold text-[#F5A623]">{pendingTickets} pending</span>
            </div>
          )}
        </div>

        <div className="relative px-3 pt-2.5 pb-3 flex flex-col gap-1">
          <p className="line-clamp-2 shrink-0" style={{ fontFamily: CARD_THEME.font.sans, fontSize: CARD_THEME.text.titleSize, fontWeight: CARD_THEME.text.titleWeight, lineHeight: CARD_THEME.text.titleLineHeight, color: C.textPrimary, minHeight: '34px' }}>
            {offer.title}
          </p>
          <div className="flex items-center gap-1 mt-auto pt-1">
            <Zap size={10} style={{ fill: CARD_THEME.accent, color: CARD_THEME.accent }} className="shrink-0" />
            <span className="leading-none tabular-nums" style={{ fontFamily: CARD_THEME.font.sans, fontSize: CARD_THEME.text.priceInlineSize, fontWeight: CARD_THEME.text.priceInlineWeight, letterSpacing: CARD_THEME.text.priceInlineTracking, color: CARD_THEME.accent }}>
              {formatNumber(offer.priceSats)} sats
            </span>
            <FiatHint sats={offer.priceSats} className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }} />
          </div>
        </div>

        <div className="absolute bottom-2 right-2">
          <div className="relative">
            <button onClick={e => { e.stopPropagation(); setMenuOpen(v => !v) }} className="w-8 h-8 flex items-center justify-center rounded-lg backdrop-blur-sm cursor-pointer transition-all duration-200 hover:bg-white/10" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.15)' }}>
              <MoreVertical size={14} className="text-white" />
            </button>
            {menuOpen && (
              <div className="absolute bottom-full right-0 mb-1 w-36 py-1 rounded-lg shadow-lg z-50" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
                <Link to={`/sell/services/${offer.id}`} className="flex items-center gap-2 px-3 py-2 text-[12px] cursor-pointer hover:bg-(--theme-bg-subtle) transition-colors" style={{ color: 'var(--theme-text)' }}>
                  <Edit size={14} /> Edit
                </Link>
                {offer.status === 'DRAFT' && (
                  <button onClick={() => { setMenuOpen(false); onAction('publish', offer) }} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] cursor-pointer hover:bg-(--theme-bg-subtle) transition-colors" style={{ color: 'var(--color-status-success)' }}>
                    <Eye size={14} /> Publish
                  </button>
                )}
                {offer.status === 'ACTIVE' && (
                  <button onClick={() => { setMenuOpen(false); onAction('archive', offer) }} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] cursor-pointer hover:bg-(--theme-bg-subtle) transition-colors" style={{ color: 'var(--theme-text-muted)' }}>
                    <Archive size={14} /> Archive
                  </button>
                )}
                <button onClick={() => { setMenuOpen(false); onAction('delete', offer) }} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] cursor-pointer hover:bg-(--theme-bg-subtle) transition-colors" style={{ color: 'var(--color-status-error)' }}>
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </article>
    </div>
  )
}

function SkeletonServiceCard() {
  return (
    <div className="rounded-xl overflow-hidden animate-pulse" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
      <div className="h-[120px]" style={{ background: 'var(--color-neutral-8)' }} />
      <div className="px-3 pt-2.5 pb-3 flex flex-col gap-2">
        <div className="h-4 w-14 rounded" style={{ background: 'var(--color-neutral-8)' }} />
        <div className="h-3.5 rounded" style={{ background: 'var(--color-neutral-8)' }} />
        <div className="h-3 w-2/5 rounded" style={{ background: 'var(--color-neutral-9)' }} />
      </div>
    </div>
  )
}

export function SellServices() {
  const navigate = useNavigate()
  const { theme } = useTheme()
  const queryClient = useQueryClient()
  const [deleteConfirm, setDeleteConfirm] = useState<Offer | null>(null)
  const [filterTab, setFilterTab] = useState('all')
  const [query, setQuery] = useState('')
  const pubkey = localStorage.getItem('pubkey') ?? ''
  const { setActions: setFABActions, clear: clearFAB } = useFABActions()

  const { data: offers = [], isLoading: loading } = useUserServiceOffers(pubkey)
  const { data: tickets = [] } = useUserTickets(pubkey)

  useEffect(() => {
    setFABActions([
      { id: 'create-service', label: 'Service', info: 'Create new service', group: 'Cooperate', icon: 'briefcase', onClick: () => navigate('/sell/services/new') },
      { id: 'coop-guide', label: 'Coop Guide', info: 'Start cooperation', group: 'Cooperate', icon: 'handshake', onClick: () => navigate('/coop/guide') },
    ])
    return () => clearFAB()
  }, [setFABActions, clearFAB, navigate])

  const pendingTicketsByOffer = useMemo(() => {
    const map: Record<string, number> = {}
    for (const ticket of tickets) {
      if (ticket.sellerPubkey === pubkey && ticket.status === 'PENDING') {
        map[ticket.offerId] = (map[ticket.offerId] || 0) + 1
      }
    }
    return map
  }, [tickets, pubkey])

  async function handleAction(action: 'edit' | 'archive' | 'delete' | 'publish', offer: Offer) {
    if (action === 'delete') { setDeleteConfirm(offer); return }
    if (action === 'archive') {
      try {
        await apiCall(`/api/offers/${offer.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ARCHIVED', creatorPubkey: pubkey }) })
        queryClient.invalidateQueries({ queryKey: ['user-service-offers', pubkey] })
      } catch (error) { console.error('Failed to archive service:', error) }
      return
    }
    if (action === 'publish') {
      try {
        await apiCall(`/api/offers/${offer.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ACTIVE', creatorPubkey: pubkey }) })
        queryClient.invalidateQueries({ queryKey: ['user-service-offers', pubkey] })
      } catch (error) { console.error('Failed to publish service:', error) }
      return
    }
  }

  async function confirmDelete() {
    if (!deleteConfirm || !pubkey) return
    try {
      await apiCall(`/api/offers/${deleteConfirm.id}`, { method: 'DELETE', body: JSON.stringify({ creatorPubkey: pubkey }) })
      setDeleteConfirm(null)
      queryClient.invalidateQueries({ queryKey: ['user-service-offers', pubkey] })
    } catch (error) { console.error('Failed to delete service:', error) }
  }

  const totalPending = useMemo(() => tickets.filter(t => t.sellerPubkey === pubkey && t.status === 'PENDING').length, [tickets, pubkey])

  const filteredOffers = useMemo(() => {
    let filtered = offers
    if (filterTab !== 'all') filtered = filtered.filter(o => o.status === filterTab.toUpperCase())
    if (query.trim()) {
      const q = query.toLowerCase()
      filtered = filtered.filter(o =>
        o.title.toLowerCase().includes(q) ||
        o.description?.toLowerCase().includes(q) ||
        o.categoryCode?.toLowerCase().includes(q),
      )
    }
    return filtered
  }, [offers, filterTab, query])

  const kpiItems = useMemo<KPIItem[]>(() => {
    const active = offers.filter(o => o.status === 'ACTIVE').length
    const draft = offers.filter(o => o.status === 'DRAFT').length
    return [
      { icon: <Briefcase size={14} />, value: offers.length, label: 'Total' },
      { icon: <Eye size={14} />, value: active, label: 'Active' },
      { icon: <EyeOff size={14} />, value: draft, label: 'Drafts' },
      { icon: <Clock size={14} />, value: totalPending, label: 'Pending', color: totalPending > 0 ? 'var(--color-warning-primary)' : undefined },
    ]
  }, [offers, totalPending])

  if (!pubkey) {
    return (
      <PageContainer size="wide" spacing="lg">
        <PageHeader title="My Services" subtitle="You must be logged in" onBack={() => navigate('/sell')} />
        <div className="flex flex-col items-center py-16 gap-4">
          <Link to="/login" className="px-6 py-3 rounded-lg text-[14px] font-semibold transition-all duration-200 hover:opacity-90" style={{ background: 'var(--color-primary-50)', color: 'white' }}>Log in</Link>
        </div>
      </PageContainer>
    )
  }

  return (
    <>
      <PageContainer size="wide" spacing="lg">
        <PageHeader icon={<Briefcase size={18} />} title="My Services" subtitle={loading ? '...' : `${offers.length} service offerings`} onBack={() => navigate('/sell')} />
        <KPIStrip items={kpiItems} loading={loading} skeletonCount={4} wrap />

        <ListHeader
          tabs={[
            { key: 'all', label: 'All' },
            { key: 'active', label: 'Active' },
            { key: 'draft', label: 'Drafts' },
            { key: 'archived', label: 'Archived' },
          ]}
          activeTab={filterTab}
          onTabChange={setFilterTab}
          actions={[{
            key: 'search',
            element: (
              <SearchInput
                variant="toggle"
                size="md"
                value={query}
                onChange={setQuery}
                onClear={() => setQuery('')}
                placeholder="Search services…"
                autoFocus
              />
            ),
          }]}
        />

        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <SkeletonServiceCard key={i} />)}
          </div>
        ) : filteredOffers.length === 0 ? (
          <div className="flex flex-col items-center py-16 gap-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'var(--theme-bg-subtle)' }}>
              <Briefcase size={28} style={{ color: 'var(--theme-text-muted)' }} />
            </div>
            <span className="text-[15px] font-semibold" style={{ color: 'var(--theme-text)' }}>
              {query ? 'No results' : 'No services yet'}
            </span>
            <p className="text-[13px] text-center max-w-xs" style={{ color: 'var(--theme-text-muted)' }}>
              {query
                ? `No services match "${query}".`
                : filterTab !== 'all'
                  ? `No ${filterTab} services`
                  : 'Create your first service offering to start accepting clients'}
            </p>
            {!query && filterTab === 'all' && (
              <Link to="/sell/services/new" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 hover:opacity-90" style={{ background: 'var(--color-secondary-50)', color: 'white' }}>
                <Plus size={16} /> Create Service
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {filteredOffers.map((offer, i) => (
              <ServiceCard key={offer.id} offer={offer} theme={theme} index={i} pendingTickets={pendingTicketsByOffer[offer.id] || 0} onAction={handleAction} />
            ))}
          </div>
        )}
      </PageContainer>

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-sm p-5 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
            <h3 className="text-[16px] font-semibold mb-2" style={{ color: 'var(--theme-text)' }}>Delete Service?</h3>
            <p className="text-[13px] mb-4" style={{ color: 'var(--theme-text-muted)' }}>This action cannot be undone. "{deleteConfirm.title}" will be permanently removed.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 cursor-pointer hover:opacity-90" style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text)' }}>Cancel</button>
              <button onClick={confirmDelete} className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 cursor-pointer hover:opacity-90" style={{ background: 'var(--color-status-error)', color: 'white' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}