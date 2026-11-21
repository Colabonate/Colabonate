import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { CircularProgress, IconButton, InputAdornment, TextField } from '@mui/material'
import { Eye, EyeOff, LogIn } from 'lucide-react'
import { finalizeEvent, getPublicKey, nip19 } from 'nostr-tools'
import { apiCall } from '../../lib/api'
import { getValidatedReturnTo } from '../../lib/auth-guard'
import { recordLoginSigner, toNpub } from '../../lib/nostr-identity'
import { useWallet } from '../../contexts/WalletContext'
import { LightningLinkPrompt } from './LightningLinkPrompt'

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

/**
 * Decode a bech32 `nsec1…` string into raw secret-key bytes.
 * Returns null for any malformed input — the caller shows a generic
 * validation error and must never log the attempted value (ADR-221).
 */
function decodeNsec(input: string): Uint8Array | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('nsec1')) return null
  try {
    const decoded = nip19.decode(trimmed)
    return decoded.type === 'nsec' ? decoded.data : null
  } catch {
    return null
  }
}

export function TabNsec({ embedded = false }: { embedded?: boolean }) {
  const [nsec, setNsec] = useState('')
  const [showNsec, setShowNsec] = useState(false)
  const [pubkey, setPubkey] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authenticated, setAuthenticated] = useState(false)
  const [showLightningLink, setShowLightningLink] = useState(false)
  const { createWallet } = useWallet()
  const location = useLocation()

  // Live preview: as soon as the input decodes, show which identity it maps to.
  const previewBytes = nsec ? decodeNsec(nsec) : null
  const previewNpub = previewBytes ? toNpub(getPublicKey(previewBytes)) : null

  async function bootstrapWalletAndPrompt() {
    try {
      await createWallet()
    } catch (err) {
      console.warn('[TabNsec] Wallet bootstrap failed (non-fatal):', err)
    }
    setShowLightningLink(true)
  }

  function finishLogin(redirect = true) {
    setAuthenticated(true)
    if (redirect) {
      // ADR-303 D10: return the user to the page that asked for login.
      setTimeout(() => { window.location.href = getValidatedReturnTo(location.state, location.search) }, 1000)
    }
  }

  async function handleLightningLinked(lightningPubkey: string) {
    try {
      localStorage.setItem('linkedPubkey', lightningPubkey)
      setShowLightningLink(false)
      finishLogin()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link Lightning wallet')
    }
  }

  function handleSkipLightningLink() {
    setShowLightningLink(false)
    finishLogin()
  }

  async function handleNsecLogin() {
    setError(null)
    const sk = decodeNsec(nsec)
    if (!sk) {
      setError('That doesn\'t look like a valid nsec key — it should start with "nsec1…".')
      return
    }
    setLoading(true)
    try {
      const derivedPubkey = getPublicKey(sk)
      setPubkey(derivedPubkey)

      const challengeRes = await apiCall('/api/auth/nostr/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedPubkey: derivedPubkey }),
      })
      if (!challengeRes.ok) {
        throw new Error(`Challenge request failed: ${challengeRes.status}`)
      }
      const challenge: ChallengeResponse = await challengeRes.json()

      // One-shot local signature — the key proves ownership of the npub and
      // is never sent to the server nor persisted anywhere.
      const signedEvent = finalizeEvent(
        {
          kind: 27235,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['challenge', challenge.nonce]],
          content: '',
        },
        sk,
      )

      // Zero out the key material immediately after signing.
      sk.fill(0)
      setNsec('')

      const verifyRes = await apiCall('/api/auth/nostr/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: signedEvent }),
      })
      if (!verifyRes.ok) {
        const data = await verifyRes.json().catch(() => ({}))
        throw new Error(data.message || `Verify failed: ${verifyRes.status}`)
      }
      const verify: VerifyResponse = await verifyRes.json()

      localStorage.setItem('pubkey', verify.pubkey)
      localStorage.setItem('authToken', verify.token)
      // ADR-401 FU-893: remember when the sovereign key signed into its bound account.
      recordLoginSigner(derivedPubkey, verify.pubkey)

      await bootstrapWalletAndPrompt()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  if (showLightningLink) {
    return (
      <LightningLinkPrompt
        onLinked={handleLightningLinked}
        onSkip={handleSkipLightningLink}
        embedded={embedded}
        skipAllowed
        identity={pubkey ? { provider: 'nostr', label: pubkey } : undefined}
      />
    )
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

      <div className="flex gap-2">
        <TextField
          fullWidth
          size="small"
          type={showNsec ? 'text' : 'password'}
          label="Private key (nsec)"
          placeholder="nsec1…"
          value={nsec}
          onChange={e => { setNsec(e.target.value); setError(null) }}
          autoComplete="off"
          spellCheck={false}
          disabled={loading}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  onClick={() => setShowNsec(show => !show)}
                  aria-label={showNsec ? 'Hide private key' : 'Show private key'}
                  edge="end"
                >
                  {showNsec ? <EyeOff size={16} /> : <Eye size={16} />}
                </IconButton>
              </InputAdornment>
            ),
          }}
        />

        <IconButton
          onClick={handleNsecLogin}
          disabled={loading || !previewBytes}
          aria-label="Sign in with key"
          sx={{ alignSelf: 'center', color: 'var(--color-primary-50)' }}
        >
          {loading ? <CircularProgress size={20} sx={{ color: 'var(--color-primary-50)' }} /> : <LogIn size={20} />}
        </IconButton>
      </div>

      {previewNpub && (
        <p className="mt-1 text-xs font-mono break-all" style={{ color: 'var(--theme-text-muted)' }}>
          Signing in as {previewNpub}
        </p>
      )}

      <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
        Your key is used once to sign the login challenge — never stored, never sent.
      </p>
    </div>
  )
}
