// ADR-371 admin-visibility slice: dedicated read/revoke view on the
// McpConnection ledger (external agents connected via "Connect Your Own
// Agent"), separate from the generic Entities browser so an admin can see
// scopes/owner/activity and revoke a connection without the generic
// entity-action flow.
import { useState, useEffect, useCallback } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, FormControl, IconButton,
  InputLabel, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, Typography,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import { Seo } from '../../components/Seo'
import { apiCall } from '../../lib/api'

type ConnectionStatus = 'active' | 'revoked' | 'expired'

interface McpConnectionRow {
  id: string
  pubkey: string
  user: { pubkey: string; nip05: string | null; picture: string | null; blockedAt: string | null }
  scope: string[]
  label: string | null
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  lastUsedAt: string | null
  eventCount: number
  status: ConnectionStatus
}

const PAGE_LIMIT = 25

const STATUS_COLOR: Record<ConnectionStatus, { bg: string; color: string; label: string }> = {
  active:  { bg: 'rgba(35, 202, 97, 0.12)', color: 'var(--color-status-success, #23CA61)', label: 'Active' },
  revoked: { bg: 'rgba(148, 163, 184, 0.15)', color: 'var(--theme-text-muted)', label: 'Revoked' },
  expired: { bg: 'rgba(218, 20, 20, 0.10)', color: 'var(--color-status-error, #DA1414)', label: 'Expired' },
}

export function AdminMcpConnectionsPage() {
  const [rows, setRows] = useState<McpConnectionRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<'all' | ConnectionStatus>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const fetchPage = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (status !== 'all') params.set('status', status)
      params.set('page', String(page))
      params.set('limit', String(PAGE_LIMIT))
      const res = await apiCall(`/api/admin/mcp-connections?${params.toString()}`)
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message || body?.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setRows(data.connections ?? [])
      setTotal(data.total ?? 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load MCP connections')
    } finally {
      setLoading(false)
    }
  }, [page, status])

  useEffect(() => { fetchPage() }, [fetchPage])
  useEffect(() => { setPage(1) }, [status])

  async function revoke(id: string) {
    setBusyId(id)
    try {
      const res = await apiCall(`/api/admin/mcp-connections/${id}/revoke`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message || body?.error || `HTTP ${res.status}`)
      }
      fetchPage()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke connection')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Box>
      <Seo noindex title="MCP Connections — Admin" />
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SmartToyIcon sx={{ color: 'var(--color-warning-default, #f59e0b)' }} />
          <Box>
            <Typography variant="h6" fontWeight={700}>MCP Connections</Typography>
            <Typography variant="body2" color="text.secondary">
              External-agent connections minted via "Connect Your Own Agent" (ADR-371).
            </Typography>
          </Box>
        </Box>
        <IconButton onClick={fetchPage} aria-label="Reload" disabled={loading}>
          <RefreshIcon />
        </IconButton>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>{error}</Alert>}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Status</InputLabel>
            <Select value={status} label="Status" onChange={(e) => setStatus(e.target.value as 'all' | ConnectionStatus)}>
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="revoked">Revoked</MenuItem>
              <MenuItem value="expired">Expired</MenuItem>
            </Select>
          </FormControl>
          <Box sx={{ flex: 1 }} />
          <Typography variant="body2" color="text.secondary">{total} total</Typography>
        </Stack>
      </Paper>

      <Paper>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
            <CircularProgress size={28} />
          </Box>
        ) : rows.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">No MCP connections match the current filter.</Typography>
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Owner</TableCell>
                <TableCell>Label</TableCell>
                <TableCell>Scope</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Last used</TableCell>
                <TableCell>Events</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((c) => {
                const s = STATUS_COLOR[c.status]
                return (
                  <TableRow key={c.id} hover>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                        {c.pubkey.slice(0, 8)}…{c.pubkey.slice(-4)}
                      </Typography>
                      {c.user.blockedAt && (
                        <Chip label="blocked" size="small" color="error" sx={{ ml: 0.5, height: 16, fontSize: '0.55rem' }} />
                      )}
                      {c.user.nip05 && (
                        <Typography variant="caption" color="text.secondary" display="block">{c.user.nip05}</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{c.label || <em style={{ opacity: 0.6 }}>unlabeled</em>}</Typography>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ gap: 0.5, maxWidth: 220 }}>
                        {c.scope.slice(0, 4).map((sc) => (
                          <Chip key={sc} label={sc} size="small" sx={{ height: 18, fontSize: '0.6rem' }} />
                        ))}
                        {c.scope.length > 4 && (
                          <Typography variant="caption" color="text.secondary">+{c.scope.length - 4}</Typography>
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Chip label={s.label} size="small" sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700, bgcolor: s.bg, color: s.color }} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                        {c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleString('de-DE') : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>{c.eventCount}</TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        color="error"
                        disabled={c.status !== 'active' || busyId === c.id}
                        onClick={() => revoke(c.id)}
                      >
                        {busyId === c.id ? '…' : 'Revoke'}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Paper>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2, justifyContent: 'flex-end' }}>
        <Button size="small" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>Previous</Button>
        <Typography variant="caption" color="text.secondary" sx={{ mx: 1 }}>
          Page {page} · {total > 0 ? `${Math.min(total, (page - 1) * PAGE_LIMIT + 1)}–${Math.min(total, page * PAGE_LIMIT)} of ${total}` : '0'}
        </Typography>
        <Button size="small" disabled={page * PAGE_LIMIT >= total || loading} onClick={() => setPage((p) => p + 1)}>Next</Button>
      </Stack>
    </Box>
  )
}
