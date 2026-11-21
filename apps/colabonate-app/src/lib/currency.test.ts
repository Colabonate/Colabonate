import { describe, it, expect } from 'vitest'
import {
  satsToFiat,
  fiatToSats,
  formatSats,
  formatSatsNumber,
  formatFiat,
  formatSatsWithFiat,
} from './currency'

describe('currency: sats↔fiat conversion', () => {
  it('converts sats→fiat using the BTC price', () => {
    // 1 BTC = 50,000 EUR → 50,000 sats = 0.0005 BTC = 25 EUR
    expect(satsToFiat(50_000, 50_000)).toBeCloseTo(25, 10)
  })

  it('returns null when no rate is available (fail-open)', () => {
    expect(satsToFiat(1_000, null)).toBeNull()
    expect(satsToFiat(1_000, 0)).toBeNull()
    expect(satsToFiat(1_000, NaN)).toBeNull()
    expect(satsToFiat(NaN, 50_000)).toBeNull()
  })

  it('rounds fiat→sats to an integer', () => {
    // 1 BTC = 48,123.45 USD
    expect(fiatToSats(10, 48_123.45)).toBe(Math.round((10 / 48_123.45) * 100_000_000))
  })

  it('returns null for fiat→sats without a rate', () => {
    expect(fiatToSats(10, null)).toBeNull()
    expect(fiatToSats(10, 0)).toBeNull()
  })

  it('is stable: fiatToSats(satsToFiat(x)) stays within 1 sat', () => {
    const rate = 63_712.8
    for (const sats of [1, 100, 999, 12_500, 1_000_000, 21_000_000, 123_456_789]) {
      const fiat = satsToFiat(sats, rate)!
      const back = fiatToSats(fiat, rate)!
      expect(Math.abs(back - sats)).toBeLessThanOrEqual(1)
    }
  })

  it('guards zero', () => {
    expect(satsToFiat(0, 50_000)).toBe(0)
    expect(fiatToSats(0, 50_000)).toBe(0)
    expect(formatSatsNumber(0)).toBe('0')
  })

  it('handles negative sats in the number formatter', () => {
    expect(formatSatsNumber(-12_500)).toBe('-12.5k')
  })
})

describe('currency: formatting', () => {
  it('compacts large sats amounts', () => {
    expect(formatSatsNumber(950)).toBe('950')
    expect(formatSatsNumber(12_500)).toBe('12.5k')
    expect(formatSatsNumber(1_250_000)).toBe('1.25M')
  })

  it('appends the sats unit', () => {
    expect(formatSats(12_500)).toBe('12.5k sats')
    expect(formatSats(950)).toBe('950 sats')
  })

  it('formats EUR with 2 fraction digits', () => {
    const out = formatFiat(4.856, 'EUR')
    // Locale-dependent grouping/symbol, but must contain 2 fraction digits.
    expect(out).toMatch(/4\.86|4,86/)
    expect(out).toContain('€')
  })

  it('formats JPY with 0 fraction digits (zero-decimal currency)', () => {
    const out = formatFiat(1234.5, 'JPY')
    // JPY must never render a fractional yen: stripping separators/spaces must
    // leave the rounded integer (1235), not a fractional expansion.
    expect(out.replace(/[^\d]/g, '')).toBe('1235')
    expect(out).toMatch(/¥|JPY/)
  })

  it('formats RUB with the currency identifier', () => {
    // Symbol (₽) renders under full ICU; small-ICU Node falls back to the ISO
    // code (RUB). Either is acceptable — Intl owns the rendering (ADR-235 D1).
    expect(formatFiat(100, 'RUB')).toMatch(/₽|RUB/)
  })
})

describe('currency: sats+fiat combined formatting', () => {
  it('renders sats and the fiat equivalent when a rate exists', () => {
    // 12,500 sats @ 38,800 EUR/BTC = 4.85 EUR
    const out = formatSatsWithFiat(12_500, 38_800, 'EUR')
    expect(out).toContain('12.5k sats')
    expect(out).toContain('≈')
    expect(out).toContain('€')
  })

  it('falls back to sats-only when no rate is available (stale window exceeded)', () => {
    expect(formatSatsWithFiat(12_500, null, 'EUR')).toBe('12.5k sats')
    expect(formatSatsWithFiat(12_500, 0, 'EUR')).toBe('12.5k sats')
  })
})
