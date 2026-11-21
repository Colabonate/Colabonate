import { describe, it, expect } from 'vitest'
import { checkProductionEscrowGuard } from './production-escrow-guard.js'

describe('checkProductionEscrowGuard (ADR-253 / Sub-Plan 01 §1.3)', () => {
  it('passes when not production', () => {
    expect(checkProductionEscrowGuard({ nodeEnv: 'development', isBetaMode: false, escrowEnabled: true, coopEscrowEnabled: true })).toBeNull()
    expect(checkProductionEscrowGuard({ nodeEnv: undefined, isBetaMode: false, escrowEnabled: true, coopEscrowEnabled: true })).toBeNull()
  })

  it('passes on a declared beta deployment even with both flags on', () => {
    const r = checkProductionEscrowGuard({ nodeEnv: 'production', isBetaMode: true, escrowEnabled: true, coopEscrowEnabled: true })
    expect(r).toBeNull()
  })

  it('passes on a real production host when both flags are off', () => {
    expect(checkProductionEscrowGuard({ nodeEnv: 'production', isBetaMode: false, escrowEnabled: false, coopEscrowEnabled: false })).toBeNull()
  })

  it('blocks a real production host with COOP_ESCROW_ENABLED on', () => {
    const r = checkProductionEscrowGuard({ nodeEnv: 'production', isBetaMode: false, escrowEnabled: false, coopEscrowEnabled: true })
    expect(r).not.toBeNull()
    expect(r?.violatingFlags).toEqual(['COOP_ESCROW_ENABLED'])
  })

  it('blocks a real production host with ESCROW_ENABLED on', () => {
    const r = checkProductionEscrowGuard({ nodeEnv: 'production', isBetaMode: false, escrowEnabled: true, coopEscrowEnabled: false })
    expect(r?.violatingFlags).toEqual(['ESCROW_ENABLED'])
  })

  it('reports both flags when both are on', () => {
    const r = checkProductionEscrowGuard({ nodeEnv: 'production', isBetaMode: false, escrowEnabled: true, coopEscrowEnabled: true })
    expect(r?.violatingFlags).toEqual(['ESCROW_ENABLED', 'COOP_ESCROW_ENABLED'])
    expect(r?.message).toMatch(/ADR-253/)
  })
})
