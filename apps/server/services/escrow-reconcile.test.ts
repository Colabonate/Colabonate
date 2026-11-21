import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient, Ticket } from '@prisma/client'
import type { PaymentProvider } from '@col/payments'

vi.mock('./nostr-relay.js', () => ({
  nostrService: { publishTicketStatus: vi.fn() },
}))

const confirmPaymentByHash = vi.fn().mockResolvedValue([])
vi.mock('./paymentConfirmation.js', () => ({
  confirmPaymentByHash: (...args: unknown[]) => confirmPaymentByHash(...args),
}))

const { reconcileHoldInvoiceStates } = await import('./escrow-reconcile.js')

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'ticket-1',
    escrowStatus: 'PHASE_1_PENDING',
    escrowPhase1Hash: 'hash1',
    escrowPhase2Hash: null,
    escrowPhase3Hash: null,
    offer: null,
    ...overrides,
  } as unknown as Ticket
}

function makeMockPrisma(tickets: Ticket[]) {
  return {
    ticket: {
      findMany: vi.fn().mockResolvedValue(tickets),
    },
  } as unknown as PrismaClient
}

describe('reconcileHoldInvoiceStates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries only tickets in a *_PENDING escrow phase', async () => {
    const prisma = makeMockPrisma([])
    const payments = { getHoldState: vi.fn() } as unknown as PaymentProvider

    await reconcileHoldInvoiceStates(prisma, payments)

    expect(prisma.ticket.findMany).toHaveBeenCalledWith({
      where: { escrowStatus: { in: ['PHASE_1_PENDING', 'PHASE_2_PENDING', 'PHASE_3_PENDING'] } },
      include: { offer: true },
    })
  })

  it('confirms payment when the hold invoice is accepted/paid on Lightning', async () => {
    const ticket = makeTicket({ escrowStatus: 'PHASE_1_PENDING', escrowPhase1Hash: 'hash1' })
    const prisma = makeMockPrisma([ticket])
    const payments = {
      getHoldState: vi.fn().mockResolvedValue({ status: 'paid', preimage: 'pre1' }),
    } as unknown as PaymentProvider

    await reconcileHoldInvoiceStates(prisma, payments)

    expect(payments.getHoldState).toHaveBeenCalledWith('hash1')
    expect(confirmPaymentByHash).toHaveBeenCalledWith(prisma, 'hash1', expect.objectContaining({ preimage: 'pre1' }))
  })

  it('does nothing when the hold invoice is still pending', async () => {
    const ticket = makeTicket({ escrowStatus: 'PHASE_2_PENDING', escrowPhase1Hash: null, escrowPhase2Hash: 'hash2' })
    const prisma = makeMockPrisma([ticket])
    const payments = {
      getHoldState: vi.fn().mockResolvedValue({ status: 'pending' }),
    } as unknown as PaymentProvider

    await reconcileHoldInvoiceStates(prisma, payments)

    expect(payments.getHoldState).toHaveBeenCalledWith('hash2')
    expect(confirmPaymentByHash).not.toHaveBeenCalled()
  })

  it('skips tickets whose provider does not support hold invoices', async () => {
    const ticket = makeTicket()
    const prisma = makeMockPrisma([ticket])
    const payments = {} as unknown as PaymentProvider // no getHoldState

    await expect(reconcileHoldInvoiceStates(prisma, payments)).resolves.not.toThrow()
    expect(confirmPaymentByHash).not.toHaveBeenCalled()
  })

  it('does not let one ticket erroring stop reconciliation of the rest', async () => {
    const ticketA = makeTicket({ id: 'ticket-a', escrowPhase1Hash: 'hash-a' })
    const ticketB = makeTicket({ id: 'ticket-b', escrowPhase1Hash: 'hash-b' })
    const prisma = makeMockPrisma([ticketA, ticketB])
    const payments = {
      getHoldState: vi.fn()
        .mockRejectedValueOnce(new Error('LND unreachable'))
        .mockResolvedValueOnce({ status: 'paid', preimage: 'pre-b' }),
    } as unknown as PaymentProvider

    await reconcileHoldInvoiceStates(prisma, payments)

    expect(payments.getHoldState).toHaveBeenCalledTimes(2)
    expect(confirmPaymentByHash).toHaveBeenCalledWith(prisma, 'hash-b', expect.objectContaining({ preimage: 'pre-b' }))
  })
})
