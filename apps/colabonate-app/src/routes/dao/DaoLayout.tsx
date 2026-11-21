import { useState, useEffect, useCallback, useMemo, createContext, useContext } from 'react'
import { useNavigate, useLocation, useParams, Outlet, Link } from 'react-router-dom'
import { Tabs, Tab, Box, IconButton } from '@mui/material'
import { PageContainer } from '@ds/ui'
import { KPIStrip } from '../../components/kpi/KpiStrip'
import type { KPIItem } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { apiCall } from '../../lib/api'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { useTranslation } from '../../contexts/LocaleContext'
import { Vote, Gavel, Users, Settings, Shield, HelpCircle, Inbox, Wallet, FileText, User } from 'lucide-react'
import type { Dao, Proposal } from './dao-types'
import type { DaoMember } from '../council/council-types'

interface DaoLayoutContextValue {
  dao: Dao | null
  proposals: Proposal[]
  members: DaoMember[]
  treasuryBalance: bigint
  loading: boolean
}

const DaoLayoutContext = createContext<DaoLayoutContextValue>({
  dao: null,
  proposals: [],
  members: [],
  treasuryBalance: 0n,
  loading: true,
})

export function useDaoLayoutData() {
  return useContext(DaoLayoutContext)
}

const DAO_TABS = [
  { label: 'Profile', icon: <User size={16} /> },       // 0  → /dao/:id/profile (ADR-200)
  { label: 'Dashboard', icon: <Vote size={16} /> },     // 1  → /dao/:id  (index)
  { label: 'Council', icon: <Gavel size={16} /> },      // 2  → /dao/:id/council
  { label: 'Members', icon: <Users size={16} /> },      // 3  → /dao/:id/admin
  { label: 'Config', icon: <Settings size={16} /> },    // 4  → /dao/:id/admin/config
  { label: 'Bootstrap', icon: <Shield size={16} /> },   // 5  → /dao/:id/admin/bootstrap
  { label: 'Governance', icon: <Settings size={16} /> },// 6  → /dao/:id/admin/governance
  { label: 'Codex', icon: <FileText size={16} /> },     // 7  → /dao/:id/codex-settings
]

export function DaoLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams<{ id: string }>()
  const { formatNumber } = useTranslation()

  const [daoName, setDaoName] = useState('DAO Governance')
  const [dao, setDao] = useState<Dao | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [members, setMembers] = useState<DaoMember[]>([])
  const [treasuryBalance, setTreasuryBalance] = useState<bigint>(0n)
  const [loading, setLoading] = useState(true)

  const containerRef = usePageAnimation([
    { selector: '.dao-layout-animate', from: { duration: 0.4, stagger: 0.08, y: 16 } },
  ])

  const fetchData = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const [daosData, proposalsData, treasuryData, membersData] = await Promise.all([
        apiCall('/api/daos').then(r => r.json()).catch(() => ({ daos: [] })),
        apiCall(`/api/daos/${id}/proposals`).then(r => r.json()).catch(() => ({ proposals: [] })),
        apiCall(`/api/daos/${id}/treasury`).then(r => r.json()).catch(() => ({ treasury: null })),
        apiCall('/api/dao/foundation/members').then(r => r.json()).catch(() => ({ members: [] })),
      ])

      const foundDao = (daosData.daos || []).find((d: Dao) => d.id === id)
      if (foundDao) {
        setDao(foundDao)
        setDaoName(foundDao.name)
      } else if (id === 'colabonate-foundation') {
        setDaoName('Colabonate Foundation')
      }
      setProposals(proposalsData.proposals || [])
      if (treasuryData.treasury) {
        setTreasuryBalance(BigInt(treasuryData.treasury.balanceSats))
      }
      setMembers(membersData.members || [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchData() }, [fetchData])

  const activeProposals = useMemo(() => proposals.filter(p => p.status === 'ACTIVE'), [proposals])

  const kpiItems = useMemo((): KPIItem[] => [
    { icon: <Inbox size={14} />, value: proposals.length, label: 'Total Proposals', heading: 'Overview' },
    { icon: <Vote size={14} />, value: activeProposals.length, label: 'Active Votes', color: 'var(--color-status-success)' },
    { icon: <Users size={14} />, value: dao?._count.members ?? members.length, label: 'Members' },
    { icon: <Wallet size={14} />, value: formatNumber(Number(treasuryBalance)), label: 'Treasury (sats)', color: 'var(--color-warning-primary)' },
    { separator: true, heading: 'Config', value: dao?.governanceConfig?.quorumThreshold ?? '—', label: 'Quorum', tooltip: 'Minimum votes required for proposal validity' },
  ], [proposals.length, activeProposals.length, dao, members.length, treasuryBalance, formatNumber])

  const contextValue = useMemo<DaoLayoutContextValue>(() => ({
    dao, proposals, members, treasuryBalance, loading,
  }), [dao, proposals, members, treasuryBalance, loading])

  const isTabRoute = useMemo(() => {
    const { pathname } = location
    return !pathname.includes('/proposals/') && !pathname.includes('/disputes/')
  }, [location])

  const getActiveTab = useCallback((): number | false => {
    const { pathname } = location
    if (pathname.includes('/admin/bootstrap')) return 5
    if (pathname.includes('/admin/governance')) return 6
    if (pathname.includes('/admin/config')) return 4
    if (pathname.includes('/admin')) return 3
    if (pathname.includes('/council')) return 2
    if (pathname.includes('/codex-settings')) return 7
    if (pathname.includes('/profile')) return 0
    if (pathname.match(/^\/dao\/[^/]+$/)) return 1
    if (pathname.includes('/proposals/')) return false
    return 1
  }, [location])

  const activeTab = getActiveTab()

  function getTabRoute(tabIndex: number): string {
    const base = `/dao/${id}`
    switch (tabIndex) {
      case 0: return `${base}/profile`
      case 1: return base
      case 2: return `${base}/council`
      case 3: return `${base}/admin`
      case 4: return `${base}/admin/config`
      case 5: return `${base}/admin/bootstrap`
      case 6: return `${base}/admin/governance`
      case 7: return `${base}/codex-settings`
      default: return base
    }
  }

  const tabsNode = useMemo(() => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, borderBottom: '1px solid var(--theme-border)', paddingBottom: 0 }}>
      <Tabs
        value={activeTab}
        onChange={(_, v: number) => navigate(getTabRoute(v))}
        sx={{
          minHeight: 36,
          '& .MuiTabs-indicator': {
            backgroundColor: 'var(--color-primary-50)',
            height: 2,
            borderRadius: 1,
          },
          '& .MuiTab-root': {
            minHeight: 36,
            px: 2,
            py: 0.5,
            fontSize: '12px',
            fontWeight: 600,
            fontFamily: 'var(--typography-fontfamily-sans)',
            textTransform: 'none',
            color: 'var(--theme-text-muted)',
            gap: 0.5,
            '&.Mui-selected': {
              color: 'var(--color-primary-50)',
            },
          },
        }}
      >
        {DAO_TABS.map((tab, i) => (
          <Tab
            key={tab.label}
            icon={tab.icon}
            iconPosition="start"
            label={tab.label}
            value={i}
          />
        ))}
      </Tabs>

      <IconButton
        component={Link}
        to="/help/dao-governance"
        size="small"
        sx={{
          color: 'var(--theme-text-muted)',
          '&:hover': { color: 'var(--color-primary-50)' },
        }}
      >
        <HelpCircle size={16} />
      </IconButton>
    </Box>
  ), [activeTab, navigate, getTabRoute])

  return (
    <DaoLayoutContext.Provider value={contextValue}>
      <PageContainer size="wide" spacing="lg" className="pt-0!" ref={containerRef}>
        {isTabRoute && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4 items-center">
              <PageHeader
                icon={<Vote size={20} />}
                title={daoName}
                subtitle="DAO Governance"
                onBack={() => navigate('/')}
                compact
                shrink
              />
              <KPIStrip
                items={kpiItems}
                loading={loading}
                skeletonCount={4}
                wrap
                collapsible
                storageKey="kpi-dao-dashboard"
              />
            </div>
            {tabsNode}
          </>
        )}

        <Outlet />
      </PageContainer>
    </DaoLayoutContext.Provider>
  )
}
