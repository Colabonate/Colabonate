import { Router, type Request, type Response } from 'express'
import { timingSafeEqual } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import type { AuthenticatedRequest } from '../types/express.js'
import { requireAuth } from '../middleware/require-auth.js'
import { createRateLimiter } from '../middleware/rate-limit.js'
import { verifyPreimage } from '../lib/preimage.js'
import { resolvePlatformInvoice } from '../services/platformPaymentResolver.js'
import { debitDemoWallet } from '../services/demoLedger.js'
import { isBetaMode } from '../services/betaMode.js'
import {
  ACTIVE_MCP_PASS_ORDER,
  activeMcpPassWhere,
  computePassExpiry,
  findAnyMcpPassTier,
  findMcpPassTier,
  getMcpPassTiers,
  mcpLifetimeConnectionTtlMs,
  mcpPaywallActive,
  MCP_TRIAL_MS,
} from '../lib/mcp-passes.js'
import { getFoundationSettings } from '../lib/foundation-settings.js'
import {
  isMcpScope,
  READ_SCOPE,
  validateMcpConnection,
  issueMcpConnection,
  issueDerivedSession,
  revokeMcpConnection,
  recordMcpConnectionEvent,
  type McpConnectionWithUser,
} from '../lib/mcp-connections.js'

// ADR-371 — MCP connection management + internal relay.
//
// Security posture (docs/decisions/371-user-agent-mcp-connect-access.md D7/D9):
// - connect/list/revoke are browser-session-guarded (requireAuth) and rate
//   limited; only the masked connection list leaves the API — never tokenHash,
//   never token material.
// - POST /session is the internal relay: guarded by the shared
//   AI_INTERNAL_SECRET (same channel as GET /api/ai/config/plain, ADR-281 D4)
//   PLUS a valid MCP bearer. It is the ONLY place an MCP connection converts
//   into REST rights (a short-lived derived Session, kind='MCP'). MCP tokens
//   are otherwise REST-inert.
// - Blocked accounts revoke all connections at block time (ADR-284 parity);
//   this route re-checks and additionally fails closed for the gap.

// Read lazily inside the handler: ES-module imports execute before index.ts
// boot runs dotenv.config(), so a module-level capture would always see an
// empty value in dev (tsx) and in the compiled bundle alike.
function internalSecret(): string {
  return process.env.AI_INTERNAL_SECRET ?? ''
}

/** Constant-time comparison for the internal relay secret (FU-195-C hygiene). */
function secretEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  // Node's crypto.timingSafeEqual throws on unequal buffer lengths, so length
  // is checked first and both buffers are equal-sized here.
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

function sanitizeScopes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [READ_SCOPE]
  const seen = new Set<string>()
  for (const s of raw) {
    if (isMcpScope(s) && s !== READ_SCOPE) seen.add(s) // read is forced, never user-toggled
  }
  return [READ_SCOPE, ...[...seen].sort()]
}

function maskedConnection(c: {
  id: string
  scope: string[]
  label: string | null
  createdAt: Date
  expiresAt: Date
  revokedAt: Date | null
  lastUsedAt: Date | null
  passTier: string | null
}): Record<string, unknown> {
  return {
    id: c.id,
    scope: c.scope,
    label: c.label,
    createdAt: c.createdAt,
    expiresAt: c.expiresAt,
    revokedAt: c.revokedAt,
    lastUsedAt: c.lastUsedAt,
    passTier: c.passTier,
    active: !c.revokedAt && c.expiresAt > new Date(),
  }
}

export function createMcpRouter(prisma: PrismaClient) {
  // Limiters are built at router-creation time (post dotenv boot), matching the
  // lazy-env convention of the rest of the server (ADR-371 D9).
  const mcpConnectLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 20,
    prefix: 'rl:mcp-connect',
  })
  const mcpRelayLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 600,
    prefix: 'rl:mcp-relay',
  })
  const router = Router()

  /** Newest paid, unexpired pass for a user (ADR-384 D11). ADR-410 D2: a
   * lifetime row (expiresAt null) is active and outranks any dated pass. */
  async function activeMcpPass(pubkey: string): Promise<{ tier: string; expiresAt: Date | null; lifetime: boolean } | null> {
    const row = await prisma.mcpAccessPass.findFirst({
      where: activeMcpPassWhere({ pubkey }),
      orderBy: ACTIVE_MCP_PASS_ORDER,
    })
    if (!row) return null
    return row.expiresAt ? { tier: row.tier, expiresAt: row.expiresAt, lifetime: false } : { tier: row.tier, expiresAt: null, lifetime: true }
  }

  // GET /api/mcp/pricing - public: lets the Home section and guests see whether
  // MCP access is paid here and what it costs. No user data.
  router.get('/pricing', async (_req: Request, res: Response) => {
    try {
      const settings = await getFoundationSettings(prisma)
      res.json({
        paywallActive: mcpPaywallActive(),
        // ADR-405: platform-wide sales pause / Home-section visibility.
        salesPaused: settings.mcpSalesPaused,
        sectionHidden: settings.mcpSectionHidden,
        trialMinutes: MCP_TRIAL_MS / 60_000,
        passes: getMcpPassTiers(),
      })
    } catch (err) {
      console.error('[mcp/pricing] Error:', err)
      res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // GET /api/mcp/access - what the user can do right now: paywall on/off, trial
  // still available, active pass, and the purchasable passes.
  router.get('/access', requireAuth(prisma), async (req: AuthenticatedRequest, res: Response) => {
    const pubkey = req.authPubkey
    if (!pubkey) return void res.status(401).json({ error: 'UNAUTHORIZED' })
    try {
      const paywall = mcpPaywallActive()
      const [pass, trial, policy] = await Promise.all([
        activeMcpPass(pubkey),
        prisma.mcpTrial.findUnique({ where: { pubkey } }),
        // ADR-402 D7: restrict-only per-identity MCP suspension.
        prisma.userAiPolicy.findUnique({ where: { pubkey }, select: { mcpAccess: true } }),
      ])
      res.json({
        paywallActive: paywall,
        suspended: policy?.mcpAccess === 'SUSPENDED',
        trialAvailable: paywall && !trial && !pass,
        trialMinutes: MCP_TRIAL_MS / 60_000,
        activePass: pass,
        passes: getMcpPassTiers(),
      })
    } catch (err) {
      console.error('[mcp/access] Error:', err)
      res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // POST /api/mcp/passes/purchase { tier } - invoice (LN) or DEMO marker (beta).
  router.post('/passes/purchase', requireAuth(prisma), mcpConnectLimiter, async (req: AuthenticatedRequest, res: Response) => {
    const pubkey = req.authPubkey
    if (!pubkey) return void res.status(401).json({ error: 'UNAUTHORIZED' })
    const tier = findMcpPassTier((req.body as { tier?: unknown } | undefined)?.tier)
    if (!tier) return void res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Unknown pass tier' })
    try {
      // ADR-405: platform-wide pause stops new sales before any invoice is minted.
      if ((await getFoundationSettings(prisma)).mcpSalesPaused) {
        return void res.status(503).json({ error: 'MCP_SALES_PAUSED' })
      }
      // ADR-410 D5: a lifetime pass cannot stack — refuse the second payment
      // before any invoice is minted so nobody pays twice for "never expires".
      // Tier-agnostic: ANY active null-expiry pass counts, so an env ladder
      // with more than one lifetime tier cannot be double-bought either.
      if (tier.hours === null) {
        const existing = await prisma.mcpAccessPass.findFirst({
          where: { pubkey, status: 'PAID', expiresAt: null },
          select: { id: true },
        })
        if (existing) return void res.status(409).json({ error: 'LIFETIME_ALREADY_ACTIVE', message: 'You already have lifetime MCP access.' })
      }
      let resolution
      try {
        resolution = await resolvePlatformInvoice(tier.priceSats, `Colabonate MCP access: ${tier.id} pass`)
      } catch (err) {
        console.error('[mcp/passes] platform invoice resolution failed:', err instanceof Error ? err.message : err)
        return void res.status(502).json({ error: 'PLATFORM_INVOICE_FAILED' })
      }
      if (!resolution.ok) return void res.status(503).json({ error: resolution.reason })
      const pass = await prisma.mcpAccessPass.create({
        data: {
          pubkey,
          tier: tier.id,
          amountSats: tier.priceSats,
          rail: resolution.rail,
          invoice: resolution.rail === 'LN' ? resolution.invoice.bolt11 : null,
          paymentHash: resolution.rail === 'LN' ? resolution.invoice.paymentHash : null,
        },
      })
      res.status(201).json({
        id: pass.id,
        tier: tier.id,
        hours: tier.hours,
        amountSats: tier.priceSats,
        rail: pass.rail,
        invoice: pass.invoice,
        paymentHash: pass.paymentHash,
        status: pass.status,
      })
    } catch (err) {
      console.error('[mcp/passes/purchase] Error:', err)
      res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // POST /api/mcp/passes/:id/confirm { preimage? } - idempotent; the pass clock
  // starts here and a pass bought while another is active extends it.
  router.post('/passes/:id/confirm', requireAuth(prisma), async (req: AuthenticatedRequest, res: Response) => {
    const pubkey = req.authPubkey
    if (!pubkey) return void res.status(401).json({ error: 'UNAUTHORIZED' })
    try {
      const pass = await prisma.mcpAccessPass.findUnique({ where: { id: req.params.id as string } })
      if (!pass || pass.pubkey !== pubkey) return void res.status(404).json({ error: 'NOT_FOUND' })
      // ADR-410 D4: legacy Day/Week/Month rows (created before the lifetime
      // switch) must still confirm — resolve sale tiers AND the frozen ladder.
      const tier = findAnyMcpPassTier(pass.tier)
      if (!tier) return void res.status(500).json({ error: 'TIER_UNAVAILABLE' })

      const view = async () => {
        const active = await activeMcpPass(pubkey)
        return { activePass: active }
      }
      if (pass.status === 'PAID') return void res.json({ success: true, alreadyPaid: true, ...(await view()) })

      // Applies the pass period; runs only for the request that won the PENDING claim.
      // ADR-410 D2: lifetime tiers activate with expiresAt null — nothing to stack.
      const activate = async (db: Pick<PrismaClient, 'mcpAccessPass'>) => {
        const current = await db.mcpAccessPass.findFirst({
          where: activeMcpPassWhere({ pubkey, NOT: { id: pass.id } }),
          orderBy: ACTIVE_MCP_PASS_ORDER,
        })
        const now = new Date()
        await db.mcpAccessPass.update({
          where: { id: pass.id },
          data: { activatedAt: now, expiresAt: tier.hours === null ? null : computePassExpiry(now, current?.expiresAt ?? null, tier.hours) },
        })
      }

      if (pass.rail === 'LN') {
        const { preimage } = (req.body ?? {}) as { preimage?: string }
        if (!preimage || !pass.paymentHash || !verifyPreimage(preimage, pass.paymentHash)) {
          return void res.status(400).json({ error: 'PREIMAGE_MISMATCH' })
        }
        const won = await prisma.$transaction(async (tx) => {
          const claim = await tx.mcpAccessPass.updateMany({
            where: { id: pass.id, status: 'PENDING' },
            data: { status: 'PAID', confirmedAt: new Date() },
          })
          if (claim.count !== 1) return false
          await activate(tx)
          return true
        })
        return void res.json({ success: true, alreadyPaid: !won, ...(await view()) })
      }

      if (pass.rail === 'DEMO') {
        if (!isBetaMode()) {
          return void res.status(403).json({ error: 'DEMO_RAIL_DISABLED', message: 'demo rail is only available in beta mode' })
        }
        // Claim first so a concurrent double-confirm cannot debit twice.
        const claim = await prisma.mcpAccessPass.updateMany({
          where: { id: pass.id, status: 'PENDING' },
          data: { status: 'PAID', confirmedAt: new Date() },
        })
        if (claim.count !== 1) return void res.json({ success: true, alreadyPaid: true, ...(await view()) })
        try {
          await debitDemoWallet(prisma, pubkey, pass.amountSats)
        } catch (err) {
          await prisma.mcpAccessPass.updateMany({ where: { id: pass.id }, data: { status: 'PENDING', confirmedAt: null } })
          return void res.status(402).json({
            error: 'DEMO_BALANCE_EXHAUSTED',
            message: err instanceof Error ? err.message : 'Demo balance exhausted',
          })
        }
        await activate(prisma)
        return void res.json({ success: true, alreadyPaid: false, ...(await view()) })
      }

      res.status(400).json({ error: 'UNKNOWN_RAIL' })
    } catch (err) {
      console.error('[mcp/passes/confirm] Error:', err)
      res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // POST /api/mcp/connect — mint a connection from the login session.
  router.post('/connect', requireAuth(prisma), mcpConnectLimiter, async (req: AuthenticatedRequest, res: Response) => {
    const pubkey = req.authPubkey
    if (!pubkey) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' })
      return
    }
    const body = (req.body ?? {}) as { scopes?: unknown; label?: unknown }
    const scope = sanitizeScopes(body.scopes)
    const label = typeof body.label === 'string' ? body.label : undefined
    let trialClaimed = false
    try {
      // ADR-402 D7: a suspended identity cannot mint new MCP connections.
      const policy = await prisma.userAiPolicy.findUnique({ where: { pubkey }, select: { mcpAccess: true } })
      if (policy?.mcpAccess === 'SUSPENDED') {
        res.status(403).json({ error: 'MCP_ACCESS_SUSPENDED', message: 'MCP access is suspended for this account.' })
        return
      }
      // ADR-384 D11: with the paywall active a connection lives as long as the
      // user's pass, or 30 minutes on their one-time trial. Without a pass and
      // with the trial spent, the answer is a clear 402, never a silent free ride.
      // ADR-410 D3: lifetime holders get a long but bounded connection TTL —
      // no never-expiring bearer tokens.
      let ttlMs: number | undefined
      let passTier: string | undefined
      if (mcpPaywallActive()) {
        const pass = await activeMcpPass(pubkey)
        if (pass) {
          ttlMs = pass.lifetime ? mcpLifetimeConnectionTtlMs() : pass.expiresAt!.getTime() - Date.now()
          passTier = pass.tier
        } else {
          try {
            await prisma.mcpTrial.create({ data: { pubkey } })
            trialClaimed = true
          } catch {
            res.status(402).json({
              error: 'TRIAL_ALREADY_USED',
              message: 'Your free 30 minute trial is used up. A single one-time payment unlocks lifetime access.',
            })
            return
          }
          ttlMs = MCP_TRIAL_MS
          passTier = 'trial'
        }
      }
      const { token, connectionId } = await issueMcpConnection(prisma, { pubkey, scope, label, ttlMs, passTier })
      // Token is shown exactly once; only the hash is stored (FU-195-C).
      res.status(201).json({ token, connectionId, passTier: passTier ?? null })
    } catch (err) {
      // A failed mint must not burn the one-time trial.
      if (trialClaimed) await prisma.mcpTrial.delete({ where: { pubkey } }).catch(() => {})
      console.error('[mcp/connect] Error:', err)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to create MCP connection' })
    }
  })

  // GET /api/mcp/connections — the user's connection ledger (management UI).
  router.get('/connections', requireAuth(prisma), async (req: AuthenticatedRequest, res: Response) => {
    const pubkey = req.authPubkey
    if (!pubkey) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' })
      return
    }
    try {
      const rows = await prisma.mcpConnection.findMany({
        where: { pubkey },
        orderBy: { createdAt: 'desc' },
      })
      res.json({ connections: rows.map(maskedConnection) })
    } catch (err) {
      console.error('[mcp/connections] Error:', err)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to list MCP connections' })
    }
  })

  // GET /api/mcp/connections/:id/events — a connection's activity ledger
  // (Phase 3 UI: "wann verbunden, was passiert"). Owner-scoped like revoke;
  // newest rows first, bounded by the client-side limit (server keeps only the
  // newest MCP_CONNECTION_EVENT_MAX rows per connection anyway).
  router.get('/connections/:id/events', requireAuth(prisma), async (req: AuthenticatedRequest, res: Response) => {
    const pubkey = req.authPubkey
    const connectionId = req.params.id
    if (!pubkey) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' })
      return
    }
    const rawLimit = Number(req.query.limit)
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200) : 100
    try {
      const owned = await prisma.mcpConnection.findFirst({
        where: { id: connectionId, pubkey },
        select: { id: true },
      })
      if (!owned) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'No MCP connection with that id' })
        return
      }
      const events = await prisma.mcpConnectionEvent.findMany({
        where: { connectionId },
        orderBy: { ts: 'desc' },
        take: limit,
      })
      res.json({ events })
    } catch (err) {
      console.error('[mcp/connections/:id/events] Error:', err)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to list MCP connection events' })
    }
  })

  // POST /api/mcp/events — internal activity-ledger relay (Phase 3). Guarded
  // exactly like /session (AI_INTERNAL_SECRET + valid MCP bearer): the gateway
  // reports a completed tool call here so /ai/connect can show "was passiert".
  // Fire-and-forget for the gateway; bounded per connection server-side.
  router.post('/events', mcpRelayLimiter, async (req: Request, res: Response) => {
    if (!internalSecret() || !secretEqual(req.get('x-ai-internal-secret') ?? '', internalSecret())) {
      res.status(403).json({ error: 'FORBIDDEN' })
      return
    }
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing MCP bearer token' })
      return
    }
    const token = authHeader.slice(7)
    const body = (req.body ?? {}) as { tool?: unknown; outcome?: unknown; agentLabel?: unknown }
    const tool = typeof body.tool === 'string' ? body.tool.trim().slice(0, 120) : ''
    const outcome = body.outcome === 'success' || body.outcome === 'error' ? body.outcome : null
    if (!tool || !outcome) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'tool and outcome (success|error) are required' })
      return
    }
    const agentLabel = typeof body.agentLabel === 'string' ? body.agentLabel : undefined
    try {
      const recorded = await recordMcpConnectionEvent(prisma, token, { tool, outcome, agentLabel })
      if (!recorded) {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid, revoked or expired MCP connection' })
        return
      }
      res.status(201).json({ recorded: true })
    } catch (err) {
      console.error('[mcp/events] Error:', err)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to record MCP connection event' })
    }
  })

  // POST /api/mcp/connections/:id/revoke — kill a connection (owner only).
  router.post('/connections/:id/revoke', requireAuth(prisma), async (req: AuthenticatedRequest, res: Response) => {
    const pubkey = req.authPubkey
    const connectionId = req.params.id
    if (!pubkey) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' })
      return
    }
    try {
      const revoked = await revokeMcpConnection(prisma, connectionId, pubkey)
      if (!revoked) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'No active MCP connection with that id' })
        return
      }
      res.json({ success: true, connectionId })
    } catch (err) {
      console.error('[mcp/revoke] Error:', err)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to revoke MCP connection' })
    }
  })

  // POST /api/mcp/session — internal relay (D7). AI_INTERNAL_SECRET + MCP
  // bearer → short-lived derived REST session. The mcp-server gateway is the
  // intended (and only) caller; it caches and refreshes before expiry.
  router.post('/session', mcpRelayLimiter, async (req: Request, res: Response) => {
    if (!internalSecret() || !secretEqual(req.get('x-ai-internal-secret') ?? '', internalSecret())) {
      res.status(403).json({ error: 'FORBIDDEN' })
      return
    }
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing MCP bearer token' })
      return
    }
    const token = authHeader.slice(7)
    try {
      const conn: McpConnectionWithUser | null = await validateMcpConnection(prisma, token)
      if (!conn) {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid, revoked or expired MCP connection' })
        return
      }
      const derived = await issueDerivedSession(prisma, conn)
      await prisma.mcpConnection
        .update({ where: { id: conn.id }, data: { lastUsedAt: new Date() } })
        .catch(() => {})
      res.json({
        token: derived.token,
        expiresInMs: derived.ttlMs,
        connectionId: conn.id,
        label: conn.label,
        scopes: conn.scope,
        identity: { pubkey: conn.user.pubkey, identityLevel: conn.user.identityLevel },
      })
    } catch (err) {
      console.error('[mcp/session] Error:', err)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to mint derived session' })
    }
  })

  return router
}
