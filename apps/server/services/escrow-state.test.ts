import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { casTicketUpdate } from './escrow-state.js'

function makeMockPrisma(count: number) {
  return {
    ticket: {
      updateMany: vi.fn().mockResolvedValue({ count }),
    },
  } as unknown as PrismaClient
}

describe('casTicketUpdate', () => {
  it('returns true and writes when the ticket is still in the expected state', async () => {
    const prisma = makeMockPrisma(1)

    const ok = await casTicketUpdate(prisma, 'ticket-1', 'DELIVERY_CONFIRMED', { escrowStatus: 'RELEASED' })

    expect(ok).toBe(true)
    expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
      where: { id: 'ticket-1', escrowStatus: 'DELIVERY_CONFIRMED' },
      data: { escrowStatus: 'RELEASED' },
    })
  })

  it('returns false when a concurrent write already moved the ticket out of the expected state', async () => {
    const prisma = makeMockPrisma(0)

    const ok = await casTicketUpdate(prisma, 'ticket-1', 'DELIVERY_CONFIRMED', { escrowStatus: 'RELEASED' })

    expect(ok).toBe(false)
  })

  it('builds an `in` filter when the expected state is an array', async () => {
    const prisma = makeMockPrisma(1)

    await casTicketUpdate(prisma, 'ticket-1', ['DELIVERY_STARTED', 'DELIVERY_CONFIRMED'], { escrowStatus: 'DISPUTED' })

    expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
      where: { id: 'ticket-1', escrowStatus: { in: ['DELIVERY_STARTED', 'DELIVERY_CONFIRMED'] } },
      data: { escrowStatus: 'DISPUTED' },
    })
  })
})
