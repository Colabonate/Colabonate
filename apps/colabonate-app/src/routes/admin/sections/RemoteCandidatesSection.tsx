import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Paper,
  Typography,
  CircularProgress,
  Alert,
  Chip,
  Skeleton,
  LinearProgress,
  Switch,
  TextField,
} from '@mui/material'
import RefreshIcon      from '@mui/icons-material/Refresh'
import CloudSyncIcon    from '@mui/icons-material/CloudSync'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import CheckCircleIcon  from '@mui/icons-material/CheckCircle'
import CancelIcon       from '@mui/icons-material/Cancel'
import EventBusyIcon    from '@mui/icons-material/EventBusy'
import DoneAllIcon      from '@mui/icons-material/DoneAll'
import FilterListIcon   from '@mui/icons-material/FilterList'
import { apiCall, ApiError } from '../../../lib/api'

const C = {
  text:      'var(--theme-text)',
  textMuted: 'var(--theme-text-muted)',
  border:    'var(--theme-border)',
  surface:   'var(--theme-surface)',
  bgSubtle:  'var(--theme-bg-subtle)',
  accent:    'var(--color-warning-default, #f59e0b)',
} as const

interface Stats {
  PENDING_REVIEW: number
  APPROVED: number
  REJECTED: number
  EXPIRED: number
}

interface CandidateRow {
  id: string
  remoteRelay: string
  remoteAuthor: string
  status: string
  fetchedAt: string
  normalized: { title?: string; category?: string; gammaTags?: string[]; priceSats?: number } | null
}

type StatusFilter = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'EXPIRED'

// ADR-423: auto-approval slice of GET/PATCH /api/admin/foundation-settings
interface AutoApproveSettings {
  remoteCandidatesAutoApprove: boolean
  remoteCandidatesAutoApproveDays: number | null
  updatedBy: string | null
  updatedAt: string | null
}

const AUTO_APPROVE_DAYS_MIN = 1
const AUTO_APPROVE_DAYS_MAX = 29
const AUTO_APPROVE_DAYS_DEFAULT = 7

const STATUS_FILTERS: { value: StatusFilter; label: string; icon: React.ReactNode }[] = [
  { value: 'PENDING_REVIEW', label: 'Pending',  icon: <HourglassEmptyIcon sx={{ fontSize: 14 }} /> },
  { value: 'APPROVED',       label: 'Approved', icon: <CheckCircleIcon sx={{ fontSize: 14 }} /> },
  { value: 'REJECTED',       label: 'Rejected', icon: <CancelIcon sx={{ fontSize: 14 }} /> },
  { value: 'EXPIRED',        label: 'Expired',  icon: <EventBusyIcon sx={{ fontSize: 14 }} /> },
]

function shortPubkey(pk: string) { return pk.length > 16 ? pk.slice(0, 8) + '…' + pk.slice(-6) : pk }

function KpiCard({ icon, label, value, accent, loading }: {
  icon: React.ReactNode; label: string; value: number | string; accent?: string; loading?: boolean
}) {
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: accent ?? C.border, bgcolor: accent ? `${accent}10` : C.surface, p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
      {loading ? (
        <><Skeleton variant="text" width={40} height={28} sx={{ bgcolor: C.border }} /><Skeleton variant="text" width={56} height={14} sx={{ bgcolor: C.border }} /></>
      ) : (
        <>
          <Typography sx={{ fontSize: '1.35rem', fontWeight: 700, lineHeight: 1.1, color: accent ?? C.text, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ color: accent ?? C.textMuted, display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</Box>
            <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.04em', lineHeight: 1.2 }}>{label}</Typography>
          </Box>
        </>
      )}
    </Paper>
  )
}

function FilterChip({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.5,
        px: 1.25, py: 0.4, borderRadius: 1, cursor: 'pointer',
        fontSize: '0.72rem', fontWeight: active ? 700 : 500,
        border: '1px solid', borderColor: active ? C.accent : C.border,
        color: active ? C.accent : C.textMuted,
        bgcolor: active ? `${C.accent}12` : 'transparent',
        transition: 'all 0.12s', whiteSpace: 'nowrap',
        '&:hover': { borderColor: C.accent, color: C.accent },
      }}
    >
      {icon}{label}
    </Box>
  )
}

function CandidateCard({ row, onApprove, onReject, busyId }: {
  row: CandidateRow
  onApprove: (id: string) => void
  onReject: (id: string) => void
  busyId: string | null
}) {
  const busy = busyId === row.id
  const title = row.normalized?.title || '(untitled)'
  const tags = row.normalized?.gammaTags ?? []
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface, px: 2, py: 1.25 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap' }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontWeight: 600, fontSize: '0.85rem', color: C.text, lineHeight: 1.3 }}>{title}</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
            <Typography variant="caption" sx={{ color: C.textMuted, fontFamily: 'monospace', fontSize: '0.66rem' }}>{row.remoteRelay}</Typography>
            <Typography variant="caption" sx={{ color: C.textMuted, fontFamily: 'monospace', fontSize: '0.66rem' }}>{shortPubkey(row.remoteAuthor)}</Typography>
            {tags.map(t => (
              <Chip key={t} label={t} size="small" sx={{ height: 16, fontSize: '0.6rem', bgcolor: C.bgSubtle, color: C.textMuted }} />
            ))}
          </Box>
        </Box>
        {row.status === 'PENDING_REVIEW' && (
          <Box sx={{ display: 'flex', gap: 0.75, flexShrink: 0 }}>
            <Box
              onClick={() => !busy && onReject(row.id)}
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.4, borderRadius: 1, cursor: busy ? 'not-allowed' : 'pointer', border: `1px solid var(--color-status-error, #ef4444)`, color: 'var(--color-status-error, #ef4444)', fontSize: '0.68rem', fontWeight: 600, opacity: busy ? 0.5 : 1, '&:hover': { bgcolor: 'rgba(239,68,68,0.08)' } }}
            >
              {busy ? <CircularProgress size={10} sx={{ color: 'inherit' }} /> : <CancelIcon sx={{ fontSize: 12 }} />}
              Reject
            </Box>
            <Box
              onClick={() => !busy && onApprove(row.id)}
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.4, borderRadius: 1, cursor: busy ? 'not-allowed' : 'pointer', border: `1px solid var(--color-accent-3)`, color: 'var(--color-accent-3)', fontSize: '0.68rem', fontWeight: 600, opacity: busy ? 0.5 : 1, '&:hover': { bgcolor: 'rgba(42,232,102,0.08)' } }}
            >
              {busy ? <CircularProgress size={10} sx={{ color: 'inherit' }} /> : <CheckCircleIcon sx={{ fontSize: 12 }} />}
              Approve
            </Box>
          </Box>
        )}
      </Box>
    </Paper>
  )
}

export function RemoteCandidatesSection() {
  const [rows, setRows]     = useState<CandidateRow[]>([])
  const [total, setTotal]   = useState(0)
  const [stats, setStats]   = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('PENDING_REVIEW')

  // Bulk approve-all progress
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkApproved, setBulkApproved] = useState(0)
  const [bulkFailed, setBulkFailed] = useState(0)
  const [bulkError, setBulkError] = useState<string | null>(null)

  // Auto-approval settings (ADR-423)
  const [autoSettings, setAutoSettings] = useState<AutoApproveSettings | null>(null)
  const [daysInput, setDaysInput] = useState(String(AUTO_APPROVE_DAYS_DEFAULT))
  const [savingKey, setSavingKey] = useState<'auto' | 'days' | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  const loadSettings = useCallback(async () => {
    try {
      const res = await apiCall('/api/admin/foundation-settings')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load settings')
      const s = data.settings
      setAutoSettings({
        remoteCandidatesAutoApprove: Boolean(s?.remoteCandidatesAutoApprove),
        remoteCandidatesAutoApproveDays: s?.remoteCandidatesAutoApproveDays ?? null,
        updatedBy: s?.updatedBy ?? null,
        updatedAt: s?.updatedAt ?? null,
      })
      setDaysInput(String(s?.remoteCandidatesAutoApproveDays ?? AUTO_APPROVE_DAYS_DEFAULT))
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : 'Failed to load settings')
    }
  }, [])

  useEffect(() => { loadSettings() }, [loadSettings])

  async function saveAutoSetting(patch: Record<string, boolean | number | null>, key: 'auto' | 'days') {
    setSavingKey(key)
    setSettingsError(null)
    try {
      const res = await apiCall('/api/admin/foundation-settings', { method: 'PATCH', body: JSON.stringify(patch) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail ?? data.error ?? 'Save failed')
      const s = data.settings
      setAutoSettings({
        remoteCandidatesAutoApprove: Boolean(s?.remoteCandidatesAutoApprove),
        remoteCandidatesAutoApproveDays: s?.remoteCandidatesAutoApproveDays ?? null,
        updatedBy: s?.updatedBy ?? null,
        updatedAt: s?.updatedAt ?? null,
      })
    } catch (e) {
      // apiCall throws ApiError for every non-OK — surface the validator detail when present
      const detail = e instanceof ApiError && e.data?.detail ? String(e.data.detail) : null
      setSettingsError(detail ?? (e instanceof Error ? e.message : 'Save failed'))
    } finally {
      setSavingKey(null)
    }
  }

  const immediateOn = autoSettings?.remoteCandidatesAutoApprove === true
  const timerOn = autoSettings?.remoteCandidatesAutoApproveDays != null

  function toggleImmediate(checked: boolean) {
    void saveAutoSetting({ remoteCandidatesAutoApprove: checked }, 'auto')
  }

  function toggleTimer(checked: boolean) {
    if (checked) {
      const days = Number.parseInt(daysInput, 10)
      const valid = Number.isInteger(days) && days >= AUTO_APPROVE_DAYS_MIN && days <= AUTO_APPROVE_DAYS_MAX
        ? days : AUTO_APPROVE_DAYS_DEFAULT
      setDaysInput(String(valid))
      void saveAutoSetting({ remoteCandidatesAutoApproveDays: valid }, 'days')
    } else {
      void saveAutoSetting({ remoteCandidatesAutoApproveDays: null }, 'days')
    }
  }

  function commitDays() {
    if (!timerOn) return
    const days = Number.parseInt(daysInput, 10)
    if (!Number.isInteger(days) || days < AUTO_APPROVE_DAYS_MIN || days > AUTO_APPROVE_DAYS_MAX) {
      setSettingsError(`Days must be an integer between ${AUTO_APPROVE_DAYS_MIN} and ${AUTO_APPROVE_DAYS_MAX}`)
      setDaysInput(String(autoSettings?.remoteCandidatesAutoApproveDays ?? AUTO_APPROVE_DAYS_DEFAULT))
      return
    }
    if (days === autoSettings?.remoteCandidatesAutoApproveDays) return
    void saveAutoSetting({ remoteCandidatesAutoApproveDays: days }, 'days')
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [listRes, statsRes] = await Promise.all([
        apiCall(`/api/admin/remote-candidates?status=${statusFilter}&limit=30`),
        apiCall('/api/admin/remote-candidates/stats'),
      ])
      const listData = await listRes.json()
      const statsData = await statsRes.json()
      if (!listRes.ok) throw new Error(listData.error ?? 'Failed to load')
      setRows(listData.candidates ?? [])
      setTotal(listData.pagination?.total ?? 0)
      if (statsRes.ok) setStats(statsData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  async function handleApprove(id: string) {
    setBusyId(id)
    try {
      const res = await apiCall(`/api/admin/remote-candidates/${id}/approve`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Approve failed')
      setRows(prev => prev.filter(r => r.id !== id))
      setTotal(prev => Math.max(0, prev - 1))
      setStats(prev => prev ? { ...prev, PENDING_REVIEW: Math.max(0, prev.PENDING_REVIEW - 1), APPROVED: prev.APPROVED + 1 } : prev)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approve failed')
    } finally {
      setBusyId(null)
    }
  }

  async function handleReject(id: string) {
    setBusyId(id)
    try {
      const res = await apiCall(`/api/admin/remote-candidates/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason: 'manual reject via admin panel' }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Reject failed')
      setRows(prev => prev.filter(r => r.id !== id))
      setTotal(prev => Math.max(0, prev - 1))
      setStats(prev => prev ? { ...prev, PENDING_REVIEW: Math.max(0, prev.PENDING_REVIEW - 1), REJECTED: prev.REJECTED + 1 } : prev)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reject failed')
    } finally {
      setBusyId(null)
    }
  }

  // Loops the batch endpoint (100 at a time) until nothing PENDING_REVIEW is
  // left — keeps each HTTP request short instead of one giant call that could
  // hit the proxy's 120s read timeout on a large backlog.
  async function handleApproveAll() {
    setBulkRunning(true)
    setBulkApproved(0)
    setBulkFailed(0)
    setBulkError(null)
    try {
      let remaining = Infinity
      let guard = 0
      while (remaining > 0 && guard < 100) {
        guard++
        const res = await apiCall('/api/admin/remote-candidates/approve-all', { method: 'POST', body: JSON.stringify({ limit: 100 }) })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'approve-all failed')
        setBulkApproved(prev => prev + data.approved)
        setBulkFailed(prev => prev + data.failed)
        remaining = data.remainingPending
      }
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setBulkRunning(false)
      await load()
    }
  }

  const firstLoad = loading && !stats

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={700} sx={{ color: C.text, mb: 0.5 }}>Remote Offer Candidates</Typography>
          <Typography variant="body2" sx={{ color: C.textMuted }}>Nostr listings ingested from external relays — review before they go live (ADR-145)</Typography>
        </Box>
        <Box onClick={load} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: C.textMuted, '&:hover': { color: C.text } }}>
          <RefreshIcon sx={{ fontSize: 16 }} />
          <Typography variant="caption" sx={{ fontSize: '0.72rem' }}>Refresh</Typography>
        </Box>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' }, gap: 1, mb: 2.5 }}>
        <KpiCard icon={<HourglassEmptyIcon sx={{ fontSize: 16 }} />} label="Pending"  value={firstLoad ? '…' : stats?.PENDING_REVIEW ?? 0} accent="var(--color-warning-default, #f59e0b)" loading={firstLoad} />
        <KpiCard icon={<CheckCircleIcon sx={{ fontSize: 16 }} />}    label="Approved" value={firstLoad ? '…' : stats?.APPROVED ?? 0}       accent="var(--color-accent-3)" loading={firstLoad} />
        <KpiCard icon={<CancelIcon sx={{ fontSize: 16 }} />}         label="Rejected" value={firstLoad ? '…' : stats?.REJECTED ?? 0}       loading={firstLoad} />
        <KpiCard icon={<EventBusyIcon sx={{ fontSize: 16 }} />}      label="Expired"  value={firstLoad ? '…' : stats?.EXPIRED ?? 0}        loading={firstLoad} />
      </Box>

      {/* Bulk approve */}
      <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.accent, bgcolor: `${C.accent}08`, px: 2, py: 1.5, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap' }}>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', color: C.text }}>Approve all pending candidates</Typography>
            <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.7rem' }}>
              Runs in batches of 100. No per-item review — use this for an initial bulk import, refine individually later.
            </Typography>
          </Box>
          <Box
            onClick={() => !bulkRunning && (stats?.PENDING_REVIEW ?? 0) > 0 && handleApproveAll()}
            sx={{
              display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.75, borderRadius: 1, flexShrink: 0,
              cursor: bulkRunning || !(stats?.PENDING_REVIEW ?? 0) ? 'not-allowed' : 'pointer',
              bgcolor: C.accent, color: '#fff', fontSize: '0.78rem', fontWeight: 700,
              opacity: bulkRunning || !(stats?.PENDING_REVIEW ?? 0) ? 0.6 : 1,
              '&:hover': { opacity: 0.88 },
            }}
          >
            {bulkRunning ? <CircularProgress size={13} sx={{ color: '#fff' }} /> : <DoneAllIcon sx={{ fontSize: 15 }} />}
            {bulkRunning ? `Approving… ${bulkApproved} done` : `Approve all (${stats?.PENDING_REVIEW ?? 0} pending)`}
          </Box>
        </Box>
        {bulkRunning && <LinearProgress sx={{ mt: 1.25, borderRadius: 1 }} />}
        {!bulkRunning && (bulkApproved > 0 || bulkFailed > 0) && (
          <Typography variant="caption" sx={{ display: 'block', mt: 1, color: C.textMuted, fontSize: '0.7rem' }}>
            Last run: {bulkApproved} approved{bulkFailed > 0 ? `, ${bulkFailed} failed normalization (auto-rejected)` : ''}.
          </Typography>
        )}
        {bulkError && <Alert severity="error" sx={{ mt: 1, py: 0.5, fontSize: '0.75rem' }}>{bulkError}</Alert>}
      </Paper>

      {/* Auto-approval (ADR-423) */}
      <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface, px: 2.5, py: 2, mb: 2 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '0.82rem', color: C.text }}>Auto-approval</Typography>
        <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.7rem', display: 'block', mb: 1.5 }}>
          Runs on a background tick (~every 15 min). Rejected candidates stay rejected — review and reject any time before a mode approves.
        </Typography>

        {/* Immediate mode */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, py: 1.25, borderTop: `1px solid ${C.border}` }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: C.text }}>Auto-approve new remote candidates</Typography>
            <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.7rem' }}>
              Every new ingested listing goes live automatically. Overrides the timer below.
            </Typography>
          </Box>
          {savingKey === 'auto'
            ? <CircularProgress size={18} sx={{ flexShrink: 0 }} />
            : (
              <Switch
                checked={immediateOn}
                onChange={(e) => toggleImmediate(e.target.checked)}
                inputProps={{ 'aria-label': 'Auto-approve new remote candidates' }}
              />
            )}
        </Box>

        {/* Timer mode */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, py: 1.25, borderTop: `1px solid ${C.border}`, opacity: immediateOn ? 0.55 : 1 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: C.text }}>Timer: approve pending candidates after N days</Typography>
            <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.7rem' }}>
              Curation window — reject manually within N days; anything still pending after that is approved automatically.
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
            <TextField
              size="small"
              type="number"
              value={daysInput}
              onChange={(e) => setDaysInput(e.target.value)}
              onBlur={commitDays}
              disabled={!timerOn || immediateOn || savingKey === 'days'}
              slotProps={{ htmlInput: { min: AUTO_APPROVE_DAYS_MIN, max: AUTO_APPROVE_DAYS_MAX, 'aria-label': 'Auto-approve timer in days' } }}
              sx={{ width: 88, '& input': { py: 0.75, fontSize: '0.8rem', textAlign: 'center' } }}
            />
            {savingKey === 'days'
              ? <CircularProgress size={18} />
              : (
                <Switch
                  checked={timerOn}
                  disabled={immediateOn}
                  onChange={(e) => toggleTimer(e.target.checked)}
                  inputProps={{ 'aria-label': 'Auto-approve pending candidates after N days' }}
                />
              )}
          </Box>
        </Box>

        {autoSettings?.updatedAt && (
          <Typography variant="caption" sx={{ display: 'block', mt: 1, color: C.textMuted, fontSize: '0.68rem' }}>
            Last updated {new Date(autoSettings.updatedAt).toLocaleString()}{autoSettings.updatedBy ? ` by ${autoSettings.updatedBy === 'system' ? 'system' : shortPubkey(autoSettings.updatedBy)}` : ''}
          </Typography>
        )}
        {settingsError && <Alert severity="error" sx={{ mt: 1, py: 0.5, fontSize: '0.75rem' }}>{settingsError}</Alert>}
      </Paper>

      {/* Status filter */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1.5, flexWrap: 'wrap' }}>
        <FilterListIcon sx={{ fontSize: 15, color: C.textMuted }} />
        {STATUS_FILTERS.map(f => (
          <FilterChip key={f.value} label={f.label} icon={f.icon} active={statusFilter === f.value} onClick={() => setStatusFilter(f.value)} />
        ))}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.7rem', display: 'block', mb: 1.25 }}>
        {loading ? 'Loading…' : `${total} result${total !== 1 ? 's' : ''}${total > rows.length ? ` (showing first ${rows.length})` : ''}`}
      </Typography>

      {loading && rows.length === 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={64} sx={{ borderRadius: 2, bgcolor: C.border }} />
          ))}
        </Box>
      ) : rows.length === 0 ? (
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, py: 6, textAlign: 'center', bgcolor: C.surface }}>
          <CloudSyncIcon sx={{ fontSize: 24, color: C.textMuted, mb: 1 }} />
          <Typography variant="caption" sx={{ color: C.textMuted, display: 'block' }}>No candidates match this filter.</Typography>
        </Paper>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {rows.map(row => (
            <CandidateCard key={row.id} row={row} onApprove={handleApprove} onReject={handleReject} busyId={busyId} />
          ))}
        </Box>
      )}
    </Box>
  )
}
