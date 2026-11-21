import { describe, expect, it } from 'vitest'
import { DEFAULT_AI_CREDIT_TIERS, findAiCreditTier, getAiCreditTiers } from './ai-credits.js'

describe('getAiCreditTiers (ADR-384 D4)', () => {
  it('returns the defaults when unset or blank', () => {
    expect(getAiCreditTiers(undefined)).toEqual(DEFAULT_AI_CREDIT_TIERS)
    expect(getAiCreditTiers('   ')).toEqual(DEFAULT_AI_CREDIT_TIERS)
  })

  it('accepts a valid override', () => {
    const raw = JSON.stringify([{ id: 'solo', requests: 3, priceSats: 3000 }])
    expect(getAiCreditTiers(raw)).toEqual([{ id: 'solo', requests: 3, priceSats: 3000 }])
  })

  it('falls back to defaults on malformed JSON, bad values or duplicate ids', () => {
    expect(getAiCreditTiers('{nope')).toEqual(DEFAULT_AI_CREDIT_TIERS)
    expect(getAiCreditTiers(JSON.stringify([{ id: 'x', requests: 0, priceSats: 10 }]))).toEqual(DEFAULT_AI_CREDIT_TIERS)
    expect(getAiCreditTiers(JSON.stringify([{ id: 'x', requests: 1, priceSats: 1.5 }]))).toEqual(DEFAULT_AI_CREDIT_TIERS)
    expect(getAiCreditTiers(JSON.stringify([]))).toEqual(DEFAULT_AI_CREDIT_TIERS)
    const dup = [
      { id: 'a', requests: 1, priceSats: 10 },
      { id: 'a', requests: 2, priceSats: 20 },
    ]
    expect(getAiCreditTiers(JSON.stringify(dup))).toEqual(DEFAULT_AI_CREDIT_TIERS)
  })
})

describe('findAiCreditTier', () => {
  it('resolves default tiers and rejects unknown / non-string ids', () => {
    expect(findAiCreditTier('starter')?.priceSats).toBe(2600)
    expect(findAiCreditTier('power')?.requests).toBe(600)
    expect(findAiCreditTier('nope')).toBeUndefined()
    expect(findAiCreditTier(42)).toBeUndefined()
  })
})
