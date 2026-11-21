import { describe, it, expect } from 'vitest'
import { isOpenTransaction, railBadge, statusPresentation } from './walletTransactionView'

describe('railBadge', () => {
  it('labels the known rails', () => {
    expect(railBadge({ directPayRail: 'LN' })?.label).toBe('Lightning')
    expect(railBadge({ directPayRail: 'CASHU' })?.label).toBe('eCash')
    expect(railBadge({ directPayRail: 'DEMO' })?.label).toBe('Demo')
  })

  it('returns null when no rail is recorded', () => {
    expect(railBadge({ directPayRail: null })).toBeNull()
    expect(railBadge({})).toBeNull()
  })
})

describe('statusPresentation', () => {
  const base = { type: 'SENT' as const, status: 'PENDING' as const }

  it('prefers a refund over every other state', () => {
    expect(statusPresentation({ ...base, status: 'REFUNDED' })).toEqual({ label: 'Refunded', tone: 'warning' })
    expect(statusPresentation({ ...base, escrowStatus: 'REFUNDED' })).toEqual({ label: 'Refunded', tone: 'warning' })
  })

  it('reports a cancelled ticket as cancelled', () => {
    expect(statusPresentation({ ...base, ticketStatus: 'CANCELLED' })).toEqual({ label: 'Cancelled', tone: 'error' })
  })

  it('maps escrow releases to Released', () => {
    expect(statusPresentation({ ...base, type: 'ESCROW_RELEASE' })).toEqual({ label: 'Released', tone: 'success' })
    expect(statusPresentation({ ...base, escrowStatus: 'RELEASE_PHASE_2' })).toEqual({ label: 'Released', tone: 'success' })
    expect(statusPresentation({ ...base, escrowStatus: 'RELEASED' })).toEqual({ label: 'Released', tone: 'success' })
  })

  it('maps active escrow to In escrow', () => {
    expect(statusPresentation({ ...base, type: 'ESCROW_HOLD' })).toEqual({ label: 'In escrow', tone: 'warning' })
    expect(statusPresentation({ ...base, escrowStatus: 'FUNDED' })).toEqual({ label: 'In escrow', tone: 'warning' })
  })

  it('falls back to Completed / Awaiting payment for direct-pay', () => {
    expect(statusPresentation({ ...base, type: 'RECEIVED', status: 'COMPLETED' })).toEqual({ label: 'Completed', tone: 'success' })
    expect(statusPresentation({ ...base, type: 'RECEIVED' })).toEqual({ label: 'Awaiting payment', tone: 'warning' })
  })
})

describe('isOpenTransaction', () => {
  it('is true for open payments and active escrows', () => {
    expect(isOpenTransaction({ status: 'PENDING' })).toBe(true)
    expect(isOpenTransaction({ status: 'PENDING', ticketStatus: 'ACCEPTED' })).toBe(true)
  })

  it('is false for settled, refunded and cancelled rows', () => {
    expect(isOpenTransaction({ status: 'COMPLETED' })).toBe(false)
    expect(isOpenTransaction({ status: 'REFUNDED' })).toBe(false)
    expect(isOpenTransaction({ status: 'PENDING', ticketStatus: 'CANCELLED' })).toBe(false)
  })
})
