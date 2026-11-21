import { useState, useEffect, useCallback } from 'react'
import { Box, Paper, Typography, CircularProgress, Skeleton, Alert } from '@mui/material'
import StorageIcon from '@mui/icons-material/Storage'
import CachedIcon from '@mui/icons-material/Cached'
import BoltIcon from '@mui/icons-material/Bolt'
import ScienceIcon from '@mui/icons-material/Science'
import PauseCircleIcon from '@mui/icons-material/PauseCircle'
import TimerIcon from '@mui/icons-material/Timer'
import SpeedIcon from '@mui/icons-material/Speed'
import RefreshIcon from '@mui/icons-material/Refresh'
import { apiCall } from '../../../lib/api'

const C = {
  text:      'var(--theme-text)',
  textMuted: 'var(--theme-text-muted)',
  border:    'var(--theme-border)',
  surface:   'var(--theme-surface)',
} as const

const STATUS = {
  ok: {
    color:  'var(--color-status-success, #23CA61)',
    border: 'var(--color-status-success, #23CA61)',
    bg:     C.surface,
  },
  warn: {
    color:  '#f59e0b',
    border: '#f59e0b',
    bg:     C.surface,
  },
  error: {
    color:  'var(--color-status-error, #DA1414)',
    border: 'var(--color-status-error, #DA1414)',
    bg:     C.surface,
  },
  unknown: {
    color:  C.textMuted,
    border: C.border,
    bg:     C.surface,
  },
} as const

type StatusLevel = keyof typeof STATUS

interface LndStatus {
  ok: boolean
  alias: string | null
  synced: boolean
}

interface HealthData {
  db: 'ok' | 'error'
  redis: 'ok' | 'error' | 'unavailable'
  lnd: LndStatus | null
  // false on a Stage 1 Direct-Pay-only host (ADR-253) — no local LN node is
  // needed there on purpose, so an unreachable one isn't an incident.
  lndRequired: boolean
  betaMode: boolean
  paymentsPaused: boolean
  uptimeSeconds: number
  checkedInMs: number
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

interface HealthCardProps {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  level: StatusLevel
  loading?: boolean
}

function HealthCard({ icon, label, value, sub, level, loading }: HealthCardProps) {
  const s = STATUS[level]
  return (
    <Paper
      variant="outlined"
      sx={{
        borderRadius: 2,
        borderColor: s.border,
        bgcolor: s.bg,
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
            <Box sx={{ color: s.color, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
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

export function HealthSection() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiCall('/api/admin/health')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load')
      setHealth(data as HealthData)
      setLastChecked(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000)
    return () => clearInterval(interval)
  }, [load])

  const h = health

  function dbLevel(): StatusLevel {
    if (!h) return 'unknown'
    return h.db === 'ok' ? 'ok' : 'error'
  }
  function redisLevel(): StatusLevel {
    if (!h) return 'unknown'
    if (h.redis === 'ok') return 'ok'
    if (h.redis === 'unavailable') return 'warn'
    return 'error'
  }
  function lndLevel(): StatusLevel {
    if (!h) return 'unknown'
    if (!h.lndRequired) return 'unknown'
    if (!h.lnd) return 'warn'
    return h.lnd.ok ? 'ok' : 'error'
  }
  function betaLevel(): StatusLevel {
    if (!h) return 'unknown'
    return h.betaMode ? 'ok' : 'warn'
  }
  function paymentsLevel(): StatusLevel {
    if (!h) return 'unknown'
    // ADR-252 D2: paused is the abnormal state — flag it loudly (error), not warn.
    return h.paymentsPaused ? 'error' : 'ok'
  }
  function latencyLevel(): StatusLevel {
    if (!h) return 'unknown'
    if (h.checkedInMs < 100) return 'ok'
    if (h.checkedInMs < 500) return 'warn'
    return 'error'
  }

  const firstLoad = loading && !h

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography
          variant="overline"
          sx={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', color: C.textMuted }}
        >
          Service Health
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

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(2, 1fr)',
            sm: 'repeat(3, 1fr)',
            md: 'repeat(7, 1fr)',
          },
          gap: 1.5,
        }}
      >
        <HealthCard
          icon={<StorageIcon sx={{ fontSize: 18 }} />}
          label="Database"
          value={h?.db === 'ok' ? 'Online' : h?.db === 'error' ? 'Error' : '—'}
          sub="PostgreSQL"
          level={dbLevel()}
          loading={firstLoad}
        />
        <HealthCard
          icon={<CachedIcon sx={{ fontSize: 18 }} />}
          label="Redis"
          value={h?.redis === 'ok' ? 'Online' : h?.redis === 'unavailable' ? 'N/A' : h?.redis === 'error' ? 'Error' : '—'}
          sub={
            h?.redis === 'ok' ? 'PONG received'
              : h?.redis === 'unavailable' ? 'REDIS_URL not set'
              : h?.redis === 'error' ? 'Ping failed'
              : undefined
          }
          level={redisLevel()}
          loading={firstLoad}
        />
        <HealthCard
          icon={<BoltIcon sx={{ fontSize: 18 }} />}
          label="LND Node"
          value={!h ? '—' : !h.lndRequired ? 'N/A' : !h.lnd ? 'N/A' : h.lnd.ok ? (h.lnd.synced ? 'Synced' : 'Online') : 'Error'}
          sub={
            !h?.lndRequired ? 'Not needed — Stage 1 Direct-Pay'
              : !h.lnd ? 'LND_REST_URL not set'
              : h.lnd.alias ? h.lnd.alias
              : undefined
          }
          level={lndLevel()}
          loading={firstLoad}
        />
        <HealthCard
          icon={<ScienceIcon sx={{ fontSize: 18 }} />}
          label="Beta Mode"
          value={h ? (h.betaMode ? 'Active' : 'Off') : '—'}
          sub={h?.betaMode ? 'Demo wallets enabled' : 'Production mode'}
          level={betaLevel()}
          loading={firstLoad}
        />
        <HealthCard
          icon={<PauseCircleIcon sx={{ fontSize: 18 }} />}
          label="Payments"
          value={h ? (h.paymentsPaused ? 'PAUSED' : 'Active') : '—'}
          sub={h?.paymentsPaused ? 'Kill switch ON — new escrow blocked' : 'New payments accepted'}
          level={paymentsLevel()}
          loading={firstLoad}
        />
        <HealthCard
          icon={<TimerIcon sx={{ fontSize: 18 }} />}
          label="Uptime"
          value={h ? formatUptime(h.uptimeSeconds) : '—'}
          sub="Server process"
          level={h ? 'ok' : 'unknown'}
          loading={firstLoad}
        />
        <HealthCard
          icon={<SpeedIcon sx={{ fontSize: 18 }} />}
          label="Check Latency"
          value={h ? `${h.checkedInMs} ms` : '—'}
          sub={h ? (h.checkedInMs < 100 ? 'Excellent' : h.checkedInMs < 500 ? 'Acceptable' : 'Slow') : undefined}
          level={latencyLevel()}
          loading={firstLoad}
        />
      </Box>

      <Typography variant="caption" sx={{ display: 'block', mt: 2, color: C.textMuted, fontSize: '0.68rem' }}>
        Auto-refreshes every 30 seconds.
      </Typography>
    </Box>
  )
}
