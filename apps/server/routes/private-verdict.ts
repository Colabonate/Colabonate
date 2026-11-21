/**
 * Private-Verdict Router — Phase 2.8 (ADR-152 §A4 / PROB-002 A2)
 *
 * Implements the mutual-arbiter verdict submission for private-mode ticket
 * disputes. Distinct from the public DAO-Council verdict path
 * (`dispute.ts::POST /disputes/:id/verdict`) which requires a daoMember
 * role. The private path uses the `PrivateArbiter` table to track
 * nomiation + acceptance state, then records the verdict against the
 * accepted nomination row.
 *
 * Routes (mounted under /api):
 *  - POST /tickets/:id/private-verdict — arbiter submits a signed verdict
 *
 * Server-side guards (defense in depth):
 *  - ticket.disputeMode === 'PRIVATE' (else 409)
 *  - dispute row exists + status === 'OPEN' (else 409)
 *  - the caller is the accepted arbiter for this ticket (else 403)
 *  - the signed event has a valid Schnorr signature (else 401)
 *  - the signed event pubkey matches the accepted arbiter pubkey (else 401)
 *  - the outcome is one of RELEASE | CANCEL (else 400)
 *
 * On success:
 *  - updates PrivateArbiter row with verdictOutcome + verdictReasoning
 *    + verdictNostrEventId + updatedAt
 *  - updates Dispute row → RESOLVED, outcome, verdictIssuedAt, resolvedAt,
 *    arbitratorPubkey
 *  - settles (RELEASE) or cancels (CANCEL) the ticket's hold invoices
 *  - updates Ticket status to COMPLETED (RELEASE) or CANCELLED (CANCEL)
 *  - creates DmMessage inbox rows for buyer + seller (notification)
 */

import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import type { PaymentProvider } from '@col/payments'
import { verifyEvent, type Event as NostrToolsEvent } from 'nostr-tools'
import { notifyDisputants } from '../services/email-notifier.js'
import { requireAuth } from '../middleware/require-auth.js'
import { sanitiseUpstreamError } from '../lib/sanitise-error.js'
import { recomputeTrustScore } from '../services/agentTrustService.js'
import { enqueueCanvasLifecycleForTicket } from '../services/canvas-lifecycle.js'
import { notifyVerdictIssued } from '../services/notifications.js'

export function createPrivateVerdictRouter(
  prisma: PrismaClient,
  payments: PaymentProvider,
) {
  const router = Router()

  // POST /tickets/:id/private-verdict ------------------------------------
  // requireAuth is defense in depth on top of the Schnorr-signature check
  // below — the verdict itself is authorized by the signed event, but the
  // endpoint should not be reachable anonymously (per-route because the
  // router is mounted on the shared '/api' path).
  router.post('/tickets/:id/private-verdict', requireAuth(prisma), async (req: Request, res: Response) => {
    try {
      const ticketId = req.params.id as string
      const { arbiterPubkey, outcome, reasoning, signedEvent, sellerPct, buyerPct, feePct } = req.body as {
        arbiterPubkey?: string
        outcome?: string
        reasoning?: string
        signedEvent?: {
          id?: string
          pubkey?: string
          created_at?: number
          kind?: number
          tags?: string[][]
          content?: string
          sig?: string
        }
        sellerPct?: number
        buyerPct?: number
        feePct?: number
      }

      // -- Input validation --
      if (!arbiterPubkey) {
        return res.status(400).json({ error: 'arbiterPubkey is required' })
      }
      if (!/^[0-9a-fA-F]{64}$/.test(arbiterPubkey)) {
        return res.status(400).json({ error: 'arbiterPubkey must be a 64-char hex string' })
      }
      if (!outcome || !['RELEASE', 'CANCEL', 'SPLIT'].includes(outcome)) {
        return res.status(400).json({ error: 'outcome must be RELEASE, CANCEL or SPLIT' })
      }

      // ADR-184: SPLIT validation. Mixed percentage settlement is deferred.
      let effectiveOutcome = outcome
      if (outcome === 'SPLIT') {
        if (typeof sellerPct !== 'number' || typeof buyerPct !== 'number') {
          return res.status(400).json({ error: 'SPLIT requires sellerPct and buyerPct' })
        }
        const fee = feePct ?? 0
        if (sellerPct + buyerPct + fee !== 100) {
          return res.status(400).json({ error: 'sellerPct + buyerPct + feePct must equal 100' })
        }
        if (sellerPct === 100 && buyerPct === 0 && fee === 0) {
          effectiveOutcome = 'RELEASE'
        } else if (buyerPct === 100 && sellerPct === 0 && fee === 0) {
          effectiveOutcome = 'CANCEL'
        } else {
          return res.status(501).json({
            error: 'MIXED_SPLIT_NOT_IMPLEMENTED',
            message: 'Mixed-percentage SPLIT settlement requires sub-invoice or post-verdict payout design (ADR-184 follow-up).',
          })
        }
      }
      if (!signedEvent) {
        return res.status(400).json({ error: 'signedEvent is required (Schnorr-signed Nostr event)' })
      }
      if (!signedEvent.id || !signedEvent.pubkey || !signedEvent.sig) {
        return res.status(400).json({ error: 'signedEvent must include id, pubkey, sig' })
      }
      if (signedEvent.kind !== undefined && signedEvent.kind !== 30022) {
        return res.status(400).json({ error: 'signedEvent.kind must be 30022 (verdict event)' })
      }
      if (signedEvent.pubkey.toLowerCase() !== arbiterPubkey.toLowerCase()) {
        return res.status(401).json({ error: 'signedEvent.pubkey must match arbiterPubkey' })
      }

      // -- Signature verification --
      // The arbiter signs a Kind 30022 Nostr event with their privkey. We
      // verify the Schnorr signature using nostr-tools' verifyEvent. This
      // proves the caller has the privkey for the nominated+accepted
      // arbiter pubkey, which is the cryptographic anchor of trust.
      let signatureValid = false
      try {
        signatureValid = verifyEvent(signedEvent as unknown as NostrToolsEvent)
      } catch (sigErr) {
        console.error('[private-verdict] verifyEvent threw:', sigErr)
      }
      if (!signatureValid) {
        return res.status(401).json({ error: 'Schnorr signature verification failed' })
      }

      // -- Ticket + dispute state --
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: { offer: true },
      })
      if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found' })
      }
      if (ticket.disputeMode !== 'PRIVATE') {
        return res.status(409).json({
          error: 'PRIVATE_VERDICT_NOT_APPLICABLE',
          message: 'This ticket does not use private (mutual-arbiter) dispute mode',
        })
      }
      if (ticket.status !== 'DISPUTED') {
        return res.status(409).json({
          error: 'TICKET_NOT_DISPUTED',
          message: `Ticket status is ${ticket.status}, expected DISPUTED`,
        })
      }

      // -- Verify arbiter role (nominated + accepted for this ticket) --
      const nomination = await prisma.privateArbiter.findUnique({
        where: { ticketId_arbiterPubkey: { ticketId, arbiterPubkey: arbiterPubkey.toLowerCase() } },
      })
      if (!nomination) {
        return res.status(403).json({
          error: 'NOT_NOMINATED',
          message: 'This pubkey has not been nominated as arbiter for this ticket',
        })
      }
      if (!nomination.acceptedAt) {
        return res.status(403).json({
          error: 'NOT_ACCEPTED',
          message: 'The nominated arbiter has not accepted the role yet',
        })
      }
      if (nomination.verdictOutcome) {
        return res.status(409).json({
          error: 'VERDICT_ALREADY_SUBMITTED',
          message: `A verdict (${nomination.verdictOutcome}) has already been recorded for this ticket`,
        })
      }

      // -- Verify dispute is OPEN --
      const dispute = await prisma.dispute.findFirst({
        where: { ticketId, status: 'OPEN' },
      })
      if (!dispute) {
        return res.status(409).json({
          error: 'NO_OPEN_DISPUTE',
          message: 'No OPEN dispute found for this ticket — the dispute may already be resolved',
        })
      }

      // -- Apply the verdict --
      const verdictOutcome = effectiveOutcome as 'RELEASE' | 'CANCEL'
      const newDisputeStatus = 'RESOLVED'

      // 1. Settle or cancel hold invoices (with try/catch — escrow failure
      //    must not corrupt the verdict record, but the status update
      //    reflects the verdict, not the escrow outcome. We log failures).
      let escrowAction: 'released' | 'cancelled' | 'partial_failure' = 'cancelled'
      const escrowFailures: string[] = []

      // ADR-184: resolve sub-wallet provider for escrow ops (FU-02).
      const provider = ticket.offer?.lightningSubWalletAdminKey && (payments as any).createSubWalletProvider
        ? (payments as any).createSubWalletProvider(ticket.offer.lightningSubWalletAdminKey)
        : payments

      if (verdictOutcome === 'RELEASE') {
        escrowAction = 'released'
        const preimages = [
          ticket.escrowPhase1Preimage,
          ticket.escrowPhase2Preimage,
          ticket.escrowPhase3Preimage,
        ].filter(Boolean) as string[]

        for (const preimage of preimages) {
          try {
            await provider.settleHoldInvoice(preimage)
          } catch (err) {
            console.error('[private-verdict] Failed to settle hold invoice:', err)
            // FU-26 (ADR-179): escrowFailures is returned to the client below — never
            // echo the raw upstream message, it can contain internal provider detail.
            escrowFailures.push(`settle: ${sanitiseUpstreamError(err)}`)
          }
        }
        if (escrowFailures.length > 0 && escrowFailures.length < preimages.length) {
          escrowAction = 'partial_failure'
        }
      } else {
        const hashes = [
          ticket.escrowPhase1Hash,
          ticket.escrowPhase2Hash,
          ticket.escrowPhase3Hash,
        ].filter(Boolean) as string[]

        for (const hash of hashes) {
          try {
            await provider.cancelHoldInvoice(hash)
          } catch (err) {
            console.error('[private-verdict] Failed to cancel hold invoice:', err)
            escrowFailures.push(`cancel: ${sanitiseUpstreamError(err)}`)
          }
        }
        if (escrowFailures.length > 0 && escrowFailures.length < hashes.length) {
          escrowAction = 'partial_failure'
        }
      }

      // 2. Update PrivateArbiter row with verdict metadata
      const updatedNomination = await prisma.privateArbiter.update({
        where: { ticketId_arbiterPubkey: { ticketId, arbiterPubkey: arbiterPubkey.toLowerCase() } },
        data: {
          verdictOutcome: verdictOutcome,
          verdictReasoning: reasoning ?? null,
          verdictNostrEventId: signedEvent.id,
          sellerPct: outcome === 'SPLIT' ? sellerPct : null,
          buyerPct: outcome === 'SPLIT' ? buyerPct : null,
          feePct: outcome === 'SPLIT' ? (feePct ?? null) : null,
        },
      })

      // 3. Update Ticket status (RELEASE → COMPLETED, CANCEL → CANCELLED)
      const ticketUpdate =
        verdictOutcome === 'RELEASE'
          ? {
              escrowStatus: 'RELEASED',
              status: 'COMPLETED' as const,
              deliveryConfirmedAt: new Date(),
              escrowPhase1Deadline: null,
              escrowPhase2Deadline: null,
              escrowPhase3Deadline: null,
              escrowAutoReleaseDeadline: null,
            }
          : {
              escrowStatus: 'CANCELLED',
              status: 'CANCELLED' as const,
              escrowPhase1Deadline: null,
              escrowPhase2Deadline: null,
              escrowPhase3Deadline: null,
              escrowAutoReleaseDeadline: null,
            }
      const updatedTicket = await prisma.ticket.update({
        where: { id: ticketId },
        data: ticketUpdate,
      })

      // ADR-374 FU-696: server-backed notification for both disputants
      // (best-effort — never fails the verdict).
      notifyVerdictIssued(prisma, {
        ticketId,
        buyerPubkey: ticket.buyerPubkey,
        sellerPubkey: ticket.sellerPubkey,
        outcome: verdictOutcome,
        offerTitle: ticket.offer?.title,
      }).catch((err) => console.error('[notifications] private-verdict failed:', err instanceof Error ? err.message : err))

      // ADR-353: verdict outcomes are terminal — freeze the hosted canvas
      // read-only. Async via outbox, never blocks the verdict.
      await enqueueCanvasLifecycleForTicket(prisma, ticketId, ticket.status, updatedTicket.status).catch((err) =>
        console.error('[canvas-lifecycle] enqueue on private verdict failed:', err instanceof Error ? err.message : err),
      )

      // 4. Update Dispute row
      const updatedDispute = await prisma.dispute.update({
        where: { id: dispute.id },
        data: {
          status: newDisputeStatus,
          outcome: verdictOutcome,
          verdictIssuedAt: new Date(),
          resolvedAt: new Date(),
          arbitratorPubkey: arbiterPubkey.toLowerCase(),
        },
      })

      // ADR-318 D5: same trust-score wiring as the public DAO-Council path
      // (dispute.ts) — CANCEL counts as a lost dispute for the agent.
      if (ticket.offer?.offerType === 'AGENT_SETUP' && ticket.offer.agentProfileId) {
        try {
          await recomputeTrustScore(ticket.offer.agentProfileId, prisma)
        } catch (err) {
          console.error('[PrivateVerdict] recomputeTrustScore failed (non-fatal, verdict already committed):', err)
        }
      }

      // 5. Create DmMessage inbox rows for buyer + seller (notification).
      //    These are plaintext cache rows (Kind 14) so the existing
      //    /api/nostr/dm/private-offers endpoint returns them in the
      //    buyer's and seller's inbox. Peer = the arbiter (the verdict's
      //    source of truth). Visibility = PRIVATE.
      const verdictPayload = JSON.stringify({
        type: 'verdict',
        ticketId,
        outcome: verdictOutcome,
        reasoning: reasoning ?? '',
        arbiterPubkey: arbiterPubkey.toLowerCase(),
        verdictNostrEventId: signedEvent.id,
        timestamp: signedEvent.created_at ?? Math.floor(Date.now() / 1000),
      })
      const verdictEventId = signedEvent.id // unique Nostr event id
      for (const ownerPubkey of [ticket.buyerPubkey, ticket.sellerPubkey]) {
        try {
          await prisma.dmMessage.upsert({
            where: { eventId: verdictEventId + ':' + ownerPubkey },
            create: {
              ownerPubkey,
              peerPubkey: arbiterPubkey.toLowerCase(),
              eventId: verdictEventId + ':' + ownerPubkey,
              kind: 14,
              payload: verdictPayload,
              ticketId,
              visibility: 'PRIVATE',
            },
            update: {}, // Idempotent: never overwrite
          })
        } catch (dmErr) {
          // Don't fail the verdict if the notification write fails — log
          // and continue. The user can also see the verdict via the
          // ticket status update.
          console.error(`[private-verdict] Failed to write DmMessage for ${ownerPubkey.slice(0, 8)}…:`, dmErr)
        }
      }

      // 6. Fire-and-forget email notification (best-effort, same pattern
      //    as the public dispute path)
      setImmediate(() => {
        notifyDisputants(prisma, ticket.buyerPubkey, ticket.sellerPubkey, {
          type: 'verdict_issued',
          disputeId: dispute.disputeId,
          ticketId,
          ticketShortId: ticketId.slice(0, 8),
          outcome: verdictOutcome,
        }).catch(err => console.error('[EmailNotifier] notifyDisputants failed:', err))
      })

      console.log(
        `[private-verdict] Arbiter ${arbiterPubkey.slice(0, 8)}… issued ${verdictOutcome} for ticket ${ticketId.slice(0, 8)}… (escrow: ${escrowAction})`,
      )

      return res.json({
        success: true,
        verdict: {
          nomination: updatedNomination,
          dispute: updatedDispute,
          ticket: updatedTicket,
          outcome: verdictOutcome,
          escrowAction,
          escrowFailures: escrowFailures.length > 0 ? escrowFailures : undefined,
          signedEventId: signedEvent.id,
        },
        // Return a re-shaped event template that the client can publish if
        // it wants to surface the verdict publicly (similar to the public
        // dispute verdict's nostrEventTemplate).
        nostrEventTemplate: {
          kind: 30022,
          pubkey: arbiterPubkey.toLowerCase(),
          created_at: signedEvent.created_at ?? Math.floor(Date.now() / 1000),
          tags: [
            ['d', signedEvent.id],
            ['sub_type', 'private_arbiter_verdict'],
            ['ticket_id', ticketId],
            ['outcome', verdictOutcome],
            ['visibility', 'PRIVATE'],
          ],
          content: JSON.stringify({
            type: 'private_arbiter_verdict',
            ticket_id: ticketId,
            arbiter_pubkey: arbiterPubkey.toLowerCase(),
            outcome: verdictOutcome,
            reasoning: reasoning ?? '',
            signed_event_id: signedEvent.id,
          }),
        },
      })
    } catch (err) {
      console.error('[private-verdict] submit failed:', err)
      return res.status(500).json({ error: 'Failed to submit private verdict' })
    }
  })

  return router
}
