import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import {
  connectFromBunkerUri,
  connectFromNostrConnect,
  disconnectBunker,
  getNip46Connection,
  isNip46Active,
  onNip46Change,
} from '../../lib/nostr-nip46'
import { startMockBunker } from '../../lib/nostr-nip46-mock-bunker'

const C = {
  surface: 'var(--theme-surface)',
  text: 'var(--theme-text)',
  textMuted: 'var(--theme-text-muted)',
  border: 'var(--theme-border)',
  error: 'var(--color-status-error)',
}

function shortPk(pk: string): string {
  return pk.length < 16 ? pk : `${pk.slice(0, 10)}…${pk.slice(-10)}`
}

/**
 * ADR-154: manage a NIP-46 Nostr Connect "bunker" (remote signer).
 * Gives the user a real, portable Nostr identity without Colabonate ever
 * holding their private key.
 */
export function BunkerConnectionPanel() {
  const [, forceRender] = useState(0)
  const [uri, setUri] = useState('')
  const [connectUri, setConnectUri] = useState<string | null>(null)
  const [loading, setLoading] = useState<'none' | 'bunker' | 'nostrconnect'>('none')
  const [error, setError] = useState<string | null>(null)

  // Re-render whenever the NIP-46 connection state changes.
  useEffect(() => onNip46Change(() => forceRender((n) => n + 1)), [])

  const active = isNip46Active()
  const conn = getNip46Connection()
  const isDev = Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV)

  function handleStartMock() {
    const mock = startMockBunker()
    setUri(mock.bunkerUri)
  }

  async function handleConnectBunker() {
    setError(null)
    setLoading('bunker')
    try {
      await connectFromBunkerUri(uri.trim())
      setUri('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setLoading('none')
    }
  }

  async function handleGenerateConnectUri() {
    setError(null)
    setLoading('nostrconnect')
    setConnectUri(null)
    try {
      await connectFromNostrConnect((generated) => setConnectUri(generated))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection timed out or failed')
    } finally {
      setLoading('none')
    }
  }

  async function handleDisconnect() {
    setError(null)
    await disconnectBunker()
    setConnectUri(null)
  }

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, borderColor: C.border, bgcolor: C.surface, p: 2.5 }}>
      <Typography variant="subtitle2" fontWeight={700} sx={{ color: C.text, mb: 0.5 }}>
        Nostr Identity (NIP-46 Bunker)
      </Typography>
      <Typography variant="caption" sx={{ color: C.textMuted, display: 'block', mb: 2 }}>
        Connect a remote signer (Alby Hub, Amber, nsecBunker) to use a real, portable Nostr key.
        Your private key never leaves the bunker.
      </Typography>

      {active && conn ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              component="span"
              sx={{
                width: 8, height: 8, borderRadius: '50%', bgcolor: 'var(--color-status-success)',
              }}
            />
            <Typography variant="body2" sx={{ color: C.text }}>
              Connected · <code style={{ fontSize: '0.8em' }}>{shortPk(conn.userPubkey)}</code>
            </Typography>
          </Box>
          <Typography variant="caption" sx={{ color: C.textMuted }}>
            Relays: {conn.relays.join(', ')}
          </Typography>
          <Button
            variant="outlined"
            size="small"
            onClick={handleDisconnect}
            sx={{ alignSelf: 'flex-start', borderColor: C.border, color: C.text }}
          >
            Disconnect bunker
          </Button>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <Typography variant="caption" fontWeight={600} sx={{ color: C.text, display: 'block', mb: 0.5 }}>
              Connect with a bunker URL
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                size="small"
                fullWidth
                placeholder="bunker://…  or  name@domain.com"
                value={uri}
                onChange={(e) => setUri(e.target.value)}
                sx={{ '& .MuiOutlinedInput-root': { fontSize: '0.8rem' } }}
              />
              <Button
                variant="contained"
                size="small"
                disabled={!uri.trim() || loading !== 'none'}
                onClick={handleConnectBunker}
                sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
              >
                {loading === 'bunker' ? <CircularProgress size={16} /> : 'Connect'}
              </Button>
            </Box>
          </Box>

          <Divider sx={{ borderColor: C.border }}>
            <Typography variant="caption" sx={{ color: C.textMuted }}>or</Typography>
          </Divider>

          {isDev && (
            <Box>
              <Button
                variant="text"
                size="small"
                onClick={handleStartMock}
                sx={{ textTransform: 'none', color: C.textMuted }}
              >
                Start dev mock bunker (local test signer)
              </Button>
              <Typography variant="caption" sx={{ color: C.textMuted, display: 'block', mt: 0.5 }}>
                DEV ONLY: starts a local fake bunker and fills the URI above so you can connect without a real signer app.
              </Typography>
            </Box>
          )}

          <Box>
            <Typography variant="caption" fontWeight={600} sx={{ color: C.text, display: 'block', mb: 0.5 }}>
              Generate a Nostr Connect link
            </Typography>
            <Button
              variant="outlined"
              size="small"
              disabled={loading !== 'none'}
              onClick={handleGenerateConnectUri}
              sx={{ textTransform: 'none', borderColor: C.border, color: C.text }}
            >
              {loading === 'nostrconnect' ? <CircularProgress size={16} /> : 'Generate connect link'}
            </Button>
            {connectUri && (
              <Box
                sx={{
                  mt: 1, p: 1, borderRadius: 1, bgcolor: 'var(--theme-bg-subtle)',
                  border: `1px solid ${C.border}`, wordBreak: 'break-all',
                }}
              >
                <Typography variant="caption" sx={{ color: C.textMuted, fontFamily: 'monospace' }}>
                  {connectUri}
                </Typography>
                <Typography variant="caption" sx={{ color: C.textMuted, display: 'block', mt: 0.5 }}>
                  Open this link in your bunker app, or scan it with Amber.
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {error && (
        <Typography variant="caption" sx={{ color: C.error, display: 'block', mt: 1.5 }}>
          {error}
        </Typography>
      )}
    </Paper>
  )
}
