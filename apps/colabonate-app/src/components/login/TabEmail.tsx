import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Button, CircularProgress } from '@mui/material'
import { apiCall } from '../../lib/api'
import { getValidatedReturnTo } from '../../lib/auth-guard'
import { getMyPubkeySync } from '../../lib/nostr-identity'
import { useWallet } from '../../contexts/WalletContext'
import { LightningLinkPrompt } from './LightningLinkPrompt'
import { NewsletterOptInCheckbox } from '../newsletter/NewsletterOptInCheckbox'

export function TabEmail({ embedded = false }: { embedded?: boolean }) {
  const [email, setEmail] = useState('')
  const [step, setStep] = useState<'input' | 'sent' | 'verified'>('input')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showLightningLink, setShowLightningLink] = useState(false)
  const [verifiedPubkey, setVerifiedPubkey] = useState<string | null>(null)
  const [debugLink, setDebugLink] = useState<string | null>(null)
  const [newsletterOptIn, setNewsletterOptIn] = useState(false)
  const { createWallet } = useWallet()
  const location = useLocation()
  // ADR-303 D10: return the user to the page that asked for login. The
  // magic-link flow crosses the email client, so router state is lost —
  // returnTo has to travel via the email link itself (see /api/auth/email/send
  // server-side validation), AND fall back to in-app state for the rare
  // verify-in-this-tab case.
  const returnTo = getValidatedReturnTo(location.state, location.search)


  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (token) {
      verifyToken(token)
    }
  }, [])

  // DEV only: when the server returned a debugLink (no email transport), auto-
  // navigate after 1.5s so the developer does not have to click "Open magic
  // link" first. The button stays as an instant option.
  useEffect(() => {
    if (!import.meta.env.DEV || !debugLink) return
    const t = setTimeout(() => { window.location.href = debugLink }, 1500)
    return () => clearTimeout(t)
  }, [debugLink])

  async function verifyToken(token: string) {
    setLoading(true)
    setError(null)
    try {
      const response = await apiCall(`/api/auth/email/verify?token=${encodeURIComponent(token)}`)
      const data = await response.json()

      if (data.success) {
        localStorage.setItem('pubkey', data.pubkey)
        if (data.token) localStorage.setItem('authToken', data.token)
        if (data.email) localStorage.setItem('email', data.email)
        setVerifiedPubkey(data.pubkey)

        // ADR-179 Fix B (parity with TabNostr/Google/Alby): auto-create the
        // custodial Wallet row so email users can pay immediately. Non-fatal —
        // a missing wallet is handled by the Wallet UX later.
        try {
          await createWallet()
        } catch (err) {
          console.warn('[TabEmail] Wallet bootstrap failed (non-fatal):', err)
        }

        if (data.needsLightningLink) {
          setShowLightningLink(true)
        } else {
          setStep('verified')
          setTimeout(() => { window.location.href = returnTo }, 1000)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired link')
    } finally {
      setLoading(false)
    }
  }

  async function handleSendLink() {
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address')
      return
    }

    setLoading(true)
    setError(null)
    try {
      // ADR-158: send our client-derived Nostr pubkey so the account is non-custodial.
      // ADR-303 D10: forward the validated returnTo so the magic link in the
      // email client lands back at the originating page, not always /login.
      const response = await apiCall('/api/auth/email/send', {
        method: 'POST',
        body: JSON.stringify({
          email,
          pubkey: getMyPubkeySync(),
          returnTo: returnTo !== '/' ? returnTo : undefined,
          // ADR-402 D16: explicit opt-in only; unticked changes nothing.
          newsletterOptIn,
        }),
      })
      const data = await response.json()

      if (data.success) {
        setStep('sent')
        if (data.debugLink) {
          setDebugLink(data.debugLink)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send magic link')
    } finally {
      setLoading(false)
    }
  }

  function handleSkipLightningLink() {
    setShowLightningLink(false)
    setStep('verified')
    setTimeout(() => { window.location.href = returnTo }, 1000)
  }

  async function handleLightningLinked(lightningPubkey: string) {
    try {
      await apiCall('/api/auth/email/link-lightning', {
        method: 'POST',
        body: JSON.stringify({ currentPubkey: verifiedPubkey, lightningPubkey }),
      })
      localStorage.setItem('linkedPubkey', lightningPubkey)
      setShowLightningLink(false)
      setStep('verified')
      setTimeout(() => { window.location.href = returnTo }, 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link Lightning wallet')
    }
  }

  if (showLightningLink) {
    return (
      <LightningLinkPrompt
        onLinked={handleLightningLinked}
        onSkip={handleSkipLightningLink}
        embedded={embedded}
        identity={email ? { provider: 'email', label: email } : undefined}
      />
    )
  }

  if (step === 'verified') {
    return (
      <div className="login-flow-enter py-8 text-center">
        <div
          className="flex items-center justify-center w-16 h-16 mx-auto mb-4 rounded-full"
          style={{ background: 'var(--color-status-success-bg)' }}
        >
          <span className="text-2xl" style={{ color: 'var(--color-status-success)' }}>✓</span>
        </div>
        <h2 className="mb-1" style={{ color: 'var(--theme-text)' }}>Email verified</h2>
        <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>Redirecting...</p>
      </div>
    )
  }

  if (step === 'sent') {
    return (
      <div className="space-y-4">
        <div className="p-6 text-center">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
            style={{ background: 'var(--color-status-success-bg)' }}
          >
            <span style={{ color: 'var(--color-status-success)' }}>✓</span>
          </div>
          <h3 className="mb-2" style={{ color: 'var(--theme-text)' }}>Check your email</h3>
          <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
            We sent a magic link to <strong>{email}</strong>
          </p>
          <p className="mt-2 text-xs" style={{ color: 'var(--theme-text-muted)' }}>
            Click the link to sign in. The link expires in 15 minutes.
          </p>
        </div>

        {import.meta.env.DEV && debugLink && (
          <div
            className="p-3 rounded-xl text-xs"
            style={{ background: 'var(--color-status-warning-bg, #fef3c7)', color: 'var(--color-status-warning, #92400e)', border: '1px dashed currentColor' }}
          >
            <div className="mb-1 font-semibold">DEV mode — no email transport configured</div>
            <div className="opacity-80 mb-2">
              Auto-redirecting in 1.5s… or click below to skip the wait.
            </div>
            <div className="break-all opacity-80 mb-2">{debugLink}</div>
            <Button
              variant="contained"
              size="small"
              onClick={() => { window.location.href = debugLink }}
              sx={{ fontSize: '0.72rem', textTransform: 'none', py: 0.5 }}
            >
              Open magic link now
            </Button>
          </div>
        )}

        <Button
          variant="text"
          size="small"
          onClick={() => { setDebugLink(null); setStep('input') }}
          sx={{ fontSize: '0.75rem', textTransform: 'none', color: 'var(--theme-text-muted)' }}
        >
          Use a different email
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
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
          Enter your email to receive a magic link
        </p>

        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="flex-1 px-3 py-2.5 rounded-xl text-sm"
            style={{
              background: 'var(--theme-bg-elevated)',
              border: '1px solid var(--theme-border)',
              color: 'var(--theme-text)',
            }}
          />
          <Button
            variant="contained"
            color="secondary"
            onClick={handleSendLink}
            disabled={loading}
            startIcon={
              loading ? (
                <CircularProgress size={14} sx={{ color: 'currentColor' }} />
              ) : undefined
            }
            sx={{ py: 1.25, px: 3, fontSize: '0.875rem', fontWeight: 600, textTransform: 'none' }}
          >
            {loading ? 'Sending...' : 'Send Link'}
          </Button>
        </div>

        <div className="mt-3">
          <NewsletterOptInCheckbox checked={newsletterOptIn} onChange={setNewsletterOptIn} disabled={loading} />
        </div>

        <p className="mt-3 text-xs text-center" style={{ color: 'var(--theme-text-muted)' }}>
          <span style={{ color: 'var(--color-primary-50)' }}>⚡</span> Optionally link Lightning wallet after verification
        </p>
      </div>
    </div>
  )
}