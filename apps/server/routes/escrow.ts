import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import type { PaymentProvider } from '@col/payments'
import { LNBitsProvider } from '@col/payments'
import { toEscrowState, type EscrowState } from '@col/nostr-schema'
import { computeEscrowDeadline } from '../services/escrow-timeout.js'
import { casTicketUpdate } from '../services/escrow-state.js'
import { logCritical } from '../lib/critical-alert.js'
import { requireAuth } from '../middleware/require-auth.js'
import { enforceCallerIdentity } from '../middleware/enforce-caller-identity.js'
import { blockIfPaymentsPaused } from '../middleware/payments-paused.js'
import { registerInvoice } from './lightning.js'
import { enqueueCanvasLifecycleForTicket } from '../services/canvas-lifecycle.js'
import { notifyTicketStatusChange } from '../services/notifications.js'

type EscrowTransition =
  | 'INITIATE'
  | 'PAY_PHASE_1'
  | 'START_WORK'
  | 'PAY_PHASE_2'
  | 'CONFIRM_DELIVERY'
  | 'PAY_PHASE_3'
  | 'CONFIRM_QUALITY'
  | 'AUTO_RELEASE'
  | 'DISPUTE'
  | 'RESOLVE_RELEASE'
  | 'RESOLVE_CANCEL'
  | 'TIMEOUT'

interface EscrowRule {
  from: string
  to: string
  transition: EscrowTransition
  actor: 'BUYER' | 'SELLER' | 'PROTOCOL' | 'ARBITRATOR'
}

export const ESCROW_RULES: EscrowRule[] = [
  // NOTE: 'INITIATED' is never assigned anywhere in the live ticket-creation
  // path — POST /api/tickets creates offer-backed escrow tickets directly in
  // 'PHASE_1_PENDING' (apps/server/routes/tickets.ts), treating the seller's
  // `offer.useEscrow` flag (set at offer-creation time) as the seller's
  // up-front consent to escrow. This rule, and the /tickets/:id/escrow/phase1
  // route below that depends on it, are consequently unreachable dead code
  // for the current ticket-creation flow — kept as documented API surface in
  // case a future explicit seller-approval step is built, not because
  // anything calls it today (verified: no client code references
  // `escrow/phase1`, audited 2026-08-01).
  { from: 'INITIATED', to: 'PHASE_1_PENDING', transition: 'INITIATE', actor: 'SELLER' },
  { from: 'PHASE_1_PENDING', to: 'RESERVED', transition: 'PAY_PHASE_1', actor: 'BUYER' },
  { from: 'PHASE_1_PENDING', to: 'CANCELLED', transition: 'TIMEOUT', actor: 'PROTOCOL' },
  { from: 'RESERVED', to: 'PHASE_2_PENDING', transition: 'START_WORK', actor: 'SELLER' },
  { from: 'PHASE_2_PENDING', to: 'DELIVERY_STARTED', transition: 'PAY_PHASE_2', actor: 'BUYER' },
  { from: 'PHASE_2_PENDING', to: 'CANCELLED', transition: 'TIMEOUT', actor: 'PROTOCOL' },
  { from: 'DELIVERY_STARTED', to: 'PHASE_3_PENDING', transition: 'CONFIRM_DELIVERY', actor: 'SELLER' },
  { from: 'DELIVERY_STARTED', to: 'DISPUTED', transition: 'DISPUTE', actor: 'BUYER' },
  { from: 'DELIVERY_STARTED', to: 'DISPUTED', transition: 'DISPUTE', actor: 'SELLER' },
  { from: 'PHASE_3_PENDING', to: 'DELIVERY_CONFIRMED', transition: 'PAY_PHASE_3', actor: 'BUYER' },
  { from: 'PHASE_3_PENDING', to: 'CANCELLED', transition: 'TIMEOUT', actor: 'PROTOCOL' },
  { from: 'DELIVERY_CONFIRMED', to: 'RELEASED', transition: 'CONFIRM_QUALITY', actor: 'BUYER' },
  { from: 'DELIVERY_CONFIRMED', to: 'RELEASED', transition: 'AUTO_RELEASE', actor: 'PROTOCOL' },
  { from: 'DELIVERY_CONFIRMED', to: 'DISPUTED', transition: 'DISPUTE', actor: 'BUYER' },
  { from: 'DELIVERY_CONFIRMED', to: 'DISPUTED', transition: 'DISPUTE', actor: 'SELLER' },
  { from: 'DISPUTED', to: 'RELEASED', transition: 'RESOLVE_RELEASE', actor: 'ARBITRATOR' },
  { from: 'DISPUTED', to: 'CANCELLED', transition: 'RESOLVE_CANCEL', actor: 'ARBITRATOR' },
]

export function validateTransition(currentStatus: string, targetStatus: string): EscrowRule | null {
  return ESCROW_RULES.find(r => r.from === currentStatus && r.to === targetStatus) ?? null
}

// The NIP-115 escrow projection (EscrowState + toEscrowState) now lives in
// @col/nostr-schema (ADR-150). Imported above and re-exported here so existing importers
// (nostr-relay, the checkout-tags test) keep their import path unchanged.
export { toEscrowState }
export type { EscrowState }

async function verifyActor(
  rule: EscrowRule,
  callerPubkey: string,
  buyerPubkey: string,
  sellerPubkey: string,
  prisma: PrismaClient,
  ticketId: string
): Promise<boolean> {
  switch (rule.actor) {
    case 'BUYER': return callerPubkey === buyerPubkey
    case 'SELLER': return callerPubkey === sellerPubkey
    case 'PROTOCOL': return false
    case 'ARBITRATOR': {
      const FOUNDATION_DAO_ID = 'colabonate-foundation'
      const member = await prisma.daoMember.findFirst({
        where: {
          daoId: FOUNDATION_DAO_ID,
          pubkey: callerPubkey,
          status: 'ACTIVE',
          role: { in: ['ADMIN', 'ARBITRATOR'] },
        },
      })
      if (!member) return false
      const hasVerdict = await prisma.arbitrationVerdict.findFirst({
        where: { dispute: { ticketId }, arbitratorPubkey: callerPubkey },
      })
      return !hasVerdict
    }
    default: return false
  }
}

/**
 * FU-02: returns a sub-wallet-scoped LNBitsProvider when the offer has an
 * isolated sub-wallet provisioned (B-α). Falls back to the master provider.
 */
function resolveProvider(offer: { lightningSubWalletAdminKey?: string | null }, payments: PaymentProvider): PaymentProvider {
  if (offer.lightningSubWalletAdminKey && payments instanceof LNBitsProvider) {
    return payments.createSubWalletProvider(offer.lightningSubWalletAdminKey)
  }
  return payments
}

export function createEscrowRouter(prisma: PrismaClient, payments: PaymentProvider) {
  const router = Router()

  // Escrow transitions move money. Every route needs a valid session AND the
  // claimed callerPubkey must be the session identity — verifyActor() then
  // checks the (now trustworthy) caller against the ticket's buyer/seller.
  // Applied per-route (not router.use) because this router is mounted on the
  // shared '/api' path and a bare .use() would gate unrelated routes.
  const guard = [requireAuth(prisma), enforceCallerIdentity] as const

  // ADR-252 D2: phase1/2/3 create NEW hold invoices — gated by the mainnet
  // kill switch (blockIfPaymentsPaused runs first, inline, so the auth-coverage
  // static check's `...guard` matcher still sees the unmodified guard array).
  // release/cancel settle EXISTING holds and must stay reachable during a
  // payments-paused incident (orphaned-hold prevention) — NOT gated.
  router.post('/tickets/:id/escrow/phase1', blockIfPaymentsPaused, ...guard, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string
      const { callerPubkey } = req.body as { callerPubkey?: string }

      if (!callerPubkey) {
        return res.status(400).json({ error: 'callerPubkey is required' })
      }

      const ticket = await prisma.ticket.findUnique({
        where: { id },
        include: { offer: true },
      })

      if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found' })
      }

      // Escrow only applies to offer-backed tickets (ADR-204: offerId XOR
      // cooperationId). A ticket without an offer cannot enter escrow.
      if (!ticket.offer) {
        return res.status(400).json({ error: 'Escrow requires an offer-backed ticket' })
      }

      const rule = validateTransition(ticket.escrowStatus, 'PHASE_1_PENDING')
      if (!rule) {
        return res.status(409).json({ error: `Cannot transition from ${ticket.escrowStatus} to PHASE_1_PENDING` })
      }

      if (!await verifyActor(rule, callerPubkey, ticket.buyerPubkey, ticket.sellerPubkey, prisma, id)) {
        return res.status(403).json({ error: `Only ${rule.actor.toLowerCase()} can perform this action` })
      }

      const total = ticket.amountSats || ticket.offer.priceSats
      const phaseAmount = Math.round(total * 0.25)

      const provider = resolveProvider(ticket.offer, payments)
      const preimageHash = LNBitsProvider.generatePaymentHash()
      const invoice = await provider.createHoldInvoice(
        phaseAmount,
        preimageHash,
        `Escrow Phase 1 (25%): ${ticket.offer.title}`,
      )

      const ok = await casTicketUpdate(prisma, id, ticket.escrowStatus, {
        escrowStatus: 'PHASE_1_PENDING',
        escrowPhase1Hash: invoice.paymentHash,
        escrowPhase1Preimage: preimageHash,
        phase1Invoice: invoice.bolt11,
        escrowPhase1Deadline: computeEscrowDeadline('PHASE_1_PENDING', ticket.offer.phase2WindowHours),
      })
      if (!ok) {
        // Ticket moved concurrently between our read and write — the hold
        // invoice we just created is now orphaned (unreferenced). Cancel it
        // rather than silently overwrite whatever the racing request wrote.
        await provider.cancelHoldInvoice(invoice.paymentHash).catch(err =>
          console.error(`[Escrow] Failed to cancel orphaned Phase 1 hold invoice after concurrent write:`, err))
        return res.status(409).json({ error: 'Ticket state changed concurrently — retry' })
      }
      const updated = await prisma.ticket.findUniqueOrThrow({ where: { id }, include: { offer: true, milestones: true } })

      console.log(`[Escrow] Phase 1 hold invoice created for ticket ${id}: ${phaseAmount} sats`)

      res.json({
        success: true,
        phase: 1,
        amountSats: phaseAmount,
        invoice: invoice.bolt11,
        paymentHash: invoice.paymentHash,
        ticket: updated,
      })
    } catch (error) {
      console.error('Failed to create Phase 1 escrow invoice:', error)
      res.status(500).json({ error: 'Failed to create Phase 1 escrow invoice' })
    }
  })

  router.post('/tickets/:id/escrow/phase2', blockIfPaymentsPaused, ...guard, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string
      const { callerPubkey } = req.body as { callerPubkey?: string }

      if (!callerPubkey) {
        return res.status(400).json({ error: 'callerPubkey is required' })
      }

      const ticket = await prisma.ticket.findUnique({
        where: { id },
        include: { offer: true },
      })

      if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found' })
      }

      // Escrow only applies to offer-backed tickets (ADR-204: offerId XOR
      // cooperationId). A ticket without an offer cannot enter escrow.
      if (!ticket.offer) {
        return res.status(400).json({ error: 'Escrow requires an offer-backed ticket' })
      }

      const rule = validateTransition(ticket.escrowStatus, 'PHASE_2_PENDING')
      if (!rule) {
        return res.status(409).json({ error: `Cannot transition from ${ticket.escrowStatus} to PHASE_2_PENDING` })
      }

      if (!await verifyActor(rule, callerPubkey, ticket.buyerPubkey, ticket.sellerPubkey, prisma, id)) {
        return res.status(403).json({ error: `Only ${rule.actor.toLowerCase()} can perform this action` })
      }

      const total = ticket.amountSats || ticket.offer.priceSats
      const phaseAmount = Math.round(total * 0.50)

      const provider = resolveProvider(ticket.offer, payments)
      const preimageHash = LNBitsProvider.generatePaymentHash()
      const invoice = await provider.createHoldInvoice(
        phaseAmount,
        preimageHash,
        `Escrow Phase 2 (50%): ${ticket.offer.title}`,
      )

      // ADR-209 FU-209-B: register so the invoice poll can confirm payment
      // (hold invoices are invisible to LNBits; poll uses getHoldState).
      registerInvoice(invoice.paymentHash, invoice.bolt11, phaseAmount, `Escrow Phase 2 (50%): ${ticket.offer.title}`, true)

      const ok = await casTicketUpdate(prisma, id, ticket.escrowStatus, {
        escrowStatus: 'PHASE_2_PENDING',
        escrowPhase2Hash: invoice.paymentHash,
        escrowPhase2Preimage: preimageHash,
        phase2Invoice: invoice.bolt11,
        escrowPhase2Deadline: computeEscrowDeadline('PHASE_2_PENDING', ticket.offer.phase2WindowHours),
      })
      if (!ok) {
        await provider.cancelHoldInvoice(invoice.paymentHash).catch(err =>
          console.error(`[Escrow] Failed to cancel orphaned Phase 2 hold invoice after concurrent write:`, err))
        return res.status(409).json({ error: 'Ticket state changed concurrently — retry' })
      }
      const updated = await prisma.ticket.findUniqueOrThrow({ where: { id }, include: { offer: true, milestones: true } })

      console.log(`[Escrow] Phase 2 hold invoice created for ticket ${id}: ${phaseAmount} sats`)

      res.json({
        success: true,
        phase: 2,
        amountSats: phaseAmount,
        invoice: invoice.bolt11,
        paymentHash: invoice.paymentHash,
        ticket: updated,
      })
    } catch (error) {
      console.error('Failed to create Phase 2 escrow invoice:', error)
      res.status(500).json({ error: 'Failed to create Phase 2 escrow invoice' })
    }
  })

  router.post('/tickets/:id/escrow/phase3', blockIfPaymentsPaused, ...guard, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string
      const { callerPubkey } = req.body as { callerPubkey?: string }

      if (!callerPubkey) {
        return res.status(400).json({ error: 'callerPubkey is required' })
      }

      const ticket = await prisma.ticket.findUnique({
        where: { id },
        include: { offer: true },
      })

      if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found' })
      }

      // Escrow only applies to offer-backed tickets (ADR-204: offerId XOR
      // cooperationId). A ticket without an offer cannot enter escrow.
      if (!ticket.offer) {
        return res.status(400).json({ error: 'Escrow requires an offer-backed ticket' })
      }

      const rule = validateTransition(ticket.escrowStatus, 'PHASE_3_PENDING')
      if (!rule) {
        return res.status(409).json({ error: `Cannot transition from ${ticket.escrowStatus} to PHASE_3_PENDING` })
      }

      if (!await verifyActor(rule, callerPubkey, ticket.buyerPubkey, ticket.sellerPubkey, prisma, id)) {
        return res.status(403).json({ error: `Only ${rule.actor.toLowerCase()} can perform this action` })
      }

      const total = ticket.amountSats || ticket.offer.priceSats
      const phase1 = Math.round(total * 0.25)
      const phase2 = Math.round(total * 0.50)
      const phaseAmount = total - phase1 - phase2

      const provider = resolveProvider(ticket.offer, payments)
      const preimageHash = LNBitsProvider.generatePaymentHash()
      const invoice = await provider.createHoldInvoice(
        phaseAmount,
        preimageHash,
        `Escrow Phase 3 (25%): ${ticket.offer.title}`,
      )

      // ADR-209 FU-209-B: register so the invoice poll can confirm payment
      // (hold invoices are invisible to LNBits; poll uses getHoldState).
      registerInvoice(invoice.paymentHash, invoice.bolt11, phaseAmount, `Escrow Phase 3 (25%): ${ticket.offer.title}`, true)

      const ok = await casTicketUpdate(prisma, id, ticket.escrowStatus, {
        escrowStatus: 'PHASE_3_PENDING',
        escrowPhase3Hash: invoice.paymentHash,
        escrowPhase3Preimage: preimageHash,
        phase3Invoice: invoice.bolt11,
        escrowPhase3Deadline: computeEscrowDeadline('PHASE_3_PENDING', ticket.offer.phase2WindowHours),
      })
      if (!ok) {
        await provider.cancelHoldInvoice(invoice.paymentHash).catch(err =>
          console.error(`[Escrow] Failed to cancel orphaned Phase 3 hold invoice after concurrent write:`, err))
        return res.status(409).json({ error: 'Ticket state changed concurrently — retry' })
      }
      const updated = await prisma.ticket.findUniqueOrThrow({ where: { id }, include: { offer: true, milestones: true } })

      console.log(`[Escrow] Phase 3 hold invoice created for ticket ${id}: ${phaseAmount} sats`)

      res.json({
        success: true,
        phase: 3,
        amountSats: phaseAmount,
        invoice: invoice.bolt11,
        paymentHash: invoice.paymentHash,
        ticket: updated,
      })
    } catch (error) {
      console.error('Failed to create Phase 3 escrow invoice:', error)
      res.status(500).json({ error: 'Failed to create Phase 3 escrow invoice' })
    }
  })

  router.post('/tickets/:id/escrow/release', ...guard, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string
      const { callerPubkey } = req.body as { callerPubkey?: string }

      if (!callerPubkey) {
        return res.status(400).json({ error: 'callerPubkey is required' })
      }

      const ticket = await prisma.ticket.findUnique({ where: { id }, include: { offer: true } })
      if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found' })
      }

      // Escrow only applies to offer-backed tickets (ADR-204: offerId XOR
      // cooperationId). A ticket without an offer cannot enter escrow.
      if (!ticket.offer) {
        return res.status(400).json({ error: 'Escrow requires an offer-backed ticket' })
      }

      const rule = validateTransition(ticket.escrowStatus, 'RELEASED')
      if (!rule) {
        return res.status(409).json({ error: `Cannot transition from ${ticket.escrowStatus} to RELEASED` })
      }

      if (!await verifyActor(rule, callerPubkey, ticket.buyerPubkey, ticket.sellerPubkey, prisma, id)) {
        return res.status(403).json({ error: `Only ${rule.actor.toLowerCase()} can perform this action` })
      }

      const provider = resolveProvider(ticket.offer, payments)
      const phases = [
        { hash: ticket.escrowPhase1Hash, preimage: ticket.escrowPhase1Preimage },
        { hash: ticket.escrowPhase2Hash, preimage: ticket.escrowPhase2Preimage },
        { hash: ticket.escrowPhase3Hash, preimage: ticket.escrowPhase3Preimage },
      ].filter(p => p.hash && p.preimage)

      // F-D4-01: Abort on first settle failure instead of catch+continue.
      // If we mark the ticket RELEASED while a hold is orphaned (accepted by
      // the buyer but never settled), the buyer's funds are locked with no
          // convergence path. LND settle is idempotent (double-settle of an
      // already-settled invoice is rejected), so a retry from the auto-release
      // tick or a manual re-call settles only the remaining phases.
      const failedPhases: string[] = []
      for (const { hash, preimage } of phases) {
        try {
          if (provider.settleHoldInvoiceByHash) {
            await provider.settleHoldInvoiceByHash(hash!, preimage!)
          } else {
            await provider.settleHoldInvoice(preimage!)
          }
        } catch (err) {
          console.error(`[Escrow] Failed to settle hold invoice ${hash!.slice(0, 16)}...:`, err)
          failedPhases.push(hash!.slice(0, 16))
        }
      }

      if (failedPhases.length > 0) {
        // Do NOT mark RELEASED — some holds are still open. The already-settled
        // phases are settled (idempotent on retry); the failed ones need a retry.
        return res.status(500).json({
          error: 'Escrow release partially failed — some hold invoices could not be settled. The auto-release tick or a retry will settle the remaining phases.',
          failedPhases,
        })
      }

      const ok = await casTicketUpdate(prisma, id, ticket.escrowStatus, {
        escrowStatus: 'RELEASED',
        status: 'COMPLETED',
        deliveryConfirmedAt: new Date(),
        escrowPhase1Deadline: null,
        escrowPhase2Deadline: null,
        escrowPhase3Deadline: null,
        escrowAutoReleaseDeadline: null,
      })
      if (!ok) {
        // Funds were already settled to the seller above — this is not a
        // "retry the request" case, the settle call cannot be undone. A
        // concurrent request (dispute, auto-release, another release call)
        // won the write race after we settled. Log loud; the escrow
        // reconciliation tick will converge the ticket to RELEASED shortly
        // since the hold invoices are now genuinely settled on Lightning.
        logCritical('Escrow', `ticket ${id} settled on Lightning but DB write lost a concurrent race — reconciliation tick must correct this`)
        return res.status(409).json({ error: 'Payment settled but ticket state changed concurrently — contact support with this ticket ID if it does not resolve automatically' })
      }
      const updated = await prisma.ticket.findUniqueOrThrow({ where: { id }, include: { offer: true, milestones: true } })

      // ADR-353/ADR-370 D7 (G4): manual escrow release is a terminal entry
      // (COMPLETED) — the ticket UI's own release button bypasses PATCH, so
      // the canvas lock must be enqueued here.
      enqueueCanvasLifecycleForTicket(prisma, id, ticket.status, 'COMPLETED').catch((err) =>
        console.error('[canvas-lifecycle] enqueue on escrow release failed:', err instanceof Error ? err.message : err),
      )

      console.log(`[Escrow] All phases released for ticket ${id}`)

      // ADR-411: manual escrow release is a real COMPLETED transition — the
      // seller must see their payout in the feed (the ticket UI's own release
      // button bypasses PATCH /api/tickets/:id, so PATCH alone never notified).
      notifyTicketStatusChange(prisma, {
        ticketId: id,
        fromStatus: ticket.status,
        toStatus: 'COMPLETED',
        buyerPubkey: ticket.buyerPubkey,
        sellerPubkey: ticket.sellerPubkey,
        actingPubkey: callerPubkey,
        offerTitle: ticket.offer?.title ?? null,
      }).catch(err => console.error('[notifications] escrow release notify failed:', err))

      res.json({
        success: true,
        ticket: updated,
      })
    } catch (error) {
      console.error('Failed to release escrow:', error)
      res.status(500).json({ error: 'Failed to release escrow' })
    }
  })

  router.post('/tickets/:id/escrow/cancel', ...guard, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string
      const { callerPubkey } = req.body as { callerPubkey?: string }

      if (!callerPubkey) {
        return res.status(400).json({ error: 'callerPubkey is required' })
      }

      const ticket = await prisma.ticket.findUnique({ where: { id }, include: { offer: true } })
      if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found' })
      }

      // Escrow only applies to offer-backed tickets (ADR-204: offerId XOR
      // cooperationId). A ticket without an offer cannot enter escrow.
      if (!ticket.offer) {
        return res.status(400).json({ error: 'Escrow requires an offer-backed ticket' })
      }

      const rule = validateTransition(ticket.escrowStatus, 'CANCELLED')
      if (!rule) {
        return res.status(409).json({ error: `Cannot transition from ${ticket.escrowStatus} to CANCELLED` })
      }

      if (!await verifyActor(rule, callerPubkey, ticket.buyerPubkey, ticket.sellerPubkey, prisma, id)) {
        return res.status(403).json({ error: `Only ${rule.actor.toLowerCase()} can perform this action` })
      }

      const provider = resolveProvider(ticket.offer, payments)
      const hashes = [
        ticket.escrowPhase1Hash,
        ticket.escrowPhase2Hash,
        ticket.escrowPhase3Hash,
      ].filter(Boolean)

      // F-D4-01: Abort on first cancel failure — same rationale as release.
      const failedCancels: string[] = []
      for (const hash of hashes) {
        try {
          await provider.cancelHoldInvoice(hash!)
        } catch (err) {
          console.error(`[Escrow] Failed to cancel hold invoice ${hash!.slice(0, 16)}...:`, err)
          failedCancels.push(hash!.slice(0, 16))
        }
      }

      if (failedCancels.length > 0) {
        return res.status(500).json({
          error: 'Escrow cancellation partially failed — some hold invoices could not be cancelled. A retry will cancel the remaining phases.',
          failedCancels,
        })
      }

      const ok = await casTicketUpdate(prisma, id, ticket.escrowStatus, {
        escrowStatus: 'CANCELLED',
        status: 'CANCELLED',
        escrowPhase1Deadline: null,
        escrowPhase2Deadline: null,
        escrowPhase3Deadline: null,
        escrowAutoReleaseDeadline: null,
      })
      if (!ok) {
        logCritical('Escrow', `ticket ${id} hold invoices cancelled on Lightning but DB write lost a concurrent race`)
        return res.status(409).json({ error: 'Cancellation applied but ticket state changed concurrently — contact support with this ticket ID if it does not resolve automatically' })
      }
      const updated = await prisma.ticket.findUniqueOrThrow({ where: { id }, include: { offer: true, milestones: true } })

      // ADR-353/ADR-370 D7 (G4): manual escrow cancel is a terminal entry
      // (CANCELLED) — the canvas lock must be enqueued here too.
      enqueueCanvasLifecycleForTicket(prisma, id, ticket.status, 'CANCELLED').catch((err) =>
        console.error('[canvas-lifecycle] enqueue on escrow cancel failed:', err instanceof Error ? err.message : err),
      )

      console.log(`[Escrow] All phases cancelled for ticket ${id}`)

      // ADR-411: manual escrow cancel is a real CANCELLED transition — the
      // counterparty must see it in the feed.
      notifyTicketStatusChange(prisma, {
        ticketId: id,
        fromStatus: ticket.status,
        toStatus: 'CANCELLED',
        buyerPubkey: ticket.buyerPubkey,
        sellerPubkey: ticket.sellerPubkey,
        actingPubkey: callerPubkey,
        offerTitle: ticket.offer?.title ?? null,
      }).catch(err => console.error('[notifications] escrow cancel notify failed:', err))

      res.json({
        success: true,
        ticket: updated,
      })
    } catch (error) {
      console.error('Failed to cancel escrow:', error)
      res.status(500).json({ error: 'Failed to cancel escrow' })
    }
  })

  return router
}
