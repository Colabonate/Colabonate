// /coop/manage "All" tab (ADR-368 follow-up, 2026-11-20): combined,
// section-grouped overview over the four content tabs — Cooperations
// (incl. applications + COOP networks, the same merge as the Cooperations
// tab), Services, Agent Stack and Bounties — in ONE list grouped by
// section via ListBrowser's presentational section headers (ADR-339 D5,
// list view only — gallery stays flat, same as Agent Stack).
//
// Overview-only by design (user decision 2026-11-20): every row is a plain
// link into its detail/edit surface; management actions (publish/archive/
// delete, agent toggles, catalog membership) stay in their dedicated
// subtab. Data comes exclusively from the cached TanStack queries the
// subtabs already use, so switching between All and a subtab renders from
// cache without a loading flash.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Bot, Briefcase, Clock, Handshake, Layers, Send, Zap } from 'lucide-react'
import type { KPIItem } from '@ds/ui'
import { ListBrowser } from '../../../components/list-browser'
import { EmptyStateGuide } from '../../../components/EmptyStateGuide'
import { FiatHint } from '../../../components/currency/FiatHint'
import { SearchInput } from '../../../components/ui/SearchInput'
import { useFABActions } from '../../../context/FABContext'
import { useTranslation } from '../../../contexts/LocaleContext'
import { useAgentRoster, type RosterAgentProfile } from '../../../hooks/useAgentRosterQuery'
import { useAgentTasks, type AgentTask } from '../../../hooks/useAgentTaskQueries'
import { useApplications, useCooperations, useOffers, useUserServiceOffers } from '../../../hooks/useEntityQueries'
import { usePageListViewMode } from '../../../hooks/usePageListViewMode'
import { formatSats } from '../../../lib/currency'
import { CoopGalleryCard, CoopListRow, type CoopItem } from '../coop-cards'
import { APP_STATUS_STYLES, COOP_STATUS_STYLES, TYPE_BADGE, type ManagedOffer, type MyApplication } from '../CoopOffers'
import { BountyGalleryCard, BountyListRow } from './BountiesTab'
import type { CoopTabProps } from '../../sell/sell.types'
import type { Offer } from '../../../types/api'

// ── Types ─────────────────────────────────────────────────────────────────────

type AllSection = 'cooperations' | 'services' | 'stack' | 'bounties'
type SectionFilter = 'all' | AllSection
type SortOption = 'newest' | 'name'

// Discriminated by `kind` — every renderer narrows on it. Prefixed ids keep
// the merge collision-free (same trick as CoopOffers' UnifiedItem; an owned
// agent may also appear as booked — both entries stay valid, no dedupe,
// mirroring AgentStackTab's roster merge).
type AllItem =
  | { id: string; section: 'cooperations'; kind: 'coop'; title: string; createdAt?: string; coopItem: CoopItem }
  | { id: string; section: 'cooperations'; kind: 'application'; title: string; subtitle: string; createdAt: string; appData: MyApplication }
  | { id: string; section: 'cooperations'; kind: 'network'; title: string; createdAt?: string; offerData: ManagedOffer }
  | { id: string; section: 'services'; kind: 'service'; title: string; createdAt?: string; offer: Offer }
  | { id: string; section: 'stack'; kind: 'agent'; title: string; subtitle?: string; createdAt?: string; detailPath: string; agentProfile: RosterAgentProfile; booked: boolean }
  | { id: string; section: 'bounties'; kind: 'bounty'; title: string; createdAt: string; bounty: AgentTask }

// ── Constants ─────────────────────────────────────────────────────────────────

const SECTION_ORDER: Record<AllSection, number> = { cooperations: 0, services: 1, stack: 2, bounties: 3 }
const SECTION_LABELS: Record<AllSection, string> = {
  cooperations: 'Cooperations',
  services: 'Services',
  stack: 'Agent Stack',
  bounties: 'Bounties',
}

// Labels for the generic overview rows (tints mirror COOP_STATUS_STYLES so a
// given status reads the same here as in the Cooperations tab).
const SERVICE_STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  ACTIVE:   { bg: 'rgba(72,187,120,0.12)',  color: 'var(--color-status-success)', label: 'Active'   },
  DRAFT:    { bg: 'rgba(113,128,150,0.12)', color: 'var(--theme-text-muted)',     label: 'Draft'    },
  ARCHIVED: { bg: 'rgba(113,128,150,0.12)', color: 'var(--theme-text-muted)',     label: 'Archived' },
}

const SERVICE_BADGE = { label: 'Service', bg: 'rgba(56,189,248,0.12)', color: 'var(--color-info-primary)' }
const AGENT_BADGE = { label: 'Agent', bg: 'rgba(159,122,234,0.12)', color: 'var(--color-secondary-50)' }

// ── Generic overview row/card (application / network / service / agent) ───────

interface RowConfig {
  to: string
  icon: ReactNode
  badge: { label: string; bg: string; color: string }
  title: string
  subtitle?: string
  status?: { bg: string; color: string; label: string }
  priceSats?: number
  chips?: Array<{ label: string; bg: string; color: string }>
  createdAt?: string
}

function rowConfig(item: AllItem): RowConfig {
  switch (item.kind) {
    case 'application': {
      const app = item.appData
      return {
        to: `/coop/${app.cooperationId}`,
        icon: <Send size={18} />,
        badge: TYPE_BADGE.application,
        title: item.title,
        subtitle: item.subtitle,
        status: APP_STATUS_STYLES[app.status] ?? APP_STATUS_STYLES.PENDING,
        createdAt: item.createdAt,
      }
    }
    case 'network': {
      const offer = item.offerData
      return {
        to: `/coop/${offer.id}`,
        icon: <Handshake size={18} />,
        badge: TYPE_BADGE.network,
        title: item.title,
        status: COOP_STATUS_STYLES[offer.status ?? 'DRAFT'] ?? COOP_STATUS_STYLES.DRAFT,
        priceSats: offer.priceSats,
        createdAt: item.createdAt,
      }
    }
    case 'service': {
      const offer = item.offer
      return {
        to: `/buy/product/${offer.id}`,
        icon: <Briefcase size={18} />,
        badge: SERVICE_BADGE,
        title: item.title,
        status: SERVICE_STATUS_STYLES[offer.status ?? ''] ?? undefined,
        priceSats: offer.priceSats,
        chips: [offer.companyId
          ? { label: 'Corporate', bg: 'var(--theme-bg-subtle)', color: 'var(--theme-text-secondary)' }
          : { label: 'Private', bg: 'var(--theme-bg-subtle)', color: 'var(--theme-text-secondary)' }],
        createdAt: item.createdAt,
      }
    }
    case 'agent': {
      const online = !item.booked && item.agentProfile.offer?.status === 'ACTIVE'
      return {
        to: item.detailPath,
        icon: <Bot size={18} />,
        badge: AGENT_BADGE,
        title: item.title,
        subtitle: item.subtitle,
        chips: [item.booked
          ? { label: 'Booked', bg: 'rgba(255,192,57,0.12)', color: 'var(--color-warning-primary)' }
          : online
            ? { label: 'Online', bg: 'rgba(72,187,120,0.12)', color: 'var(--color-status-success)' }
            : { label: 'Offline', bg: 'rgba(113,128,150,0.12)', color: 'var(--theme-text-muted)' }],
        createdAt: item.createdAt,
      }
    }
    default:
      // coop + bounty rows render through their dedicated card components
      throw new Error(`rowConfig: unexpected kind '${(item as { kind: string }).kind}'`)
  }
}

function PricePill({ sats }: { sats: number }) {
  return (
    <span
      className="inline-flex items-center gap-0.5"
      style={{
        padding: '2px 8px', borderRadius: 6,
        background: 'rgba(99,179,237,0.10)', fontSize: 11, fontWeight: 700,
        fontVariantNumeric: 'tabular-nums', color: 'var(--color-primary-50)', whiteSpace: 'nowrap',
      }}
    >
      <Zap size={11} />
      {formatSats(sats, { compact: false })}
      <FiatHint sats={sats} className="text-[0.9em] ml-[3px]" />
    </span>
  )
}

// List row — visual family of CoopOffers' application row / BountyListRow.
function OverviewRow({ cfg }: { cfg: RowConfig }) {
  const { formatDate } = useTranslation()
  return (
    <Link
      to={cfg.to}
      className="flex items-start gap-3 p-3 rounded-xl no-underline cursor-pointer transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.99]"
      style={{
        background: 'var(--theme-surface)',
        border: '1px solid var(--theme-border)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)',
      }}
    >
      <div
        className="flex items-center justify-center shrink-0 rounded-lg"
        style={{ width: 48, height: 48, background: cfg.badge.bg, color: cfg.badge.color }}
      >
        {cfg.icon}
      </div>
      <div className="flex flex-col flex-1 min-w-0 py-0.5">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <span
            className="px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0"
            style={{ background: cfg.badge.bg, color: cfg.badge.color }}
          >
            {cfg.badge.label}
          </span>
          <span className="truncate" style={{ fontSize: 13, fontWeight: 600, color: 'var(--theme-text)' }}>
            {cfg.title}
          </span>
          {cfg.status && (
            <span
              className="px-2 py-0.5 rounded text-[11px] font-medium shrink-0"
              style={{ background: cfg.status.bg, color: cfg.status.color }}
            >
              {cfg.status.label}
            </span>
          )}
        </div>
        {cfg.subtitle && (
          <p className="text-[12px] mb-1.5 truncate" style={{ color: 'var(--theme-text-muted)' }}>
            {cfg.subtitle}
          </p>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {cfg.priceSats !== undefined && <PricePill sats={cfg.priceSats} />}
          {cfg.chips?.map(chip => (
            <span
              key={chip.label}
              className="px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0"
              style={{ background: chip.bg, color: chip.color, border: '1px solid var(--theme-border)' }}
            >
              {chip.label}
            </span>
          ))}
          {cfg.createdAt && (
            <span className="inline-flex items-center gap-1" style={{ fontSize: 10, color: 'var(--theme-text-muted)' }}>
              <Clock size={10} />
              {formatDate(new Date(cfg.createdAt), { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          )}
        </div>
      </div>
      <ArrowRight size={14} className="mt-1 shrink-0" style={{ color: 'var(--theme-text-muted)' }} />
    </Link>
  )
}

// Gallery card — visual family of BountyGalleryCard (icon band instead of image).
function OverviewCard({ cfg }: { cfg: RowConfig }) {
  const { formatDate } = useTranslation()
  return (
    <Link
      to={cfg.to}
      className="flex flex-col rounded-xl overflow-hidden no-underline cursor-pointer shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all duration-300 ease-out hover:z-10 hover:scale-[1.03] hover:shadow-[0_12px_32px_rgba(0,0,0,0.18)] active:scale-[0.99] h-full relative"
      style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
    >
      <div
        className="relative flex items-center justify-center shrink-0 overflow-hidden"
        style={{ height: 90, background: cfg.badge.bg, color: cfg.badge.color }}
      >
        <span className="inline-flex scale-[1.8]">{cfg.icon}</span>
        {cfg.status && (
          <span
            className="absolute top-2 right-2 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full"
            style={{ background: cfg.status.bg, color: cfg.status.color }}
          >
            {cfg.status.label}
          </span>
        )}
      </div>
      <div className="flex flex-col flex-1 p-3 gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: cfg.badge.color }}>
          {cfg.badge.label}
        </span>
        <h4
          className="text-[14px] font-semibold leading-snug"
          style={{ color: 'var(--theme-text)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {cfg.title}
        </h4>
        {cfg.subtitle && (
          <p
            className="text-[11px] leading-snug"
            style={{ color: 'var(--theme-text-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          >
            {cfg.subtitle}
          </p>
        )}
        {cfg.chips && cfg.chips.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {cfg.chips.map(chip => (
              <span
                key={chip.label}
                className="px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0"
                style={{ background: chip.bg, color: chip.color, border: '1px solid var(--theme-border)' }}
              >
                {chip.label}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-1 mt-auto">
          {cfg.priceSats !== undefined ? (
            <PricePill sats={cfg.priceSats} />
          ) : (
            <span />
          )}
          {cfg.createdAt && (
            <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
              <Clock size={10} />
              {formatDate(new Date(cfg.createdAt), { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AllTab({ pubkey, onKpiChange, headerPrefix }: CoopTabProps) {
  const navigate = useNavigate()
  const { setActions: setFABActions, clear: clearFAB } = useFABActions()

  // ── Data — the same cached queries the four subtabs use ────────────

  const { data: coopData = [], isLoading: coopsLoading } = useCooperations(pubkey)
  const { data: appData = [], isLoading: appsLoading } = useApplications(pubkey)
  const { data: offerData = [], isLoading: offersLoading } = useOffers(pubkey)
  const { data: services = [], isLoading: servicesLoading } = useUserServiceOffers(pubkey)
  const { data: roster, isLoading: rosterLoading } = useAgentRoster()
  // No `status` → every status of my bounties (FU-483 drops the OPEN-only
  // default for creatorPubkey); 50 = the server's list cap, `total` carries
  // the true count for the KPI chip.
  const { data: bountyData, isLoading: bountiesLoading } = useAgentTasks({ creatorPubkey: pubkey, limit: 50 })

  const loading = coopsLoading || appsLoading || offersLoading || servicesLoading || rosterLoading || bountiesLoading

  // ── View state (page-wide viewMode shared with the other subtabs) ───

  const [sectionFilter, setSectionFilter] = useState<SectionFilter>('all')
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  const [viewMode, setViewMode] = usePageListViewMode({ storageKey: 'coopManage_viewMode', initial: 'list' })

  function handleSearch() { setActiveQuery(query) }
  function handleClear() { setQuery(''); setActiveQuery('') }

  // FAB — the union of the subtabs' create actions (same set the
  // Cooperations tab registers).
  useEffect(() => {
    setFABActions([
      { id: 'coop-guide', label: 'Coop Guide', info: 'Start cooperation', group: 'Cooperate', icon: 'handshake', onClick: () => navigate('/coop/guide') },
      { id: 'create-service', label: 'Service', info: 'Offer your expertise', group: 'Cooperate', icon: 'briefcase', onClick: () => navigate('/offers/new?type=service&context=coop') },
      { id: 'create-agent', label: 'Agent', info: 'Offer a new agent', group: 'Cooperate', icon: 'bot', onClick: () => navigate('/coop/agents/new') },
      { id: 'post-bounty', label: 'Bounty', info: 'Post a bounty for agents to apply to', group: 'Create', icon: 'plus', onClick: () => navigate('/bounties/new') },
    ])
    return () => clearFAB()
  }, [setFABActions, clearFAB, navigate])

  // ── Merge (same mapping as CoopOffers' allItems; services/roster/bounties added)

  const allItems = useMemo((): AllItem[] => {
    const items: AllItem[] = []
    for (const coop of coopData as CoopItem[]) {
      items.push({ id: `coop-${coop.id}`, section: 'cooperations', kind: 'coop', title: coop.title, createdAt: coop.createdAt, coopItem: coop })
    }
    for (const app of appData as MyApplication[]) {
      items.push({ id: `app-${app.id}`, section: 'cooperations', kind: 'application', title: app.cooperationTitle, subtitle: `M${app.milestoneIndex + 1}: ${app.milestoneTitle}`, createdAt: app.createdAt, appData: app })
    }
    for (const offer of offerData as ManagedOffer[]) {
      items.push({ id: `network-${offer.id}`, section: 'cooperations', kind: 'network', title: offer.title, createdAt: offer.createdAt, offerData: offer })
    }
    for (const offer of services) {
      items.push({ id: `service-${offer.id}`, section: 'services', kind: 'service', title: offer.title, createdAt: offer.createdAt, offer })
    }
    for (const profile of roster?.owned ?? []) {
      items.push({
        id: `agent-${profile.id}`, section: 'stack', kind: 'agent', title: profile.name,
        subtitle: profile.capabilities.slice(0, 3).join(' · '), createdAt: profile.createdAt,
        detailPath: `/coop/agents/${profile.id}/edit`, agentProfile: profile, booked: false,
      })
    }
    for (const entry of roster?.booked ?? []) {
      items.push({
        id: `booked-${entry.agentProfile.id}`, section: 'stack', kind: 'agent', title: entry.agentProfile.name,
        subtitle: entry.agentProfile.capabilities.slice(0, 3).join(' · '), createdAt: entry.agentProfile.createdAt,
        detailPath: entry.workspace ? `/workspaces/${entry.workspace.id}` : `/tickets/${entry.ticket.id}`,
        agentProfile: entry.agentProfile, booked: true,
      })
    }
    for (const bounty of bountyData?.tasks ?? []) {
      items.push({ id: `bounty-${bounty.id}`, section: 'bounties', kind: 'bounty', title: bounty.title, createdAt: bounty.createdAt, bounty })
    }
    return items
  }, [coopData, appData, offerData, services, roster, bountyData])

  // ── Filter + sort (section grouping wins over the chosen sort, exactly
  // like AgentStackTab's section comparator) ───────────────────────────

  const visibleItems = useMemo(() => {
    let items = allItems
    if (sectionFilter !== 'all') items = items.filter(i => i.section === sectionFilter)
    if (activeQuery.trim()) {
      const q = activeQuery.toLowerCase()
      items = items.filter(i => {
        const title = typeof i.title === 'string' ? i.title.toLowerCase() : ''
        const subtitle = 'subtitle' in i && typeof i.subtitle === 'string' ? i.subtitle.toLowerCase() : ''
        return title.includes(q) || subtitle.includes(q)
      })
    }
    const sorted = [...items]
    sorted.sort((a, b) => {
      const sectionDiff = SECTION_ORDER[a.section] - SECTION_ORDER[b.section]
      if (sectionDiff !== 0) return sectionDiff
      if (sortBy === 'name') return a.title.localeCompare(b.title)
      return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
    })
    return sorted
  }, [allItems, sectionFilter, activeQuery, sortBy])

  // ── KPI (lifted to the shell's KPIStrip; chips filter by section) ───

  const cooperationsCount = (coopData as CoopItem[]).length + (appData as MyApplication[]).length + (offerData as ManagedOffer[]).length
  const ownedAgentsCount = roster?.owned.length ?? 0
  const bountiesCount = bountyData?.total ?? bountyData?.tasks.length ?? 0

  const kpiItems = useMemo<KPIItem[]>(() => [
    { icon: <Layers size={14} />, value: cooperationsCount + services.length + ownedAgentsCount + (roster?.booked.length ?? 0) + bountiesCount, label: 'All', onClick: () => setSectionFilter('all'), active: sectionFilter === 'all', heading: 'Overview' },
    { icon: <Handshake size={14} />, value: cooperationsCount, label: 'Cooperations', onClick: () => setSectionFilter('cooperations'), active: sectionFilter === 'cooperations' },
    { icon: <Briefcase size={14} />, value: services.length, label: 'Services', onClick: () => setSectionFilter('services'), active: sectionFilter === 'services' },
    { icon: <Bot size={14} />, value: ownedAgentsCount, label: 'Agents', onClick: () => setSectionFilter('stack'), active: sectionFilter === 'stack' },
    { icon: <Zap size={14} />, value: bountiesCount, label: 'Bounties', onClick: () => setSectionFilter('bounties'), active: sectionFilter === 'bounties', separator: true },
  ], [cooperationsCount, services.length, ownedAgentsCount, roster, bountiesCount, sectionFilter])

  useEffect(() => {
    onKpiChange(kpiItems, loading)
  }, [onKpiChange, kpiItems, loading])

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <ListBrowser
      items={visibleItems}
      loading={loading}
      headerPrefix={headerPrefix}
      controlledViewMode={viewMode}
      onControlledViewModeChange={setViewMode}
      filterTabs={[]}
      activeFilterTab="all"
      onFilterTabChange={() => {}}
      categories={[]}
      selectedCategory=""
      onSelectCategory={() => {}}
      categoryOpen={false}
      onCategoryOpenChange={() => {}}
      hideBuiltinTaxonomyPanel
      defaultPanelMode="top"
      searchQuery={activeQuery}
      onSearchQueryChange={(q) => { setQuery(q); setActiveQuery(q) }}
      sortBy={sortBy}
      onSortChange={(s) => setSortBy(s as SortOption)}
      sortOptions={[
        { value: 'newest', label: 'Newest' },
        { value: 'name', label: 'Name A–Z' },
      ]}
      sectionOf={(item) => item.section}
      sectionLabels={SECTION_LABELS}
      headerActions={[
        <SearchInput
          key="search"
          variant="toggle"
          size="md"
          value={query}
          onChange={setQuery}
          onSearch={handleSearch}
          onClear={handleClear}
          placeholder="Search all content…"
          ariaLabel="Search"
        />,
      ]}
      renderCard={(item, size, mode) => {
        if (item.kind === 'coop') {
          return mode === 'gallery'
            ? <CoopGalleryCard item={item.coopItem} size={size} />
            : <CoopListRow item={item.coopItem} size={size} />
        }
        if (item.kind === 'bounty') {
          return mode === 'gallery'
            ? <BountyGalleryCard bounty={item.bounty} />
            : <BountyListRow bounty={item.bounty} />
        }
        const cfg = rowConfig(item)
        return mode === 'gallery' ? <OverviewCard cfg={cfg} /> : <OverviewRow cfg={cfg} />
      }}
      cardKey={(item) => item.id}
      emptyState={loading ? null : (
        <EmptyStateGuide
          icon={<Layers size={26} />}
          accent="var(--color-secondary-50)"
          accentSoft="rgba(159,122,234,0.12)"
          title={sectionFilter === 'all' ? 'Nothing to manage yet' : `No ${SECTION_LABELS[sectionFilter]} content`}
          intro="This overview collects everything you manage on Colabonate in one grouped list: cooperations you run or applied to, your service offers, your agent stack and every bounty you posted. Create any of them and it shows up here, grouped by section."
          features={[
            { icon: <Handshake size={16} />, title: 'Cooperations', text: 'Run projects and tenders milestone by milestone, together with humans or AI agents.', color: 'var(--color-status-success)', bg: 'rgba(72,187,120,0.12)' },
            { icon: <Briefcase size={16} />, title: 'Services', text: 'Offer your expertise as payable service listings — private or under your company.', color: 'var(--color-info-primary)', bg: 'rgba(56,189,248,0.12)' },
            { icon: <Bot size={16} />, title: 'Agent Stack & Bounties', text: 'Manage your agent setups or post bounties for agents to apply to.', color: 'var(--color-secondary-50)', bg: 'rgba(159,122,234,0.12)' },
          ]}
          helpLinks={[
            { label: 'Cooperation guide', to: '/coop/guide' },
            { label: 'Selling guide', to: '/help/selling' },
          ]}
          ctaLabel="Start a cooperation"
          ctaTo="/coop/guide"
          secondaryCtaLabel="Offer a service"
          secondaryCtaTo="/offers/new?type=service&context=coop"
        />
      )}
      storageKeyPrefix="coopManageAll"
    />
  )
}
