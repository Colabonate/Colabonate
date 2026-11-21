import { decodeInvoice } from '@getalby/lightning-tools'
import type { Prisma, PrismaClient } from '@prisma/client'

/**
 * ADR-394 FU-841: offer stock is RESERVED when a ticket is created and
 * RELEASED once that ticket can no longer turn into a sale.
 *
 * Reserve: a compare-and-swap decrement (`stock >= quantity`) inside the same
 * transaction as the ticket row, so two buyers racing for the last unit can
 * never both get a ticket. Decrementing on PAID instead was rejected — at that
 * point the buyer has already paid and an oversell can no longer be refused.
 *
 * Release: ONE tick (`runTicketStockReleaseTick`) instead of hooks in the ~7
 * places that write CANCELLED (PATCH route, escrow cancel/timeout, dispute and
 * private verdicts, appeal finalizer, Nostr listener). The tick is idempotent:
 * `Ticket.stockReserved` is CAS-zeroed before the stock is given back.
 */

export class InsufficientStockError extends Error {
  constructor(
    readonly availableStock: number,
    readonly requestedQuantity: number,
  ) {
    super(`Insufficient stock: ${availableStock} available, ${requestedQuantity} requested`)
    this.name = 'InsufficientStockError'
  }
}

type StockTx = Pick<Prisma.TransactionClient, 'offer'>

/**
 * Reserve `quantity` units of an offer inside a transaction. Returns the number
 * of units reserved (0 for unlimited stock) — store it on the ticket.
 * Throws `InsufficientStockError` when the CAS loses (stock changed since the
 * route's pre-check).
 */
export async function reserveOfferStock(
  tx: StockTx,
  offerId: string,
  stock: number | null | undefined,
  quantity: number,
): Promise<number> {
  if (stock == null) return 0
  const cas = await tx.offer.updateMany({
    where: { id: offerId, stock: { gte: quantity } },
    data: { stock: { decrement: quantity } },
  })
  if (cas.count !== 1) {
    const current = await tx.offer.findUnique({ where: { id: offerId }, select: { stock: true } })
    throw new InsufficientStockError(Math.max(current?.stock ?? 0, 0), quantity)
  }
  return quantity
}

/** BOLT11 default expiry when the invoice carries no `x` field. */
const DEFAULT_INVOICE_EXPIRY_S = 3600
/**
 * Grace after an LN invoice expired before its reservation is released, so a
 * payment that settled right at expiry can still be confirmed with its units.
 */
const LN_EXPIRY_GRACE_MS = 15 * 60_000
/**
 * Unpaid tickets without an expiring LN invoice (Cashu / DEMO rail) release
 * their reservation after this age. Override: STOCK_RESERVATION_MAX_PENDING_MS.
 */
const DEFAULT_MAX_PENDING_MS = 24 * 60 * 60_000

export interface StockReleaseCandidate {
  status: string
  createdAt: Date
  directPayRail: string | null
  escrowEnabled: boolean
  lightningInvoice: string | null
}

/**
 * Pure decision: may this ticket's reservation be returned to stock now?
 * - CANCELLED / REFUNDED: always.
 * - Unpaid (PENDING / ACCEPTED) direct-pay LN: once the invoice expired
 *   (+ grace) — an expired invoice can no longer be paid.
 * - Unpaid Cashu / DEMO (no expiring invoice): after the max pending age.
 * - Unpaid escrow tickets: never here — the escrow timeout cancels them.
 * - Anything paid or later: never (the units are sold).
 */
export function isStockReleasable(
  ticket: StockReleaseCandidate,
  now: Date,
  maxPendingMs = DEFAULT_MAX_PENDING_MS,
): boolean {
  if (ticket.status === 'CANCELLED' || ticket.status === 'REFUNDED') return true
  if (ticket.status !== 'PENDING' && ticket.status !== 'ACCEPTED') return false
  if (ticket.escrowEnabled) return false
  if (ticket.directPayRail === 'LN') {
    const decoded = ticket.lightningInvoice ? safeDecode(ticket.lightningInvoice) : null
    if (!decoded) return false
    const expiresAtMs = (decoded.timestamp + (decoded.expiry ?? DEFAULT_INVOICE_EXPIRY_S)) * 1000
    return now.getTime() > expiresAtMs + LN_EXPIRY_GRACE_MS
  }
  return now.getTime() - ticket.createdAt.getTime() > maxPendingMs
}

function safeDecode(bolt11: string): ReturnType<typeof decodeInvoice> {
  try {
    return decodeInvoice(bolt11)
  } catch {
    return null
  }
}

function resolveMaxPendingMs(): number {
  const raw = Number(process.env.STOCK_RESERVATION_MAX_PENDING_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_PENDING_MS
}

/**
 * Return a ticket's reserved units to its offer. Idempotent: the reservation
 * is CAS-zeroed first, so concurrent ticks never double-release. If the seller
 * switched the offer to unlimited stock (null) meanwhile, nothing is added.
 */
export async function releaseTicketStock(prisma: PrismaClient, ticketId: string, reserved: number, offerId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const cas = await tx.ticket.updateMany({
      where: { id: ticketId, stockReserved: reserved },
      data: { stockReserved: 0 },
    })
    if (cas.count !== 1) return false
    await tx.offer.updateMany({
      where: { id: offerId, stock: { not: null } },
      data: { stock: { increment: reserved } },
    })
    return true
  })
}

export async function runTicketStockReleaseTick(prisma: PrismaClient, now = new Date()): Promise<number> {
  const candidates = await prisma.ticket.findMany({
    where: {
      stockReserved: { gt: 0 },
      offerId: { not: null },
      status: { in: ['CANCELLED', 'REFUNDED', 'PENDING', 'ACCEPTED'] },
    },
    select: {
      id: true,
      offerId: true,
      stockReserved: true,
      status: true,
      createdAt: true,
      directPayRail: true,
      escrowEnabled: true,
      lightningInvoice: true,
    },
    take: 500,
  })
  const maxPendingMs = resolveMaxPendingMs()
  let released = 0
  for (const t of candidates) {
    if (!isStockReleasable(t, now, maxPendingMs)) continue
    if (await releaseTicketStock(prisma, t.id, t.stockReserved, t.offerId!)) released++
  }
  if (released > 0) console.log(`[TicketStock] Released stock reservations of ${released} ticket(s)`)
  return released
}
