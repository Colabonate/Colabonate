import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import type { PaymentProvider } from '@col/payments'
import { evaluateQuorum } from '../services/quorum.js'
import { notifyArbitrators, notifyDisputants } from '../services/email-notifier.js'
import { nostrService as _defaultNostrService } from '../services/nostr-relay.js'
import { isDaoArbitrable } from '../services/tradeVisibility.js'
import { verifyPayloadCommitment, type CommercialPayload } from '@col/nostr-schema'
import type { Filter, Event } from 'nostr-tools'
import { requireAuth } from '../middleware/require-auth.js'
import { enforceCallerIdentity } from '../middleware/enforce-caller-identity.js'
import { casTicketUpdate } from '../services/escrow-state.js'
import { enqueueCanvasLifecycleForTicket } from '../services/canvas-lifecycle.js'
import { logCritical } from '../lib/critical-alert.js'
import { AgentDisputeTypeSchema } from '../lib/enums.js'
import { recomputeTrustScore } from '../services/agentTrustService.js'
import { notifyDisputeOpened, notifyVerdictIssued, notifyDisputeEscalated, notifyArbiterNominated, notifyArbiterAccepted } from '../services/notifications.js'

export interface NostrServiceLike {
  publishDispute: typeof _defaultNostrService.publishDispute
  getEvents(filter: Filter, timeoutMs: number): Promise<Event[]>
}

const FOUNDATION_DAO_ID = 'colabonate-foundation'
const DISCLOSURE_WINDOW_HOURS = 72

export interface DisputeEventTemplate {
  kind: 30020
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
}

export interface VerdictEventTemplate {
  kind: 30022
  pubkey: string
  created_at: number
  tags: string[][]
  content: string
}

export function createDisputeRouter(
  prisma: PrismaClient,
  payments: PaymentProvider,
  nostrService: NostrServiceLike = _defaultNostrService,
) {
  const router = Router()

  // Dispute routes decide money flow (verdict/escalate/appeal) and expose
  // private trade data (details/disclosures). Every route needs a valid
  // session, and a claimed callerPubkey must equal the session identity so
  // the buyer/seller/arbitrator checks below operate on a verified caller.
  // Applied per-route because this router is mounted on the shared '/api'
  // path — a bare router.use() would gate unrelated routes.
  const guard = [requireAuth(prisma), enforceCallerIdentity] as const

  prisma.dispute.updateMany({
    where: {
      disclosureDeadline: null,
      status: { in: ['OPEN', 'COUNCIL_QUEUE', 'IN_REVIEW'] },
      ticket: { visibility: { not: 'PUBLIC' } },
    },
    data: { disclosureDeadline: new Date(Date.now() + DISCLOSURE_WINDOW_HOURS * 3600_000) },
  }).then(count => {
    if (count.count > 0) console.log(`[Disclosure] Backfilled disclosureDeadline for ${count.count} existing disputes`)
  }).catch(err => console.warn('[Disclosure] Backfill failed (column may not exist yet):', err))

  router.post('/tickets/:id/dispute', ...guard, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string
      const { callerPubkey, reason, details, agentDisputeType } = req.body as {
        callerPubkey?: string
        reason?: string
        details?: string
        agentDisputeType?: string
      }

      if (!callerPubkey) {
        return res.status(400).json({ error: 'callerPubkey is required' })
      }

      if (!reason) {
        return res.status(400).json({ error: 'reason is required' })
      }

      const ticket = await prisma.ticket.findUnique({
        where: { id },
        include: { offer: true },
      })

      if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found' })
      }

      // ADR-318 D5: agentDisputeType is a buyer-self-reported classification,
      // only meaningful (and only accepted) on AGENT_SETUP tickets.
      let validatedAgentDisputeType: string | undefined
      if (agentDisputeType !== undefined) {
        if (ticket.offerType !== 'AGENT_SETUP') {
          return res.status(400).json({ error: 'agentDisputeType is only valid for AGENT_SETUP tickets' })
        }
        const parsed = AgentDisputeTypeSchema.safeParse(agentDisputeType)
        if (!parsed.success) {
          return res.status(400).json({ error: 'agentDisputeType must be one of TIMEOUT, QUALITY, PROOF_MISSING, CONFIG_LEAK' })
        }
        validatedAgentDisputeType = parsed.data
      }

      if (ticket.daoId === null) {
        return res.status(409).json({ error: 'Ticket has opted out of DAO disputes' })
      }

      // ADR-152 §A4 / PROB-002 A2: gate disputes by ticket.disputeMode
      // - NONE: no dispute protection at all (UI warning shown at trade creation)
      // - PRIVATE: require a mutually-accepted PrivateArbiter row before a
      //            dispute can be opened. Caller must either nominate one
      //            in this request or one must already exist.
      // - PUBLIC: current behavior — DAO-Council arbitrates (default).
      if (ticket.disputeMode === 'NONE') {
        return res.status(403).json({
          error: 'NO_DISPUTE_PROTECTION',
          message: 'This trade has no dispute protection (disputeMode=NONE). Private trade without mutual arbiter.',
        })
      }

      if (ticket.disputeMode === 'PRIVATE' && !isDaoArbitrable(ticket.disputeMode)) {
        // For PRIVATE disputeMode, require an accepted mutual arbiter.
        // We accept an optional `arbiterPubkey` in the body — if provided,
        // we record the nomination; otherwise the caller must nominate one
        // first via POST /api/tickets/:id/nominate-arbiter.
        const nominatedArbiter = req.body.arbiterPubkey as string | undefined
        const existing = await prisma.privateArbiter.findFirst({
          where: { ticketId: id, acceptedAt: { not: null } },
        })
        if (!existing && !nominatedArbiter) {
          return res.status(409).json({
            error: 'MUTUAL_ARBITER_REQUIRED',
            message: 'Private trade disputes require a mutually-accepted arbiter. Nominate one via POST /api/tickets/:id/nominate-arbiter first.',
          })
        }
        if (nominatedArbiter) {
          // Record nomination by caller; the other party must accept before dispute opens.
          const isBuyer = callerPubkey === ticket.buyerPubkey
          const isSeller = callerPubkey === ticket.sellerPubkey
          if (!isBuyer && !isSeller) {
            return res.status(403).json({ error: 'Only buyer or seller can nominate an arbiter' })
          }
          await prisma.privateArbiter.upsert({
            where: { ticketId_arbiterPubkey: { ticketId: id, arbiterPubkey: nominatedArbiter } },
            create: {
              ticketId: id,
              arbiterPubkey: nominatedArbiter,
              nominatedByBuyer: isBuyer,
              nominatedBySeller: isSeller,
            },
            update: {
              nominatedByBuyer: isBuyer ? { set: true } : undefined,
              nominatedBySeller: isSeller ? { set: true } : undefined,
            },
          })
          return res.status(202).json({
            status: 'arbiter_nominated',
            message: 'Arbiter nominated. The other party must also nominate this arbiter (or accept it) before the dispute can be opened.',
            arbiterPubkey: nominatedArbiter,
          })
        }
      }

      if (callerPubkey !== ticket.buyerPubkey && callerPubkey !== ticket.sellerPubkey) {
        return res.status(403).json({ error: 'Only buyer or seller can open a dispute' })
      }

      const existingDispute = await prisma.dispute.findFirst({
        where: { ticketId: id, status: { in: ['OPEN', 'COUNCIL_QUEUE', 'IN_REVIEW'] } },
      })

      if (existingDispute) {
        return res.status(409).json({ error: 'An active dispute already exists for this ticket' })
      }

      const disputeId = `dispute-${Date.now()}-${id.slice(0, 8)}`

      const nostrEventTemplate: DisputeEventTemplate = {
        kind: 30020,
        pubkey: callerPubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', disputeId],
          ['ticket', id],
          ['ticket_type', ticket.ticketType],
          ['reason', reason],
          ['dao_id', FOUNDATION_DAO_ID],
        ],
        content: JSON.stringify({
          dispute_id: disputeId,
          ticket_id: id,
          dao_id: FOUNDATION_DAO_ID,
          reason,
          details: details || '',
          opened_by: callerPubkey,
        }),
      }

      const dispute = await prisma.dispute.create({
        data: {
          disputeId,
          ticketId: id,
          daoId: FOUNDATION_DAO_ID,
          status: 'OPEN',
          disclosureDeadline: ticket.visibility !== 'PUBLIC'
            ? new Date(Date.now() + DISCLOSURE_WINDOW_HOURS * 3600_000)
            : null,
        },
        include: { ticket: { include: { offer: true } }, verdicts: true },
      })

      const DISPUTABLE_ESCROW_STATES = ['DELIVERY_STARTED', 'DELIVERY_CONFIRMED']
      if (DISPUTABLE_ESCROW_STATES.includes(ticket.escrowStatus)) {
        // CAS against the freeze-eligible states: if the ticket already left
        // this window concurrently (e.g. auto-released or cancelled between
        // our read above and this write), do NOT silently relabel an
        // already-resolved ticket as DISPUTED — that would freeze deadlines
        // on a ticket that no longer has any to freeze and mislead an
        // arbitrator into adjudicating funds that already moved.
        const ok = await casTicketUpdate(prisma, id, DISPUTABLE_ESCROW_STATES, {
          status: 'DISPUTED',
          disputeReason: reason,
          agentDisputeType: validatedAgentDisputeType,
          escrowStatus: 'DISPUTED',
          escrowPhase1Deadline: null,
          escrowPhase2Deadline: null,
          escrowPhase3Deadline: null,
          escrowAutoReleaseDeadline: null,
        })
        if (!ok) {
          logCritical('Dispute', `ticket ${id} escrow state changed concurrently while opening dispute ${disputeId} — dispute record may be orphaned relative to escrow state, needs manual review`)
        }
      } else {
        await prisma.ticket.update({
          where: { id },
          data: { status: 'DISPUTED', disputeReason: reason, agentDisputeType: validatedAgentDisputeType },
        })
      }

      // ADR-353: DISPUTED is terminal — freeze the hosted canvas read-only
      // (evidence preservation). Async via outbox, never blocks the dispute.
      await enqueueCanvasLifecycleForTicket(prisma, id, ticket.status, 'DISPUTED').catch((err) =>
        console.error('[canvas-lifecycle] enqueue on dispute open failed:', err instanceof Error ? err.message : err),
      )

      console.log(`[Dispute] Opened dispute ${disputeId} for ticket ${id}`)

      // ADR-374: server-backed in-app notification for the non-opening party
      // (best-effort — a notification write never fails the dispute open).
      notifyDisputeOpened(prisma, {
        ticketId: id,
        buyerPubkey: ticket.buyerPubkey,
        sellerPubkey: ticket.sellerPubkey,
        openedByPubkey: callerPubkey,
        offerTitle: ticket.offer?.title,
      }).catch((err) => console.error('[notifications] dispute-opened failed:', err instanceof Error ? err.message : err))

      setImmediate(() => {
        nostrService.publishDispute({
          id: disputeId,
          ticketId: id,
          ticketType: ticket.ticketType,
          daoId: FOUNDATION_DAO_ID,
          reason,
          details,
          openedByPubkey: callerPubkey,
          buyerPubkey: ticket.buyerPubkey,
          sellerPubkey: ticket.sellerPubkey,
        }).catch(err => console.error('[Nostr] publishDispute failed:', err))
      })

      setImmediate(() => {
        notifyArbitrators(prisma, FOUNDATION_DAO_ID, {
          type: 'dispute_opened',
          disputeId: dispute.id,
          ticketId: id,
          ticketShortId: id.slice(0, 8),
        }).catch(err => console.error('[EmailNotifier] notifyArbitrators failed:', err))
      })

      res.json({
        success: true,
        dispute,
        nostrEventTemplate,
      })
    } catch (error) {
      console.error('Failed to open dispute:', error)
      res.status(500).json({ error: 'Failed to open dispute' })
    }
  })

  // ADR-152 §A4 / PROB-002 A2 — Mutual-Arbiter-Pattern for private disputes.
  // Both buyer and seller must nominate the same npub, then the arbiter
  // must accept. Only then can a private-mode dispute be opened.

  // POST /tickets/:id/nominate-arbiter — caller (buyer or seller) nominates an npub
  router.post('/tickets/:id/nominate-arbiter', ...guard, async (req: Request, res: Response) => {
    try {
      const ticketId = req.params.id as string
      const { callerPubkey, arbiterPubkey } = req.body as { callerPubkey?: string; arbiterPubkey?: string }
      if (!callerPubkey || !arbiterPubkey) {
        return res.status(400).json({ error: 'callerPubkey and arbiterPubkey are required' })
      }
      if (!/^[0-9a-fA-F]{64}$/.test(arbiterPubkey)) {
        return res.status(400).json({ error: 'arbiterPubkey must be a 64-char hex string' })
      }
      const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
      if (!ticket) return res.status(404).json({ error: 'Ticket not found' })
      if (ticket.disputeMode !== 'PRIVATE') {
        return res.status(409).json({
          error: 'MUTUAL_ARBITER_NOT_APPLICABLE',
          message: 'Mutual-arbiter nomination is only valid for tickets with disputeMode=PRIVATE',
        })
      }
      const isBuyer = callerPubkey === ticket.buyerPubkey
      const isSeller = callerPubkey === ticket.sellerPubkey
      if (!isBuyer && !isSeller) {
        return res.status(403).json({ error: 'Only buyer or seller can nominate an arbiter' })
      }
      const existing = await prisma.privateArbiter.findUnique({
        where: { ticketId_arbiterPubkey: { ticketId, arbiterPubkey } },
      })
      if (existing && existing.acceptedAt) {
        return res.status(409).json({ error: 'Arbiter has already accepted — dispute can be opened' })
      }
      const nomination = await prisma.privateArbiter.upsert({
        where: { ticketId_arbiterPubkey: { ticketId, arbiterPubkey } },
        create: {
          ticketId,
          arbiterPubkey,
          nominatedByBuyer: isBuyer,
          nominatedBySeller: isSeller,
        },
        update: {
          nominatedByBuyer: isBuyer ? { set: true } : undefined,
          nominatedBySeller: isSeller ? { set: true } : undefined,
        },
      })
      const bothNominated = nomination.nominatedByBuyer && nomination.nominatedBySeller
      // ADR-374 FU-696: notify the OTHER party when one side first nominates
      // (skip re-nominations by the same caller and the both-nominated state).
      const callerAlreadyNominated = isBuyer ? existing?.nominatedByBuyer : existing?.nominatedBySeller
      if (!bothNominated && !callerAlreadyNominated) {
        notifyArbiterNominated(prisma, {
          ticketId,
          buyerPubkey: ticket.buyerPubkey,
          sellerPubkey: ticket.sellerPubkey,
          nominatorPubkey: callerPubkey,
          arbiterPubkey,
        }).catch((err) => console.error('[notifications] arbiter-nominated failed:', err instanceof Error ? err.message : err))
      }
      return res.json({
        nomination,
        awaiting: bothNominated ? 'arbiter_acceptance' : 'other_party_nomination',
      })
    } catch (err) {
      console.error('[dispute] nominate-arbiter failed:', err)
      return res.status(500).json({ error: 'Failed to nominate arbiter' })
    }
  })

  // POST /tickets/:id/accept-arbiter — the nominated arbiter accepts the role
  router.post('/tickets/:id/accept-arbiter', ...guard, async (req: Request, res: Response) => {
    try {
      const ticketId = req.params.id as string
      const { arbiterPubkey, arbiterSignature } = req.body as { arbiterPubkey?: string; arbiterSignature?: string }
      if (!arbiterPubkey) {
        return res.status(400).json({ error: 'arbiterPubkey is required' })
      }
      const nomination = await prisma.privateArbiter.findUnique({
        where: { ticketId_arbiterPubkey: { ticketId, arbiterPubkey } },
      })
      if (!nomination) {
        return res.status(404).json({ error: 'No nomination found for this arbiter on this ticket' })
      }
      if (!nomination.nominatedByBuyer || !nomination.nominatedBySeller) {
        return res.status(409).json({
          error: 'BOTH_PARTIES_REQUIRED',
          message: 'Both buyer and seller must nominate this arbiter before they can accept.',
          nomination,
        })
      }
      // For now: trust the signature field presence (real verification via NIP-17 DM
      // happens in Phase 2 when we wire the verdict-submission flow). This endpoint
      // is the placeholder that flips the row from "nominated" to "accepted".
      void arbiterSignature // accepted in body, verified in Phase 2 verdict route
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { buyerPubkey: true, sellerPubkey: true },
      })
      if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found' })
      }
      const updated = await prisma.privateArbiter.update({
        where: { ticketId_arbiterPubkey: { ticketId, arbiterPubkey } },
        data: { acceptedAt: new Date() },
      })
      // ADR-374 FU-696: notify BOTH disputants that the arbiter accepted.
      notifyArbiterAccepted(prisma, {
        ticketId,
        buyerPubkey: ticket.buyerPubkey,
        sellerPubkey: ticket.sellerPubkey,
        arbiterPubkey,
      }).catch((err) => console.error('[notifications] arbiter-accepted failed:', err instanceof Error ? err.message : err))
      return res.json({ nomination: updated, status: 'accepted' })
    } catch (err) {
      console.error('[dispute] accept-arbiter failed:', err)
      return res.status(500).json({ error: 'Failed to accept arbiter' })
    }
  })

  // GET /tickets/:id/arbiters — list the nomination state for a ticket
  router.get('/tickets/:id/arbiters', ...guard, async (req: Request, res: Response) => {
    try {
      const ticketId = req.params.id as string
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { id: true, disputeMode: true, buyerPubkey: true, sellerPubkey: true },
      })
      if (!ticket) return res.status(404).json({ error: 'Ticket not found' })
      const nominations = await prisma.privateArbiter.findMany({
        where: { ticketId },
        orderBy: { createdAt: 'asc' },
      })
      const hasAccepted = nominations.some(n => n.acceptedAt !== null)
      return res.json({
        ticket,
        nominations,
        ready_for_dispute: hasAccepted,
      })
    } catch (err) {
      console.error('[dispute] list-arbiters failed:', err)
      return res.status(500).json({ error: 'Failed to list arbiters' })
    }
  })

  router.post('/disputes/:id/escalate', ...guard, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string
      const { callerPubkey } = req.body as { callerPubkey?: string }

      if (!callerPubkey) {
        return res.status(400).json({ error: 'callerPubkey is required' })
      }

      const dispute = await prisma.dispute.findUnique({
        where: { id },
        include: { ticket: { include: { offer: true } } },
      })

      if (!dispute) {
        return res.status(404).json({ error: 'Dispute not found' })
      }

      if (dispute.status !== 'OPEN') {
        return res.status(409).json({ error: `Cannot escalate from status ${dispute.status}` })
      }

      if (callerPubkey !== dispute.ticket.buyerPubkey && callerPubkey !== dispute.ticket.sellerPubkey) {
        return res.status(403).json({ error: 'Only disputants can escalate' })
      }

      const config = await prisma.daoConfig.findUnique({
        where: { daoId: FOUNDATION_DAO_ID },
      })

      if (!config) {
        return res.status(500).json({ error: 'DAO config not found' })
      }

      const coolingOffMs = config.coolingOffDays * 24 * 60 * 60 * 1000
      if (Date.now() - dispute.openedAt.getTime() < coolingOffMs) {
        return res.status(409).json({
          error: 'Cooling-off period not elapsed',
          coolingOffDays: config.coolingOffDays,
          openedAt: dispute.openedAt.toISOString(),
        })
      }

      const updated = await prisma.dispute.update({
        where: { id },
        data: {
          status: 'COUNCIL_QUEUE',
          escalatedAt: new Date(),
          quorumTypeSnapshot: config.quorumType,
          thresholdNSnapshot: config.thresholdN,
        },
        include: { verdicts: true },
      })

      console.log(`[Dispute] Escalated dispute ${id} to COUNCIL_QUEUE`)

      setImmediate(() => {
        notifyArbitrators(prisma, FOUNDATION_DAO_ID, {
          type: 'dispute_escalated',
          disputeId: id,
          ticketId: updated.ticketId,
          ticketShortId: updated.ticketId.slice(0, 8),
        }).catch(err => console.error('[EmailNotifier] notifyArbitrators failed:', err))
      })

      // ADR-374-pattern server-backed notification for both disputants — the
      // cooling-off window just ended and the case is now with the Council;
      // previously only arbitrators were told, not the two people actually
      // affected (found 2026-09-18 while verifying the DAO communicates with
      // every party at every stage, not just at open/verdict).
      notifyDisputeEscalated(prisma, {
        ticketId: updated.ticketId,
        buyerPubkey: dispute.ticket.buyerPubkey,
        sellerPubkey: dispute.ticket.sellerPubkey,
        offerTitle: dispute.ticket.offer?.title ?? null,
      }).catch((err) => console.error('[notifications] dispute-escalated failed:', err instanceof Error ? err.message : err))

      res.json({ success: true, dispute: updated })
    } catch (error) {
      console.error('Failed to escalate dispute:', error)
      res.status(500).json({ error: 'Failed to escalate dispute' })
    }
  })

  router.post('/disputes/:id/withdraw', ...guard, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string
      const { callerPubkey } = req.body as { callerPubkey?: string }

      if (!callerPubkey) {
        return res.status(400).json({ error: 'callerPubkey is required' })
      }

      const dispute = await prisma.dispute.findUnique({
        where: { id },
        include: { ticket: true },
      })

      if (!dispute) {
        return res.status(404).json({ error: 'Dispute not found' })
      }

      if (!['OPEN', 'COUNCIL_QUEUE'].includes(dispute.status)) {
        return res.status(409).json({ error: `Cannot withdraw from status ${dispute.status}` })
      }

      if (callerPubkey !== dispute.ticket.buyerPubkey) {
        return res.status(403).json({ error: 'Only dispute opener can withdraw' })
      }

      const updated = await prisma.dispute.update({
        where: { id },
        data: { status: 'WITHDRAWN' },
        include: { verdicts: true },
      })

      await prisma.ticket.update({
        where: { id: dispute.ticketId },
        data: { status: 'ACCEPTED', disputeReason: null },
      })

      // ADR-353 Q2: leaving the terminal DISPUTED state reactivates the
      // ticket — unlock the hosted canvas (next terminal state re-locks).
      await enqueueCanvasLifecycleForTicket(prisma, dispute.ticketId, dispute.ticket.status, 'ACCEPTED').catch((err) =>
        console.error('[canvas-lifecycle] enqueue on dispute withdraw failed:', err instanceof Error ? err.message : err),
      )

      console.log(`[Dispute] Withdrew dispute ${id}`)

      res.json({ success: true, dispute: updated })
    } catch (error) {
      console.error('Failed to withdraw dispute:', error)
      res.status(500).json({ error: 'Failed to withdraw dispute' })
    }
  })

  router.get('/disputes', ...guard, async (req: Request, res: Response) => {
    try {
      const { status, daoId } = req.query

      const where: Record<string, unknown> = {}
      if (status) where.status = status
      if (daoId) where.daoId = daoId
      else where.daoId = FOUNDATION_DAO_ID

      const disputes = await prisma.dispute.findMany({
        where,
        include: {
          ticket: { include: { offer: true } },
          verdicts: true,
        },
        orderBy: { openedAt: 'desc' },
      })

      res.json({ disputes })
    } catch (error) {
      console.error('Failed to fetch disputes:', error)
      res.status(500).json({ error: 'Failed to fetch disputes' })
    }
  })

router.get('/disputes/:id', ...guard, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string

      const dispute = await prisma.dispute.findUnique({
        where: { id },
        include: {
          ticket: { include: { offer: true } },
          verdicts: true,
          dao: { include: { config: true } },
          appealRequest: true,
          disclosures: true,
        },
      })

      if (!dispute) {
        return res.status(404).json({ error: 'Dispute not found' })
      }

      const appealWindowExpiresAt = dispute.verdictIssuedAt
        ? new Date(dispute.verdictIssuedAt.getTime() + (dispute.dao.config?.appealWindowHours ?? 72) * 3600_000)
        : null

      const disclosureSummary = dispute.ticket.visibility !== 'PUBLIC' ? {
        required: true,
        deadline: dispute.disclosureDeadline?.toISOString() ?? null,
        deadlineExpired: dispute.disclosureDeadline ? new Date() > dispute.disclosureDeadline : false,
        buyerDisclosed: dispute.disclosures.some(d => d.disclosedByPubkey === dispute.ticket.buyerPubkey),
        sellerDisclosed: dispute.disclosures.some(d => d.disclosedByPubkey === dispute.ticket.sellerPubkey),
      } : { required: false }

      res.json({ dispute, appealWindowExpiresAt, disclosureSummary })
    } catch (error) {
      console.error('Failed to fetch dispute:', error)
      res.status(500).json({ error: 'Failed to fetch dispute' })
    }
  })

  router.get('/disputes/:id/appeal', ...guard, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string

      const appealRequest = await prisma.appealRequest.findUnique({
        where: { disputeId: id },
        include: { dispute: { include: { verdicts: true, ticket: true, dao: { include: { config: true } } } } },
      })

      if (!appealRequest) {
        return res.status(404).json({ error: 'No appeal request found for this dispute' })
      }

      res.json({ appealRequest })
    } catch (error) {
      console.error('Failed to fetch appeal:', error)
      res.status(500).json({ error: 'Failed to fetch appeal' })
    }
  })

  router.post('/disputes/:id/appeal', ...guard, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string
      const { callerPubkey, reason, evidenceEventIds } = req.body as {
        callerPubkey?: string
        reason?: string
        evidenceEventIds?: string[]
      }

      if (!callerPubkey) {
        return res.status(400).json({ error: 'callerPubkey is required' })
      }

      const dispute = await prisma.dispute.findUnique({
        where: { id },
        include: {
          verdicts: true,
          ticket: true,
          dao: { include: { config: true } },
        },
      })

      if (!dispute) {
        return res.status(404).json({ error: 'Dispute not found' })
      }

      if (dispute.status !== 'RESOLVED_PENDING') {
        return res.status(409).json({ error: `Dispute status is ${dispute.status}, appeal only allowed when RESOLVED_PENDING` })
      }

      if (dispute.dao.config?.quorumType === 'SINGLE') {
        return res.status(409).json({ error: 'Appeals are disabled for SINGLE-quorum bootstrapping' })
      }

      if (dispute.dao.config?.appealWindowHours === 0) {
        return res.status(409).json({ error: 'Appeals are disabled for this DAO' })
      }

      const windowHours = dispute.dao.config?.appealWindowHours ?? 72
      if (!dispute.verdictIssuedAt || new Date() >= new Date(dispute.verdictIssuedAt.getTime() + windowHours * 3600_000)) {
        return res.status(410).json({ error: 'Appeal window has expired' })
      }

      const existingAppeal = await prisma.appealRequest.findUnique({ where: { disputeId: id } })
      if (existingAppeal) {
        return res.status(409).json({ error: 'Appeal already submitted for this dispute' })
      }

      const round1Verdict = dispute.verdicts.find(v => v.round === 1)
      if (!round1Verdict) {
        return res.status(409).json({ error: 'No round-1 verdict found' })
      }

      const adverselyAffectedParty = round1Verdict.outcome === 'RELEASE'
        ? dispute.ticket.buyerPubkey
        : dispute.ticket.sellerPubkey

      if (callerPubkey !== adverselyAffectedParty) {
        return res.status(403).json({ error: 'Only the adversely-affected party may file an appeal' })
      }

      const [appealRequest, updatedDispute] = await prisma.$transaction([
        prisma.appealRequest.create({
          data: {
            disputeId: id,
            appealerPubkey: callerPubkey,
            reason: reason || '',
            evidenceEventIds: JSON.stringify(evidenceEventIds ?? []),
            originalVerdictId: round1Verdict.id,
          },
        }),
        prisma.dispute.update({
          where: { id },
          data: { status: 'APPEALED', verdictIssuedAt: null },
          include: { ticket: true, verdicts: true },
        }),
      ])

      setImmediate(() => {
        notifyArbitrators(prisma, FOUNDATION_DAO_ID, {
          type: 'appeal_opened',
          disputeId: id,
          ticketId: updatedDispute.ticketId,
          ticketShortId: updatedDispute.ticketId.slice(0, 8),
        }).catch(err => console.error('[EmailNotifier] notifyArbitrators failed:', err))
      })

      res.status(201).json({ appealId: appealRequest.id, dispute: { id: updatedDispute.id, status: updatedDispute.status } })
    } catch (error) {
      console.error('Failed to submit appeal:', error)
      res.status(500).json({ error: 'Failed to submit appeal' })
    }
  })

  router.post('/disputes/:id/verdict', ...guard, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string
      const { callerPubkey, outcome, reasoning, evidenceEventIds, sellerPct, buyerPct, feePct } = req.body as {
        callerPubkey?: string
        outcome?: string
        reasoning?: string
        evidenceEventIds?: string[]
        sellerPct?: number
        buyerPct?: number
        feePct?: number
      }

      if (!callerPubkey) {
        return res.status(400).json({ error: 'callerPubkey is required' })
      }

      if (!outcome || !['RELEASE', 'CANCEL', 'SPLIT'].includes(outcome)) {
        return res.status(400).json({ error: 'outcome must be RELEASE, CANCEL or SPLIT' })
      }

      // ADR-184: SPLIT validation. Mixed percentage settlement is deferred; pure
      // 100/0 splits are treated as RELEASE/CANCEL for forward compatibility.
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

      const callerMember = await prisma.daoMember.findFirst({
        where: {
          daoId: FOUNDATION_DAO_ID,
          pubkey: callerPubkey,
          status: 'ACTIVE',
          role: { in: ['ADMIN', 'ARBITRATOR'] },
        },
      })

      if (!callerMember) {
        return res.status(403).json({ error: 'Caller is not an active arbitrator' })
      }

      const daoConfig = await prisma.daoConfig.findUnique({
        where: { daoId: FOUNDATION_DAO_ID },
      })

      const dispute = await prisma.dispute.findUnique({
        where: { id },
        include: { ticket: { include: { offer: true } }, verdicts: true },
      })

      if (!dispute) {
        return res.status(404).json({ error: 'Dispute not found' })
      }

      if (!['COUNCIL_QUEUE', 'IN_REVIEW', 'APPEALED'].includes(dispute.status)) {
        return res.status(409).json({ error: `Dispute status is ${dispute.status}, not accepting verdicts` })
      }

      if (dispute.status === 'APPEALED') {
        const round1Voters = dispute.verdicts.filter(v => v.round === 1).map(v => v.arbitratorPubkey)
        if (round1Voters.includes(callerPubkey)) {
          return res.status(403).json({ error: 'Round-1 voters cannot vote in round-2' })
        }
      }

      const existingVerdict = dispute.verdicts.find(v => v.arbitratorPubkey === callerPubkey)
      if (existingVerdict) {
        return res.status(409).json({ error: 'Arbitrator has already submitted a verdict' })
      }

      const verdictOutcome = effectiveOutcome as 'RELEASE' | 'CANCEL'
      const verdictId = `verdict-${Date.now()}-${id.slice(0, 8)}`

      const nostrEventTemplate: VerdictEventTemplate = {
        kind: 30022,
        pubkey: callerPubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', verdictId],
          ['sub_type', 'arbitration_verdict'],
          ['proposal', dispute.disputeId],
          ['vote', verdictOutcome === 'RELEASE' ? 'yes' : 'no'],
          ['voting_model', '1p1v'],
        ],
        content: JSON.stringify({
          sub_type: 'arbitration_verdict',
          dao_id: FOUNDATION_DAO_ID,
          dispute_id: dispute.disputeId,
          ticket_id: dispute.ticketId,
          outcome: verdictOutcome,
          reasoning: reasoning || '',
          evidence_reviewed: evidenceEventIds || [],
        }),
      }

      const newStatus = dispute.status === 'COUNCIL_QUEUE' ? 'IN_REVIEW' : 'IN_REVIEW'

      const [verdict, updatedDispute] = await prisma.$transaction([
        prisma.arbitrationVerdict.create({
          data: {
            verdictId,
            disputeId: id,
            arbitratorPubkey: callerPubkey,
            outcome: verdictOutcome,
            reasoning,
            evidenceEventIds: evidenceEventIds ? JSON.stringify(evidenceEventIds) : null,
            round: dispute.status === 'APPEALED' ? 2 : 1,
            sellerPct: outcome === 'SPLIT' ? sellerPct : null,
            buyerPct: outcome === 'SPLIT' ? buyerPct : null,
            feePct: outcome === 'SPLIT' ? (feePct ?? null) : null,
          },
        }),
        prisma.dispute.update({
          where: { id },
          data: { status: newStatus },
          include: { ticket: true, verdicts: true },
        }),
      ])

      const quorumEvaluation = await evaluateQuorum(prisma, id)

      if (quorumEvaluation.quorumMet && quorumEvaluation.majorityOutcome) {
        const resolutionOutcome = quorumEvaluation.majorityOutcome

        const isAppealEligible =
          dispute.status !== 'APPEALED' &&
          (daoConfig?.appealWindowHours ?? 72) > 0 &&
          daoConfig?.quorumType !== 'SINGLE'

        const newStatus = isAppealEligible ? 'RESOLVED_PENDING' : 'RESOLVED'

        const finalDispute = await prisma.dispute.update({
          where: { id },
          data: {
            status: newStatus,
            outcome: resolutionOutcome,
            verdictIssuedAt: new Date(),
            resolvedAt: newStatus === 'RESOLVED' ? new Date() : null,
            arbitratorPubkey: callerPubkey,
          },
          include: { ticket: true, verdicts: true },
        })

        // ADR-184: resolve sub-wallet provider for escrow ops (FU-02).
        const provider = dispute.ticket.offer?.lightningSubWalletAdminKey && (payments as any).createSubWalletProvider
          ? (payments as any).createSubWalletProvider(dispute.ticket.offer.lightningSubWalletAdminKey)
          : payments

        if (resolutionOutcome === 'RELEASE') {
          const preimages = [
            dispute.ticket.escrowPhase1Preimage,
            dispute.ticket.escrowPhase2Preimage,
            dispute.ticket.escrowPhase3Preimage,
          ].filter(Boolean)

          for (const preimage of preimages) {
            try {
              await provider.settleHoldInvoice(preimage!)
            } catch (err) {
              console.error(`[Escrow] Failed to settle hold invoice:`, err)
            }
          }

          const releaseOk = await casTicketUpdate(prisma, dispute.ticketId, dispute.ticket.escrowStatus, {
            escrowStatus: 'RELEASED',
            status: 'COMPLETED',
            deliveryConfirmedAt: new Date(),
            escrowPhase1Deadline: null,
            escrowPhase2Deadline: null,
            escrowPhase3Deadline: null,
            escrowAutoReleaseDeadline: null,
          })
          if (!releaseOk) {
            // Hold invoices were already settled above — cannot be undone.
            // The reconciliation tick will converge the ticket to RELEASED.
            logCritical('Dispute', `ticket ${dispute.ticketId} settled on Lightning but DB write lost a concurrent race resolving dispute ${id}`)
          }

          console.log(`[Dispute] Verdict ${verdictId}: QUORUM MET → RELEASE for dispute ${id}`)
        } else {
          const hashes = [
            dispute.ticket.escrowPhase1Hash,
            dispute.ticket.escrowPhase2Hash,
            dispute.ticket.escrowPhase3Hash,
          ].filter(Boolean)

          for (const hash of hashes) {
            try {
              await provider.cancelHoldInvoice(hash!)
            } catch (err) {
              console.error(`[Escrow] Failed to cancel hold invoice:`, err)
            }
          }

          const cancelOk = await casTicketUpdate(prisma, dispute.ticketId, dispute.ticket.escrowStatus, {
            escrowStatus: 'CANCELLED',
            status: 'CANCELLED',
            escrowPhase1Deadline: null,
            escrowPhase2Deadline: null,
            escrowPhase3Deadline: null,
            escrowAutoReleaseDeadline: null,
          })
          if (!cancelOk) {
            logCritical('Dispute', `ticket ${dispute.ticketId} hold invoices cancelled on Lightning but DB write lost a concurrent race resolving dispute ${id}`)
          }

          console.log(`[Dispute] Verdict ${verdictId}: QUORUM MET → CANCEL for dispute ${id}`)
        }

        // ADR-318 D5: dispute outcome flows into the agent's Trust Score
        // (ADR-317) — CANCEL counts as a lost dispute for the agent (always
        // the seller side of an AGENT_SETUP ticket), RELEASE does not.
        if (dispute.ticket.offer?.offerType === 'AGENT_SETUP' && dispute.ticket.offer.agentProfileId) {
          try {
            await recomputeTrustScore(dispute.ticket.offer.agentProfileId, prisma)
          } catch (err) {
            console.error('[Dispute] recomputeTrustScore failed (non-fatal, verdict already committed):', err)
          }
        }

        setImmediate(() => {
          notifyDisputants(prisma, finalDispute.ticket.buyerPubkey, finalDispute.ticket.sellerPubkey, {
            type: 'verdict_issued',
            disputeId: id,
            ticketId: finalDispute.ticketId,
            ticketShortId: finalDispute.ticketId.slice(0, 8),
            outcome: resolutionOutcome,
            reasoning: reasoning ?? null,
          }).catch(err => console.error('[EmailNotifier] notifyDisputants failed:', err))
        })

        // ADR-374 FU-696: server-backed notification for both disputants
        // (best-effort — never fails the verdict).
        notifyVerdictIssued(prisma, {
          ticketId: finalDispute.ticketId,
          buyerPubkey: finalDispute.ticket.buyerPubkey,
          sellerPubkey: finalDispute.ticket.sellerPubkey,
          outcome: resolutionOutcome as 'RELEASE' | 'CANCEL',
          offerTitle: dispute.ticket.offer?.title ?? null,
          reasoning: reasoning ?? null,
        }).catch((err) => console.error('[notifications] verdict-issued failed:', err instanceof Error ? err.message : err))

        res.json({
          success: true,
          verdict,
          dispute: finalDispute,
          nostrEventTemplate,
          quorum: quorumEvaluation,
        })
      } else {
        res.json({
          success: true,
          verdict,
          dispute: updatedDispute,
          nostrEventTemplate,
          quorum: quorumEvaluation,
          needsTieBreaker: quorumEvaluation.isTie,
        })
      }
    } catch (error) {
      console.error('Failed to issue verdict:', error)
      res.status(500).json({ error: 'Failed to issue verdict' })
    }
  })

  // ADR-152: Submit payload disclosure for a Tier 1 dispute
  router.post('/disputes/:id/disclose', ...guard, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string
      const { callerPubkey, payload, method } = req.body as {
        callerPubkey?: string
        payload?: CommercialPayload
        method?: 'plaintext'
      }

      if (!callerPubkey) {
        return res.status(400).json({ error: 'callerPubkey is required' })
      }
      if (!payload) {
        return res.status(400).json({ error: 'payload is required' })
      }
      if (method && method !== 'plaintext') {
        return res.status(400).json({ error: 'Only plaintext method is currently supported' })
      }

      const dispute = await prisma.dispute.findUnique({
        where: { id },
        include: { ticket: true },
      })

      if (!dispute) {
        return res.status(404).json({ error: 'Dispute not found' })
      }

      if (!['OPEN', 'COUNCIL_QUEUE', 'IN_REVIEW'].includes(dispute.status)) {
        return res.status(409).json({ error: `Cannot disclose for dispute in status ${dispute.status}` })
      }

      if (callerPubkey !== dispute.ticket.buyerPubkey && callerPubkey !== dispute.ticket.sellerPubkey) {
        return res.status(403).json({ error: 'Only buyer or seller can disclose' })
      }

      if (dispute.ticket.visibility === 'PUBLIC') {
        return res.status(409).json({ error: 'Disclosure only required for Tier 1+ tickets' })
      }

      const existingDisclosure = await prisma.payloadDisclosure.findFirst({
        where: { disputeId: id, disclosedByPubkey: callerPubkey },
      })
      if (existingDisclosure) {
        return res.status(409).json({ error: 'Already submitted disclosure for this dispute' })
      }

      const disclosure = await prisma.payloadDisclosure.create({
        data: {
          disputeId: id,
          disclosedByPubkey: callerPubkey,
          method: method || 'plaintext',
          commitmentVerified: false,
          payloadJson: JSON.stringify(payload),
        },
      })

      res.json({ success: true, disclosure: { id: disclosure.id, commitmentVerified: false, method: disclosure.method } })

      const payloadCommitment = dispute.ticket.nostrEventId
      if (payloadCommitment) {
        nostrService.getEvents({ ids: [payloadCommitment], kinds: [30407, 30017] }, 3000)
          .then(async (events) => {
            const event = events[0]
            if (event) {
              const commitmentTag = event.tags.find(t => t[0] === 'payload_commitment')
              if (commitmentTag && commitmentTag[1]) {
                const verified = await verifyPayloadCommitment(payload, commitmentTag[1])
                if (verified) {
                  await prisma.payloadDisclosure.update({ where: { id: disclosure.id }, data: { commitmentVerified: true } })
                }
              }
            }
          })
          .catch(err => console.warn('[Disclosure] Background commitment verification failed:', err))
      }
    } catch (error) {
      console.error('Failed to submit disclosure:', error)
      res.status(500).json({ error: 'Failed to submit disclosure' })
    }
  })

  // ADR-152: Get disclosures for a dispute (arbitrator-only)
  router.get('/disputes/:id/disclosures', ...guard, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string
      const callerPubkey = req.query.callerPubkey as string | undefined

      if (!callerPubkey) {
        return res.status(401).json({ error: 'callerPubkey is required' })
      }

      const dispute = await prisma.dispute.findUnique({
        where: { id },
        include: { disclosures: true, ticket: true },
      })

      if (!dispute) {
        return res.status(404).json({ error: 'Dispute not found' })
      }

      const callerMember = await prisma.daoMember.findFirst({
        where: {
          daoId: FOUNDATION_DAO_ID,
          pubkey: callerPubkey,
          status: 'ACTIVE',
          role: { in: ['ADMIN', 'ARBITRATOR'] },
        },
      })

      const isDisputant = dispute.ticket.buyerPubkey === callerPubkey || dispute.ticket.sellerPubkey === callerPubkey

      if (!callerMember && !isDisputant) {
        return res.status(403).json({ error: 'Only arbitrators or disputants can view disclosures' })
      }

      const buyerDisclosed = dispute.disclosures.some(d => d.disclosedByPubkey === dispute.ticket.buyerPubkey)
      const sellerDisclosed = dispute.disclosures.some(d => d.disclosedByPubkey === dispute.ticket.sellerPubkey)

      const needsDisclosure = dispute.ticket.visibility !== 'PUBLIC'

      res.json({
        disclosures: dispute.disclosures,
        summary: {
          needsDisclosure: !!needsDisclosure,
          buyerDisclosed,
          sellerDisclosed,
          disclosureDeadline: dispute.disclosureDeadline?.toISOString() ?? null,
          deadlineExpired: dispute.disclosureDeadline ? new Date() > dispute.disclosureDeadline : false,
        },
      })
    } catch (error) {
      console.error('Failed to fetch disclosures:', error)
      res.status(500).json({ error: 'Failed to fetch disclosures' })
    }
  })

  // ADR-152: Check non-disclosure forfeit — called by arbitrator before verdict
  router.post('/disputes/:id/check-forfeit', ...guard, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string
      const { callerPubkey } = req.body as { callerPubkey?: string }

      if (!callerPubkey) {
        return res.status(400).json({ error: 'callerPubkey is required' })
      }

      const callerMember = await prisma.daoMember.findFirst({
        where: {
          daoId: FOUNDATION_DAO_ID,
          pubkey: callerPubkey,
          status: 'ACTIVE',
          role: { in: ['ADMIN', 'ARBITRATOR'] },
        },
      })

      if (!callerMember) {
        return res.status(403).json({ error: 'Only arbitrators can check forfeit status' })
      }

      const dispute = await prisma.dispute.findUnique({
        where: { id },
        include: { disclosures: true, ticket: true },
      })

      if (!dispute) {
        return res.status(404).json({ error: 'Dispute not found' })
      }

      if (dispute.ticket.visibility === 'PUBLIC') {
        return res.json({ forfeit: null, reason: 'Tier 0 — no disclosure required' })
      }

      if (!dispute.disclosureDeadline) {
        return res.json({ forfeit: null, reason: 'No disclosure deadline set' })
      }

      const deadlineExpired = new Date() > dispute.disclosureDeadline
      if (!deadlineExpired) {
        return res.json({ forfeit: null, reason: 'Disclosure window still open' })
      }

      const verifiedDisclosures = dispute.disclosures.filter(d => d.commitmentVerified)
      const buyerDisclosed = verifiedDisclosures.some(d => d.disclosedByPubkey === dispute.ticket.buyerPubkey)
      const sellerDisclosed = verifiedDisclosures.some(d => d.disclosedByPubkey === dispute.ticket.sellerPubkey)

      let forfeitParty: 'buyer' | 'seller' | 'both' | null = null
      if (!buyerDisclosed && !sellerDisclosed) {
        forfeitParty = 'both'
      } else if (!buyerDisclosed) {
        forfeitParty = 'buyer'
      } else if (!sellerDisclosed) {
        forfeitParty = 'seller'
      }

      res.json({
        forfeit: forfeitParty ? { party: forfeitParty, automaticOutcome: forfeitParty === 'seller' ? 'CANCEL' : 'RELEASE' } : null,
        buyerDisclosed,
        sellerDisclosed,
        deadlineExpired: true,
      })
    } catch (error) {
      console.error('Failed to check forfeit:', error)
      res.status(500).json({ error: 'Failed to check forfeit status' })
    }
  })

  return router
}