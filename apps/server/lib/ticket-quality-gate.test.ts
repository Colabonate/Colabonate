import { describe, it, expect } from 'vitest'
import { requiresQualityApproval, shouldStampQualityApproval } from './ticket-quality-gate.js'

const base = {
  toStatus: 'COMPLETED',
  qualityGateRequired: true,
  qualityApprovedAt: null as Date | null,
  sellerPubkey: 'seller-pubkey',
  authPubkey: 'buyer-pubkey',
}

describe('requiresQualityApproval', () => {
  it('never blocks non-COMPLETED transitions', () => {
    expect(requiresQualityApproval({ ...base, toStatus: 'IN_PROGRESS' })).toBe(false)
    expect(requiresQualityApproval({ ...base, toStatus: 'CANCELLED' })).toBe(false)
  })

  it('never blocks when the gate was not required (ungated ticket)', () => {
    expect(requiresQualityApproval({ ...base, qualityGateRequired: false })).toBe(false)
  })

  it('blocks the buyer from completing a gated ticket before seller review', () => {
    expect(requiresQualityApproval({ ...base, authPubkey: 'buyer-pubkey' })).toBe(true)
  })

  it('does not block the seller — their own COMPLETED transition is the review', () => {
    expect(requiresQualityApproval({ ...base, authPubkey: 'seller-pubkey' })).toBe(false)
  })

  it('does not block once qualityApprovedAt is already set (e.g. a later correction)', () => {
    expect(requiresQualityApproval({ ...base, authPubkey: 'buyer-pubkey', qualityApprovedAt: new Date() })).toBe(false)
  })
})

describe('shouldStampQualityApproval', () => {
  it('stamps when the seller completes a gated, not-yet-approved ticket', () => {
    expect(shouldStampQualityApproval({ ...base, authPubkey: 'seller-pubkey' })).toBe(true)
  })

  it('does not stamp for the buyer', () => {
    expect(shouldStampQualityApproval({ ...base, authPubkey: 'buyer-pubkey' })).toBe(false)
  })

  it('does not stamp for an ungated ticket', () => {
    expect(shouldStampQualityApproval({ ...base, authPubkey: 'seller-pubkey', qualityGateRequired: false })).toBe(false)
  })

  it('does not stamp a non-COMPLETED transition', () => {
    expect(shouldStampQualityApproval({ ...base, authPubkey: 'seller-pubkey', toStatus: 'IN_PROGRESS' })).toBe(false)
  })

  it('does not re-stamp an already-approved ticket', () => {
    expect(shouldStampQualityApproval({ ...base, authPubkey: 'seller-pubkey', qualityApprovedAt: new Date() })).toBe(false)
  })
})
