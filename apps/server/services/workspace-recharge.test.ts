import { describe, expect, it } from 'vitest'
import {
  computeMandatoryInitialFundingSats,
  CYCLES_PER_SAT,
  DEFAULT_ESTIMATED_HOURS_FALLBACK,
  MANDATORY_FUNDING_BUFFER_MULTIPLIER,
  MAX_RECHARGE_SATS,
  satsToCycles,
  validateRechargeAmount,
} from './workspace-recharge.js'

describe('satsToCycles', () => {
  it('converts at the documented policy rate (1 sat = 1M cycles)', () => {
    expect(CYCLES_PER_SAT).toBe(1_000_000n)
    expect(satsToCycles(1)).toBe(1_000_000n)
    expect(satsToCycles(5_000)).toBe(5_000_000_000n)
    expect(satsToCycles(100_000)).toBe(100_000_000_000n)
  })

  it('stays exact beyond Number.MAX_SAFE_INTEGER (bigint math)', () => {
    expect(satsToCycles(MAX_RECHARGE_SATS)).toBe(100_000_000n * 1_000_000n)
  })
})

describe('validateRechargeAmount', () => {
  it('accepts positive integers within the cap', () => {
    expect(validateRechargeAmount(1)).toBe(1)
    expect(validateRechargeAmount(5_000)).toBe(5_000)
    expect(validateRechargeAmount(MAX_RECHARGE_SATS)).toBe(MAX_RECHARGE_SATS)
  })

  it('rejects zero, negatives and amounts above the cap', () => {
    expect(validateRechargeAmount(0)).toBeNull()
    expect(validateRechargeAmount(-1)).toBeNull()
    expect(validateRechargeAmount(MAX_RECHARGE_SATS + 1)).toBeNull()
  })

  it('rejects non-integers and non-numbers', () => {
    expect(validateRechargeAmount(1.5)).toBeNull()
    expect(validateRechargeAmount('5000')).toBeNull()
    expect(validateRechargeAmount(undefined)).toBeNull()
    expect(validateRechargeAmount(null)).toBeNull()
    expect(validateRechargeAmount(NaN)).toBeNull()
  })
})

describe('computeMandatoryInitialFundingSats', () => {
  it('charges the declared hours plus the 30% buffer, no subsidy', () => {
    expect(MANDATORY_FUNDING_BUFFER_MULTIPLIER).toBe(1.3)
    // 1 hour = 15 outcalls * 1000 sats = 15,000 sats; +30% = 19,500
    expect(computeMandatoryInitialFundingSats(1)).toBe(19_500)
    // 10 hours = 150,000 sats; +30% = 195,000
    expect(computeMandatoryInitialFundingSats(10)).toBe(195_000)
  })

  it('scales linearly with fractional hours', () => {
    expect(computeMandatoryInitialFundingSats(0.5)).toBe(9_750)
  })

  it('falls back to the 1-hour safety net for offers with no declared duration', () => {
    expect(computeMandatoryInitialFundingSats(0)).toBe(computeMandatoryInitialFundingSats(DEFAULT_ESTIMATED_HOURS_FALLBACK))
    expect(computeMandatoryInitialFundingSats(-5)).toBe(computeMandatoryInitialFundingSats(DEFAULT_ESTIMATED_HOURS_FALLBACK))
  })
})
