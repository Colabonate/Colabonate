import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Button, CircularProgress, Collapse } from '@mui/material'
import { TabNsec } from './TabNsec'
import { apiCall } from '../../lib/api'
import { getValidatedReturnTo } from '../../lib/auth-guard'
import { syncNostrProfile } from '../../lib/nostr'
import { recordLoginSigner } from '../../lib/nostr-identity'
import { useWallet } from '../../contexts/WalletContext'
import { LightningLinkPrompt } from './LightningLinkPrompt'
import { ExternalLink, Shield, Zap, Globe, ChevronDown, Sparkles } from 'lucide-react'
import { cn } from '@ds/utils'

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

interface NIP07Extension {
  getPublicKey(): Promise<string>
  signEvent(event: object): Promise<{ sig: string; pubkey: string; id: string; [k: string]: unknown }>
}

function getNip07(): NIP07Extension | null {
  if (typeof window === 'undefined') return null
  const ext = (window as unknown as { nostr?: NIP07Extension }).nostr
  if (!ext || typeof ext.getPublicKey !== 'function' || typeof ext.signEvent !== 'function') {
    return null
  }
  return ext
}

function shortPubkey(pk: string): string {
  if (pk.length < 16) return pk
  return `${pk.slice(0, 8)}…${pk.slice(-8)}`
}

export function NewToNostrSection() {
  const [open, setOpen] = useState(false)

  return (
    <div
      className="p-4 rounded-xl"
      style={{
        background: 'color-mix(in srgb, var(--color-primary-50) 8%, var(--theme-bg-subtle))',
        border: '1px solid color-mix(in srgb, var(--color-primary-50) 35%, transparent)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls="new-to-nostr-actions"
        className="login-collapse-trigger flex items-start w-full gap-2 text-left"
      >
        <Sparkles size={16} aria-hidden="true" className="shrink-0 mt-1" style={{ color: 'var(--color-primary-50)' }} />
        <div className="flex-1 min-w-0">
          <h4 className="mb-0">New to Nostr?</h4>
          <p className="text-xs mb-0" style={{ color: 'var(--theme-text-muted)' }}>
            No signer yet? Create your sovereign identity right in your browser — no extension required.
          </p>
        </div>
        <span className="flex items-center justify-center p-1 shrink-0" style={{ color: 'var(--theme-text-muted)' }}>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={cn('transition-transform duration-200', open && 'rotate-180')}
          />
        </span>
      </button>

      <Collapse in={open} timeout={280} unmountOnExit={false}>
        <div id="new-to-nostr-actions" className="mt-3">
          <Button
            component={Link}
            to="/onboarding/generate-nostr-key"
            variant="contained"
            color="primary"
            fullWidth
            sx={{ py: 1.25, fontSize: '0.875rem', fontWeight: 600, textTransform: 'none' }}
          >
            Create your Nostr identity
          </Button>

          <p className="mt-2 text-center text-xs" style={{ color: 'var(--theme-text-muted)' }}>
            or{' '}
            <a
              href="https://nosta.me/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 font-medium"
              style={{ color: 'var(--color-primary-50)' }}
            >
              create a profile with nosta.me
              <ExternalLink size={10} aria-hidden="true" />
            </a>
          </p>
        </div>
      </Collapse>
    </div>
  )
}

export function TabNostr({ embedded = false }: { embedded?: boolean }) {
  const [hasNip07, setHasNip07] = useState<boolean | null>(null)
  const [pubkey, setPubkey] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authenticated, setAuthenticated] = useState(false)
  const [showLightningLink, setShowLightningLink] = useState(false)
  const [unlocksOpen, setUnlocksOpen] = useState(false)
  const [needSignerOpen, setNeedSignerOpen] = useState(false)
  const { createWallet } = useWallet()
  const location = useLocation()

  useEffect(() => {
    setHasNip07(getNip07() !== null)
  }, [])

  async function bootstrapWalletAndPrompt() {
    try {
      await createWallet()
    } catch (err) {
      console.warn('[TabNostr] Wallet bootstrap failed (non-fatal):', err)
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

  async function handleNostrLogin() {
    setError(null)
    setLoading(true)
    try {
      const nostr = getNip07()
      if (!nostr) {
        setError('No signer detected. Install Alby or another Nostr signer extension.')
        return
      }

      const extPubkey = await nostr.getPublicKey()
      setPubkey(extPubkey)

      const challengeRes = await apiCall('/api/auth/nostr/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedPubkey: extPubkey }),
      })
      if (!challengeRes.ok) {
        throw new Error(`Challenge request failed: ${challengeRes.status}`)
      }
      const challenge: ChallengeResponse = await challengeRes.json()

      const unsignedEvent = {
        kind: 27235,
        pubkey: extPubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['challenge', challenge.nonce]],
        content: '',
      }
      const signedEvent = await nostr.signEvent(unsignedEvent)

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
      recordLoginSigner(extPubkey, verify.pubkey)

      // Sync the Nostr Kind 0 profile (picture, name, banner, nip05) right at
      // login so the Home KPI strip and profile pages have it on first paint.
      // Fire-and-forget — a slow relay must not block the login flow; the
      // session flag resets so this login's sync is not swallowed by a
      // previous one.
      sessionStorage.removeItem('nostr_profile_synced')
      void syncNostrProfile(verify.pubkey, extPubkey)

      await bootstrapWalletAndPrompt()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('rejected')) {
        return
      }
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

      <div>
        <div className="mb-4 text-left">
          <p className="text-xs mb-3" style={{ color: 'var(--theme-text-muted)' }}>
            Colabonate supports external signers (e.g. Alby, nos2x, Nostr Signer, Flint, Damus).{' '}
            <a
              href="https://getalby.com/alby-extension"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 font-medium"
              style={{ color: 'var(--color-primary-50)' }}
            >
              Alby browser extension
              <ExternalLink size={10} aria-hidden="true" />
            </a>
          </p>
        </div>

        {hasNip07 === false && (
          <div
            className="pt-3 mb-3 border-t"
            style={{ borderColor: 'var(--theme-border)' }}
          >
            <button
              type="button"
              onClick={() => setNeedSignerOpen(open => !open)}
              className="login-collapse-trigger flex items-center justify-between w-full text-xs font-medium"
              style={{ color: 'var(--theme-text)' }}
              aria-expanded={needSignerOpen}
              aria-controls="login-need-signer"
            >
              Need a signer?
              <ChevronDown
                size={14}
                aria-hidden="true"
                className={cn('shrink-0 transition-transform duration-200', needSignerOpen && 'rotate-180')}
                style={{ color: 'var(--theme-text-muted)' }}
              />
            </button>
            <Collapse in={needSignerOpen} timeout={280}>
              <div id="login-need-signer">
                <ol className="space-y-1.5 text-xs ml-4 list-decimal mt-3" style={{ color: 'var(--theme-text-muted)' }}>
                  <li>
                    Follow our{' '}
                    <Link
                      to="/help/getting-started#gs-6"
                      className="inline-flex items-center gap-0.5 font-medium"
                      style={{ color: 'var(--color-primary-50)' }}
                    >
                      Get Started guide
                    </Link>
                    {' '}to set up your Nostr identity.
                  </li>
                  <li>
                    Set up the{' '}
                    <a
                      href="https://getalby.com/alby-extension"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 font-medium"
                      style={{ color: 'var(--color-primary-50)' }}
                    >
                      Alby browser extension
                      <ExternalLink size={10} aria-hidden="true" />
                    </a>
                    {' '}as your signer and wallet — or use{' '}
                    <a
                      href="https://nosta.me/"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 font-medium"
                      style={{ color: 'var(--color-primary-50)' }}
                    >
                      nosta.me
                      <ExternalLink size={10} aria-hidden="true" />
                    </a>
                    {' '}for a guided setup that creates a profile and connects a signer for you.
                  </li>
                  <li>Return to Colabonate and connect.</li>
                </ol>

                <p className="mt-3 text-xs text-center" style={{ color: 'var(--theme-text-muted)' }}>
                  Don&apos;t want to install anything?{' '}
                  <span style={{ color: 'var(--theme-text)', fontWeight: 600 }}>Use New to Nostr</span> above —
                  sign in instantly, then we&apos;ll generate a Nostr key for you right in your browser.
                </p>
              </div>
            </Collapse>
          </div>
        )}

        {pubkey && (
          <p className="mb-2 text-xs text-center font-mono" style={{ color: 'var(--theme-text-muted)' }}>
            {shortPubkey(pubkey)}
          </p>
        )}

        {hasNip07 === false ? (
          <TabNsec embedded={embedded} />
        ) : (
          <>
            <Button
              variant="outlined"
              color="primary"
              fullWidth
              onClick={handleNostrLogin}
              disabled={loading}
              startIcon={
                loading ? (
                  <CircularProgress size={16} sx={{ color: 'currentColor' }} />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )
              }
              sx={{ py: 1.25, fontSize: '0.875rem', fontWeight: 600, textTransform: 'none' }}
            >
              {loading ? 'Connecting...' : 'Connect a signer'}
            </Button>

            <div className="mt-3 text-center">
              <Link
                to="/help/getting-started#gs-6"
                className="inline-flex items-center gap-1 text-xs font-medium"
                style={{ color: 'var(--color-primary-50)' }}
              >
                Learn more about Nostr signers
              </Link>
            </div>
          </>
        )}

      </div>

      <div
        className="pt-3 border-t"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        <button
          type="button"
          onClick={() => setUnlocksOpen(open => !open)}
          className="login-collapse-trigger flex items-center justify-between w-full text-xs font-medium"
          style={{ color: 'var(--theme-text)' }}
          aria-expanded={unlocksOpen}
          aria-controls="login-unlocks"
        >
          What this unlocks
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={cn('shrink-0 transition-transform duration-200', unlocksOpen && 'rotate-180')}
            style={{ color: 'var(--theme-text-muted)' }}
          />
        </button>
        <Collapse in={unlocksOpen} timeout={280}>
          <ul id="login-unlocks" className="space-y-2 text-xs mt-3" style={{ color: 'var(--theme-text-muted)' }}>
            <li className="flex items-start gap-2">
              <Shield size={14} className="shrink-0 mt-0.5" style={{ color: 'var(--color-primary-50)' }} />
              <span><strong style={{ color: 'var(--theme-text)' }}>Sovereign identity</strong> — you control your keys and your Nostr profile across all apps.</span>
            </li>
            <li className="flex items-start gap-2">
              <Zap size={14} className="shrink-0 mt-0.5" style={{ color: 'var(--color-accent-2)' }} />
              <span><strong style={{ color: 'var(--theme-text)' }}>Lightning payments</strong> — send and receive sats directly with your linked wallet.</span>
            </li>
            <li className="flex items-start gap-2">
              <Globe size={14} className="shrink-0 mt-0.5" style={{ color: 'var(--color-secondary-50)' }} />
              <span><strong style={{ color: 'var(--theme-text)' }}>Interoperable</strong> — use the same identity across Nostr apps and services.</span>
            </li>
          </ul>
        </Collapse>
      </div>

      <div
        className="pt-3 border-t"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        <p className="text-xs text-center" style={{ color: 'var(--theme-text-muted)' }}>
          <span style={{ color: 'var(--color-accent-2)' }}>⚡</span> After connecting, you'll be prompted to link a Lightning wallet (or skip to use the auto-provisioned wallet)
        </p>
      </div>
    </div>
  )
}
