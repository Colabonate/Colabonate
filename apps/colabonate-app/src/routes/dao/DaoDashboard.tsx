import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { gsap } from 'gsap'
import HowToVoteOutlined from '@mui/icons-material/HowToVoteOutlined'
import GavelOutlined from '@mui/icons-material/GavelOutlined'
import BalanceOutlined from '@mui/icons-material/BalanceOutlined'
import LockOutlined from '@mui/icons-material/LockOutlined'
import ArrowForward from '@mui/icons-material/ArrowForward'
import { Card, CardContent, CardActionArea, Typography, Box, Chip } from '@mui/material'
import {
  Vote, Users, Wallet, Plus, ChevronLeft, ChevronRight,
  Inbox, Search, TrendingUp, Rows3, PanelLeft, X, Filter,
  MessageSquare, CheckCircle,
} from 'lucide-react'
import { ListHeader } from '@ds/ui'
import { SearchInput } from '../../components/ui/SearchInput'
import { NotFoundState } from '../../components/NotFoundState'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useTranslation } from '../../contexts/LocaleContext'
import { FiatHint } from '../../components/currency/FiatHint'
import {
  DaoGalleryCard, DaoListRow, DaoEmptyState, DaoSizeToggle,
  DaoDemoProposal, DaoDetailPanel,
  proposalToListItem, memberToListItem,
  type DaoListItem, type CardSize,
} from './dao-cards'
import { useDaoLayoutData } from './DaoLayout'

type ViewMode = 'gallery' | 'list'
type SortOption = 'newest' | 'name' | 'status'
type ListTab = 'proposals' | 'members'
type ProposalFilter = '' | 'ACTIVE' | 'COMMENT_PERIOD' | 'PASSED' | 'REJECTED' | 'DRAFT' | 'EXECUTED'

interface ProposalFilterOption {
  key: ProposalFilter
  label: string
  icon: React.ReactNode
  color: string
  bg: string
}

const PROPOSAL_FILTERS: ProposalFilterOption[] = [
  { key: '', label: 'All Proposals', icon: <Inbox size={12} />, color: 'var(--theme-text)', bg: 'var(--theme-bg-subtle)' },
  { key: 'ACTIVE', label: 'Active', icon: <Vote size={12} />, color: 'var(--color-primary-50)', bg: 'rgba(99,179,237,0.10)' },
  { key: 'COMMENT_PERIOD', label: 'Comment Period', icon: <MessageSquare size={12} />, color: 'var(--color-secondary-50)', bg: 'rgba(159,122,234,0.10)' },
  { key: 'PASSED', label: 'Passed', icon: <TrendingUp size={12} />, color: 'var(--color-status-success)', bg: 'rgba(72,187,120,0.10)' },
  { key: 'REJECTED', label: 'Rejected', icon: <X size={12} />, color: 'var(--color-status-error)', bg: 'rgba(245,101,101,0.10)' },
  { key: 'DRAFT', label: 'Draft', icon: <Filter size={12} />, color: 'var(--theme-text-muted)', bg: 'var(--theme-bg-subtle)' },
  { key: 'EXECUTED', label: 'Executed', icon: <CheckCircle size={12} />, color: 'var(--color-status-success)', bg: 'rgba(72,187,120,0.10)' },
]

const LIST_TABS: Array<{ key: string; label: string }> = [
  { key: 'proposals', label: 'Proposals' },
  { key: 'members', label: 'Members' },
]

const GOVERNANCE_RULES = [
  {
    icon: <HowToVoteOutlined sx={{ fontSize: 16, color: 'var(--color-primary-50)' }} />,
    title: 'Voting Rights',
    description: '1P1V, Token-Weighted, and Reputation-Weighted models. Quorum and majority thresholds apply per proposal type.',
    hoverBorder: 'var(--color-primary-50)',
    shadow: 'rgba(99,179,237,0.08)',
    iconBg: 'rgba(99,179,237,0.1)',
  },
  {
    icon: <GavelOutlined sx={{ fontSize: 16, color: 'var(--color-secondary-50)' }} />,
    title: 'Dispute Resolution',
    description: '3-level system: Self-Resolution, Community Mediator, and DAO Court with binding arbitration.',
    hoverBorder: 'var(--color-secondary-50)',
    shadow: 'rgba(159,122,234,0.08)',
    iconBg: 'rgba(159,122,234,0.1)',
  },
  {
    icon: <BalanceOutlined sx={{ fontSize: 16, color: 'var(--color-status-success)' }} />,
    title: 'Sanctions',
    description: '3-tier escalation: Warning, Temporary Restriction, and Permanent Ban via DAO governance vote.',
    hoverBorder: 'var(--color-status-success)',
    shadow: 'rgba(72,187,120,0.08)',
    iconBg: 'rgba(72,187,120,0.1)',
  },
  {
    icon: <LockOutlined sx={{ fontSize: 16, color: 'var(--color-warning-primary)' }} />,
    title: 'Security',
    description: 'Non-custodial design. Private keys stay on-device. All governance is Nostr-signed and immutable.',
    hoverBorder: 'var(--color-warning-primary)',
    shadow: 'rgba(255,192,57,0.08)',
    iconBg: 'rgba(255,192,57,0.1)',
  },
]

export function DaoDashboard() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { formatNumber, formatTime } = useTranslation()
  const { isMobile } = useBreakpoint()
  const { dao, proposals, members, treasuryBalance, loading } = useDaoLayoutData()

  const [listTab, setListTab] = useState<ListTab>('proposals')
  const [proposalFilter, setProposalFilter] = useState<ProposalFilter>('')
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('daoDashboard_viewMode')
    return (saved === 'list' || saved === 'gallery') ? saved : 'gallery'
  })
  const [cardSize, setCardSize] = useState<CardSize>(() => {
    const saved = localStorage.getItem('daoDashboard_cardSize')
    return (saved === 'S' || saved === 'M' || saved === 'L') ? saved : 'M'
  })
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [panelMode, setPanelMode] = useState<'sidebar' | 'top'>('sidebar')
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => {
    const stored = sessionStorage.getItem('daoDashboard_pageSize')
    return stored ? Number(stored) : 10
  })

  const listRef = useRef<HTMLDivElement>(null)
  const containerRef = usePageAnimation([
    { selector: '.dashboard-animate', from: { duration: 0.5, stagger: 0.1, y: 20 } },
  ])

  const effectivePanelMode = isMobile ? 'top' : panelMode

  useEffect(() => {
    if (isMobile) setSidebarOpen(true)
  }, [isMobile])

  useEffect(() => {
    if (loading || !listRef.current) return
    const ctx = gsap.from('.dao-list-item-animate', {
      y: 20, opacity: 0, duration: 0.4, stagger: 0.06, ease: 'power2.out', clearProps: 'all',
    })
    return () => { ctx.revert() }
  }, [loading, listTab, proposalFilter, viewMode, page])

  useEffect(() => { setPage(1); setSelectedItemId(null) }, [proposalFilter, activeQuery, sortBy, listTab, pageSize])

  const allItems = useMemo((): DaoListItem[] => {
    let items: DaoListItem[]

    if (listTab === 'members') {
      items = members.map(memberToListItem)
    } else {
      let filtered = proposals
      if (proposalFilter) {
        filtered = filtered.filter(p => p.status === proposalFilter)
      }
      items = filtered.map(p => proposalToListItem(p, id!))
    }

    if (activeQuery.trim()) {
      const q = activeQuery.toLowerCase()
      items = items.filter(i =>
        i.title.toLowerCase().includes(q) ||
        i.subtitle.toLowerCase().includes(q)
      )
    }

    if (sortBy === 'name') {
      items = [...items].sort((a, b) => a.title.localeCompare(b.title))
    } else if (sortBy === 'status') {
      items = [...items].sort((a, b) => a.status.localeCompare(b.status))
    }

    return items
  }, [proposals, members, listTab, proposalFilter, activeQuery, sortBy, id])

  useEffect(() => {
    if (isMobile || allItems.length === 0) return
    if (!selectedItemId || !allItems.find(i => i.id === selectedItemId)) {
      setSelectedItemId(allItems[0].id)
    }
  }, [allItems, selectedItemId, isMobile])

  const totalPages = Math.max(1, Math.ceil(allItems.length / pageSize))
  const paginatedItems = useMemo(
    () => allItems.slice((page - 1) * pageSize, page * pageSize),
    [allItems, page, pageSize],
  )

  const selectedItem = useMemo(
    () => allItems.find(i => i.id === selectedItemId) ?? null,
    [allItems, selectedItemId],
  )

  function handleSearch() { setActiveQuery(query) }
  function handleClear() { setQuery(''); setActiveQuery('') }
  function handleViewModeChange(mode: ViewMode) {
    setViewMode(mode)
    localStorage.setItem('daoDashboard_viewMode', mode)
  }
  function handleCardSizeChange(size: CardSize) {
    setCardSize(size)
    localStorage.setItem('daoDashboard_cardSize', size)
  }
  function handlePanelToggle() {
    setPanelMode(m => m === 'sidebar' ? 'top' : 'sidebar')
    setSidebarOpen(true)
  }
  function handleItemClick(item: DaoListItem) {
    if (isMobile) {
      navigate(item.detailPath)
    } else {
      setSelectedItemId(item.id)
    }
  }

  const galleryCols = cardSize === 'S' ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
    : cardSize === 'L' ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
    : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4'

  if (loading && !dao) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div
            className="w-12 h-12 mx-auto mb-4 border-4 rounded-full border-t-transparent animate-spin"
            style={{ borderColor: 'var(--color-primary-50) var(--color-primary-50) var(--color-primary-50) transparent' }}
          />
          <p style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
            Loading DAO dashboard...
          </p>
        </div>
      </div>
    )
  }

  if (!dao) {
    return (
      <NotFoundState
        icon={<HowToVoteOutlined sx={{ fontSize: { xs: 44, sm: 52 } }} />}
        title="DAO not found"
        message="This DAO may have been removed, or the link is incorrect."
        detail={id ? `DAO ${id}` : undefined}
        primary={{ label: 'Back to DAOs', to: '/dao' }}
        secondary={{ label: 'Go back', onClick: () => navigate(-1) }}
      />
    )
  }

  return (
    <>
    <div ref={containerRef} className="space-y-6 dashboard-animate">

        <Box>
          <Box className="flex items-center justify-between mb-3">
            <Typography
              sx={{
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--theme-text-muted)',
                fontFamily: 'var(--typography-fontfamily-sans)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              Governance Rules
            </Typography>
            <Link to="/about/foundation" style={{ textDecoration: 'none' }}>
              <Chip
                label="View Full Rules"
                size="small"
                icon={<ArrowForward sx={{ fontSize: 12 }} />}
                sx={{
                  fontSize: '11px',
                  fontWeight: 600,
                  height: '24px',
                  borderRadius: '8px',
                  color: 'var(--color-accent-1)',
                  borderColor: 'var(--color-accent-1)',
                  backgroundColor: 'rgba(99,179,237,0.08)',
                  border: '1px solid',
                  '& .MuiChip-icon': { color: 'var(--color-accent-1)' },
                  '&:hover': { backgroundColor: 'rgba(99,179,237,0.15)' },
                }}
              />
            </Link>
          </Box>

          <Box className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {GOVERNANCE_RULES.map((rule) => (
              <Card
                key={rule.title}
                variant="outlined"
                sx={{
                  borderRadius: '12px',
                  borderColor: 'var(--theme-border)',
                  backgroundColor: 'var(--theme-surface)',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    borderColor: rule.hoverBorder,
                    boxShadow: `0 2px 12px ${rule.shadow}`,
                  },
                }}
              >
                <CardActionArea
                  component={Link}
                  to="/about/foundation"
                  sx={{
                    borderRadius: '12px',
                    '&:hover .MuiCardActionArea-focusHighlight': { opacity: 0 },
                  }}
                >
                  <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
                    <Box className="flex items-center gap-2 mb-1.5">
                      <Box
                        sx={{
                          width: 28,
                          height: 28,
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: rule.iconBg,
                        }}
                      >
                        {rule.icon}
                      </Box>
                      <Typography
                        sx={{
                          fontSize: '12px',
                          fontWeight: 600,
                          color: 'var(--theme-text)',
                          fontFamily: 'var(--typography-fontfamily-sans)',
                        }}
                      >
                        {rule.title}
                      </Typography>
                    </Box>
                    <Typography
                      sx={{
                        fontSize: '11px',
                        lineHeight: 1.5,
                        color: 'var(--theme-text-muted)',
                        fontFamily: 'var(--typography-fontfamily-sans)',
                      }}
                    >
                      {rule.description}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Box>
        </Box>

        <div className="flex flex-col gap-3 mt-4">
          <div className="flex" style={{ gap: effectivePanelMode === 'sidebar' && sidebarOpen ? 16 : 0, transition: 'gap 0.3s ease' }}>
            {effectivePanelMode === 'sidebar' && (
              <div
                className="sticky self-start overflow-hidden transition-all duration-300 shrink-0 top-25"
                style={{ width: sidebarOpen ? 215 : 0, opacity: sidebarOpen ? 1 : 0 }}
              >
                <div
                  className="flex flex-col p-3 overflow-y-auto rounded-xl"
                  style={{
                    background: 'var(--theme-surface)',
                    border: '1px solid var(--theme-border)',
                    maxHeight: 'calc(100vh - 84px)',
                  }}
                >
                  {listTab === 'proposals' && (
                    <div className="pb-3 mb-3" style={{ borderBottom: '1px solid var(--theme-border)' }}>
                      <div
                        className="text-[10px] font-bold uppercase tracking-wider mb-2 px-1"
                        style={{ color: 'var(--theme-text-muted)' }}
                      >
                        Proposal Status
                      </div>
                      <div className="flex flex-col gap-0.5">
                        {PROPOSAL_FILTERS.map(f => (
                          <button
                            key={f.key}
                            onClick={() => { setProposalFilter(f.key); setSelectedItemId(null) }}
                            className="flex items-center gap-2 text-left px-2 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition-colors duration-100"
                            style={{
                              background: proposalFilter === f.key ? f.bg : 'transparent',
                              color: proposalFilter === f.key ? f.color : 'var(--theme-text-muted)',
                              border: 'none',
                            }}
                          >
                            <span style={{ opacity: 0.8, flexShrink: 0 }}>{f.icon}</span>
                            {f.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pb-3 mb-3" style={{ borderBottom: '1px solid var(--theme-border)' }}>
                    <div
                      className="text-[10px] font-bold uppercase tracking-wider mb-2 px-1"
                      style={{ color: 'var(--theme-text-muted)' }}
                    >
                      Community
                    </div>
                    <button
                      onClick={() => { setListTab('members'); setProposalFilter(''); setSelectedItemId(null) }}
                      className="flex items-center gap-2 text-left px-2 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition-colors duration-100 w-full"
                      style={{
                        background: listTab === 'members' ? 'rgba(157,123,237,0.10)' : 'transparent',
                        color: listTab === 'members' ? 'var(--color-secondary-50)' : 'var(--theme-text-muted)',
                        border: 'none',
                      }}
                    >
                      <Users size={12} style={{ opacity: 0.8, flexShrink: 0 }} />
                      Members ({members.length})
                    </button>
                  </div>

                  <div>
                    <div
                      className="text-[10px] font-bold uppercase tracking-wider mb-2 px-1"
                      style={{ color: 'var(--theme-text-muted)' }}
                    >
                      Treasury
                    </div>
                    <div
                      className="flex flex-col items-center gap-1 p-3 rounded-lg"
                      style={{ background: 'rgba(255,192,57,0.06)' }}
                    >
                      <Wallet size={16} style={{ color: 'var(--color-warning-primary)' }} />
                      <span
                        className="text-[16px] font-black tabular-nums"
                        style={{ color: 'var(--color-primary-50)' }}
                      >
                        {formatNumber(Number(treasuryBalance))}
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>sats</span>
                      <FiatHint sats={Number(treasuryBalance)} className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-col flex-1 min-w-0">
              <ListHeader
                tabs={LIST_TABS}
                activeTab={listTab}
                onTabChange={(key) => {
                  setListTab(key as ListTab)
                  setProposalFilter('')
                  setSelectedItemId(null)
                }}
                actions={[
                  ...(!isMobile ? [{
                    key: 'panel-toggle',
                    element: (
                      <button
                        onClick={handlePanelToggle}
                        className="flex items-center justify-center transition-all duration-150 rounded-lg cursor-pointer"
                        style={{
                          width: 36, height: 36,
                          background: panelMode === 'top' ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
                          color: panelMode === 'top' ? 'white' : 'var(--theme-text-muted)',
                          border: panelMode === 'top' ? 'none' : '1px solid var(--theme-border)',
                        }}
                        title={panelMode === 'sidebar' ? 'Show categories on top' : 'Show categories on left'}
                      >
                        {panelMode === 'sidebar' ? <Rows3 size={16} /> : <PanelLeft size={16} />}
                      </button>
                    ),
                  }] : []),
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
                        placeholder="Search proposals…"
                        autoFocus
                        ariaLabel="Search proposals"
                      />
                    ),
                  },
                  {
                    key: 'sort',
                    element: (
                      <select
                        value={sortBy}
                        onChange={e => setSortBy(e.target.value as SortOption)}
                        className="rounded-lg outline-none cursor-pointer"
                        style={{
                          fontSize: 12, height: 36, padding: '0 10px',
                          background: 'var(--theme-bg-subtle)',
                          color: 'var(--theme-text-muted)',
                          border: '1px solid var(--theme-border)',
                          minWidth: 100,
                        }}
                      >
                        <option value="newest">Newest</option>
                        <option value="name">Name A–Z</option>
                        <option value="status">Status</option>
                      </select>
                    ),
                  },
                  {
                    key: 'size',
                    element: <DaoSizeToggle size={cardSize} onChange={handleCardSizeChange} />,
                  },
                ]}
                viewMode={viewMode}
                onViewModeChange={handleViewModeChange}
                mt={0}
              />

              {activeQuery && (
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <div
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg"
                    style={{ background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.20)' }}
                  >
                    <Search size={11} style={{ color: 'var(--color-primary-50)' }} />
                    <span className="text-[11px]" style={{ color: 'var(--color-primary-50)' }}>
                      "{activeQuery}"
                    </span>
                    <button
                      onClick={handleClear}
                      className="cursor-pointer"
                      style={{ background: 'none', border: 'none', padding: 1 }}
                      aria-label="Clear search"
                    >
                      <X size={11} style={{ color: 'var(--color-primary-50)' }} />
                    </button>
                  </div>
                  <span className="text-[11px] ml-1" style={{ color: 'var(--theme-text-muted)' }}>
                    {allItems.length} result{allItems.length !== 1 ? 's' : ''}
                  </span>
                </div>
              )}

              <div className="flex gap-4 mt-3">
                <div className="flex-1 min-w-0">
                  {loading ? (
                    viewMode === 'gallery' ? (
                      <div className={`grid gap-2 ${galleryCols}`}>
                        {Array.from({ length: 6 }).map((_, i) => (
                          <div
                            key={i}
                            className="rounded-xl animate-pulse"
                            style={{
                              height: cardSize === 'S' ? 130 : cardSize === 'L' ? 220 : 170,
                              background: 'var(--theme-surface-secondary)',
                              border: '1px solid var(--theme-border)',
                            }}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {Array.from({ length: 6 }).map((_, i) => (
                          <div
                            key={i}
                            className="rounded-xl animate-pulse"
                            style={{
                              height: 62,
                              background: 'var(--theme-surface-secondary)',
                              border: '1px solid var(--theme-border)',
                            }}
                          />
                        ))}
                      </div>
                    )
                  ) : listTab === 'proposals' && proposals.length === 0 && !activeQuery && !proposalFilter ? (
                    <div className="flex flex-col gap-3">
                      <DaoDemoProposal daoId={id!} />
                    </div>
                  ) : allItems.length === 0 ? (
                    <DaoEmptyState
                      message={activeQuery ? 'No results found.' : `No ${listTab} found.`}
                      sub={activeQuery ? 'Try clearing some filters.' : undefined}
                    />
                  ) : viewMode === 'gallery' ? (
                    <div ref={listRef} className={`grid gap-2 ${galleryCols}`}>
                      {paginatedItems.map(item => (
                        <div key={item.id} className="dao-list-item-animate">
                          <DaoGalleryCard
                            item={item}
                            size={cardSize}
                            selected={selectedItemId === item.id}
                            onSelect={!isMobile ? () => handleItemClick(item) : undefined}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div ref={listRef} className="flex flex-col gap-1.5">
                      {paginatedItems.map(item => (
                        <div key={item.id} className="dao-list-item-animate">
                          <DaoListRow
                            item={item}
                            size={cardSize}
                            selected={selectedItemId === item.id}
                            onSelect={!isMobile ? () => handleItemClick(item) : undefined}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {!loading && allItems.length > 0 && (
                    <div
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 mt-3 shrink-0 rounded-xl"
                      style={{
                        color: 'var(--theme-text-muted)',
                        background: 'var(--theme-surface)',
                        border: '1px solid var(--theme-border)',
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[11px]">Show</span>
                        <select
                          value={pageSize}
                          onChange={e => {
                            const size = Number(e.target.value)
                            sessionStorage.setItem('daoDashboard_pageSize', String(size))
                            setPageSize(size)
                          }}
                          className="text-[11px] rounded-md px-1.5 py-1 cursor-pointer"
                          style={{
                            background: 'var(--theme-bg-subtle)',
                            border: '1px solid var(--theme-border)',
                            color: 'var(--theme-text)',
                          }}
                        >
                          {[5, 10, 20, 50].map(n => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                        <span className="text-[11px]">per page</span>
                      </div>

                      <span className="text-[11px]">
                        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, allItems.length)} of {allItems.length}
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

                {!isMobile && (
                  <div
                    className="sticky self-start shrink-0 top-25"
                    style={{ width: 360 }}
                  >
                    <DaoDetailPanel
                      item={selectedItem}
                      daoId={id!}
                      formatTime={formatTime}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={() => navigate(`/dao/${id}/proposals/new`)}
        aria-label="Create new proposal"
        className="fixed z-50 flex items-center justify-center transition-all duration-200 rounded-full cursor-pointer shrink-0 hover:scale-105 active:scale-95"
        style={{
          ...(isMobile
            ? { bottom: 'calc(58px + env(safe-area-inset-bottom, 0px) + 12px)', top: 'auto' }
            : { top: 130, bottom: 'auto' }),
          right: isMobile ? 12 : 40,
          width: isMobile ? 48 : 56,
          height: isMobile ? 48 : 56,
          background: 'rgba(157, 123, 237,0.95)',
          boxShadow: '0 8px 20px rgba(159,122,234,0.45), 0 4px 8px rgba(0,0,0,0.35)',
        }}
      >
        <Plus size={isMobile ? 20 : 24} color="white" />
      </button>
    </>
  )
}
