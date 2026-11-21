import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

import {
  notifyTicketCreated,
  notifyTicketStatusChange,
  notifyCooperationStatusChange,
  notifyDisputeOpened,
  notifyVerdictIssued,
  notifyArbiterNominated,
  notifyArbiterAccepted,
  pruneNotifications,
} from './notifications.js'

function makeMockPrisma() {
  return {
    notification: {
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

describe('notifications service', () => {
  let prisma: PrismaClient

  beforeEach(() => {
    prisma = makeMockPrisma()
    vi.clearAllMocks()
  })

  it('notifyTicketCreated writes a notification for the seller', async () => {
    await notifyTicketCreated(prisma, {
      ticketId: 'ticket-12345678',
      sellerPubkey: 'seller',
      buyerPubkey: 'buyer',
      offerTitle: 'Design work',
    })
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerPubkey: 'seller',
        type: 'ticket',
        title: 'New ticket received',
        relatedId: 'ticket-12345678',
      }),
    })
  })

  it('notifyTicketCreated skips self-purchase (seller === buyer)', async () => {
    await notifyTicketCreated(prisma, {
      ticketId: 'ticket-1',
      sellerPubkey: 'same',
      buyerPubkey: 'same',
    })
    expect(prisma.notification.create).not.toHaveBeenCalled()
  })

  it('notifyTicketStatusChange notifies the non-acting party', async () => {
    await notifyTicketStatusChange(prisma, {
      ticketId: 'ticket-1',
      fromStatus: 'ACCEPTED',
      toStatus: 'IN_PROGRESS',
      buyerPubkey: 'buyer',
      sellerPubkey: 'seller',
      actingPubkey: 'seller',
    })
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerPubkey: 'buyer',
        title: 'Work started',
      }),
    })
  })

  it('notifyTicketStatusChange resolves the seller owner when the buyer acts', async () => {
    await notifyTicketStatusChange(prisma, {
      ticketId: 'ticket-1',
      fromStatus: 'PENDING',
      toStatus: 'COMPLETED',
      buyerPubkey: 'buyer',
      sellerPubkey: 'seller',
      actingPubkey: 'buyer',
    })
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerPubkey: 'seller',
        title: 'Order completed',
      }),
    })
  })

  it('notifyCooperationStatusChange notifies the partner when the initiator acts', async () => {
    await notifyCooperationStatusChange(prisma, {
      cooperationId: 'coop-1',
      fromStatus: 'OPEN',
      toStatus: 'ACCEPTED',
      initiatorPubkey: 'initiator',
      partnerPubkey: 'partner',
      actingPubkey: 'initiator',
      title: 'Launch site',
    })
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerPubkey: 'partner',
        type: 'cooperation',
        title: 'Cooperation accepted',
      }),
    })
  })

  it('notifyCooperationStatusChange skips when there is no partner yet', async () => {
    await notifyCooperationStatusChange(prisma, {
      cooperationId: 'coop-1',
      fromStatus: 'OPEN',
      toStatus: 'ACCEPTED',
      initiatorPubkey: 'initiator',
      partnerPubkey: null,
      actingPubkey: 'initiator',
    })
    expect(prisma.notification.create).not.toHaveBeenCalled()
  })

  it('notifyDisputeOpened notifies the non-opening party', async () => {
    await notifyDisputeOpened(prisma, {
      ticketId: 'ticket-1',
      buyerPubkey: 'buyer',
      sellerPubkey: 'seller',
      openedByPubkey: 'buyer',
      offerTitle: 'Design work',
    })
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerPubkey: 'seller',
        type: 'dispute',
        title: 'Dispute opened',
      }),
    })
  })

  it('notifyVerdictIssued notifies both disputants (RELEASE)', async () => {
    await notifyVerdictIssued(prisma, {
      ticketId: 'ticket-1',
      buyerPubkey: 'buyer',
      sellerPubkey: 'seller',
      outcome: 'RELEASE',
      offerTitle: 'Design work',
    })
    expect(prisma.notification.create).toHaveBeenCalledTimes(2)
    const owners = vi.mocked(prisma.notification.create).mock.calls.map(c => (c[0] as { data: { ownerPubkey: string } }).data.ownerPubkey)
    expect(owners).toEqual(expect.arrayContaining(['buyer', 'seller']))
  })

  it('notifyVerdictIssued skips self-trades', async () => {
    await notifyVerdictIssued(prisma, {
      ticketId: 'ticket-1',
      buyerPubkey: 'same',
      sellerPubkey: 'same',
      outcome: 'CANCEL',
    })
    expect(prisma.notification.create).toHaveBeenCalledTimes(0)
  })

  it('notifyArbiterNominated notifies the non-nominating party', async () => {
    await notifyArbiterNominated(prisma, {
      ticketId: 'ticket-1',
      buyerPubkey: 'buyer',
      sellerPubkey: 'seller',
      nominatorPubkey: 'buyer',
      arbiterPubkey: 'arbiter',
    })
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerPubkey: 'seller',
        type: 'dispute',
        title: 'Arbiter nominated',
      }),
    })
  })

  it('notifyArbiterAccepted notifies both disputants', async () => {
    await notifyArbiterAccepted(prisma, {
      ticketId: 'ticket-1',
      buyerPubkey: 'buyer',
      sellerPubkey: 'seller',
      arbiterPubkey: 'arbiter',
    })
    expect(prisma.notification.create).toHaveBeenCalledTimes(2)
  })

  it('pruneNotifications deletes archived+old and read+old only', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 3 })
    const mockPrisma = { notification: { deleteMany } } as unknown as PrismaClient
    const now = new Date('2026-09-07T00:00:00Z')
    const res = await pruneNotifications(mockPrisma, { now, archivedRetentionDays: 30, readRetentionDays: 180 })
    expect(res.deleted).toBe(3)
    const where = deleteMany.mock.calls[0][0].where as { OR: unknown[] }
    expect(where.OR).toHaveLength(2)
  })
})
