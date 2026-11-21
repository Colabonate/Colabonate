// Edge-case tests for computeRemoteQuote (ADR-417 D4). Complements remote-order-quote.test.ts.

import { describe, expect, it } from 'vitest'

import { MAX_REMOTE_QUANTITY, computeRemoteQuote } from './remote-order-quote.js'

const RATES = {
  eur: { price: 80000 },
  usd: { price: 100000 },
}
const CAP = 210000
const MAX_SAFE = Number.MAX_SAFE_INTEGER
const REJECT = { ok: false, reason: 'PRICE_NOT_CONVERTIBLE' }

function fiat(priceAmount: unknown, priceCurrency: unknown = 'EUR', rates: Record<string, { price: number }> = RATES, quantity = 1, maxTxSats = CAP) {
  return computeRemoteQuote({
    offer: { priceSats: 0, priceAmount: priceAmount as string, priceCurrency: priceCurrency as string },
    quantity,
    rates,
    maxTxSats,
  })
}

describe('computeRemoteQuote edge cases', () => {
  describe('sub-sat rounding', () => {
    it('rounds a price worth 0.4 sat down to zero and rejects it (not orderable)', () => {
      // 0.00032 EUR / 80000 EUR-per-BTC * 1e8 = 0.4 sat
      expect(fiat('0.00032')).toEqual(REJECT)
    })

    it('rounds a price worth 0.6 sat up to 1 sat', () => {
      const r = fiat('0.00048')
      expect(r.ok && r.quote.amountSats).toBe(1)
    })

    it('rejects a sub-sat total reached through quantity (0.000001 EUR x 100 = 0.125 sat -> 0)', () => {
      expect(fiat('0.000001', 'EUR', RATES, MAX_REMOTE_QUANTITY)).toEqual(REJECT)
    })

    it('rounds a sub-sat per-unit price up when the total reaches 1 sat (0.00001 EUR x 100 = 1.25 sat -> 1)', () => {
      const r = fiat('0.00001', 'EUR', RATES, MAX_REMOTE_QUANTITY)
      expect(r.ok && r.quote.amountSats).toBe(1)
    })
  })

  describe('magnitude and overflow', () => {
    it('prices a very large fiat amount when the launch cap is raised to MAX_SAFE_INTEGER', () => {
      const r = fiat('1000000', 'EUR', RATES, 1, MAX_SAFE)
      expect(r.ok && r.quote.amountSats).toBe(1_250_000_000)
    })

    it('reports ABOVE_LAUNCH_CAP for a very large fiat amount under the normal cap', () => {
      expect(fiat('1000000')).toEqual({ ok: false, reason: 'ABOVE_LAUNCH_CAP' })
    })

    it('rejects a sats total that exceeds MAX_SAFE_INTEGER through quantity', () => {
      // 2^50 * 10 > 2^53: not a safe integer
      const r = computeRemoteQuote({
        offer: { priceSats: 2 ** 50, priceAmount: null, priceCurrency: null },
        quantity: 10,
        rates: RATES,
        maxTxSats: MAX_SAFE,
      })
      expect(r).toEqual(REJECT)
    })

    it('accepts a sats total exactly at MAX_SAFE_INTEGER (floor(MAX/3) * 3)', () => {
      const priceSats = Math.floor(MAX_SAFE / 3)
      const r = computeRemoteQuote({
        offer: { priceSats, priceAmount: null, priceCurrency: null },
        quantity: 3,
        rates: RATES,
        maxTxSats: MAX_SAFE,
      })
      expect(r.ok && r.quote.amountSats).toBe(priceSats * 3)
    })

    it('rejects one step past MAX_SAFE_INTEGER (floor(MAX/3)+1 * 3 = 2^53)', () => {
      const r = computeRemoteQuote({
        offer: { priceSats: Math.floor(MAX_SAFE / 3) + 1, priceAmount: null, priceCurrency: null },
        quantity: 3,
        rates: RATES,
        maxTxSats: MAX_SAFE,
      })
      expect(r).toEqual(REJECT)
    })

    it('rejects a sats price of 1e300 without throwing', () => {
      const r = computeRemoteQuote({
        offer: { priceSats: 1e300, priceAmount: null, priceCurrency: null },
        quantity: 1,
        rates: RATES,
        maxTxSats: MAX_SAFE,
      })
      expect(r).toEqual(REJECT)
    })

    it('rejects a fractional sats price (1.5 sat x 1)', () => {
      const r = computeRemoteQuote({
        offer: { priceSats: 1.5, priceAmount: null, priceCurrency: null },
        quantity: 1,
        rates: RATES,
        maxTxSats: CAP,
      })
      expect(r).toEqual(REJECT)
    })

    it('rejects a fiat total that overflows to a non-safe integer', () => {
      const r = fiat('9007199254740991', 'EUR', RATES, 1, MAX_SAFE)
      expect(r).toEqual(REJECT)
    })
  })

  describe('malformed priceAmount', () => {
    it.each(['', ' ', '1,5', '-3', '0', 'abc', '1.2.3', '9'.repeat(400), 'Infinity', '-Infinity'])(
      'rejects priceAmount %j',
      (amount) => {
        expect(fiat(amount)).toEqual(REJECT)
      },
    )

    it('rejects a non-string priceAmount (number)', () => {
      expect(fiat(2)).toEqual(REJECT)
    })

    it('trims surrounding whitespace and stores the trimmed amount', () => {
      const r = fiat(' 2 ')
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.quote.amountSats).toBe(2500)
      expect(r.quote.priceAmount).toBe('2')
    })

    it('rejects scientific notation "1e3": prices are plain decimal strings', () => {
      expect(fiat('1e3', 'EUR', RATES, 1, MAX_SAFE)).toEqual(REJECT)
    })

    // Regression: Number('0x10') === 16, so a hex literal is accepted as a decimal price.
    // A listing price is documented as a decimal string; hex/octal/binary literals should be
    // rejected. Display (apps/colabonate-app/src/lib/remote-price.ts) uses the same Number()
    // parse, so the UI would show the same wrong value. Asserts the correct behaviour (reject).
    it('rejects a hexadecimal priceAmount "0x10" instead of reading it as 16', () => {
      expect(fiat('0x10')).toEqual(REJECT)
    })
  })

  describe('currency handling', () => {
    it.each(['eur', 'EUR', 'Eur', ' EUR '])('accepts currency %j as EUR', (currency) => {
      const r = fiat('2', currency)
      expect(r.ok && r.quote.amountSats).toBe(2500)
      expect(r.ok && r.quote.basis).toBe('rate')
    })

    it('keeps the original trimmed currency casing on the quote', () => {
      const r = fiat('2', ' Eur ')
      expect(r.ok && r.quote.priceCurrency).toBe('Eur')
    })

    it('rejects an unknown currency with no rate', () => {
      expect(fiat('2', 'ZZZ')).toEqual(REJECT)
    })

    it('rejects a rate keyed in uppercase when the currency code is lowercased', () => {
      expect(fiat('2', 'EUR', { EUR: { price: 80000 } })).toEqual(REJECT)
    })

    it.each(['XMR', 'xmr', 'Eth', 'SOL', 'LTC', 'DOGE', 'testsat'])('rejects non-Lightning currency %j', (c) => {
      expect(fiat('1', c, { ...RATES, [c.toLowerCase()]: { price: 1 } })).toEqual(REJECT)
    })

    it.each(['usdc', 'USDT', 'UsDc'])('treats stablecoin %j as USD', (c) => {
      const r = fiat('10', c)
      expect(r.ok && r.quote.basis).toBe('stablecoin-as-usd')
      expect(r.ok && r.quote.amountSats).toBe(10000)
    })

    it('rejects a non-string priceCurrency (number)', () => {
      expect(fiat('2', 5)).toEqual(REJECT)
    })

    it('treats a whitespace-only currency as a sats listing and ignores priceAmount', () => {
      const r = computeRemoteQuote({
        offer: { priceSats: 2100, priceAmount: '5', priceCurrency: '   ' },
        quantity: 1,
        rates: RATES,
        maxTxSats: CAP,
      })
      expect(r).toEqual({ ok: true, quote: { amountSats: 2100, basis: 'sats', quantity: 1 } })
    })

    it('uses the sats path for an empty currency even when priceAmount is set', () => {
      const r = computeRemoteQuote({
        offer: { priceSats: 2100, priceAmount: '5', priceCurrency: '' },
        quantity: 1,
        rates: RATES,
        maxTxSats: CAP,
      })
      expect(r.ok && r.quote.basis).toBe('sats')
    })

    it('treats BTC case-insensitively as exact-btc', () => {
      const r = computeRemoteQuote({
        offer: { priceSats: 0, priceAmount: '0.001', priceCurrency: 'btc' },
        quantity: 1,
        rates: {},
        maxTxSats: MAX_SAFE,
      })
      expect(r.ok && r.quote.amountSats).toBe(100000)
    })
  })

  describe('BTC precision', () => {
    it('converts exactly 8 decimals (1 sat)', () => {
      const r = computeRemoteQuote({
        offer: { priceSats: 0, priceAmount: '0.00000001', priceCurrency: 'BTC' },
        quantity: 1,
        rates: RATES,
        maxTxSats: CAP,
      })
      expect(r.ok && r.quote.amountSats).toBe(1)
    })

    it('rounds a 9th decimal half-up on the total (0.123456785 BTC -> 12345679 sats)', () => {
      const r = computeRemoteQuote({
        offer: { priceSats: 0, priceAmount: '0.123456785', priceCurrency: 'BTC' },
        quantity: 1,
        rates: RATES,
        maxTxSats: MAX_SAFE,
      })
      expect(r.ok && r.quote.amountSats).toBe(12345679)
    })

    it('rounds a 9th decimal down on the total (0.123456784 BTC -> 12345678 sats)', () => {
      const r = computeRemoteQuote({
        offer: { priceSats: 0, priceAmount: '0.123456784', priceCurrency: 'BTC' },
        quantity: 1,
        rates: RATES,
        maxTxSats: MAX_SAFE,
      })
      expect(r.ok && r.quote.amountSats).toBe(12345678)
    })

    it('multiplies exact BTC by quantity without drifting (0.1 BTC x 3 = 30,000,000 sats)', () => {
      const r = computeRemoteQuote({
        offer: { priceSats: 0, priceAmount: '0.1', priceCurrency: 'BTC' },
        quantity: 3,
        rates: RATES,
        maxTxSats: MAX_SAFE,
      })
      expect(r.ok && r.quote.amountSats).toBe(30_000_000)
    })
  })

  describe('rate values', () => {
    it.each([-1, Infinity, -Infinity, '80000' as unknown as number, null as unknown as number])(
      'rejects a rate of %p',
      (price) => {
        expect(fiat('2', 'EUR', { eur: { price } })).toEqual(REJECT)
      },
    )

    it('rejects a rate entry that is null', () => {
      expect(fiat('2', 'EUR', { eur: null as unknown as { price: number } })).toEqual(REJECT)
    })

    it('rejects a missing rates map', () => {
      expect(fiat('2', 'EUR', null as unknown as Record<string, { price: number }>)).toEqual(REJECT)
    })

    it('rejects a rate so tiny the converted total overflows safe integers', () => {
      expect(fiat('1000000', 'EUR', { eur: { price: 1e-12 } }, 1, MAX_SAFE)).toEqual(REJECT)
    })
  })

  describe('sats-priced listings', () => {
    it.each([0, -1, -2100, NaN, Infinity])('rejects priceSats %p', (priceSats) => {
      const r = computeRemoteQuote({
        offer: { priceSats, priceAmount: null, priceCurrency: null },
        quantity: 1,
        rates: RATES,
        maxTxSats: CAP,
      })
      expect(r).toEqual(REJECT)
    })
  })

  describe('launch cap boundary', () => {
    it('allows a total exactly equal to the cap', () => {
      const r = computeRemoteQuote({
        offer: { priceSats: 2100, priceAmount: null, priceCurrency: null },
        quantity: 100,
        rates: RATES,
        maxTxSats: 210000,
      })
      expect(r.ok && r.quote.amountSats).toBe(210000)
    })

    it('rejects a total one sat above the cap', () => {
      const r = computeRemoteQuote({
        offer: { priceSats: 2101, priceAmount: null, priceCurrency: null },
        quantity: 100,
        rates: RATES,
        maxTxSats: 210000,
      })
      expect(r).toEqual({ ok: false, reason: 'ABOVE_LAUNCH_CAP' })
    })

    it('accepts any positive total under maxTxSats = MAX_SAFE_INTEGER', () => {
      const r = computeRemoteQuote({
        offer: { priceSats: 2100, priceAmount: null, priceCurrency: null },
        quantity: 1,
        rates: RATES,
        maxTxSats: MAX_SAFE,
      })
      expect(r.ok).toBe(true)
    })

    it('reports ABOVE_LAUNCH_CAP for any positive total when maxTxSats is 0', () => {
      const r = computeRemoteQuote({
        offer: { priceSats: 1, priceAmount: null, priceCurrency: null },
        quantity: 1,
        rates: RATES,
        maxTxSats: 0,
      })
      expect(r).toEqual({ ok: false, reason: 'ABOVE_LAUNCH_CAP' })
    })
  })

  describe('quantity extremes', () => {
    it.each([-1, Number.MAX_SAFE_INTEGER + 2, NaN, Infinity])('rejects quantity %p', (quantity) => {
      const r = computeRemoteQuote({
        offer: { priceSats: 2100, priceAmount: null, priceCurrency: null },
        quantity,
        rates: RATES,
        maxTxSats: MAX_SAFE,
      })
      expect(r).toEqual({ ok: false, reason: 'INVALID_QUANTITY' })
    })
  })
})
