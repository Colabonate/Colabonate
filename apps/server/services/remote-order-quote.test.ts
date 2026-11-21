// Remote order quote tests: ADR-417 D4.

import { describe, expect, it } from 'vitest'

import {
  MAX_REMOTE_QUANTITY,
  QUOTE_TTL_MS,
  computeRemoteQuote,
  quoteExpiry,
} from './remote-order-quote.js'

const RATES = {
  eur: { price: 80000 },
  usd: { price: 100000 },
}
const CAP = 210000

function sats(priceSats: number) {
  return { priceSats, priceAmount: null, priceCurrency: null }
}

describe('computeRemoteQuote', () => {
  it('prices a sats listing times quantity', () => {
    const r = computeRemoteQuote({ offer: sats(2100), quantity: 3, rates: RATES, maxTxSats: CAP })
    expect(r).toEqual({ ok: true, quote: { amountSats: 6300, basis: 'sats', quantity: 3 } })
  })

  it('prices an exact BTC listing', () => {
    const r = computeRemoteQuote({
      offer: { priceSats: 0, priceAmount: '0.0025', priceCurrency: 'BTC' },
      quantity: 1,
      rates: RATES,
      maxTxSats: 1_000_000,
    })
    expect(r).toEqual({
      ok: true,
      quote: { amountSats: 250000, basis: 'exact-btc', quantity: 1, priceAmount: '0.0025', priceCurrency: 'BTC' },
    })
  })

  it('converts a fiat price through the rate and sets rate', () => {
    const r = computeRemoteQuote({
      offer: { priceSats: 0, priceAmount: '2', priceCurrency: 'EUR' },
      quantity: 1,
      rates: RATES,
      maxTxSats: CAP,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.quote.amountSats).toBe(2500)
    expect(r.quote.basis).toBe('rate')
    expect(r.quote.rate).toEqual({ currency: 'eur', btcPrice: 80000 })
    expect(r.quote.priceCurrency).toBe('EUR')
  })

  it('applies quantity before the rate conversion', () => {
    const r = computeRemoteQuote({
      offer: { priceSats: 0, priceAmount: '2', priceCurrency: 'eur' },
      quantity: 3,
      rates: RATES,
      maxTxSats: CAP,
    })
    expect(r.ok && r.quote.amountSats).toBe(7500)
  })

  it('treats USDC as USD with stablecoin-as-usd basis', () => {
    const r = computeRemoteQuote({
      offer: { priceSats: 0, priceAmount: '10', priceCurrency: 'USDC' },
      quantity: 1,
      rates: RATES,
      maxTxSats: CAP,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.quote.basis).toBe('stablecoin-as-usd')
    expect(r.quote.rate).toEqual({ currency: 'usd', btcPrice: 100000 })
    expect(r.quote.amountSats).toBe(10000)
  })

  it('rejects USDT when no usd rate exists', () => {
    const r = computeRemoteQuote({
      offer: { priceSats: 0, priceAmount: '10', priceCurrency: 'USDT' },
      quantity: 1,
      rates: { eur: { price: 80000 } },
      maxTxSats: CAP,
    })
    expect(r).toEqual({ ok: false, reason: 'PRICE_NOT_CONVERTIBLE' })
  })

  it('rejects a non-Lightning currency (XMR)', () => {
    const r = computeRemoteQuote({
      offer: { priceSats: 0, priceAmount: '1', priceCurrency: 'XMR' },
      quantity: 1,
      rates: { xmr: { price: 150 } },
      maxTxSats: CAP,
    })
    expect(r).toEqual({ ok: false, reason: 'PRICE_NOT_CONVERTIBLE' })
  })

  it('rejects a fiat currency without a rate (GBP)', () => {
    const r = computeRemoteQuote({
      offer: { priceSats: 0, priceAmount: '5', priceCurrency: 'GBP' },
      quantity: 1,
      rates: RATES,
      maxTxSats: CAP,
    })
    expect(r).toEqual({ ok: false, reason: 'PRICE_NOT_CONVERTIBLE' })
  })

  it('rejects an unpublished listing (no sats price, no currency)', () => {
    const r = computeRemoteQuote({ offer: sats(0), quantity: 1, rates: RATES, maxTxSats: CAP })
    expect(r).toEqual({ ok: false, reason: 'PRICE_NOT_CONVERTIBLE' })
  })

  it.each(['abc', '0', '-1', ''])('rejects the invalid amount %j', (amount) => {
    const r = computeRemoteQuote({
      offer: { priceSats: 0, priceAmount: amount, priceCurrency: 'EUR' },
      quantity: 1,
      rates: RATES,
      maxTxSats: CAP,
    })
    expect(r).toEqual({ ok: false, reason: 'PRICE_NOT_CONVERTIBLE' })
  })

  it.each([0, NaN])('rejects a rate price of %p', (price) => {
    const r = computeRemoteQuote({
      offer: { priceSats: 0, priceAmount: '2', priceCurrency: 'EUR' },
      quantity: 1,
      rates: { eur: { price } },
      maxTxSats: CAP,
    })
    expect(r).toEqual({ ok: false, reason: 'PRICE_NOT_CONVERTIBLE' })
  })

  it('rejects a total above the launch cap', () => {
    const r = computeRemoteQuote({ offer: sats(2500), quantity: 1, rates: RATES, maxTxSats: 1000 })
    expect(r).toEqual({ ok: false, reason: 'ABOVE_LAUNCH_CAP' })
  })

  it.each([0, 1.5, MAX_REMOTE_QUANTITY + 1, 'x' as unknown as number])('rejects quantity %p', (quantity) => {
    const r = computeRemoteQuote({ offer: sats(2100), quantity, rates: RATES, maxTxSats: CAP })
    expect(r).toEqual({ ok: false, reason: 'INVALID_QUANTITY' })
  })

  it('accepts the maximum quantity', () => {
    const r = computeRemoteQuote({ offer: sats(10), quantity: MAX_REMOTE_QUANTITY, rates: RATES, maxTxSats: CAP })
    expect(r.ok && r.quote.amountSats).toBe(1000)
  })

  it('rejects an amount that rounds to zero sats', () => {
    const r = computeRemoteQuote({
      offer: { priceSats: 0, priceAmount: '0.000000001', priceCurrency: 'BTC' },
      quantity: 1,
      rates: RATES,
      maxTxSats: CAP,
    })
    expect(r).toEqual({ ok: false, reason: 'PRICE_NOT_CONVERTIBLE' })
  })

  it('does not treat inherited Object keys as rates', () => {
    const r = computeRemoteQuote({
      offer: { priceSats: 0, priceAmount: '2', priceCurrency: 'constructor' },
      quantity: 1,
      rates: RATES,
      maxTxSats: CAP,
    })
    expect(r).toEqual({ ok: false, reason: 'PRICE_NOT_CONVERTIBLE' })
  })

  it('rejects sat-unit currencies as foreign prices', () => {
    const r = computeRemoteQuote({
      offer: { priceSats: 0, priceAmount: '2100', priceCurrency: 'sats' },
      quantity: 1,
      rates: RATES,
      maxTxSats: CAP,
    })
    expect(r).toEqual({ ok: false, reason: 'PRICE_NOT_CONVERTIBLE' })
  })

  it('omits priceAmount and priceCurrency on sats quotes', () => {
    const r = computeRemoteQuote({ offer: sats(2100), quantity: 1, rates: RATES, maxTxSats: CAP })
    expect(r.ok && 'priceCurrency' in r.quote).toBe(false)
    expect(r.ok && 'priceAmount' in r.quote).toBe(false)
  })
})

describe('quoteExpiry', () => {
  it('is exactly the quote TTL after now', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    expect(quoteExpiry(now).getTime() - now.getTime()).toBe(QUOTE_TTL_MS)
    expect(quoteExpiry(now).toISOString()).toBe('2026-01-01T00:10:00.000Z')
  })
})
