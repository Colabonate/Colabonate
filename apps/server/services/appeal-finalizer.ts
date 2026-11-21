import type { PrismaClient, VerdictOutcome } from '@prisma/client'
import type { PaymentProvider } from '@col/payments'
import { notifyDisputants } from './email-notifier.js'
import { LNBitsProvider } from '@col/payments'
import { casTicketUpdate } from './escrow-state.js'
import { logCritical } from '../lib/critical-alert.js'
import { enqueueCanvasLifecycleForTicket } from './canvas-lifecycle.js'

const FOUNDATION_DAO_ID = 'colabonate-foundation'

export async function runAppealFinalizerTick(
  prisma: PrismaClient,
  payments: PaymentProvider,
  now: Date = new Date(),
): Promise<void> {
  const pending = await prisma.dispute.findMany({
    where: { status: 'RESOLVED_PENDING' },
    include: {
      dao: { include: { config: true } },
      verdicts: true,
      ticket: true,
    },
  })

  for (const dispute of pending) {
    const windowHours = dispute.dao.config?.appealWindowHours ?? 72
    if (windowHours <= 0) continue
    if (!dispute.verdictIssuedAt) continue

    const expiresAt = new Date(dispute.verdictIssuedAt.getTime() + windowHours * 3600_000)
    if (now.getTime() < expiresAt.getTime()) continue

    await finalizeDispute(prisma, payments, dispute.id)
  }
}

async function finalizeDispute(
  prisma: PrismaClient,
  payments: PaymentProvider,
  disputeId: string,
): Promise<void> {
  const result = await prisma.dispute.updateMany({
    where: { id: disputeId, status: 'RESOLVED_PENDING' },
    data: { status: 'RESOLVED', resolvedAt: new Date() },
  })
  if (result.count === 0) return

  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: { verdicts: true, ticket: { include: { offer: true } } },
  })
  if (!dispute) return

  const outcome = resolveOutcome(dispute.verdicts)
  if (!outcome) {
    console.error(`[AppealFinalizer] No majority outcome for dispute ${disputeId}, skipping escrow`)
    return
  }

  const provider = dispute.ticket.offer?.lightningSubWalletAdminKey && payments instanceof LNBitsProvider
    ? payments.createSubWalletProvider(dispute.ticket.offer.lightningSubWalletAdminKey)
    : payments
  await settleEscrowForOutcome(prisma, provider, dispute.ticket, outcome)
  console.log(`[AppealFinalizer] Dispute ${disputeId} finalized → ${outcome}`)

  // ADR-353/ADR-370 D7 (G4): the appeal finalizer writes the terminal ticket
  // state protocol-side (no user in the loop) — enqueue the canvas lock so an
  // escrow-hosted AGENT_SETUP can never end with an unlocked canvas.
  const terminalStatus = outcome === 'RELEASE' ? 'COMPLETED' : 'CANCELLED'
  enqueueCanvasLifecycleForTicket(prisma, dispute.ticket.id, dispute.ticket.status, terminalStatus).catch((err) =>
    console.error('[canvas-lifecycle] enqueue on appeal finalize failed:', err instanceof Error ? err.message : err),
  )

  setImmediate(() => {
    notifyDisputants(prisma, dispute.ticket.buyerPubkey, dispute.ticket.sellerPubkey, {
      type: 'verdict_finalized',
      disputeId,
      ticketId: dispute.ticket.id,
      ticketShortId: dispute.ticket.id.slice(0, 8),
      outcome,
    }).catch(err => console.error('[EmailNotifier] notifyDisputants failed:', err))
  })
}

function resolveOutcome(
  verdicts: { round: number; outcome: VerdictOutcome }[],
): 'RELEASE' | 'CANCEL' | null {
  if (verdicts.length === 0) return null
  const maxRound = Math.max(...verdicts.map(v => v.round))
  const roundVerdicts = verdicts.filter(v => v.round === maxRound)

  const counts: Record<string, number> = {}
  for (const v of roundVerdicts) {
    counts[v.outcome] = (counts[v.outcome] ?? 0) + 1
  }

  const releaseCount = counts['RELEASE'] ?? 0
  const cancelCount = counts['CANCEL'] ?? 0

  if (releaseCount > cancelCount) return 'RELEASE'
  if (cancelCount > releaseCount) return 'CANCEL'
  return null
}

export async function settleEscrowForOutcome(
  prisma: PrismaClient,
  payments: PaymentProvider,
  ticket: { id: string; escrowStatus: string; escrowPhase1Preimage?: string | null; escrowPhase2Preimage?: string | null; escrowPhase3Preimage?: string | null; escrowPhase1Hash?: string | null; escrowPhase2Hash?: string | null; escrowPhase3Hash?: string | null },
  outcome: VerdictOutcome,
): Promise<void> {
  if (outcome === 'RELEASE') {
    const preimages = [
      ticket.escrowPhase1Preimage,
      ticket.escrowPhase2Preimage,
      ticket.escrowPhase3Preimage,
    ].filter(Boolean) as string[]

    for (const preimage of preimages) {
      try {
        await payments.settleHoldInvoice(preimage)
      } catch (err) {
        console.error(`[Escrow] Failed to settle hold invoice:`, err)
      }
    }

    const ok = await casTicketUpdate(prisma, ticket.id, ticket.escrowStatus, {
      escrowStatus: 'RELEASED',
      status: 'COMPLETED',
      deliveryConfirmedAt: new Date(),
      escrowPhase1Deadline: null,
      escrowPhase2Deadline: null,
      escrowPhase3Deadline: null,
      escrowAutoReleaseDeadline: null,
    })
    if (!ok) {
      // Hold invoices were already settled above — cannot be undone.
      logCritical('AppealFinalizer', `ticket ${ticket.id} settled on Lightning but DB write lost a concurrent race`)
    }
  } else {
    const hashes = [
      ticket.escrowPhase1Hash,
      ticket.escrowPhase2Hash,
      ticket.escrowPhase3Hash,
    ].filter(Boolean) as string[]

    for (const hash of hashes) {
      try {
        await payments.cancelHoldInvoice(hash)
      } catch (err) {
        console.error(`[Escrow] Failed to cancel hold invoice:`, err)
      }
    }

    const ok = await casTicketUpdate(prisma, ticket.id, ticket.escrowStatus, {
      escrowStatus: 'CANCELLED',
      status: 'CANCELLED',
      escrowPhase1Deadline: null,
      escrowPhase2Deadline: null,
      escrowPhase3Deadline: null,
      escrowAutoReleaseDeadline: null,
    })
    if (!ok) {
      logCritical('AppealFinalizer', `ticket ${ticket.id} hold invoices cancelled on Lightning but DB write lost a concurrent race`)
    }
  }
}
