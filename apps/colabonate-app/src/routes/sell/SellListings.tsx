import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Package, List, BookOpen, Boxes } from 'lucide-react'
import { PageContainer, FloatingAddButton } from '@ds/ui'
import { KPIStrip } from '../../components/kpi/KpiStrip'
import { PageHeader } from '../../components/PageHeader'
import { SubTabPill } from '../../components/SubTabPill'
import { useFABActions } from '../../context/FABContext'
import { useShellKpiStrip } from '../../hooks/useShellKpiStrip'
import type { SellTab } from './sell.types'
import { ListingsTab } from './tabs/ListingsTab'
import { CatalogsTab } from './tabs/CatalogsTab'
import { ProductsTab } from './tabs/ProductsTab'

const TABS: { key: SellTab; label: string; icon: React.ReactNode }[] = [
  { key: 'listings', label: 'Listings', icon: <List size={14} /> },
  { key: 'catalogs', label: 'Catalogs', icon: <BookOpen size={14} /> },
  { key: 'products', label: 'Products', icon: <Boxes size={14} /> },
]

export function SellListings() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const pubkey = localStorage.getItem('pubkey') ?? ''
  const { actions: fabActions } = useFABActions()

  const tabParam = searchParams.get('tab') as SellTab | null
  const [activeTab, setActiveTab] = useState<SellTab>(
    tabParam === 'catalogs' || tabParam === 'products' ? tabParam : 'listings',
  )

  // Bug fix: React Router doesn't remount this component when navigating
  // between /sell/listings?tab=X and ?tab=Y from the Sell subnav (same route
  // pattern) — it only re-renders with new searchParams. The useState
  // initializer above only ran once at first mount, so `activeTab` (and every
  // tab's own URL-driven filter, e.g. ListingsTab's `?filter=agents`) got
  // silently stuck on whichever tab the page first mounted with. This effect
  // makes the URL the source of truth for every subsequent navigation too.
  useEffect(() => {
    const t = searchParams.get('tab') as SellTab | null
    const next = t === 'catalogs' || t === 'products' ? t : 'listings'
    setActiveTab(prev => (prev === next ? prev : next))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const { items: kpiItems, loading: kpiLoading, handleKpiChange } = useShellKpiStrip()

  function handleTabChange(tab: SellTab) {
    setActiveTab(tab)
    setSearchParams(p => { p.set('tab', tab); return p }, { replace: true })
  }

  const tabPill = (
    <SubTabPill
      tabs={TABS}
      active={activeTab}
      onChange={handleTabChange}
      ariaLabel="Sell section"
    />
  )

  if (!pubkey) {
    return (
      <PageContainer size="wide" spacing="lg" className="pt-0!">
        <PageHeader icon={<Package size={18} />} title="My Listings" subtitle="You must be logged in to view your listings" onBack={() => navigate('/sell')} />
        <div className="flex flex-col items-center py-16 gap-4">
          <Link to="/login" className="px-6 py-3 rounded-lg text-[14px] font-semibold transition-all duration-200 hover:opacity-90 cursor-pointer" style={{ background: 'var(--color-primary-50)', color: 'white' }}>
            Log in
          </Link>
        </div>
      </PageContainer>
    )
  }

  return (
    <>
      {/* gap="none" + explicit section margins mirrors BountyBoard/CoopExplore
          (user feedback 2026-08-24): top edge flush (pt-0!), KPI strip 8px
          (mb-2) above the subtab pill — the default PageContainer gap
          (24/32px) had each section floating too far apart. */}
      <PageContainer size="wide" spacing="lg" gap="none" className="pt-0!">
        <PageHeader
          icon={<Package size={18} />}
          title="My Listings"
          subtitle="Listings, catalogs and products"
          onBack={() => navigate('/sell')}
        />

        <KPIStrip items={kpiItems} loading={kpiLoading} skeletonCount={6} wrap collapsible storageKey="kpi-sell-listings" className="mb-2" />

        {/* Sub-tab pill — threaded into the active tab so it renders in ONE
            line with the tab's ListHeader on desktop (>=600px) and stacked
            above it on mobile (ListBrowser's headerPrefix slot). Identical
            control as BuyOrders' type pill (shared SubTabPill). */}
        <main>
          {/* Only the active tab is mounted so each registers its own FAB actions */}
          {activeTab === 'listings' && <ListingsTab pubkey={pubkey} onKpiChange={handleKpiChange} headerPrefix={tabPill} />}
          {activeTab === 'catalogs' && <CatalogsTab pubkey={pubkey} onKpiChange={handleKpiChange} headerPrefix={tabPill} />}
          {activeTab === 'products' && <ProductsTab pubkey={pubkey} onKpiChange={handleKpiChange} headerPrefix={tabPill} />}
        </main>
      </PageContainer>

      <FloatingAddButton offsetRight={40} offsetTop={130} actions={fabActions} />
    </>
  )
}
