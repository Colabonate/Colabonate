import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import { CircularProgress } from '@mui/material'
import { cn } from '@ds/utils'

interface WalletCreateCardProps {
  /**
   * 'beta' — the closed-beta stack, where /api/wallet/create provisions a DEMO
   * wallet (ADR-197). 'production' — a real Direct-Pay-only host (ADR-253),
   * where there is no platform-held wallet to create; the user connects a
   * non-custodial rail instead.
   */
  variant?: 'beta' | 'production'
  isCreating?: boolean
  isCreated?: boolean
  onCreate?: () => void
  onOpenSettings?: () => void
  className?: string
}

export function WalletCreateCard({
  variant = 'beta',
  isCreating,
  isCreated,
  onCreate,
  onOpenSettings,
  className,
}: WalletCreateCardProps) {
  if (isCreated) {
    return (
      <div
        className={cn('flex items-center gap-3 p-4 rounded-xl border', className)}
        style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
      >
        <div
          className="flex items-center justify-center w-8 h-8 rounded-lg"
          style={{ background: 'rgba(34,197,94,0.10)', color: '#22c55e' }}
        >
          <CheckCircleIcon sx={{ fontSize: 16 }} />
        </div>
        <div className="flex flex-col">
          <span className="text-[14px] font-semibold" style={{ color: 'var(--theme-text)' }}>
            Wallet Ready
          </span>
          <span className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }}>
            {variant === 'beta'
              ? 'Your demo wallet is set up and ready to receive payments'
              : 'Your wallet is connected and ready to receive payments'}
          </span>
        </div>
      </div>
    )
  }

  const isProduction = variant === 'production'
  const bullets = isProduction
    ? ['Lightning address, NWC, Alby, or Cashu', 'Colabonate never holds your funds', 'Your keys stay with you']
    : ['Instant Lightning payments', 'No additional setup required', 'Demo sats only — no real value']

  return (
    <div
      className={cn('flex flex-col gap-4 p-5 rounded-xl border', className)}
      style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex items-center justify-center w-10 h-10 rounded-xl"
          style={{ background: 'rgba(232,69,65,0.10)', color: 'var(--color-btc)' }}
        >
          <AccountBalanceWalletIcon sx={{ fontSize: 20 }} />
        </div>
        <div className="flex flex-col">
          <span className="text-[16px] font-semibold" style={{ color: 'var(--theme-text)' }}>
            {isProduction ? 'Set Up How You Get Paid' : 'Set Up Your Wallet'}
          </span>
          <span className="text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>
            {isProduction
              ? 'Connect a non-custodial Lightning wallet to send and receive payments'
              : 'Create a demo Lightning wallet to send and receive payments'}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 text-[13px]" style={{ color: 'var(--theme-text-muted)' }}>
        {bullets.map(bullet => (
          <div key={bullet} className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-btc)' }} />
            {bullet}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={isProduction ? onOpenSettings : onCreate}
        disabled={!isProduction && isCreating}
        className={cn(
          'flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[14px] font-semibold transition-all duration-150',
          'active:scale-95',
        )}
        style={{
          background: 'var(--color-btc)',
          color: '#fff',
          opacity: !isProduction && isCreating ? 0.6 : 1,
        }}
      >
        {!isProduction && isCreating ? (
          <CircularProgress size={14} />
        ) : (
          <AccountBalanceWalletIcon sx={{ fontSize: 14 }} />
        )}
        {isProduction ? 'Open Wallet Settings' : isCreating ? 'Creating...' : 'Create Demo Wallet'}
      </button>
    </div>
  )
}
