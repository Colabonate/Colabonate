// ADR-413 D3: the wallet-affordability pre-check. The platform may only
// claim a balance for the rails it syncs itself — a WebLN extension keeps its
// balance private, so "unknown" is the honest answer there (a fake zero would
// block buyers who do have funds).
import { describe, expect, it } from 'vitest'
import {
  BALANCE_FRESH_WINDOW_MS,
  checkAffordability,
  isInsufficientFundsError,
  shortfallMessage,
} from './payment-affordability'

const NOW = Date.parse('2026-10-30T20:00:00.000Z')

function wallet(over: Record<string, unknown> = {}) {
  return {
    provider: 'ALBY_OAUTH',
    balanceSats: 2354,
    balance: { confirmedSats: 2354, unconfirmedSats: 0, pendingSats: 0 },
    lastSyncedAt: new Date(NOW - 10_000).toISOString(),
    ...over,
  }
}

describe('checkAffordability', () => {
  it('reports a known, fresh, sufficient balance for a server-synced rail', () => {
    const check = checkAffordability(wallet(), 2600, NOW)
    expect(check).toMatchObject({ known: true, fresh: true, balanceSats: 2354, requiredSats: 2600, sufficient: false, shortfallSats: 246 })
  })

  it('never claims a balance for a WebLN wallet (the extension keeps it private)', () => {
    const check = checkAffordability(wallet({ provider: 'WEBLN', balanceSats: 0, balance: { confirmedSats: 0 } }), 2600, NOW)
    expect(check.known).toBe(false)
    expect(check.sufficient).toBe(true)
    expect(check.shortfallSats).toBe(0)
  })

  it('treats a missing wallet as unknown instead of "0 sats"', () => {
    expect(checkAffordability(null, 2600, NOW)).toMatchObject({ known: false, sufficient: true })
  })

  it('marks a stale balance as not fresh — it warns, it does not block', () => {
    const check = checkAffordability(wallet({ lastSyncedAt: new Date(NOW - BALANCE_FRESH_WINDOW_MS - 1000).toISOString() }), 2600, NOW)
    expect(check.known).toBe(true)
    expect(check.fresh).toBe(false)
    expect(check.sufficient).toBe(false)
  })

  it('treats a never-synced balance as not fresh', () => {
    const check = checkAffordability(wallet({ lastSyncedAt: null }), 2600, NOW)
    expect(check.known).toBe(true)
    expect(check.fresh).toBe(false)
  })

  it('is sufficient when the balance covers the amount', () => {
    const check = checkAffordability(wallet({ balanceSats: 5000, balance: { confirmedSats: 5000 } }), 2600, NOW)
    expect(check.sufficient).toBe(true)
    expect(check.shortfallSats).toBe(0)
  })
})

describe('isInsufficientFundsError', () => {
  it('recognises the provider wordings for "not enough funds"', () => {
    expect(isInsufficientFundsError('Payment failed: insufficient balance')).toBe(true)
    expect(isInsufficientFundsError('not enough funds')).toBe(true)
    expect(isInsufficientFundsError('Could not pay')).toBe(true)
    expect(isInsufficientFundsError('Payment rejected by wallet.')).toBe(false)
    expect(isInsufficientFundsError(undefined)).toBe(false)
  })
})

describe('shortfallMessage', () => {
  it('names both amounts and the fix', () => {
    const check = checkAffordability(wallet(), 2600, NOW)
    const message = shortfallMessage(check, 'The service fee')
    expect(message).toContain('2,354 sats')
    expect(message).toContain('2,600 sats')
    expect(message).toContain('Settings → Wallet')
    expect(message).toContain('The service fee')
  })
})
