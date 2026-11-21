import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

const confirmPaymentByHash = vi.fn().mockResolvedValue(['ticket:t1:PAID'])
vi.mock('./paymentConfirmation.js', () => ({
  confirmPaymentByHash: (...a: unknown[]) => confirmPaymentByHash(...a),
}))

const lookupInvoice = vi.fn()
const closeNwc = vi.fn()
vi.mock('./nwcClient.js', () => ({
  NwcClient: vi.fn().mockImplementation(function NwcClient() {
    return { lookupInvoice: (...a: unknown[]) => lookupInvoice(...a), close: () => closeNwc() }
  }),
}))
vi.mock('../lib/secretbox.js', () => ({ decrypt: () => 'nostr+walletconnect://seller' }))

const coolingDown = vi.fn().mockReturnValue(false)
vi.mock('../lib/nwc-cooldown.js', () => ({ isNwcCoolingDown: (...a: unknown[]) => coolingDown(...a) }))

const getPaymentStatus = vi.fn()
vi.mock('./albyOauthProvider.js', () => ({
  createAlbyOauthProviderForUser: async () => ({ getPaymentStatus: (...a: unknown[]) => getPaymentStatus(...a) }),
}))

const verifyPayment = vi.fn()
let verifiedPreimage: string | null = null
vi.mock('@getalby/lightning-tools', () => ({
  Invoice: vi.fn().mockImplementation(function Invoice() {
    return {
      verifyPayment: () => verifyPayment(),
      get preimage() {
        return verifiedPreimage
      },
    }
  }),
}))

const {
  checkDirectPayTicketNow,
  isDirectPaySettlementCandidate,
  makeDirectPaySettlementCheck,
  runDirectPayReconcileTick,
  settleDirectPayTicket,
} = await import('./directPaySettlement.js')

const PREIMAGE = '11'.repeat(32)
// sha256(0x11 * 32)
const HASH = '02d449a31fbb267c8f352e9968a79e3e5fc95c1bbeaa502fd6454ebde5a4bedc'

function ticket(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    status: 'PENDING',
    escrowEnabled: false,
    directPayRail: 'LN',
    paymentHash: HASH,
    lightningInvoice: 'lnbc1seller',
    sellerPubkey: 'seller',
    sellerInvoiceSource: 'LNURL',
    sellerVerifyUrl: 'https://wallet.example/verify/1',
    ...over,
  } as Parameters<typeof settleDirectPayTicket>[1]
}

function makePrisma(rows: unknown[] = []) {
  return {
    ticket: { findMany: vi.fn().mockResolvedValue(rows) },
    wallet: { findFirst: vi.fn().mockResolvedValue({ nwcConnectionUriEnc: 'enc' }) },
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'seller-id' }) },
  } as unknown as PrismaClient & { ticket: { findMany: ReturnType<typeof vi.fn> } }
}

beforeEach(() => {
  vi.clearAllMocks()
  verifiedPreimage = null
  coolingDown.mockReturnValue(false)
})

describe('isDirectPaySettlementCandidate (ADR-399 D2)', () => {
  it('accepts an unpaid LN direct-pay ticket with a recorded source', () => {
    expect(isDirectPaySettlementCandidate(ticket())).toBe(true)
    expect(isDirectPaySettlementCandidate(ticket({ status: 'ACCEPTED' }))).toBe(true)
  })

  it('rejects escrow, other rails, paid tickets and legacy rows without a source', () => {
    expect(isDirectPaySettlementCandidate(ticket({ escrowEnabled: true }))).toBe(false)
    expect(isDirectPaySettlementCandidate(ticket({ directPayRail: 'CASHU' }))).toBe(false)
    expect(isDirectPaySettlementCandidate(ticket({ status: 'PAID' }))).toBe(false)
    expect(isDirectPaySettlementCandidate(ticket({ sellerInvoiceSource: null }))).toBe(false)
  })
})

describe('makeDirectPaySettlementCheck', () => {
  it('LNURL: settled only with a preimage that hashes to the payment hash', async () => {
    const check = makeDirectPaySettlementCheck(makePrisma())
    verifyPayment.mockResolvedValue(true)
    verifiedPreimage = PREIMAGE
    expect(await check(ticket())).toEqual({ settled: true, preimage: PREIMAGE })

    verifiedPreimage = '22'.repeat(32)
    expect(await check(ticket())).toEqual({ settled: false })

    verifiedPreimage = null
    expect(await check(ticket())).toEqual({ settled: false })
  })

  it('LNURL: no verify URL means no check', async () => {
    const check = makeDirectPaySettlementCheck(makePrisma())
    expect(await check(ticket({ sellerVerifyUrl: null }))).toEqual({ settled: false })
    expect(verifyPayment).not.toHaveBeenCalled()
  })

  it('NWC: asks the seller wallet, rejects a mismatching preimage, closes the client', async () => {
    const check = makeDirectPaySettlementCheck(makePrisma())
    lookupInvoice.mockResolvedValue({ paid: true, preimage: PREIMAGE, state: 'settled' })
    expect(await check(ticket({ sellerInvoiceSource: 'NWC' }))).toEqual({ settled: true, preimage: PREIMAGE })
    expect(lookupInvoice).toHaveBeenCalledWith(HASH)
    expect(closeNwc).toHaveBeenCalled()

    lookupInvoice.mockResolvedValue({ paid: true, preimage: '22'.repeat(32), state: 'settled' })
    expect(await check(ticket({ sellerInvoiceSource: 'NWC' }))).toEqual({ settled: false })

    lookupInvoice.mockResolvedValue({ paid: false, state: 'pending' })
    expect(await check(ticket({ sellerInvoiceSource: 'NWC' }))).toEqual({ settled: false })
  })

  it('NWC: skips a wallet in cooldown', async () => {
    coolingDown.mockReturnValue(true)
    const check = makeDirectPaySettlementCheck(makePrisma())
    expect(await check(ticket({ sellerInvoiceSource: 'NWC' }))).toEqual({ settled: false })
    expect(lookupInvoice).not.toHaveBeenCalled()
  })

  it('ALBY_OAUTH: settled when the seller account reports SUCCESS', async () => {
    const check = makeDirectPaySettlementCheck(makePrisma())
    getPaymentStatus.mockResolvedValue({ paymentHash: HASH, status: 'SUCCESS' })
    expect(await check(ticket({ sellerInvoiceSource: 'ALBY_OAUTH' }))).toEqual({ settled: true })
    getPaymentStatus.mockResolvedValue({ paymentHash: HASH, status: 'PENDING' })
    expect(await check(ticket({ sellerInvoiceSource: 'ALBY_OAUTH' }))).toEqual({ settled: false })
  })
})

describe('settleDirectPayTicket', () => {
  it('confirms through confirmPaymentByHash with the preimage', async () => {
    const check = vi.fn().mockResolvedValue({ settled: true, preimage: PREIMAGE })
    const updated = await settleDirectPayTicket(makePrisma(), ticket(), { check })
    expect(updated).toEqual(['ticket:t1:PAID'])
    expect(confirmPaymentByHash).toHaveBeenCalledWith(expect.anything(), HASH, { preimage: PREIMAGE, nostrService: undefined })
  })

  it('does nothing when unsettled, failing, or not a candidate', async () => {
    const prisma = makePrisma()
    expect(await settleDirectPayTicket(prisma, ticket(), { check: vi.fn().mockResolvedValue({ settled: false }) })).toEqual([])
    expect(await settleDirectPayTicket(prisma, ticket(), { check: vi.fn().mockRejectedValue(new Error('boom')) })).toEqual([])
    const neverCalled = vi.fn()
    expect(await settleDirectPayTicket(prisma, ticket({ status: 'PAID' }), { check: neverCalled })).toEqual([])
    expect(neverCalled).not.toHaveBeenCalled()
    expect(confirmPaymentByHash).not.toHaveBeenCalled()
  })
})

describe('checkDirectPayTicketNow', () => {
  it('throttles repeated checks of the same ticket', async () => {
    const check = vi.fn().mockResolvedValue({ settled: false })
    const prisma = makePrisma()
    const t = ticket({ id: 'throttle-1' })
    await checkDirectPayTicketNow(prisma, t, { check, now: 1_000_000 })
    await checkDirectPayTicketNow(prisma, t, { check, now: 1_005_000 })
    expect(check).toHaveBeenCalledTimes(1)
    await checkDirectPayTicketNow(prisma, t, { check, now: 1_011_000 })
    expect(check).toHaveBeenCalledTimes(2)
  })
})

describe('runDirectPayReconcileTick', () => {
  it('scans unpaid LN direct-pay tickets inside the window and settles them', async () => {
    const prisma = makePrisma([ticket({ id: 'a' }), ticket({ id: 'b' })])
    const check = vi.fn().mockImplementation(async (t: { id: string }) =>
      t.id === 'a' ? { settled: true, preimage: PREIMAGE } : { settled: false },
    )
    const now = new Date('2026-09-25T12:00:00Z')
    const updated = await runDirectPayReconcileTick(prisma, { check, now })
    expect(updated).toEqual(['ticket:t1:PAID'])
    expect(check).toHaveBeenCalledTimes(2)
    const where = prisma.ticket.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({
      escrowEnabled: false,
      directPayRail: 'LN',
      status: { in: ['PENDING', 'ACCEPTED'] },
      sellerInvoiceSource: { not: null },
    })
    expect(where.createdAt.gte.toISOString()).toBe('2026-09-23T12:00:00.000Z')
  })
})
