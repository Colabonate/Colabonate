// FU-681 + ADR-371 admin-visibility ask: one Admin page surfacing the
// launch-relevant signals that live nowhere else — cap/rate-limit reject
// counters (FU-681), the current Go-Launch-Gate snapshot (G1-G10, from
// docs/plans/PRODUCT-LAUNCH-MASTERPLAN.md), the ADR-370 canvas go-live proxy
// signals, and the FU-662 escrow-trade-desk flag as this server sees it.
import { useState, useEffect, useCallback } from 'react'
import {
  Box, Paper, Typography, Chip, CircularProgress, Skeleton, Alert,
  Table, TableBody, TableCell, TableHead, TableRow, Tooltip,
} from '@mui/material'
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch'
import RefreshIcon from '@mui/icons-material/Refresh'
import BlockIcon from '@mui/icons-material/Block'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { Seo } from '../../components/Seo'
import { apiCall } from '../../lib/api'

const C = {
  text:      'var(--theme-text)',
  textMuted: 'var(--theme-text-muted)',
  border:    'var(--theme-border)',
  surface:   'var(--theme-surface)',
  accent:    'var(--color-warning-default, #f59e0b)',
} as const

type RateLimitBucket = 'unauth' | 'auth' | 'search' | 'email-auth' | 'email'
type GateStatus = 'done' | 'partial' | 'open'

interface LaunchGate {
  id: string
  label: string
  owner: string
  status: GateStatus
  precondition: string
  subPlan: string
  note: string
}

interface LaunchReadinessData {
  cap: { launchMaxTxSats: number | null; rejectionsTotal: number }
  rateLimit: { rejections: Record<RateLimitBucket, number> }
  canvas: { doopServiceConfigured: boolean; canvasRunnerConfigured: boolean; note: string }
  escrowTradeDesk: { envValueSeenByServer: string | null; caveat: string }
  gates: LaunchGate[]
}

const GATE_STATUS_COLOR: Record<GateStatus, { color: string; label: string }> = {
  done:    { color: 'var(--color-status-success, #23CA61)', label: 'Done' },
  partial: { color: '#f59e0b',                              label: 'Partial' },
  open:    { color: 'var(--color-status-error, #DA1414)',   label: 'Open' },
}

function CounterCard({ label, value, loading, warn }: { label: string; value: number; loading?: boolean; warn?: boolean }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 2,
        borderColor: warn ? C.accent : C.border,
        bgcolor: C.surface,
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
      }}
    >
      {loading ? (
        <>
          <Skeleton variant="text" width={40} height={32} sx={{ bgcolor: 'rgba(0,0,0,0.08)' }} />
          <Skeleton variant="text" width={70} height={16} sx={{ bgcolor: 'rgba(0,0,0,0.08)' }} />
        </>
      ) : (
        <>
          <Typography sx={{ fontSize: '1.4rem', fontWeight: 700, lineHeight: 1.1, color: warn ? C.accent : C.text, fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </Typography>
          <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.03em' }}>
            {label}
          </Typography>
        </>
      )}
    </Paper>
  )
}

function SectionLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1.5 }}>
      <Typography variant="overline" sx={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', color: C.textMuted }}>
        {label}
      </Typography>
      {hint && (
        <Tooltip title={hint}>
          <InfoOutlinedIcon sx={{ fontSize: 14, color: C.textMuted }} />
        </Tooltip>
      )}
    </Box>
  )
}

function BoolChip({ value }: { value: boolean }) {
  return (
    <Chip
      icon={value ? undefined : <BlockIcon sx={{ fontSize: '0.8rem !important' }} />}
      label={value ? 'configured' : 'not configured'}
      size="small"
      sx={{
        height: 20, fontSize: '0.65rem', fontWeight: 700,
        bgcolor: value ? 'rgba(35, 202, 97, 0.12)' : 'rgba(218, 20, 20, 0.10)',
        color: value ? 'var(--color-status-success, #23CA61)' : 'var(--color-status-error, #DA1414)',
      }}
    />
  )
}

const RATE_LIMIT_LABELS: Record<RateLimitBucket, string> = {
  unauth: 'Unauth (120/min)',
  auth: 'Authenticated (300/min)',
  search: 'Search (240/min)',
  'email-auth': 'Magic-link (30/h)',
  email: 'Feedback/Newsletter (5/h)',
}

export function AdminLaunchReadinessPage() {
  const [data, setData] = useState<LaunchReadinessData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiCall('/api/admin/launch-readiness')
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message || body?.error || `HTTP ${res.status}`)
      }
      const body = await res.json() as LaunchReadinessData
      setData(body)
      setLastChecked(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load launch readiness data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 60_000)
    return () => clearInterval(interval)
  }, [load])

  const firstLoad = loading && !data
  const doneCount = data?.gates.filter((g) => g.status === 'done').length ?? 0
  const totalGates = data?.gates.length ?? 10

  return (
    <Box>
      <Seo noindex title="Launch Readiness — Admin" />
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <RocketLaunchIcon sx={{ color: C.accent }} />
          <Typography variant="h6" fontWeight={700} sx={{ color: C.text }}>
            Launch Readiness
          </Typography>
          <Chip
            label={`${doneCount}/${totalGates} gates done`}
            size="small"
            sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700, bgcolor: 'var(--theme-bg)', color: C.textMuted }}
          />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {lastChecked && !loading && (
            <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.68rem' }}>
              {lastChecked.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </Typography>
          )}
          {loading && <CircularProgress size={12} sx={{ color: C.textMuted }} />}
          <Box onClick={load} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: C.textMuted, '&:hover': { color: C.text } }}>
            <RefreshIcon sx={{ fontSize: 14 }} />
            <Typography variant="caption" sx={{ fontSize: '0.68rem' }}>Refresh</Typography>
          </Box>
        </Box>
      </Box>
      <Typography variant="body2" sx={{ color: C.textMuted, mb: 3 }}>
        Product-Launch-Masterplan Go-Launch-Gate snapshot (G1–G10) + FU-681 cap/rate-limit reject counters — refreshes every 60s.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* ── FU-681 counters ── */}
      <SectionLabel label="Cap / Rate-Limit Rejections (FU-681)" hint="All-time totals since the counters were introduced. Persisted in Redis when reachable, otherwise reset on server restart." />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(6, 1fr)' }, gap: 1.5, mb: 3 }}>
        <CounterCard
          label={`Launch cap (${data?.cap.launchMaxTxSats?.toLocaleString('de-DE') ?? '—'} sats)`}
          value={data?.cap.rejectionsTotal ?? 0}
          loading={firstLoad}
          warn={(data?.cap.rejectionsTotal ?? 0) > 0}
        />
        {(Object.keys(RATE_LIMIT_LABELS) as RateLimitBucket[]).map((bucket) => (
          <CounterCard
            key={bucket}
            label={RATE_LIMIT_LABELS[bucket]}
            value={data?.rateLimit.rejections[bucket] ?? 0}
            loading={firstLoad}
            warn={(data?.rateLimit.rejections[bucket] ?? 0) > 0}
          />
        ))}
      </Box>

      {/* ── ADR-370 / FU-662 proxy status ── */}
      <SectionLabel label="Other Launch-Relevant Flags" />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5, mb: 3 }}>
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface, p: 2 }}>
          <Typography variant="body2" fontWeight={700} sx={{ mb: 1 }}>Canvas Go-Live (ADR-370)</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="caption" sx={{ color: C.textMuted }}>doop service:</Typography>
              <BoolChip value={data?.canvas.doopServiceConfigured ?? false} />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="caption" sx={{ color: C.textMuted }}>canvas runner:</Typography>
              <BoolChip value={data?.canvas.canvasRunnerConfigured ?? false} />
            </Box>
          </Box>
          <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.7rem' }}>
            {data?.canvas.note}
          </Typography>
        </Paper>
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface, p: 2 }}>
          <Typography variant="body2" fontWeight={700} sx={{ mb: 1 }}>Escrow Trade Desk (FU-662)</Typography>
          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', mb: 1 }}>
            VITE_ESCROW_TRADE_DESK = {data?.escrowTradeDesk.envValueSeenByServer ?? <em>unset</em>}
          </Typography>
          <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.7rem' }}>
            {data?.escrowTradeDesk.caveat}
          </Typography>
        </Paper>
      </Box>

      {/* ── Go-Launch Gates ── */}
      <SectionLabel label="Go-Launch Gates (G1–G10)" />
      <Paper variant="outlined" sx={{ borderColor: C.border, bgcolor: C.surface, overflowX: 'auto' }}>
        {firstLoad ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Gate</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Owner</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Sub-Plan</TableCell>
                <TableCell>Note</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.gates ?? []).map((g) => {
                const s = GATE_STATUS_COLOR[g.status]
                return (
                  <TableRow key={g.id} hover>
                    <TableCell><Typography variant="body2" fontWeight={700}>{g.id}</Typography></TableCell>
                    <TableCell><Typography variant="body2">{g.label}</Typography></TableCell>
                    <TableCell><Typography variant="caption" sx={{ color: C.textMuted }}>{g.owner}</Typography></TableCell>
                    <TableCell>
                      <Chip
                        label={s.label}
                        size="small"
                        sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700, bgcolor: 'transparent', border: `1px solid ${s.color}`, color: s.color }}
                      />
                    </TableCell>
                    <TableCell><Typography variant="caption" sx={{ color: C.textMuted }}>{g.subPlan}</Typography></TableCell>
                    <TableCell><Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.7rem' }}>{g.note}</Typography></TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Paper>
      <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: C.textMuted, fontSize: '0.68rem' }}>
        Gate statuses are a manually maintained snapshot (server: lib/launch-gates.ts) — most gates are founder/operator decisions no server-side check can verify live.
      </Typography>
    </Box>
  )
}
