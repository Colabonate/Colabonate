import { describe, expect, it, vi } from 'vitest'

const decodeInvoice = vi.fn()
vi.mock('@getalby/lightning-tools', () => ({ decodeInvoice: (...a: unknown[]) => decodeInvoice(...a) }))

const { InsufficientStockError, isStockReleasable, releaseTicketStock, reserveOfferStock } = await import('./ticketStock.js')
import type { PrismaClient } from '@prisma/client'

const NOW = new Date('2026-09-24T12:00:00Z')
const nowS = NOW.getTime() / 1000

function candidate(over: Partial<Parameters<typeof isStockReleasable>[0]> = {}) {
  return {
    status: 'PENDING',
    createdAt: new Date(NOW.getTime() - 60_000),
    directPayRail: 'LN',
    escrowEnabled: false,
    lightningInvoice: 'lnbc1...',
    ...over,
  }
}

describe('isStockReleasable (ADR-394 FU-841)', () => {
  it('always releases cancelled / refunded tickets', () => {
    expect(isStockReleasable(candidate({ status: 'CANCELLED' }), NOW)).toBe(true)
    expect(isStockReleasable(candidate({ status: 'REFUNDED', escrowEnabled: true }), NOW)).toBe(true)
  })

  it('never releases sold units', () => {
    for (const status of ['PAID', 'IN_PROGRESS', 'COMPLETED', 'DISPUTED']) {
      expect(isStockReleasable(candidate({ status }), NOW)).toBe(false)
    }
  })

  it('releases an unpaid LN ticket only after its invoice expired plus grace', () => {
    decodeInvoice.mockReturnValue({ timestamp: nowS - 3600 - 10 * 60, expiry: 3600 }) // expired 10 min ago
    expect(isStockReleasable(candidate(), NOW)).toBe(false)
    decodeInvoice.mockReturnValue({ timestamp: nowS - 3600 - 20 * 60, expiry: 3600 }) // expired 20 min ago
    expect(isStockReleasable(candidate(), NOW)).toBe(true)
  })

  it('uses the BOLT11 default expiry when the invoice has none', () => {
    decodeInvoice.mockReturnValue({ timestamp: nowS - 2 * 3600, expiry: undefined })
    expect(isStockReleasable(candidate(), NOW)).toBe(true)
  })

  it('keeps the reservation when the LN invoice cannot be decoded', () => {
    decodeInvoice.mockReturnValue(null)
    expect(isStockReleasable(candidate(), NOW)).toBe(false)
  })

  it('leaves unpaid escrow tickets to the escrow timeout', () => {
    expect(isStockReleasable(candidate({ escrowEnabled: true, directPayRail: null }), NOW)).toBe(false)
  })

  it('releases unpaid Cashu / DEMO tickets after the max pending age', () => {
    const young = candidate({ directPayRail: 'CASHU', lightningInvoice: null })
    const old = candidate({ directPayRail: 'DEMO', lightningInvoice: null, createdAt: new Date(NOW.getTime() - 25 * 3600_000) })
    expect(isStockReleasable(young, NOW)).toBe(false)
    expect(isStockReleasable(old, NOW)).toBe(true)
    expect(isStockReleasable(young, NOW, 30_000)).toBe(true)
  })
})

describe('reserveOfferStock (ADR-394 FU-841)', () => {
  it('reserves nothing for unlimited stock', async () => {
    const tx = { offer: { updateMany: vi.fn(), findUnique: vi.fn() } }
    await expect(reserveOfferStock(tx as never, 'o1', null, 3)).resolves.toBe(0)
    expect(tx.offer.updateMany).not.toHaveBeenCalled()
  })

  it('decrements with a compare-and-swap on the remaining stock', async () => {
    const tx = { offer: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn() } }
    await expect(reserveOfferStock(tx as never, 'o1', 5, 3)).resolves.toBe(3)
    expect(tx.offer.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', stock: { gte: 3 } },
      data: { stock: { decrement: 3 } },
    })
  })

  it('throws InsufficientStockError when a concurrent purchase took the units', async () => {
    const tx = {
      offer: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue({ stock: 1 }),
      },
    }
    const err = await reserveOfferStock(tx as never, 'o1', 5, 3).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(InsufficientStockError)
    expect(err).toMatchObject({ availableStock: 1, requestedQuantity: 3 })
  })
})

describe('releaseTicketStock (ADR-394 FU-841)', () => {
  function makePrisma(ticketCount: number) {
    const tx = {
      ticket: { updateMany: vi.fn().mockResolvedValue({ count: ticketCount }) },
      offer: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    }
    const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) }
    return { prisma: prisma as unknown as PrismaClient, tx }
  }

  it('zeroes the reservation first, then returns the units to finite stock', async () => {
    const { prisma, tx } = makePrisma(1)
    await expect(releaseTicketStock(prisma, 't1', 3, 'o1')).resolves.toBe(true)
    expect(tx.ticket.updateMany).toHaveBeenCalledWith({ where: { id: 't1', stockReserved: 3 }, data: { stockReserved: 0 } })
    expect(tx.offer.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', stock: { not: null } },
      data: { stock: { increment: 3 } },
    })
  })

  it('is idempotent — a lost CAS never double-releases', async () => {
    const { prisma, tx } = makePrisma(0)
    await expect(releaseTicketStock(prisma, 't1', 3, 'o1')).resolves.toBe(false)
    expect(tx.offer.updateMany).not.toHaveBeenCalled()
  })
})
