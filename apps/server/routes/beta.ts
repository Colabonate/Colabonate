import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import { requireAuth, type AuthenticatedRequest } from '../middleware/require-auth.js'
import { requireFoundationAdminBySession } from '../middleware/require-admin.js'
import { isBetaMode, demoConfig } from '../services/betaMode.js'
import { debitDemoWallet, creditDemoWallet, resetDemoBalance } from '../services/demoLedger.js'
import { tier2PayAndSettle } from '../services/betaTier2.js'
import { confirmPaymentByHash, resolvePaymentEntity } from '../services/paymentConfirmation.js'
import { storedInvoices } from './lightning.js'
import { isCoopEscrowEnabled } from '../lib/coop-escrow-gate.js'

export function createBetaRouter(prisma: PrismaClient) {
  const router = Router()

  // Public — frontend polls this to know whether to show demo UI.
  // coopEscrowEnabled rides along so Coop screens pick escrow vs direct-pay.
  router.get('/status', (_req: Request, res: Response) => {
    const coopEscrowEnabled = isCoopEscrowEnabled()
    if (!isBetaMode()) {
      return res.json({ betaMode: false, coopEscrowEnabled })
    }
    const cfg = demoConfig()
    return res.json({
      betaMode: true,
      coopEscrowEnabled,
      demoStartBalance: cfg.startBalance,
      realLndSettle: cfg.realLndSettle,
      noticeHtml: cfg.noticeHtml,
    })
  })

  // Auth-gated — replaces window.webln.sendPayment in beta mode.
  // Accepts the paymentHash returned by any invoice-creating route (ticket
  // funding/release, coop fund-escrow, milestone release — ADR-241 D3: every
  // one of them registers its hash), auto-confirms the escrow state machine
  // (Tier 1) via the same path the real LNbits webhook uses, debits the
  // buyer's demo ledger, and optionally pays + settles via lnd2 (Tier 2).
  router.post('/demo-pay', requireAuth(prisma), async (req: Request, res: Response) => {
    if (!isBetaMode()) {
      return res.status(404).json({ error: 'Not found' })
    }
    try {
      const callerPubkey = (req as AuthenticatedRequest).authPubkey!
      const { paymentHash } = req.body as { paymentHash?: string }

      if (!paymentHash) {
        return res.status(400).json({ error: 'paymentHash required' })
      }

      // ADR-241 D2: DB-first amount + ownership resolution — only the ticket
      // buyer or cooperation initiator may confirm their own payment hash.
      const entity = await resolvePaymentEntity(prisma, paymentHash)
      if (!entity) {
        return res.status(404).json({ error: 'Payment not found' })
      }
      if (entity.ownerPubkey !== callerPubkey) {
        return res.status(403).json({ error: 'Not authorized to confirm this payment' })
      }

      const storedInvoice = storedInvoices.get(paymentHash)
      const amountSats = entity.amountSats > 0 ? entity.amountSats : (storedInvoice?.amountSats ?? 0)

      // Idempotency: a hash already marked PAID in storedInvoices was already
      // debited by a prior call — replay the state confirm (harmless no-op
      // for an already-advanced entity) but skip a second ledger debit.
      const alreadyDebited = storedInvoice?.status === 'PAID'

      // ADR-241 D1: shared confirm path — identical state machine to the real
      // LNbits webhook (phase-hash matching, escrowStatus transitions, Kind
      // 30408), so beta and production never diverge on what "paid" means.
      const updated = await confirmPaymentByHash(prisma, paymentHash, { invoiceMap: storedInvoices })

      let newBalance: number | undefined
      if (!alreadyDebited && amountSats > 0) {
        try {
          newBalance = await debitDemoWallet(prisma, callerPubkey, amountSats)
        } catch (e) {
          console.warn('[Beta/demo-pay] Wallet debit failed (non-fatal):', e)
        }
      }

      // ADR-255 D3: credit the recipient's demo wallet on the transitions
      // that represent an actual payout — a direct-pay DEMO ticket reaching
      // PAID (peer-to-peer, same call as the buyer's debit above — DEMO is
      // final, unlike escrow there is no separate release step), an escrow
      // ticket's release (IN_PROGRESS→COMPLETED — only reachable via this
      // hash-confirm path for escrow tickets since ADR-255 D7 moved non-
      // escrow receipt confirmation to a plain, non-monetary PATCH), and a
      // coop milestone release (COMPLETED→ACCEPTED). ADR-197 named this
      // behaviour but never wired it to a call site — closed here.
      // confirmPaymentByHash() itself stays unchanged and rail-agnostic;
      // this crediting is Beta-only and lives entirely in this handler.
      for (const entry of updated) {
        const [kind, entityId, transition] = entry.split(':')
        try {
          if (kind === 'ticket' && (transition === 'PAID' || transition === 'COMPLETED' || transition === 'SELLER_LEG_CONFIRMED')) {
            const t = await prisma.ticket.findUnique({
              where: { id: entityId },
              select: { sellerPubkey: true, directPayRail: true, amountSats: true, cooperationId: true },
            })
            // Cooperation-linked tickets mirror milestone/coop state (e.g. the
            // final milestone's ACCEPTED also flips this ticket to COMPLETED)
            // but are never an independent payout event — the milestone
            // branch below is the sole payout trigger for coop tickets, so
            // crediting here too would double-pay the partner.
            // ADR-372 D7.2: SELLER_LEG_CONFIRMED is the seller-leg half of a
            // hosted-canvas two-confirm purchase — the seller is still paid
            // their price immediately on a DEMO direct-pay seller-leg confirm
            // (the fee is a separate buyer→platform payment, never a seller
            // deduction).
            const isDemoPayout = transition === 'COMPLETED' ? true : t?.directPayRail === 'DEMO'
            if (t && !t.cooperationId && isDemoPayout && (t.amountSats ?? 0) > 0) {
              await creditDemoWallet(prisma, t.sellerPubkey, t.amountSats!)
            }
          } else if (kind === 'milestone' && transition === 'ACCEPTED') {
            const m = await prisma.coopMilestone.findUnique({
              where: { id: entityId },
              select: { amountSats: true, partnerPubkey: true, cooperation: { select: { partnerPubkey: true } } },
            })
            const recipient = m?.partnerPubkey ?? m?.cooperation.partnerPubkey
            if (m && recipient && m.amountSats > 0) {
              await creditDemoWallet(prisma, recipient, m.amountSats)
            }
          }
        } catch (e) {
          console.warn(`[Beta/demo-pay] Seller credit failed for ${entry} (non-fatal):`, e)
        }
      }

      // Tier 2 (optional): real lnd2 pay + settle so the ADR-193 cycle runs green
      let realSettled: boolean | undefined
      let tier2Note: string | undefined
      if (demoConfig().realLndSettle && storedInvoice?.invoice) {
        try {
          const t2 = await tier2PayAndSettle(storedInvoice.invoice, paymentHash, prisma)
          realSettled = t2.realSettled
          tier2Note = t2.note
          console.log(`[Beta/demo-pay] Tier 2: ${t2.note}`)
        } catch (e) {
          console.warn('[Beta/demo-pay] Tier 2 failed (non-fatal):', e)
          tier2Note = `tier2 error: ${e instanceof Error ? e.message : String(e)}`
        }
      }

      console.log(`[Beta/demo-pay] Confirmed ${paymentHash} for ${callerPubkey}: ${updated.join(', ')}`)
      return res.json({ success: true, demoPaid: true, newBalance, updated, realSettled, tier2Note })
    } catch (error) {
      console.error('[Beta/demo-pay] Failed:', error)
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Demo payment failed' })
    }
  })

  // Auth-gated (requireFoundationAdminBySession, ADR-273) — resets a tester's demo wallet balance.
  router.post('/demo-topup', requireAuth(prisma), requireFoundationAdminBySession(prisma), async (req: Request, res: Response) => {
    if (!isBetaMode()) {
      return res.status(404).json({ error: 'Not found' })
    }

    try {
      const { pubkey } = req.body as { pubkey?: string }
      if (!pubkey) return res.status(400).json({ error: 'pubkey required' })

      const cfg = demoConfig()
      const newBalance = await resetDemoBalance(prisma, pubkey, cfg.startBalance)
      console.log(`[Beta/demo-topup] Reset demo balance for ${pubkey}: ${newBalance} sats`)
      return res.json({ success: true, newBalance })
    } catch (error) {
      console.error('[Beta/demo-topup] Failed:', error)
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Top-up failed' })
    }
  })

  return router
}
