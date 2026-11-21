// ADR-315 D3: Admin Agent Verification page. Foundation-admin-only.
// Lists agent profiles (filterable by verified status / owner / name),
// opens a detail dialog with audit notes + verify/unverify actions.
import { useState, useEffect, useCallback } from 'react'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, FormControl, IconButton, InputLabel,
  MenuItem, Paper, Select, Stack, Table, TableBody, TableCell, TableHead,
  TableRow, TextField, Typography, Tooltip,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import VerifiedIcon from '@mui/icons-material/Verified'
import CloseIcon from '@mui/icons-material/Close'
import { Seo } from '../../components/Seo'
import { RichText } from '../../components/offers'
import { apiCall } from '../../lib/api'

interface AdminAgentProfile {
  id: string
  name: string
  description: string | null
  ownerPubkey: string
  owner: { pubkey: string; lnAddress: string | null; nip05: string | null; picture: string | null }
  capabilities: string[]
  isPublic: boolean
  isVerified: boolean
  verifiedAt: string | null
  verifiedByPubkey: string | null
  verificationNotes: string | null
  reputationScore: number | null
  trustScore: number | null
  offersCount: number
  createdAt: string
  updatedAt: string
}

interface AdminAgentProfileDetail extends AdminAgentProfile { /* same shape */ }

const PAGE_LIMIT = 20

export function AdminAgentsPage() {
  const [profiles, setProfiles] = useState<AdminAgentProfile[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [verifiedFilter, setVerifiedFilter] = useState<'all' | 'true' | 'false'>('all')
  const [ownerFilter, setOwnerFilter] = useState('')
  const [qFilter, setQFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<AdminAgentProfileDetail | null>(null)
  const [busy, setBusy] = useState(false)

  const fetchPage = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (verifiedFilter !== 'all') params.set('verified', verifiedFilter)
      if (ownerFilter.trim()) params.set('ownerPubkey', ownerFilter.trim())
      if (qFilter.trim()) params.set('q', qFilter.trim())
      params.set('page', String(page))
      params.set('limit', String(PAGE_LIMIT))
      const res = await apiCall(`/api/admin/agent-profiles?${params.toString()}`)
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message || body?.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setProfiles(data.agentProfiles ?? [])
      setTotal(data.total ?? 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load agent profiles')
    } finally {
      setLoading(false)
    }
  }, [page, verifiedFilter, ownerFilter, qFilter])

  useEffect(() => { fetchPage() }, [fetchPage])

  // Reset to page 1 whenever a filter changes (avoid showing an empty page
  // after the filter narrows past the current page).
  useEffect(() => { setPage(1) }, [verifiedFilter, ownerFilter, qFilter])

  async function openDetail(id: string) {
    try {
      const res = await apiCall(`/api/admin/agent-profiles/${id}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSelected(data.agentProfile)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profile')
    }
  }

  async function verify(id: string, notes: string) {
    setBusy(true)
    try {
      const res = await apiCall(`/api/admin/agent-profiles/${id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ notes: notes.trim() || undefined }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message || body?.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setSelected(prev => prev ? { ...prev, isVerified: data.agentProfile.isVerified, verifiedAt: data.agentProfile.verifiedAt, verifiedByPubkey: data.agentProfile.verifiedByPubkey, verificationNotes: data.agentProfile.verificationNotes } : null)
      fetchPage()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to verify profile')
    } finally {
      setBusy(false)
    }
  }

  async function unverify(id: string) {
    setBusy(true)
    try {
      const res = await apiCall(`/api/admin/agent-profiles/${id}/unverify`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message || body?.error || `HTTP ${res.status}`)
      }
      setSelected(prev => prev ? { ...prev, isVerified: false, verifiedAt: null, verifiedByPubkey: null, verificationNotes: null } : null)
      fetchPage()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to unverify profile')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box>
      <Seo noindex title="Agent Verification — Admin" />
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Agent Verification</Typography>
          <Typography variant="body2" color="text.secondary">
            Award or revoke the Foundation-reviewed "Verified" badge on agent profiles.
          </Typography>
        </Box>
        <IconButton onClick={fetchPage} aria-label="Reload" disabled={loading}>
          <RefreshIcon />
        </IconButton>
      </Stack>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Verified</InputLabel>
            <Select
              value={verifiedFilter}
              label="Verified"
              onChange={e => setVerifiedFilter(e.target.value as 'all' | 'true' | 'false')}
            >
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="true">Verified only</MenuItem>
              <MenuItem value="false">Unverified only</MenuItem>
            </Select>
          </FormControl>
          <TextField
            size="small"
            label="Owner pubkey"
            value={ownerFilter}
            onChange={e => setOwnerFilter(e.target.value)}
            placeholder="npub1… or hex"
            sx={{ minWidth: 280 }}
          />
          <TextField
            size="small"
            label="Name / pubkey search"
            value={qFilter}
            onChange={e => setQFilter(e.target.value)}
            placeholder="e.g. researcher"
            sx={{ minWidth: 200 }}
          />
          <Box sx={{ flex: 1 }} />
          <Typography variant="body2" color="text.secondary">
            {total} total
          </Typography>
        </Stack>
      </Paper>

      <Paper>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
            <CircularProgress size={28} />
          </Box>
        ) : profiles.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              No agent profiles match the current filters.
            </Typography>
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Owner</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Verified at</TableCell>
                <TableCell>Offers</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {profiles.map(p => (
                <TableRow key={p.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{p.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {p.capabilities.slice(0, 3).join(' • ')}{p.capabilities.length > 3 ? ' …' : ''}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                      {p.ownerPubkey.slice(0, 8)}…{p.ownerPubkey.slice(-4)}
                    </Typography>
                    {p.owner.nip05 && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {p.owner.nip05}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {p.isVerified ? (
                      <Chip
                        icon={<VerifiedIcon sx={{ fontSize: '0.85rem !important' }} />}
                        label="Verified"
                        size="small"
                        sx={{
                          height: 20, fontSize: '0.65rem', fontWeight: 700,
                          bgcolor: 'rgba(42, 232, 102, 0.12)',
                          color: 'var(--identity-peer-color)',
                          '& .MuiChip-icon': { color: 'var(--identity-peer-color)' },
                        }}
                      />
                    ) : (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    )}
                    {p.isPublic ? null : (
                      <Chip
                        label="private"
                        size="small"
                        sx={{ ml: 0.5, height: 18, fontSize: '0.6rem', bgcolor: 'var(--theme-bg)' }}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    {p.verifiedAt ? (
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                        {new Date(p.verifiedAt).toISOString().slice(0, 10)}
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                  <TableCell>{p.offersCount}</TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => openDetail(p.id)}>
                      Review
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2, justifyContent: 'flex-end' }}>
        <Button size="small" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>
          Previous
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ mx: 1 }}>
          Page {page} · {total > 0 ? `${Math.min(total, (page - 1) * PAGE_LIMIT + 1)}–${Math.min(total, page * PAGE_LIMIT)} of ${total}` : '0'}
        </Typography>
        <Button size="small" disabled={page * PAGE_LIMIT >= total || loading} onClick={() => setPage(p => p + 1)}>
          Next
        </Button>
      </Stack>

      {selected && (
        <AgentProfileDialog
          profile={selected}
          busy={busy}
          onClose={() => setSelected(null)}
          onVerify={(notes) => verify(selected.id, notes)}
          onUnverify={() => unverify(selected.id)}
        />
      )}
    </Box>
  )
}

function AgentProfileDialog({
  profile, busy, onClose, onVerify, onUnverify,
}: {
  profile: AdminAgentProfileDetail
  busy: boolean
  onClose: () => void
  onVerify: (notes: string) => void
  onUnverify: () => void
}) {
  const [notes, setNotes] = useState(profile.verificationNotes ?? '')

  useEffect(() => {
    setNotes(profile.verificationNotes ?? '')
  }, [profile.id, profile.verificationNotes])

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="body1" fontWeight={700} sx={{ flex: 1 }}>
          {profile.name}
        </Typography>
        {profile.isVerified && (
          <Chip
            icon={<VerifiedIcon sx={{ fontSize: '0.85rem !important' }} />}
            label="Verified"
            size="small"
            sx={{
              height: 22, fontSize: '0.7rem', fontWeight: 700,
              bgcolor: 'rgba(42, 232, 102, 0.12)',
              color: 'var(--identity-peer-color)',
              '& .MuiChip-icon': { color: 'var(--identity-peer-color)' },
            }}
          />
        )}
        <IconButton onClick={onClose} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Box>
            <Typography variant="caption" color="text.secondary">Owner</Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{profile.ownerPubkey}</Typography>
            {profile.owner.nip05 && (
              <Typography variant="caption" color="text.secondary" display="block">
                {profile.owner.nip05}
              </Typography>
            )}
          </Box>
          {profile.description && (
            <Box>
              <Typography variant="caption" color="text.secondary">Description</Typography>
              {/* Rich HTML since the agent wizard's identity description uses
                  the ADR-295 editor; plain legacy text renders unchanged. */}
              <RichText value={profile.description} />
            </Box>
          )}
          <Box>
            <Typography variant="caption" color="text.secondary">Capabilities</Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.5, gap: 0.5 }}>
              {profile.capabilities.map(c => (
                <Chip key={c} label={c} size="small" sx={{ height: 20, fontSize: '0.65rem' }} />
              ))}
            </Stack>
          </Box>
          <Stack direction="row" spacing={2}>
            <Box>
              <Typography variant="caption" color="text.secondary">Offers</Typography>
              <Typography variant="body2">{profile.offersCount}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Reputation</Typography>
              <Typography variant="body2">
                {profile.reputationScore != null ? `★ ${profile.reputationScore.toFixed(2)}` : '—'}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Trust</Typography>
              <Typography variant="body2">
                {profile.trustScore != null ? profile.trustScore.toFixed(2) : '—'}
              </Typography>
            </Box>
          </Stack>
          {profile.isVerified && (
            <Box>
              <Typography variant="caption" color="text.secondary">Verified at</Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {profile.verifiedAt ? new Date(profile.verifiedAt).toISOString() : '—'}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block">Verified by</Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {profile.verifiedByPubkey ?? '—'}
              </Typography>
            </Box>
          )}
          <TextField
            label="Audit notes (internal-only, not exposed publicly)"
            multiline
            minRows={3}
            maxRows={8}
            value={notes}
            onChange={e => setNotes(e.target.value.slice(0, 2000))}
            helperText={`${notes.length} / 2000`}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Close</Button>
        {profile.isVerified ? (
          <Tooltip title="Removes the verified badge from this profile and clears all four verification fields.">
            <Button color="error" variant="outlined" onClick={onUnverify} disabled={busy}>
              Revoke verification
            </Button>
          </Tooltip>
        ) : (
          <Button color="success" variant="contained" onClick={() => onVerify(notes)} disabled={busy}>
            Verify
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
