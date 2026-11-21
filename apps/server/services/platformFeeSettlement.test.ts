import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient, TicketPlatformFee } from '@prisma/client'

const enqueueProvisioningOnPaid = vi.fn().mockResolvedValue(false)
vi.mock('./canvas-provisioning.js', () => ({
  enqueueProvisioningOnPaid: (...a: unknown[]) => enqueueProvisioningOnPaid(...a),
}))
vi.mock('./nwcClient.js', async (importOriginal) => {
  // Real helper + a stubbed client: the RESTRICTED classification must be the
  // production logic, only the relay-backed NwcClient class is faked.
  const actual = await importOriginal<typeof import('./nwcClient.js')>()
  return { ...actual, NwcClient: vi.fn() }
})

const { completeTicketIfBothLegsPaid, makeFeeSettlementCheck, runPlatformFeeReconcileTick, settlePlatformFee } =
  await import('./platformFeeSettlement.js')

const PREIMAGE = '11'.repeat(32)
// sha256(0x11 * 32)
const HASH = '02d449a31fbb267c8f352e9968a79e3e5fc95c1bbeaa502fd6454ebde5a4bedc'

interface FeeRow {
  status: string
  sellerLegConfirmedAt: Date | null
  ticketStatus: string
}

function makePrisma(row: FeeRow) {
  const prisma = {
    ticketPlatformFee: {
      updateMany: vi.fn().mockImplementation(async () => {
        if (row.status !== 'PENDING') return { count: 0 }
        row.status = 'PAID'
        return { count: 1 }
      }),
      findUnique: vi.fn().mockImplementation(async () => ({
        id: 'fee-1',
        status: row.status,
        sellerLegConfirmedAt: row.sellerLegConfirmedAt,
        paymentHash: HASH,
        ticket: {
          id: 't1',
          status: row.ticketStatus,
          cooperationId: null,
          buyerPubkey: 'b',
          sellerPubkey: 's',
          visibility: 'PUBLIC',
        },
      })),
      findMany: vi.fn().mockResolvedValue([]),
    },
    ticket: {
      updateMany: vi.fn().mockImplementation(async () => {
        if (row.ticketStatus !== 'PENDING' && row.ticketStatus !== 'ACCEPTED') return { count: 0 }
        row.ticketStatus = 'PAID'
        return { count: 1 }
      }),
    },
  }
  return prisma as unknown as PrismaClient & typeof prisma
}

beforeEach(() => vi.clearAllMocks())

describe('settlePlatformFee (ADR-394 FU-838)', () => {
  it('books the fee but keeps the ticket unpaid while the seller leg is open', async () => {
    const row = { status: 'PENDING', sellerLegConfirmedAt: null, ticketStatus: 'PENDING' }
    const prisma = makePrisma(row)
    await expect(settlePlatformFee(prisma, 'fee-1')).resolves.toEqual(['fee:fee-1:PAID'])
    expect(row.ticketStatus).toBe('PENDING')
    expect(enqueueProvisioningOnPaid).not.toHaveBeenCalled()
  })

  it('flips the ticket once when both legs are done', async () => {
    const row = { status: 'PENDING', sellerLegConfirmedAt: new Date(), ticketStatus: 'PENDING' }
    const prisma = makePrisma(row)
    await expect(settlePlatformFee(prisma, 'fee-1')).resolves.toEqual(['fee:fee-1:PAID', 'ticket:t1:PAID'])
    expect(enqueueProvisioningOnPaid).toHaveBeenCalledTimes(1)
  })

  it('is idempotent — a second settle (route racing the tick) does nothing', async () => {
    const row = { status: 'PENDING', sellerLegConfirmedAt: new Date(), ticketStatus: 'PENDING' }
    const prisma = makePrisma(row)
    await settlePlatformFee(prisma, 'fee-1')
    await expect(settlePlatformFee(prisma, 'fee-1')).resolves.toEqual([])
    expect(enqueueProvisioningOnPaid).toHaveBeenCalledTimes(1)
  })
})

describe('completeTicketIfBothLegsPaid (two-confirm healing)', () => {
  it('heals a ticket left PENDING after both legs confirmed concurrently', async () => {
    const row = { status: 'PAID', sellerLegConfirmedAt: new Date(), ticketStatus: 'PENDING' }
    await expect(completeTicketIfBothLegsPaid(makePrisma(row), 'fee-1')).resolves.toEqual(['ticket:t1:PAID'])
  })
})

describe('makeFeeSettlementCheck (ADR-394 FU-838)', () => {
  const baseFee = { rail: 'LN', paymentHash: HASH, invoice: 'lnbc1...', issuer: 'NWC', verifyUrl: null } as TicketPlatformFee

  it('trusts our own hub’s settled state', async () => {
    const nwc = { lookupInvoice: vi.fn().mockResolvedValue({ paid: true, preimage: PREIMAGE, state: 'settled' }) }
    await expect(makeFeeSettlementCheck(() => nwc as never)(baseFee)).resolves.toBe(true)
    expect(nwc.lookupInvoice).toHaveBeenCalledWith(HASH)
  })

  it('rejects a settled answer whose preimage does not match the hash', async () => {
    const nwc = { lookupInvoice: vi.fn().mockResolvedValue({ paid: true, preimage: '22'.repeat(32), state: 'settled' }) }
    await expect(makeFeeSettlementCheck(() => nwc as never)(baseFee)).resolves.toBe(false)
  })

  it('treats an unknown hash / hub error as not settled', async () => {
    const nwc = { lookupInvoice: vi.fn().mockRejectedValue(new Error('NOT_FOUND')) }
    await expect(makeFeeSettlementCheck(() => nwc as never)(baseFee)).resolves.toBe(false)
  })

  it('logs a loud config-defect error for a scope-restricted hub and stays unsettled', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const nwc = {
      lookupInvoice: vi.fn().mockRejectedValue(new Error('This app does not have the required scope: lookup_invoice')),
    }
    await expect(makeFeeSettlementCheck(() => nwc as never)(baseFee)).resolves.toBe(false)
    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('lookup_invoice scope'),
      expect.anything(),
      expect.anything(),
    )
    errSpy.mockRestore()
  })

  it('cannot settle without a hub or for non-LN rails', async () => {
    await expect(makeFeeSettlementCheck(() => null)(baseFee)).resolves.toBe(false)
    await expect(makeFeeSettlementCheck(() => null)({ ...baseFee, rail: 'DEMO' })).resolves.toBe(false)
  })

  it('needs a LUD-21 verify URL for an LNURL-issued fee', async () => {
    await expect(makeFeeSettlementCheck(() => null)({ ...baseFee, issuer: 'LNURL', verifyUrl: null })).resolves.toBe(false)
  })
})

describe('runPlatformFeeReconcileTick (ADR-394 FU-838)', () => {
  it('settles PENDING LN fees the check reports as paid', async () => {
    const row = { status: 'PENDING', sellerLegConfirmedAt: new Date(), ticketStatus: 'PENDING' }
    const prisma = makePrisma(row)
    prisma.ticketPlatformFee.findMany
      .mockResolvedValueOnce([]) // no stuck rows
      .mockResolvedValueOnce([{ id: 'fee-1', rail: 'LN', paymentHash: HASH }])
    const check = vi.fn().mockResolvedValue(true)
    await expect(runPlatformFeeReconcileTick(prisma, { check })).resolves.toEqual(['fee:fee-1:PAID', 'ticket:t1:PAID'])
  })

  it('leaves unpaid fees alone and survives a failing check', async () => {
    const row = { status: 'PENDING', sellerLegConfirmedAt: null, ticketStatus: 'PENDING' }
    const prisma = makePrisma(row)
    prisma.ticketPlatformFee.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'fee-1' }, { id: 'fee-2' }])
    const check = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(false)
    await expect(runPlatformFeeReconcileTick(prisma, { check })).resolves.toEqual([])
    expect(row.status).toBe('PENDING')
  })
})
