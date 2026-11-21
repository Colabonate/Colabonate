import { useState, useEffect } from 'react'
import { Button } from '@mui/material'
import { Zap, Bolt, Link, CheckCircle2, AtSign, Loader2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { cn } from '@ds/utils'
import { apiCall } from '../../lib/api'

interface Identity {
  provider: 'nostr' | 'email'
  label: string
}

function shortIdentityLabel(label: string): string {
  if (label.length <= 24) return label
  return `${label.slice(0, 10)}…${label.slice(-10)}`
}

export function LightningLinkPrompt({
  onLinked,
  onSkip,
  embedded = false,
  skipAllowed = true,
  identity,
}: {
  onLinked: (pubkey: string) => void
  onSkip?: () => void
  embedded?: boolean
  skipAllowed?: boolean
  identity?: Identity
}) {
  const [lnurl, setLnurl] = useState('')
  const [k1, setK1] = useState('')
  const [loading, setLoading] = useState(false)
  const [linked, setLinked] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!k1 || linked) return
    const interval = setInterval(async () => {
      try {
        const response = await apiCall(`/api/auth/lnurl/status/${k1}`)
        const data = await response.json()
        if (data.status === 'authenticated' && data.pubkey) {
          setLinked(true)
          onLinked(data.pubkey)
          clearInterval(interval)
        }
      } catch {
      }
    }, 4000)
    return () => clearInterval(interval)
  }, [k1, linked, onLinked])

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
    generateChallenge()
  }, [])

  async function handleConnectWallet() {
    if (!k1) {
      setError('Challenge nicht verfügbar')
      return
    }
    if (!lnurl) {
      setError('Kein QR-Code verfügbar – bitte Seite neu laden.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      type NostrExtension = {
        getPublicKey(): Promise<string>
        signEvent(event: object): Promise<{ sig: string; pubkey: string; id: string; [k: string]: unknown }>
      }
      const nostr = (window as unknown as { nostr?: NostrExtension }).nostr
      if (!nostr) {
        setLoading(false)
        setError('Keine Nostr-Extension gefunden. Bitte QR-Code mit der Wallet scannen.')
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
        throw new Error(data.reason ?? 'Verification failed')
      }

      // Verified synchronously via the extension — hand off immediately instead
      // of waiting for the next status-poll tick (up to 4s away), which caused
      // the button to flip back to "Connect" right before the actual redirect.
      setLinked(true)
      onLinked(signedEvent.pubkey)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('rejected')) {
        setLoading(false)
        return
      }
      setError(msg)
      setLoading(false)
    }
  }

  function IdentityBanner({ className }: { className?: string }) {
    if (!identity) return null
    const isNostr = identity.provider === 'nostr'
    return (
      <div
        className={cn(
          'flex items-center gap-3 p-3 rounded-xl border',
          className
        )}
        style={{
          background: 'var(--color-status-success-bg)',
          borderColor: 'rgba(35, 202, 97, 0.25)',
        }}
      >
        <div
          className="flex items-center justify-center w-8 h-8 rounded-full shrink-0"
          style={{ background: 'rgba(35, 202, 97, 0.15)' }}
        >
          {isNostr ? (
            <CheckCircle2 size={16} style={{ color: 'var(--color-status-success)' }} />
          ) : (
            <AtSign size={16} style={{ color: 'var(--color-status-success)' }} />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium" style={{ color: 'var(--theme-text)' }}>
            {isNostr ? 'Signed in with Nostr' : 'Signed in with Email'}
          </p>
          <p
            className="text-xs truncate font-mono"
            style={{ color: 'var(--theme-text-muted)' }}
            title={identity.label}
          >
            {shortIdentityLabel(identity.label)}
          </p>
        </div>
      </div>
    )
  }

  function OptionalBadge() {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ml-2 align-middle"
        style={{
          background: 'var(--theme-bg-subtle)',
          color: 'var(--theme-text-muted)',
          border: '1px solid var(--theme-border)',
        }}
      >
        Optional
      </span>
    )
  }

  if (embedded) {
    return (
      <div className="login-flow-enter space-y-3">
        <IdentityBanner />

        <div className="flex items-center gap-2">
          <Link size={14} style={{ color: 'var(--color-primary-50)' }} />
          <span className="text-xs font-medium" style={{ color: 'var(--theme-text)' }}>
            Connect Lightning Wallet
            <OptionalBadge />
          </span>
        </div>

        <p className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
          This step is optional. Skip it to use the auto-provisioned wallet.
        </p>

        {lnurl && (
          <div className="flex items-center justify-center rounded-xl" style={{ background: 'var(--theme-bg-subtle)' }}>
            <QRCodeSVG
              value={lnurl}
              size={112}
              level="M"
              className="w-28 h-28 rounded-lg"
            />
          </div>
        )}

        {error && (
          <p className="text-xs" style={{ color: 'var(--color-status-error)' }}>{error}</p>
        )}

        <div className={cn('grid gap-2', skipAllowed && onSkip ? 'grid-cols-2' : 'grid-cols-1')}>
          <Button
            variant="contained"
            color="primary"
            fullWidth
            onClick={handleConnectWallet}
            disabled={loading}
            startIcon={loading ? <Loader2 size={12} className="animate-spin" /> : <Bolt size={12} />}
            sx={{ py: 1, fontSize: '0.75rem', fontWeight: 600, textTransform: 'none' }}
          >
            {loading ? 'Connecting...' : 'Connect'}
          </Button>
          {skipAllowed && onSkip && (
            <Button
              variant="contained"
              size="small"
              onClick={onSkip}
              sx={{
                py: 1,
                px: 2,
                fontSize: '0.75rem',
                fontWeight: 600,
                textTransform: 'none',
                backgroundColor: 'var(--color-status-success)',
                color: 'var(--color-neutral-black)',
                '&:hover': { backgroundColor: 'var(--color-accent-3)' },
              }}
            >
              Skip
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="login-flow-enter space-y-4">
      <IdentityBanner />

      <div className="text-center">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3"
          style={{ background: 'linear-gradient(135deg, var(--color-primary-60), var(--color-primary-80))' }}
        >
          <Zap size={24} style={{ color: 'var(--color-neutral-white)' }} />
        </div>
        <h3 className="mb-1" style={{ color: 'var(--theme-text)' }}>
          Connect Your Lightning Wallet
          <OptionalBadge />
        </h3>
        <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>
          This step is optional. You can skip it and continue with the auto-provisioned wallet.
        </p>
      </div>

      <div
        className="flex items-center justify-center p-4 rounded-xl"
        style={{ background: 'var(--theme-bg-subtle)', minHeight: 180 }}
      >
        {loading && !lnurl ? (
          <div
            className="w-8 h-8 border-2 rounded-full border-t-transparent animate-spin"
            style={{ borderColor: 'var(--color-primary-50)', borderTopColor: 'transparent' }}
          />
        ) : lnurl ? (
          <QRCodeSVG
            value={lnurl}
            size={160}
            level="M"
            className="w-40 h-40 rounded-lg"
          />
        ) : (
          <p className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>No QR available</p>
        )}
      </div>

      {error && (
        <div
          className="p-3 text-sm rounded-xl"
          style={{ background: 'var(--color-status-error-bg)', color: 'var(--color-status-error)' }}
        >
          {error}
        </div>
      )}

      <div className={cn('grid gap-3', skipAllowed && onSkip ? 'grid-cols-2' : 'grid-cols-1')}>
        <Button
          variant="contained"
          color="primary"
          fullWidth
          onClick={handleConnectWallet}
          disabled={loading}
          startIcon={loading ? <Loader2 size={15} className="animate-spin" /> : <Bolt size={15} />}
          sx={{ py: 1.25, fontSize: '0.875rem', fontWeight: 600, textTransform: 'none' }}
        >
          {loading ? 'Connecting...' : 'Connect Wallet'}
        </Button>
        {skipAllowed && onSkip && (
          <Button
            variant="contained"
            onClick={onSkip}
            sx={{
              py: 1.25,
              px: 3,
              fontSize: '0.875rem',
              fontWeight: 600,
              textTransform: 'none',
              backgroundColor: 'var(--color-status-success)',
              color: 'var(--color-neutral-black)',
              '&:hover': { backgroundColor: 'var(--color-accent-3)' },
            }}
          >
            Skip for now
          </Button>
        )}
      </div>

      <p className="text-xs text-center" style={{ color: 'var(--theme-text-muted)' }}>
        Supports Alby, Phoenix, Breez, Blixt, and more
      </p>
    </div>
  )
}