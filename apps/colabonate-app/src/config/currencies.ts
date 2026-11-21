/**
 * Supported fiat currencies (ADR-235 D1).
 *
 * Single source of truth for the fiat currencies a user can pick as their
 * display preference. Formatting always goes through `Intl.NumberFormat`, so
 * zero-decimal currencies (JPY) render correctly without special-casing.
 *
 * Adding a currency = one entry here + one rates key on the server
 * (`apps/server/services/exchangeRates.ts` `SUPPORTED_RATE_CURRENCIES`, FU-235-A).
 *
 * Keep this in sync with the server `SUPPORTED_FIAT_CURRENCIES` set in
 * `apps/server/index.ts`.
 */

export type FiatCurrency = 'EUR' | 'USD' | 'RUB' | 'JPY'

export interface CurrencyConfig {
  /** ISO 4217 code. */
  code: FiatCurrency
  /** Unicode symbol for compact UI labels. */
  symbol: string
  /** `Intl.NumberFormat` fraction-digit overrides; `undefined` = locale default. */
  minimumFractionDigits?: number
  maximumFractionDigits?: number
}

export const SUPPORTED_CURRENCIES: Record<FiatCurrency, CurrencyConfig> = {
  EUR: { code: 'EUR', symbol: '€', maximumFractionDigits: 2 },
  USD: { code: 'USD', symbol: '$', maximumFractionDigits: 2 },
  RUB: { code: 'RUB', symbol: '₽', maximumFractionDigits: 2 },
  // JPY is a zero-decimal currency — Intl handles this by default, but we pin it
  // so the input's live-conversion line never shows fractional yen.
  JPY: { code: 'JPY', symbol: '¥', minimumFractionDigits: 0, maximumFractionDigits: 0 },
}

/** Stable display order for radio groups / pickers. */
export const SUPPORTED_CURRENCY_LIST: CurrencyConfig[] = Object.values(SUPPORTED_CURRENCIES)

export const DEFAULT_FIAT_CURRENCY: FiatCurrency = 'EUR'

const CURRENCY_CODES = Object.keys(SUPPORTED_CURRENCIES) as FiatCurrency[]

export function isFiatCurrency(value: unknown): value is FiatCurrency {
  return typeof value === 'string' && (CURRENCY_CODES as string[]).includes(value)
}

/** Coerce an arbitrary value to a valid FiatCurrency, falling back to EUR. */
export function toFiatCurrency(value: unknown): FiatCurrency {
  return isFiatCurrency(value) ? value : DEFAULT_FIAT_CURRENCY
}
