import { useState, useEffect } from 'react'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { CircularProgress } from '@mui/material'
import { cn } from '@ds/utils'
import { ExternalLink, Wallet, AlertCircle, Loader2 } from 'lucide-react'

interface WalletConnectFlowProps {
  onConnect: () => Promise<void>
  onDisconnect?: () => Promise<void>
  isConnecting?: boolean
  isConnected?: boolean
  className?: string
}

type WebLNStatus = 'checking' | 'available' | 'unavailable'

export function WalletConnectFlow({
  onConnect,
  onDisconnect,
  isConnecting,
  isConnected,
  className,
}: WalletConnectFlowProps) {
  const [weblnStatus, setWeblnStatus] = useState<WebLNStatus>('checking')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') {
      setWeblnStatus('unavailable')
      return
    }
    const timer = setTimeout(() => {
      setWeblnStatus((window as any).webln ? 'available' : 'unavailable')
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  const handleConnect = async () => {
    setError(null)
    try {
      await onConnect()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
    }
  }

  if (weblnStatus === 'checking') {
    return (
      <div
        className={cn('flex items-center gap-3 p-4 rounded-xl border', className)}
        style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
      >
        <CircularProgress size={16} style={{ color: 'var(--theme-text-muted)' }} />
        <span className="text-[14px]" style={{ color: 'var(--theme-text-muted)' }}>
          Checking for WebLN wallet...
        </span>
      </div>
    )
  }

  if (isConnected) {
    return (
      <div
        className={cn('flex items-center justify-between p-4 rounded-xl border', className)}
        style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center w-8 h-8 rounded-lg"
            style={{ background: 'rgba(34,197,94,0.10)', color: '#22c55e' }}
          >
            <CheckCircleIcon sx={{ fontSize: 16 }} />
          </div>
          <div className="flex flex-col">
            <span className="text-[14px] font-semibold" style={{ color: 'var(--theme-text)' }}>
              WebLN Wallet Connected
            </span>
            <span className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }}>
              Non-custodial mode active
            </span>
          </div>
        </div>
        {onDisconnect && (
          <button
            type="button"
            onClick={onDisconnect}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-150 hover:bg-[var(--theme-surface-secondary)] active:scale-95"
            style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)' }}
          >
            Disconnect
          </button>
        )}
      </div>
    )
  }

  if (weblnStatus === 'unavailable') {
    return (
      <div
        className={cn('flex flex-col gap-3 p-4 rounded-xl border', className)}
        style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
      >
        <div className="flex items-center gap-3">
          <ErrorOutlineIcon sx={{ fontSize: 16, color: '#f59e0b' }} />
          <span className="text-[14px] font-medium" style={{ color: 'var(--theme-text)' }}>
            No WebLN wallet detected
          </span>
        </div>
        <p className="text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>
          WebLN needs a browser extension wallet specifically — a phone wallet app alone can&apos;t provide it.
          Install one to use non-custodial mode:
        </p>
        <a
          href="https://getalby.com/alby-extension"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-150 hover:bg-[var(--theme-surface-secondary)] self-start"
          style={{ border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
        >
          Alby browser extension <ExternalLink size={10} />
        </a>
        <p className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }}>
          On mobile, or don&apos;t want an extension? Use{' '}
          <span style={{ color: 'var(--theme-text)', fontWeight: 600 }}>Nostr Wallet Connect</span> below instead —
          it works with phone wallets like Zeus and Alby Hub, no browser extension needed.
        </p>
      </div>
    )
  }

  return (
    <div
      className={cn('flex flex-col gap-3 p-4 rounded-xl border', className)}
      style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex items-center justify-center w-8 h-8 rounded-lg"
          style={{ background: 'rgba(232,69,65,0.10)', color: 'var(--color-btc)' }}
        >
          <Wallet size={16} />
        </div>
        <div className="flex flex-col">
          <span className="text-[14px] font-semibold" style={{ color: 'var(--theme-text)' }}>
            Connect Your Wallet
          </span>
          <span className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }}>
            WebLN wallet detected — connect to use non-custodial mode
          </span>
        </div>
      </div>

      {error && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium"
          style={{ background: 'rgba(239,68,68,0.10)', color: '#ef4444' }}
        >
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleConnect}
        disabled={isConnecting}
        className={cn(
          'flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[14px] font-semibold transition-all duration-150',
          'active:scale-95',
        )}
        style={{
          background: 'var(--color-btc)',
          color: '#fff',
          opacity: isConnecting ? 0.6 : 1,
        }}
      >
        {isConnecting ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Wallet size={14} />
        )}
        {isConnecting ? 'Connecting...' : 'Connect WebLN Wallet'}
      </button>
    </div>
  )
}
