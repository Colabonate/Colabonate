import { describe, it, expect } from 'vitest'
import { shouldSelfConfirmDirectPayment } from './direct-pay'

// FU-757 regression guard: the direct-pay self-confirm gate. Getting this wrong
// means the buyer's money reaches the seller while the ticket stays PENDING —
// the exact production bug fixed on 2026-09-18.
describe('shouldSelfConfirmDirectPayment', () => {
  const PREIMAGE = 'aa'.repeat(32)

  it('self-confirms a non-escrow production payment that carried a preimage', () => {
    expect(
      shouldSelfConfirmDirectPayment({ isBeta: false, isEscrow: false, preimage: PREIMAGE }),
    ).toBe(true)
  })

  it('never self-confirms on the beta demo rail (server confirms demo-pay)', () => {
    expect(
      shouldSelfConfirmDirectPayment({ isBeta: true, isEscrow: false, preimage: PREIMAGE }),
    ).toBe(false)
  })

  it('never self-confirms escrow tickets (hold-invoice poll owns that state)', () => {
    expect(
      shouldSelfConfirmDirectPayment({ isBeta: false, isEscrow: true, preimage: PREIMAGE }),
    ).toBe(false)
  })

  it('falls back to polling when the wallet exposed no preimage', () => {
    expect(shouldSelfConfirmDirectPayment({ isBeta: false, isEscrow: false, preimage: undefined })).toBe(false)
    expect(shouldSelfConfirmDirectPayment({ isBeta: false, isEscrow: false, preimage: null })).toBe(false)
    expect(shouldSelfConfirmDirectPayment({ isBeta: false, isEscrow: false, preimage: '' })).toBe(false)
  })
})
