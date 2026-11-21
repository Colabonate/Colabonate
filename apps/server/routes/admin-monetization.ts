// ADR-402 Phase 2 — Admin Monetization & Entitlements.
//
// Mounted under /api/admin (requireAuth + requireFoundationAdminBySession), so
// every handler is already admin-gated. This file owns the dedicated entitlement
// write paths that ADR-402 D3/D4/D7 define — the raw credit tables stay OUT of
// the generic entity browser on purpose (no reason, no ledger, no limits there).
//
// Invariants enforced here:
//  - Every grant/debit/pass change writes an AdminAuditLog row.
//  - Every non-consumption balance movement writes an AiCreditLedgerEntry row in
//    the same transaction as the counter update (D2).
//  - reason is mandatory (min 10 chars) on every movement.
//  - grants are capped per action and per admin per day; an optional
//    idempotencyKey makes a retried/double-clicked grant a no-op.
//  - An idempotency key is stored as `kind:key` so the global unique column can
//    never collide across movement kinds.

import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import type { AuthenticatedRequest } from '../types/express.js'
import {
  ACTIVE_MCP_PASS_ORDER,
  activeMcpPassWhere,
  computePassExpiry,
  findAnyMcpPassTier,
  getMcpPassTiers,
} from '../lib/mcp-passes.js'
import { getAiCreditTiers } from '../lib/ai-credits.js'
import { createNotification } from '../services/notifications.js'
import { getFoundationSettings, getFoundationSettingsRecord, parseSettingsPatch, updateFoundationSettings } from '../lib/foundation-settings.js'

const GRANT_KINDS = ['GOODWILL', 'PROMO', 'SUPPORT', 'BETA'] as const
type GrantKind = (typeof GRANT_KINDS)[number]

const MIN_REASON_LEN = 10

// Read env lazily (dotenv runs after ES-module imports execute — see ai-credits.ts).
function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback
}

export function createAdminMonetizationRouter(prisma: PrismaClient) {
  const router = Router()

  const adminPubkeyOf = (req: Request): string => (req as AuthenticatedRequest).authPubkey ?? ''
  const adminGrantMax = () => envInt('ADMIN_CREDIT_GRANT_MAX', 1_000)
  const adminGrantDailyMax = () => envInt('ADMIN_CREDIT_GRANT_DAILY_MAX', 5_000)

  function cleanString(v: unknown, max = 500): string {
    return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : ''
  }

  function intInRange(v: unknown, min: number, max: number): number | null {
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isInteger(n) || n < min || n > max) return null
    return n
  }

  function maskedEmail(email: string | null): string | null {
    return email ? email.replace(/(.{2}).*(@.*)/, '$1***$2') : null
  }

  function ledgerKey(kind: string, key: string): string {
    return `${kind}:${key}`
  }

  async function audit(
    adminPubkey: string,
    action: string,
    targetId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await prisma.adminAuditLog.create({
      data: { adminPubkey, action, targetId, payload: JSON.stringify(payload) },
    }).catch((err) => console.error('[Admin/monetization] AuditLog write failed:', err))
  }

  async function notify(
    pubkey: string,
    type: 'ai',
    title: string,
    message: string,
    actionUrl = '/ai',
  ): Promise<void> {
    await createNotification(prisma, { ownerPubkey: pubkey, type, title, message, actionUrl })
      .catch((err) => console.error('[Admin/monetization] notification failed:', err))
  }

  /** UTC start of today — the grant-daily window. */
  function startOfUtcDay(now = new Date()): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  }

  // ── GET /api/admin/entitlements/reconcile ────────────────────────────────
  // Cheap invariant probe for the dashboard: identities where
  // sum(ledger.delta) − requestsUsed ≠ requestsRemaining (D2). Registered
  // BEFORE the :pubkey route so "reconcile" is not read as a pubkey.
  router.get('/entitlements/reconcile', async (_req: Request, res: Response) => {
    try {
      const balances = await prisma.aiCreditBalance.findMany({
        select: { pubkey: true, requestsRemaining: true, requestsUsed: true },
      })
      const sums = await prisma.aiCreditLedgerEntry.groupBy({
        by: ['pubkey'],
        where: { pubkey: { not: null } },
        _sum: { delta: true },
      })
      const sumByPubkey = new Map(sums.map((s) => [s.pubkey as string, s._sum.delta ?? 0]))
      const mismatches = balances
        .map((b) => {
          const ledgerSum = sumByPubkey.get(b.pubkey) ?? 0
          const expected = ledgerSum - b.requestsUsed
          return { pubkey: b.pubkey, ledgerSum, requestsUsed: b.requestsUsed, requestsRemaining: b.requestsRemaining, expectedRemaining: expected }
        })
        .filter((r) => r.expectedRemaining !== r.requestsRemaining)
      return res.json({ checked: balances.length, mismatches })
    } catch (err) {
      console.error('[Admin/monetization] reconcile failed:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ── GET /api/admin/entitlements/:pubkey ──────────────────────────────────
  // Read model backing the Accounts detail panel's Entitlements section (D1).
  router.get('/entitlements/:pubkey', async (req: Request, res: Response) => {
    const pubkey = String(req.params.pubkey)
    try {
      const now = new Date()
      const [user, balance, ledger, activePass, trial, activeConnections, recentPasses, policy] =
        await Promise.all([
          prisma.user.findUnique({
            where: { pubkey },
            select: { pubkey: true, nip05: true, email: true, blockedAt: true },
          }),
          prisma.aiCreditBalance.findUnique({ where: { pubkey } }),
          prisma.aiCreditLedgerEntry.findMany({
            where: { pubkey },
            orderBy: { createdAt: 'desc' },
            take: 25,
          }),
          prisma.mcpAccessPass.findFirst({
            where: activeMcpPassWhere({ pubkey }),
            orderBy: ACTIVE_MCP_PASS_ORDER,
          }),
          prisma.mcpTrial.findUnique({ where: { pubkey } }),
          prisma.mcpConnection.count({ where: { pubkey, revokedAt: null, expiresAt: { gt: now } } }),
          prisma.mcpAccessPass.findMany({
            where: { pubkey },
            orderBy: { createdAt: 'desc' },
            take: 10,
          }),
          prisma.userAiPolicy.findUnique({ where: { pubkey } }),
        ])

      if (!user) return void res.status(404).json({ error: 'NOT_FOUND', message: 'No account with that pubkey' })

      return res.json({
        pubkey,
        user: { nip05: user.nip05, email: maskedEmail(user.email), blockedAt: user.blockedAt },
        ai: {
          requestsRemaining: balance?.requestsRemaining ?? 0,
          requestsUsed: balance?.requestsUsed ?? 0,
          ledger: ledger.map((e) => ({
            id: e.id,
            delta: e.delta,
            kind: e.kind,
            reason: e.reason,
            actorPubkey: e.actorPubkey,
            createdAt: e.createdAt,
          })),
        },
        mcp: {
          activePass: activePass
            ? { id: activePass.id, tier: activePass.tier, expiresAt: activePass.expiresAt, rail: activePass.rail, lifetime: activePass.expiresAt === null }
            : null,
          trialUsed: Boolean(trial),
          activeConnections,
          recentPasses: recentPasses.map((p) => ({
            id: p.id,
            tier: p.tier,
            rail: p.rail,
            status: p.status,
            expiresAt: p.expiresAt,
            createdAt: p.createdAt,
          })),
        },
        policy: policy
          ? {
              hostedAccess: policy.hostedAccess,
              mcpAccess: policy.mcpAccess,
              mcpMaxPassHours: policy.mcpMaxPassHours,
              note: policy.note,
              updatedAt: policy.updatedAt,
            }
          : null,
        tiers: { ai: getAiCreditTiers(), mcp: getMcpPassTiers() },
        limits: { grantMax: adminGrantMax(), grantDailyMax: adminGrantDailyMax() },
      })
    } catch (err) {
      console.error('[Admin/monetization] entitlements read failed:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ── POST /api/admin/ai-credits/:pubkey/grant (D3) ────────────────────────
  router.post('/ai-credits/:pubkey/grant', async (req: Request, res: Response) => {
    const pubkey = String(req.params.pubkey)
    const adminPubkey = adminPubkeyOf(req)
    const body = (req.body ?? {}) as Record<string, unknown>
    const requests = intInRange(body.requests, 1, adminGrantMax())
    const kind = cleanString(body.kind, 20) as GrantKind
    const reason = cleanString(body.reason, 500)
    const idempotencyKey = cleanString(body.idempotencyKey, 120) || null

    if (requests === null) {
      return void res.status(400).json({ error: 'INVALID_PAYLOAD', detail: `requests must be 1..${adminGrantMax()}` })
    }
    if (!GRANT_KINDS.includes(kind)) {
      return void res.status(400).json({ error: 'INVALID_PAYLOAD', detail: `kind must be one of: ${GRANT_KINDS.join(', ')}` })
    }
    if (reason.length < MIN_REASON_LEN) {
      return void res.status(400).json({ error: 'INVALID_PAYLOAD', detail: `reason must be at least ${MIN_REASON_LEN} characters` })
    }

    try {
      const user = await prisma.user.findUnique({ where: { pubkey }, select: { pubkey: true, blockedAt: true } })
      if (!user) return void res.status(404).json({ error: 'NOT_FOUND', message: 'No account with that pubkey' })
      if (user.blockedAt) return void res.status(409).json({ error: 'ACCOUNT_BLOCKED', message: 'Blocked accounts cannot receive grants' })

      const key = idempotencyKey ? ledgerKey('GRANT', idempotencyKey) : null
      if (key) {
        const existing = await prisma.aiCreditLedgerEntry.findUnique({ where: { idempotencyKey: key } })
        if (existing) {
          const balance = await prisma.aiCreditBalance.findUnique({ where: { pubkey } })
          return void res.json({ ok: true, alreadyApplied: true, requestsRemaining: balance?.requestsRemaining ?? 0 })
        }
      }

      const usedToday = await prisma.aiCreditLedgerEntry.aggregate({
        where: { actorPubkey: adminPubkey, kind: 'GRANT', createdAt: { gte: startOfUtcDay() } },
        _sum: { delta: true },
      })
      if ((usedToday._sum.delta ?? 0) + requests > adminGrantDailyMax()) {
        return void res.status(429).json({
          error: 'DAILY_GRANT_LIMIT',
          detail: `Daily grant total would exceed ${adminGrantDailyMax()} requests`,
        })
      }

      const balance = await prisma.$transaction(async (tx) => {
        const b = await tx.aiCreditBalance.upsert({
          where: { pubkey },
          create: { pubkey, requestsRemaining: requests },
          update: { requestsRemaining: { increment: requests } },
        })
        await tx.aiCreditLedgerEntry.create({
          data: { pubkey, delta: requests, kind: 'GRANT', reason, actorPubkey: adminPubkey, idempotencyKey: key },
        })
        return b
      })

      await audit(adminPubkey, 'Account.grant-ai-credits', pubkey, { requests, kind, reason })
      await notify(pubkey, 'ai', 'AI credits added', `Colabonate added ${requests} AI requests to your account.`, '/ai')

      return res.json({
        ok: true,
        alreadyApplied: false,
        requestsRemaining: balance.requestsRemaining,
        message: `Granted ${requests} AI requests`,
      })
    } catch (err) {
      // A concurrent duplicate idempotency key hits the unique index — treat as applied.
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        return void res.json({ ok: true, alreadyApplied: true })
      }
      console.error('[Admin/monetization] ai credit grant failed:', err)
      return void res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ── POST /api/admin/ai-credits/:pubkey/debit (D3) ────────────────────────
  router.post('/ai-credits/:pubkey/debit', async (req: Request, res: Response) => {
    const pubkey = String(req.params.pubkey)
    const adminPubkey = adminPubkeyOf(req)
    const body = (req.body ?? {}) as Record<string, unknown>
    const requests = intInRange(body.requests, 1, 1_000_000)
    const reason = cleanString(body.reason, 500)
    const idempotencyKey = cleanString(body.idempotencyKey, 120) || null

    if (requests === null) {
      return void res.status(400).json({ error: 'INVALID_PAYLOAD', detail: 'requests must be a positive integer' })
    }
    if (reason.length < MIN_REASON_LEN) {
      return void res.status(400).json({ error: 'INVALID_PAYLOAD', detail: `reason must be at least ${MIN_REASON_LEN} characters` })
    }

    try {
      const user = await prisma.user.findUnique({ where: { pubkey }, select: { pubkey: true } })
      if (!user) return void res.status(404).json({ error: 'NOT_FOUND', message: 'No account with that pubkey' })

      const key = idempotencyKey ? ledgerKey('DEBIT', idempotencyKey) : null
      if (key) {
        const existing = await prisma.aiCreditLedgerEntry.findUnique({ where: { idempotencyKey: key } })
        if (existing) {
          const balance = await prisma.aiCreditBalance.findUnique({ where: { pubkey } })
          return void res.json({ ok: true, alreadyApplied: true, requestsRemaining: balance?.requestsRemaining ?? 0 })
        }
      }

      const applied = await prisma.$transaction(async (tx) => {
        // CAS: never below zero, never a partial debit.
        const claim = await tx.aiCreditBalance.updateMany({
          where: { pubkey, requestsRemaining: { gte: requests } },
          data: { requestsRemaining: { decrement: requests } },
        })
        if (claim.count !== 1) return false
        await tx.aiCreditLedgerEntry.create({
          data: { pubkey, delta: -requests, kind: 'DEBIT', reason, actorPubkey: adminPubkey, idempotencyKey: key },
        })
        return true
      })
      if (!applied) {
        const balance = await prisma.aiCreditBalance.findUnique({ where: { pubkey } })
        return void res.status(409).json({
          error: 'INSUFFICIENT_CREDITS',
          detail: `Only ${balance?.requestsRemaining ?? 0} requests remain`,
        })
      }

      await audit(adminPubkey, 'Account.debit-ai-credits', pubkey, { requests, reason })
      const balance = await prisma.aiCreditBalance.findUnique({ where: { pubkey } })
      return res.json({
        ok: true,
        alreadyApplied: false,
        requestsRemaining: balance?.requestsRemaining ?? 0,
        message: `Debited ${requests} AI requests`,
      })
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        return void res.json({ ok: true, alreadyApplied: true })
      }
      console.error('[Admin/monetization] ai credit debit failed:', err)
      return void res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ── POST /api/admin/mcp-passes/:pubkey/grant (D4) ────────────────────────
  router.post('/mcp-passes/:pubkey/grant', async (req: Request, res: Response) => {
    const pubkey = String(req.params.pubkey)
    const adminPubkey = adminPubkeyOf(req)
    const body = (req.body ?? {}) as Record<string, unknown>
    const reason = cleanString(body.reason, 500)
    if (reason.length < MIN_REASON_LEN) {
      return void res.status(400).json({ error: 'INVALID_PAYLOAD', detail: `reason must be at least ${MIN_REASON_LEN} characters` })
    }

    try {
      const user = await prisma.user.findUnique({ where: { pubkey }, select: { pubkey: true, blockedAt: true } })
      if (!user) return void res.status(404).json({ error: 'NOT_FOUND', message: 'No account with that pubkey' })
      if (user.blockedAt) return void res.status(409).json({ error: 'ACCOUNT_BLOCKED', message: 'Blocked accounts cannot receive passes' })

      const policy = await prisma.userAiPolicy.findUnique({ where: { pubkey } })
      const hardMaxHours = 24 * 366
      const policyMax = policy?.mcpMaxPassHours ?? null

      // Accept either an explicit `hours` or a named tier (ADR-410 D4: legacy
      // tier labels stay grantable; a null-hours tier grants lifetime).
      let hours: number | null = intInRange(body.hours, 1, hardMaxHours)
      let tierLabel = cleanString(body.tier, 40) || 'admin-grant'
      let lifetime = false
      if (hours === null && body.tier) {
        const tier = findAnyMcpPassTier(body.tier)
        if (tier) {
          hours = tier.hours
          tierLabel = tier.id
          lifetime = tier.hours === null
        }
      }
      if (hours === null && !lifetime) {
        return void res.status(400).json({ error: 'INVALID_PAYLOAD', detail: 'hours or a known tier is required' })
      }
      if (lifetime && policyMax !== null) {
        // Restrict-only (ADR-402 D10): an mcpMaxPassHours policy must also
        // block lifetime grants, not just cap dated ones.
        return void res.status(409).json({ error: 'POLICY_MCP_MAX_PASS_HOURS', detail: 'This account is restricted to capped hour grants' })
      }
      const capped = policyMax !== null && hours !== null ? Math.min(hours, policyMax) : hours

      const now = new Date()
      const current = await prisma.mcpAccessPass.findFirst({
        where: activeMcpPassWhere({ pubkey }),
        orderBy: ACTIVE_MCP_PASS_ORDER,
      })
      // ADR-410 D7: nothing can extend "never" — skip instead of minting a
      // dominated dated row; still audited so the action is traceable.
      if (current && current.expiresAt === null) {
        await audit(adminPubkey, 'Account.grant-mcp-pass', pubkey, { noop: 'lifetime-already-active', requestedTier: tierLabel, reason })
        return res.json({
          ok: true,
          pass: { id: current.id, tier: current.tier, expiresAt: null },
          message: 'Account already has lifetime MCP access — grant skipped',
          note: 'lifetime-already-active',
        })
      }
      const expiresAt = lifetime ? null : computePassExpiry(now, current?.expiresAt ?? null, capped!)

      const pass = await prisma.mcpAccessPass.create({
        data: {
          pubkey,
          tier: tierLabel,
          amountSats: 0,
          rail: 'ADMIN',
          status: 'PAID',
          confirmedAt: now,
          activatedAt: now,
          expiresAt,
        },
      })

      await audit(adminPubkey, 'Account.grant-mcp-pass', pubkey, { hours: capped, requestedHours: hours, lifetime, reason, passId: pass.id })
      await notify(
        pubkey,
        'ai',
        'MCP access granted',
        lifetime ? 'Colabonate granted lifetime MCP access.' : `Colabonate granted ${capped} hours of MCP access.`,
        '/ai/connect',
      )

      return res.json({
        ok: true,
        pass: { id: pass.id, tier: pass.tier, expiresAt: pass.expiresAt },
        message: lifetime ? 'Granted lifetime MCP access' : `Granted ${capped} hours of MCP access`,
        capped: policyMax !== null && hours !== null && hours > policyMax,
      })
    } catch (err) {
      console.error('[Admin/monetization] mcp pass grant failed:', err)
      return void res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ── POST /api/admin/mcp-passes/:id/shorten (D4) ──────────────────────────
  // Ends a pass early without deleting the row (audit trail kept). A time at or
  // before now ends it immediately.
  router.post('/mcp-passes/:id/shorten', async (req: Request, res: Response) => {
    const id = String(req.params.id)
    const adminPubkey = adminPubkeyOf(req)
    const body = (req.body ?? {}) as Record<string, unknown>
    const reason = cleanString(body.reason, 500)
    const at = typeof body.expiresAt === 'string' ? new Date(body.expiresAt) : null
    if (reason.length < MIN_REASON_LEN) {
      return void res.status(400).json({ error: 'INVALID_PAYLOAD', detail: `reason must be at least ${MIN_REASON_LEN} characters` })
    }
    if (!at || Number.isNaN(at.getTime())) {
      return void res.status(400).json({ error: 'INVALID_PAYLOAD', detail: 'expiresAt must be an ISO date-time' })
    }

    try {
      const pass = await prisma.mcpAccessPass.findUnique({ where: { id } })
      if (!pass) return void res.status(404).json({ error: 'NOT_FOUND', message: 'No pass with that id' })
      const now = new Date()
      const target = at.getTime() <= now.getTime() ? now : at
      await prisma.mcpAccessPass.update({ where: { id }, data: { expiresAt: target } })

      await audit(adminPubkey, 'Account.shorten-mcp-pass', pass.pubkey, { passId: id, expiresAt: target.toISOString(), reason })
      await notify(pass.pubkey, 'ai', 'MCP access changed', 'Your MCP access end time was updated by Colabonate.', '/ai/connect')

      return res.json({ ok: true, expiresAt: target, message: 'MCP pass shortened' })
    } catch (err) {
      console.error('[Admin/monetization] mcp pass shorten failed:', err)
      return void res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ── DELETE /api/admin/mcp-trials/:pubkey (D4) ────────────────────────────
  router.delete('/mcp-trials/:pubkey', async (req: Request, res: Response) => {
    const pubkey = String(req.params.pubkey)
    const adminPubkey = adminPubkeyOf(req)
    try {
      const result = await prisma.mcpTrial.deleteMany({ where: { pubkey } })
      await audit(adminPubkey, 'Account.reset-mcp-trial', pubkey, { deleted: result.count })
      if (result.count > 0) {
        await notify(pubkey, 'ai', 'MCP trial reset', 'Your free MCP trial is available again.', '/ai/connect')
      }
      return res.json({ ok: true, reset: result.count > 0, message: result.count > 0 ? 'MCP trial reset' : 'No trial was used' })
    } catch (err) {
      console.error('[Admin/monetization] mcp trial reset failed:', err)
      return void res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ── PUT /api/admin/ai-policy/:pubkey (D7) ────────────────────────────────
  // Restrict-only: the values here can only close a gate, never open one.
  router.put('/ai-policy/:pubkey', async (req: Request, res: Response) => {
    const pubkey = String(req.params.pubkey)
    const adminPubkey = adminPubkeyOf(req)
    const body = (req.body ?? {}) as Record<string, unknown>

    const hostedAccess = body.hostedAccess === undefined ? undefined : cleanString(body.hostedAccess, 20)
    const mcpAccess = body.mcpAccess === undefined ? undefined : cleanString(body.mcpAccess, 20)
    const note = body.note === undefined ? undefined : cleanString(body.note, 500)
    const mcpMaxPassHours = body.mcpMaxPassHours === undefined
      ? undefined
      : (body.mcpMaxPassHours === null ? null : intInRange(body.mcpMaxPassHours, 1, 24 * 366))

    const ACCESS = ['DEFAULT', 'SUSPENDED']
    if (hostedAccess !== undefined && !ACCESS.includes(hostedAccess)) {
      return void res.status(400).json({ error: 'INVALID_PAYLOAD', detail: 'hostedAccess must be DEFAULT or SUSPENDED' })
    }
    if (mcpAccess !== undefined && !ACCESS.includes(mcpAccess)) {
      return void res.status(400).json({ error: 'INVALID_PAYLOAD', detail: 'mcpAccess must be DEFAULT or SUSPENDED' })
    }
    if (body.mcpMaxPassHours !== undefined && body.mcpMaxPassHours !== null && mcpMaxPassHours === null) {
      return void res.status(400).json({ error: 'INVALID_PAYLOAD', detail: 'mcpMaxPassHours must be 1..8784 or null' })
    }

    try {
      const user = await prisma.user.findUnique({ where: { pubkey }, select: { pubkey: true } })
      if (!user) return void res.status(404).json({ error: 'NOT_FOUND', message: 'No account with that pubkey' })

      const before = await prisma.userAiPolicy.findUnique({ where: { pubkey } })
      const policy = await prisma.userAiPolicy.upsert({
        where: { pubkey },
        create: {
          pubkey,
          hostedAccess: hostedAccess ?? 'DEFAULT',
          mcpAccess: mcpAccess ?? 'DEFAULT',
          mcpMaxPassHours: mcpMaxPassHours ?? null,
          note: note ?? null,
          updatedBy: adminPubkey,
        },
        update: {
          ...(hostedAccess !== undefined ? { hostedAccess } : {}),
          ...(mcpAccess !== undefined ? { mcpAccess } : {}),
          ...(body.mcpMaxPassHours !== undefined ? { mcpMaxPassHours } : {}),
          ...(note !== undefined ? { note } : {}),
          updatedBy: adminPubkey,
        },
      })

      await audit(adminPubkey, 'Account.set-ai-policy', pubkey, {
        policy: { hostedAccess: policy.hostedAccess, mcpAccess: policy.mcpAccess, mcpMaxPassHours: policy.mcpMaxPassHours },
        before: before ? { hostedAccess: before.hostedAccess, mcpAccess: before.mcpAccess } : null,
      })

      if (policy.hostedAccess === 'SUSPENDED' && before?.hostedAccess !== 'SUSPENDED') {
        await notify(pubkey, 'ai', 'Hosted AI suspended', 'Colabonate-hosted AI is suspended for your account. Your remaining requests are kept.', '/ai')
      }
      if (policy.mcpAccess === 'SUSPENDED' && before?.mcpAccess !== 'SUSPENDED') {
        await notify(pubkey, 'ai', 'MCP access suspended', 'External-agent (MCP) access is suspended for your account.', '/ai/connect')
      }

      return res.json({
        ok: true,
        policy: {
          hostedAccess: policy.hostedAccess,
          mcpAccess: policy.mcpAccess,
          mcpMaxPassHours: policy.mcpMaxPassHours,
          note: policy.note,
          updatedAt: policy.updatedAt,
        },
      })
    } catch (err) {
      console.error('[Admin/monetization] ai policy upsert failed:', err)
      return void res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ── GET /api/admin/foundation-settings (ADR-405 D4) ──────────────────────
  // Platform-wide sales & visibility switches for the AI Assistant and MCP.
  // Read-only here; the environment gates stay authoritative (ADR-402 D7/D9).
  router.get('/foundation-settings', async (_req: Request, res: Response) => {
    try {
      res.json({ settings: await getFoundationSettingsRecord(prisma) })
    } catch (err) {
      console.error('[Admin/monetization] foundation-settings read failed:', err)
      res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ── PATCH /api/admin/foundation-settings (ADR-405 D4, ADR-423) ───────────
  // Whitelisted patch: booleans (remoteCandidatesAutoApprove / aiSalesPaused /
  // mcpSalesPaused / aiAssistantSectionHidden / mcpSectionHidden) plus the
  // nullable int remoteCandidatesAutoApproveDays (1–29 or null). Every change
  // is audited with before/after. The AI/MCP flags can only close or hide,
  // never open.
  router.patch('/foundation-settings', async (req: Request, res: Response) => {
    const adminPubkey = adminPubkeyOf(req)
    const parsed = parseSettingsPatch(req.body)
    if (!parsed.ok || !parsed.patch) {
      return void res.status(400).json({ error: 'INVALID_PAYLOAD', detail: parsed.error })
    }
    try {
      const before = await getFoundationSettings(prisma)
      const settings = await updateFoundationSettings(prisma, parsed.patch, adminPubkey)
      const keys = Object.keys(parsed.patch) as (keyof typeof before)[]
      await audit(adminPubkey, 'FoundationSettings.update', 'foundation-settings', {
        changed: parsed.patch,
        before: Object.fromEntries(keys.map((k) => [k, before[k]])),
        after: Object.fromEntries(keys.map((k) => [k, settings[k]])),
      })
      res.json({ settings })
    } catch (err) {
      console.error('[Admin/monetization] foundation-settings update failed:', err)
      res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  return router
}
