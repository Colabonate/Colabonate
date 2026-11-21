import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Settings, Briefcase, Bot, Target, Layers } from 'lucide-react'
import { PageContainer, FloatingAddButton } from '@ds/ui'
import { KPIStrip } from '../../../components/kpi/KpiStrip'
import { PageHeader } from '../../../components/PageHeader'
import { Seo } from '../../../components/Seo'
import { SubTabPill } from '../../../components/SubTabPill'
import { useFABActions } from '../../../context/FABContext'
import { useShellKpiStrip } from '../../../hooks/useShellKpiStrip'
import type { CoopTab } from '../../sell/sell.types'
import { CoopOffers } from '../CoopOffers'
import { AllTab } from './AllTab'
import { ServicesTab } from './ServicesTab'
import { AgentStackTab } from './AgentStackTab'
import { BountiesTab } from './BountiesTab'

const TABS: { key: CoopTab; label: string; icon: React.ReactNode }[] = [
  { key: 'all', label: 'All', icon: <Layers size={14} /> },
  { key: 'cooperations', label: 'Cooperations', icon: <Settings size={14} /> },
  { key: 'services', label: 'Services', icon: <Briefcase size={14} /> },
  { key: 'stack', label: 'Agent Stack', icon: <Bot size={14} /> },
  { key: 'bounties', label: 'Bounties', icon: <Target size={14} /> },
]

// URL `?tab=` guard — invalid or missing params fall back to the combined
// overview ('all'), the default tab since the All-tab addition.
function isCoopTab(value: string | null): value is CoopTab {
  return value === 'all' || value === 'cooperations' || value === 'services' || value === 'stack' || value === 'bounties'
}

export function CoopManage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const pubkey = localStorage.getItem('pubkey') ?? ''
  const { actions: fabActions } = useFABActions()

  const tabParam = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState<CoopTab>(
    isCoopTab(tabParam) ? tabParam : 'all',
  )

  // Bug fix: React Router doesn't remount this component when navigating
  // between /coop/manage?tab=X and ?tab=Y from the Cooperate subnav (same
  // route pattern) — it only re-renders with new searchParams. The useState
  // initializer above only ran once at first mount, so `activeTab` (and every
  // tab's own URL-driven filter) got silently stuck on whichever tab the page
  // first mounted with. This effect makes the URL the source of truth for
  // every subsequent navigation too.
  useEffect(() => {
    const t = searchParams.get('tab')
    const next = isCoopTab(t) ? t : 'all'
    setActiveTab(prev => (prev === next ? prev : next))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const { items: kpiItems, loading: kpiLoading, handleKpiChange } = useShellKpiStrip()

  function handleTabChange(tab: CoopTab) {
    setActiveTab(tab)
    setSearchParams(p => { p.set('tab', tab); return p }, { replace: true })
  }

  const tabPill = (
    <SubTabPill
      tabs={TABS}
      active={activeTab}
      onChange={handleTabChange}
      ariaLabel="Cooperate manage section"
    />
  )

  if (!pubkey) {
    return (
      <PageContainer size="wide" spacing="lg" className="pt-0!">
        <PageHeader icon={<Settings size={18} />} title="Manage" subtitle="Manage cooperations, service offers, agent stack and bounties" onBack={() => navigate('/coop')} />
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
      {/* gap="none" + explicit section margins mirrors BountyBoard/SellListings
          (user feedback 2026-08-24): top edge flush (pt-0!), KPI strip 8px
          (mb-2) above the subtab pill — the default PageContainer gap
          (24/32px) had each section floating too far apart. */}
      <PageContainer size="wide" spacing="lg" gap="none" className="pt-0!">
        <Seo noindex path="/coop/manage" />
        <PageHeader
          icon={<Settings size={18} />}
          title="Manage"
          subtitle="Cooperations, service offers, agent stack and bounties"
          onBack={() => navigate('/coop')}
        />

        <KPIStrip items={kpiItems} loading={kpiLoading} skeletonCount={6} wrap collapsible storageKey="kpi-coop-manage" className="mb-2" />

        {/* Sub-tab pill — threaded into the active tab so it renders in ONE
            line with the tab's ListHeader on desktop (>=600px) and stacked
            above it on mobile (ListBrowser's headerPrefix slot). Identical
            control as SellListings' sub-tab pill (shared SubTabPill). */}
        <main>
          {/* Only the active tab is mounted so each registers its own FAB actions */}
          {activeTab === 'all' && <AllTab pubkey={pubkey} onKpiChange={handleKpiChange} headerPrefix={tabPill} />}
          {activeTab === 'cooperations' && <CoopOffers pubkey={pubkey} onKpiChange={handleKpiChange} headerPrefix={tabPill} />}
          {activeTab === 'services' && <ServicesTab pubkey={pubkey} onKpiChange={handleKpiChange} headerPrefix={tabPill} />}
          {activeTab === 'stack' && <AgentStackTab pubkey={pubkey} onKpiChange={handleKpiChange} headerPrefix={tabPill} />}
          {activeTab === 'bounties' && <BountiesTab pubkey={pubkey} onKpiChange={handleKpiChange} headerPrefix={tabPill} />}
        </main>
      </PageContainer>

      <FloatingAddButton offsetRight={40} offsetTop={130} actions={fabActions} />
    </>
  )
}
