import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  Vote, Users, Shield, TrendingUp, Inbox,
  PanelLeft, MapPin, X, SlidersHorizontal, Images, Check,
} from 'lucide-react'
import { PageContainer, ListHeader } from '@ds/ui'
import { KPIStrip } from '../../components/kpi/KpiStrip'
import type { KPIItem } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { SearchInput } from '../../components/ui/SearchInput'
import { DaoFAB, FilterFAB, FilterDrawerShell, FilterDrawerSectionLabel } from '../../components/ui'
import { cn } from '@ds/utils'
import { apiCall } from '../../lib/api'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { usePref } from '../../utils/userPreferences'
import type { Dao, DaoType, MembershipType } from './dao-types'
import {
  DAO_TYPE_META,
  MEMBERSHIP_TYPE_META,
  FOCUS_AREAS,
} from './dao-types'

// ── Types ─────────────────────────────────────────────────────────────────────

type ViewMode = 'gallery' | 'list'
type CardSize = 'S' | 'M' | 'L'
type SortOption = 'newest' | 'name' | 'members'

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'members', label: 'Most Members' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJsonField<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

function getDaoTypeBannerColor(type: DaoType | undefined): string {
  const colors: Record<string, string> = {
    COMMUNITY:  'linear-gradient(135deg, rgba(99,179,237,0.22) 0%, rgba(99,179,237,0.06) 100%)',
    PROTOCOL:   'linear-gradient(135deg, rgba(159,122,234,0.22) 0%, rgba(159,122,234,0.06) 100%)',
    INVESTMENT: 'linear-gradient(135deg, rgba(236,201,75,0.22) 0%, rgba(236,201,75,0.06) 100%)',
    SERVICE:    'linear-gradient(135deg, rgba(79,209,197,0.22) 0%, rgba(79,209,197,0.06) 100%)',
    GRANT:      'linear-gradient(135deg, rgba(72,187,120,0.22) 0%, rgba(72,187,120,0.06) 100%)',
    SOCIAL:     'linear-gradient(135deg, rgba(104,211,145,0.22) 0%, rgba(104,211,145,0.06) 100%)',
    INDUSTRY:   'linear-gradient(135deg, rgba(246,173,85,0.22) 0%, rgba(246,173,85,0.06) 100%)',
    COLLECTOR:  'linear-gradient(135deg, rgba(252,129,129,0.22) 0%, rgba(252,129,129,0.06) 100%)',
  }
  return colors[type ?? 'COMMUNITY'] ?? colors.COMMUNITY
}

// ── DAO Gallery Card ──────────────────────────────────────────────────────────

function DaoGalleryCard({ dao, size }: { dao: Dao; size: CardSize }) {
  const typeMeta = DAO_TYPE_META[dao.daoType ?? 'COMMUNITY']
  const membershipMeta = MEMBERSHIP_TYPE_META[dao.membershipType ?? 'OPEN']
  const focusAreas = parseJsonField<string[]>(dao.focusAreas, [])
  const images = parseJsonField<string[]>(dao.images, [])

  const cardHeight = size === 'S' ? 'h-[140px]' : size === 'L' ? 'h-[220px]' : 'h-[178px]'

  const locationTag = dao.isOnlineOnly
    ? '🌐 Online'
    : [dao.city, dao.country].filter(Boolean).join(', ')

  return (
    <Link
      to={`/dao/${dao.id}`}
      className={cn(
        'relative block rounded-xl overflow-hidden transition-all duration-200 hover:scale-[1.01] active:scale-[0.99]',
        cardHeight,
      )}
      style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', textDecoration: 'none' }}
    >
      {/* banner stripe / cover image */}
      {images.length > 0 ? (
        <img
          src={images[0]}
          alt=""
          className="absolute inset-x-0 top-0 h-[42px] w-full object-cover"
        />
      ) : (
        <div
          className="absolute inset-x-0 top-0 h-[42px]"
          style={{ background: getDaoTypeBannerColor(dao.daoType) }}
        />
      )}
      {images.length > 1 && (
        <span
          className="absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded text-white"
          style={{ background: 'rgba(0,0,0,0.55)', fontFamily: 'var(--typography-fontfamily-sans)' }}
        >
          <Images size={9} /> {images.length}
        </span>
      )}

      <div className="relative p-3 h-full flex flex-col gap-2">
        {/* header row */}
        <div className="flex items-start gap-2 mt-1">
          {dao.logoUrl ? (
            <img src={dao.logoUrl} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0 mt-1" />
          ) : (
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-1 text-base"
              style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
            >
              {typeMeta.emoji}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                {dao.name}
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{ background: 'var(--theme-bg-subtle)', color: typeMeta.color, fontFamily: 'var(--typography-fontfamily-sans)' }}
              >
                {typeMeta.emoji} {typeMeta.label}
              </span>
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                style={{ background: membershipMeta.bg, color: membershipMeta.color, fontFamily: 'var(--typography-fontfamily-sans)' }}
              >
                {membershipMeta.label}
              </span>
            </div>
          </div>
        </div>

        {/* description (M + L only) */}
        {size !== 'S' && dao.description && (
          <p className="text-[11px] leading-relaxed line-clamp-2" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
            {dao.description}
          </p>
        )}

        {/* focus chips (L only) */}
        {size === 'L' && focusAreas.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {focusAreas.slice(0, 3).map(tag => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* footer */}
        <div className="mt-auto flex items-center justify-between text-[11px]" style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}>
          <div className="flex items-center gap-3">
            <span style={{ color: 'var(--theme-text-muted)' }}>
              <Users size={10} className="inline mr-0.5" />
              {dao._count.members}
            </span>
            <span style={{ color: 'var(--theme-text-muted)' }}>
              <Vote size={10} className="inline mr-0.5" />
              {dao._count.proposals}
            </span>
          </div>
          {locationTag && (
            <span className="flex items-center gap-0.5 truncate max-w-[120px]" style={{ color: 'var(--theme-text-muted)' }}>
              {dao.isOnlineOnly ? null : <MapPin size={9} />}
              {locationTag}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

// ── DAO List Row ──────────────────────────────────────────────────────────────

function DaoListRow({ dao }: { dao: Dao }) {
  const typeMeta = DAO_TYPE_META[dao.daoType ?? 'COMMUNITY']
  const membershipMeta = MEMBERSHIP_TYPE_META[dao.membershipType ?? 'OPEN']
  const images = parseJsonField<string[]>(dao.images, [])
  const locationTag = dao.isOnlineOnly
    ? '🌐 Online'
    : [dao.city, dao.country].filter(Boolean).join(', ')

  return (
    <Link
      to={`/dao/${dao.id}`}
      className="flex items-center gap-3 p-3 rounded-xl transition-all duration-150 hover:opacity-80"
      style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', textDecoration: 'none' }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-base overflow-hidden"
        style={{ background: 'var(--theme-bg-subtle)' }}
      >
        {dao.logoUrl
          ? <img src={dao.logoUrl} alt="" className="w-9 h-9 rounded-lg object-cover" />
          : images.length > 0
            ? <img src={images[0]} alt="" className="w-9 h-9 rounded-lg object-cover" />
            : typeMeta.emoji}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--theme-text)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
            {dao.name}
          </span>
          <span className="text-[10px] font-bold shrink-0" style={{ color: typeMeta.color, fontFamily: 'var(--typography-fontfamily-sans)' }}>
            {typeMeta.label}
          </span>
        </div>
        {dao.description && (
          <p className="text-[11px] truncate" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
            {dao.description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0 text-[11px]" style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}>
        {locationTag && (
          <span style={{ color: 'var(--theme-text-muted)' }}>{locationTag}</span>
        )}
        <span
          className="px-1.5 py-0.5 rounded"
          style={{ background: membershipMeta.bg, color: membershipMeta.color }}
        >
          {membershipMeta.label}
        </span>
        <span style={{ color: 'var(--theme-text-muted)' }}>
          <Users size={10} className="inline mr-0.5" />{dao._count.members}
        </span>
      </div>
    </Link>
  )
}

// ── Sidebar filter ────────────────────────────────────────────────────────────

interface FilterState {
  country: string | null
  daoType: DaoType | null
  membershipType: MembershipType | null
  focusArea: string | null
  search: string
}

function DaoSidebar({
  daos,
  filters,
  onChange,
  onClose,
}: {
  daos: Dao[]
  filters: FilterState
  onChange: (f: Partial<FilterState>) => void
  onClose?: () => void
}) {
  const countries = useMemo(() => {
    const map = new Map<string, number>()
    for (const d of daos) {
      if (d.isOnlineOnly) { map.set('__online__', (map.get('__online__') ?? 0) + 1) }
      else if (d.country) { map.set(d.country, (map.get(d.country) ?? 0) + 1) }
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [daos])

  const regions = useMemo(() => {
    if (!filters.country) return []
    const seen = new Set<string>()
    for (const d of daos) {
      if (d.country === filters.country && d.region) seen.add(d.region)
    }
    return Array.from(seen).sort()
  }, [daos, filters.country])

  const sectionStyle = { color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }
  const chipBase = 'text-[11px] font-medium px-2.5 py-1 rounded-lg cursor-pointer transition-colors duration-150'

  return (
    <div className="space-y-5 text-[12px]" style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}>
      {onClose && (
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-widest" style={sectionStyle}>Filters</span>
          <button onClick={onClose}><X size={16} style={{ color: 'var(--theme-text-muted)' }} /></button>
        </div>
      )}

      {/* Location */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={sectionStyle}>Location</p>
        <div className="space-y-1">
          {countries.map(([code, count]) => {
            const isOnline = code === '__online__'
            const label = isOnline ? '🌐 Online / Global' : `${code}`
            const active = isOnline ? filters.country === '__online__' : filters.country === code
            return (
              <button
                key={code}
                onClick={() => onChange({ country: active ? null : code })}
                className={cn(chipBase, 'w-full flex items-center justify-between')}
                style={{
                  background: active ? 'rgba(99,179,237,0.12)' : 'transparent',
                  color: active ? 'var(--color-primary-50)' : 'var(--theme-text)',
                }}
              >
                <span>{label}</span>
                <span style={{ color: 'var(--theme-text-muted)' }}>{count}</span>
              </button>
            )
          })}
        </div>
        {regions.length > 0 && (
          <div className="mt-2 pl-3 space-y-1 border-l-2" style={{ borderColor: 'var(--theme-border)' }}>
            {regions.map(r => (
              <button
                key={r}
                onClick={() => onChange({ focusArea: null })}
                className="text-[11px] w-full text-left px-1 py-0.5 rounded hover:opacity-80"
                style={{ color: 'var(--theme-text-muted)' }}
              >
                {r}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* DAO Type */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={sectionStyle}>DAO Type</p>
        <div className="grid grid-cols-2 gap-1">
          {(Object.keys(DAO_TYPE_META) as DaoType[]).map(type => {
            const meta = DAO_TYPE_META[type]
            const active = filters.daoType === type
            return (
              <button
                key={type}
                onClick={() => onChange({ daoType: active ? null : type })}
                className={cn(chipBase, 'flex items-center gap-1')}
                style={{
                  background: active ? 'rgba(99,179,237,0.12)' : 'var(--theme-bg-subtle)',
                  color: active ? 'var(--color-primary-50)' : 'var(--theme-text)',
                  border: active ? '1px solid rgba(99,179,237,0.3)' : '1px solid transparent',
                }}
              >
                <span>{meta.emoji}</span>
                <span className="truncate">{meta.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Membership */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={sectionStyle}>Membership</p>
        <div className="space-y-1">
          {(Object.keys(MEMBERSHIP_TYPE_META) as MembershipType[]).map(type => {
            const meta = MEMBERSHIP_TYPE_META[type]
            const active = filters.membershipType === type
            return (
              <button
                key={type}
                onClick={() => onChange({ membershipType: active ? null : type })}
                className={cn(chipBase, 'w-full text-left')}
                style={{
                  background: active ? meta.bg : 'transparent',
                  color: active ? meta.color : 'var(--theme-text)',
                }}
              >
                {meta.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Focus Areas */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={sectionStyle}>Focus Area</p>
        <div className="flex flex-wrap gap-1">
          {FOCUS_AREAS.map(area => {
            const active = filters.focusArea === area
            return (
              <button
                key={area}
                onClick={() => onChange({ focusArea: active ? null : area })}
                className={cn(chipBase)}
                style={{
                  background: active ? 'rgba(99,179,237,0.12)' : 'var(--theme-bg-subtle)',
                  color: active ? 'var(--color-primary-50)' : 'var(--theme-text)',
                  border: active ? '1px solid rgba(99,179,237,0.3)' : '1px solid transparent',
                }}
              >
                {area}
              </button>
            )
          })}
        </div>
      </div>

      {/* Clear all */}
      {(filters.country || filters.daoType || filters.membershipType || filters.focusArea) && (
        <button
          onClick={() => onChange({ country: null, daoType: null, membershipType: null, focusArea: null })}
          className="w-full text-center text-[11px] py-1.5 rounded-lg"
          style={{ color: 'var(--color-status-error)', background: 'rgba(245,101,101,0.08)' }}
        >
          Clear all filters
        </button>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function DaoDiscovery() {
  const navigate = useNavigate()
  const [daos, setDaos] = useState<Dao[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { isDesktop } = useBreakpoint()
  const [sidebarOpen, setSidebarOpen] = usePref<boolean>('dao-discovery-sidebar', true)
  const [viewMode, setViewMode] = usePref<ViewMode>('dao-discovery-view', 'gallery')
  const [cardSize, setCardSize] = usePref<CardSize>('dao-discovery-size', 'M')
  const [sort, setSort] = useState<SortOption>('newest')
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)
  const [filterFabVisible, setFilterFabVisible] = useState(false)
  const filterMenuRef = useRef<HTMLDivElement>(null)
  const headerSentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showFilterMenu) return
    const fn = (e: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node))
        setShowFilterMenu(false)
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [showFilterMenu])

  const [filters, setFilters] = useState<FilterState>({
    country: null, daoType: null, membershipType: null, focusArea: null, search: '',
  })

  // Filter FAB appears once the header sentinel scrolls out of view (mobile/tablet
  // only — on desktop the sidebar keeps the filters permanently reachable).
  useEffect(() => {
    if (isDesktop) return
    const sentinel = headerSentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      ([entry]) => setFilterFabVisible(!entry.isIntersecting),
      { rootMargin: '-80px 0px 0px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [isDesktop])

  const currentPubkey = typeof window !== 'undefined' ? localStorage.getItem('pubkey') : null

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const res = await apiCall('/api/daos')
        if (!res.ok) { setError('Failed to load DAOs'); return }
        const data = await res.json()
        setDaos(data.daos || [])
      } catch {
        setError('Failed to load DAOs')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const updateFilter = useCallback((partial: Partial<FilterState>) => {
    setFilters(prev => ({ ...prev, ...partial }))
  }, [])

  // KPI values
  const kpiItems = useMemo((): KPIItem[] => [
    {
      icon: <Vote size={14} />,
      value: daos.length,
      label: 'All DAOs',
      heading: 'Discovery',
    },
    {
      icon: <Users size={14} />,
      value: daos.filter(d => (d.membershipType ?? 'OPEN') === 'OPEN').length,
      label: 'Open Membership',
      color: 'var(--color-status-success)',
    },
    {
      icon: <Shield size={14} />,
      value: currentPubkey
        ? daos.filter(d => d.id === 'colabonate-foundation').length
        : 0,
      label: 'Joined',
    },
    {
      icon: <TrendingUp size={14} />,
      value: daos.reduce((sum, d) => sum + d._count.members, 0),
      label: 'Total Members',
      color: 'var(--color-primary-50)',
    },
  ], [daos, currentPubkey])

  // Filtered + sorted
  const filtered = useMemo(() => {
    let list = [...daos]
    if (filters.search) {
      const q = filters.search.toLowerCase()
      list = list.filter(d =>
        d.name.toLowerCase().includes(q) ||
        (d.description ?? '').toLowerCase().includes(q)
      )
    }
    if (filters.country === '__online__') {
      list = list.filter(d => d.isOnlineOnly)
    } else if (filters.country) {
      list = list.filter(d => d.country === filters.country)
    }
    if (filters.daoType) {
      list = list.filter(d => (d.daoType ?? 'COMMUNITY') === filters.daoType)
    }
    if (filters.membershipType) {
      list = list.filter(d => (d.membershipType ?? 'OPEN') === filters.membershipType)
    }
    if (filters.focusArea) {
      list = list.filter(d => {
        const areas = parseJsonField<string[]>(d.focusAreas, [])
        return areas.includes(filters.focusArea!)
      })
    }
    // Sort
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name))
    else if (sort === 'members') list.sort((a, b) => b._count.members - a._count.members)
    // 'newest' keeps server order (desc createdAt)
    return list
  }, [daos, filters, sort])

  const showPanel = isDesktop && sidebarOpen

  // Badge on the filter FAB: filters currently narrowing the list.
  const activeFilterCount =
    (filters.country ? 1 : 0) +
    (filters.daoType ? 1 : 0) +
    (filters.membershipType ? 1 : 0) +
    (filters.focusArea ? 1 : 0) +
    (filters.search ? 1 : 0)

  if (error) {
    return (
      <PageContainer size="wide" spacing="lg" className="pt-0!">
        <div className="max-w-2xl mx-auto">
          <PageHeader icon={<Vote size={18} />} title="DAO Governance" subtitle={error} onBack={() => navigate('/')} />
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer size="wide" spacing="lg" className="pt-0!">
      <div className="space-y-4">
        {!isDesktop && <div ref={headerSentinelRef} aria-hidden style={{ height: 1, marginBottom: -17 }} />}
        {/* Header + KPI */}
        <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-4 items-center">
          <PageHeader
            icon={<Vote size={20} />}
            title="DAO Governance"
            subtitle="Discover and participate in decentralized autonomous organizations"
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
            storageKey="kpi-dao-discovery"
          />
        </div>

        {/* Mobile: top filter strip */}
        {!isDesktop && (
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {(Object.keys(DAO_TYPE_META) as DaoType[]).map(type => {
              const meta = DAO_TYPE_META[type]
              const active = filters.daoType === type
              return (
                <button
                  key={type}
                  onClick={() => updateFilter({ daoType: active ? null : type })}
                  className="shrink-0 flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg"
                  style={{
                    background: active ? 'rgba(99,179,237,0.12)' : 'var(--theme-bg-subtle)',
                    color: active ? 'var(--color-primary-50)' : 'var(--theme-text)',
                    border: active ? '1px solid rgba(99,179,237,0.3)' : '1px solid transparent',
                    fontFamily: 'var(--typography-fontfamily-sans)',
                  }}
                >
                  {meta.emoji} {meta.label}
                </button>
              )
            })}
          </div>
        )}

        {/* Body: sidebar + content */}
        <div className={cn('flex gap-5', showPanel ? 'items-start' : '')}>
          {/* Sidebar */}
          {showPanel && (
            <aside
              className="w-[220px] shrink-0 rounded-xl p-4 sticky top-4"
              style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
            >
              <DaoSidebar daos={daos} filters={filters} onChange={updateFilter} />
            </aside>
          )}

          {/* List header + grid / list */}
          <div className="flex-1 min-w-0 space-y-4">
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
                      value={filters.search}
                      onChange={v => updateFilter({ search: v })}
                      onSearch={() => {}}
                      onClear={() => updateFilter({ search: '' })}
                      placeholder="Search DAOs..."
                      autoFocus
                      ariaLabel="Search"
                    />
                  ),
                },
                {
                  key: 'filter-menu',
                  element: (
                    <div ref={filterMenuRef} style={{ position: 'relative' }}>
                      <button
                        onClick={() => setShowFilterMenu(v => !v)}
                        className="flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150"
                        style={{
                          width: 36, height: 36,
                          background: showFilterMenu ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
                          color: showFilterMenu ? 'white' : 'var(--theme-text-muted)',
                          border: showFilterMenu ? 'none' : '1px solid var(--theme-border)',
                        }}
                        aria-label="Filter options"
                      >
                        <SlidersHorizontal size={16} />
                      </button>
                      {showFilterMenu && (
                        <div
                          className="flex flex-col gap-1 p-2 rounded-xl"
                          style={{
                            position: 'absolute',
                            top: 'calc(100% + 8px)',
                            right: 0,
                            minWidth: 180,
                            zIndex: 100,
                            background: 'var(--theme-surface)',
                            border: '1px solid var(--theme-border)',
                            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                          }}
                        >
                          <div className="flex flex-col gap-1 px-1 py-0.5">
                            <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                              Sort by
                            </span>
                            <select
                              value={sort}
                              onChange={e => { setSort(e.target.value as SortOption); setShowFilterMenu(false) }}
                              className="rounded-lg outline-none cursor-pointer"
                              style={{
                                fontSize: 12, height: 36, padding: '0 10px',
                                background: 'var(--theme-bg-subtle)',
                                color: 'var(--theme-text)',
                                border: '1px solid var(--theme-border)',
                                width: '100%',
                              }}
                            >
                              <option value="newest">Newest</option>
                              <option value="name">Name A–Z</option>
                              <option value="members">Most Members</option>
                            </select>
                          </div>
                          <div style={{ height: 1, background: 'var(--theme-border)', margin: '2px 0' }} />
                          <div className="flex flex-col gap-1 px-1 py-0.5">
                            <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                              Card size
                            </span>
                            <div className="flex gap-1">
                              {(['S', 'M', 'L'] as CardSize[]).map(s => (
                                <button
                                  key={s}
                                  onClick={() => { setCardSize(s); setShowFilterMenu(false) }}
                                  className="flex-1 py-1.5 text-[11px] font-bold rounded-md"
                                  style={{
                                    background: cardSize === s ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
                                    color: cardSize === s ? 'white' : 'var(--theme-text)',
                                    border: '1px solid var(--theme-border)',
                                  }}
                                >
                                  {s}
                                </button>
                              ))}
                            </div>
                          </div>
                          {isDesktop && (
                            <>
                              <div style={{ height: 1, background: 'var(--theme-border)', margin: '2px 0' }} />
                              <button
                                onClick={() => { setSidebarOpen(!sidebarOpen); setShowFilterMenu(false) }}
                                className="flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded-md cursor-pointer transition-all duration-150"
                                style={{
                                  background: sidebarOpen ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
                                  color: sidebarOpen ? 'white' : 'var(--theme-text)',
                                  border: sidebarOpen ? 'none' : '1px solid var(--theme-border)',
                                  fontWeight: 600,
                                }}
                              >
                                <PanelLeft size={11} />
                                {sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ),
                },
              ]}
              viewMode={viewMode}
              onViewModeChange={m => setViewMode(m as ViewMode)}
              mt={0}
            />

            {loading ? (
              <div className="flex items-center justify-center min-h-[40vh]">
                <div
                  className="w-10 h-10 border-4 rounded-full border-t-transparent animate-spin"
                  style={{ borderColor: 'var(--color-primary-50) var(--color-primary-50) var(--color-primary-50) transparent' }}
                />
              </div>
            ) : filtered.length === 0 ? (
              <div
                className="flex flex-col items-center gap-3 py-16 rounded-xl"
                style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
              >
                <div className="flex items-center justify-center w-16 h-16 rounded-2xl" style={{ background: 'var(--theme-bg-subtle)' }}>
                  <Inbox size={28} style={{ color: 'var(--theme-text-muted)' }} />
                </div>
                <span className="text-[15px] font-semibold" style={{ color: 'var(--theme-text)' }}>
                  {daos.length === 0 ? 'No DAOs yet' : 'No results'}
                </span>
                <p className="text-[12px] text-center max-w-xs" style={{ color: 'var(--theme-text-muted)' }}>
                  {daos.length === 0
                    ? 'Create the first Community DAO to get started.'
                    : 'Try adjusting the filters or search term.'}
                </p>
              </div>
            ) : viewMode === 'gallery' ? (
              <div
                className={cn(
                  'grid gap-3',
                  cardSize === 'L'
                    ? 'grid-cols-1 sm:grid-cols-2'
                    : cardSize === 'S'
                    ? 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4'
                    : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3',
                )}
              >
                {filtered.map(dao => (
                  <DaoGalleryCard key={dao.id} dao={dao} size={cardSize} />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map(dao => (
                  <DaoListRow key={dao.id} dao={dao} />
                ))}
              </div>
            )}

          </div>
        </div>
      </div>

      <DaoFAB />

      {!isDesktop && (
        <>
          <FilterFAB
            visible={filterFabVisible && !filterDrawerOpen}
            activeCount={activeFilterCount}
            onClick={() => setFilterDrawerOpen(true)}
          />
          <FilterDrawerShell
            open={filterDrawerOpen}
            onClose={() => setFilterDrawerOpen(false)}
            resultCount={filtered.length}
          >
            <div className="flex flex-col gap-1.5">
              <FilterDrawerSectionLabel>Sort by</FilterDrawerSectionLabel>
              <div className="flex flex-col gap-1">
                {SORT_OPTIONS.map(opt => {
                  const isActive = sort === opt.value
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setSort(opt.value)}
                      className="flex items-center justify-between text-[12px] px-2.5 py-1.5 rounded-lg cursor-pointer transition-all duration-150 text-left"
                      style={{
                        background: isActive ? 'rgba(99,179,237,0.12)' : 'var(--theme-bg-subtle)',
                        color: isActive ? 'var(--color-primary-50)' : 'var(--theme-text)',
                        border: isActive ? '1px solid rgba(99,179,237,0.30)' : '1px solid var(--theme-border)',
                        fontWeight: isActive ? 600 : 400,
                      }}
                    >
                      {opt.label}
                      {isActive && <Check size={13} />}
                    </button>
                  )
                })}
              </div>
            </div>

            <DaoSidebar daos={daos} filters={filters} onChange={updateFilter} />
          </FilterDrawerShell>
        </>
      )}
    </PageContainer>
  )
}
