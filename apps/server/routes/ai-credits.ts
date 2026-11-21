// ADR-384 D2/D3 — fixed-price AI credit packs paid directly to Colabonate's own
// Lightning address (non-custodial: same rail as ADR-351/372). The stored
// `requestsRemaining` is a bounded service-entitlement counter, not money.
//
// Public (user-facing) routes:  GET /  ·  POST /purchase  ·  POST /purchase/:id/confirm
// Internal routes (mcp-server → API server, x-ai-internal-secret, same trust
// boundary as GET /api/ai/config/plain): POST /reserve  ·  POST /refund
import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import { findAiCreditTier, getAiCreditTiers } from '../lib/ai-credits.js'
import { verifyPreimage } from '../lib/preimage.js'
import { resolvePlatformInvoice } from '../services/platformPaymentResolver.js'
import { debitDemoWallet } from '../services/demoLedger.js'
import { isBetaMode } from '../services/betaMode.js'
import { aiHostedEnabled } from '../lib/ai-hosted.js'
import { getFoundationSettings } from '../lib/foundation-settings.js'

// Read lazily (dotenv runs after ES-module imports execute) — see ai-config.ts.
function internalSecret(): string {
  return process.env.AI_INTERNAL_SECRET ?? ''
}

const MAX_PENDING_PURCHASES_PER_HOUR = 10

export function createAiCreditsRouter(prisma: PrismaClient) {
  const router = Router()

  const authPubkeyOf = (req: Request) => (req as Request & { authPubkey?: string }).authPubkey

  function requireInternal(req: Request, res: Response): boolean {
    if (!internalSecret() || req.get('x-ai-internal-secret') !== internalSecret()) {
      res.status(403).json({ error: 'FORBIDDEN' })
      return false
    }
    return true
  }

  // GET /api/ai/credits — balance + the purchasable tiers.
  router.get('/', async (req: Request, res: Response) => {
    const pubkey = authPubkeyOf(req)
    if (!pubkey) return void res.status(401).json({ error: 'UNAUTHORIZED' })
    try {
      const [balance, policy, settings] = await Promise.all([
        prisma.aiCreditBalance.findUnique({ where: { pubkey } }),
        prisma.userAiPolicy.findUnique({ where: { pubkey }, select: { hostedAccess: true } }),
        getFoundationSettings(prisma),
      ])
      res.json({
        requestsRemaining: balance?.requestsRemaining ?? 0,
        requestsUsed: balance?.requestsUsed ?? 0,
        tiers: getAiCreditTiers(),
        hostedEnabled: aiHostedEnabled(),
        // ADR-402 D7: restrict-only per-identity suspension of the hosted path.
        hostedSuspended: policy?.hostedAccess === 'SUSPENDED',
        // ADR-405: platform-wide sales pause / Home-section visibility.
        salesPaused: settings.aiSalesPaused,
        sectionHidden: settings.aiAssistantSectionHidden,
      })
    } catch (err) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: String(err) })
    }
  })

  // POST /api/ai/credits/purchase { tier } → invoice (LN) or DEMO marker (beta).
  router.post('/purchase', async (req: Request, res: Response) => {
    const pubkey = authPubkeyOf(req)
    if (!pubkey) return void res.status(401).json({ error: 'UNAUTHORIZED' })
    // Hard gate: no new sales until the operator has verified hosted AI live.
    if (!aiHostedEnabled()) return void res.status(503).json({ error: 'AI_HOSTED_NOT_ENABLED' })
    const tier = findAiCreditTier((req.body as { tier?: unknown }).tier)
    if (!tier) return void res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Unknown credit pack tier' })

    try {
      // ADR-405: platform-wide pause stops new sales before any invoice is minted.
      if ((await getFoundationSettings(prisma)).aiSalesPaused) {
        return void res.status(503).json({ error: 'AI_SALES_PAUSED' })
      }
      const recentPending = await prisma.aiCreditPurchase.count({
        where: { pubkey, status: 'PENDING', createdAt: { gt: new Date(Date.now() - 3600_000) } },
      })
      if (recentPending >= MAX_PENDING_PURCHASES_PER_HOUR) {
        return void res.status(429).json({ error: 'TOO_MANY_PENDING_PURCHASES' })
      }

      const memo = `Colabonate AI credits: ${tier.requests} requests`
      let resolution
      try {
        resolution = await resolvePlatformInvoice(tier.priceSats, memo)
      } catch (err) {
        console.error('[AiCredits] platform invoice resolution failed:', err instanceof Error ? err.message : err)
        return void res.status(502).json({ error: 'PLATFORM_INVOICE_FAILED' })
      }
      if (!resolution.ok) {
        return void res.status(503).json({ error: resolution.reason })
      }

      const purchase = await prisma.aiCreditPurchase.create({
        data: {
          pubkey,
          tier: tier.id,
          requests: tier.requests,
          amountSats: tier.priceSats,
          rail: resolution.rail,
          invoice: resolution.rail === 'LN' ? resolution.invoice.bolt11 : null,
          paymentHash: resolution.rail === 'LN' ? resolution.invoice.paymentHash : null,
        },
      })
      res.status(201).json({
        id: purchase.id,
        tier: tier.id,
        requests: tier.requests,
        amountSats: tier.priceSats,
        rail: purchase.rail,
        invoice: purchase.invoice,
        paymentHash: purchase.paymentHash,
        status: purchase.status,
      })
    } catch (err) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: String(err) })
    }
  })

  // POST /api/ai/credits/purchase/:id/confirm { preimage? } — idempotent.
  router.post('/purchase/:id/confirm', async (req: Request, res: Response) => {
    const pubkey = authPubkeyOf(req)
    if (!pubkey) return void res.status(401).json({ error: 'UNAUTHORIZED' })
    try {
      const purchase = await prisma.aiCreditPurchase.findUnique({ where: { id: req.params.id as string } })
      if (!purchase || purchase.pubkey !== pubkey) return void res.status(404).json({ error: 'NOT_FOUND' })

      const balanceOf = async () =>
        (await prisma.aiCreditBalance.findUnique({ where: { pubkey } }))?.requestsRemaining ?? 0

      if (purchase.status === 'PAID') {
        return void res.json({ success: true, alreadyPaid: true, requestsRemaining: await balanceOf() })
      }

      const credit = (tx: Pick<PrismaClient, 'aiCreditBalance'>) =>
        tx.aiCreditBalance.upsert({
          where: { pubkey },
          create: { pubkey, requestsRemaining: purchase.requests },
          update: { requestsRemaining: { increment: purchase.requests } },
        })

      if (purchase.rail === 'LN') {
        const { preimage } = req.body as { preimage?: string }
        if (!preimage || !purchase.paymentHash || !verifyPreimage(preimage, purchase.paymentHash)) {
          return void res.status(400).json({ error: 'PREIMAGE_MISMATCH' })
        }
        // CAS + credit in one transaction: a concurrent double-confirm can
        // never credit the pack twice (only one updateMany sees PENDING).
        const won = await prisma.$transaction(async (tx) => {
          const claim = await tx.aiCreditPurchase.updateMany({
            where: { id: purchase.id, status: 'PENDING' },
            data: { status: 'PAID', confirmedAt: new Date() },
          })
          if (claim.count !== 1) return false
          await credit(tx)
          // ADR-402 D2: movement ledger row in the same transaction as the counter.
          await tx.aiCreditLedgerEntry.create({
            data: { pubkey, delta: purchase.requests, kind: 'PURCHASE', purchaseId: purchase.id, idempotencyKey: `purchase:${purchase.id}` },
          })
          return true
        })
        return void res.json({ success: true, alreadyPaid: !won, requestsRemaining: await balanceOf() })
      }

      if (purchase.rail === 'DEMO') {
        // Defense in depth — resolvePlatformInvoice only issues DEMO in beta.
        if (!isBetaMode()) {
          return void res.status(403).json({ error: 'DEMO_RAIL_DISABLED', message: 'demo rail is only available in beta mode' })
        }
        // Claim first so a concurrent double-confirm cannot debit twice.
        const claim = await prisma.aiCreditPurchase.updateMany({
          where: { id: purchase.id, status: 'PENDING' },
          data: { status: 'PAID', confirmedAt: new Date() },
        })
        if (claim.count !== 1) {
          return void res.json({ success: true, alreadyPaid: true, requestsRemaining: await balanceOf() })
        }
        try {
          await debitDemoWallet(prisma, pubkey, purchase.amountSats)
        } catch (err) {
          await prisma.aiCreditPurchase.updateMany({
            where: { id: purchase.id },
            data: { status: 'PENDING', confirmedAt: null },
          })
          return void res.status(402).json({
            error: 'DEMO_BALANCE_EXHAUSTED',
            message: err instanceof Error ? err.message : 'Demo balance exhausted',
          })
        }
        await credit(prisma)
        // ADR-402 D2: best-effort ledger row (the DEMO rail confirm is not transactional).
        await prisma.aiCreditLedgerEntry.create({
          data: { pubkey, delta: purchase.requests, kind: 'PURCHASE', purchaseId: purchase.id, idempotencyKey: `purchase:${purchase.id}` },
        }).catch((err) => console.error('[AiCredits] purchase ledger write failed:', err))
        return void res.json({ success: true, alreadyPaid: false, requestsRemaining: await balanceOf() })
      }

      res.status(400).json({ error: 'UNKNOWN_RAIL' })
    } catch (err) {
      console.error('[AiCredits] confirm failed:', err)
      res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // POST /api/ai/credits/reserve — internal. Atomically takes one request.
  router.post('/reserve', async (req: Request, res: Response) => {
    if (!requireInternal(req, res)) return
    const pubkey = authPubkeyOf(req)
    if (!pubkey) return void res.status(401).json({ error: 'UNAUTHORIZED' })
    try {
      // ADR-402 D7 (restrict-only): a suspended identity cannot consume hosted
      // requests. Paid entitlements stay on the account (D3 debit is separate).
      const policy = await prisma.userAiPolicy.findUnique({ where: { pubkey }, select: { hostedAccess: true } })
      if (policy?.hostedAccess === 'SUSPENDED') {
        return void res.status(403).json({ error: 'AI_ACCESS_SUSPENDED' })
      }
      const claim = await prisma.aiCreditBalance.updateMany({
        where: { pubkey, requestsRemaining: { gte: 1 } },
        data: { requestsRemaining: { decrement: 1 }, requestsUsed: { increment: 1 } },
      })
      if (claim.count !== 1) return void res.status(409).json({ error: 'AI_CREDITS_EXHAUSTED' })
      const balance = await prisma.aiCreditBalance.findUnique({ where: { pubkey } })
      res.json({ ok: true, requestsRemaining: balance?.requestsRemaining ?? 0 })
    } catch (err) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: String(err) })
    }
  })

  // POST /api/ai/credits/refund — internal. Only when the upstream LLM call
  // failed before any output was produced (never for a user-side abort).
  router.post('/refund', async (req: Request, res: Response) => {
    if (!requireInternal(req, res)) return
    const pubkey = authPubkeyOf(req)
    if (!pubkey) return void res.status(401).json({ error: 'UNAUTHORIZED' })
    try {
      // requestsUsed >= 1 guard: a refund can never mint more than was consumed.
      const claim = await prisma.aiCreditBalance.updateMany({
        where: { pubkey, requestsUsed: { gte: 1 } },
        data: { requestsRemaining: { increment: 1 }, requestsUsed: { decrement: 1 } },
      })
      res.json({ ok: claim.count === 1 })
    } catch (err) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: String(err) })
    }
  })

  return router
}
