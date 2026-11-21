import { describe, it, expect } from 'vitest'
import { estimateSatsFromForeignPrice, formatEstimateLabel } from './remote-price'

const rates = {
  eur: { price: 80000 },
  usd: { price: 100000 },
}

describe('estimateSatsFromForeignPrice', () => {
  it('converts BTC exactly', () => {
    expect(estimateSatsFromForeignPrice('0.0025', 'BTC', rates)).toEqual({ sats: 250000, basis: 'exact-btc' })
  })

  it('returns 1 sat for the smallest BTC amount', () => {
    expect(estimateSatsFromForeignPrice('0.00000001', 'btc', rates)).toEqual({ sats: 1, basis: 'exact-btc' })
  })

  it('returns null for zero BTC', () => {
    expect(estimateSatsFromForeignPrice('0', 'BTC', rates)).toBeNull()
  })

  it('converts EUR using the rate', () => {
    expect(estimateSatsFromForeignPrice('2', 'EUR', rates)).toEqual({ sats: 2500, basis: 'rate' })
  })

  it('converts USD using the rate', () => {
    expect(estimateSatsFromForeignPrice('49.99', 'USD', rates)).toEqual({ sats: 49990, basis: 'rate' })
  })

  it('treats USDC as USD with stablecoin basis', () => {
    expect(estimateSatsFromForeignPrice('49.99', 'USDC', rates)).toEqual({
      sats: 49990,
      basis: 'stablecoin-as-usd',
    })
  })

  it('treats USDT as USD with stablecoin basis', () => {
    expect(estimateSatsFromForeignPrice('10', 'usdt', rates)).toEqual({
      sats: 10000,
      basis: 'stablecoin-as-usd',
    })
  })

  it('returns null for USDT without a usd rate', () => {
    expect(estimateSatsFromForeignPrice('10', 'USDT', { eur: { price: 80000 } })).toBeNull()
  })

  it('returns null for a currency without a rate', () => {
    expect(estimateSatsFromForeignPrice('10', 'GBP', rates)).toBeNull()
  })

  it('returns null for Lightning-incompatible currencies', () => {
    expect(estimateSatsFromForeignPrice('5', 'XMR', { xmr: { price: 1 }, ...rates })).toBeNull()
    expect(estimateSatsFromForeignPrice('5', 'eth', { eth: { price: 1 }, ...rates })).toBeNull()
    expect(estimateSatsFromForeignPrice('5', 'testsat', { testsat: { price: 1 }, ...rates })).toBeNull()
  })

  it('returns null for sat units', () => {
    expect(estimateSatsFromForeignPrice('1000', 'sats', rates)).toBeNull()
    expect(estimateSatsFromForeignPrice('1000', 'sat', rates)).toBeNull()
    expect(estimateSatsFromForeignPrice('1000', 'msat', rates)).toBeNull()
  })

  it('returns null for unparseable, empty, negative or zero amounts', () => {
    expect(estimateSatsFromForeignPrice('abc', 'EUR', rates)).toBeNull()
    expect(estimateSatsFromForeignPrice('', 'EUR', rates)).toBeNull()
    expect(estimateSatsFromForeignPrice('-3', 'EUR', rates)).toBeNull()
    expect(estimateSatsFromForeignPrice('0', 'EUR', rates)).toBeNull()
    expect(estimateSatsFromForeignPrice(null, 'EUR', rates)).toBeNull()
    expect(estimateSatsFromForeignPrice(undefined, 'EUR', rates)).toBeNull()
  })

  it('returns null for a missing or blank currency', () => {
    expect(estimateSatsFromForeignPrice('2', null, rates)).toBeNull()
    expect(estimateSatsFromForeignPrice('2', undefined, rates)).toBeNull()
    expect(estimateSatsFromForeignPrice('2', '', rates)).toBeNull()
    expect(estimateSatsFromForeignPrice('2', '   ', rates)).toBeNull()
  })

  it('trims and lowercases the currency code', () => {
    expect(estimateSatsFromForeignPrice('2', '  eur ', rates)).toEqual({ sats: 2500, basis: 'rate' })
    expect(estimateSatsFromForeignPrice('2', ' Eur', rates)).toEqual({ sats: 2500, basis: 'rate' })
  })

  it('returns null when the rate price is zero, negative or NaN', () => {
    expect(estimateSatsFromForeignPrice('2', 'EUR', { eur: { price: 0 } })).toBeNull()
    expect(estimateSatsFromForeignPrice('2', 'EUR', { eur: { price: -1 } })).toBeNull()
    expect(estimateSatsFromForeignPrice('2', 'EUR', { eur: { price: Number.NaN } })).toBeNull()
  })

  it('returns null when the converted amount rounds to zero sats', () => {
    expect(estimateSatsFromForeignPrice('0.000001', 'EUR', { eur: { price: 1e12 } })).toBeNull()
  })

  it('does not match inherited object keys as rates', () => {
    expect(estimateSatsFromForeignPrice('2', 'constructor', rates)).toBeNull()
    expect(estimateSatsFromForeignPrice('2', 'toString', rates)).toBeNull()
  })

  it('never throws on odd input', () => {
    expect(() => estimateSatsFromForeignPrice('1', 'eur', null as unknown as typeof rates)).not.toThrow()
    expect(estimateSatsFromForeignPrice('1', 'eur', null as unknown as typeof rates)).toBeNull()
  })
})

describe('formatEstimateLabel', () => {
  const fmt = (n: number) => String(n)

  it('formats a rate estimate', () => {
    expect(formatEstimateLabel({ sats: 2500, basis: 'rate' }, fmt)).toBe('≈ 2500 sats')
  })

  it('formats an exact BTC estimate', () => {
    expect(formatEstimateLabel({ sats: 250000, basis: 'exact-btc' }, fmt)).toBe('≈ 250000 sats')
  })

  it('appends the stablecoin note for stablecoin estimates', () => {
    expect(formatEstimateLabel({ sats: 49990, basis: 'stablecoin-as-usd' }, fmt)).toBe(
      '≈ 49990 sats (stablecoin treated as USD)',
    )
  })

  it('uses the provided number formatter', () => {
    expect(formatEstimateLabel({ sats: 1234, basis: 'rate' }, (n) => `${n}!`)).toBe('≈ 1234! sats')
  })
})
