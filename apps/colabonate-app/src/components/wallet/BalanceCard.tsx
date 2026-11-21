import { RefreshCw, Zap } from 'lucide-react'
import { cn } from '@ds/utils'
import { useCurrency } from '../../contexts/CurrencyContext'
import { formatSatsNumber, formatFiat as formatFiatPure } from '../../lib/currency'
import type { Wallet } from '../../contexts/WalletContext'
import { walletProviderLabel } from '../../lib/walletProviderLabels'

interface BalanceCardProps {
  wallet: Wallet
  onRefresh: () => void
  refreshing?: boolean
}

const MODE_LABELS: Record<Wallet['mode'], string> = {
  CUSTODIAL: 'Custodial',
  NON_CUSTODIAL: 'Non-custodial',
}

export function BalanceCard({ wallet, onRefresh, refreshing }: BalanceCardProps) {
  const { currency, satsToFiat, hasRate, rateStale } = useCurrency()

  const balanceSats = wallet.balance?.confirmedSats ?? wallet.balanceSats
  const fiatValue = satsToFiat(balanceSats)
  const fiatFormatted = fiatValue !== null ? formatFiatPure(fiatValue, currency) : null

  return (
    <div
      className={cn(
        'flex flex-col gap-4 p-5 rounded-xl border',
      )}
      style={{
        background: 'var(--theme-surface)',
        border: '1px solid var(--theme-border)',
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="flex items-center justify-center w-8 h-8 rounded-lg"
            style={{ background: 'rgba(232,69,65,0.10)', color: 'var(--color-btc)' }}
          >
            <Zap size={16} />
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] uppercase font-semibold tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
              {walletProviderLabel(wallet.provider)}
            </span>
            <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
              {MODE_LABELS[wallet.mode]}
              {wallet.lastSyncedAt && ` • Synced ${new Date(wallet.lastSyncedAt).toLocaleTimeString()}`}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-150',
            'hover:bg-[var(--theme-surface-secondary)] active:scale-95',
          )}
          style={{
            border: '1px solid var(--theme-border)',
            color: 'var(--theme-text-muted)',
          }}
          disabled={refreshing}
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span
            className="text-[32px] font-bold tabular-nums leading-none"
            style={{ color: 'var(--theme-text)', letterSpacing: '-0.02em' }}
          >
            {formatSatsNumber(balanceSats)}
          </span>
          <span className="text-[14px] font-semibold" style={{ color: 'var(--color-btc)' }}>
            sats
          </span>
        </div>
        {fiatFormatted && hasRate && (
          <span
            className="text-[17px] font-bold"
            style={{ color: 'var(--theme-text-muted)' }}
            title={rateStale ? 'Exchange rate may be stale' : undefined}
          >
            {fiatFormatted}
          </span>
        )}
      </div>

      {wallet.provider === 'DEMO' && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium"
          style={{ background: 'rgba(245,124,42,0.10)', color: 'var(--color-accent-2)' }}
        >
          <span className="w-2 h-2 rounded-full bg-current" />
          Demo Mode — simulated balance, not real sats
        </div>
      )}
    </div>
  )
}
