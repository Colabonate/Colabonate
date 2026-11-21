import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from '../../contexts/LocaleContext'
import { FiatHint } from '../../components/currency/FiatHint'
import { Package, Briefcase, Bot, Zap, Clock, Eye, EyeOff, ArrowRight } from 'lucide-react'
import { PageContainer } from '@ds/ui'
import { cn } from '@ds/utils'
import { PageHeader } from '../../components/PageHeader'
import { KPIStrip } from '../../components/kpi/KpiStrip'
import type { KPIItem } from '@ds/ui'
import type { Offer } from '../../types/api'
import { useUserAllOffers, useUserTickets } from '../../hooks/useEntityQueries'

const STATUS_BADGE_CLASS: Record<string, string> = {
  DRAFT:    'bg-[rgba(159,122,234,0.12)] text-[#9F7AEA] border-[rgba(159,122,234,0.28)]',
  ACTIVE:   'bg-[rgba(72,187,120,0.12)] text-[#276749] border-[rgba(72,187,120,0.28)]',
  CLOSED:   'bg-[rgba(245,166,35,0.12)] text-[#92600A] border-[rgba(245,166,35,0.28)]',
  ARCHIVED: 'bg-[rgba(113,128,150,0.12)] text-[#718096] border-[rgba(113,128,150,0.28)]',
}

function OfferRow({ offer, pendingTickets }: { offer: Offer; pendingTickets: number }) {
  const { formatNumber } = useTranslation()
  const isService = offer.offerType === 'SERVICE'
  return (
    <Link
      to={isService ? `/sell/services/${offer.id}` : `/sell/listings/${offer.id}`}
      className="flex items-center gap-4 px-4 py-3.5 rounded-xl no-underline cursor-pointer transition-all duration-200 hover:-translate-y-px hover:shadow-[0_4px_20px_rgba(0,0,0,0.10)]"
      style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
    >
      <div className="w-10 h-10 rounded-lg shrink-0 flex items-center justify-center" style={{ background: isService ? 'rgba(99,179,237,0.12)' : 'rgba(72,187,120,0.12)' }}>
        {isService ? <Briefcase size={18} style={{ color: '#63B3ED' }} /> : <Package size={18} style={{ color: '#48B978' }} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-widest border leading-none', STATUS_BADGE_CLASS[offer.status ?? 'DRAFT'] ?? STATUS_BADGE_CLASS.DRAFT)}>
            {offer.status}
          </span>
          <span className="text-[14px] font-semibold truncate leading-none" style={{ color: 'var(--theme-text)' }}>
            {offer.title}
          </span>
        </div>
        <p className="text-[11px] truncate" style={{ color: 'var(--theme-text-muted)' }}>
          {isService ? 'Service' : 'Listing'} · {offer.category}
        </p>
      </div>
      {pendingTickets > 0 && isService && offer.status === 'ACTIVE' && (
        <div className="flex items-center gap-1 px-2 py-1 rounded-md shrink-0" style={{ background: 'rgba(245,166,35,0.12)', border: '1px solid rgba(245,166,35,0.20)' }}>
          <Clock size={12} className="text-[#F5A623]" />
          <span className="text-[11px] font-semibold text-[#F5A623]">{pendingTickets} pending</span>
        </div>
      )}
      <div className="flex items-center gap-1 shrink-0">
        <Zap size={12} style={{ fill: 'var(--color-primary-50)', color: 'var(--color-primary-50)' }} />
        <span className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--color-primary-50)' }}>
          {formatNumber(offer.priceSats)}
        </span>
        <FiatHint sats={offer.priceSats} className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }} />
      </div>
      <ArrowRight size={14} style={{ color: 'var(--theme-text-muted)' }} className="shrink-0" />
    </Link>
  )
}

export function SellOffers() {
  const navigate = useNavigate()
  const pubkey = localStorage.getItem('pubkey') ?? ''

  const { data: offers = [], isLoading: loading } = useUserAllOffers(pubkey)
  const { data: tickets = [] } = useUserTickets(pubkey)

  const pendingTicketsByOffer = useMemo(() => {
    const map: Record<string, number> = {}
    for (const ticket of tickets) {
      if (ticket.sellerPubkey === pubkey && ticket.status === 'PENDING') {
        map[ticket.offerId] = (map[ticket.offerId] || 0) + 1
      }
    }
    return map
  }, [tickets, pubkey])

  const listings = useMemo(() => offers.filter(o => o.offerType === 'PRODUCT').sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [offers])
  const services = useMemo(() => offers.filter(o => o.offerType === 'SERVICE').sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [offers])

  const totalPending = useMemo(() => tickets.filter(t => t.sellerPubkey === pubkey && t.status === 'PENDING').length, [tickets, pubkey])

  const kpiItems = useMemo<KPIItem[]>(() => {
    const active = offers.filter(o => o.status === 'ACTIVE').length
    const draft = offers.filter(o => o.status === 'DRAFT').length
    return [
      { icon: <Package size={14} />, value: offers.length, label: 'Total' },
      { icon: <Eye size={14} />, value: active, label: 'Active' },
      { icon: <EyeOff size={14} />, value: draft, label: 'Drafts' },
      { icon: <Clock size={14} />, value: totalPending, label: 'Pending', color: totalPending > 0 ? 'var(--color-warning-primary)' : undefined },
    ]
  }, [offers, totalPending])

  if (!pubkey) {
    return (
      <PageContainer size="wide" spacing="lg">
        <PageHeader title="My Offers" subtitle="You must be logged in" onBack={() => navigate('/sell')} />
      </PageContainer>
    )
  }

  return (
    <PageContainer size="wide" spacing="lg">
      <PageHeader title="All My Offers" subtitle={loading ? '...' : `${offers.length} total offers`} onBack={() => navigate('/sell')} />
      <KPIStrip items={kpiItems} loading={loading} skeletonCount={4} wrap />

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }} />
          ))}
        </div>
      ) : offers.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'var(--theme-bg-subtle)' }}>
            <Package size={28} style={{ color: 'var(--theme-text-muted)' }} />
          </div>
          <span className="text-[15px] font-semibold" style={{ color: 'var(--theme-text)' }}>No offers yet</span>
          <p className="text-[13px] text-center max-w-xs" style={{ color: 'var(--theme-text-muted)' }}>Create your first listing or service to start selling</p>
          <div className="flex gap-3">
            <Link to="/sell/listings/new" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-all duration-200 hover:opacity-90" style={{ background: 'var(--color-status-success)', color: 'white' }}>
              <Package size={14} /> Create Listing
            </Link>
            <Link to="/sell/services/new" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-all duration-200 hover:opacity-90" style={{ background: 'var(--color-secondary-50)', color: 'white' }}>
              <Briefcase size={14} /> Create Service
            </Link>
            <Link to="/sell/agents/new" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-all duration-200 hover:opacity-90" style={{ background: 'var(--color-primary-50)', color: 'white' }}>
              <Bot size={14} /> Offer an Agent
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {listings.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[14px] font-semibold flex items-center gap-2" style={{ color: 'var(--theme-text)' }}>
                  <Package size={16} style={{ color: 'var(--color-status-success)' }} />
                  Listings ({listings.length})
                </h3>
                <Link to="/sell/listings" className="text-[12px] font-medium flex items-center gap-1 cursor-pointer hover:opacity-80" style={{ color: 'var(--color-status-success)' }}>
                  View all <ArrowRight size={12} />
                </Link>
              </div>
              <div className="flex flex-col gap-2">
                {listings.slice(0, 5).map(offer => <OfferRow key={offer.id} offer={offer} pendingTickets={pendingTicketsByOffer[offer.id] || 0} />)}
              </div>
            </section>
          )}

          {services.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[14px] font-semibold flex items-center gap-2" style={{ color: 'var(--theme-text)' }}>
                  <Briefcase size={16} style={{ color: '#63B3ED' }} />
                  Services ({services.length})
                </h3>
                <Link to="/sell/services" className="text-[12px] font-medium flex items-center gap-1 cursor-pointer hover:opacity-80" style={{ color: '#63B3ED' }}>
                  View all <ArrowRight size={12} />
                </Link>
              </div>
              <div className="flex flex-col gap-2">
                {services.slice(0, 5).map(offer => <OfferRow key={offer.id} offer={offer} pendingTickets={pendingTicketsByOffer[offer.id] || 0} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </PageContainer>
  )
}