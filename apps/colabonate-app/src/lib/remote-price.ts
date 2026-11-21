/**
 * Display-only estimate of the satoshi equivalent of a foreign-priced listing.
 * Never used for settlement: settlement always happens in sats on the server.
 */

export type RateEntryLike = { price: number } // price = value of 1 BTC in that fiat currency
export type RateMapLike = Record<string, RateEntryLike> // keys are lowercase currency codes

export type SatEstimateBasis = 'exact-btc' | 'rate' | 'stablecoin-as-usd'
export interface SatEstimate {
  sats: number
  basis: SatEstimateBasis
}

const SATS_PER_BTC = 1e8

/** Currencies that cannot be paid over Lightning, so no sat estimate is offered. */
const NON_LIGHTNING_CURRENCIES = new Set([
  'xmr', 'eth', 'sol', 'bch', 'algo', 'rvn', 'testsat', 'ltc', 'doge',
  'xrp', 'ada', 'dot', 'matic', 'avax', 'trx',
])

/** Sat units are not foreign prices; callers handle sats directly. */
const SAT_UNIT_CURRENCIES = new Set(['sat', 'sats', 'msat'])

const STABLECOIN_AS_USD = new Set(['usdc', 'usdt'])

export function estimateSatsFromForeignPrice(
  amount: string | null | undefined,
  currency: string | null | undefined,
  rates: RateMapLike,
): SatEstimate | null {
  try {
    if (amount === null || amount === undefined) return null
    // Same plain-decimal grammar as the server quote (Number() would accept '0x10', '1e3').
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(amount.trim())) return null
    const value = Number(amount.trim())
    if (!Number.isFinite(value) || value <= 0) return null

    if (typeof currency !== 'string') return null
    const code = currency.trim().toLowerCase()
    if (code === '') return null

    if (code === 'btc') {
      const sats = Math.round(value * SATS_PER_BTC)
      return sats > 0 ? { sats, basis: 'exact-btc' } : null
    }

    if (NON_LIGHTNING_CURRENCIES.has(code) || SAT_UNIT_CURRENCIES.has(code)) return null

    const isStablecoin = STABLECOIN_AS_USD.has(code)
    const rateCode = isStablecoin ? 'usd' : code
    if (!rates || !Object.prototype.hasOwnProperty.call(rates, rateCode)) return null

    const price = rates[rateCode]?.price
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null

    const sats = Math.round((value / price) * SATS_PER_BTC)
    if (sats <= 0) return null

    return { sats, basis: isStablecoin ? 'stablecoin-as-usd' : 'rate' }
  } catch {
    return null
  }
}

export function formatEstimateLabel(
  estimate: SatEstimate,
  formatNumber: (n: number) => string,
): string {
  const base = `≈ ${formatNumber(estimate.sats)} sats`
  return estimate.basis === 'stablecoin-as-usd' ? `${base} (stablecoin treated as USD)` : base
}
