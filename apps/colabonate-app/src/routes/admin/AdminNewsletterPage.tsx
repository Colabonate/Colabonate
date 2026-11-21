// ADR-400: admin view of the unified newsletter audience — confirmed footer
// signups + registered accounts that carry an email. Read-only list plus a
// CSV export; the actual send is out of scope for this slice.
import { useState, useEffect, useCallback } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, FormControl, IconButton,
  InputLabel, MenuItem, Paper, Select, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import DownloadIcon from '@mui/icons-material/Download'
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead'
import { Seo } from '../../components/Seo'
import { apiCall } from '../../lib/api'

type NewsletterStatusFilter = 'all' | 'CONFIRMED' | 'PENDING' | 'UNSUBSCRIBED' | 'NO_CONSENT'
type NewsletterOriginFilter = 'all' | 'subscriber' | 'account'

interface AudienceRow {
  email: string
  origin: 'subscriber' | 'account'
  // NO_CONSENT = account email that never opted in (ADR-402 D16), not a recipient
  status: 'CONFIRMED' | 'PENDING' | 'UNSUBSCRIBED' | 'NO_CONSENT'
  consent: boolean
  emailVerified: boolean
  pubkey: string | null
  source: string
  confirmedAt: string | null
  unsubscribedAt: string | null
  createdAt: string
}

interface AudienceStats {
  total: number
  confirmed: number
  pending: number
  unsubscribed: number
  noConsent: number
  subscribers: number
  accounts: number
}

const PAGE_LIMIT = 50

const STATUS_COLOR: Record<AudienceRow['status'], { bg: string; color: string }> = {
  CONFIRMED: { bg: 'rgba(35, 202, 97, 0.12)', color: 'var(--color-status-success, #23CA61)' },
  PENDING: { bg: 'rgba(245, 158, 11, 0.12)', color: 'var(--color-warning-default, #f59e0b)' },
  UNSUBSCRIBED: { bg: 'rgba(148, 163, 184, 0.15)', color: 'var(--theme-text-muted)' },
  NO_CONSENT: { bg: 'transparent', color: 'var(--theme-text-muted)' },
}

function buildParams(status: NewsletterStatusFilter, origin: NewsletterOriginFilter, q: string): URLSearchParams {
  const params = new URLSearchParams()
  if (status !== 'all') params.set('status', status)
  if (origin !== 'all') params.set('origin', origin)
  if (q.trim()) params.set('q', q.trim())
  return params
}

export function AdminNewsletterPage() {
  const [rows, setRows] = useState<AudienceRow[]>([])
  const [stats, setStats] = useState<AudienceStats | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<NewsletterStatusFilter>('all')
  const [origin, setOrigin] = useState<NewsletterOriginFilter>('all')
  const [q, setQ] = useState('')
  const [appliedQ, setAppliedQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => { setAppliedQ(q); setPage(1) }, 350)
    return () => clearTimeout(timer)
  }, [q])

  const fetchPage = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = buildParams(status, origin, appliedQ)
      params.set('page', String(page))
      params.set('limit', String(PAGE_LIMIT))
      const res = await apiCall(`/api/admin/newsletter/subscribers?${params.toString()}`)
      const data = (await res.json()) as { subscribers: AudienceRow[]; total: number; stats: AudienceStats }
      setRows(data.subscribers ?? [])
      setTotal(data.total ?? 0)
      setStats(data.stats ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load newsletter audience')
    } finally {
      setLoading(false)
    }
  }, [status, origin, appliedQ, page])

  useEffect(() => { fetchPage() }, [fetchPage])

  async function exportCsv() {
    setExporting(true)
    setError(null)
    try {
      const params = buildParams(status, origin, appliedQ)
      const res = await apiCall(`/api/admin/newsletter/subscribers/export?${params.toString()}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `newsletter-audience-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to export newsletter audience')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Box>
      <Seo noindex title="Newsletter — Admin" />
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" spacing={2} sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <MarkEmailReadIcon sx={{ color: 'var(--color-warning-default, #f59e0b)' }} />
          <Box>
            <Typography variant="h6" fontWeight={700}>Newsletter</Typography>
            <Typography variant="body2" color="text.secondary">
              Confirmed signups and registered accounts with an email (ADR-400).
            </Typography>
          </Box>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={exportCsv}
            disabled={exporting || loading}
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
          <IconButton onClick={fetchPage} aria-label="Reload" disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Stack>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>{error}</Alert>}

      {stats && (
        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ gap: 1, mb: 2 }}>
          <Chip label={`${stats.total} total`} size="small" />
          <Chip label={`${stats.confirmed} confirmed recipients`} size="small" sx={{ bgcolor: STATUS_COLOR.CONFIRMED.bg, color: STATUS_COLOR.CONFIRMED.color, fontWeight: 600 }} />
          <Chip label={`${stats.pending} pending`} size="small" sx={{ bgcolor: STATUS_COLOR.PENDING.bg, color: STATUS_COLOR.PENDING.color, fontWeight: 600 }} />
          <Chip label={`${stats.unsubscribed} unsubscribed`} size="small" />
          <Chip label={`${stats.noConsent} accounts without opt-in`} size="small" variant="outlined" />
          <Chip label={`${stats.subscribers} footer signups`} size="small" variant="outlined" />
          <Chip label={`${stats.accounts} account emails`} size="small" variant="outlined" />
        </Stack>
      )}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 170 }}>
            <InputLabel>Status</InputLabel>
            <Select value={status} label="Status" onChange={(e) => { setStatus(e.target.value as NewsletterStatusFilter); setPage(1) }}>
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="CONFIRMED">Confirmed</MenuItem>
              <MenuItem value="PENDING">Pending</MenuItem>
              <MenuItem value="UNSUBSCRIBED">Unsubscribed</MenuItem>
              <MenuItem value="NO_CONSENT">No opt-in (account)</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 170 }}>
            <InputLabel>Origin</InputLabel>
            <Select value={origin} label="Origin" onChange={(e) => { setOrigin(e.target.value as NewsletterOriginFilter); setPage(1) }}>
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="subscriber">Footer signup</MenuItem>
              <MenuItem value="account">Account</MenuItem>
            </Select>
          </FormControl>
          <TextField
            size="small"
            label="Search email or pubkey"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            sx={{ flex: 1, minWidth: 200 }}
          />
        </Stack>
      </Paper>

      <Paper>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
            <CircularProgress size={28} />
          </Box>
        ) : rows.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">No newsletter subscribers match the current filter.</Typography>
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Email</TableCell>
                <TableCell>Origin</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Pubkey</TableCell>
                <TableCell>Created</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => {
                const s = STATUS_COLOR[r.status]
                return (
                  <TableRow key={r.email} hover>
                    <TableCell>
                      <Typography variant="body2">{r.email}</Typography>
                      {!r.emailVerified && (
                        <Typography variant="caption" color="text.secondary" display="block">not verified</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip label={r.source} size="small" sx={{ height: 18, fontSize: '0.6rem' }} />
                    </TableCell>
                    <TableCell>
                      <Chip label={r.status} size="small" sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700, bgcolor: s.bg, color: s.color }} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                        {r.pubkey ? `${r.pubkey.slice(0, 8)}…${r.pubkey.slice(-4)}` : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                        {new Date(r.createdAt).toLocaleString('de-DE')}
                      </Typography>
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
