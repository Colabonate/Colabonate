// ADR-402 Phase 2 — Entitlements section for the admin Accounts detail panel.
// Read model + grant/debit/policy write paths from routes/admin-monetization.ts.
// Every action here is reason-backed and audited server-side; this component only
// renders the current state and posts the movement.
import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, CircularProgress, Chip, Divider, FormControl,
  InputLabel, MenuItem, Select, TextField, Typography,
} from '@mui/material'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import BoltIcon from '@mui/icons-material/Bolt'
import { apiCall } from '../../../lib/api'

const C = {
  text:      'var(--theme-text)',
  textMuted: 'var(--theme-text-muted)',
  border:    'var(--theme-border)',
  bgSubtle:  'var(--theme-bg-subtle)',
  accent:    'var(--color-warning-default, #f59e0b)',
  danger:    'var(--color-status-error, #DA1414)',
  success:   'var(--color-status-success, #23CA61)',
} as const

const GRANT_KINDS = ['GOODWILL', 'PROMO', 'SUPPORT', 'BETA'] as const
const MIN_REASON = 10

interface LedgerEntry {
  id: string
  delta: number
  kind: string
  reason: string | null
  actorPubkey: string | null
  createdAt: string
}

interface Entitlements {
  ai: { requestsRemaining: number; requestsUsed: number; ledger: LedgerEntry[] }
  mcp: {
    activePass: { id: string; tier: string; expiresAt: string | null; rail: string; lifetime?: boolean } | null
    trialUsed: boolean
    activeConnections: number
    recentPasses: { id: string; tier: string; rail: string; status: string; expiresAt: string | null; createdAt: string }[]
  }
  policy: { hostedAccess: string; mcpAccess: string; mcpMaxPassHours: number | null; note: string | null; updatedAt: string } | null
  tiers: {
    ai: { id: string; requests: number; priceSats: number }[]
    mcp: { id: string; hours: number | null; priceSats: number }[]
  }
  limits: { grantMax: number; grantDailyMax: number }
}

export function EntitlementsPanel({ pubkey, onChanged }: { pubkey: string; onChanged: () => void }) {
  const [data, setData] = useState<Entitlements | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [grantAmount, setGrantAmount] = useState('50')
  const [grantKind, setGrantKind] = useState<string>('GOODWILL')
  const [grantReason, setGrantReason] = useState('')

  const [debitAmount, setDebitAmount] = useState('10')
  const [debitReason, setDebitReason] = useState('')

  const [mcpHours, setMcpHours] = useState('720')
  const [mcpReason, setMcpReason] = useState('')
  const [shortenAt, setShortenAt] = useState('')
  const [shortenReason, setShortenReason] = useState('')
  const [policyReason, setPolicyReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiCall(`/api/admin/entitlements/${encodeURIComponent(pubkey)}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || json.error || `HTTP ${res.status}`)
      setData(json as Entitlements)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load entitlements')
    } finally {
      setLoading(false)
    }
  }, [pubkey])

  useEffect(() => { load() }, [load])

  const run = useCallback(async (
    path: string,
    init: { method: string; body?: unknown },
    successMsg: string,
  ) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await apiCall(path, {
        method: init.method,
        ...(init.body !== undefined
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }
          : {}),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.detail ? `${json.error}: ${json.detail}` : (json.message || json.error || `HTTP ${res.status}`))
      setNotice(json.message ? String(json.message) : successMsg)
      await load()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }, [load, onChanged])

  const grantReasonOk = grantReason.trim().length >= MIN_REASON
  const debitReasonOk = debitReason.trim().length >= MIN_REASON
  const mcpReasonOk = mcpReason.trim().length >= MIN_REASON
  const shortenReasonOk = shortenReason.trim().length >= MIN_REASON

  const hostedSuspended = data?.policy?.hostedAccess === 'SUSPENDED'
  const mcpSuspended = data?.policy?.mcpAccess === 'SUSPENDED'

  const fieldSx = { '& .MuiInputBase-input': { fontSize: '0.75rem' }, '& .MuiInputLabel-root': { fontSize: '0.72rem' } }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="overline" sx={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.1em', color: C.textMuted }}>
          AI &amp; MCP — Entitlements
        </Typography>
        {loading && <CircularProgress size={12} sx={{ color: C.textMuted }} />}
      </Box>

      {error && <Alert severity="error" sx={{ fontSize: '0.72rem', mb: 1 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ fontSize: '0.72rem', mb: 1 }} onClose={() => setNotice(null)}>{notice}</Alert>}

      {!data ? (
        loading ? null : <Typography sx={{ fontSize: '0.74rem', color: C.textMuted }}>No entitlement data.</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

          {/* ── Hosted AI ── */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
              <SmartToyIcon sx={{ fontSize: 15, color: C.accent }} />
              <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: C.text }}>Hosted AI</Typography>
              <Chip
                label={hostedSuspended ? 'Suspended' : 'Enabled'}
                size="small"
                sx={{
                  height: 18, fontSize: '0.62rem', fontWeight: 700, border: 'none',
                  bgcolor: hostedSuspended ? 'rgba(218,20,20,0.1)' : 'rgba(35,202,97,0.1)',
                  color: hostedSuspended ? C.danger : C.success,
                }}
              />
              <Box sx={{ flex: 1 }} />
              <Typography sx={{ fontSize: '0.74rem', color: C.text }}>
                <strong>{data.ai.requestsRemaining}</strong> left · {data.ai.requestsUsed} used
              </Typography>
            </Box>

            {/* Grant / debit */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 1 }}>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <TextField
                  size="small" label="Requests" value={grantAmount} sx={{ width: 96, ...fieldSx }}
                  onChange={(e) => setGrantAmount(e.target.value.replace(/[^0-9]/g, ''))}
                />
                <FormControl size="small" sx={{ minWidth: 120, ...fieldSx }}>
                  <InputLabel>Kind</InputLabel>
                  <Select label="Kind" value={grantKind} onChange={(e) => setGrantKind(e.target.value)}>
                    {GRANT_KINDS.map((k) => <MenuItem key={k} value={k} sx={{ fontSize: '0.75rem' }}>{k}</MenuItem>)}
                  </Select>
                </FormControl>
                <TextField
                  size="small" label="Reason (min 10)" value={grantReason} sx={{ flex: 1, minWidth: 160, ...fieldSx }}
                  onChange={(e) => setGrantReason(e.target.value)}
                />
                <Button
                  size="small" variant="contained" disabled={busy || !grantReasonOk || !grantAmount}
                  sx={{ textTransform: 'none', fontWeight: 700 }}
                  onClick={() => run(
                    `/api/admin/ai-credits/${encodeURIComponent(pubkey)}/grant`,
                    { method: 'POST', body: { requests: Number(grantAmount), kind: grantKind, reason: grantReason.trim() } },
                    'Granted',
                  )}
                >Grant</Button>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <TextField
                  size="small" label="Debit" value={debitAmount} sx={{ width: 96, ...fieldSx }}
                  onChange={(e) => setDebitAmount(e.target.value.replace(/[^0-9]/g, ''))}
                />
                <TextField
                  size="small" label="Reason (min 10)" value={debitReason} sx={{ flex: 1, minWidth: 160, ...fieldSx }}
                  onChange={(e) => setDebitReason(e.target.value)}
                />
                <Button
                  size="small" variant="outlined" color="error" disabled={busy || !debitReasonOk || !debitAmount}
                  sx={{ textTransform: 'none', fontWeight: 700 }}
                  onClick={() => run(
                    `/api/admin/ai-credits/${encodeURIComponent(pubkey)}/debit`,
                    { method: 'POST', body: { requests: Number(debitAmount), reason: debitReason.trim() } },
                    'Debited',
                  )}
                >Debit</Button>
              </Box>
            </Box>

            {/* Suspension toggle */}
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1, flexWrap: 'wrap' }}>
              <TextField
                size="small" label="Policy note (optional)" value={policyReason} sx={{ flex: 1, minWidth: 160, ...fieldSx }}
                onChange={(e) => setPolicyReason(e.target.value)}
              />
              {hostedSuspended ? (
                <Button size="small" variant="outlined" disabled={busy} sx={{ textTransform: 'none', fontWeight: 700 }}
                  onClick={() => run(`/api/admin/ai-policy/${encodeURIComponent(pubkey)}`, { method: 'PUT', body: { hostedAccess: 'DEFAULT', note: policyReason || undefined } }, 'Hosted AI re-enabled')}
                >Enable hosted AI</Button>
              ) : (
                <Button size="small" variant="outlined" color="error" disabled={busy} sx={{ textTransform: 'none', fontWeight: 700 }}
                  onClick={() => run(`/api/admin/ai-policy/${encodeURIComponent(pubkey)}`, { method: 'PUT', body: { hostedAccess: 'SUSPENDED', note: policyReason || undefined } }, 'Hosted AI suspended')}
                >Suspend hosted AI</Button>
              )}
            </Box>
          </Box>

          <Divider sx={{ borderColor: C.border }} />

          {/* ── MCP ── */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
              <BoltIcon sx={{ fontSize: 15, color: C.accent }} />
              <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: C.text }}>MCP Access</Typography>
              <Chip
                label={mcpSuspended ? 'Suspended' : 'Enabled'}
                size="small"
                sx={{
                  height: 18, fontSize: '0.62rem', fontWeight: 700, border: 'none',
                  bgcolor: mcpSuspended ? 'rgba(218,20,20,0.1)' : 'rgba(35,202,97,0.1)',
                  color: mcpSuspended ? C.danger : C.success,
                }}
              />
              <Box sx={{ flex: 1 }} />
              <Typography sx={{ fontSize: '0.72rem', color: C.textMuted }}>
                {data.mcp.activeConnections} active · trial {data.mcp.trialUsed ? 'used' : 'available'}
              </Typography>
            </Box>

            <Typography sx={{ fontSize: '0.72rem', color: C.text, mb: 0.75 }}>
              {data.mcp.activePass
                ? data.mcp.activePass.lifetime || data.mcp.activePass.expiresAt === null
                  ? <>Active pass: <strong>{data.mcp.activePass.tier}</strong> — Lifetime, never expires</>
                  : <>Active pass: <strong>{data.mcp.activePass.tier}</strong> until {new Date(data.mcp.activePass.expiresAt).toLocaleString('de-DE')}</>
                : 'No active pass.'}
            </Typography>

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <TextField
                size="small" label="Hours" value={mcpHours} sx={{ width: 96, ...fieldSx }}
                onChange={(e) => setMcpHours(e.target.value.replace(/[^0-9]/g, ''))}
              />
              <TextField
                size="small" label="Reason (min 10)" value={mcpReason} sx={{ flex: 1, minWidth: 160, ...fieldSx }}
                onChange={(e) => setMcpReason(e.target.value)}
              />
              <Button
                size="small" variant="contained" disabled={busy || !mcpReasonOk || !mcpHours}
                sx={{ textTransform: 'none', fontWeight: 700 }}
                onClick={() => run(
                  `/api/admin/mcp-passes/${encodeURIComponent(pubkey)}/grant`,
                  { method: 'POST', body: { hours: Number(mcpHours), reason: mcpReason.trim() } },
                  'MCP pass granted',
                )}
              >Grant pass</Button>
              <Button size="small" variant="outlined" disabled={busy || data.mcp.trialUsed} sx={{ textTransform: 'none', fontWeight: 700 }}
                onClick={() => run(`/api/admin/mcp-trials/${encodeURIComponent(pubkey)}`, { method: 'DELETE' }, 'Trial reset')}
              >Reset trial</Button>
            </Box>

            {/* Shorten an active pass */}
            {data.mcp.activePass && (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                <TextField
                  size="small" label="Shorten to" type="datetime-local" value={shortenAt}
                  sx={{ width: 210, ...fieldSx }}
                  InputLabelProps={{ shrink: true }}
                  onChange={(e) => setShortenAt(e.target.value)}
                />
                <TextField
                  size="small" label="Reason (min 10)" value={shortenReason} sx={{ flex: 1, minWidth: 160, ...fieldSx }}
                  onChange={(e) => setShortenReason(e.target.value)}
                />
                <Button
                  size="small" variant="outlined" color="error" disabled={busy || !shortenReasonOk || !shortenAt}
                  sx={{ textTransform: 'none', fontWeight: 700 }}
                  onClick={() => run(
                    `/api/admin/mcp-passes/${data.mcp.activePass!.id}/shorten`,
                    { method: 'POST', body: { expiresAt: new Date(shortenAt).toISOString(), reason: shortenReason.trim() } },
                    'Pass shortened',
                  )}
                >Shorten</Button>
              </Box>
            )}

            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1 }}>
              {mcpSuspended ? (
                <Button size="small" variant="outlined" disabled={busy} sx={{ textTransform: 'none', fontWeight: 700 }}
                  onClick={() => run(`/api/admin/ai-policy/${encodeURIComponent(pubkey)}`, { method: 'PUT', body: { mcpAccess: 'DEFAULT', note: policyReason || undefined } }, 'MCP re-enabled')}
                >Enable MCP</Button>
              ) : (
                <Button size="small" variant="outlined" color="error" disabled={busy} sx={{ textTransform: 'none', fontWeight: 700 }}
                  onClick={() => run(`/api/admin/ai-policy/${encodeURIComponent(pubkey)}`, { method: 'PUT', body: { mcpAccess: 'SUSPENDED', note: policyReason || undefined } }, 'MCP suspended')}
                >Suspend MCP</Button>
              )}
            </Box>
          </Box>

          <Divider sx={{ borderColor: C.border }} />

          {/* ── Ledger (last movements) ── */}
          <Box>
            <Typography variant="overline" sx={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.1em', color: C.textMuted }}>
              Credit movements
            </Typography>
            {data.ai.ledger.length === 0 ? (
              <Typography sx={{ fontSize: '0.72rem', color: C.textMuted, mt: 0.5 }}>No movements recorded.</Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 0.5 }}>
                {data.ai.ledger.slice(0, 10).map((e) => (
                  <Box key={e.id} sx={{ display: 'flex', alignItems: 'baseline', gap: 1, fontSize: '0.7rem' }}>
                    <Typography sx={{
                      fontVariantNumeric: 'tabular-nums', fontWeight: 700, minWidth: 42,
                      color: e.delta >= 0 ? C.success : C.danger, fontSize: '0.7rem',
                    }}>
                      {e.delta >= 0 ? `+${e.delta}` : e.delta}
                    </Typography>
                    <Chip label={e.kind} size="small" sx={{ height: 16, fontSize: '0.55rem', fontWeight: 700, bgcolor: C.bgSubtle, color: C.textMuted, border: 'none' }} />
                    <Typography sx={{ flex: 1, color: C.textMuted, fontSize: '0.68rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.reason ?? '—'}
                    </Typography>
                    <Typography sx={{ color: C.textMuted, fontSize: '0.64rem', whiteSpace: 'nowrap' }}>
                      {new Date(e.createdAt).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Box>

        </Box>
      )}
    </Box>
  )
}
