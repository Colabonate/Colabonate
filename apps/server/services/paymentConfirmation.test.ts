// ADR-372 D7.3: two-confirm gating in the shared payment-confirmation path.
// The seller leg of a doop-hosted ticket must NOT flip the ticket to PAID (and
// must NOT enqueue provisioning) while its hosted-canvas fee row is still
// PENDING — the last leg to confirm (seller or fee) triggers PAID.
import { describe, expect, it, vi, beforeEach } from 'vitest'

const enqueueProvisioningOnPaid = vi.fn().mockResolvedValue(false)
vi.mock('./canvas-provisioning.js', () => ({
  enqueueProvisioningOnPaid: (...args: unknown[]) => enqueueProvisioningOnPaid(...args),
}))

const notifySellerLegConfirmed = vi.fn().mockResolvedValue(undefined)
vi.mock('./notifications.js', () => ({
  notifySellerLegConfirmed: (...args: unknown[]) => notifySellerLegConfirmed(...args),
  notifyTicketStatusChange: vi.fn().mockResolvedValue(undefined),
  notifyCooperationStatusChange: vi.fn().mockResolvedValue(undefined),
  createNotification: vi.fn().mockResolvedValue(undefined),
}))

import type { PrismaClient, Ticket } from '@prisma/client'
import { confirmPaymentByHash } from './paymentConfirmation.js'

function makePrisma(feeStatus: 'PENDING' | 'PAID' | null) {
  const ticket = {
    id: 't1',
    status: 'PENDING',
    offerType: 'AGENT_SETUP',
    canvasProvider: 'doop-hosted',
    canvasProvisioningStatus: null,
    buyerPubkey: 'buyer',
    sellerPubkey: 'seller',
    cooperationId: null,
    visibility: 'PUBLIC',
    escrowStatus: null,
    platformFee: feeStatus === null ? null : { id: 'fee-1', status: feeStatus, amountSats: 2600 },
    offer: { phase2WindowHours: 72, title: 'Agent Setup Listing' },
  } as unknown as Ticket & { platformFee: { id: string; status: string; amountSats: number } | null }

  const prisma = {
    ticket: {
      findMany: vi.fn().mockResolvedValue([ticket]),
      update: vi.fn().mockImplementation((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 't1', escrowStatus: null, visibility: 'PUBLIC', ...args.data }),
      ),
      // ADR-394: PENDING|ACCEPTED → PAID is now a compare-and-swap updateMany.
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    ticketPlatformFee: {
      update: vi.fn().mockResolvedValue({ id: 'fee-1', sellerLegConfirmedAt: new Date() }),
      // ADR-413 D4: the seller leg is stamped once — the CAS decides whether
      // this call is the transition (notify) or a repeat (no notify).
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    cooperation: { findMany: vi.fn().mockResolvedValue([]) },
    coopMilestone: { findMany: vi.fn().mockResolvedValue([]) },
  }

  return prisma as unknown as PrismaClient & {
    ticket: {
      findMany: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
      updateMany: ReturnType<typeof vi.fn>
    }
    ticketPlatformFee: { update: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> }
  }
}

beforeEach(() => {
  // A fresh prisma stub is built per test; this only resets the SHARED module
  // mocks (enqueueProvisioningOnPaid, notifySellerLegConfirmed) so
  // "not.toHaveBeenCalled()" assertions are scoped to their own test.
  vi.clearAllMocks()
})

describe('confirmPaymentByHash — ADR-372 two-confirm gate', () => {
  it('does NOT flip PAID when the hosted-canvas fee is still PENDING — records the seller leg only', async () => {
    const prisma = makePrisma('PENDING')

    const updated = await confirmPaymentByHash(prisma, 'hash1', { preimage: 'pre1' })

    expect(updated).toEqual(['ticket:t1:SELLER_LEG_CONFIRMED'])
    // Seller-leg preimage persisted (compare-and-swap on the unset column).
    expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
      where: { id: 't1', preimage: null },
      data: { preimage: 'pre1' },
    })
    // Fee row records the seller-leg confirmation — once.
    expect(prisma.ticketPlatformFee.updateMany).toHaveBeenCalledWith({
      where: { id: 'fee-1', sellerLegConfirmedAt: null },
      data: { sellerLegConfirmedAt: expect.any(Date) },
    })
    // No provisioning enqueue while the fee is open.
    expect(enqueueProvisioningOnPaid).not.toHaveBeenCalled()
  })

  it('notifies the seller exactly once when the seller leg is confirmed', async () => {
    const prisma = makePrisma('PENDING')

    await confirmPaymentByHash(prisma, 'hash1', { preimage: 'pre1' })

    expect(notifySellerLegConfirmed).toHaveBeenCalledTimes(1)
    expect(notifySellerLegConfirmed).toHaveBeenCalledWith(prisma, {
      ticketId: 't1',
      sellerPubkey: 'seller',
      buyerPubkey: 'buyer',
      offerTitle: 'Agent Setup Listing',
      feeSats: 2600,
    })
  })

  it('does not re-notify the seller on a repeated confirm of the same seller leg', async () => {
    const prisma = makePrisma('PENDING')
    // The seller leg was already stamped — the CAS matches nothing.
    prisma.ticketPlatformFee.updateMany.mockResolvedValue({ count: 0 })

    const updated = await confirmPaymentByHash(prisma, 'hash1', { preimage: 'pre1' })

    expect(updated).toEqual([])
    expect(notifySellerLegConfirmed).not.toHaveBeenCalled()
    expect(enqueueProvisioningOnPaid).not.toHaveBeenCalled()
  })

  it('flips PAID + enqueues provisioning when the fee is already PAID (seller leg is last)', async () => {
    const prisma = makePrisma('PAID')

    const updated = await confirmPaymentByHash(prisma, 'hash1', { preimage: 'pre1' })

    expect(updated).toEqual(['ticket:t1:PAID'])
    expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
      where: { id: 't1', status: { in: ['PENDING', 'ACCEPTED'] } },
      data: { status: 'PAID', preimage: 'pre1' },
    })
    expect(enqueueProvisioningOnPaid).toHaveBeenCalledWith(prisma, 't1')
  })

  it('keeps the pre-existing single-confirm behavior for non-hosted tickets (no fee row)', async () => {
    const prisma = makePrisma(null)

    const updated = await confirmPaymentByHash(prisma, 'hash1', { preimage: 'pre1' })

    expect(updated).toEqual(['ticket:t1:PAID'])
    expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
      where: { id: 't1', status: { in: ['PENDING', 'ACCEPTED'] } },
      data: { status: 'PAID', preimage: 'pre1' },
    })
    expect(enqueueProvisioningOnPaid).toHaveBeenCalledWith(prisma, 't1')
  })

  it('does nothing (no PAID side-effects) when another confirm already left the pre-payment state (ADR-394 CAS)', async () => {
    const prisma = makePrisma(null)
    prisma.ticket.updateMany.mockResolvedValue({ count: 0 })

    const updated = await confirmPaymentByHash(prisma, 'hash1', { preimage: 'pre1' })

    expect(updated).toEqual(['ticket:t1:SKIPPED_ALREADY_PAID'])
    expect(enqueueProvisioningOnPaid).not.toHaveBeenCalled()
  })
})
