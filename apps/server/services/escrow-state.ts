import type { Prisma, PrismaClient } from '@prisma/client'

/**
 * Optimistic-concurrency guard for escrow/ticket state transitions.
 *
 * Every escrow-state write in this codebase used to be a plain
 * `prisma.ticket.update({ where: { id } })` after a separate read-time
 * `validateTransition()` check — a classic check-then-act race: two
 * concurrent requests (e.g. buyer `release` vs. seller `dispute`, or a
 * delayed webhook racing a live poll) can both pass their read-time check
 * and then both write, silently clobbering each other or double-triggering
 * a Lightning settle/cancel call.
 *
 * `casTicketUpdate` closes that window by making `escrowStatus` a
 * compare-and-swap guard on the write itself: the row only updates if it is
 * still in `expectedEscrowStatus` at write time. `updateMany` (not `update`)
 * is required because Prisma only allows non-unique fields in the `where`
 * of `updateMany`/`deleteMany`, not `update`.
 *
 * Returns `false` when another request already moved the ticket out of the
 * expected state — callers MUST treat that as a conflict (409), not retry
 * blindly, since a settle/cancel call may already be in flight for the row
 * on the other request's path.
 */
export async function casTicketUpdate(
  prisma: PrismaClient,
  ticketId: string,
  expectedEscrowStatus: string | string[],
  data: Prisma.TicketUpdateManyMutationInput,
): Promise<boolean> {
  const result = await prisma.ticket.updateMany({
    where: {
      id: ticketId,
      escrowStatus: Array.isArray(expectedEscrowStatus)
        ? { in: expectedEscrowStatus }
        : expectedEscrowStatus,
    },
    data,
  })
  return result.count === 1
}
