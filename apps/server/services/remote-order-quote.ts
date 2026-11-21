// Server-side quote for remote-offer orders (ADR-417 D4). Pure, never throws.
// The sats amount computed here is authoritative and fixed at order creation.
// Display rules mirror apps/colabonate-app/src/lib/remote-price.ts (display only);
// this module is the settlement-side source of truth.

import { isLightningPayableCurrency } from '@col/nostr-schema'

/** Digits with an optional decimal part, e.g. '2', '49.99', '.5'. */
const DECIMAL_AMOUNT = /^(\d+(\.\d*)?|\.\d+)$/

export const QUOTE_TTL_MS = 10 * 60 * 1000
export const MAX_REMOTE_QUANTITY = 100

const SATS_PER_BTC = 1e8
const SAT_UNIT_CURRENCIES = new Set(['sat', 'sats', 'msat'])
const STABLECOIN_AS_USD = new Set(['usdc', 'usdt'])

export type QuoteBasis = 'sats' | 'exact-btc' | 'rate' | 'stablecoin-as-usd'

export interface RemoteQuote {
  amountSats: number
  basis: QuoteBasis
  quantity: number
  priceAmount?: string
  priceCurrency?: string
  rate?: { currency: string; btcPrice: number }
}

export type QuoteResult =
  | { ok: true; quote: RemoteQuote }
  | { ok: false; reason: 'PRICE_NOT_CONVERTIBLE' | 'ABOVE_LAUNCH_CAP' | 'INVALID_QUANTITY' }

export function computeRemoteQuote(input: {
  offer: { priceSats: number; priceAmount?: string | null; priceCurrency?: string | null }
  quantity: number
  rates: Record<string, { price: number }>
  maxTxSats: number
}): QuoteResult {
  const { offer, quantity, rates, maxTxSats } = input

  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_REMOTE_QUANTITY) {
    return { ok: false, reason: 'INVALID_QUANTITY' }
  }

  const rawCurrency = offer.priceCurrency
  if (rawCurrency !== null && rawCurrency !== undefined && typeof rawCurrency !== 'string') {
    return { ok: false, reason: 'PRICE_NOT_CONVERTIBLE' }
  }
  const currencyTrimmed = typeof rawCurrency === 'string' ? rawCurrency.trim() : ''

  let amountSats: number
  let basis: QuoteBasis
  let rate: RemoteQuote['rate']
  let priceAmount: string | undefined
  let priceCurrency: string | undefined

  if (currencyTrimmed === '') {
    // Sats-priced listing (or unpublished when priceSats is not a positive number).
    const priceSats = offer.priceSats
    if (typeof priceSats !== 'number' || !Number.isFinite(priceSats) || priceSats <= 0) {
      return { ok: false, reason: 'PRICE_NOT_CONVERTIBLE' }
    }
    amountSats = priceSats * quantity
    basis = 'sats'
  } else {
    const rawAmount = offer.priceAmount
    // Plain decimal grammar only: Number() would also accept '0x10', '1e3', '0b11' and similar.
    const amount =
      typeof rawAmount === 'string' && DECIMAL_AMOUNT.test(rawAmount.trim()) ? Number(rawAmount.trim()) : Number.NaN
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, reason: 'PRICE_NOT_CONVERTIBLE' }
    }

    const code = currencyTrimmed.toLowerCase()
    if (SAT_UNIT_CURRENCIES.has(code) || !isLightningPayableCurrency(code)) {
      return { ok: false, reason: 'PRICE_NOT_CONVERTIBLE' }
    }

    priceAmount = typeof rawAmount === 'string' ? rawAmount.trim() : undefined
    priceCurrency = currencyTrimmed

    if (code === 'btc') {
      amountSats = Math.round(amount * quantity * SATS_PER_BTC)
      basis = 'exact-btc'
    } else {
      const isStablecoin = STABLECOIN_AS_USD.has(code)
      const rateCode = isStablecoin ? 'usd' : code
      if (!rates || !Object.prototype.hasOwnProperty.call(rates, rateCode)) {
        return { ok: false, reason: 'PRICE_NOT_CONVERTIBLE' }
      }
      const btcPrice = rates[rateCode]?.price
      if (typeof btcPrice !== 'number' || !Number.isFinite(btcPrice) || btcPrice <= 0) {
        return { ok: false, reason: 'PRICE_NOT_CONVERTIBLE' }
      }
      amountSats = Math.round((amount * quantity / btcPrice) * SATS_PER_BTC)
      basis = isStablecoin ? 'stablecoin-as-usd' : 'rate'
      rate = { currency: rateCode, btcPrice }
    }
  }

  if (!Number.isSafeInteger(amountSats) || amountSats < 1) {
    return { ok: false, reason: 'PRICE_NOT_CONVERTIBLE' }
  }
  if (amountSats > maxTxSats) {
    return { ok: false, reason: 'ABOVE_LAUNCH_CAP' }
  }

  const quote: RemoteQuote = { amountSats, basis, quantity }
  if (rate !== undefined) quote.rate = rate
  if (priceCurrency !== undefined) {
    quote.priceCurrency = priceCurrency
    if (priceAmount !== undefined) quote.priceAmount = priceAmount
  }
  return { ok: true, quote }
}

export function quoteExpiry(now: Date): Date {
  return new Date(now.getTime() + QUOTE_TTL_MS)
}
