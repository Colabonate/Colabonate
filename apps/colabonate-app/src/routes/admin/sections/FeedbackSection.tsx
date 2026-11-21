import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Paper,
  Typography,
  CircularProgress,
  Alert,
  Chip,
  Collapse,
  TextField,
  Skeleton,
} from '@mui/material'
import RefreshIcon      from '@mui/icons-material/Refresh'
import BugReportIcon    from '@mui/icons-material/BugReport'
import LightbulbIcon    from '@mui/icons-material/Lightbulb'
import HelpOutlineIcon  from '@mui/icons-material/HelpOutline'
import DoneIcon         from '@mui/icons-material/Done'
import ExpandMoreIcon   from '@mui/icons-material/ExpandMore'
import RouteIcon        from '@mui/icons-material/AltRoute'
import KeyIcon          from '@mui/icons-material/Key'
import ReplyIcon        from '@mui/icons-material/Reply'
import SendIcon         from '@mui/icons-material/Send'
import EmailIcon        from '@mui/icons-material/Email'
import InboxIcon        from '@mui/icons-material/Inbox'
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead'
import FilterListIcon   from '@mui/icons-material/FilterList'
import { apiCall } from '../../../lib/api'
import { ActionButton as EntityActionButton, type EntityActionMeta } from './ActionButton'

// ADR-273: registry-driven action metadata. Previously hardcoded as
// BETA_FEEDBACK_DELETE because the registry only ever returned 'delete';
// fetching live metadata means future actions (e.g. soft-archive) light up
// automatically without touching the client. Same one-fetch-then-cache
// pattern as AccountsSection's accountActionsCache.
const betaFeedbackActionsCache: { value: EntityActionMeta[] | null } = { value: null }
const betaFeedbackActionsPromise: { current: Promise<EntityActionMeta[]> | null } = { current: null }

async function fetchBetaFeedbackActions(): Promise<EntityActionMeta[]> {
  if (betaFeedbackActionsCache.value) return betaFeedbackActionsCache.value
  if (betaFeedbackActionsPromise.current) return betaFeedbackActionsPromise.current
  betaFeedbackActionsPromise.current = (async () => {
    try {
      const res  = await apiCall('/api/admin/entities/BetaFeedback/actions')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      const list = (json.actions ?? []) as EntityActionMeta[]
      betaFeedbackActionsCache.value = list
      return list
    } catch (e) {
      betaFeedbackActionsPromise.current = null
      throw e
    }
  })()
  return betaFeedbackActionsPromise.current
}

const C = {
  text:      'var(--theme-text)',
  textMuted: 'var(--theme-text-muted)',
  border:    'var(--theme-border)',
  surface:   'var(--theme-surface)',
  bgSubtle:  'var(--theme-bg-subtle)',
  accent:    'var(--color-warning-default, #f59e0b)',
} as const

// ── Kind config ───────────────────────────────────────────────────────────────
const KIND_CONFIG = {
  bug: {
    color:    'var(--color-status-error, #ef4444)',
    bgColor:  'rgba(239,68,68,0.10)',
    iconColor:'rgba(239,68,68,1)',
    chipBg:   'rgba(239,68,68,0.10)',
    chipColor:'var(--color-status-error, #ef4444)',
    icon:     <BugReportIcon sx={{ fontSize: 16 }} />,
  },
  idea: {
    color:    'var(--color-warning-default, #f59e0b)',
    bgColor:  'rgba(245,158,11,0.10)',
    iconColor:'rgba(245,158,11,1)',
    chipBg:   'rgba(245,158,11,0.10)',
    chipColor:'var(--color-warning-default, #f59e0b)',
    icon:     <LightbulbIcon sx={{ fontSize: 16 }} />,
  },
  other: {
    color:    'var(--color-accent-1)',
    bgColor:  'rgba(107,177,255,0.10)',
    iconColor:'rgba(107,177,255,1)',
    chipBg:   'rgba(107,177,255,0.10)',
    chipColor:'var(--color-accent-1)',
    icon:     <HelpOutlineIcon sx={{ fontSize: 16 }} />,
  },
} as const

type KindKey = keyof typeof KIND_CONFIG
function kindCfg(kind: string) {
  return KIND_CONFIG[(kind as KindKey) in KIND_CONFIG ? (kind as KindKey) : 'other']
}
function shortPubkey(pk: string) { return pk.slice(0, 8) + '…' + pk.slice(-6) }

// ── Compose TextField style ───────────────────────────────────────────────────
const composeSx = {
  '& .MuiInputBase-root': { bgcolor: C.surface, fontSize: '0.82rem' },
  '& label': { fontSize: '0.78rem' },
  '& fieldset': { borderColor: C.border },
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface FeedbackStats {
  byKind:   Record<string, number>
  byStatus: Record<string, number>
  unread:    number
  withEmail: number
}

interface FeedbackRow {
  id: string
  kind: string
  title: string
  body: string
  route?: string | null
  pubkey?: string | null
  userEmail?: string | null
  status: string
  read: boolean
  createdAt: string
}

// ── KPI strip ─────────────────────────────────────────────────────────────────
interface KpiCardProps {
  icon: React.ReactNode
  label: string
  value: number | string
  accent?: string
  loading?: boolean
}

function KpiCard({ icon, label, value, accent, loading }: KpiCardProps) {
  const color = accent ?? C.textMuted
  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 2,
        borderColor: accent ? accent : C.border,
        bgcolor: accent ? `${accent}10` : C.surface,
        p: 1.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        minWidth: 0,
      }}
    >
      {loading ? (
        <>
          <Skeleton variant="text" width={40} height={28} sx={{ bgcolor: C.border }} />
          <Skeleton variant="text" width={56} height={14} sx={{ bgcolor: C.border }} />
        </>
      ) : (
        <>
          <Typography
            sx={{
              fontSize: '1.35rem', fontWeight: 700, lineHeight: 1.1,
              color: accent ? accent : C.text,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {value}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ color, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              {icon}
            </Box>
            <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.04em', lineHeight: 1.2 }}>
              {label}
            </Typography>
          </Box>
        </>
      )}
    </Paper>
  )
}

// ── Filter chip ───────────────────────────────────────────────────────────────
function FilterChip({ label, active, color, onClick }: {
  label: string
  active: boolean
  color?: string
  onClick: () => void
}) {
  const c = color ?? C.accent
  return (
    <Box
      onClick={onClick}
      sx={{
        px: 1.25, py: 0.4, borderRadius: 1, cursor: 'pointer',
        fontSize: '0.72rem', fontWeight: active ? 700 : 500,
        border: '1px solid',
        borderColor: active ? c : C.border,
        color: active ? c : C.textMuted,
        bgcolor: active ? `${c}12` : 'transparent',
        transition: 'all 0.12s',
        whiteSpace: 'nowrap',
        '&:hover': { borderColor: c, color: c },
      }}
    >
      {label}
    </Box>
  )
}

// ── Single feedback card ──────────────────────────────────────────────────────
function FeedbackCard({ row, onMarkRead, markingRead, onReplySent, onDeleted, deleteAction }: {
  row: FeedbackRow
  onMarkRead: (id: string) => void
  markingRead: string | null
  onReplySent: (id: string) => void
  onDeleted: (id: string) => void
  deleteAction: EntityActionMeta | null
}) {
  const [expanded, setExpanded]   = useState(!row.read)
  const [replyOpen, setReplyOpen] = useState(false)
  const [subject, setSubject]     = useState(`Re: ${row.title}`)
  const [message, setMessage]     = useState('')
  const [sending, setSending]     = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sent, setSent]           = useState(false)
  const cfg = kindCfg(row.kind)

  async function handleSendReply() {
    setSending(true)
    setSendError(null)
    try {
      const res = await apiCall(`/api/admin/feedback/${row.id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ subject, message }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to send')
      setSent(true)
      setReplyOpen(false)
      setMessage('')
      onReplySent(row.id)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setSending(false)
    }
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 2,
        borderColor: !row.read ? cfg.color : C.border,
        bgcolor: C.surface,
        overflow: 'hidden',
        transition: 'border-color 0.15s',
        opacity: row.read ? 0.75 : 1,
      }}
    >
      {/* ── Header ── */}
      <Box
        onClick={() => setExpanded(p => !p)}
        sx={{
          px: 2, py: 1.5, cursor: 'pointer',
          display: 'flex', alignItems: 'flex-start', gap: 1.5,
          '&:hover': { bgcolor: C.bgSubtle },
        }}
      >
        <Box sx={{
          width: 32, height: 32, borderRadius: 1.5, flexShrink: 0, mt: 0.25,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: cfg.bgColor, color: cfg.iconColor,
        }}>
          {cfg.icon}
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontWeight: row.read ? 500 : 700, fontSize: '0.85rem', color: C.text, lineHeight: 1.3 }}>
              {row.title}
            </Typography>
            <Chip label={row.kind} size="small" sx={{ height: 16, fontSize: '0.6rem', fontWeight: 700, bgcolor: cfg.chipBg, color: cfg.chipColor }} />
            <Chip label={row.status} size="small" sx={{ height: 16, fontSize: '0.6rem', bgcolor: C.bgSubtle, color: C.textMuted }} />
            {!row.read && (
              <Chip label="unread" size="small" sx={{ height: 16, fontSize: '0.6rem', fontWeight: 700, bgcolor: cfg.bgColor, color: cfg.color }} />
            )}
          </Box>
          <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.7rem' }}>
            {new Date(row.createdAt).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          {!row.read && (
            <Box
              onClick={e => { e.stopPropagation(); onMarkRead(row.id) }}
              sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.5,
                px: 1.25, py: 0.4, borderRadius: 1, flexShrink: 0,
                border: '1px solid var(--color-accent-3)', color: 'var(--color-accent-3)',
                fontSize: '0.68rem', fontWeight: 600, cursor: 'pointer',
                '&:hover': { bgcolor: 'rgba(42,232,102,0.08)' },
                opacity: markingRead === row.id ? 0.5 : 1,
              }}
            >
              {markingRead === row.id ? <CircularProgress size={10} sx={{ color: 'inherit' }} /> : <DoneIcon sx={{ fontSize: 12 }} />}
              Mark read
            </Box>
          )}
          <ExpandMoreIcon sx={{ fontSize: 18, color: C.textMuted, transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }} />
        </Box>
      </Box>

      {/* ── Expanded body ── */}
      <Collapse in={expanded}>
        <Box sx={{ px: 2, pb: 1.75, pt: 0.25, borderTop: `1px solid ${C.border}` }}>
          <Typography variant="caption" sx={{ display: 'block', color: C.text, lineHeight: 1.65, whiteSpace: 'pre-wrap', fontSize: '0.78rem', mt: 1.25 }}>
            {row.body}
          </Typography>

          {(row.route || row.pubkey || row.userEmail) && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1.25, flexWrap: 'wrap' }}>
              {row.route && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <RouteIcon sx={{ fontSize: 12, color: C.textMuted }} />
                  <Typography variant="caption" sx={{ color: C.textMuted, fontFamily: 'monospace', fontSize: '0.68rem' }}>{row.route}</Typography>
                </Box>
              )}
              {row.pubkey && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <KeyIcon sx={{ fontSize: 12, color: C.textMuted }} />
                  <Typography variant="caption" sx={{ color: C.textMuted, fontFamily: 'monospace', fontSize: '0.68rem' }}>{shortPubkey(row.pubkey)}</Typography>
                </Box>
              )}
              {row.userEmail && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <EmailIcon sx={{ fontSize: 12, color: 'var(--color-accent-3)' }} />
                  <Typography variant="caption" sx={{ color: 'var(--color-accent-3)', fontSize: '0.68rem' }}>{row.userEmail}</Typography>
                </Box>
              )}
            </Box>
          )}

          {/* Reply + Delete action row */}
          <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            {row.userEmail && !sent && (
              <Box
                onClick={() => setReplyOpen(p => !p)}
                sx={{
                  display: 'inline-flex', alignItems: 'center', gap: 0.5,
                  px: 1.5, py: 0.5, borderRadius: 1, cursor: 'pointer',
                  border: `1px solid ${replyOpen ? 'var(--color-accent-1)' : C.border}`,
                  color: replyOpen ? 'var(--color-accent-1)' : C.textMuted,
                  bgcolor: replyOpen ? 'rgba(107,177,255,0.08)' : 'transparent',
                  fontSize: '0.72rem', fontWeight: 600, transition: 'all 0.15s',
                  '&:hover': { borderColor: 'var(--color-accent-1)', color: 'var(--color-accent-1)' },
                }}
              >
                <ReplyIcon sx={{ fontSize: 14 }} />
                Reply via Email
              </Box>
            )}
            {sent && (
              <Chip
                label="Reply sent"
                size="small"
                icon={<DoneIcon sx={{ fontSize: '0.75rem !important' }} />}
                sx={{ height: 20, fontSize: '0.65rem', bgcolor: 'rgba(42,232,102,0.10)', color: 'var(--color-accent-3)' }}
              />
            )}
            {!row.userEmail && (
              <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.68rem', fontStyle: 'italic' }}>
                No email — reply unavailable
              </Typography>
            )}

            {/* ADR-273: delete action comes from the live registry — the
                previous BETA_FEEDBACK_DELETE hardcoded stub is gone. */}
            {deleteAction && (
              <Box sx={{ ml: 'auto' }}>
                <EntityActionButton
                  model="BetaFeedback"
                  id={row.id}
                  action={deleteAction}
                  onSuccess={() => onDeleted(row.id)}
                />
              </Box>
            )}
          </Box>

          {/* Inline compose */}
          <Collapse in={replyOpen}>
            <Box sx={{ mt: 1.5, p: 1.5, borderRadius: 1.5, border: `1px solid var(--color-accent-1)`, bgcolor: 'rgba(107,177,255,0.05)' }}>
              <Typography variant="overline" sx={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.07em', color: C.textMuted, display: 'block', mb: 1 }}>
                Compose reply → {row.userEmail}
              </Typography>
              {sendError && <Alert severity="error" sx={{ mb: 1, py: 0.5, fontSize: '0.75rem' }}>{sendError}</Alert>}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <TextField size="small" label="Subject" value={subject} onChange={e => setSubject(e.target.value)} fullWidth inputProps={{ maxLength: 200 }} sx={composeSx} />
                <TextField size="small" label="Message" value={message} onChange={e => setMessage(e.target.value)} multiline rows={4} fullWidth placeholder="Write your reply…" inputProps={{ maxLength: 4000 }} sx={composeSx} />
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                  <Box onClick={() => setReplyOpen(false)} sx={{ px: 1.5, py: 0.5, borderRadius: 1, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, border: `1px solid ${C.border}`, color: C.textMuted, '&:hover': { color: C.text } }}>
                    Cancel
                  </Box>
                  <Box
                    onClick={handleSendReply}
                    sx={{
                      display: 'inline-flex', alignItems: 'center', gap: 0.5,
                      px: 1.5, py: 0.5, borderRadius: 1,
                      cursor: sending || !subject.trim() || !message.trim() ? 'not-allowed' : 'pointer',
                      bgcolor: 'var(--color-accent-1)', color: '#fff',
                      fontSize: '0.75rem', fontWeight: 700,
                      opacity: sending || !subject.trim() || !message.trim() ? 0.6 : 1,
                      '&:hover': { opacity: 0.85 },
                    }}
                  >
                    {sending ? <CircularProgress size={12} sx={{ color: '#fff' }} /> : <SendIcon sx={{ fontSize: 13 }} />}
                    {sending ? 'Sending…' : 'Send'}
                  </Box>
                </Box>
              </Box>
            </Box>
          </Collapse>
        </Box>
      </Collapse>
    </Paper>
  )
}

// ── Filter state ──────────────────────────────────────────────────────────────
type KindFilter   = 'all' | 'bug' | 'idea' | 'question'
type StatusFilter = 'all' | 'new' | 'triaged' | 'in_progress' | 'shipped' | 'wontfix'

const KIND_FILTERS: { value: KindFilter; label: string; color?: string }[] = [
  { value: 'all',      label: 'All kinds' },
  { value: 'bug',      label: 'Bug',      color: 'var(--color-status-error, #ef4444)' },
  { value: 'idea',     label: 'Idea',     color: 'var(--color-warning-default, #f59e0b)' },
  { value: 'question', label: 'Question', color: 'var(--color-accent-1)' },
]

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all',         label: 'All statuses' },
  { value: 'new',         label: 'New' },
  { value: 'triaged',     label: 'Triaged' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'shipped',     label: 'Shipped' },
  { value: 'wontfix',     label: "Won't fix" },
]

// ── Main section ──────────────────────────────────────────────────────────────
export function FeedbackSection() {
  const [rows, setRows]               = useState<FeedbackRow[]>([])
  const [total, setTotal]             = useState(0)
  const [stats, setStats]             = useState<FeedbackStats | null>(null)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)
  const [markingRead, setMarkingRead] = useState<string | null>(null)
  // ADR-273: pull BetaFeedback action metadata from the registry once per
  // session; the 'delete' action is the only one today but new actions
  // light up automatically.
  const [deleteAction, setDeleteAction] = useState<EntityActionMeta | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchBetaFeedbackActions()
      .then(list => {
        if (cancelled) return
        setDeleteAction(list.find(a => a.key === 'delete') ?? null)
      })
      .catch(() => { if (!cancelled) setDeleteAction(null) })
    return () => { cancelled = true }
  }, [])

  // filters
  const [kindFilter, setKindFilter]     = useState<KindFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [unreadOnly, setUnreadOnly]     = useState(false)
  const [withEmail, setWithEmail]       = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      if (unreadOnly)             qs.set('unread',    'true')
      if (withEmail)              qs.set('withEmail', 'true')
      if (kindFilter   !== 'all') qs.set('kind',   kindFilter)
      if (statusFilter !== 'all') qs.set('status', statusFilter)
      const res  = await apiCall(`/api/admin/feedback?${qs}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load')
      setRows(data.feedback ?? [])
      setTotal(data.total ?? 0)
      setStats(data.stats ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }, [unreadOnly, withEmail, kindFilter, statusFilter])

  useEffect(() => { load() }, [load])

  async function handleMarkRead(id: string) {
    setMarkingRead(id)
    try {
      const res = await apiCall(`/api/admin/feedback/${id}/read`, { method: 'PATCH' })
      if (res.ok) setRows(prev => prev.map(r => r.id === id ? { ...r, read: true } : r))
    } catch { /* non-fatal */ }
    setMarkingRead(null)
  }

  function handleReplySent(id: string) {
    setRows(prev => prev.map(r =>
      r.id === id ? { ...r, read: true, status: r.status === 'new' ? 'triaged' : r.status } : r
    ))
  }

  async function handleDeleted(id: string) {
    // Optimistic UI: drop the row locally; refresh from server so stats
    // (count, unread) stay consistent.
    setRows(prev => prev.filter(r => r.id !== id))
    setTotal(prev => Math.max(0, prev - 1))
    await load()
  }

  const totalAll     = stats ? Object.values(stats.byKind).reduce((a, b) => a + b, 0) : 0
  const firstLoad    = loading && !stats

  return (
    <Box>
      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={700} sx={{ color: C.text, mb: 0.5 }}>Feedback</Typography>
          <Typography variant="body2" sx={{ color: C.textMuted }}>
            Beta user feedback inbox
          </Typography>
        </Box>
        <Box
          onClick={load}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: C.textMuted, '&:hover': { color: C.text } }}
        >
          <RefreshIcon sx={{ fontSize: 16 }} />
          <Typography variant="caption" sx={{ fontSize: '0.72rem' }}>Refresh</Typography>
        </Box>
      </Box>

      {/* ── KPI Strip ── */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(3, 1fr)', sm: 'repeat(6, 1fr)' },
          gap: 1,
          mb: 2.5,
        }}
      >
        <KpiCard icon={<InboxIcon sx={{ fontSize: 16 }} />}          label="Total"     value={firstLoad ? '…' : totalAll}            loading={firstLoad} />
        <KpiCard icon={<MarkEmailReadIcon sx={{ fontSize: 16 }} />}  label="Unread"    value={firstLoad ? '…' : stats?.unread ?? 0}   accent="var(--color-status-error, #ef4444)" loading={firstLoad} />
        <KpiCard icon={<BugReportIcon sx={{ fontSize: 16 }} />}      label="Bugs"      value={firstLoad ? '…' : stats?.byKind.bug ?? 0}      accent="var(--color-status-error, #ef4444)" loading={firstLoad} />
        <KpiCard icon={<LightbulbIcon sx={{ fontSize: 16 }} />}      label="Ideas"     value={firstLoad ? '…' : stats?.byKind.idea ?? 0}     accent="var(--color-warning-default, #f59e0b)" loading={firstLoad} />
        <KpiCard icon={<HelpOutlineIcon sx={{ fontSize: 16 }} />}    label="Questions" value={firstLoad ? '…' : stats?.byKind.question ?? 0}  accent="var(--color-accent-1)" loading={firstLoad} />
        <KpiCard icon={<EmailIcon sx={{ fontSize: 16 }} />}          label="With Email" value={firstLoad ? '…' : stats?.withEmail ?? 0} accent="var(--color-accent-3)" loading={firstLoad} />
      </Box>

      {/* ── Filter bar ── */}
      <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface, px: 2, py: 1.5, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1.25 }}>
          <FilterListIcon sx={{ fontSize: 15, color: C.textMuted }} />
          <Typography variant="overline" sx={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.07em', color: C.textMuted }}>
            Filters
          </Typography>
        </Box>

        {/* Kind row */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mb: 1 }}>
          {KIND_FILTERS.map(f => (
            <FilterChip
              key={f.value}
              label={f.label}
              active={kindFilter === f.value}
              color={f.color}
              onClick={() => setKindFilter(f.value)}
            />
          ))}
        </Box>

        {/* Status row */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mb: 1 }}>
          {STATUS_FILTERS.map(f => (
            <FilterChip
              key={f.value}
              label={f.label}
              active={statusFilter === f.value}
              onClick={() => setStatusFilter(f.value)}
            />
          ))}
        </Box>

        {/* Toggle row */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FilterChip
            label="Unread only"
            active={unreadOnly}
            color="var(--color-status-error, #ef4444)"
            onClick={() => setUnreadOnly(v => !v)}
          />
          <FilterChip
            label="Has email"
            active={withEmail}
            color="var(--color-accent-3)"
            onClick={() => setWithEmail(v => !v)}
          />
          {(kindFilter !== 'all' || statusFilter !== 'all' || unreadOnly || withEmail) && (
            <Box
              onClick={() => { setKindFilter('all'); setStatusFilter('all'); setUnreadOnly(false); setWithEmail(false) }}
              sx={{ cursor: 'pointer', color: C.textMuted, fontSize: '0.68rem', ml: 'auto', '&:hover': { color: C.text } }}
            >
              Clear filters
            </Box>
          )}
        </Box>
      </Paper>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Result count */}
      <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.7rem', display: 'block', mb: 1.25 }}>
        {loading ? 'Loading…' : `${total} result${total !== 1 ? 's' : ''}`}
      </Typography>

      {/* ── List ── */}
      {loading && rows.length === 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={72} sx={{ borderRadius: 2, bgcolor: C.border }} />
          ))}
        </Box>
      ) : rows.length === 0 ? (
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, py: 6, textAlign: 'center', bgcolor: C.surface }}>
          <Typography variant="caption" sx={{ color: C.textMuted }}>No feedback matches the current filters.</Typography>
        </Paper>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {rows.map(row => (
            <FeedbackCard
              key={row.id}
              row={row}
              onMarkRead={handleMarkRead}
              markingRead={markingRead}
              onReplySent={handleReplySent}
              onDeleted={handleDeleted}
              deleteAction={deleteAction}
            />
          ))}
        </Box>
      )}
    </Box>
  )
}
