import { describe, expect, it } from 'vitest'
import {
  clearPendingCashuToken,
  deriveTicketPaymentView,
  meltMintCandidates,
  orderHeadline,
  readPendingCashuToken,
  showsEscrowPanel,
  writePendingCashuToken,
} from './ticket-payment'

describe('deriveTicketPaymentView (ADR-399 D4)', () => {
  it('maps every rail and a legacy invoice-only ticket', () => {
    expect(deriveTicketPaymentView({ status: 'PENDING', directPayRail: 'LN', lightningInvoice: 'lnbc1' })?.rail).toBe('LN')
    expect(deriveTicketPaymentView({ status: 'PENDING', directPayRail: 'CASHU' })?.rail).toBe('CASHU')
    expect(deriveTicketPaymentView({ status: 'PENDING', directPayRail: 'DEMO' })?.rail).toBe('DEMO')
    expect(deriveTicketPaymentView({ status: 'PENDING', escrowEnabled: true, lightningInvoice: 'lnbc1' })?.rail).toBe('ESCROW')
    expect(deriveTicketPaymentView({ status: 'PENDING', lightningInvoice: 'lnbc1' })?.rail).toBe('LN')
    expect(deriveTicketPaymentView({ status: 'PENDING' })).toBeNull()
  })

  it('treats PENDING and ACCEPTED as payable, everything later as paid', () => {
    expect(deriveTicketPaymentView({ status: 'ACCEPTED', directPayRail: 'LN' })).toMatchObject({ phase: 'awaiting', canPay: true })
    expect(deriveTicketPaymentView({ status: 'PAID', directPayRail: 'LN' })).toMatchObject({ phase: 'paid', canPay: false })
    expect(deriveTicketPaymentView({ status: 'COMPLETED', directPayRail: 'CASHU' })?.phase).toBe('paid')
    expect(deriveTicketPaymentView({ status: 'CANCELLED', directPayRail: 'LN' })?.phase).toBe('cancelled')
    expect(deriveTicketPaymentView({ status: 'PENDING', directPayRail: 'LN' }, true)?.phase).toBe('paid')
  })

  it('shows a delivered Cashu token as sent, not payable again', () => {
    const view = deriveTicketPaymentView({ status: 'PENDING', directPayRail: 'CASHU', cashuTokenSentAt: '2026-09-25T10:00:00Z' })
    expect(view).toMatchObject({ phase: 'token-sent', canPay: false })
  })

  it('auto-detects LN settlement only where the server can check the source', () => {
    const base = { status: 'PENDING', directPayRail: 'LN' }
    expect(deriveTicketPaymentView({ ...base, sellerInvoiceSource: 'NWC' })?.autoDetect).toBe(true)
    expect(deriveTicketPaymentView({ ...base, sellerInvoiceSource: 'ALBY_OAUTH' })?.autoDetect).toBe(true)
    expect(deriveTicketPaymentView({ ...base, sellerInvoiceSource: 'LNURL', sellerVerifyUrl: 'https://x/verify' })?.autoDetect).toBe(true)
    expect(deriveTicketPaymentView({ ...base, sellerInvoiceSource: 'LNURL' })?.autoDetect).toBe(false)
    expect(deriveTicketPaymentView(base)?.autoDetect).toBe(false)
  })

  // ADR-372 D7.3: a hosted-canvas purchase is price + fee. The seller leg can
  // be confirmed while the platform fee is still open — the ticket status stays
  // PENDING, so the card must not claim "awaiting payment" for a paid price
  // and must not offer the settled seller invoice for payment again.
  it('reports a confirmed seller leg with an open platform fee as fee-pending, not payable', () => {
    const view = deriveTicketPaymentView({
      status: 'PENDING',
      directPayRail: 'LN',
      lightningInvoice: 'lnbc1',
      preimage: 'aa'.repeat(32),
      platformFee: { status: 'PENDING', sellerLegConfirmedAt: '2026-10-30T19:45:08.397Z' },
    })
    expect(view).toMatchObject({ phase: 'fee-pending', canPay: false })
  })

  it('treats the fee leg as open only when the seller leg is confirmed', () => {
    const fee = { status: 'PENDING', sellerLegConfirmedAt: null }
    expect(
      deriveTicketPaymentView({ status: 'PENDING', directPayRail: 'LN', lightningInvoice: 'lnbc1', platformFee: fee })?.phase,
    ).toBe('awaiting')
    // The preimage alone already proves the settled seller invoice.
    expect(
      deriveTicketPaymentView({ status: 'PENDING', directPayRail: 'LN', lightningInvoice: 'lnbc1', preimage: 'bb'.repeat(32), platformFee: fee })?.phase,
    ).toBe('fee-pending')
  })

  it('shows paid once the platform fee is confirmed, even while the ticket status lags', () => {
    expect(
      deriveTicketPaymentView({
        status: 'PENDING',
        directPayRail: 'LN',
        lightningInvoice: 'lnbc1',
        preimage: 'aa'.repeat(32),
        platformFee: { status: 'PAID', sellerLegConfirmedAt: '2026-10-30T19:45:08.397Z' },
      })?.phase,
    ).toBe('paid')
  })
})

describe('showsEscrowPanel', () => {
  it('is off for a direct-pay SMART_ORDER (no escrow exists)', () => {
    expect(showsEscrowPanel({ ticketType: 'SMART_ORDER', escrowEnabled: false })).toBe(false)
  })

  it('is on for a SMART_ORDER that actually used escrow', () => {
    expect(showsEscrowPanel({ ticketType: 'SMART_ORDER', escrowEnabled: true })).toBe(true)
  })

  it('is off for every other ticket type', () => {
    expect(showsEscrowPanel({ ticketType: 'DIRECT', escrowEnabled: true })).toBe(false)
    expect(showsEscrowPanel({ ticketType: null, escrowEnabled: true })).toBe(false)
  })
})

describe('orderHeadline', () => {
  const feePending = {
    status: 'PENDING',
    directPayRail: 'LN',
    lightningInvoice: 'lnbc1',
    preimage: 'aa'.repeat(32),
    platformFee: { status: 'PENDING', sellerLegConfirmedAt: '2026-10-30T19:45:08.397Z' },
  }

  it('names the open fee leg instead of the buyer payment', () => {
    expect(orderHeadline(feePending, { isBuyer: true, isSeller: false, isService: false })).toBe('Price paid — the platform fee is still open')
    expect(orderHeadline(feePending, { isBuyer: false, isSeller: true, isService: false })).toBe('Price received — waiting for the platform fee')
  })

  it('keeps the plain states when no fee is open', () => {
    expect(orderHeadline({ status: 'PENDING' }, { isBuyer: false, isSeller: true, isService: false })).toBe('Waiting for buyer payment')
    expect(orderHeadline({ status: 'PENDING' }, { isBuyer: false, isSeller: true, isService: true })).toBe('Review and accept the request to begin')
    expect(orderHeadline({ status: 'PENDING' }, { isBuyer: true, isSeller: false, isService: false })).toBe('Waiting for seller confirmation')
    expect(orderHeadline({ status: 'PAID' }, { isBuyer: false, isSeller: true, isService: false })).toBe('Payment received — confirm to start fulfillment')
    expect(orderHeadline({ status: 'COMPLETED' }, { isBuyer: true, isSeller: false, isService: false })).toBe('Transaction completed')
  })
})

describe('meltMintCandidates', () => {
  it('keeps mints that cover the amount, largest balance first', () => {
    const buckets = [
      { mintUrl: 'a', proofs: [{ amount: 8 }, { amount: 2 }] },
      { mintUrl: 'b', proofs: [{ amount: 64 }] },
      { mintUrl: 'c', proofs: [{ amount: 32 }] },
    ]
    expect(meltMintCandidates(buckets, 21)).toEqual([
      { mintUrl: 'b', balanceSats: 64 },
      { mintUrl: 'c', balanceSats: 32 },
    ])
  })
})

describe('pending Cashu token storage', () => {
  it('round-trips per ticket and tolerates missing storage', () => {
    const map = new Map<string, string>()
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    }
    writePendingCashuToken('t1', 'cashuBtoken', storage)
    expect(readPendingCashuToken('t1', storage)).toBe('cashuBtoken')
    expect(readPendingCashuToken('t2', storage)).toBeNull()
    clearPendingCashuToken('t1', storage)
    expect(readPendingCashuToken('t1', storage)).toBeNull()
    expect(readPendingCashuToken('t1', null)).toBeNull()
  })
})
