import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { useIsFetching } from '@tanstack/react-query'
import { cn } from '@ds/utils'
import { useCurrency } from '../../contexts/CurrencyContext'
import type { FiatCurrency } from '../../config/currencies'

function formatPrice(value: number, currency: FiatCurrency): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatChange(pct: number): string {
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(2)}%`
}

/** Secondary currency for the strip: USD, or EUR when USD is the primary. */
function secondaryCurrency(primary: FiatCurrency): FiatCurrency {
  return primary === 'USD' ? 'EUR' : 'USD'
}

export function PriceStrip() {
  const { currency, rates, rateStale, rateUpdatedAt, refetchRates } = useCurrency()
  // Fetch-status is read directly from the query cache instead of the context
  // value — only this strip needs the spinner, and keeping the volatile flag
  // out of the shared context avoids re-rendering every consumer per poll.
  const isLoading = useIsFetching({ queryKey: ['exchange-rates'] }) > 0
  const [secondsAgo, setSecondsAgo] = useState(0)

  // Depend on the primitive timestamp so the 1s interval only restarts when
  // the update instant actually changes, not on Date identity churn.
  const rateUpdatedAtMs = rateUpdatedAt?.getTime() ?? null
  useEffect(() => {
    if (rateUpdatedAtMs === null) return
    setSecondsAgo(Math.max(0, Math.floor((Date.now() - rateUpdatedAtMs) / 1000)))
    const interval = setInterval(() => {
      setSecondsAgo(Math.max(0, Math.floor((Date.now() - rateUpdatedAtMs) / 1000)))
    }, 1000)
    return () => clearInterval(interval)
  }, [rateUpdatedAtMs])

  const primaryEntry = rates[currency.toLowerCase()]
  const secondary = secondaryCurrency(currency)
  const secondaryEntry = rates[secondary.toLowerCase()]

  const primary = primaryEntry?.price ?? 0
  const primaryChange = primaryEntry?.change24h ?? 0
  const secondaryValue = secondaryEntry?.price ?? 0

  const changeColor = primaryChange >= 0
    ? 'var(--color-status-success)'
    : 'var(--color-status-error)'

  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4 p-3 rounded-xl border',
        'transition-opacity duration-200',
        isLoading && 'opacity-60',
      )}
      style={{
        background: 'var(--theme-surface)',
        border: '1px solid var(--theme-border)',
      }}
    >
      <div className="flex items-center gap-2 shrink-0">
        <div
          className="flex items-center justify-center w-7 h-7 rounded-lg"
          style={{ background: 'rgba(232,69,65,0.10)', color: 'var(--color-btc)' }}
        >
          <svg width="14" height="14" viewBox="0 0 32 32" fill="currentColor">
            <path d="M32 16c0 8.837-7.163 16-16 16S0 24.837 0 16 7.163 0 16 0s16 7.163 16 16z" opacity=".2" />
            <path d="M23.189 13.178a5.393 5.393 0 0 0-4.247-2.434l-.742-.15.043-.79a.46.46 0 0 0-.22-.39.458.458 0 0 0-.41-.051l-.044.012-1.858.374a.46.46 0 0 0-.336.268.46.46 0 0 0-.008.407l.33.797-.73.147a5.42 5.42 0 0 0-4.24 2.42C10.16 16.32 10.28 18.9 10.42 21.38c0 .316.02.628.055.937l1.316-.264-.027-.91a.457.457 0 0 0-.215-.376.453.453 0 0 0-.41-.03l-.055.015-1.85.372a.457.457 0 0 0-.377.27.46.46 0 0 0 .009.407l.367.886-.715.144a5.44 5.44 0 0 0 4.24 2.42l.742.15-.043.79a.459.459 0 0 0 .22.39.46.46 0 0 0 .41.05l.044-.01 1.858-.375a.46.46 0 0 0 .336-.267.46.46 0 0 0 .008-.407l-.33-.797.73-.147a5.43 5.43 0 0 0 4.248-2.42l.242-.65.24.646a5.43 5.43 0 0 0 4.247 2.421l.742.15-.043.79a.459.459 0 0 0 .22.39.458.458 0 0 0 .41.05l.044-.012 1.86-.374a.46.46 0 0 0 .336-.267.46.46 0 0 0 .008-.407l-.33-.797.73-.147a5.42 5.42 0 0 0 4.24-2.42l.242-.65.24.646a5.42 5.42 0 0 0 4.248 2.42l.742.15-.043.79a.459.459 0 0 0 .22.39.458.458 0 0 0 .41.05l.044-.012 1.86-.374a.46.46 0 0 0 .336-.267.46.46 0 0 0 .008-.407l-.33-.797.73-.147a5.42 5.42 0 0 0 4.248-2.42c.158-.42.273-2 .413-4.48.14-2.48.26-5.06-.106-7.44a5.42 5.42 0 0 0-4.248-2.42l-.742-.15.043-.79a.46.46 0 0 0-.22-.39.458.458 0 0 0-.41-.05l-.044.01-1.858.374a.46.46 0 0 0-.336.268.46.46 0 0 0-.008.407l.33.797-.73.147a5.42 5.42 0 0 0-4.248 2.42l-.242.65-.24-.646a5.42 5.42 0 0 0-4.247-2.42l-.742-.15.043-.79a.459.459 0 0 0-.22-.39.46.46 0 0 0-.41-.05l-.044.012-1.86.374a.46.46 0 0 0-.336.268.46.46 0 0 0-.008.407l.33.797-.73.147z" />
          </svg>
        </div>
        <span className="text-[14px] font-bold" style={{ color: 'var(--color-btc)' }}>
          BTC
        </span>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex flex-col">
          <span
            className="text-[15px] font-bold tabular-nums"
            style={{ color: 'var(--theme-text)' }}
          >
            {primary > 0 ? formatPrice(primary, currency) : '—'}
          </span>
          <span className="text-[11px]" style={{ color: changeColor }}>
            {formatChange(primaryChange)} (24h){rateStale ? ' · stale' : ''}
          </span>
        </div>

        <div className="h-6 w-px" style={{ background: 'var(--theme-border)' }} />

        <div className="flex flex-col">
          <span
            className="text-[12px] font-semibold tabular-nums"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            {secondaryValue > 0 ? formatPrice(secondaryValue, secondary) : '—'}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
            {secondary}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 ml-auto shrink-0">
        <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
          {secondsAgo}s ago
        </span>
        <button
          type="button"
          onClick={refetchRates}
          className={cn(
            'p-1.5 rounded-lg transition-all duration-150',
            'hover:bg-[var(--theme-surface-secondary)] active:scale-95',
          )}
          style={{ color: 'var(--theme-text-muted)' }}
          aria-label="Refresh price"
        >
          <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>
  )
}
