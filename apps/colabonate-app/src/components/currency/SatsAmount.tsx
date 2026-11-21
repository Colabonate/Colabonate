/**
 * SatsAmount — renders a sats amount with a small fiat equivalent (ADR-235 D5).
 *
 * Sats are primary; the fiat value is a muted secondary (`≈ €4.85`) with
 * `tabular-nums`. Fail-open: when no rate is available (offline / upstream down
 * beyond the stale window) it renders sats only — fiat display never blocks and
 * never shows misleading zeros.
 *
 * Lives in the app (not `packages/ui`) because it is context- and network-
 * coupled (headless-first rule; same reasoning that kept ListBrowser out of
 * packages/ui, ADR-218).
 */

import { cn } from '@ds/utils'
import { formatSatsNumber } from '../../lib/currency'
import { FiatHint } from './FiatHint'

export type SatsAmountSize = 'sm' | 'md' | 'lg'
export type SatsAmountLayout = 'inline' | 'stacked'

export interface SatsAmountProps {
  /** Sats amount (integer). */
  sats: number
  /** Primary text size. */
  size?: SatsAmountSize
  /** `inline` (secondary after primary) or `stacked` (secondary below). */
  layout?: SatsAmountLayout
  /** Show the "sats" unit label next to the number (default true). */
  showUnit?: boolean
  className?: string
}

const PRIMARY_SIZE: Record<SatsAmountSize, string> = {
  sm: 'text-[12px]',
  md: 'text-[14px]',
  lg: 'text-[28px] leading-none',
}

const SECONDARY_SIZE: Record<SatsAmountSize, string> = {
  sm: 'text-[11px]',
  md: 'text-[12px]',
  lg: 'text-[15px]',
}

const UNIT_SIZE: Record<SatsAmountSize, string> = {
  sm: 'text-[10px]',
  md: 'text-[12px]',
  lg: 'text-[14px]',
}

export function SatsAmount({
  sats,
  size = 'md',
  layout = 'inline',
  showUnit = true,
  className,
}: SatsAmountProps) {
  return (
    <span
      className={cn(
        layout === 'stacked' ? 'flex flex-col gap-0.5' : 'inline-flex items-baseline gap-1.5',
        className,
      )}
    >
      <span className="inline-flex items-baseline gap-1">
        <span
          className={cn('font-bold tabular-nums', PRIMARY_SIZE[size])}
          style={{ color: 'var(--theme-text)' }}
        >
          {formatSatsNumber(sats)}
        </span>
        {showUnit && (
          <span className={cn('font-semibold', UNIT_SIZE[size])} style={{ color: 'var(--color-btc)' }}>
            sats
          </span>
        )}
      </span>
      <FiatHint
        sats={sats}
        className={SECONDARY_SIZE[size]}
        style={{ color: 'var(--theme-text-muted)' }}
      />
    </span>
  )
}
