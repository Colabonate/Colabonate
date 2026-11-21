// ESCROW-COPY (ADR-397): payment wording here assumes Direct-Pay. On escrow activation follow docs/plans/ESCROW-COPY-REACTIVATION.md.
import { useState, useCallback, useMemo, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Building2, Zap, Globe2, Shield, Layers, ArrowRight, MapPin, Clock, ChevronDown, ChevronUp, ExternalLink, Bitcoin, Radio, Briefcase, Package, ShoppingBag, Tag, Star, TrendingUp, ShoppingCart, Users, Users2, Folder, TicketIcon, CalendarDays, Boxes } from 'lucide-react'
import { PageContainer, FloatingAddButton, SliderList } from '@ds/ui'
import { KPIStrip } from '../../components/kpi/KpiStrip'
import type { KPIItem } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { useIncomingBookings } from '../../hooks/useBookingQueries'
import { cn, useIsMobile } from '@ds/utils'
import { apiCall } from '../../lib/api'
import { formatSatsNumber } from '../../lib/currency'
import { useCurrency } from '../../contexts/CurrencyContext'
import { useSliderItemsFiat } from '../../components/currency/useSliderItemsFiat'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { useFABActions } from '../../context/FABContext'
import { statusLabel as STATUS_LABEL_MAP } from '../../lib/ticket-status-config'
import { GUIDE_PLACEHOLDERS, GuidePlaceholderCard, type GuidePlaceholderItem } from '../../components/onboarding/GuidePlaceholders'
import type { Company, Ticket } from '../../types/api'
import { useQuery } from '@tanstack/react-query'

interface DashboardKPIStats {
  totalCatalogs: number
  totalProducts: number
  totalListings: number
  totalServices: number
  totalItems: number
  avgRating: number
  reviewCount: number
  salesCount: number
  purchasesCount: number
  revenue30d: number
  revenue6m: number
  revenue12m: number
  revenueGrowth30d: number | null
  revenueGrowth6m: number | null
  revenueGrowth12m: number | null
  partnersCount: number
  cooperationsCount: number
  projectsCount: number
}

function revenueInPeriod(tickets: Ticket[], pubkey: string, fromDaysAgo: number, toDaysAgo = 0): number {
  const now = Date.now()
  const fromMs = now - fromDaysAgo * 86400000
  const toMs = now - toDaysAgo * 86400000
  return tickets
    .filter(t => t.sellerPubkey === pubkey && t.status === 'COMPLETED' && new Date(t.createdAt).getTime() >= fromMs && new Date(t.createdAt).getTime() < toMs)
    .reduce((sum, t) => sum + (t.amountSats ?? t.offer?.priceSats ?? 0), 0)
}

function growthPercent(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null
  return Math.round(((current - previous) / previous) * 100)
}


const FEATURE_SECTIONS = [
  {
    title: 'Company Profile',
    description: 'Set up your public company profile with logo, address, and business hours. Your profile is published to Nostr, making it discoverable by other users across the network.',
    icon: Building2,
    link: '/sell/company',
    color: 'var(--color-primary-50)',
    bg: 'rgba(99,179,237,0.12)',
    features: ['Public Nostr profile', 'Logo & branding', 'Business hours'],
  },
  {
    title: 'Product Catalogs',
    description: 'Organize your products into catalogs and categories. Each catalog syncs to Nostr, enabling decentralized product discovery without central servers.',
    icon: Layers,
    link: '/sell/listings?tab=catalogs',
    color: 'var(--color-secondary-50)',
    bg: 'rgba(159,122,234,0.12)',
    features: ['Decentralized storage', 'Category structure', 'Product variants'],
  },
  {
    title: 'Listings',
    description: 'Create product listings that buyers can purchase with Bitcoin Lightning. Smart contracts ensure secure escrow with multi-phase payment releases.',
    icon: Package,
    link: '/sell/listings',
    color: 'var(--color-status-success)',
    bg: 'rgba(72,187,120,0.12)',
    features: ['Lightning payments', 'Paid directly to you', 'Instant delivery'],
  },
  {
    title: 'Services',
    description: 'Offer services with milestone-based delivery. Clients pay into escrow, and you receive payments as you complete each phase.',
    icon: Briefcase,
    // ADR-368 D1/D2: service offers are managed under Cooperate → Manage.
    link: '/coop/manage?tab=services',
    color: '#63B3ED',
    bg: 'rgba(99,179,237,0.12)',
    features: ['Milestone payments', 'Client acceptance', 'Project phases'],
  },
  {
    title: 'Collections & Shipping',
    description: 'Group products into Gamma Collections and define reusable shipping options (NIP-99, Kind 30405/30406). Discoverable by every Gamma-compatible marketplace client.',
    icon: Boxes,
    link: '/sell/company/collections',
    color: 'var(--color-accent-primary)',
    bg: 'rgba(245,166,35,0.12)',
    features: ['Product grouping', 'Shared shipping', 'Gamma interop'],
  },
  {
    title: 'Private Selling',
    description: 'Sell individual items without a company. List personal articles, used goods, or one-off items directly on the marketplace.',
    icon: ShoppingBag,
    link: '/sell/listings',
    color: 'var(--color-neutral-5)',
    bg: 'rgba(113,128,150,0.12)',
    features: ['No company needed', 'Instant listing', 'Direct sales'],
  },
]

const TECH_HIGHLIGHTS = [
  {
    icon: Bitcoin,
    title: 'Bitcoin Lightning',
    description: 'Instant, low-fee payments via Lightning Network. No traditional banking required.',
    color: 'var(--color-warning-primary)',
    bg: 'rgba(255,192,57,0.08)',
  },
  {
    icon: Radio,
    title: 'Nostr Protocol',
    description: 'Decentralized publishing to Nostr relays. Your data stays portable and censorship-resistant.',
    color: 'var(--color-secondary-50)',
    bg: 'rgba(159,122,234,0.08)',
  },
  {
    icon: Zap,
    title: 'Direct Pay',
    description: 'Buyers pay you directly over Lightning — no platform in the middle, no funds held by Colabonate.',
    color: 'var(--color-accent-primary)',
    bg: 'rgba(245,166,35,0.08)',
  },
  {
    icon: Shield,
    title: 'Identity Verification',
    description: 'Optional identity levels build trust. Higher verification unlocks more marketplace features.',
    color: 'var(--color-info-primary)',
    bg: 'rgba(56,189,248,0.08)',
  },
]

/** Matches the server's `/api/offers?slim=1` select — this view only counts and thumbnails. */
interface OfferSlim {
  id: string
  title: string
  priceSats: number
  categoryCode: string
  offerType?: string
  companyId?: string | null
  creatorPubkey: string
  imageThumbs?: string[]
}

export function SellDashboard() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [pubkey] = useState(() => localStorage.getItem('pubkey') ?? '')
  const [activeTicketSegment, setActiveTicketSegment] = useState<'my-tickets' | 'my-offers'>('my-offers')
  const [hoursExpanded, setHoursExpanded] = useState(false)
  // ADR-271: open booking requests (REQUESTED = awaiting the seller's countersignature)
  const incomingBookings = useIncomingBookings(pubkey || undefined)
  const openBookingRequests = (incomingBookings.data?.bookings ?? []).filter(b => b.status === 'REQUESTED').length
  const { actions: fabActions, setActions: setFABActions, clear: clearFAB } = useFABActions()
  const dashboardRef = usePageAnimation([
    { selector: '.dashboard-animate', from: { duration: 0.5, stagger: 0.12, y: 24 } },
  ])

  const { data: offersData, isLoading: offersLoading } = useQuery({
    queryKey: ['user-all-offers-slim', pubkey],
    queryFn: async (): Promise<{ offers: OfferSlim[] }> => {
      // Perf fix (2026-10-02): this view only ever counts by offerType/companyId
      // and shows a thumbnail — slim=1 skips the raw `images`/description/milestone
      // payload that made this response balloon to multi-MB for sellers with many
      // offer images (measured 18.6 MB on production for one account).
      const res = await apiCall(`/api/offers?creatorPubkey=${pubkey}&slim=1`)
      return res.json()
    },
    enabled: Boolean(pubkey),
    staleTime: 30_000,
  })

  const { data: ticketsData, isLoading: ticketsLoading } = useQuery({
    queryKey: ['user-tickets', pubkey],
    queryFn: async (): Promise<{ tickets: Ticket[] }> => {
      const res = await apiCall(`/api/tickets?pubkey=${pubkey}`)
      return res.json()
    },
    enabled: Boolean(pubkey),
    staleTime: 30_000,
  })

  const { data: reviewsData, isLoading: reviewsLoading } = useQuery({
    queryKey: ['user-reviews', pubkey],
    queryFn: async () => {
      const res = await apiCall(`/api/reviews/${pubkey}`)
      return res.json()
    },
    enabled: Boolean(pubkey),
    staleTime: 30_000,
  })

  const loading = offersLoading || ticketsLoading || reviewsLoading

  const offers = offersData?.offers ?? []
  const tickets: Ticket[] = ticketsData?.tickets ?? []

  const { data: companyData } = useQuery({
    queryKey: ['company', pubkey],
    queryFn: async () => {
      const res = await apiCall(`/api/company/${pubkey}`)
      return res.json()
    },
    enabled: Boolean(pubkey),
    staleTime: 30_000,
  })

  const company = (companyData as { company?: Company } | undefined)?.company ?? null

  useEffect(() => {
    if (!company?.openingHours || Object.keys(company.openingHours).length === 0) return
    setHoursExpanded(true)
  }, [company?.openingHours])

  const stats = useMemo((): DashboardKPIStats | null => {
    if (!offers.length && !tickets.length) return null
    const listings = offers.filter((o: { offerType?: string }) => o.offerType === 'PRODUCT')
    const services = offers.filter((o: { offerType?: string }) => o.offerType === 'SERVICE')
    const items = offers.filter((o: { offerType?: string; companyId?: string | null }) => o.offerType === 'ITEM' && !o.companyId)

    const rev30d = revenueInPeriod(tickets, pubkey, 30, 0)
    const revPrev30d = revenueInPeriod(tickets, pubkey, 60, 30)
    const rev6m = revenueInPeriod(tickets, pubkey, 180, 0)
    const revPrev6m = revenueInPeriod(tickets, pubkey, 360, 180)
    const rev12m = revenueInPeriod(tickets, pubkey, 365, 0)
    const revPrev12m = revenueInPeriod(tickets, pubkey, 730, 365)

    return {
      totalCatalogs: company?.catalogs?.length ?? 0,
      totalProducts: 0,
      totalListings: listings.length,
      totalServices: services.length,
      totalItems: items.length,
      avgRating: reviewsData?.averageStars ?? 0,
      reviewCount: reviewsData?.totalCount ?? 0,
      salesCount: tickets.filter(t => t.sellerPubkey === pubkey && t.status === 'COMPLETED').length,
      purchasesCount: tickets.filter(t => t.buyerPubkey === pubkey && t.status === 'COMPLETED').length,
      revenue30d: rev30d,
      revenue6m: rev6m,
      revenue12m: rev12m,
      revenueGrowth30d: growthPercent(rev30d, revPrev30d),
      revenueGrowth6m: growthPercent(rev6m, revPrev6m),
      revenueGrowth12m: growthPercent(rev12m, revPrev12m),
      partnersCount: 0,
      cooperationsCount: 0,
      projectsCount: 0,
    }
  }, [offers, tickets, pubkey, company, reviewsData])

  useEffect(() => {
    // Unified Add-FAB — identical action set as CoopExplore (ADR-368): Items,
    // Product, Service, Agent, Bounty, Coop Guide across every surface.
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

  useEffect(() => {
    if (!hoursExpanded) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.hours-dropdown-container')) {
        setHoursExpanded(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [hoursExpanded])

  const { satsToFiat, formatFiat } = useCurrency()

  const kpiItems = useMemo(() => {
    const s = stats

    // Fiat equivalent for KPI tooltips (ADR-235): the tiny KPI cards stay
    // sats-only; the hint lives in the hover/long-press tooltip.
    const fiatHint = (sats: number): string => {
      const fiat = satsToFiat(sats)
      return fiat !== null ? ` ≈ ${formatFiat(fiat)}` : ''
    }

    const growthLabel = (pct: number | null): string => {
      if (pct === null) return ''
      return pct >= 0 ? ` (+${pct}% vs prev. period)` : ` (${pct}% vs prev. period)`
    }

    const growthColor = (pct: number | null): string | undefined => {
      if (pct === null || pct === 0) return undefined
      return pct > 0 ? 'var(--color-status-success)' : 'var(--color-status-error)'
    }

    const items: KPIItem[] = [
      {
        value: s?.totalProducts ?? 0,
        label: 'Products',
        icon: <Package size={14} />,
        heading: 'Catalog & Offers',
        tooltip: 'Total products across all catalogs – click to manage',
        onClick: () => navigate('/sell/listings?tab=products'),
      },
      {
        value: s?.totalCatalogs ?? 0,
        label: 'Catalogs',
        icon: <Layers size={14} />,
        tooltip: 'Product catalogs – click to manage',
        onClick: () => navigate('/sell/listings?tab=catalogs'),
      },
      {
        value: s?.totalListings ?? 0,
        label: 'Listings',
        icon: <Tag size={14} />,
        tooltip: 'Active product listings – click to manage',
        onClick: () => navigate('/sell/listings'),
      },
      {
        value: s?.totalServices ?? 0,
        label: 'Services',
        icon: <Briefcase size={14} />,
        tooltip: 'Active service offers – managed under Cooperate',
        onClick: () => navigate('/coop/manage?tab=services'),
      },
      {
        value: s?.totalItems ?? 0,
        label: 'Items',
        icon: <ShoppingBag size={14} />,
        tooltip: 'Private items listed without a company',
      },
      {
        value: openBookingRequests,
        label: 'Bookings',
        icon: <CalendarDays size={14} />,
        tooltip: 'Open booking requests – click to accept (countersign) or decline',
        onClick: () => navigate('/sell/bookings'),
      },
      // ADR-337: the Bounty Board quick-link card was removed — every other
      // card in this strip is a real seller-scoped metric (this one never was,
      // per the note it used to carry: bounties are buyer-published, not
      // seller-scoped). Bounty Board is now reachable from Search's Cooperate
      // context ("Bounties" KPI chip) instead.
      {
        separator: true,
        heading: 'Performance',
        value: s?.avgRating ? `${s.avgRating}★` : '—',
        label: 'Rating',
        icon: <Star size={14} />,
        tooltip: s?.reviewCount
          ? `Avg. rating from ${s.reviewCount} review${s.reviewCount !== 1 ? 's' : ''}`
          : 'No reviews yet',
        color: s?.avgRating && s.avgRating >= 4 ? 'var(--color-status-success)' : undefined,
      },
      {
        value: s?.salesCount ?? 0,
        label: 'Sales',
        icon: <TrendingUp size={14} />,
        tooltip: 'Completed sales transactions',
      },
      {
        value: s?.purchasesCount ?? 0,
        label: 'Purchases',
        icon: <ShoppingCart size={14} />,
        tooltip: 'Completed purchase transactions',
      },
      {
        separator: true,
        heading: 'Revenue',
        value: formatSatsNumber(s?.revenue30d ?? 0),
        label: 'Rev 30d',
        icon: <Zap size={14} />,
        tooltip: `Revenue last 30 days (sats)${fiatHint(s?.revenue30d ?? 0)}${growthLabel(s?.revenueGrowth30d ?? null)}`,
        color: growthColor(s?.revenueGrowth30d ?? null),
      },
      {
        value: formatSatsNumber(s?.revenue6m ?? 0),
        label: 'Rev 6M',
        icon: <Zap size={14} />,
        tooltip: `Revenue last 6 months (sats)${fiatHint(s?.revenue6m ?? 0)}${growthLabel(s?.revenueGrowth6m ?? null)}`,
        color: growthColor(s?.revenueGrowth6m ?? null),
      },
      {
        value: formatSatsNumber(s?.revenue12m ?? 0),
        label: 'Rev 12M',
        icon: <Zap size={14} />,
        tooltip: `Revenue last 12 months (sats)${fiatHint(s?.revenue12m ?? 0)}${growthLabel(s?.revenueGrowth12m ?? null)}`,
        color: growthColor(s?.revenueGrowth12m ?? null),
      },
      {
        separator: true,
        heading: 'Network',
        value: s?.partnersCount ?? 0,
        label: 'Partners',
        icon: <Users size={14} />,
        tooltip: 'Business partners – coming soon',
        onClick: () => navigate('/coop'),
      },
      {
        value: s?.cooperationsCount ?? 0,
        label: 'Coops',
        icon: <Users2 size={14} />,
        tooltip: 'Active cooperations – coming soon',
        onClick: () => navigate('/coop'),
      },
      {
        value: s?.projectsCount ?? 0,
        label: 'Projects',
        icon: <Folder size={14} />,
        tooltip: 'Active projects – coming soon',
        onClick: () => navigate('/coop'),
      },
    ]

    if (!company) {
      items.unshift({
        value: 0,
        label: 'Company',
        icon: <Building2 size={14} />,
        heading: 'Creator',
        tooltip: 'No company set up yet – click to create',
        onClick: () => navigate('/sell/company/setup'),
        color: 'var(--color-status-error)',
      })
    }

    return items
  }, [stats, company, navigate, satsToFiat, formatFiat])

  const filteredSellOffers = useMemo(() => {
    return pubkey ? offers.filter(o => o.creatorPubkey === pubkey) : []
  }, [offers, pubkey])

  const activeTickets = useMemo(() => {
    const ACTIVE_STATUSES = new Set(['PENDING', 'ACCEPTED', 'PAID', 'IN_PROGRESS'])
    return tickets.filter(t => ACTIVE_STATUSES.has(t.status))
  }, [tickets])

  const ticketSegments = useMemo(() => [
    { id: 'my-offers', label: 'My Offers', count: filteredSellOffers.length },
    { id: 'my-tickets', label: 'My Tickets', count: activeTickets.length },
  ], [activeTickets.length, filteredSellOffers.length])

  const ticketInfoCards = useMemo(() => ({
    'my-tickets': {
      title: 'Tickets',
      description: 'Track your active orders and services.',
    },
    'my-offers': {
      title: 'Offers',
      description: 'Your published listings and services.',
    },
  }), [])

  const ticketItems = useMemo(() => {
    switch (activeTicketSegment) {
      case 'my-tickets':
        return activeTickets.slice(0, 8).map(ticket => ({
          id: ticket.id,
          title: ticket.offer.title,
          category: ticket.offerType === 'PRODUCT' ? 'Product' : 'Service',
          status: ticket.status,
          statusLabel: STATUS_LABEL_MAP[ticket.status],
          priceSats: ticket.amountSats ?? ticket.offer.priceSats,
          entityType: 'ticket' as const,
          avatarUrl: ticket.offer.images?.[0],
        }))
      case 'my-offers':
        return filteredSellOffers.slice(0, 8).map(offer => ({
          id: offer.id,
          title: offer.title,
          category: offer.categoryCode ?? '',
          priceSats: offer.priceSats,
          entityType: 'offer' as const,
          avatarUrl: offer.imageThumbs?.[0],
        }))
      default:
        return []
    }
  }, [activeTicketSegment, activeTickets, filteredSellOffers])

  // ADR-235: white fiat chip next to sats in the slider cards.
  const ticketItemsFiat = useSliderItemsFiat(ticketItems)

  const emptyPlaceholders = useMemo<GuidePlaceholderItem[]>(() => {
    const info = ticketInfoCards[activeTicketSegment]
    const infoCard: GuidePlaceholderItem = {
      id: `info-${activeTicketSegment}`,
      topic: info.title,
      icon: activeTicketSegment === 'my-tickets' ? TicketIcon : Package,
      text: info.description,
      cta: activeTicketSegment === 'my-tickets' ? 'View tickets' : 'Create offer',
      to: activeTicketSegment === 'my-tickets' ? '/tickets' : '/sell/listings/new?type=PRODUCT&mode=listings',
    }
    return [infoCard, ...GUIDE_PLACEHOLDERS]
  }, [activeTicketSegment, ticketInfoCards])

  const handleTicketCardClick = useCallback((id: string) => {
    if (activeTicketSegment === 'my-tickets') navigate(`/tickets/${id}`)
    else navigate(`/offers/${id}`)
  }, [activeTicketSegment, navigate])

  const handleTicketLinkClick = useCallback(() => {
    if (activeTicketSegment === 'my-tickets') navigate('/tickets')
    else navigate('/sell/listings')
  }, [activeTicketSegment, navigate])

  const formatDayHours = (hours: { start: string; end: string } | null): string => {
    if (!hours) return 'Closed'
    return `${hours.start} – ${hours.end}`
  }

  const dayLabels: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }
  const dayOrder = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

  const getTodayHours = (hours: Record<string, { start: string; end: string } | null> | null): string => {
    if (!hours) return 'Unknown'
    const todayIndex = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1
    return formatDayHours(hours[dayOrder[todayIndex]])
  }

  const parsedHours = company?.openingHours && Object.keys(company.openingHours).length > 0 ? company.openingHours : null
  const todayIndex = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1

  if (loading) {
    return (
      <PageContainer size="wide" spacing="lg" className="pt-0!">
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div
              className="w-12 h-12 rounded-full border-4 border-(--color-primary-50) border-t-transparent animate-spin mx-auto mb-4"
              style={{ borderColor: 'var(--color-primary-50) var(--color-primary-50) var(--color-primary-50) transparent' }}
            />
            <p className="text-(--theme-text-muted)">Loading sell dashboard...</p>
          </div>
        </div>
      </PageContainer>
    )
  }

  return (
    <>
    {/* gap="none" + explicit section margins mirrors BountyBoard/CoopExplore
        (user feedback 2026-08-24): top edge flush (pt-0!), KPI strip 8px
        (mb-2) above the slider — the default PageContainer gap (24/32px) had
        each section floating too far apart. */}
    <PageContainer size="wide" spacing="lg" gap="none" className="pt-0!" ref={dashboardRef}>
      <PageHeader
        icon={<Building2 size={18} />}
        title="Sell"
        subtitle="Manage your company, catalogs, and products"
        onBack={() => navigate('/')}
      />

      <KPIStrip
        items={kpiItems}
        loading={loading}
        skeletonCount={company ? 4 : 5}
        wrap
        collapsible
        storageKey="kpi-sell-dashboard"
        className="mb-2"
      />

      <div className="dashboard-animate grid grid-cols-1 lg:grid-cols-[280px_1fr] xl:grid-cols-[320px_1fr] gap-6 lg:gap-8 mt-6">
        {/* Left Sidebar - Company Quick Info */}
        <aside className="lg:sticky lg:top-6 lg:self-start">
          {!company && (
            <div
              className="p-6 transition-all duration-200 border rounded-xl"
              style={{
                border: '1px solid var(--theme-border)',
                background: 'var(--theme-surface)',
              }}
            >
              <div className="flex flex-col items-center gap-4 text-center">
                <div
                  className="flex items-center justify-center w-16 h-16 rounded-xl"
                  style={{ background: 'var(--theme-bg-subtle)' }}
                >
                  <Building2 size={32} style={{ color: 'var(--theme-text-muted)' }} />
                </div>
                <div>
                  <h2
                    className="text-[17px] font-semibold mb-2"
                    style={{ color: 'var(--theme-text)' }}
                  >
                    Set up Company
                  </h2>
                  <p
                    className="mb-4 text-[13px] leading-relaxed"
                    style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                  >
                    Create your company profile to start selling.
                  </p>
                  <Link
                    to="/sell/company/setup"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg transition-all duration-200 cursor-pointer hover:opacity-90 active:scale-95 w-full justify-center"
                    style={{
                      background: 'var(--color-primary-50)',
                      color: 'white',
                      fontFamily: 'var(--typography-fontfamily-sans)',
                    }}
                  >
                    <Building2 size={18} />
                    Create Now
                  </Link>
                </div>
              </div>
            </div>
          )}

          {company && (
            <div
              className="p-5 transition-all duration-200 border rounded-xl"
              style={{
                border: '1px solid var(--theme-border)',
                background: 'var(--theme-surface)',
              }}
            >
              {/* Logo + Name */}
              <div className="flex items-center gap-3 mb-4">
                {company.logoUrl && (
                  <div
                    className="flex items-center justify-center w-12 h-12 overflow-hidden border rounded-xl shrink-0"
                    style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface-secondary)' }}
                  >
                    <img
                      src={company.logoUrl}
                      alt={`${company.name} logo`}
                      className="object-contain w-full h-full"
                    />
                  </div>
                )}
                {!company.logoUrl && (
                  <div
                    className="flex items-center justify-center w-12 h-12 rounded-xl shrink-0"
                    style={{ background: 'rgba(99,179,237,0.12)' }}
                  >
                    <Building2 size={24} style={{ color: 'var(--color-primary-50)' }} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h2
                    className="text-[15px] font-semibold truncate"
                    style={{ color: 'var(--theme-text)' }}
                  >
                    {company.name}
                  </h2>
                  {company.description && (
                    <p
                      className="text-[11px] line-clamp-2"
                      style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                    >
                      {company.description}
                    </p>
                  )}
                </div>
              </div>

              {/* Divider */}
              <div className="h-px mb-4" style={{ background: 'var(--theme-border)' }} />

              {/* Address */}
              {company.address && (
                <div className="flex items-start gap-2 mb-3">
                  <MapPin size={16} className="shrink-0 mt-0.5" style={{ color: 'var(--theme-text-muted)' }} />
                  <div className="text-[12px] leading-relaxed" style={{ color: 'var(--theme-text)' }}>
                    <div>{company.address}</div>
                    <div>{company.zipCode} {company.city}</div>
                    {company.country && <div>{company.country}</div>}
                  </div>
                </div>
              )}

              {/* Opening Hours */}
              {parsedHours && (
                <div className="mb-4 hours-dropdown-container">
                  <div className="flex items-center gap-2">
                    <Clock size={16} className="shrink-0" style={{ color: 'var(--theme-text-muted)' }} />
                    <button
                      onClick={(e) => { e.stopPropagation(); setHoursExpanded(!hoursExpanded) }}
                      className="flex items-center flex-1 gap-1 transition-opacity cursor-pointer hover:opacity-80"
                      style={{ color: 'var(--theme-text)' }}
                    >
                      <span className="text-[12px] font-medium">Today: {getTodayHours(parsedHours)}</span>
                      {hoursExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>
                  {hoursExpanded && (
                    <div
                      className="p-3 mt-3 rounded-lg"
                      style={{ background: 'var(--theme-surface-secondary)', border: '1px solid var(--theme-border)' }}
                    >
                      <div className="grid grid-cols-1 gap-1.5 text-[11px]">
                        {dayOrder.map((day, idx) => {
                          const hours = parsedHours[day]
                          const isToday = idx === todayIndex
                          return (
                            <div
                              key={day}
                              className={cn(
                                'flex items-center justify-between py-1 px-2 rounded-md',
                                isToday && 'font-semibold'
                              )}
                              style={{
                                background: isToday ? 'rgba(99,179,237,0.08)' : 'transparent',
                                color: isToday ? 'var(--color-primary-50)' : hours ? 'var(--theme-text)' : 'var(--theme-text-muted)',
                              }}
                            >
                              <span>{dayLabels[day]}</span>
                              <span>{formatDayHours(hours)}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Edit Link */}
              <Link
                to="/sell/company/setup"
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-[13px] transition-all duration-200 cursor-pointer hover:opacity-90"
                style={{
                  background: 'rgba(99,179,237,0.08)',
                  color: 'var(--color-primary-50)',
                  fontFamily: 'var(--typography-fontfamily-sans)',
                }}
              >
                <ExternalLink size={14} />
                Edit Company
              </Link>
            </div>
          )}
        </aside>

        {/* Main Content */}
        <main className="min-w-0">
          {/* Introduction Section */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <Globe2 size={24} style={{ color: 'var(--color-primary-50)' }} />
              <h2 className="text-[22px] font-semibold" style={{ color: 'var(--theme-text)' }}>
                Sell on Colabonate
              </h2>
            </div>
            <p
              className="text-[14px] leading-relaxed mb-6"
              style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              Colabonate enables decentralized commerce through <strong style={{ color: 'var(--color-warning-primary)' }}>Bitcoin Lightning</strong> payments 
              and <strong style={{ color: 'var(--color-secondary-50)' }}>Nostr</strong> publishing. Your company profile, products, and offers are stored on 
              Nostr relays, making them portable and censorship-resistant. Buyers pay you directly over Lightning; escrow for higher-value trades is planned.
            </p>

            {/* Tech Highlights - 2x2 Grid */}
            <div className="grid grid-cols-1 gap-4 mb-8 sm:grid-cols-2">
              {TECH_HIGHLIGHTS.map((item) => (
                <div
                  key={item.title}
                  className="flex items-start gap-3 p-4 transition-all duration-200 rounded-xl"
                  style={{
                    background: item.bg,
                    border: '1px solid transparent',
                  }}
                >
                  <div
                    className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0"
                    style={{ background: 'var(--theme-surface)' }}
                  >
                    <item.icon size={20} style={{ color: item.color }} />
                  </div>
                  <div>
                    <h4
                      className="text-[13px] font-semibold mb-1"
                      style={{ color: 'var(--theme-text)' }}
                    >
                      {item.title}
                    </h4>
                    <p
                      className="text-[12px] leading-relaxed"
                      style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                    >
                      {item.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Feature Sections - 2 Columns */}
          <div>
            <h3
              className="text-[16px] font-semibold mb-4"
              style={{ color: 'var(--theme-text)' }}
            >
              Manage Your Business
            </h3>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {FEATURE_SECTIONS.map((section) => (
                <Link
                  key={section.title}
                  to={section.link}
                  className={cn(
                    'group flex flex-col p-5 rounded-xl border no-underline cursor-pointer',
                    'transition-all duration-200',
                    'hover:-translate-y-1 hover:shadow-lg',
                  )}
                  style={{
                    border: '1px solid var(--theme-border)',
                    background: 'var(--theme-surface)',
                  }}
                >
                  {/* Header */}
                  <div className="flex items-start gap-4 mb-4">
                    <div
                      className="flex items-center justify-center w-12 h-12 transition-transform duration-200 rounded-xl shrink-0 group-hover:scale-105"
                      style={{ background: section.bg }}
                    >
                      <section.icon size={24} style={{ color: section.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4
                        className="text-[16px] font-semibold mb-2"
                        style={{ color: 'var(--theme-text)' }}
                      >
                        {section.title}
                      </h4>
                      <p
                        className="text-[13px] leading-relaxed"
                        style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                      >
                        {section.description}
                      </p>
                    </div>
                  </div>

                  {/* Features */}
                  <div className="flex flex-wrap gap-2 mb-3">
                    {section.features.map((feature) => (
                      <span
                        key={feature}
                        className="px-2.5 py-1 rounded-md text-[11px] font-medium"
                        style={{
                          background: 'var(--theme-surface-secondary)',
                          color: 'var(--theme-text-muted)',
                          fontFamily: 'var(--typography-fontfamily-sans)',
                        }}
                      >
                        {feature}
                      </span>
                    ))}
                  </div>

                  {/* Action */}
                  <div
                    className="flex items-center gap-2 text-[13px] font-medium transition-all duration-200"
                    style={{ color: section.color }}
                  >
                    <span>Go to {section.title}</span>
                    <ArrowRight size={14} className="transition-transform duration-200 group-hover:translate-x-1" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </main>
      </div>

    </PageContainer>

    {pubkey && (
      <SliderList
        variant={activeTicketSegment === 'my-tickets' ? 'ticket' : 'offer'}
        title="Tickets & Offers"
        icon={<TicketIcon size={24} />}
        iconBg="rgba(107,177,255,0.10)"
        iconColor="var(--color-accent-1)"
        linkLabel="All"
        onLinkClick={handleTicketLinkClick}
        loading={loading}
        skeletonCount={4}
        enableDragScroll
        showArrows
        segments={ticketSegments}
        activeSegment={activeTicketSegment}
        onSegmentChange={(id) => setActiveTicketSegment(id as 'my-tickets' | 'my-offers')}
        infoCards={ticketItems.length > 0 ? ticketInfoCards : undefined}
        infoCardCompact
        onCardClick={handleTicketCardClick}
        items={ticketItemsFiat}
      >
        {ticketItems.length === 0 && (
          <>
            {emptyPlaceholders.map((g) => (
              <GuidePlaceholderCard key={g.id} topic={g.topic} icon={g.icon} text={g.text} cta={g.cta} to={g.to} mobile={isMobile} />
            ))}
          </>
        )}
      </SliderList>
    )}

    <FloatingAddButton
      offsetRight={40}
      offsetTop={130}
      actions={fabActions}
    />
    </>
  )
}