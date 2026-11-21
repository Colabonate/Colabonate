import { describe, it, expect } from 'vitest'
import {
  resolveWalletMode,
  explainStrategy,
  isWalletModeStrategy,
  ALL_STRATEGY_EXPLANATIONS,
  getStrategyExplanations,
  getEffectiveStrategy,
} from './walletStrategy'

describe('walletStrategy.resolveWalletMode', () => {
  it('HYBRID: PRIVATE→CUSTODIAL, PUBLIC→NON_CUSTODIAL', () => {
    expect(resolveWalletMode('HYBRID', 'PRIVATE')).toBe('CUSTODIAL')
    expect(resolveWalletMode('HYBRID', 'PUBLIC')).toBe('NON_CUSTODIAL')
  })

  it('HYBRID defaults to NON_CUSTODIAL when no trade context', () => {
    expect(resolveWalletMode('HYBRID')).toBe('NON_CUSTODIAL')
  })

  it('CUSTODIAL_ONLY always returns CUSTODIAL regardless of visibility', () => {
    expect(resolveWalletMode('CUSTODIAL_ONLY', 'PRIVATE')).toBe('CUSTODIAL')
    expect(resolveWalletMode('CUSTODIAL_ONLY', 'PUBLIC')).toBe('CUSTODIAL')
    expect(resolveWalletMode('CUSTODIAL_ONLY')).toBe('CUSTODIAL')
  })

  it('NONCUSTODIAL_ONLY always returns NON_CUSTODIAL regardless of visibility', () => {
    expect(resolveWalletMode('NONCUSTODIAL_ONLY', 'PRIVATE')).toBe('NON_CUSTODIAL')
    expect(resolveWalletMode('NONCUSTODIAL_ONLY', 'PUBLIC')).toBe('NON_CUSTODIAL')
    expect(resolveWalletMode('NONCUSTODIAL_ONLY')).toBe('NON_CUSTODIAL')
  })
})

describe('walletStrategy.explainStrategy', () => {
  it('returns a label + summary + mapping for every strategy', () => {
    for (const e of ALL_STRATEGY_EXPLANATIONS) {
      expect(e.label.length).toBeGreaterThan(0)
      expect(e.summary.length).toBeGreaterThan(0)
      expect(['CUSTODIAL', 'NON_CUSTODIAL']).toContain(e.publicMode)
      expect(['CUSTODIAL', 'NON_CUSTODIAL']).toContain(e.privateMode)
    }
  })

  it('HYBRID has no caveat; the restrictive strategies do', () => {
    expect(explainStrategy('HYBRID').caveat).toBeNull()
    expect(explainStrategy('CUSTODIAL_ONLY').caveat).not.toBeNull()
    expect(explainStrategy('NONCUSTODIAL_ONLY').caveat).not.toBeNull()
  })

  it('NONCUSTODIAL_ONLY warns about losing sub-wallet isolation in private mode', () => {
    const e = explainStrategy('NONCUSTODIAL_ONLY')
    expect(e.privateMode).toBe('NON_CUSTODIAL')
    expect(e.caveat?.toLowerCase()).toContain('isolat')
  })
})

describe('walletStrategy.isWalletModeStrategy', () => {
  it('accepts the three valid strategies', () => {
    expect(isWalletModeStrategy('HYBRID')).toBe(true)
    expect(isWalletModeStrategy('CUSTODIAL_ONLY')).toBe(true)
    expect(isWalletModeStrategy('NONCUSTODIAL_ONLY')).toBe(true)
  })

  it('rejects garbage + case variants', () => {
    expect(isWalletModeStrategy('hybrid')).toBe(false)
    expect(isWalletModeStrategy('PUBLIC')).toBe(false)
    expect(isWalletModeStrategy(null)).toBe(false)
    expect(isWalletModeStrategy(undefined)).toBe(false)
    expect(isWalletModeStrategy(42)).toBe(false)
  })
})

describe('walletStrategy Direct-Pay-only host (ADR-253)', () => {
  it('offers all three strategies when the custodial rail exists', () => {
    expect(getStrategyExplanations(false)).toEqual(ALL_STRATEGY_EXPLANATIONS)
  })

  it('offers only the non-custodial option on a Direct-Pay-only host', () => {
    const list = getStrategyExplanations(true)
    expect(list).toHaveLength(1)
    expect(list[0].strategy).toBe('NONCUSTODIAL_ONLY')
    expect(list[0].publicMode).toBe('NON_CUSTODIAL')
    expect(list[0].privateMode).toBe('NON_CUSTODIAL')
    expect(list[0].caveat).toBeNull()
    expect(list[0].summary.toLowerCase()).toContain('never holds')
  })

  it('keeps the stored strategy when the custodial rail exists', () => {
    expect(getEffectiveStrategy('HYBRID', false)).toBe('HYBRID')
    expect(getEffectiveStrategy('CUSTODIAL_ONLY', false)).toBe('CUSTODIAL_ONLY')
  })

  it('normalises to NONCUSTODIAL_ONLY on a Direct-Pay-only host', () => {
    expect(getEffectiveStrategy('HYBRID', true)).toBe('NONCUSTODIAL_ONLY')
    expect(getEffectiveStrategy('CUSTODIAL_ONLY', true)).toBe('NONCUSTODIAL_ONLY')
    expect(getEffectiveStrategy('NONCUSTODIAL_ONLY', true)).toBe('NONCUSTODIAL_ONLY')
  })
})
