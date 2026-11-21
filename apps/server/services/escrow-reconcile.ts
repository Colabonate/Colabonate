import type { PrismaClient } from '@prisma/client'
import type { PaymentProvider } from '@col/payments'
import { LNBitsProvider } from '@col/payments'
import { nostrService } from './nostr-relay.js'
import { confirmPaymentByHash } from './paymentConfirmation.js'

/**
 * Server-side backstop for hold-invoice payment confirmation (ADR-209 /
 * ADR-193). The primary confirmation path is client-side polling
 * (GET /api/lightning/invoice/:hash), which calls confirmPaymentByHash()
 * once a hold invoice reaches an accepted/settled state. If the buyer's
 * client never polls again — tab closed, app crashed, backgrounded on
 * mobile — nothing else ever advances the ticket: RESERVED and
 * DELIVERY_STARTED have no deadline column (see computeEscrowDeadline) and
 * runEscrowTimeoutTick only acts on *_PENDING deadlines and the
 * DELIVERY_CONFIRMED auto-release window, not on "is the hold actually
 * accepted yet". Without this tick, a ticket whose buyer paid but whose
 * client never checked back again was stuck in *_PENDING indefinitely.
 *
 * This tick asks the Lightning backend directly, on a schedule, whether the
 * hold invoice for every ticket currently in a *_PENDING phase has actually
 * been accepted — and if so, runs it through the exact same
 * confirmPaymentByHash() state machine the poll/webhook use, so a client
 * that never checks back still eventually converges.
 */
export async function reconcileHoldInvoiceStates(
  prisma: PrismaClient,
  payments: PaymentProvider,
): Promise<void> {
  const pending = await prisma.ticket.findMany({
    where: { escrowStatus: { in: ['PHASE_1_PENDING', 'PHASE_2_PENDING', 'PHASE_3_PENDING'] } },
    include: { offer: true },
  })

  for (const ticket of pending) {
    const hash =
      ticket.escrowStatus === 'PHASE_1_PENDING' ? ticket.escrowPhase1Hash
      : ticket.escrowStatus === 'PHASE_2_PENDING' ? ticket.escrowPhase2Hash
      : ticket.escrowStatus === 'PHASE_3_PENDING' ? ticket.escrowPhase3Hash
      : null
    if (!hash) continue

    try {
      const provider = ticket.offer?.lightningSubWalletAdminKey && payments instanceof LNBitsProvider
        ? payments.createSubWalletProvider(ticket.offer.lightningSubWalletAdminKey)
        : payments
      if (!provider.getHoldState) continue

      const hold = await provider.getHoldState(hash)
      if (hold.status === 'paid' || hold.status === 'settled') {
        const updated = await confirmPaymentByHash(prisma, hash, { preimage: hold.preimage ?? null, nostrService })
        if (updated.length > 0) {
          console.log(`[EscrowReconcile] Ticket ${ticket.id} advanced via reconciliation (client never polled): ${updated.join(', ')}`)
        }
      }
    } catch (err) {
      console.error(`[EscrowReconcile] Failed to reconcile ticket ${ticket.id} (hash ${hash.slice(0, 16)}…):`, err)
    }
  }
}
