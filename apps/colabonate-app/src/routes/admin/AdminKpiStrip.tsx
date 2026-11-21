import { useState, useEffect, useCallback } from 'react'
import { Box, Paper, Typography, CircularProgress, Skeleton, Divider, Alert } from '@mui/material'
import PeopleAltIcon from '@mui/icons-material/PeopleAlt'
import PublicIcon from '@mui/icons-material/Public'
import LocalOfferIcon from '@mui/icons-material/LocalOffer'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import FeedbackIcon from '@mui/icons-material/Feedback'
import BoltIcon from '@mui/icons-material/Bolt'
import ManageHistoryIcon from '@mui/icons-material/ManageHistory'
import RefreshIcon from '@mui/icons-material/Refresh'
import { apiCall } from '../../lib/api'
import { formatSats } from '../../lib/currency'
import { useBetaMode } from '../../hooks/useBetaMode'
import { ActiveUsersChip } from './ActiveUsersChip'

const C = {
  text:      'var(--theme-text)',
  textMuted: 'var(--theme-text-muted)',
  border:    'var(--theme-border)',
  surface:   'var(--theme-surface)',
  accent:    'var(--color-warning-default, #f59e0b)',
} as const

// ── KPI Cards ────────────────────────────────────────────────────────────────

interface Metrics {
  users:       { total: number; new7d: number; active: number; remote: number }
  offers:      { total: number }
  tickets:     { total: number; active: number }
  sessions:    { total: number; active: number }
  feedback:    { total: number; unread: number }
  demoWallets: { count: number; totalSats: number }
  auditLogs:   { total: number }
}

interface KpiCardProps {
  icon: React.ReactNode
  label: string
  value: number | string
  sub?: string
  highlight?: boolean
  loading?: boolean
}

function KpiCard({ icon, label, value, sub, highlight, loading }: KpiCardProps) {
  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 2,
        borderColor: highlight ? C.accent : C.border,
        bgcolor: C.surface,
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
      }}
    >
      {loading ? (
        <>
          <Skeleton variant="text" width={56} height={32} sx={{ bgcolor: 'rgba(0,0,0,0.08)' }} />
          <Skeleton variant="text" width={80} height={16} sx={{ bgcolor: 'rgba(0,0,0,0.08)' }} />
        </>
      ) : (
        <>
          <Typography
            sx={{
              fontSize: '1.4rem',
              fontWeight: 700,
              lineHeight: 1.1,
              color: C.text,
              fontVariantNumeric: 'tabular-nums',
              mb: 0.5,
            }}
          >
            {value}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ color: highlight ? C.accent : C.textMuted, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              {icon}
            </Box>
            <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.04em', lineHeight: 1.2 }}>
              {label}
            </Typography>
          </Box>
          {sub && (
            <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.68rem', mt: 0.25 }}>
              {sub}
            </Typography>
          )}
        </>
      )}
    </Paper>
  )
}

// ── Infrastructure Cards ─────────────────────────────────────────────────────

type ServiceStatus = 'ok' | 'warn' | 'error' | 'unavailable'

interface InfraItem {
  id?: string
  name: string
  status: ServiceStatus
  detail?: string
}

interface InfraData {
  providers:    InfraItem[]
  services:     InfraItem[]
  checkedInMs:  number
}

const DOT_COLOR: Record<ServiceStatus, string> = {
  ok:          'var(--color-status-success, #23CA61)',
  warn:        '#f59e0b',
  error:       'var(--color-status-error, #DA1414)',
  unavailable: 'var(--theme-text-muted)',
}

const STATUS_LABEL: Record<ServiceStatus, string> = {
  ok:          'Online',
  warn:        'Degraded',
  error:       'Error',
  unavailable: 'N/A',
}

function InfraCard({ name, status, detail, loading }: InfraItem & { loading?: boolean }) {
  const dot = DOT_COLOR[status]
  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 1.5,
        borderColor: status === 'error' ? DOT_COLOR.error : C.border,
        bgcolor: C.surface,
        px: 1.5,
        py: 1.25,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.4,
      }}
    >
      {loading ? (
        <Skeleton variant="text" width={80} height={20} sx={{ bgcolor: 'var(--theme-border)' }} />
      ) : (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: dot, flexShrink: 0 }} />
            <Typography
              variant="caption"
              sx={{ color: C.text, fontWeight: 700, fontSize: '0.72rem', letterSpacing: '0.01em', flex: 1 }}
            >
              {name}
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: dot, fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.03em' }}
            >
              {STATUS_LABEL[status]}
            </Typography>
          </Box>
          {detail && (
            <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.64rem', pl: 1.75 }}>
              {detail}
            </Typography>
          )}
        </>
      )}
    </Paper>
  )
}

function SectionLabel({ label }: { label: string }) {
  return (
    <Typography
      variant="overline"
      sx={{ fontSize: '0.63rem', fontWeight: 700, letterSpacing: '0.08em', color: C.textMuted, display: 'block', mb: 1 }}
    >
      {label}
    </Typography>
  )
}

const FALLBACK_PROVIDERS: InfraItem[] = [
  { id: 'payment',     name: 'Payment',     status: 'unavailable', detail: 'not available' },
  { id: 'search',      name: 'Search',      status: 'unavailable', detail: 'not available' },
  { id: 'cache',       name: 'Redis Cache', status: 'unavailable', detail: 'not available' },
  // 'demo-wallet' is appended only when isBeta === true (see AdminKpiStrip render).
]

const FALLBACK_SERVICES: InfraItem[] = [
  { name: 'postgres',    status: 'unavailable', detail: 'not available' },
  { name: 'redis',       status: 'unavailable', detail: 'not available' },
  { name: 'meilisearch', status: 'unavailable', detail: 'not available' },
  { name: 'lnd',         status: 'unavailable', detail: 'not available' },
  { name: 'lnbits',      status: 'unavailable', detail: 'not available' },
  { name: 'bitcoind',    status: 'unavailable', detail: 'not available' },
]

// ── Main Component ───────────────────────────────────────────────────────────

export function AdminKpiStrip() {
  const { isBeta } = useBetaMode()
  const [metrics, setMetrics]   = useState<Metrics | null>(null)
  const [infra, setInfra]       = useState<InfraData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [metricsRes, infraRes] = await Promise.all([
        apiCall('/api/admin/metrics'),
        apiCall('/api/admin/infrastructure'),
      ])
      const metricsData = await metricsRes.json() as Metrics
      const infraData = await infraRes.json() as InfraData
      setMetrics(metricsData)
      setInfra(infraData)
      setLastChecked(new Date())
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load platform metrics'
      console.error('[AdminKpiStrip] load failed:', e)
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 60_000)
    return () => clearInterval(interval)
  }, [load])

  const m = metrics
  const firstLoad = loading && !m

  return (
    <Box>
      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography
          variant="overline"
          sx={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', color: C.textMuted }}
        >
          Platform Metrics
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {lastChecked && !loading && (
            <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.68rem' }}>
              {lastChecked.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </Typography>
          )}
          {loading && <CircularProgress size={12} sx={{ color: C.textMuted }} />}
          <Box
            onClick={load}
            sx={{
              display: 'flex', alignItems: 'center', gap: 0.5,
              cursor: 'pointer', color: C.textMuted,
              '&:hover': { color: C.text },
            }}
          >
            <RefreshIcon sx={{ fontSize: 14 }} />
            <Typography variant="caption" sx={{ fontSize: '0.68rem' }}>Refresh</Typography>
          </Box>
        </Box>
      </Box>

      {error && (
        <Alert
          severity="error"
          sx={{
            mb: 2,
            bgcolor: 'rgba(218, 20, 20, 0.08)',
            color: 'var(--color-status-error, #DA1414)',
            border: '1px solid var(--color-status-error, #DA1414)',
            '& .MuiAlert-icon': { color: 'var(--color-status-error, #DA1414)' },
          }}
        >
          {error}
        </Alert>
      )}

      {/* ── KPI Grid ── */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(2, 1fr)',
            sm: 'repeat(3, 1fr)',
            md: 'repeat(4, 1fr)',
            lg: 'repeat(8, 1fr)',
          },
          gap: 1.5,
        }}
      >
        <KpiCard
          icon={<PeopleAltIcon sx={{ fontSize: 18 }} />}
          label="Total Users"
          value={m?.users.total ?? 0}
          sub={m ? `+${m.users.new7d} last 7d` : undefined}
          highlight={(m?.users.new7d ?? 0) > 0}
          loading={firstLoad}
        />
        <KpiCard
          icon={<LocalOfferIcon sx={{ fontSize: 18 }} />}
          label="Offers"
          value={m?.offers.total ?? 0}
          loading={firstLoad}
        />
        <KpiCard
          icon={<ReceiptLongIcon sx={{ fontSize: 18 }} />}
          label="Tickets"
          value={m?.tickets.total ?? 0}
          sub={m ? `${m.tickets.active} active` : undefined}
          highlight={(m?.tickets.active ?? 0) > 0}
          loading={firstLoad}
        />
        <ActiveUsersChip count={m?.users.active ?? 0} loading={firstLoad} />
        <KpiCard
          icon={<PublicIcon sx={{ fontSize: 18 }} />}
          label="Remote Users"
          value={m?.users.remote ?? 0}
          sub={m ? `${m.users.total - m.users.remote} Collaborate` : undefined}
          loading={firstLoad}
        />
        <KpiCard
          icon={<FeedbackIcon sx={{ fontSize: 18 }} />}
          label="Feedback"
          value={m?.feedback.total ?? 0}
          sub={m ? `${m.feedback.unread} unread` : undefined}
          highlight={(m?.feedback.unread ?? 0) > 0}
          loading={firstLoad}
        />
        {isBeta && (
          <KpiCard
            icon={<BoltIcon sx={{ fontSize: 18 }} />}
            label="Demo Wallets"
            value={m?.demoWallets.count ?? 0}
            sub={m ? formatSats(m.demoWallets.totalSats) : undefined}
            loading={firstLoad}
          />
        )}
        <KpiCard
          icon={<ManageHistoryIcon sx={{ fontSize: 18 }} />}
          label="Audit Logs"
          value={m?.auditLogs.total ?? 0}
          loading={firstLoad}
        />
      </Box>

      {/* ── Providers ── */}
      <Divider sx={{ my: 2, borderColor: C.border }} />
      <SectionLabel label="Providers" />
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(2, 1fr)',
            sm: 'repeat(4, 1fr)',
          },
          gap: 1,
        }}
      >
        {loading && !infra
          ? Array.from({ length: 4 }).map((_, i) => (
              <InfraCard key={i} name="" status="unavailable" loading />
            ))
          : (infra?.providers ?? FALLBACK_PROVIDERS)
              .concat(isBeta ? [{ id: 'demo-wallet', name: 'Demo Wallet', status: 'unavailable', detail: 'not available' }] : [])
              .map(p => (
                <InfraCard key={p.id ?? p.name} {...p} loading={false} />
              ))
        }
      </Box>

      {/* ── Docker Services ── */}
      <Box sx={{ mt: 2 }}>
        <SectionLabel label="Docker Services" />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, 1fr)',
              sm: 'repeat(3, 1fr)',
              md: 'repeat(6, 1fr)',
            },
            gap: 1,
          }}
        >
          {loading && !infra
            ? Array.from({ length: 6 }).map((_, i) => (
                <InfraCard key={i} name="" status="unavailable" loading />
              ))
            : (infra?.services ?? FALLBACK_SERVICES).map(s => (
                <InfraCard key={s.name} {...s} loading={false} />
              ))
          }
        </Box>
      </Box>
    </Box>
  )
}
