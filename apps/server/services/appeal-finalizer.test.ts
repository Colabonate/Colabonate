import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient, Dispute, Ticket, DaoConfig, ArbitrationVerdict } from '@prisma/client'

type MockDispute = Dispute & { ticket: Ticket; verdicts: ArbitrationVerdict[]; dao: { config: DaoConfig } }
import type { PaymentProvider } from '@col/payments'
import { runAppealFinalizerTick } from './appeal-finalizer.js'

type MockDisputeOverrides = Partial<Omit<MockDispute, 'ticket' | 'dao' | 'verdicts'>> & {
  ticket?: Partial<Ticket>
  dao?: { config?: Partial<DaoConfig> }
  verdicts?: ArbitrationVerdict[]
}

function makeMockDispute(overrides: MockDisputeOverrides): MockDispute {
  const ticketId = `ticket-${Math.random().toString(36).slice(2)}`
  const daoId = 'colabonate-foundation'
  const disputeId = `dispute-${Math.random().toString(36).slice(2)}`
  const base: MockDispute = {
    id: disputeId,
    disputeId,
    ticketId,
    daoId,
    status: 'RESOLVED_PENDING',
    outcome: null,
    openedAt: new Date(),
    resolvedAt: null,
    arbitratorPubkey: null,
    escalatedAt: null,
    quorumTypeSnapshot: 'MAJORITY',
    thresholdNSnapshot: 2,
    verdictIssuedAt: new Date(),
    disclosureDeadline: null,
    ticket: {
      id: ticketId,
      offerId: 'offer-1',
      buyerPubkey: 'buyer-1',
      sellerPubkey: 'seller-1',
      status: 'DISPUTED',
      offerType: 'SERVICE',
      lightningInvoice: null,
      paymentHash: null,
      amountSats: 1000,
      disputeReason: null,
      nostrEventId: null,
      preimage: null,
      ticketType: 'DISPUTE',
      escrowStatus: 'DISPUTED',
      phase1Invoice: null,
      phase2Invoice: null,
      phase3Invoice: null,
      escrowPhase1Hash: 'hash1',
      escrowPhase2Hash: 'hash2',
      escrowPhase3Hash: null,
      escrowPhase1Preimage: 'pre1',
      escrowPhase2Preimage: 'pre2',
      escrowPhase3Preimage: null,
      deliveryConfirmedAt: null,
      milestones: [],
      deliveryAddress: null,
      deliveryTimeDays: null,
      deliveryCostSats: null,
      totalHours: null,
      deliveryNotes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Ticket,
    dao: {
      config: {
        daoId,
        quorumType: 'MAJORITY',
        thresholdN: 2,
        coolingOffDays: 7,
        mediationDays: 14,
        verdictDeadlineHours: 48,
        appealWindowHours: 72,
        appealQuorumType: null,
        appealThresholdN: null,
      } as unknown as DaoConfig,
    },
    verdicts: [] as ArbitrationVerdict[],
  }
  const { ticket: ticketOverrides, dao: daoOverrides, verdicts: verdictOverrides, ...disputeOverrides } = overrides
  return {
    ...base,
    ...disputeOverrides,
    ticket: { ...base.ticket, ...(ticketOverrides ?? {}) } as Ticket,
    dao: { config: { ...base.dao.config, ...(daoOverrides?.config ?? {}) } as DaoConfig },
    verdicts: verdictOverrides ?? base.verdicts,
  }
}

function makeMockPrisma(disputes: MockDispute[]): Pick<PrismaClient, 'dispute' | 'ticket'> {
  return {
    dispute: {
      findMany: vi.fn().mockResolvedValue(disputes),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
        return disputes.find(d => d.id === where.id) ?? null
      }),
    },
    ticket: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  } as unknown as Pick<PrismaClient, 'dispute' | 'ticket'>
}

function makeMockPayments() {
  return {
    settleHoldInvoice: vi.fn().mockResolvedValue(undefined),
    cancelHoldInvoice: vi.fn().mockResolvedValue(undefined),
  } as unknown as PaymentProvider
}

describe('runAppealFinalizerTick', () => {
  let mockPayments: PaymentProvider

  beforeEach(() => {
    vi.clearAllMocks()
    mockPayments = makeMockPayments()
  })

  it('RESOLVED_PENDING with expired window → status becomes RESOLVED, escrow settles RELEASE', async () => {
    const now = new Date()
    const verdictIssuedAt = new Date(now.getTime() - 73 * 3600_000)

    const dispute = makeMockDispute({
      verdictIssuedAt,
      outcome: 'RELEASE',
      verdicts: [
        { id: 'v1', verdictId: 'vv1', disputeId: '', arbitratorPubkey: 'a1', outcome: 'RELEASE', reasoning: null, evidenceEventIds: null, createdAt: new Date(), round: 1 } as ArbitrationVerdict,
      ],
      ticket: {
        escrowPhase1Preimage: 'pre1',
        escrowPhase2Preimage: 'pre2',
        escrowPhase3Preimage: null,
        escrowPhase1Hash: null,
        escrowPhase2Hash: null,
        escrowPhase3Hash: null,
        escrowStatus: 'DISPUTED',
        status: 'DISPUTED',
        id: 'ticket-1',
        offerId: 'offer-1',
        buyerPubkey: 'buyer-1',
        sellerPubkey: 'seller-1',
        ticketType: 'DISPUTE',
        offerType: 'SERVICE',
      },
    })

    const mockPrisma = makeMockPrisma([dispute])

    await runAppealFinalizerTick(mockPrisma as unknown as PrismaClient, mockPayments, now)

    expect(mockPrisma.dispute.updateMany).toHaveBeenCalledWith({
      where: { id: dispute.id, status: 'RESOLVED_PENDING' },
      data: { status: 'RESOLVED', resolvedAt: expect.any(Date) },
    })
    expect(mockPayments.settleHoldInvoice).toHaveBeenCalledTimes(2)
    expect(mockPayments.settleHoldInvoice).toHaveBeenCalledWith('pre1')
    expect(mockPayments.settleHoldInvoice).toHaveBeenCalledWith('pre2')
    expect(mockPayments.cancelHoldInvoice).not.toHaveBeenCalled()
  })

  it('RESOLVED_PENDING with expired window → CANCEL → escrow cancelled', async () => {
    const now = new Date()
    const verdictIssuedAt = new Date(now.getTime() - 73 * 3600_000)

    const dispute = makeMockDispute({
      verdictIssuedAt,
      outcome: 'CANCEL',
      verdicts: [
        { id: 'v1', verdictId: 'vv1', disputeId: '', arbitratorPubkey: 'a1', outcome: 'CANCEL', reasoning: null, evidenceEventIds: null, createdAt: new Date(), round: 1 } as ArbitrationVerdict,
      ],
      ticket: {
        escrowPhase1Hash: 'hash1',
        escrowPhase2Hash: 'hash2',
        escrowPhase3Hash: null,
        escrowPhase1Preimage: null,
        escrowPhase2Preimage: null,
        escrowPhase3Preimage: null,
        escrowStatus: 'DISPUTED',
        status: 'DISPUTED',
        id: 'ticket-1',
        offerId: 'offer-1',
        buyerPubkey: 'buyer-1',
        sellerPubkey: 'seller-1',
        ticketType: 'DISPUTE',
        offerType: 'SERVICE',
      },
    })

    const mockPrisma = makeMockPrisma([dispute])

    await runAppealFinalizerTick(mockPrisma as unknown as PrismaClient, mockPayments, now)

    expect(mockPayments.cancelHoldInvoice).toHaveBeenCalledTimes(2)
    expect(mockPayments.cancelHoldInvoice).toHaveBeenCalledWith('hash1')
    expect(mockPayments.cancelHoldInvoice).toHaveBeenCalledWith('hash2')
  })

  it('RESOLVED_PENDING with fresh window → no-op', async () => {
    const now = new Date()
    const verdictIssuedAt = new Date(now.getTime() - 1 * 3600_000)

    const dispute = makeMockDispute({
      verdictIssuedAt,
      verdicts: [],
      ticket: {},
    })

    const mockPrisma = makeMockPrisma([dispute])

    await runAppealFinalizerTick(mockPrisma as unknown as PrismaClient, mockPayments, now)

    expect(mockPrisma.dispute.updateMany).not.toHaveBeenCalled()
    expect(mockPayments.settleHoldInvoice).not.toHaveBeenCalled()
    expect(mockPayments.cancelHoldInvoice).not.toHaveBeenCalled()
  })

  it('Running twice on same expired dispute → idempotent, escrow settled only once', async () => {
    const now = new Date()
    const verdictIssuedAt = new Date(now.getTime() - 73 * 3600_000)

    const dispute = makeMockDispute({
      verdictIssuedAt,
      outcome: 'RELEASE',
      verdicts: [
        { id: 'v1', verdictId: 'vv1', disputeId: '', arbitratorPubkey: 'a1', outcome: 'RELEASE', reasoning: null, evidenceEventIds: null, createdAt: new Date(), round: 1 } as ArbitrationVerdict,
      ],
      ticket: {
        escrowPhase1Preimage: 'pre1',
        escrowPhase2Preimage: null,
        escrowPhase3Preimage: null,
        escrowStatus: 'DISPUTED',
        status: 'DISPUTED',
        id: 'ticket-1',
        offerId: 'offer-1',
        buyerPubkey: 'buyer-1',
        sellerPubkey: 'seller-1',
        ticketType: 'DISPUTE',
        offerType: 'SERVICE',
      },
    })

    const updateManyMock = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    const mockPrisma = makeMockPrisma([dispute])
    ;(mockPrisma.dispute.updateMany as ReturnType<typeof vi.fn>).mockImplementation(updateManyMock)

    await runAppealFinalizerTick(mockPrisma as unknown as PrismaClient, mockPayments, now)
    await runAppealFinalizerTick(mockPrisma as unknown as PrismaClient, mockPayments, now)

    expect(updateManyMock).toHaveBeenCalledTimes(2)
    expect(mockPayments.settleHoldInvoice).toHaveBeenCalledTimes(1)
    expect(mockPayments.settleHoldInvoice).toHaveBeenCalledWith('pre1')
  })

  it('appealWindowHours = 0 → skipped (appeal disabled in SINGLE-quorum bootstrap)', async () => {
    const now = new Date()
    const verdictIssuedAt = new Date(now.getTime() - 100 * 3600_000)

    const dispute = makeMockDispute({
      verdictIssuedAt,
      verdicts: [],
      dao: {
        config: {
          daoId: 'colabonate-foundation',
          quorumType: 'SINGLE',
          thresholdN: 1,
          coolingOffDays: 7,
          mediationDays: 14,
          verdictDeadlineHours: 48,
          appealWindowHours: 0,
          appealQuorumType: null,
          appealThresholdN: null,
        },
      },
      ticket: {},
    })

    const mockPrisma = makeMockPrisma([dispute])

    await runAppealFinalizerTick(mockPrisma as unknown as PrismaClient, mockPayments, now)

    expect(mockPrisma.dispute.updateMany).not.toHaveBeenCalled()
  })
})
