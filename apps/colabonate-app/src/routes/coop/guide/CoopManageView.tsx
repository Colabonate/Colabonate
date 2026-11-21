// Manage view for own cooperations (ADR-033)
// Lists user's cooperation offers with status and actions

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileText, Plus, Pencil, Zap, Clock, FolderKanban, Eye, Trash2, Handshake, Archive } from 'lucide-react'
import { cn } from '@ds/utils'
import { KPIStrip } from '../../../components/kpi/KpiStrip'
import { apiCall } from '../../../lib/api'
import { formatSats } from '../../../lib/currency'
import { FiatHint } from '../../../components/currency/FiatHint'
import type { CoopRole, CoopType } from './coopGuideConstants'
import { useManagedOffers, invalidateManagedOffers } from '../../../hooks/useEntityQueries'
import { useQueryClient } from '@tanstack/react-query'
import { FullEditConfirmDialog } from '../../../components/coop/FullEditConfirmDialog'

interface CoopManageViewProps {
  role: CoopRole
  coopType: CoopType
  onCreateNew: () => void
}

interface ManagedOffer {
  id: string
  title: string
  description?: string
  priceSats?: number
  status?: string
  createdAt?: string
  offerType?: string
  images?: string[]
  isAgentOrchestration?: boolean
  // ADR-386: server-derived owner gate (published + unengaged + non-agent).
  canFullEdit?: boolean
}

interface CooperationRow {
  id: string
  title: string
  description?: string | null
  budgetSats?: number
  status?: string
  createdAt?: string
  cooperationType?: string | null
  images?: string[] | null
  initiatorPubkey?: string
  partnerPubkey?: string | null
  // ADR-328 D4: server-derived snapshot, see Cooperation.isAgentOrchestration
  // in apps/colabonate-app/src/hooks/useEntityQueries.ts. Drives the executor
  // kind filter chip below — null/undefined and false are equivalent here.
  isAgentOrchestration?: boolean
  // ADR-386: owner-only full-edit gate.
  canFullEdit?: boolean
}

type OfferAction = 'view' | 'edit' | 'publish' | 'start' | 'archive' | 'delete'

function getActionsForStatus(status: string | undefined): OfferAction[] {
  switch (status?.toUpperCase()) {
    case 'DRAFT':
      return ['edit', 'publish', 'delete']
    case 'ACTIVE':
    case 'OPEN':
      return ['view', 'edit', 'archive']
    case 'ACCEPTED':
    case 'PAID':
    case 'IN_PROGRESS':
      return ['view', 'archive']
    case 'COMPLETED':
      return ['view']
    case 'CANCELLED':
    case 'CLOSED':
      return ['view', 'delete']
    default:
      return ['view', 'delete']
  }
}

const ACTION_CONFIG: Record<OfferAction, { icon: typeof Eye; bg: string; color: string; title: string }> = {
  view:    { icon: Eye,       bg: 'rgba(99,179,237,0.08)',  color: 'var(--color-primary-50)',      title: 'View' },
  edit:    { icon: Pencil,    bg: 'rgba(72,187,120,0.08)',  color: 'var(--color-status-success)',   title: 'Edit' },
  publish: { icon: Handshake, bg: 'rgba(72,187,120,0.08)',  color: 'var(--color-status-success)',   title: 'Publish' },
  start:   { icon: Handshake, bg: 'var(--color-primary-50)', color: 'white',                        title: 'Start Cooperation' },
  archive: { icon: Archive,   bg: 'rgba(113,128,150,0.08)', color: 'var(--theme-text-muted)',       title: 'Archive' },
  delete:  { icon: Trash2,    bg: 'rgba(245,101,101,0.08)', color: 'var(--color-status-error)',     title: 'Delete' },
}

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  DRAFT:      { bg: 'rgba(113,128,150,0.12)', color: 'var(--theme-text-muted)',       label: 'Draft' },
  ACTIVE:     { bg: 'rgba(72,187,120,0.12)',   color: 'var(--color-status-success)',   label: 'Active' },
  OPEN:       { bg: 'rgba(72,187,120,0.12)',   color: 'var(--color-status-success)',   label: 'Open' },
  ACCEPTED:   { bg: 'rgba(99,179,237,0.12)',   color: 'var(--color-primary-50)',       label: 'Accepted' },
  PAID:       { bg: 'rgba(99,179,237,0.12)',   color: 'var(--color-primary-50)',       label: 'Paid' },
  IN_PROGRESS:{ bg: 'rgba(99,179,237,0.12)',   color: 'var(--color-primary-50)',       label: 'In Progress' },
  COMPLETED:  { bg: 'rgba(159,122,234,0.12)',  color: 'var(--color-secondary-50)',     label: 'Completed' },
  CANCELLED:  { bg: 'rgba(245,101,101,0.10)',  color: 'var(--color-status-error)',     label: 'Cancelled' },
  CLOSED:     { bg: 'rgba(113,128,150,0.12)',  color: 'var(--theme-text-muted)',       label: 'Closed' },
}

type StatusGroup = null | 'open' | 'active' | 'disputed' | 'completed' | 'closed'

// ADR-328 D4: executor-kind filter — orthogonal to StatusGroup. null = all,
// 'human' = classic cooperations, 'agent' = cooperations whose CoopMilestones
// include an AgentProfile assignee (server-derived snapshot, see
// apps/server/index.ts POST /api/cooperations).
type KindFilter = null | 'human' | 'agent'

function statusToGroup(status: string | undefined): StatusGroup {
  switch (status?.toUpperCase()) {
    case 'OPEN':
      return 'open'
    case 'ACCEPTED':
    case 'PAID':
    case 'IN_PROGRESS':
      return 'active'
    case 'COMPLETED':
      return 'completed'
    case 'CANCELLED':
    case 'CLOSED':
    case 'DRAFT':
      return 'closed'
    case 'DISPUTED':
      return 'disputed'
    default:
      return null
  }
}

function coopToManagedOffer(coop: CooperationRow): ManagedOffer {
  let images: string[] = []
  if (Array.isArray(coop.images)) {
    images = coop.images
  } else if (typeof coop.images === 'string') {
    try { images = JSON.parse(coop.images) } catch { /* ignore */ }
  }
  return {
    id: coop.id,
    title: coop.title ?? 'Untitled',
    description: coop.description ?? undefined,
    priceSats: coop.budgetSats ?? 0,
    status: coop.status ?? 'OPEN',
    createdAt: coop.createdAt ?? undefined,
    offerType: coop.cooperationType ?? undefined,
    images,
    isAgentOrchestration: coop.isAgentOrchestration ?? false,
    canFullEdit: coop.canFullEdit,
  }
}

export function CoopManageView({ role, coopType, onCreateNew }: CoopManageViewProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [pubkey] = useState(() => localStorage.getItem('pubkey') ?? '')
  const [archivingId, setArchivingId] = useState<string | null>(null)
  // ADR-386 D4: pending full-form edit, confirmed before switching to the guide.
  const [fullEditConfirmId, setFullEditConfirmId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusGroup>(null)
  // ADR-328 D4: kind filter — separate state from statusFilter because the
  // two are orthogonal (a row can be both OPEN and agent-orchestration). Both
  // filters compose: kind first, then status.
  const [kindFilter, setKindFilter] = useState<KindFilter>(null)

  const { data: rawRows = [], isLoading: loading } = useManagedOffers(pubkey)
  const offers = rawRows.map(coopToManagedOffer)

  async function handleArchive(e: React.MouseEvent, offerId: string) {
    e.preventDefault()
    e.stopPropagation()
    setArchivingId(offerId)
    try {
      await apiCall(`/api/cooperations/${offerId}/cancel`, { method: 'POST' })
      invalidateManagedOffers(queryClient, pubkey)
    } catch { /* ignore */ } finally { setArchivingId(null) }
  }

  function handleView(e: React.MouseEvent, offerId: string) {
    e.preventDefault()
    e.stopPropagation()
    navigate(`/coop/${offerId}`)
  }

  function handleEdit(e: React.MouseEvent, offerId: string, status: string | undefined) {
    e.preventDefault()
    e.stopPropagation()
    // ADR-296: a DRAFT was never finished in the Coop-Guide — resume the guide
    // itself (hydrated from the saved draft) instead of the read-only detail page.
    // ADR-386: a published but still unengaged cooperation (canFullEdit) also
    // opens the full form, behind a confirmation.
    if (status?.toUpperCase() === 'DRAFT') {
      navigate('/coop/guide', { state: { editId: offerId } })
      return
    }
    if (offers.find(o => o.id === offerId)?.canFullEdit) {
      setFullEditConfirmId(offerId)
      return
    }
    navigate(`/coop/${offerId}`)
  }

  function handleStartCooperation(e: React.MouseEvent, offerId: string) {
    e.preventDefault()
    e.stopPropagation()
    navigate(`/coop/${offerId}?action=start`)
  }

  function handleDelete(e: React.MouseEvent, offerId: string) {
    e.preventDefault()
    e.stopPropagation()
    handleArchive(e, offerId)
  }

  function handlePublish(e: React.MouseEvent, offerId: string) {
    e.preventDefault()
    e.stopPropagation()
    apiCall(`/api/cooperations/${offerId}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'OPEN' }) })
      .then(() => invalidateManagedOffers(queryClient, pubkey))
      .catch(console.error)
  }

  const typeLabel = coopType === 'projects' ? 'Projects' : coopType === 'tenders' ? 'Tenders' : 'Networks'

  const kindFilteredOffers = kindFilter
    ? offers.filter(o => (o.isAgentOrchestration ?? false) === (kindFilter === 'agent'))
    : offers

  const filteredOffers = statusFilter
    ? kindFilteredOffers.filter(o => statusToGroup(o.status) === statusFilter)
    : kindFilteredOffers

  const stats = {
    total: kindFilteredOffers.length,
    agentTotal: offers.filter(o => o.isAgentOrchestration ?? false).length,
    open: kindFilteredOffers.filter(o => statusToGroup(o.status) === 'open').length,
    active: kindFilteredOffers.filter(o => statusToGroup(o.status) === 'active').length,
    disputed: kindFilteredOffers.filter(o => statusToGroup(o.status) === 'disputed').length,
    completed: kindFilteredOffers.filter(o => statusToGroup(o.status) === 'completed').length,
    closed: kindFilteredOffers.filter(o => statusToGroup(o.status) === 'closed').length,
  }

  function toggleFilter(group: StatusGroup) {
    setStatusFilter(prev => prev === group ? null : group)
  }

  const kpiItems = [
    { value: stats.total, label: 'Total', active: statusFilter === null, onClick: () => toggleFilter(null) },
    { value: stats.open, label: 'Open', color: 'var(--color-status-success)', active: statusFilter === 'open', onClick: () => toggleFilter('open') },
    { value: stats.active, label: 'Active', color: 'var(--color-primary-50)', active: statusFilter === 'active', onClick: () => toggleFilter('active') },
    { value: stats.disputed, label: 'Disputed', color: 'var(--color-error-primary)', active: statusFilter === 'disputed', onClick: () => toggleFilter('disputed') },
    { value: stats.completed, label: 'Completed', color: 'var(--color-secondary-50)', active: statusFilter === 'completed', onClick: () => toggleFilter('completed') },
    { value: stats.closed, label: 'Closed', color: 'var(--theme-text-muted)', active: statusFilter === 'closed', onClick: () => toggleFilter('closed') },
  ]

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h3
            className="text-[18px] font-semibold mb-1"
            style={{ color: 'var(--theme-text)' }}
          >
            Manage {typeLabel}
          </h3>
          <p
            className="text-[13px]"
            style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            View and manage your {role === 'corporate' ? 'company' : 'personal'} cooperation {typeLabel.toLowerCase()}.
          </p>
        </div>
        <button
          onClick={onCreateNew}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-semibold',
            'transition-all duration-150 cursor-pointer hover:opacity-90 active:scale-[0.98]',
          )}
          style={{ background: 'var(--color-primary-50)', color: 'white' }}
        >
          <Plus size={14} />
          New
        </button>
      </div>

      {/* KPI Strip */}
      <div className="mb-6">
        <KPIStrip items={kpiItems} loading={loading} skeletonCount={6} wrap />
      </div>

      {/* ADR-328 D4: executor-kind filter chips. Orthogonal to the status
          KPI filter above — composes with it (kind first, then status). The
          'Agent' chip is only shown when at least one row actually carries
          the isAgentOrchestration flag, to keep the row hidden for users
          who never used the agent-orchestration flow. */}
      {stats.agentTotal > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap" data-testid="coop-kind-filter">
          <span
            className="text-[11px] uppercase tracking-wide font-semibold"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            Executor
          </span>
          {([
            { value: null,    label: 'All',     count: offers.length },
            { value: 'human', label: 'Human',   count: offers.length - stats.agentTotal },
            { value: 'agent', label: 'Agent',   count: stats.agentTotal },
          ] as const).map(opt => {
            const active = kindFilter === opt.value
            return (
              <button
                key={opt.label}
                onClick={() => setKindFilter(opt.value)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold',
                  'transition-all duration-150 cursor-pointer hover:opacity-80',
                )}
                style={{
                  background: active ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
                  color: active ? 'white' : 'var(--theme-text-muted)',
                  border: '1px solid',
                  borderColor: active ? 'var(--color-primary-50)' : 'var(--theme-border)',
                }}
                aria-pressed={active}
              >
                <span>{opt.label}</span>
                <span
                  className="px-1.5 rounded-full text-[10px]"
                  style={{
                    background: active ? 'rgba(255,255,255,0.22)' : 'var(--theme-border)',
                    color: active ? 'white' : 'var(--theme-text-muted)',
                  }}
                >
                  {opt.count}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div
            className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--color-primary-50) var(--color-primary-50) var(--color-primary-50) transparent' }}
          />
        </div>
      ) : filteredOffers.length === 0 ? (
        <div
          className="text-center py-16 rounded-xl"
          style={{ background: 'var(--theme-bg-subtle)' }}
        >
          <FileText size={40} className="mx-auto mb-3" style={{ color: 'var(--theme-text-muted)', opacity: 0.5 }} />
          <p
            className="text-[15px] font-semibold mb-1"
            style={{ color: 'var(--theme-text)' }}
          >
            No {typeLabel.toLowerCase()} yet
          </p>
          <p
            className="text-[13px] mb-4"
            style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            Start by creating your first cooperation {coopType === 'network' ? 'network' : 'opportunity'}.
          </p>
          <button
            onClick={onCreateNew}
            className={cn(
              'inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold',
              'transition-all duration-150 cursor-pointer hover:opacity-90',
            )}
            style={{ background: 'var(--color-primary-50)', color: 'white' }}
          >
            <Plus size={14} />
            Create {typeLabel.slice(0, -1)}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredOffers.map(offer => {
            const statusStyle = STATUS_STYLES[offer.status ?? 'DRAFT'] ?? STATUS_STYLES.DRAFT
            const isDraft = offer.status?.toUpperCase() === 'DRAFT'
            return (
              <Link
                key={offer.id}
                to={isDraft ? '/coop/guide' : `/coop/${offer.id}`}
                state={isDraft ? { editId: offer.id } : undefined}
                className={cn(
                  'flex items-center gap-4 p-4 rounded-xl border no-underline',
                  'transition-all duration-200 hover:shadow-md hover:scale-[1.01]',
                  'active:scale-[0.99] cursor-pointer',
                )}
                style={{
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-surface)',
                }}
              >
                <div
                  className="flex items-center justify-center shrink-0 overflow-hidden rounded-lg"
                  style={{ width: 64, height: 64, background: offer.images?.length ? 'var(--theme-bg-subtle)' : 'var(--theme-bg-subtle)' }}
                >
                  {offer.images?.[0] ? (
                    <img
                      src={offer.images[0]}
                      alt={offer.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <FolderKanban size={22} style={{ color: 'var(--theme-text-muted)', opacity: 0.5 }} />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4
                      className="text-[14px] font-semibold truncate"
                      style={{ color: 'var(--theme-text)' }}
                    >
                      {offer.title}
                    </h4>
                    <span
                      className="px-2 py-0.5 rounded text-[11px] font-medium shrink-0"
                      style={{ background: statusStyle.bg, color: statusStyle.color }}
                    >
                      {statusStyle.label}
                    </span>
                    {offer.isAgentOrchestration && (
                      <span
                        className="px-2 py-0.5 rounded text-[11px] font-medium shrink-0"
                        style={{
                          background: 'rgba(159,122,234,0.12)',
                          color: 'var(--color-secondary-50)',
                        }}
                        title="Agent Orchestration — at least one milestone is assigned to an AgentProfile (ADR-328 D4)"
                      >
                        Agent
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {offer.priceSats && offer.priceSats > 0 && (
                      <span
                        className="flex items-center gap-1 text-[12px]"
                        style={{ color: 'var(--color-warning-primary)' }}
                      >
                        <Zap size={11} />
                        {formatSats(offer.priceSats, { compact: false })}
                        <FiatHint sats={offer.priceSats} className="text-[11px] ml-0.5" style={{ color: 'var(--theme-text-muted)' }} />
                      </span>
                    )}
                    {offer.createdAt && (
                      <span
                        className="flex items-center gap-1 text-[11px]"
                        style={{ color: 'var(--theme-text-muted)' }}
                      >
                        <Clock size={11} />
                        {new Date(offer.createdAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {getActionsForStatus(offer.status).map(action => {
                    const cfg = ACTION_CONFIG[action]
                    const Icon = cfg.icon
                    const isStart = action === 'start'
                    return (
                      <button
                        key={action}
                        onClick={(e) => {
                          if (action === 'view') handleView(e, offer.id)
                          else if (action === 'edit') handleEdit(e, offer.id, offer.status)
                          else if (action === 'publish') handlePublish(e, offer.id)
                          else if (action === 'start') handleStartCooperation(e, offer.id)
                          else if (action === 'archive') handleArchive(e, offer.id)
                          else if (action === 'delete') handleDelete(e, offer.id)
                        }}
                        disabled={action === 'archive' && archivingId === offer.id}
                        className={cn(
                          'p-2 rounded-lg transition-all duration-150 cursor-pointer hover:opacity-80 disabled:opacity-40',
                          isStart && 'flex items-center gap-1.5 px-3',
                        )}
                        style={{
                          background: cfg.bg,
                          color: cfg.color,
                          ...(isStart ? { fontSize: '12px', fontWeight: 600 } : {}),
                        }}
                        title={cfg.title}
                      >
                        <Icon size={isStart ? 13 : 14} />
                        {isStart && <span className="hidden sm:inline">Start</span>}
                      </button>
                    )
                  })}
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {/* ADR-386 D4: confirm before switching to the full Coop-Guide form. */}
      <FullEditConfirmDialog
        open={!!fullEditConfirmId}
        entityLabel="cooperation"
        onClose={() => setFullEditConfirmId(null)}
        onConfirm={() => {
          const pending = fullEditConfirmId
          setFullEditConfirmId(null)
          if (pending) navigate('/coop/guide', { state: { editId: pending } })
        }}
      />
    </div>
  )
}
