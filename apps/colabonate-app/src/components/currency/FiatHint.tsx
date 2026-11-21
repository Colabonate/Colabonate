/**
 * FiatHint — the small fiat equivalent (e.g. "€4.85") next to a sats amount
 * (ADR-235 D5). The single source of the format, the stale-rate tooltip, and
 * the fail-open rule: renders nothing when no rate is available.
 *
 * Format rules (user decision 2026-07-13): the plain value with NO `≈`/`=`
 * prefix, semibold, and a neutral muted default color — it must never inherit
 * the red price-accent of a surrounding chip. Size/spacing stay call-site
 * concerns via `className`; an explicit `style.color` still wins.
 */

import type { CSSProperties } from 'react'
import { cn } from '@ds/utils'
import { useCurrency } from '../../contexts/CurrencyContext'

export interface FiatHintProps {
  /** Sats amount (integer) to show the fiat equivalent for. */
  sats: number
  className?: string
  style?: CSSProperties
}

export function FiatHint({ sats, className, style }: FiatHintProps) {
  const { satsToFiat, formatFiat, rateStale } = useCurrency()

  const fiat = satsToFiat(sats)
  if (fiat === null) return null

  return (
    <span
      className={cn('font-semibold tabular-nums', className)}
      style={{ color: 'var(--theme-text-muted)', ...style }}
      title={rateStale ? 'Exchange rate may be stale' : undefined}
    >
      {formatFiat(fiat)}
    </span>
  )
}
