// ADR-384 D10 — anonymous "session credits". A visitor with no account buys a
// credit pack and chats in `platform` mode for this browser. The identity is an
// opaque, server-minted `guestSessionId` (localStorage on the client) — NOT an
// account, NOT recoverable if lost. Mounted BEFORE the requireAuth AI-credits
// router, so nothing here can read or touch a real user's data:
//   public:  GET /  (global anonymous limiter)  ·  POST /purchase  ·  POST /purchase/:id/confirm (30/h per IP)
//   internal (secret-gated):   POST /reserve  ·  POST /refund
import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import { findAiCreditTier, getAiCreditTiers } from '../lib/ai-credits.js'
import { verifyPreimage } from '../lib/preimage.js'
import { resolvePlatformInvoice } from '../services/platformPaymentResolver.js'
import { isBetaMode } from '../services/betaMode.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import { aiHostedEnabled } from '../lib/ai-hosted.js'
import { getFoundationSettings } from '../lib/foundation-settings.js'

const GUEST_ID_RE = /^[0-9a-f]{64}$/

// A guest has no pubkey to throttle or ban, so the IP is the only defence
// (D10). Applied to the public routes only — the internal reserve/refund calls
// come from the mcp-server's own IP and are secret-gated instead.
const guestPublicLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 30, prefix: 'rl:ai-guest' })

function internalSecret(): string {
  return process.env.AI_INTERNAL_SECRET ?? ''
}

export function createAiGuestCreditsRouter(prisma: PrismaClient) {
  const router = Router()

  const guestIdOf = (v: unknown): string | null => (typeof v === 'string' && GUEST_ID_RE.test(v) ? v : null)

  function requireInternal(req: Request, res: Response): boolean {
    if (!internalSecret() || req.get('x-ai-internal-secret') !== internalSecret()) {
      res.status(403).json({ error: 'FORBIDDEN' })
      return false
    }
    return true
  }

  // GET /api/ai/credits/guest?guestSessionId= — tiers always, balance if known.
  // Balance read is cheap and covered by the global anonymous limiter; the tight
  // per-IP cap below is for the money-touching routes only.
  router.get('/', async (req: Request, res: Response) => {
    try {
      const id = guestIdOf(req.query.guestSessionId)
      const [row, settings] = await Promise.all([
        id ? prisma.aiGuestCredit.findUnique({ where: { guestSessionId: id } }) : Promise.resolve(null),
        getFoundationSettings(prisma),
      ])
      res.json({ requestsRemaining: row?.requestsRemaining ?? 0, requestsUsed: row?.requestsUsed ?? 0, tiers: getAiCreditTiers(), hostedEnabled: aiHostedEnabled(), salesPaused: settings.aiSalesPaused, sectionHidden: settings.aiAssistantSectionHidden })
    } catch (err) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: String(err) })
    }
  })

  // POST /api/ai/credits/guest/purchase { tier, guestSessionId? } — mints the
  // guest session on first purchase.
  router.post('/purchase', guestPublicLimiter, async (req: Request, res: Response) => {
    const body = req.body as { tier?: unknown; guestSessionId?: unknown }
    // Hard gate: no new sales until the operator has verified hosted AI live.
    if (!aiHostedEnabled()) return void res.status(503).json({ error: 'AI_HOSTED_NOT_ENABLED' })
    const tier = findAiCreditTier(body.tier)
    if (!tier) return void res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Unknown credit pack tier' })
    try {
      // ADR-405: platform-wide pause stops new sales before any invoice is minted.
      if ((await getFoundationSettings(prisma)).aiSalesPaused) {
        return void res.status(503).json({ error: 'AI_SALES_PAUSED' })
      }
      let guestSessionId = guestIdOf(body.guestSessionId)
      if (body.guestSessionId !== undefined && !guestSessionId) {
        return void res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid guestSessionId' })
      }
      if (guestSessionId) {
        const existing = await prisma.aiGuestCredit.findUnique({ where: { guestSessionId } })
        if (!existing) return void res.status(404).json({ error: 'GUEST_SESSION_NOT_FOUND' })
      }

      let resolution
      try {
        resolution = await resolvePlatformInvoice(tier.priceSats, `Colabonate AI credits: ${tier.requests} requests`)
      } catch (err) {
        console.error('[AiGuestCredits] platform invoice resolution failed:', err instanceof Error ? err.message : err)
        return void res.status(502).json({ error: 'PLATFORM_INVOICE_FAILED' })
      }
      if (!resolution.ok) return void res.status(503).json({ error: resolution.reason })

      // Session is created only once the invoice exists, so a failed/503
      // purchase never leaves an orphaned guest row behind.
      if (!guestSessionId) {
        guestSessionId = randomBytes(32).toString('hex')
        await prisma.aiGuestCredit.create({ data: { guestSessionId } })
      }
      const purchase = await prisma.aiCreditPurchase.create({
        data: {
          guestSessionId,
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
        guestSessionId,
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

  // POST /api/ai/credits/guest/purchase/:id/confirm { guestSessionId, preimage? }
  router.post('/purchase/:id/confirm', guestPublicLimiter, async (req: Request, res: Response) => {
    const body = req.body as { guestSessionId?: unknown; preimage?: string }
    const guestSessionId = guestIdOf(body.guestSessionId)
    if (!guestSessionId) return void res.status(400).json({ error: 'VALIDATION_ERROR', message: 'guestSessionId required' })
    try {
      const purchase = await prisma.aiCreditPurchase.findUnique({ where: { id: req.params.id as string } })
      if (!purchase || purchase.guestSessionId !== guestSessionId) return void res.status(404).json({ error: 'NOT_FOUND' })

      const balanceOf = async () =>
        (await prisma.aiGuestCredit.findUnique({ where: { guestSessionId } }))?.requestsRemaining ?? 0

      if (purchase.status === 'PAID') {
        return void res.json({ success: true, alreadyPaid: true, requestsRemaining: await balanceOf() })
      }

      if (purchase.rail === 'LN') {
        if (!body.preimage || !purchase.paymentHash || !verifyPreimage(body.preimage, purchase.paymentHash)) {
          return void res.status(400).json({ error: 'PREIMAGE_MISMATCH' })
        }
      } else if (purchase.rail === 'DEMO') {
        // Beta-only simulated payment. A guest has no demo wallet to debit, so
        // this rail grants the pack outright — acceptable ONLY because DEMO
        // money is fake and the rail is issued/confirmable only in beta.
        if (!isBetaMode()) {
          return void res.status(403).json({ error: 'DEMO_RAIL_DISABLED', message: 'demo rail is only available in beta mode' })
        }
      } else {
        return void res.status(400).json({ error: 'UNKNOWN_RAIL' })
      }

      const won = await prisma.$transaction(async (tx) => {
        const claim = await tx.aiCreditPurchase.updateMany({
          where: { id: purchase.id, status: 'PENDING' },
          data: { status: 'PAID', confirmedAt: new Date() },
        })
        if (claim.count !== 1) return false
        await tx.aiGuestCredit.update({
          where: { guestSessionId },
          data: { requestsRemaining: { increment: purchase.requests } },
        })
        return true
      })
      res.json({ success: true, alreadyPaid: !won, requestsRemaining: await balanceOf() })
    } catch (err) {
      console.error('[AiGuestCredits] confirm failed:', err)
      res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // Internal: same CAS idiom as the authenticated pair (D3), keyed by guest id.
  router.post('/reserve', async (req: Request, res: Response) => {
    if (!requireInternal(req, res)) return
    const guestSessionId = guestIdOf((req.body as { guestSessionId?: unknown }).guestSessionId)
    if (!guestSessionId) return void res.status(400).json({ error: 'VALIDATION_ERROR' })
    try {
      const claim = await prisma.aiGuestCredit.updateMany({
        where: { guestSessionId, requestsRemaining: { gte: 1 } },
        data: { requestsRemaining: { decrement: 1 }, requestsUsed: { increment: 1 } },
      })
      if (claim.count !== 1) return void res.status(409).json({ error: 'AI_CREDITS_EXHAUSTED' })
      const row = await prisma.aiGuestCredit.findUnique({ where: { guestSessionId } })
      res.json({ ok: true, requestsRemaining: row?.requestsRemaining ?? 0 })
    } catch (err) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: String(err) })
    }
  })

  router.post('/refund', async (req: Request, res: Response) => {
    if (!requireInternal(req, res)) return
    const guestSessionId = guestIdOf((req.body as { guestSessionId?: unknown }).guestSessionId)
    if (!guestSessionId) return void res.status(400).json({ error: 'VALIDATION_ERROR' })
    try {
      const claim = await prisma.aiGuestCredit.updateMany({
        where: { guestSessionId, requestsUsed: { gte: 1 } },
        data: { requestsRemaining: { increment: 1 }, requestsUsed: { decrement: 1 } },
      })
      res.json({ ok: claim.count === 1 })
    } catch (err) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: String(err) })
    }
  })

  return router
}
