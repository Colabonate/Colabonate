import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Paper,
  Typography,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  CircularProgress,
  Alert,
  TextField,
  Chip,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import BoltIcon from '@mui/icons-material/Bolt'
import { apiCall } from '../../../lib/api'
import { formatSats as formatSatsCanonical } from '../../../lib/currency'
import { useBetaMode } from '../../../hooks/useBetaMode'

const formatSats = (n: number) => formatSatsCanonical(n, { compact: false })

const C = {
  surface:   'var(--theme-surface)',
  bg:        'var(--theme-bg)',
  text:      'var(--theme-text)',
  textMuted: 'var(--theme-text-muted)',
  border:    'var(--theme-border)',
} as const

interface Tester {
  pubkey: string
  balanceSats: number
  walletUpdatedAt: string
  userCreatedAt: string
}


function shortPubkey(pk: string) {
  return pk.slice(0, 8) + '…' + pk.slice(-6)
}

export function BetaSection() {
  const { isBeta } = useBetaMode()
  if (!isBeta) {
    // ADR-273: this section is meaningless outside beta mode (no DEMO wallets
    // exist, /api/admin/beta/testers would 404 anyway). Render a single
    // explanation instead of an empty table so the admin isn't confused.
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">
          Beta mode is disabled — the Beta Testers section is only meaningful while{' '}
          <code>BETA_MODE=true</code>. The toggle is server-side; refresh after the deploy.
        </Alert>
      </Box>
    )
  }
  const [testers, setTesters] = useState<Tester[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [topupPubkey, setTopupPubkey] = useState('')
  const [topupLoading, setTopupLoading] = useState<string | null>(null)
  const [topupResult, setTopupResult] = useState<{ pubkey: string; ok: boolean; msg: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiCall('/api/admin/beta/testers')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load')
      setTesters(data.testers ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleTopup(pubkey: string) {
    setTopupLoading(pubkey)
    setTopupResult(null)
    try {
      const res = await apiCall('/api/beta/demo-topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pubkey }),
      })
      const data = await res.json()
      if (res.ok) {
        setTopupResult({ pubkey, ok: true, msg: `Reset to ${formatSats(data.newBalance ?? 0)}` })
        await load()
      } else {
        setTopupResult({ pubkey, ok: false, msg: data.error ?? 'Top-up failed' })
      }
    } catch {
      setTopupResult({ pubkey, ok: false, msg: 'Network error' })
    } finally {
      setTopupLoading(null)
      setTopupPubkey('')
    }
  }

  return (
    <Box>
      {/* Tester list */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="overline" sx={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: C.textMuted }}>
          Demo Wallet Testers ({testers.length})
        </Typography>
        <Box
          onClick={load}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: C.textMuted, '&:hover': { color: C.text } }}
        >
          <RefreshIcon sx={{ fontSize: 16 }} />
          <Typography variant="caption">Refresh</Typography>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface, overflow: 'hidden' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : testers.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography variant="caption" sx={{ color: C.textMuted }}>No demo wallet testers yet.</Typography>
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { color: C.textMuted, fontSize: '0.75rem', fontWeight: 600, borderColor: C.border } }}>
                <TableCell>Pubkey</TableCell>
                <TableCell align="right">Balance</TableCell>
                <TableCell align="right">Last Activity</TableCell>
                <TableCell align="center">Top-up</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {testers.map(t => (
                <TableRow
                  key={t.pubkey}
                  sx={{ '& td': { borderColor: C.border, color: C.text }, '&:last-child td': { border: 0 } }}
                >
                  <TableCell>
                    <Typography
                      component="span"
                      variant="caption"
                      sx={{ fontFamily: 'monospace', fontSize: '0.8rem', color: C.text }}
                      title={t.pubkey}
                    >
                      {shortPubkey(t.pubkey)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Chip
                      icon={<BoltIcon sx={{ fontSize: '0.9rem !important' }} />}
                      label={formatSats(t.balanceSats)}
                      size="small"
                      sx={{
                        fontSize: '0.75rem',
                        bgcolor: t.balanceSats > 0
                          ? 'var(--color-success-subtle, #dcfce7)'
                          : 'var(--color-warning-subtle, #fef3c7)',
                        color: t.balanceSats > 0
                          ? 'var(--color-success-emphasis, #166534)'
                          : 'var(--color-warning-emphasis, #92400e)',
                        border: 'none',
                        '& .MuiChip-icon': { color: 'inherit' },
                      }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="caption" sx={{ color: C.textMuted }}>
                      {new Date(t.walletUpdatedAt).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Box
                      onClick={() => topupLoading ? undefined : handleTopup(t.pubkey)}
                      sx={{
                        display: 'inline-flex', alignItems: 'center', gap: 0.5,
                        px: 1.5, py: 0.5, borderRadius: 1,
                        border: '1px solid var(--color-warning-default, #f59e0b)',
                        color: 'var(--color-warning-emphasis, #92400e)',
                        fontSize: '0.75rem', fontWeight: 600,
                        cursor: topupLoading ? 'not-allowed' : 'pointer',
                        opacity: topupLoading === t.pubkey ? 0.6 : 1,
                        '&:hover': { bgcolor: 'var(--color-warning-subtle, #fef3c7)' },
                      }}
                    >
                      {topupLoading === t.pubkey ? <CircularProgress size={12} /> : <BoltIcon sx={{ fontSize: 14 }} />}
                      Reset
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      {topupResult && (
        <Alert
          severity={topupResult.ok ? 'success' : 'error'}
          onClose={() => setTopupResult(null)}
          sx={{ mt: 2 }}
        >
          <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{shortPubkey(topupResult.pubkey)}</Typography>
          {' — '}{topupResult.msg}
        </Alert>
      )}

      {/* Manual top-up by pubkey (for testers not yet in the list) */}
      <Box sx={{ mt: 3 }}>
        <Typography variant="overline" sx={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: C.textMuted, display: 'block', mb: 1.5 }}>
          Manual Top-up by Pubkey
        </Typography>
        <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface, p: 2 }}>
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <TextField
              size="small"
              placeholder="Nostr pubkey (hex, 64 chars)"
              value={topupPubkey}
              onChange={e => setTopupPubkey(e.target.value)}
              disabled={!!topupLoading}
              inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.8rem' } }}
              sx={{ flex: 1, minWidth: 260 }}
            />
            <Box
              onClick={() => topupPubkey.trim().length === 64 ? handleTopup(topupPubkey.trim()) : undefined}
              sx={{
                px: 2.5, py: 1, borderRadius: 1,
                bgcolor: topupPubkey.trim().length === 64
                  ? 'var(--color-warning-default, #f59e0b)'
                  : 'var(--theme-bg-subtle)',
                color: topupPubkey.trim().length === 64 ? '#fff' : C.textMuted,
                fontWeight: 600, fontSize: '0.85rem',
                cursor: topupPubkey.trim().length === 64 ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', gap: 1,
                whiteSpace: 'nowrap',
              }}
            >
              {topupLoading && topupLoading === topupPubkey.trim() ? (
                <CircularProgress size={14} color="inherit" />
              ) : (
                <BoltIcon sx={{ fontSize: 16 }} />
              )}
              Reset Balance
            </Box>
          </Box>
        </Paper>
      </Box>
    </Box>
  )
}
