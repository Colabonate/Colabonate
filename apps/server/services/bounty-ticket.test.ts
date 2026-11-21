import { describe, expect, it } from 'vitest'
import { canRevertSelection, computePosterReliability, evaluateBountyTicket, isPayingWalletProvider, nextBountyStatus, type BountyTicketCheckInput } from './bounty-ticket.js'

function input(overrides: {
  buyerPubkey?: string
  offerId?: string
  appOfferId?: string
  appStatus?: string
  proposedPriceSats?: number | null
  taskStatus?: string
  creatorPubkey?: string
  ticket?: { id: string; status: string } | null
} = {}): BountyTicketCheckInput {
  return {
    buyerPubkey: overrides.buyerPubkey ?? 'poster',
    offerId: overrides.offerId ?? 'offer-1',
    application: {
      offerId: overrides.appOfferId ?? 'offer-1',
      status: overrides.appStatus ?? 'ACCEPTED',
      proposedPriceSats: overrides.proposedPriceSats === undefined ? 5000 : overrides.proposedPriceSats,
      task: {
        id: 'task-1',
        creatorPubkey: overrides.creatorPubkey ?? 'poster',
        status: overrides.taskStatus ?? 'ASSIGNED',
        ticket: overrides.ticket ?? null,
      },
    },
  }
}

describe('evaluateBountyTicket (ADR-397 D3)', () => {
  it('charges the agreed price of the accepted application', () => {
    expect(evaluateBountyTicket(input())).toEqual({ ok: true, agentTaskId: 'task-1', priceSats: 5000, unlinkTicketId: null })
  })

  it('falls back to the listing price when no bid was stored (null)', () => {
    const r = evaluateBountyTicket(input({ proposedPriceSats: null }))
    expect(r).toMatchObject({ ok: true, priceSats: null })
  })

  it('rejects a missing application', () => {
    expect(evaluateBountyTicket({ buyerPubkey: 'poster', offerId: 'offer-1', application: null })).toMatchObject({ ok: false, status: 404, code: 'BOUNTY_APPLICATION_NOT_FOUND' })
  })

  it('rejects anyone but the poster', () => {
    expect(evaluateBountyTicket(input({ buyerPubkey: 'someone-else' }))).toMatchObject({ ok: false, status: 403, code: 'BOUNTY_NOT_POSTER' })
  })

  it('rejects an offer that does not belong to the application', () => {
    expect(evaluateBountyTicket(input({ offerId: 'other-offer' }))).toMatchObject({ ok: false, status: 400, code: 'BOUNTY_OFFER_MISMATCH' })
  })

  it('rejects an application that is not the accepted winner', () => {
    expect(evaluateBountyTicket(input({ appStatus: 'PENDING' }))).toMatchObject({ ok: false, status: 409, code: 'BOUNTY_NOT_ASSIGNED' })
    expect(evaluateBountyTicket(input({ appStatus: 'REJECTED' }))).toMatchObject({ ok: false, status: 409 })
  })

  it('rejects a bounty that is not ASSIGNED (already paid, reverted, cancelled)', () => {
    for (const taskStatus of ['SELECTING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']) {
      expect(evaluateBountyTicket(input({ taskStatus }))).toMatchObject({ ok: false, code: 'BOUNTY_NOT_ASSIGNED' })
    }
  })

  it('refuses a second live ticket and names the existing one', () => {
    expect(evaluateBountyTicket(input({ ticket: { id: 't-1', status: 'PENDING' } }))).toMatchObject({ ok: false, status: 409, code: 'BOUNTY_TICKET_EXISTS', ticketId: 't-1' })
  })

  it('allows a new ticket after the linked one was cancelled, unlinking it', () => {
    expect(evaluateBountyTicket(input({ ticket: { id: 't-1', status: 'CANCELLED' } }))).toMatchObject({ ok: true, unlinkTicketId: 't-1' })
  })
})

describe('nextBountyStatus (ADR-397 D4)', () => {
  it('moves ASSIGNED → IN_PROGRESS once the ticket is paid', () => {
    expect(nextBountyStatus('ASSIGNED', 'PAID')).toBe('IN_PROGRESS')
    expect(nextBountyStatus('ASSIGNED', 'IN_PROGRESS')).toBe('IN_PROGRESS')
    expect(nextBountyStatus('ASSIGNED', 'DISPUTED')).toBe('IN_PROGRESS')
  })

  it('moves to COMPLETED when the ticket completes', () => {
    expect(nextBountyStatus('IN_PROGRESS', 'COMPLETED')).toBe('COMPLETED')
    expect(nextBountyStatus('ASSIGNED', 'COMPLETED')).toBe('COMPLETED')
  })

  it('does nothing for unpaid or cancelled tickets and never moves backwards', () => {
    expect(nextBountyStatus('ASSIGNED', 'PENDING')).toBeNull()
    expect(nextBountyStatus('ASSIGNED', 'ACCEPTED')).toBeNull()
    expect(nextBountyStatus('ASSIGNED', 'CANCELLED')).toBeNull()
    expect(nextBountyStatus('IN_PROGRESS', 'PAID')).toBeNull()
    expect(nextBountyStatus('COMPLETED', 'PAID')).toBeNull()
    expect(nextBountyStatus('SELECTING', 'PAID')).toBeNull()
  })
})

describe('canRevertSelection (ADR-397 D4)', () => {
  it('allows reverting an ASSIGNED bounty without a ticket', () => {
    expect(canRevertSelection('ASSIGNED', null)).toBe(true)
  })

  it('allows reverting when the linked ticket was cancelled', () => {
    expect(canRevertSelection('ASSIGNED', 'CANCELLED')).toBe(true)
    expect(canRevertSelection('IN_PROGRESS', 'CANCELLED')).toBe(true)
  })

  it('refuses while a live ticket exists or nothing is selected', () => {
    expect(canRevertSelection('ASSIGNED', 'PENDING')).toBe(false)
    expect(canRevertSelection('IN_PROGRESS', 'PAID')).toBe(false)
    expect(canRevertSelection('OPEN', null)).toBe(false)
    expect(canRevertSelection('COMPLETED', 'COMPLETED')).toBe(false)
  })
})

describe('isPayingWalletProvider (ADR-397 D2-B)', () => {
  it('accepts wallets that can pay an invoice from the app', () => {
    for (const p of ['NWC', 'ALBY_OAUTH', 'WEBLN', 'CASHU']) expect(isPayingWalletProvider(p, false)).toBe(true)
  })
  it('rejects platform/server providers and DEMO outside beta', () => {
    for (const p of ['LNBITS', 'LIGHTSPARK', 'MOCK', 'DEMO']) expect(isPayingWalletProvider(p, false)).toBe(false)
  })
  it('accepts DEMO only in beta mode', () => {
    expect(isPayingWalletProvider('DEMO', true)).toBe(true)
  })
})

describe('computePosterReliability (ADR-397 D2-C)', () => {
  const t0 = new Date('2026-09-01T00:00:00Z')
  const h = (hours: number) => new Date(t0.getTime() + hours * 3_600_000)

  it('is empty for a new poster', () => {
    expect(computePosterReliability([])).toEqual({ decided: 0, paid: 0, paidRate: null, medianHoursToPay: null })
  })
  it('ignores open unpaid tickets and counts cancelled unpaid ones against the poster', () => {
    const r = computePosterReliability([
      { ticketStatus: 'PAID', ticketCreatedAt: t0, ticketPaidAt: h(2) },
      { ticketStatus: 'PENDING', ticketCreatedAt: t0, ticketPaidAt: null },
      { ticketStatus: 'CANCELLED', ticketCreatedAt: t0, ticketPaidAt: null },
    ])
    expect(r).toMatchObject({ decided: 2, paid: 1, paidRate: 0.5, medianHoursToPay: 2 })
  })
  it('takes the median time-to-pay (even count averages the middle two)', () => {
    const r = computePosterReliability([
      { ticketStatus: 'COMPLETED', ticketCreatedAt: t0, ticketPaidAt: h(1) },
      { ticketStatus: 'COMPLETED', ticketCreatedAt: t0, ticketPaidAt: h(3) },
      { ticketStatus: 'PAID', ticketCreatedAt: t0, ticketPaidAt: h(10) },
      { ticketStatus: 'PAID', ticketCreatedAt: t0, ticketPaidAt: h(40) },
    ])
    expect(r).toMatchObject({ decided: 4, paid: 4, paidRate: 1, medianHoursToPay: 6.5 })
  })
  it('counts a later-cancelled ticket that was paid as paid', () => {
    const r = computePosterReliability([{ ticketStatus: 'CANCELLED', ticketCreatedAt: t0, ticketPaidAt: h(5) }])
    expect(r).toMatchObject({ decided: 1, paid: 1 })
  })
})
