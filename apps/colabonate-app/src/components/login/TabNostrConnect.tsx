import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Button, CircularProgress } from '@mui/material'
import { apiCall } from '../../lib/api'
import { getValidatedReturnTo } from '../../lib/auth-guard'
import { recordLoginSigner } from '../../lib/nostr-identity'
import {
  connectFromBunkerUri,
  getNip46Connection,
  isNip46Active,
  nip46SignEvent,
} from '../../lib/nostr-nip46'
import { startMockBunker } from '../../lib/nostr-nip46-mock-bunker'

interface ChallengeResponse {
  nonce: string
  expiresAt: string
  ttlSeconds: number
}

interface VerifyResponse {
  ok: boolean
  pubkey: string
  token: string
  expiresAt: string
  verifiedAt: string
}

function shortPk(pk: string): string {
  return pk.length < 16 ? pk : `${pk.slice(0, 8)}…${pk.slice(-8)}`
}

/**
 * ADR-154 (FU-154-A): login by signing the NIP-07-style auth challenge with a
 * NIP-46 bunker (remote signer). If no bunker is connected yet, paste a
 * `bunker://` URI first. The signed `kind:27235` event is sent to the existing
 * `/api/auth/nostr/verify` endpoint — the server doesn't care whether the event
 * was signed by an extension or a bunker.
 */
export function TabNostrConnect({ embedded = false }: { embedded?: boolean }) {
  const [uri, setUri] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authenticated, setAuthenticated] = useState(false)
  const location = useLocation()

  const active = isNip46Active()
  const conn = getNip46Connection()

  async function handleConnect() {
    setError(null)
    setConnecting(true)
    try {
      await connectFromBunkerUri(uri.trim())
      setUri('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bunker connection failed')
    } finally {
      setConnecting(false)
    }
  }

  async function handleSignIn() {
    setError(null)
    setSigning(true)
    try {
      // 1) Request an auth challenge bound to the bunker's pubkey.
      const challengeRes = await apiCall('/api/auth/nostr/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedPubkey: conn?.userPubkey }),
      })
      if (!challengeRes.ok) throw new Error(`Challenge request failed: ${challengeRes.status}`)
      const challenge: ChallengeResponse = await challengeRes.json()

      // 2) Sign the kind:27235 challenge event via the bunker (bunker sets pubkey).
      const signed = await nip46SignEvent({
        kind: 27235,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['challenge', challenge.nonce]],
        content: '',
      })

      // 3) Verify with the existing endpoint.
      const verifyRes = await apiCall('/api/auth/nostr/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: signed }),
      })
      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}))
        throw new Error(data.message || `Verify failed: ${verifyRes.status}`)
      }
      const verify: VerifyResponse = await verifyRes.json()

      localStorage.setItem('pubkey', verify.pubkey)
      localStorage.setItem('authToken', verify.token)
      // ADR-401 FU-893: remember when the sovereign key signed into its bound account.
      recordLoginSigner(signed.pubkey, verify.pubkey)

      setAuthenticated(true)
      // ADR-303 D10: return the user to the page that asked for login.
      setTimeout(() => { window.location.href = getValidatedReturnTo(location.state, location.search) }, 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setSigning(false)
    }
  }

  if (authenticated) {
    return (
      <div className="login-flow-enter py-8 text-center">
        <div
          className="flex items-center justify-center w-16 h-16 mx-auto mb-4 rounded-full"
          style={{ background: 'var(--color-status-success-bg)' }}
        >
          <span className="text-2xl" style={{ color: 'var(--color-status-success)' }}>✓</span>
        </div>
        <h2 className="mb-1" style={{ color: 'var(--theme-text)' }}>Login successful</h2>
        <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>Redirecting...</p>
      </div>
    )
  }

  return (
    <div className={embedded ? 'space-y-3 h-full' : 'space-y-4'}>
      {error && (
        <div
          className="p-3 text-sm rounded-xl"
          style={{ background: 'var(--color-status-error-bg)', color: 'var(--color-status-error)' }}
        >
          {error}
        </div>
      )}

      <div>
        <p className="mb-3 text-xs font-medium text-center" style={{ color: 'var(--theme-text-muted)' }}>
          Sign in with a remote Nostr signer (NIP-46)
        </p>

        {!active && (
          <div className="mb-3">
            <input
              type="text"
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              placeholder="bunker://…  or  name@domain.com"
              className="w-full px-3 py-2 text-xs rounded-lg mb-2"
              style={{
                background: 'var(--theme-bg-elevated)',
                border: '1px solid var(--theme-border)',
                color: 'var(--theme-text)',
              }}
            />
            <Button
              variant="outlined"
              fullWidth
              size="small"
              disabled={!uri.trim() || connecting}
              onClick={handleConnect}
              sx={{ textTransform: 'none', borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
            >
              {connecting ? <CircularProgress size={16} /> : 'Connect bunker'}
            </Button>
            {Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV) && (
              <Button
                variant="text"
                size="small"
                onClick={() => setUri(startMockBunker().bunkerUri)}
                sx={{ textTransform: 'none', color: 'var(--theme-text-muted)', mt: 1, fontSize: '0.7rem' }}
              >
                Use dev mock bunker
              </Button>
            )}
          </div>
        )}

        {active && conn && (
          <p className="mb-3 text-xs text-center font-mono" style={{ color: 'var(--theme-text-muted)' }}>
            Bunker connected: {shortPk(conn.userPubkey)}
          </p>
        )}

        <Button
          variant="contained"
          color="primary"
          fullWidth
          disabled={!active || signing}
          onClick={handleSignIn}
          sx={{ py: 1.25, fontSize: '0.875rem', fontWeight: 600, textTransform: 'none' }}
        >
          {signing ? <CircularProgress size={18} /> : 'Sign in with bunker'}
        </Button>

        <p className="mt-3 text-xs text-center" style={{ color: 'var(--theme-text-muted)' }}>
          Your private key stays in the bunker (Alby Hub, Amber, nsecBunker). Recommended for a real, portable Nostr identity.
        </p>
      </div>
    </div>
  )
}
