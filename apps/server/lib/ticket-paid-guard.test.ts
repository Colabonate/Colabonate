import { describe, it, expect } from 'vitest'
import { canSelfReportPaid } from './ticket-paid-guard.js'

const base = {
  fromStatus: 'PENDING',
  toStatus: 'PAID',
  directPayRail: null as string | null,
  sellerPubkey: 'seller-pubkey',
  authPubkey: 'buyer-pubkey',
}

describe('canSelfReportPaid', () => {
  it('allows non-PAID transitions unconditionally', () => {
    expect(canSelfReportPaid({ ...base, toStatus: 'CANCELLED' })).toBe(true)
    expect(canSelfReportPaid({ ...base, toStatus: 'DISPUTED' })).toBe(true)
  })

  it('allows PAID transitions that are not coming from a pre-payment state', () => {
    expect(canSelfReportPaid({ ...base, fromStatus: 'IN_PROGRESS' })).toBe(true)
  })

  // ADR-394: ACCEPTED is a pre-payment state too (AGENT_SETUP tickets born
  // accepted) — it must be guarded exactly like PENDING.
  it('blocks ACCEPTED -> PAID self-report on an LN-rail ticket for either party', () => {
    expect(canSelfReportPaid({ ...base, fromStatus: 'ACCEPTED', directPayRail: 'LN', authPubkey: 'buyer-pubkey' })).toBe(false)
    expect(canSelfReportPaid({ ...base, fromStatus: 'ACCEPTED', directPayRail: 'LN', authPubkey: 'seller-pubkey' })).toBe(false)
  })

  it('blocks ACCEPTED -> PAID on an escrow/custodial ticket (directPayRail null) for either party', () => {
    expect(canSelfReportPaid({ ...base, fromStatus: 'ACCEPTED', directPayRail: null, authPubkey: 'buyer-pubkey' })).toBe(false)
    expect(canSelfReportPaid({ ...base, fromStatus: 'ACCEPTED', directPayRail: null, authPubkey: 'seller-pubkey' })).toBe(false)
  })

  it('still allows the seller to self-report ACCEPTED -> PAID on a Cashu-rail ticket', () => {
    expect(canSelfReportPaid({ ...base, fromStatus: 'ACCEPTED', directPayRail: 'CASHU', authPubkey: 'seller-pubkey' })).toBe(true)
    expect(canSelfReportPaid({ ...base, fromStatus: 'ACCEPTED', directPayRail: 'CASHU', authPubkey: 'buyer-pubkey' })).toBe(false)
  })

  it('blocks the buyer from setting PENDING -> PAID on an LN-rail ticket', () => {
    expect(canSelfReportPaid({ ...base, directPayRail: 'LN', authPubkey: 'buyer-pubkey' })).toBe(false)
  })

  it('blocks the seller from setting PENDING -> PAID on an LN-rail ticket (must go through confirm-direct-payment)', () => {
    expect(canSelfReportPaid({ ...base, directPayRail: 'LN', authPubkey: 'seller-pubkey' })).toBe(false)
  })

  it('blocks the buyer from self-reporting PAID even on a Cashu-rail ticket', () => {
    expect(canSelfReportPaid({ ...base, directPayRail: 'CASHU', authPubkey: 'buyer-pubkey' })).toBe(false)
  })

  it('allows the seller to self-report PAID on a Cashu-rail ticket', () => {
    expect(canSelfReportPaid({ ...base, directPayRail: 'CASHU', authPubkey: 'seller-pubkey' })).toBe(true)
  })

  it('blocks PENDING -> PAID on an escrow/custodial ticket (directPayRail null) for either party', () => {
    expect(canSelfReportPaid({ ...base, directPayRail: null, authPubkey: 'seller-pubkey' })).toBe(false)
    expect(canSelfReportPaid({ ...base, directPayRail: null, authPubkey: 'buyer-pubkey' })).toBe(false)
  })
})
