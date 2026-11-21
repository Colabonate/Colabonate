import type { PrismaClient } from '@prisma/client'
import type { PaymentProvider } from '@col/payments'
import { nostrService } from './nostr-relay.js'
import { LNBitsProvider } from '@col/payments'
import { casTicketUpdate } from './escrow-state.js'
import { logCritical } from '../lib/critical-alert.js'
import { enqueueCanvasLifecycleForTicket } from './canvas-lifecycle.js'
import { notifyTicketStatusChange } from './notifications.js'

/** ADR-411: no human acts on protocol-driven terminal transitions — notify BOTH parties. */
function notifyBothParties(
  prisma: PrismaClient,
  ticket: { id: string; buyerPubkey: string; sellerPubkey: string },
  fromStatus: string,
  toStatus: 'COMPLETED' | 'CANCELLED',
  offerTitle: string | null,
): void {
  for (const actingPubkey of [ticket.buyerPubkey, ticket.sellerPubkey]) {
    notifyTicketStatusChange(prisma, {
      ticketId: ticket.id,
      fromStatus,
      toStatus,
      buyerPubkey: ticket.buyerPubkey,
      sellerPubkey: ticket.sellerPubkey,
      actingPubkey,
      offerTitle,
    }).catch(err => console.error('[notifications] escrow timeout notify failed:', err))
  }
}

const PHASE_1_WINDOW_MS = 72 * 60 * 60 * 1000
const PHASE_3_WINDOW_MS = 24 * 60 * 60 * 1000
const AUTO_RELEASE_WINDOW_MS = 48 * 60 * 60 * 1000

function phase2WindowMs(offerPhase2Hours: number | null | undefined): number {
  return (offerPhase2Hours ?? 24) * 60 * 60 * 1000
}

export function computeEscrowPhaseAmounts(totalSats: number): {
  phase1: number
  phase2: number
  phase3: number
} {
  const phase1 = Math.round(totalSats * 0.25)
  const phase2 = Math.round(totalSats * 0.50)
  const phase3 = totalSats - phase1 - phase2
  return { phase1, phase2, phase3 }
}

export async function runEscrowTimeoutTick(
  prisma: PrismaClient,
  payments: PaymentProvider,
  now: Date = new Date(),
): Promise<void> {
  const nowMs = now.getTime()

  // 1. Cancel tickets whose phase payment window expired.
  const phaseTimeouts = await prisma.ticket.findMany({
    where: {
      OR: [
        { escrowStatus: 'PHASE_1_PENDING', escrowPhase1Deadline: { lt: now } },
        { escrowStatus: 'PHASE_2_PENDING', escrowPhase2Deadline: { lt: now } },
        { escrowStatus: 'PHASE_3_PENDING', escrowPhase3Deadline: { lt: now } },
      ],
    },
    include: { offer: true },
  })

  for (const ticket of phaseTimeouts) {
    try {
      // Idempotency guard: re-read current state inside the loop.
      const current = await prisma.ticket.findUnique({
        where: { id: ticket.id },
        select: { escrowStatus: true, status: true },
      })
      if (!current || !['PHASE_1_PENDING', 'PHASE_2_PENDING', 'PHASE_3_PENDING'].includes(current.escrowStatus)) {
        continue
      }

      const hashes = [
        ticket.escrowPhase1Hash,
        ticket.escrowPhase2Hash,
        ticket.escrowPhase3Hash,
      ].filter(Boolean) as string[]

      for (const hash of hashes) {
        try {
          await payments.cancelHoldInvoice(hash)
        } catch (err) {
          console.error(`[EscrowTimeout] Failed to cancel hold invoice ${hash.slice(0, 16)}…:`, err)
        }
      }

      // CAS against the state we just re-read: if the buyer's payment was
      // confirmed concurrently (e.g. confirmPaymentByHash advanced the
      // ticket the instant before this tick's write), do not overwrite that
      // with CANCELLED — the cancel calls above are already safe no-ops
      // against an invoice LND/LNbits now considers settled/accepted.
      const cancelOk = await casTicketUpdate(prisma, ticket.id, current.escrowStatus, {
        escrowStatus: 'CANCELLED',
        status: 'CANCELLED',
        escrowPhase1Deadline: null,
        escrowPhase2Deadline: null,
        escrowPhase3Deadline: null,
        escrowAutoReleaseDeadline: null,
      })
      if (!cancelOk) {
        console.log(`[EscrowTimeout] Ticket ${ticket.id} state changed concurrently (likely paid) — skipping timeout cancellation`)
        continue
      }
      const updated = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include: { offer: true } })

      const { phase1, phase2, phase3 } = computeEscrowPhaseAmounts(updated.amountSats || updated.offer?.priceSats || 0)
      await nostrService.publishTicketStatus({
        id: updated.id,
        status: updated.status,
        buyerPubkey: updated.buyerPubkey,
        sellerPubkey: updated.sellerPubkey,
        offerId: updated.offerId ?? undefined,
        offerType: updated.offerType ?? undefined,
        escrowStatus: updated.escrowStatus,
        escrowPhase1Preimage: updated.escrowPhase1Preimage,
        escrowPhase2Preimage: updated.escrowPhase2Preimage,
        escrowPhase3Preimage: updated.escrowPhase3Preimage,
        escrowPhase1Amount: phase1,
        escrowPhase2Amount: phase2,
        escrowPhase3Amount: phase3,
        visibility: (updated.visibility === 'PRIVATE' ? 1 : 0) as 0 | 1 | 2,
      }).catch(err => console.error('[Nostr] publishTicketStatus failed:', err))

      // ADR-353/ADR-370 D7 (G4): phase-timeout is a protocol-driven terminal
      // entry (CANCELLED) with no user in the loop — freeze the hosted canvas.
      enqueueCanvasLifecycleForTicket(prisma, ticket.id, current.status, 'CANCELLED').catch((err) =>
        console.error('[canvas-lifecycle] enqueue on escrow phase timeout failed:', err instanceof Error ? err.message : err),
      )

      // ADR-411: protocol-driven cancellation reaches both parties' feeds.
      notifyBothParties(prisma, updated, current.status, 'CANCELLED', updated.offer?.title ?? null)

      console.log(`[EscrowTimeout] Ticket ${ticket.id} cancelled by phase timeout`)
    } catch (err) {
      console.error(`[EscrowTimeout] Error cancelling ticket ${ticket.id}:`, err)
    }
  }

  // 2. Auto-release tickets stuck in DELIVERY_CONFIRMED past the quality window.
  const autoReleases = await prisma.ticket.findMany({
    where: {
      escrowStatus: 'DELIVERY_CONFIRMED',
      escrowAutoReleaseDeadline: { lt: now },
    },
    include: { offer: true },
  })

  for (const ticket of autoReleases) {
    try {
      const current = await prisma.ticket.findUnique({
        where: { id: ticket.id },
        select: { escrowStatus: true },
      })
      if (current?.escrowStatus !== 'DELIVERY_CONFIRMED') continue

      const phases = [
        { hash: ticket.escrowPhase1Hash, preimage: ticket.escrowPhase1Preimage },
        { hash: ticket.escrowPhase2Hash, preimage: ticket.escrowPhase2Preimage },
        { hash: ticket.escrowPhase3Hash, preimage: ticket.escrowPhase3Preimage },
      ].filter(p => p.hash && p.preimage) as { hash: string; preimage: string }[]

      const provider = ticket.offer?.lightningSubWalletAdminKey && payments instanceof LNBitsProvider
        ? payments.createSubWalletProvider(ticket.offer.lightningSubWalletAdminKey)
        : payments

      for (const { hash, preimage } of phases) {
        try {
          if (provider?.settleHoldInvoiceByHash) {
            await provider.settleHoldInvoiceByHash(hash, preimage)
          } else {
            await payments.settleHoldInvoice(preimage)
          }
        } catch (err) {
          console.error(`[EscrowTimeout] Failed to settle hold invoice ${hash.slice(0, 16)}…:`, err)
        }
      }

      // CAS against the state we just re-read: funds were already settled
      // above (irreversible), so a lost race here must not be silently
      // dropped — log loud and let the next tick retry (settle is a safe
      // no-op against an already-settled invoice).
      const releaseOk = await casTicketUpdate(prisma, ticket.id, current.escrowStatus, {
        escrowStatus: 'RELEASED',
        status: 'COMPLETED',
        deliveryConfirmedAt: now,
        escrowPhase1Deadline: null,
        escrowPhase2Deadline: null,
        escrowPhase3Deadline: null,
        escrowAutoReleaseDeadline: null,
      })
      if (!releaseOk) {
        logCritical('EscrowTimeout', `ticket ${ticket.id} auto-settled on Lightning but DB write lost a concurrent race — will retry next tick`)
        continue
      }
      const updated = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include: { offer: true } })

      const { phase1: ar1, phase2: ar2, phase3: ar3 } = computeEscrowPhaseAmounts(updated.amountSats || updated.offer?.priceSats || 0)
      await nostrService.publishTicketStatus({
        id: updated.id,
        status: updated.status,
        buyerPubkey: updated.buyerPubkey,
        sellerPubkey: updated.sellerPubkey,
        offerId: updated.offerId ?? undefined,
        offerType: updated.offerType ?? undefined,
        escrowStatus: updated.escrowStatus,
        escrowPhase1Preimage: updated.escrowPhase1Preimage,
        escrowPhase2Preimage: updated.escrowPhase2Preimage,
        escrowPhase3Preimage: updated.escrowPhase3Preimage,
        escrowPhase1Amount: ar1,
        escrowPhase2Amount: ar2,
        escrowPhase3Amount: ar3,
        visibility: (updated.visibility === 'PRIVATE' ? 1 : 0) as 0 | 1 | 2,
      }).catch(err => console.error('[Nostr] publishTicketStatus failed:', err))

      // ADR-353/ADR-370 D7 (G4): auto-release after the quality window is a
      // protocol-driven terminal entry (COMPLETED) with no user in the loop.
      enqueueCanvasLifecycleForTicket(prisma, ticket.id, ticket.status, 'COMPLETED').catch((err) =>
        console.error('[canvas-lifecycle] enqueue on escrow auto-release failed:', err instanceof Error ? err.message : err),
      )

      // ADR-411: the seller was auto-paid and the buyer's escrow closed —
      // both must see this in their feed.
      notifyBothParties(prisma, updated, ticket.status, 'COMPLETED', updated.offer?.title ?? null)

      console.log(`[EscrowTimeout] Ticket ${ticket.id} auto-released after quality window`)
    } catch (err) {
      console.error(`[EscrowTimeout] Error auto-releasing ticket ${ticket.id}:`, err)
    }
  }
}

/**
 * Compute the deadline for a newly entered escrow state.
 * Returns null for states that do not start a timer.
 */
export function computeEscrowDeadline(
  escrowStatus: string,
  offerPhase2Hours: number | null | undefined,
  now: Date = new Date(),
): Date | null {
  switch (escrowStatus) {
    case 'PHASE_1_PENDING':
      return new Date(now.getTime() + PHASE_1_WINDOW_MS)
    case 'PHASE_2_PENDING':
      return new Date(now.getTime() + phase2WindowMs(offerPhase2Hours))
    case 'PHASE_3_PENDING':
      return new Date(now.getTime() + PHASE_3_WINDOW_MS)
    case 'DELIVERY_CONFIRMED':
      return new Date(now.getTime() + AUTO_RELEASE_WINDOW_MS)
    default:
      return null
  }
}
