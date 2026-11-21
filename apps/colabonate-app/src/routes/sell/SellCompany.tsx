import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Building2, FileText, MapPin, Package, Layers, Tag, Briefcase, Star, TrendingUp, ShoppingCart, Zap, Users, Users2, Folder, Radio } from 'lucide-react'
import { PageContainer } from '@ds/ui'
import { KPIStrip } from '../../components/kpi/KpiStrip'
import { PageHeader } from '../../components/PageHeader'
import { apiCall } from '../../lib/api'
import { formatSatsNumber } from '../../lib/currency'
import { useCurrency } from '../../contexts/CurrencyContext'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { CompanyBlock } from '../../components/profile/CompanyBlock'
import { EntityContentList } from '../../components/profile/EntityContentList'
import { useEntityOwnedContent } from '../../hooks/useEntityOwnedContent'
import type { Company, Ticket } from '../../types/api'

interface CompanyKPIStats {
  totalCatalogs: number
  totalProducts: number
  totalListings: number
  totalServices: number
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


export function SellCompany() {
  const navigate = useNavigate()
  const { satsToFiat, formatFiat } = useCurrency()
  const [pubkey] = useState(() => localStorage.getItem('pubkey') ?? '')
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [kpiStats, setKpiStats] = useState<CompanyKPIStats | null>(null)
  const [kpiLoading, setKpiLoading] = useState(true)
  const pageRef = usePageAnimation([
    { selector: '.company-animate', from: { duration: 0.5, stagger: 0.12, y: 24 } },
  ])

  const refreshCompany = useCallback(async (silent = false) => {
    if (!pubkey) {
      setLoading(false)
      setKpiLoading(false)
      return
    }
    if (!silent) {
      setLoading(true)
      setKpiLoading(true)
    }
    try {
      const [companyRes, offersRes, reviewsRes, ticketsRes] = await Promise.all([
        apiCall(`/api/company/${pubkey}`).then(r => r.json()).catch(() => ({ company: null })),
        // Perf fix (2026-10-02): only offerType is read below (counts) — slim=1
        // skips the raw images/description/milestone payload (see SellDashboard.tsx).
        apiCall(`/api/offers?creatorPubkey=${pubkey}&slim=1`).then(r => r.json()).catch(() => ({ offers: [] })),
        apiCall(`/api/reviews/${pubkey}`).then(r => r.json()).catch(() => ({ averageStars: 0, totalCount: 0 })),
        apiCall(`/api/tickets?pubkey=${pubkey}`).then(r => r.json()).catch(() => ({ tickets: [] })),
      ])

      const fetchedCompany: Company | null = companyRes.company || null
      setCompany(fetchedCompany)

      // Fetch catalogs with product counts once we have companyId
      let totalProducts = 0
      if (fetchedCompany?.id) {
        const catalogsRes = await apiCall(`/api/catalog?companyId=${fetchedCompany.id}`)
          .then(r => r.json())
          .catch(() => ({ catalogs: [] }))
        totalProducts = (catalogsRes.catalogs ?? []).reduce(
          (sum: number, c: { products?: unknown[] }) => sum + (c.products?.length ?? 0),
          0
        )
      }

      const offers = offersRes.offers ?? []
      const tickets: Ticket[] = ticketsRes.tickets ?? []

      const listings = offers.filter((o: { offerType?: string }) => o.offerType === 'PRODUCT')
      const services = offers.filter((o: { offerType?: string }) => o.offerType === 'SERVICE')

      const rev30d = revenueInPeriod(tickets, pubkey, 30, 0)
      const revPrev30d = revenueInPeriod(tickets, pubkey, 60, 30)
      const rev6m = revenueInPeriod(tickets, pubkey, 180, 0)
      const revPrev6m = revenueInPeriod(tickets, pubkey, 360, 180)
      const rev12m = revenueInPeriod(tickets, pubkey, 365, 0)
      const revPrev12m = revenueInPeriod(tickets, pubkey, 730, 365)

      setKpiStats({
        totalCatalogs: fetchedCompany?.catalogs?.length ?? 0,
        totalProducts,
        totalListings: listings.length,
        totalServices: services.length,
        avgRating: reviewsRes.averageStars ?? 0,
        reviewCount: reviewsRes.totalCount ?? 0,
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
      })
    } catch (error) {
      console.error('Failed to fetch company:', error)
      setCompany(null)
    } finally {
      if (!silent) {
        setLoading(false)
        setKpiLoading(false)
      }
    }
  }, [pubkey])

  useEffect(() => {
    refreshCompany()
  }, [refreshCompany])

  const kpiItems = useMemo(() => {
    const s = kpiStats

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

    return [
      {
        value: s?.totalProducts ?? 0,
        label: 'Products',
        icon: <Package size={14} />,
        heading: 'Catalog & Offers',
        tooltip: 'Total products across all catalogs – click to manage',
        onClick: () => navigate('/sell/products'),
      },
      {
        value: s?.totalCatalogs ?? 0,
        label: 'Catalogs',
        icon: <Layers size={14} />,
        tooltip: 'Product catalogs – click to manage',
        onClick: () => navigate('/sell/catalog'),
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
        tooltip: 'Active service offers',
        onClick: () => navigate('/sell/services'),
      },
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
  }, [kpiStats, navigate, satsToFiat, formatFiat])

  const actionItems = useMemo(
    () => [
      {
        title: 'Basic Data',
        description: 'Name, address, opening hours',
        icon: Building2,
        link: '/sell/company/setup',
        color: 'var(--color-primary-50)',
        bg: 'rgba(99,179,237,0.12)',
      },
      {
        title: 'Business Fields',
        description: 'Industries & cooperation radius',
        icon: MapPin,
        link: '/sell/company/fields',
        color: 'var(--color-accent-primary)',
        bg: 'rgba(245,166,35,0.12)',
      },
      {
        title: 'Terms',
        description: 'Business terms & conditions',
        icon: FileText,
        link: '/sell/company/terms',
        color: 'var(--color-info-primary)',
        bg: 'rgba(56,189,248,0.12)',
      },
      {
        title: 'Availability',
        description: 'Delivery readiness & substitution',
        icon: Radio,
        link: '/sell/company/availability',
        color: 'var(--color-secondary-50)',
        bg: 'rgba(159,122,234,0.12)',
      },
    ],
    []
  )

  // Owned content (offers + catalogs + bounties + cooperations), owner scope so
  // DRAFT/unpublished items show too — the seller manages them here. Hooks MUST
  // stay above the loading early-return.
  const { items: ownedItems, loading: ownedLoading } = useEntityOwnedContent(pubkey, company?.id, true)

  if (loading) {
    return (
      <PageContainer size="wide" spacing="lg" className="pt-0!">
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div
              className="w-12 h-12 rounded-full border-4 border-(--color-primary-50) border-t-transparent animate-spin mx-auto mb-4"
              style={{ borderColor: 'var(--color-primary-50) var(--color-primary-50) var(--color-primary-50) transparent' }}
            />
            <p className="text-(--theme-text-muted)">Loading company data...</p>
          </div>
        </div>
      </PageContainer>
    )
  }

  return (
    // gap="none" + explicit section margins mirrors BountyBoard/CoopExplore
    // (user feedback 2026-08-24): top edge flush (pt-0!), KPI strip 8px
    // (mb-2) above the content — the default PageContainer gap (24/32px) had
    // each section floating too far apart.
    <PageContainer size="wide" spacing="lg" gap="none" className="company-animate !px-4 md:!px-6 pb-6! pt-0!" ref={pageRef}>
        <PageHeader
          icon={<Building2 size={18} />}
          title="Company"
          subtitle="Manage your company profile and settings"
          onBack={() => navigate('/sell')}
        />

        <KPIStrip
          items={kpiItems}
          loading={kpiLoading}
          skeletonCount={13}
          wrap
          collapsible
          storageKey="kpi-sell-company-strip"
          className="mb-2"
        />

        {!company ? (
          <div
            className="rounded-xl border p-8 text-center max-w-150 mx-auto"
            style={{
              border: '1px solid var(--theme-border)',
              background: 'var(--theme-surface)',
            }}
          >
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ background: 'var(--theme-bg-subtle)' }}
            >
              <Building2 size={48} style={{ color: 'var(--theme-text-muted)' }} />
            </div>
            <h2
              className="text-[20px] font-semibold mb-2"
              style={{ color: 'var(--theme-text)' }}
            >
              Create Company
            </h2>
            <p
              className="mb-6 mx-auto text-[13px] leading-relaxed"
              style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
            >
              Create your company profile with all important information such as address, opening hours, and business fields.
            </p>
            <Link
              to="/sell/company/setup"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg transition-all duration-200 cursor-pointer hover:opacity-90 active:scale-95"
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
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            <div className="lg:col-span-2 order-2 lg:order-1">
              <CompanyBlock
                company={company}
                viewProfileTo={`/c/${company.id}`}
                headerBadges={
                  <span
                    className="shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider"
                    style={{
                      background: company.isActive
                        ? 'rgba(72,187,120,0.12)'
                        : 'rgba(113,128,150,0.1)',
                      color: company.isActive
                        ? 'var(--color-status-success)'
                        : 'var(--color-neutral-5)',
                      fontFamily: 'var(--typography-fontfamily-sans)',
                    }}
                  >
                    {company.isActive ? 'Active' : 'Inactive'}
                  </span>
                }
              />

              <EntityContentList items={ownedItems} loading={ownedLoading} />
            </div>

            <div className="lg:col-span-1 order-1 lg:order-2">
              <div className="lg:sticky lg:top-24 flex flex-col gap-3">
                <div
                  className="rounded-2xl border px-5 py-5"
                  style={{
                    border: '1px solid var(--theme-border)',
                    background: 'var(--theme-surface)',
                  }}
                >
                  <span className="block mb-3 text-[13px] uppercase tracking-wide font-semibold text-[var(--theme-text-muted)]">
                    Manage your company
                  </span>
                  <div className="flex flex-col gap-2">
                    {actionItems.map((item, index) => (
                      <Link
                        key={item.link + index}
                        to={item.link}
                        className="flex items-center gap-3 p-3 rounded-xl border no-underline cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
                        style={{
                          border: '1px solid var(--theme-border)',
                          background: 'var(--theme-surface-secondary)',
                        }}
                      >
                        <div
                          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                          style={{ background: item.bg }}
                        >
                          <item.icon size={18} style={{ color: item.color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3
                            className="text-[14px] font-semibold mb-0.5"
                            style={{ color: 'var(--theme-text)' }}
                          >
                            {item.title}
                          </h3>
                          <p
                            className="text-[12px] leading-relaxed truncate"
                            style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
                          >
                            {item.description}
                          </p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
    </PageContainer>
  )
}
