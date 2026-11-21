import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Button, CircularProgress } from '@mui/material'
import { Bolt } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { cn } from '@ds/utils'
import { apiCall } from '../../lib/api'
import { getValidatedReturnTo } from '../../lib/auth-guard'

type NostrExtension = {
  getPublicKey(): Promise<string>
  signEvent(event: object): Promise<{ sig: string; pubkey: string; id: string; [k: string]: unknown }>
}

function getNip07(): NostrExtension | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { nostr?: NostrExtension }).nostr ?? null
}

// LUD-17: every LNURL-auth-capable wallet registers the generic `lightning:`
// URI scheme with the OS (there is no per-wallet scheme) — so all four
// buttons below hand off to the same link. Whichever of these is installed
// opens it directly; if more than one is installed, the OS shows its usual
// app picker. This lets a same-device mobile user sign in without scanning
// their own screen.
const LNURL_AUTH_WALLETS = ['Breez', 'Wallet of Satoshi', 'Blink', 'Zeus']

export function TabLightning({ embedded = false }: { embedded?: boolean }) {
  const [lnurl, setLnurl] = useState<string>('')
  const [k1, setK1] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // The "sign in without scanning" shortcut only works when an Alby-style
  // NIP-07 extension is present (it signs the LNURL-auth challenge as a
  // Nostr event) — it does NOT work with a phone wallet like Phoenix/Breez.
  // Detect it up front so the shortcut is only offered when it will work.
  const [hasNip07, setHasNip07] = useState<boolean | null>(null)
  const location = useLocation()

  useEffect(() => {
    setHasNip07(getNip07() !== null)
  }, [])

  useEffect(() => { generateChallenge() }, [])

  async function generateChallenge() {
    setLoading(true)
    setError(null)
    try {
      const response = await apiCall('/api/auth/lnurl')
      const data = await response.json()
      if (data.lnurl && data.k1) {
        setLnurl(data.lnurl)
        setK1(data.k1)
      }
    } catch {
      setError('Server unreachable.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!k1 || authenticated) return
    let failCount = 0
    const interval = setInterval(async () => {
      try {
        const response = await apiCall(`/api/auth/lnurl/status/${k1}`)
        const data = await response.json()
        failCount = 0
        if (data.status === 'authenticated') {
          setAuthenticated(true)
          localStorage.setItem('pubkey', data.pubkey)
          if (data.token) localStorage.setItem('authToken', data.token)
          if (data.lnAddress) localStorage.setItem('lnAddress', data.lnAddress)
          clearInterval(interval)
          // ADR-303 D10: return the user to the page that asked for login.
          setTimeout(() => { window.location.href = getValidatedReturnTo(location.state, location.search) }, 1000)
        }
      } catch {
        failCount++
        if (failCount >= 3) clearInterval(interval)
      }
    }, 4000)
    return () => clearInterval(interval)
  }, [k1, authenticated])

  function handleCopy() {
    navigator.clipboard.writeText(lnurl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const lightningUri = lnurl ? `lightning:${lnurl}` : ''

  // Chrome for Android fails SILENTLY on a plain `<a href="lightning:...">`
  // when no app is registered for that scheme — no dialog, no error, the
  // link just does nothing (a long-documented Chrome-for-Android quirk:
  // github.com/EddyVerbruggen/Custom-URL-scheme/issues/31). Android's
  // `intent://` syntax forces Chrome through its actual intent-resolution
  // path instead, which is far more likely to find an installed handler.
  // iOS/desktop browsers handle the plain scheme href fine (confirmed
  // working on desktop already), so only Android needs the wrapper.
  function openWalletApp() {
    if (!lnurl) return
    navigator.clipboard?.writeText(lnurl).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 4000)
    const isAndroid = /Android/i.test(navigator.userAgent)
    window.location.href = isAndroid
      ? `intent://${lnurl}#Intent;scheme=lightning;end`
      : lightningUri
  }

  function renderWalletDeepLinks(compact: boolean) {
    if (!lightningUri) return null
    return (
      <div className="flex flex-col gap-1.5">
        <p
          className={cn('font-medium text-center md:text-left', compact ? 'text-[10px]' : 'text-xs')}
          style={{ color: 'var(--theme-text)' }}
        >
          On this phone? Open directly in your wallet app:
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {LNURL_AUTH_WALLETS.map((name) => (
            <Button
              key={name}
              onClick={openWalletApp}
              variant="outlined"
              size="small"
              startIcon={<Bolt size={compact ? 11 : 13} />}
              sx={{
                fontSize: compact ? '0.65rem' : '0.75rem',
                py: compact ? 0.5 : 0.75,
                px: 1,
                minWidth: 0,
                justifyContent: 'flex-start',
                textTransform: 'none',
                borderColor: 'var(--theme-border)',
                color: 'var(--theme-text)',
              }}
            >
              {name}
            </Button>
          ))}
        </div>
        {copied && (
          <p className={cn('text-center md:text-left', compact ? 'text-[9px]' : 'text-[10px]')} style={{ color: 'var(--color-status-success)' }}>
            Code copied — if your wallet didn&apos;t open automatically, paste it into its login/LNURL field.
          </p>
        )}
      </div>
    )
  }

  async function handleLightningLogin() {
    if (!k1) {
      setError('Challenge unavailable — please reload the page.')
      return
    }
    if (!lnurl) {
      setError('No QR code available — please reload the page.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const nostr = getNip07()
      if (!nostr) {
        setLoading(false)
        setError('No Alby extension detected — scan the QR code above with your Lightning wallet instead.')
        return
      }

      const pubkey = await nostr.getPublicKey()

      const unsignedEvent = {
        kind: 27235,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['challenge', k1]],
        content: k1,
        pubkey,
      }
      const signedEvent = await nostr.signEvent(unsignedEvent)

      const params = new URLSearchParams({
        k1,
        key: signedEvent.pubkey,
        sig: signedEvent.sig,
        event: JSON.stringify(signedEvent),
      })
      const res = await apiCall(`/api/auth/lnurl/callback?${params}`)
      const data = await res.json()

      if (data.status !== 'OK') {
        throw new Error(data.reason ?? 'Callback failed')
      }

      localStorage.setItem('pubkey', data.pubkey ?? signedEvent.pubkey)
      if (data.token) localStorage.setItem('authToken', data.token)
      if (data.lnAddress) localStorage.setItem('lnAddress', data.lnAddress)
      setAuthenticated(true)
      setTimeout(() => { window.location.href = getValidatedReturnTo(location.state, location.search) }, 1000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('rejected')) {
        setLoading(false)
        return
      }
      setError('Login failed: ' + msg)
    } finally {
      setLoading(false)
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

  if (embedded) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-3 md:gap-4">
        <div className="flex flex-col gap-3 md:gap-0 md:row-span-2">
          <div className="flex items-center gap-2 md:mb-3">
            <Bolt size={13} style={{ color: 'var(--color-primary-50)' }} />
            <span
              className="text-xs font-medium uppercase tracking-widest"
              style={{ color: 'var(--theme-text-muted)', letterSpacing: '0.1em' }}
            >
              Lightning Login
            </span>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse ml-auto" style={{ background: 'var(--color-primary-50)' }} />
          </div>

          <div
            className="flex items-center justify-center rounded-xl shrink-0"
            style={{ background: 'var(--theme-bg-subtle)', width: 140, height: 140 }}
          >
            {loading ? (
              <div
                className="border-2 rounded-full w-7 h-7 border-t-transparent animate-spin"
                style={{ borderColor: 'var(--color-primary-50)', borderTopColor: 'transparent' }}
              />
            ) : lnurl ? (
              <QRCodeSVG
                value={lnurl}
                size={128}
                level="M"
                className="rounded-sm w-32 h-32"
              />
            ) : (
              <p className="text-[10px] text-center px-2" style={{ color: 'var(--theme-text-muted)' }}>No QR</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {lnurl && (
            <div
              className="rounded-lg px-2.5 py-1.5 flex items-center gap-2"
              style={{ border: '1px solid var(--theme-border)' }}
            >
              <p className="flex-1 font-mono text-[10px] truncate" style={{ color: 'var(--theme-text-muted)' }}>
                {lnurl.slice(0, 36)}...
              </p>
              <Button
                variant="outlined"
                size="small"
                onClick={handleCopy}
                sx={{
                  fontSize: '0.7rem',
                  py: 0.5,
                  px: 1.5,
                  minWidth: 0,
                  borderColor: copied ? 'var(--color-status-success)' : 'var(--theme-border)',
                  color: copied ? 'var(--color-status-success)' : 'var(--theme-text-muted)',
                  '&:hover': { borderColor: 'var(--color-status-success)' },
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          )}

          <p className="text-[11px] font-medium text-center md:text-left" style={{ color: 'var(--theme-text)' }}>
            Scan with another device&apos;s camera, or use a button below on this one.
          </p>
          <p className="text-[10px] text-center md:text-left" style={{ color: 'var(--theme-text-muted)' }}>
            Waiting for confirmation...
          </p>

          {renderWalletDeepLinks(true)}

          <p className="text-[10px] text-center md:text-left" style={{ color: 'var(--theme-text-muted)' }}>
            Needs a wallet with LNURL-auth login (e.g. Zeus) — Phoenix does not support this.
          </p>

          {/* The button below is an Alby-extension-only shortcut (it signs via
              window.nostr, not an actual Lightning wallet) — only offered when
              that extension is actually detected, so it never invites a click
              that's guaranteed to fail for phone-wallet users. */}
          {hasNip07 && (
            <div className="flex items-center gap-2 pt-1 mt-auto">
              <Button
                variant="outlined"
                fullWidth
                disabled={loading}
                onClick={handleLightningLogin}
                startIcon={
                  loading ? (
                    <CircularProgress size={13} sx={{ color: 'currentColor' }} />
                  ) : (
                    <Bolt size={13} />
                  )
                }
                sx={{ py: 1, fontSize: '0.7rem', fontWeight: 600, textTransform: 'none' }}
              >
                {loading ? 'Connecting...' : 'Or sign in with Alby, no scan needed'}
              </Button>
            </div>
          )}

          {!hasNip07 && (
            <p className="text-[10px] text-center md:text-left" style={{ color: 'var(--theme-text-muted)' }}>
              Wallet not recognizing the code? Switch to the{' '}
              <span style={{ color: 'var(--theme-text)', fontWeight: 600 }}>Email</span> tab above instead.
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
{error && (
        <div
          className="flex items-start gap-3 p-3 mb-5 text-sm rounded-xl"
          style={{ background: 'var(--color-status-error-bg)', border: '1px solid var(--color-status-error)' }}
        >
          <span style={{ color: 'var(--color-status-error)' }}>⚠</span>
          <div className="flex-1">
            <p style={{ color: 'var(--color-status-error)' }}>{error}</p>
            <Button
              onClick={generateChallenge}
              size="small"
              disabled={loading}
              startIcon={
                loading ? (
                  <CircularProgress size={12} sx={{ color: 'currentColor' }} />
                ) : undefined
              }
              sx={{ mt: 0.5, fontSize: '0.7rem', textTransform: 'none', color: 'var(--color-status-error)' }}
            >
              {loading ? 'Connecting...' : 'Try again'}
            </Button>
          </div>
        </div>
      )}

      <p className="mb-3 text-sm font-medium text-center" style={{ color: 'var(--theme-text)' }}>
        Scan with another device&apos;s wallet app, or use a button below if you&apos;re on your phone.
      </p>

      <div
        className="flex items-center justify-center p-4 mb-4 rounded-xl"
        style={{ background: 'var(--theme-bg-subtle)', minHeight: 220 }}
      >
        {loading ? (
          <div
            className="w-10 h-10 border-2 rounded-full border-t-transparent animate-spin"
            style={{ borderColor: 'var(--color-primary-50)', borderTopColor: 'transparent' }}
          />
        ) : lnurl ? (
          <QRCodeSVG
            value={lnurl}
            size={192}
            level="M"
            className="w-48 h-48 rounded-lg"
          />
        ) : (
          <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>No QR available</p>
        )}
      </div>

      {lnurl && (
        <div
          className="flex items-center justify-between gap-2 p-3 mb-5 rounded-xl"
          style={{ border: '1px solid var(--theme-border)' }}
        >
          <p
            className="flex-1 font-mono text-xs truncate"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            {lnurl.slice(0, 40)}...
          </p>
          <Button
            variant={copied ? 'contained' : 'outlined'}
            size="small"
            onClick={handleCopy}
            sx={{
              fontSize: '0.7rem',
              py: 0.75,
              px: 1.5,
              minWidth: 0,
              borderColor: copied ? 'var(--color-status-success)' : 'var(--theme-border)',
              color: copied ? 'var(--color-neutral-white)' : 'var(--theme-text-muted)',
              bgcolor: copied ? 'var(--color-status-success)' : undefined,
              '&:hover': { borderColor: 'var(--color-status-success)' },
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      )}

      <div className="mb-5">{renderWalletDeepLinks(false)}</div>

      <div className="flex items-center justify-center gap-2 mb-5">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
          style={{ background: 'var(--color-primary-50)' }}
        />
        <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
          Waiting for confirmation...
        </p>
      </div>

      <p className="text-xs text-center mb-6" style={{ color: 'var(--theme-text-muted)' }}>
        Needs a wallet with LNURL-auth login support (e.g. Zeus or BlueWallet) — not every Lightning
        wallet has this. Phoenix, for example, does not support it.
      </p>

      {/* Alby-extension-only shortcut (signs via window.nostr, not an actual
          Lightning wallet) — only shown when the extension is detected, so
          phone-wallet users are never invited to click something that's
          guaranteed to fail for them. Everyone else uses the QR scan above. */}
      {hasNip07 && (
        <div
          className="p-4 mb-4 rounded-xl"
          style={{ border: '1px solid var(--theme-border)' }}
        >
          <p
            className="mb-3 text-xs font-medium text-center"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            Have the Alby browser extension? Skip the QR code.
          </p>
          <Button
            variant="outlined"
            fullWidth
            disabled={loading}
            onClick={handleLightningLogin}
            startIcon={
              loading ? (
                <CircularProgress size={15} sx={{ color: 'currentColor' }} />
              ) : (
                <Bolt size={15} />
              )
            }
            sx={{ py: 1.25, fontSize: '0.875rem', fontWeight: 600, textTransform: 'none' }}
          >
            {loading ? 'Connecting...' : 'Sign in with Alby'}
          </Button>
        </div>
      )}

      {!hasNip07 && (
        <p className="text-xs text-center" style={{ color: 'var(--theme-text-muted)' }}>
          Wallet not recognizing the code, or unsure if it supports LNURL-auth?{' '}
          <span style={{ color: 'var(--theme-text)', fontWeight: 600 }}>Switch to the Email tab</span> above —
          no wallet required.
        </p>
      )}

    </>
  )
}