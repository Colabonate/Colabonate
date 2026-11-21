/**
 * Pure sats↔fiat conversion + formatting helpers (ADR-235 D4).
 *
 * These are framework-agnostic (no React) so they can be used from non-component
 * code and unit-tested directly. The React surface (`useCurrency()` /
 * `<SatsAmount />`) wraps them with the live rate + selected currency.
 *
 * Invariant (ADR-235 D8): fiat values are display-only approximations. They are
 * never stored and never sent in any payload. Conversion uses `Math.round` to
 * integer sats; all arithmetic stays in sats and fiat is formatted at the final
 * render step only.
 */

import {
  SUPPORTED_CURRENCIES,
  DEFAULT_FIAT_CURRENCY,
  toFiatCurrency,
  type FiatCurrency,
} from '../config/currencies'
import { formatLocaleNumber } from '../contexts/LocaleContext'

/** Satoshis per 1 BTC. */
export const SATS_PER_BTC = 100_000_000

/**
 * Convert sats → fiat at the given rate (price of 1 BTC in the fiat currency).
 * Returns `null` when no rate is available (offline / stale window exceeded).
 */
export function satsToFiat(sats: number, rate: number | null): number | null {
  if (rate === null || !Number.isFinite(rate) || rate <= 0) return null
  if (!Number.isFinite(sats)) return null
  return (sats / SATS_PER_BTC) * rate
}

/**
 * Convert fiat → integer sats at the given rate. Returns `null` when no rate is
 * available. `Math.round` to integer sats.
 */
export function fiatToSats(fiat: number, rate: number | null): number | null {
  if (rate === null || !Number.isFinite(rate) || rate <= 0) return null
  if (!Number.isFinite(fiat)) return null
  return Math.round((fiat / rate) * SATS_PER_BTC)
}

export interface FormatSatsOptions {
  /**
   * `true` (default): compact "12.5k" / "1.25M" — for dense dashboard/KPI
   * surfaces (balance cards, revenue strips).
   * `false`: full locale-grouped digits "12,500" — for transactional amounts
   * (prices, cart totals, escrow, input conversion lines). This is the same
   * output as `LocaleContext.formatNumber`, so both paths group identically.
   */
  compact?: boolean
}

/**
 * Format a sats amount as a number string (no unit suffix). This is the ONE
 * place that decides compact vs. full — see `FormatSatsOptions.compact` for
 * the canonical rule. Locale grouping delegates to `formatLocaleNumber`
 * (LocaleContext) so a future locale switch reaches every sats render.
 */
export function formatSatsNumber(sats: number, opts?: FormatSatsOptions): string {
  if (!Number.isFinite(sats)) return '—'
  if (sats < 0) return `-${formatSatsNumber(-sats, opts)}`
  if (opts?.compact ?? true) {
    if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(2)}M`
    if (sats >= 1_000) return `${(sats / 1_000).toFixed(1)}k`
  }
  return formatLocaleNumber(sats)
}

/**
 * Format a sats amount with its unit, e.g. "12,500 sats" / "12.5k sats".
 * This is the canonical format that consolidates the ~10 duplicated local
 * `formatSats()` helpers and the inline `toLocaleString() + ' sats'` patterns.
 */
export function formatSats(sats: number, opts?: FormatSatsOptions): string {
  return `${formatSatsNumber(sats, opts)} sats`
}

/**
 * Format a fiat value for the given currency via `Intl.NumberFormat`. Zero-
 * decimal currencies (JPY) come out right without special-casing.
 */
export function formatFiat(value: number, currency: FiatCurrency = DEFAULT_FIAT_CURRENCY): string {
  const cfg = SUPPORTED_CURRENCIES[toFiatCurrency(currency)]
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: cfg.code,
    ...(cfg.minimumFractionDigits !== undefined ? { minimumFractionDigits: cfg.minimumFractionDigits } : {}),
    ...(cfg.maximumFractionDigits !== undefined ? { maximumFractionDigits: cfg.maximumFractionDigits } : {}),
  }).format(value)
}

/**
 * Format a sats amount with its fiat equivalent, e.g.
 * "12,500 sats ≈ €4.85". Falls back to sats-only when no rate is available
 * (fail-open per ADR-235 D5).
 */
export function formatSatsWithFiat(
  sats: number,
  rate: number | null,
  currency: FiatCurrency = DEFAULT_FIAT_CURRENCY,
): string {
  const base = formatSats(sats)
  const fiat = satsToFiat(sats, rate)
  if (fiat === null) return base
  return `${base} ≈ ${formatFiat(fiat, currency)}`
}

export { DEFAULT_FIAT_CURRENCY, toFiatCurrency }
export type { FiatCurrency }
