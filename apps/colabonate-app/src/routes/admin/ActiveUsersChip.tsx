import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Paper, Typography, CircularProgress, Alert, Avatar, Chip, Popover, Divider,
} from '@mui/material'
import DevicesIcon         from '@mui/icons-material/Devices'
import OpenInNewIcon       from '@mui/icons-material/OpenInNew'
import { apiCall } from '../../lib/api'

const C = {
  text:       'var(--theme-text)',
  textMuted:  'var(--theme-text-muted)',
  border:     'var(--theme-border)',
  surface:    'var(--theme-surface)',
  bgSubtle:   'var(--theme-bg-subtle)',
  accent:     'var(--color-warning-default, #f59e0b)',
  accentBg:   'var(--color-warning-subtle, #fef3c7)',
} as const

// ADR-282: distinct pubkey list returned by /api/admin/active-users — see
// apps/server/routes/admin.ts. `lastSeen` is the most recent session createdAt
// for that pubkey (no heartbeat exists; `Session.expiresAt > now()` is the proxy).
interface ActiveUser {
  pubkey:        string
  identityLevel: number
  picture:       string | null
  nip05:         string | null
  lnAddress:     string | null
  sessionCount:  number
  lastSeen:      string
}

interface ActiveUsersResponse {
  count: number
  users: ActiveUser[]
}

function shortPubkey(pk: string) { return pk.slice(0, 8) + '…' + pk.slice(-6) }

function relativeTime(iso: string): string {
  const diff  = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins  < 2)  return 'just now'
  if (mins  < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days  < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })
}

interface ActiveUsersChipProps {
  count: number
  loading?: boolean
}

// Clickable card on the AdminKpiStrip that opens a popover listing the
// currently-active users (distinct pubkeys with a non-expired session).
// Clicking a user navigates to /admin/accounts?pubkey=<pk>, which
// AccountsSection picks up via useSearchParams to pre-open the detail panel.
export function ActiveUsersChip({ count, loading }: ActiveUsersChipProps) {
  const navigate = useNavigate()
  const [anchor, setAnchor]                       = useState<HTMLElement | null>(null)
  const [data, setData]                           = useState<ActiveUsersResponse | null>(null)
  const [fetchState, setFetchState]               = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError]                         = useState<string | null>(null)

  const open = Boolean(anchor)

  const fetchUsers = useCallback(async () => {
    setFetchState('loading')
    setError(null)
    try {
      const res  = await apiCall('/api/admin/active-users?limit=25')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load')
      setData(json as ActiveUsersResponse)
      setFetchState('idle')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
      setFetchState('error')
    }
  }, [])

  // Lazy fetch on first open — keeps the 60s metrics refresh cheap, only loads
  // the user list when an admin actually asks for it.
  useEffect(() => {
    if (open && fetchState === 'idle' && !data) fetchUsers()
  }, [open, fetchState, data, fetchUsers])

  function handleOpen(e: React.MouseEvent<HTMLElement>) { setAnchor(e.currentTarget) }
  function handleClose() { setAnchor(null) }

  function handlePick(pk: string) {
    setAnchor(null)
    navigate(`/admin/accounts?pubkey=${encodeURIComponent(pk)}`)
  }

  return (
    <>
      <Paper
        variant="outlined"
        role="button"
        tabIndex={0}
        onClick={loading ? undefined : handleOpen}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAnchor(e.currentTarget as unknown as HTMLElement) } }}
        sx={{
          borderRadius: 2,
          borderColor: count > 0 ? C.accent : C.border,
          bgcolor: C.surface,
          p: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
          cursor: loading ? 'default' : 'pointer',
          transition: 'border-color 0.15s, background 0.15s, transform 0.05s',
          '&:hover':   loading ? {} : { borderColor: C.accent, bgcolor: C.accentBg },
          '&:active':  loading ? {} : { transform: 'scale(0.98)' },
          '&:focus-visible': { outline: `2px solid ${C.accent}`, outlineOffset: 2 },
        }}
      >
        {loading ? (
          <>
            <Box sx={{ width: 56, height: 32, bgcolor: 'rgba(0,0,0,0.08)', borderRadius: 0.5 }} />
            <Box sx={{ width: 80, height: 16, bgcolor: 'rgba(0,0,0,0.08)', borderRadius: 0.5 }} />
          </>
        ) : (
          <>
            <Typography
              sx={{
                fontSize: '1.4rem', fontWeight: 700, lineHeight: 1.1,
                color: C.text, fontVariantNumeric: 'tabular-nums', mb: 0.5,
              }}
            >
              {count}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ color: count > 0 ? C.accent : C.textMuted, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                <DevicesIcon sx={{ fontSize: 18 }} />
              </Box>
              <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.04em', lineHeight: 1.2 }}>
                Active Users
              </Typography>
              {count > 0 && (
                <Chip
                  label="view"
                  size="small"
                  sx={{
                    ml: 'auto', height: 16, fontSize: '0.6rem', fontWeight: 700,
                    bgcolor: C.accent, color: '#fff',
                    letterSpacing: '0.04em',
                  }}
                />
              )}
            </Box>
            <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.68rem', mt: 0.25 }}>
              click to list
            </Typography>
          </>
        )}
      </Paper>

      <Popover
        open={open}
        anchorEl={anchor}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              mt: 1, width: 340, maxHeight: 480,
              bgcolor: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 2, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
              display: 'flex', flexDirection: 'column',
            },
          },
        }}
      >
        {/* Header */}
        <Box sx={{ px: 1.5, py: 1.25, borderBottom: `1px solid ${C.border}` }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <DevicesIcon sx={{ fontSize: 16, color: C.accent }} />
            <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: C.text, flex: 1 }}>
              Currently Active
            </Typography>
            {data && (
              <Chip
                label={`${data.count} ${data.count === 1 ? 'user' : 'users'}`}
                size="small"
                sx={{
                  height: 18, fontSize: '0.66rem', fontWeight: 700,
                  bgcolor: C.accentBg, color: C.accent, border: 'none',
                }}
              />
            )}
          </Box>
          <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.66rem', display: 'block', mt: 0.25 }}>
            Sorted by most recent login
          </Typography>
        </Box>

        {/* Body */}
        <Box sx={{ overflowY: 'auto', flex: 1 }}>
          {fetchState === 'loading' && (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
              <CircularProgress size={20} sx={{ color: C.accent }} />
            </Box>
          )}

          {fetchState === 'error' && (
            <Box sx={{ p: 1.5 }}>
              <Alert
                severity="error"
                sx={{
                  fontSize: '0.7rem',
                  bgcolor: 'rgba(218,20,20,0.08)',
                  color: 'var(--color-status-error, #DA1414)',
                  border: '1px solid var(--color-status-error, #DA1414)',
                }}
              >
                {error}
                <Box
                  component="span"
                  onClick={fetchUsers}
                  sx={{ ml: 1, textDecoration: 'underline', cursor: 'pointer', fontWeight: 600 }}
                >
                  retry
                </Box>
              </Alert>
            </Box>
          )}

          {data && data.users.length === 0 && (
            <Box sx={{ px: 1.5, py: 4, textAlign: 'center' }}>
              <Typography variant="caption" sx={{ color: C.textMuted }}>
                No active users right now.
              </Typography>
            </Box>
          )}

          {data?.users.map((u, i) => (
            <Box key={u.pubkey}>
              {i > 0 && <Divider sx={{ borderColor: C.border }} />}
              <Box
                role="button"
                tabIndex={0}
                onClick={() => handlePick(u.pubkey)}
                onKeyDown={e => { if (e.key === 'Enter') handlePick(u.pubkey) }}
                sx={{
                  px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1.25,
                  cursor: 'pointer', transition: 'background 0.1s',
                  '&:hover':  { bgcolor: C.bgSubtle },
                  '&:focus-visible': { outline: `2px solid ${C.accent}`, outlineOffset: -2 },
                }}
              >
                <Avatar
                  src={u.picture ?? undefined}
                  sx={{ width: 26, height: 26, fontSize: '0.68rem', bgcolor: '#7c3aed', color: '#fff', flexShrink: 0 }}
                >
                  {u.pubkey.slice(0, 2).toUpperCase()}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                    <Typography sx={{ fontFamily: 'monospace', fontSize: '0.74rem', fontWeight: 600, color: C.text }}>
                      {shortPubkey(u.pubkey)}
                    </Typography>
                    {u.identityLevel > 0 && (
                      <Typography variant="caption" sx={{ fontSize: '0.62rem', fontWeight: 700, color: C.accent, letterSpacing: '0.04em' }}>
                        L{u.identityLevel}
                      </Typography>
                    )}
                  </Box>
                  {(u.nip05 || u.lnAddress) && (
                    <Typography variant="caption" sx={{ display: 'block', fontSize: '0.64rem', color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {u.nip05 ?? u.lnAddress}
                    </Typography>
                  )}
                </Box>
                <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                  <Typography sx={{ fontSize: '0.7rem', color: C.textMuted, whiteSpace: 'nowrap', fontWeight: 500 }}>
                    {relativeTime(u.lastSeen)}
                  </Typography>
                  <Typography variant="caption" sx={{ display: 'block', fontSize: '0.6rem', color: C.textMuted }}>
                    {u.sessionCount === 1 ? '1 session' : `${u.sessionCount} sessions`}
                  </Typography>
                </Box>
                <OpenInNewIcon sx={{ fontSize: 12, color: C.textMuted, flexShrink: 0 }} />
              </Box>
            </Box>
          ))}
        </Box>

        {/* Footer */}
        {data && data.count > data.users.length && (
          <>
            <Divider sx={{ borderColor: C.border }} />
            <Box sx={{ px: 1.5, py: 1 }}>
              <Typography variant="caption" sx={{ color: C.textMuted, fontSize: '0.66rem' }}>
                Showing top {data.users.length} of {data.count} active users.
              </Typography>
            </Box>
          </>
        )}
      </Popover>
    </>
  )
}
