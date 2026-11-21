import type { PrismaClient } from '@prisma/client'
import type { NostrRelayService } from './nostr-relay.js'
import { computeEscrowDeadline, computeEscrowPhaseAmounts } from './escrow-timeout.js'
import { casTicketUpdate } from './escrow-state.js'
import { enqueueProvisioningOnPaid } from './canvas-provisioning.js'
import { enqueueCanvasLifecycleForTicket } from './canvas-lifecycle.js'
import { syncAgentTaskFromTicketSafe } from './bounty-ticket.js'
import { notifyTicketStatusChange, notifyCooperationStatusChange, notifySellerLegConfirmed, createNotification } from './notifications.js'

export interface StoredInvoiceLike {
  status: 'PENDING' | 'PAID'
}

export interface ConfirmPaymentOptions<T extends StoredInvoiceLike = StoredInvoiceLike> {
  preimage?: string | null
  nostrService?: Pick<NostrRelayService, 'publishTicketStatus'>
  invoiceMap?: Map<string, T>
}

// ADR-241 D1: single confirm path for a settled Lightning payment, consumed by
// the LNBits webhook, the /api/lightning/invoice poll, and /api/beta/demo-pay.
// Superset of the pre-ADR-241 webhook logic (ADR-239 D1 phase-hash OR matching,
// escrowStatus transitions, preimage, Kind-30408, coop-ticket sync) — every
// caller now advances the exact same state machine, so beta and production
// never diverge on what "paid" means for an escrow ticket.
export async function confirmPaymentByHash<T extends StoredInvoiceLike = StoredInvoiceLike>(
  prisma: PrismaClient,
  paymentHash: string,
  opts: ConfirmPaymentOptions<T> = {},
): Promise<string[]> {
  const { preimage, nostrService, invoiceMap } = opts
  const updated: string[] = []

  // ── Offer/cooperation tickets ────────────────────────────────────────────
  // Match on the ticket's main paymentHash OR any of the three escrow phase
  // hashes (ADR-239 D1). The main paymentHash stays the Phase-1 hash for the
  // ticket's lifetime; Phase 2/3 hold invoices carry their own hash.
  const tickets = await prisma.ticket.findMany({
    where: {
      OR: [
        { paymentHash },
        { escrowPhase1Hash: paymentHash },
        { escrowPhase2Hash: paymentHash },
        { escrowPhase3Hash: paymentHash },
      ],
    },
    include: { offer: true, platformFee: true },
  })

  for (const ticket of tickets) {
    if (ticket.status === 'PENDING' || ticket.status === 'ACCEPTED') {
      // ADR-372 D7.3: two-confirm gate. A doop-hosted ticket carries a separate
      // buyer→Colabonate fee invoice (TicketPlatformFee). While that fee is
      // still PENDING, this seller-leg confirm records itself (preimage +
      // sellerLegConfirmedAt) but does NOT flip the ticket to PAID and does NOT
      // enqueue provisioning. The LAST leg to confirm triggers PAID: either the
      // fee-confirm route (when sellerLegConfirmedAt is already set) or a later
      // seller-leg confirm (when the fee row is already PAID here).
      if (ticket.platformFee && ticket.platformFee.status === 'PENDING') {
        // ADR-413 D4: the seller leg is confirmed once — the buyer paid the
        // price, the platform fee is the open leg. Every trigger (webhook,
        // poll, reconcile tick) re-enters this branch, so the write is a
        // compare-and-swap on `sellerLegConfirmedAt` and the seller is
        // notified only on the actual transition, never on every poll.
        const sellerLeg = await prisma.ticketPlatformFee.updateMany({
          where: { id: ticket.platformFee.id, sellerLegConfirmedAt: null },
          data: { sellerLegConfirmedAt: new Date() },
        })
        await prisma.ticket.updateMany({
          where: { id: ticket.id, preimage: null },
          data: { preimage: preimage ?? null },
        })
        if (sellerLeg.count === 1) {
          updated.push(`ticket:${ticket.id}:SELLER_LEG_CONFIRMED`)
          console.log(`[confirmPaymentByHash] Ticket ${ticket.id} seller leg confirmed — awaiting hosted-canvas fee`)
          notifySellerLegConfirmed(prisma, {
            ticketId: ticket.id,
            sellerPubkey: ticket.sellerPubkey,
            buyerPubkey: ticket.buyerPubkey,
            offerTitle: ticket.offer?.title ?? null,
            feeSats: ticket.platformFee.amountSats,
          }).catch(err => console.error('[notifications] seller-leg notify failed:', err))
        }
      } else {
        // ADR-394: compare-and-swap on the pre-payment statuses. Two concurrent
        // confirms (a webhook racing a poll, a duplicate self-confirm, or the
        // seller-leg vs fee-leg handshake) must not both run the PAID
        // side-effects; only the request that actually moved the row from
        // PENDING|ACCEPTED enqueues provisioning and publishes.
        const cas = await prisma.ticket.updateMany({
          where: { id: ticket.id, status: { in: ['PENDING', 'ACCEPTED'] } },
          data: { status: 'PAID', preimage: preimage ?? null },
        })
        if (cas.count !== 1) {
          updated.push(`ticket:${ticket.id}:SKIPPED_ALREADY_PAID`)
          console.log(`[confirmPaymentByHash] Ticket ${ticket.id} already left the pre-payment state — skipped`)
        } else {
          updated.push(`ticket:${ticket.id}:PAID`)
          console.log(`[confirmPaymentByHash] Ticket ${ticket.id} → PAID`)

          // ADR-411: payment-settlement-driven PAID must reach the seller's
          // feed (webhook / poll / demo-pay / direct-pay settlement / reconcile
          // tick all converge here). Acting = buyer → seller is notified.
          notifyTicketStatusChange(prisma, {
            ticketId: ticket.id,
            fromStatus: ticket.status,
            toStatus: 'PAID',
            buyerPubkey: ticket.buyerPubkey,
            sellerPubkey: ticket.sellerPubkey,
            actingPubkey: ticket.buyerPubkey,
            offerTitle: ticket.offer?.title ?? null,
          }).catch(err => console.error('[notifications] PAID notify failed:', err))

          // ADR-370 D2 (fix G2): the first transition to PAID auto-enqueues the
          // doop-hosted canvas provisioning (ticket-anchored, via outbox — never
          // a doop HTTP call in this request path). Fire-and-forget: a failure
          // must not fail payment confirmation; the ticket UI's retry action
          // re-enqueues. No-op for tickets without a doop-hosted snapshot.
          enqueueProvisioningOnPaid(prisma, ticket.id).catch((err) =>
            console.error('[canvas-provision] enqueue on PAID failed:', err instanceof Error ? err.message : err),
          )

          if (ticket.cooperationId && nostrService) {
            nostrService.publishTicketStatus({
              id: ticket.id,
              cooperationId: ticket.cooperationId,
              status: 'PAID',
              buyerPubkey: ticket.buyerPubkey,
              sellerPubkey: ticket.sellerPubkey,
              paymentHash,
              preimage: preimage ?? undefined,
              escrowStatus: ticket.escrowStatus ?? undefined,
              visibility: ticket.visibility === 'PRIVATE' ? 1 : 0,
            }).catch(err => console.error('[Nostr] Failed to publish Kind 30408 (CoopTicket PAID):', err))
          }
        }
      }
    } else if (ticket.status === 'IN_PROGRESS') {
      const result = await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'COMPLETED', preimage: preimage ?? null },
      })
      updated.push(`ticket:${ticket.id}:COMPLETED`)
      console.log(`[confirmPaymentByHash] Ticket ${ticket.id} → COMPLETED (release payment)`)

      // ADR-411: release-payment confirmation is user-less on this path —
      // notify the seller that their payout completed.
      notifyTicketStatusChange(prisma, {
        ticketId: ticket.id,
        fromStatus: 'IN_PROGRESS',
        toStatus: 'COMPLETED',
        buyerPubkey: ticket.buyerPubkey,
        sellerPubkey: ticket.sellerPubkey,
        actingPubkey: ticket.buyerPubkey,
        offerTitle: ticket.offer?.title ?? null,
      }).catch(err => console.error('[notifications] COMPLETED notify failed:', err))

      // ADR-353/ADR-370 D7 (G4): webhook/poll-driven IN_PROGRESS → COMPLETED
      // (release-payment confirmation) has no user in the loop — freeze the
      // hosted canvas here, not only in PATCH /api/tickets/:id.
      enqueueCanvasLifecycleForTicket(prisma, ticket.id, 'IN_PROGRESS', 'COMPLETED').catch((err) =>
        console.error('[canvas-lifecycle] enqueue on webhook completion failed:', err instanceof Error ? err.message : err),
      )

      if (ticket.cooperationId && nostrService) {
        nostrService.publishTicketStatus({
          id: result.id,
          cooperationId: ticket.cooperationId,
          status: 'COMPLETED',
          buyerPubkey: ticket.buyerPubkey,
          sellerPubkey: ticket.sellerPubkey,
          paymentHash,
          preimage: preimage ?? undefined,
          escrowStatus: result.escrowStatus ?? undefined,
          visibility: result.visibility === 'PRIVATE' ? 1 : 0,
        }).catch(err => console.error('[Nostr] Failed to publish Kind 30408 (CoopTicket COMPLETED):', err))
      }
    }

    // ADR-397 D4: a bounty ticket drives its bounty's status (PAID →
    // IN_PROGRESS, COMPLETED → COMPLETED). Idempotent, never fails the confirm.
    if (ticket.agentTaskId) syncAgentTaskFromTicketSafe(prisma, ticket.id)

    if (ticket.escrowStatus) {
      const escrowFields: Record<string, string | number | Date | null> = {}
      let expectedFrom: string | null = null
      if (ticket.escrowPhase1Hash === paymentHash) {
        expectedFrom = 'PHASE_1_PENDING'
        escrowFields.escrowStatus = 'RESERVED'
      } else if (ticket.escrowPhase2Hash === paymentHash) {
        expectedFrom = 'PHASE_2_PENDING'
        escrowFields.escrowStatus = 'DELIVERY_STARTED'
      } else if (ticket.escrowPhase3Hash === paymentHash) {
        expectedFrom = 'PHASE_3_PENDING'
        escrowFields.escrowStatus = 'DELIVERY_CONFIRMED'
        escrowFields.escrowAutoReleaseDeadline = computeEscrowDeadline(
          'DELIVERY_CONFIRMED',
          ticket.offer?.phase2WindowHours ?? 72,
        )
      }

      if (expectedFrom && Object.keys(escrowFields).length > 0) {
        // CAS on the expected predecessor phase: this confirm path is
        // invoked from three independent triggers (webhook, client poll,
        // reconciliation tick) that can race or arrive out of order. Without
        // this guard, a delayed confirmation for an EARLIER phase arriving
        // after the ticket already progressed further would roll
        // escrowStatus backward (e.g. a late Phase-1 webhook overwriting a
        // ticket that already reached DELIVERY_STARTED via Phase 2).
        const ok = await casTicketUpdate(prisma, ticket.id, expectedFrom, escrowFields)
        if (ok) {
          updated.push(`ticket:${ticket.id}:escrow→${escrowFields.escrowStatus}`)
          console.log(`[confirmPaymentByHash] Ticket ${ticket.id} escrow → ${escrowFields.escrowStatus}`)
        } else {
          console.log(`[confirmPaymentByHash] Ticket ${ticket.id} already advanced past ${expectedFrom} — skipping stale escrow update to ${escrowFields.escrowStatus}`)
        }
      }
    }
  }

  // ── Cooperations (ACCEPTED → PAID) ───────────────────────────────────────
  const cooperations = await prisma.cooperation.findMany({ where: { paymentHash, status: 'ACCEPTED' } })
  for (const coop of cooperations) {
    await prisma.cooperation.update({ where: { id: coop.id }, data: { status: 'PAID' } })
    updated.push(`cooperation:${coop.id}:PAID`)
    console.log(`[confirmPaymentByHash] Cooperation ${coop.id} → PAID`)

    // ADR-411: escrow funded → the partner can begin work ("Escrow funded –
    // work can begin"). The initiator funded, so the partner is notified.
    notifyCooperationStatusChange(prisma, {
      cooperationId: coop.id,
      fromStatus: 'ACCEPTED',
      toStatus: 'PAID',
      initiatorPubkey: coop.initiatorPubkey,
      partnerPubkey: coop.partnerPubkey,
      actingPubkey: coop.initiatorPubkey,
      title: coop.title,
    }).catch(err => console.error('[notifications] coop PAID notify failed:', err))

    const coopTicket = await prisma.ticket.findUnique({ where: { cooperationId: coop.id } })
    if (coopTicket) {
      const result = await prisma.ticket.update({
        where: { id: coopTicket.id },
        data: { status: 'PAID', preimage: preimage ?? null },
      })
      updated.push(`ticket:${coopTicket.id}:PAID`)
      console.log(`[confirmPaymentByHash] Cooperation ticket ${coopTicket.id} → PAID`)

      if (nostrService) {
        nostrService.publishTicketStatus({
          id: result.id,
          cooperationId: coop.id,
          status: 'PAID',
          buyerPubkey: result.buyerPubkey,
          sellerPubkey: result.sellerPubkey,
          paymentHash,
          preimage: preimage ?? undefined,
          escrowStatus: result.escrowStatus ?? undefined,
          visibility: result.visibility === 'PRIVATE' ? 1 : 0,
        }).catch(err => console.error('[Nostr] Failed to publish Kind 30408 (CoopTicket PAID):', err))
      }
    }
  }

  // ── Coop milestones (COMPLETED → ACCEPTED) ───────────────────────────────
  const milestones = await prisma.coopMilestone.findMany({ where: { paymentHash, status: 'COMPLETED' } })
  for (const milestone of milestones) {
    await prisma.coopMilestone.update({ where: { id: milestone.id }, data: { status: 'ACCEPTED' } })
    updated.push(`milestone:${milestone.id}:ACCEPTED`)
    console.log(`[confirmPaymentByHash] Milestone ${milestone.id} → ACCEPTED`)

    // ADR-411: milestone payout settled → the partner received the payment.
    const msCoop = await prisma.cooperation.findUnique({
      where: { id: milestone.cooperationId },
      select: { initiatorPubkey: true, partnerPubkey: true, title: true },
    })
    if (msCoop?.partnerPubkey && msCoop.partnerPubkey !== msCoop.initiatorPubkey) {
      createNotification(prisma, {
        ownerPubkey: msCoop.partnerPubkey,
        type: 'cooperation',
        title: 'Milestone payment received',
        message: `${msCoop.title}: milestone paid (${milestone.amountSats} sats)`,
        relatedId: milestone.cooperationId,
        actionUrl: `/coop/${milestone.cooperationId}`,
        meta: { event: 'milestone_paid', milestoneId: milestone.id, amountSats: milestone.amountSats, role: 'partner' },
      }).catch(err => console.error('[notifications] milestone paid notify failed:', err))
    }

    if (nostrService) {
      const milestoneTicket = await prisma.ticket.findUnique({ where: { cooperationId: milestone.cooperationId } })
      if (milestoneTicket) {
        const result = await prisma.ticket.update({
          where: { id: milestoneTicket.id },
          data: { status: 'IN_PROGRESS', preimage: preimage ?? null },
        })
        updated.push(`ticket:${milestoneTicket.id}:IN_PROGRESS`)
        console.log(`[confirmPaymentByHash] Cooperation milestone ticket ${milestoneTicket.id} → IN_PROGRESS`)

        nostrService.publishTicketStatus({
          id: result.id,
          cooperationId: milestone.cooperationId,
          status: 'IN_PROGRESS',
          buyerPubkey: result.buyerPubkey,
          sellerPubkey: result.sellerPubkey,
          paymentHash,
          preimage: preimage ?? undefined,
          escrowStatus: result.escrowStatus ?? undefined,
          visibility: result.visibility === 'PRIVATE' ? 1 : 0,
        }).catch(err => console.error('[Nostr] Failed to publish Kind 30408 (CoopTicket IN_PROGRESS):', err))
      }
    }

    const allMilestones = await prisma.coopMilestone.findMany({ where: { cooperationId: milestone.cooperationId } })
    if (allMilestones.every(m => m.status === 'ACCEPTED')) {
      const completedCoop = await prisma.cooperation.findUnique({ where: { id: milestone.cooperationId } })
      await prisma.cooperation.update({ where: { id: milestone.cooperationId }, data: { status: 'COMPLETED' } })
      updated.push(`cooperation:${milestone.cooperationId}:COMPLETED`)
      console.log(`[confirmPaymentByHash] All milestones accepted — cooperation ${milestone.cooperationId} → COMPLETED`)

      if (completedCoop) {
        notifyCooperationStatusChange(prisma, {
          cooperationId: completedCoop.id,
          fromStatus: 'PAID',
          toStatus: 'COMPLETED',
          initiatorPubkey: completedCoop.initiatorPubkey,
          partnerPubkey: completedCoop.partnerPubkey,
          actingPubkey: completedCoop.initiatorPubkey,
          title: completedCoop.title,
        }).catch(err => console.error('[notifications] coop COMPLETED notify failed:', err))
      }

      if (nostrService) {
        const completedTicket = await prisma.ticket.findUnique({ where: { cooperationId: milestone.cooperationId } })
        if (completedTicket) {
          const result = await prisma.ticket.update({
            where: { id: completedTicket.id },
            data: { status: 'COMPLETED' },
          })
          updated.push(`ticket:${completedTicket.id}:COMPLETED`)
          nostrService.publishTicketStatus({
            id: result.id,
            cooperationId: milestone.cooperationId,
            status: 'COMPLETED',
            buyerPubkey: result.buyerPubkey,
            sellerPubkey: result.sellerPubkey,
            escrowStatus: result.escrowStatus ?? undefined,
            visibility: result.visibility === 'PRIVATE' ? 1 : 0,
          }).catch(err => console.error('[Nostr] Failed to publish Kind 30408 (CoopTicket COMPLETED):', err))
        }
      }
    }
  }

  if (invoiceMap) {
    const stored = invoiceMap.get(paymentHash)
    if (stored) {
      stored.status = 'PAID'
      invoiceMap.set(paymentHash, stored)
    }
  }

  if (updated.length === 0) {
    console.log(`[confirmPaymentByHash] No matching entity for payment_hash: ${paymentHash}`)
  }

  return updated
}

export interface ResolvedPaymentEntity {
  kind: 'ticket' | 'cooperation' | 'milestone'
  amountSats: number
  ownerPubkey: string
}

// ADR-241 D2: DB-first amount + ownership resolution for a paymentHash, used by
// /api/beta/demo-pay so the buyer/initiator identity is verified server-side
// instead of trusting whoever calls the route with a valid hash (the ADR-221
// pattern applied to the beta money route). storedInvoices (in-memory, restart
// -lossy) is only a fallback for phase-hash amount lookups elsewhere; this
// resolver never falls back to it — no matching entity means no confirmed owner.
export async function resolvePaymentEntity(
  prisma: PrismaClient,
  paymentHash: string,
): Promise<ResolvedPaymentEntity | null> {
  const ticket = await prisma.ticket.findFirst({
    where: {
      OR: [
        { paymentHash },
        { escrowPhase1Hash: paymentHash },
        { escrowPhase2Hash: paymentHash },
        { escrowPhase3Hash: paymentHash },
      ],
    },
  })
  if (ticket) {
    let amountSats = ticket.amountSats ?? 0
    if (ticket.escrowEnabled && amountSats > 0) {
      const { phase1, phase2, phase3 } = computeEscrowPhaseAmounts(amountSats)
      if (ticket.escrowPhase1Hash === paymentHash) amountSats = phase1
      else if (ticket.escrowPhase2Hash === paymentHash) amountSats = phase2
      else if (ticket.escrowPhase3Hash === paymentHash) amountSats = phase3
    }
    return { kind: 'ticket', amountSats, ownerPubkey: ticket.buyerPubkey }
  }

  const cooperation = await prisma.cooperation.findFirst({ where: { paymentHash } })
  if (cooperation) {
    return { kind: 'cooperation', amountSats: cooperation.budgetSats, ownerPubkey: cooperation.initiatorPubkey }
  }

  const milestone = await prisma.coopMilestone.findFirst({
    where: { paymentHash },
    include: { cooperation: { select: { initiatorPubkey: true } } },
  })
  if (milestone) {
    return { kind: 'milestone', amountSats: milestone.amountSats, ownerPubkey: milestone.cooperation.initiatorPubkey }
  }

  return null
}
