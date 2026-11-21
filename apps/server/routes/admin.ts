import { Router, type Response } from 'express'
import { resolveLaunchMaxTxSats } from '../lib/launch-tx-cap.js'
import { isEscrowEnabled } from '../lib/escrow-gate.js'
import { isCoopEscrowEnabled } from '../lib/coop-escrow-gate.js'
import { dispatchCriticalAlert } from '../lib/critical-alert.js'
import { getLaunchReadinessMetrics } from '../lib/launch-readiness-metrics.js'
import { LAUNCH_GATES } from '../lib/launch-gates.js'
import { revokeMcpConnection } from '../lib/mcp-connections.js'
import { readFileSync } from 'fs'
import type { AppRequest } from '../types/express.js'
import { Prisma, type PrismaClient } from '@prisma/client'
import { Resend } from 'resend'
import { isBetaMode } from '../services/betaMode.js'
import { getRedis } from '../lib/redis.js'
import type { AuthenticatedRequest } from '../middleware/require-auth.js'
import {
  listEntityActions,
  getEntityAction,
  type EntityActionContext,
  type EntityActionResult,
  type EntityActionMeta,
} from './admin-entity-actions.js'
import { buildNewsletterAudience, type NewsletterAudienceRow } from '../services/newsletter.js'

// ADR-193: LND admin macaroon, resolved the same way as LndHoldClient.fromEnv()
// — LND_MACAROON_HEX first, falling back to hex-encoding the binary macaroon
// file at LND_MACAROON_PATH (the Docker beta stack mounts the raw file rather
// than a static hex env var, so it never goes stale after a regtest reset).
function resolveLndMacaroon(): string | undefined {
  const hex = process.env.LND_MACAROON_HEX
  if (hex) return hex
  const path = process.env.LND_MACAROON_PATH
  if (!path) return undefined
  try {
    return readFileSync(path).toString('hex')
  } catch {
    return undefined
  }
}

export function createAdminRouter(prisma: PrismaClient) {
  const router = Router()

  // GET /api/admin/beta/testers — all users with a DEMO wallet
  router.get('/beta/testers', async (_req: AppRequest, res: Response) => {
    try {
      const wallets = await prisma.wallet.findMany({
        where: { provider: 'DEMO' },
        include: {
          user: {
            select: { pubkey: true, createdAt: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
      })

      const testers = wallets.map(w => ({
        pubkey: w.user.pubkey,
        balanceSats: w.balanceSats,
        walletUpdatedAt: w.updatedAt,
        userCreatedAt: w.user.createdAt,
      }))

      return res.json({ testers })
    } catch (error) {
      console.error('[Admin/testers] Failed:', error)
      return res.status(500).json({ error: 'Failed to fetch testers' })
    }
  })

  // GET /api/admin/platform-fees — ADR-372 FU-686: hosted-canvas fee rows for
  // manual wallet reconciliation (no accounting integration in V1). Lists paid
  // (default) or all fee rows with the ticket/offer context + a paid-total
  // stat the operator can reconcile against the Colabonate LN wallet.
  // Query params: status (PAID|PENDING), page, limit.
  router.get('/platform-fees', async (req: AppRequest, res: Response) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10))
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10)))
      const skip = (page - 1) * limit
      const status = req.query.status === 'PENDING' ? 'PENDING' : 'PAID'
      const where: Prisma.TicketPlatformFeeWhereInput = { status }

      const [rows, total, paidCount, paidAgg] = await Promise.all([
        prisma.ticketPlatformFee.findMany({
          where,
          include: {
            ticket: {
              select: {
                offerId: true,
                buyerPubkey: true,
                sellerPubkey: true,
                offer: { select: { title: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.ticketPlatformFee.count({ where }),
        prisma.ticketPlatformFee.count({ where: { status: 'PAID' } }),
        prisma.ticketPlatformFee.aggregate({ where: { status: 'PAID' }, _sum: { amountSats: true } }),
      ])

      const fees = rows.map((f) => ({
        id: f.id,
        ticketId: f.ticketId,
        offerId: f.ticket.offerId,
        offerTitle: f.ticket.offer?.title ?? null,
        buyerPubkey: f.ticket.buyerPubkey,
        sellerPubkey: f.ticket.sellerPubkey,
        amountSats: f.amountSats,
        feeBps: f.feeBps,
        rail: f.rail,
        status: f.status,
        memo: f.memo,
        confirmedAt: f.confirmedAt,
        createdAt: f.createdAt,
      }))

      return res.json({
        fees,
        total,
        page,
        limit,
        stats: { paidCount, paidSats: paidAgg._sum.amountSats ?? 0 },
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error('[Admin/platform-fees] Failed:', msg)
      return res.status(500).json({ error: 'Failed to fetch platform fees', detail: msg })
    }
  })

  // GET /api/admin/feedback — paginated BetaFeedback rows with filters + stats
  // Query params: unread, kind, status, withEmail, page, limit
  router.get('/feedback', async (req: AppRequest, res: Response) => {
    try {
      const unreadOnly = req.query.unread === 'true'
      const withEmail  = req.query.withEmail === 'true'
      const kind   = typeof req.query.kind   === 'string' && req.query.kind   !== 'all' ? req.query.kind   : undefined
      const status = typeof req.query.status === 'string' && req.query.status !== 'all' ? req.query.status : undefined
      const page  = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10))
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)))
      const skip  = (page - 1) * limit

      const where: Prisma.BetaFeedbackWhereInput = {
        ...(unreadOnly && { read: false }),
        ...(withEmail  && { userEmail: { not: null } }),
        ...(kind       && { kind }),
        ...(status     && { status }),
      }

      const [
        rows, total,
        bugCount, ideaCount, questionCount,
        newCount, triagedCount, inProgressCount, shippedCount, wontfixCount,
        unreadCount, withEmailCount,
      ] = await Promise.all([
        prisma.betaFeedback.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
        prisma.betaFeedback.count({ where }),
        prisma.betaFeedback.count({ where: { kind: 'bug' } }),
        prisma.betaFeedback.count({ where: { kind: 'idea' } }),
        prisma.betaFeedback.count({ where: { kind: 'question' } }),
        prisma.betaFeedback.count({ where: { status: 'new' } }),
        prisma.betaFeedback.count({ where: { status: 'triaged' } }),
        prisma.betaFeedback.count({ where: { status: 'in_progress' } }),
        prisma.betaFeedback.count({ where: { status: 'shipped' } }),
        prisma.betaFeedback.count({ where: { status: 'wontfix' } }),
        prisma.betaFeedback.count({ where: { read: false } }),
        prisma.betaFeedback.count({ where: { userEmail: { not: null } } }),
      ])

      return res.json({
        feedback: rows,
        total,
        page,
        limit,
        stats: {
          byKind:   { bug: bugCount, idea: ideaCount, question: questionCount },
          byStatus: { new: newCount, triaged: triagedCount, in_progress: inProgressCount, shipped: shippedCount, wontfix: wontfixCount },
          unread:    unreadCount,
          withEmail: withEmailCount,
        },
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error('[Admin/feedback] Failed:', msg)
      return res.status(500).json({ error: 'Failed to fetch feedback', detail: msg })
    }
  })

  // PATCH /api/admin/feedback/:id/read — mark feedback as read
  router.patch('/feedback/:id/read', async (req: AppRequest, res: Response) => {
    try {
      const { id } = req.params
      const updated = await prisma.betaFeedback.update({
        where: { id },
        data: { read: true },
      })
      return res.json({ success: true, id: updated.id })
    } catch (error) {
      console.error('[Admin/feedback/read] Failed:', error)
      return res.status(500).json({ error: 'Failed to mark feedback as read' })
    }
  })

  // POST /api/admin/feedback/:id/reply — send email reply via Resend
  router.post('/feedback/:id/reply', async (req: AppRequest, res: Response) => {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      return res.status(503).json({ error: 'RESEND_API_KEY not configured on server' })
    }

    const { id } = req.params
    const { subject, message } = req.body as { subject?: string; message?: string }

    if (!subject?.trim() || !message?.trim()) {
      return res.status(400).json({ error: 'subject and message are required' })
    }

    try {
      const feedback = await prisma.betaFeedback.findUnique({ where: { id } })
      if (!feedback) return res.status(404).json({ error: 'Feedback not found' })
      if (!feedback.userEmail) return res.status(400).json({ error: 'No email address on this feedback entry' })

      const from = process.env.RESEND_FROM_EMAIL ?? 'Colabonate Team <noreply@agantila.com>'
      const resend = new Resend(apiKey)

      const html = `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111">
          <p>${message.trim().replace(/\n/g, '<br>')}</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
          <p style="color:#6b7280;font-size:13px;margin:0 0 4px">
            <strong>Your original feedback:</strong>
          </p>
          <p style="color:#6b7280;font-size:13px;font-style:italic;margin:0 0 4px">
            ${feedback.title}
          </p>
          <p style="color:#6b7280;font-size:12px;white-space:pre-wrap;margin:0">
            ${feedback.body}
          </p>
        </div>`

      const { error: sendError } = await resend.emails.send({
        from,
        to: [feedback.userEmail],
        subject: subject.trim(),
        html,
        text: `${message.trim()}\n\n---\nYour original feedback:\n"${feedback.title}"\n${feedback.body}`,
      })

      if (sendError) {
        console.error('[Admin/feedback/reply] Resend error:', sendError)
        return res.status(502).json({ error: sendError.message })
      }

      await prisma.betaFeedback.update({
        where: { id },
        data: {
          read: true,
          status: feedback.status === 'new' ? 'triaged' : feedback.status,
        },
      })

      return res.json({ success: true })
    } catch (error) {
      console.error('[Admin/feedback/reply] Failed:', error)
      return res.status(500).json({ error: 'Failed to send reply' })
    }
  })

  // GET /api/admin/accounts — full account list with login-method breakdown
  router.get('/accounts', async (req: AppRequest, res: Response) => {
    const page  = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10))
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '25'), 10)))
    const skip  = (page - 1) * limit
    const loginType      = req.query.loginType      as string | undefined
    const walletProvider = req.query.walletProvider as string | undefined
    const identityLevel  = req.query.identityLevel !== undefined
      ? parseInt(String(req.query.identityLevel), 10) : undefined
    const search = req.query.search as string | undefined
    // ADR-284 D7: 'remote' | 'native' — see originType() below for the definition.
    const origin = req.query.origin as string | undefined

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = {}
      if (search)                       where.pubkey = { contains: search, mode: 'insensitive' }
      if (identityLevel !== undefined)  where.identityLevel = identityLevel
      if (loginType === 'nostr')        where.nostrPubkey = { not: null }
      if (loginType === 'lightning')    where.OR = [{ lnAddress: { not: null } }, { linkedPubkey: { not: null } }]
      if (loginType === 'email')        where.email = { not: null }
      if (loginType === 'google')       where.googleId = { not: null }
      if (loginType === 'evm')          where.evmAddress = { not: null }
      // ADR-228: a user can hold several Wallet rows (one per provider) now —
      // "the wallet" for admin display purposes is the active one.
      if (loginType === 'demo')         where.wallets = { some: { provider: 'DEMO' } }
      if (walletProvider === 'none')    where.wallets = { none: {} }
      else if (walletProvider)          where.wallets = { some: { provider: walletProvider } }
      if (origin === 'remote') {
        where.nostrPubkey = null
        where.lnAddress = null
        where.linkedPubkey = null
        where.email = null
        where.googleId = null
        where.evmAddress = null
        where.sessions = { none: {} }
      } else if (origin === 'native') {
        where.OR = [
          { nostrPubkey: { not: null } }, { lnAddress: { not: null } }, { linkedPubkey: { not: null } },
          { email: { not: null } }, { googleId: { not: null } }, { evmAddress: { not: null } },
          { sessions: { some: {} } },
        ]
      }

      const userSelect = {
        pubkey: true, createdAt: true, identityLevel: true,
        nostrPubkey: true, lnAddress: true, linkedPubkey: true,
        email: true, emailVerified: true, googleId: true, evmAddress: true,
        nip05: true, picture: true,
        blockedAt: true, blockedReason: true,
        wallets: { where: { isActive: true }, take: 1, select: { provider: true, mode: true, balanceSats: true } },
        sessions: { select: { createdAt: true }, orderBy: { createdAt: 'desc' as const }, take: 1 },
        _count: { select: { ticketsAsBuyer: true, ticketsAsSeller: true, offers: true, sessions: true } },
      }

      // ADR-284 D7: "Remote" = auto-provisioned by remote-candidate.ts
      // promotion (only `pubkey` set, no login identifier) and never logged
      // in themselves. Derived, not stored — self-corrects if they later claim
      // the account for real.
      function originType(u: {
        nostrPubkey: string | null; lnAddress: string | null; linkedPubkey: string | null
        email: string | null; googleId: string | null; evmAddress: string | null
        _count: { sessions: number }
      }): 'remote' | 'native' {
        const hasIdentifier = !!(u.nostrPubkey || u.lnAddress || u.linkedPubkey || u.email || u.googleId || u.evmAddress)
        return (!hasIdentifier && u._count.sessions === 0) ? 'remote' : 'native'
      }

      const [users, total, allRaw] = await Promise.all([
        prisma.user.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' }, select: userSelect }),
        prisma.user.count({ where }),
        prisma.user.findMany({
          select: {
            nostrPubkey: true, lnAddress: true, linkedPubkey: true,
            email: true, googleId: true, evmAddress: true,
            wallets: { where: { isActive: true }, take: 1, select: { provider: true } },
          },
        }),
      ])

      function loginMethods(u: typeof allRaw[number]) {
        const m: string[] = []
        if (u.nostrPubkey)               m.push('nostr')
        if (u.lnAddress || u.linkedPubkey) m.push('lightning')
        if (u.email)                     m.push('email')
        if (u.googleId)                  m.push('google')
        if (u.evmAddress)                m.push('evm')
        if (u.wallets[0]?.provider === 'DEMO') m.push('demo')
        return m
      }

      const methods: Record<string, number> = { nostr: 0, lightning: 0, email: 0, google: 0, evm: 0, demo: 0 }
      const wallets: Record<string, number> = {}
      const combos:  Record<string, number> = {}

      for (const u of allRaw) {
        const m = loginMethods(u)
        m.forEach(k => { methods[k] = (methods[k] ?? 0) + 1 })
        const comboKey = m.sort().join('+') || 'none'
        combos[comboKey] = (combos[comboKey] ?? 0) + 1
        const wp = u.wallets[0]?.provider ?? 'none'
        wallets[wp] = (wallets[wp] ?? 0) + 1
      }

      const accounts = users.map(u => ({
        pubkey: u.pubkey,
        createdAt: u.createdAt,
        identityLevel: u.identityLevel,
        loginMethods: loginMethods(u as typeof allRaw[number]),
        origin: originType(u),
        blockedAt: u.blockedAt,
        blockedReason: u.blockedReason,
        email: u.email ? u.email.replace(/(.{2}).*(@.*)/, '$1***$2') : null,
        emailVerified: u.emailVerified,
        lnAddress: u.lnAddress,
        nip05: u.nip05,
        picture: u.picture,
        nostrPubkey: u.nostrPubkey,
        linkedPubkey: u.linkedPubkey,
        evmAddress: u.evmAddress
          ? u.evmAddress.slice(0, 6) + '…' + u.evmAddress.slice(-4)
          : null,
        hasGoogleId: !!u.googleId,
        wallet: u.wallets[0] ?? null,
        offerCount: u._count.offers,
        buyerTicketCount: u._count.ticketsAsBuyer,
        sellerTicketCount: u._count.ticketsAsSeller,
        sessionCount: u._count.sessions,
        lastSeen: u.sessions[0]?.createdAt ?? null,
      }))

      return res.json({
        accounts, total, page, limit,
        breakdown: {
          methods,
          wallets,
          combinations: Object.entries(combos)
            .map(([key, count]) => ({ key, count }))
            .sort((a, b) => b.count - a.count),
        },
      })
    } catch (error) {
      console.error('[Admin/accounts] Failed:', error)
      return res.status(500).json({ error: 'Failed to fetch accounts' })
    }
  })

  // GET /api/admin/metrics — platform KPI snapshot
  router.get('/metrics', async (_req: AppRequest, res: Response) => {
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const now = new Date()

    try {
      const [
        totalUsers,
        newUsers7d,
        activeUserPubkeys,
        totalOffers,
        totalTickets,
        activeTickets,
        totalSessions,
        activeSessions,
        totalFeedback,
        unreadFeedback,
        demoWalletCount,
        demoWalletSats,
        totalAuditLogs,
        remoteUserCount,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { createdAt: { gte: since7d } } }),
        // ADR-282: distinct pubkeys with at least one non-expired session —
        // "active users" for the chip (distinct, sessions.active below counts
        // session rows, not users).
        prisma.session.findMany({
          where: { expiresAt: { gt: now } },
          distinct: ['pubkey'],
          select: { pubkey: true },
        }),
        prisma.offer.count(),
        prisma.ticket.count(),
        prisma.ticket.count({ where: { status: { in: ['PENDING', 'IN_PROGRESS', 'ESCROW_FUNDED'] } } }),
        prisma.session.count(),
        prisma.session.count({ where: { expiresAt: { gt: now } } }),
        prisma.betaFeedback.count(),
        prisma.betaFeedback.count({ where: { read: false } }),
        prisma.wallet.count({ where: { provider: 'DEMO' } }),
        prisma.wallet.aggregate({ where: { provider: 'DEMO' }, _sum: { balanceSats: true } }),
        prisma.adminAuditLog.count(),
        // ADR-284 D7: "Remote" users — auto-provisioned by remote-candidate.ts
        // promotion with only a pubkey set (no login identifier, never logged
        // in themselves). Derived, not stored — see admin.ts's originType()
        // below for the identical per-row logic used on /accounts.
        prisma.user.count({
          where: {
            nostrPubkey: null, lnAddress: null, linkedPubkey: null,
            email: null, googleId: null, evmAddress: null,
            sessions: { none: {} },
          },
        }),
      ])

      return res.json({
        users: { total: totalUsers, new7d: newUsers7d, active: activeUserPubkeys.length, remote: remoteUserCount },
        offers: { total: totalOffers },
        tickets: { total: totalTickets, active: activeTickets },
        sessions: { total: totalSessions, active: activeSessions },
        feedback: { total: totalFeedback, unread: unreadFeedback },
        demoWallets: { count: demoWalletCount, totalSats: demoWalletSats._sum.balanceSats ?? 0 },
        auditLogs: { total: totalAuditLogs },
      })
    } catch (error) {
      console.error('[Admin/metrics] Failed:', error)
      return res.status(500).json({ error: 'Failed to fetch metrics' })
    }
  })

  // ADR-282: GET /api/admin/active-users — distinct users with at least one
  // non-expired session, ordered by most-recent session login (lastSeen DESC).
  // Backed by `Session.expiresAt > now()` — same proxy as `metrics.users.active`.
  // Returns the small joined profile fields `AccountsSection` needs for the
  // curated row + the detail-panel deeplink.
  router.get('/active-users', async (req: AppRequest, res: Response) => {
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '25'), 10)))
    const now = new Date()

    try {
      const sessions = await prisma.session.findMany({
        where: { expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
        select: { pubkey: true, createdAt: true },
      })

      const byPubkey = new Map<string, { sessionCount: number; lastSeen: Date }>()
      for (const s of sessions) {
        const cur = byPubkey.get(s.pubkey)
        if (cur) {
          cur.sessionCount += 1
          if (s.createdAt > cur.lastSeen) cur.lastSeen = s.createdAt
        } else {
          byPubkey.set(s.pubkey, { sessionCount: 1, lastSeen: s.createdAt })
        }
      }

      const entries = Array.from(byPubkey.entries())
        .map(([pubkey, v]) => ({ pubkey, sessionCount: v.sessionCount, lastSeen: v.lastSeen }))
        .sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime())

      const top = entries.slice(0, limit)
      const pubkeys = top.map(e => e.pubkey)

      const users = await prisma.user.findMany({
        where: { pubkey: { in: pubkeys } },
        select: { pubkey: true, identityLevel: true, picture: true, nip05: true, lnAddress: true },
      })
      const profileByPubkey = new Map(users.map(u => [u.pubkey, u]))

      const items = top.map(e => {
        const u = profileByPubkey.get(e.pubkey)
        return {
          pubkey:        e.pubkey,
          identityLevel: u?.identityLevel ?? 0,
          picture:       u?.picture ?? null,
          nip05:         u?.nip05 ?? null,
          lnAddress:     u?.lnAddress ?? null,
          sessionCount:  e.sessionCount,
          lastSeen:      e.lastSeen.toISOString(),
        }
      })

      return res.json({
        count: entries.length,
        users: items,
      })
    } catch (error) {
      console.error('[Admin/active-users] Failed:', error)
      return res.status(500).json({ error: 'Failed to fetch active users' })
    }
  })

  // GET /api/admin/health — aggregated service health status
  router.get('/health', async (_req: AppRequest, res: Response) => {
    const started = Date.now()

    const [dbResult, redisResult, lndResult] = await Promise.allSettled([
      prisma.$queryRaw`SELECT 1`.then(() => 'ok' as const),
      (async () => {
        const redis = getRedis()
        if (!redis) return 'unavailable' as const
        const pong = await redis.ping()
        return pong === 'PONG' ? ('ok' as const) : ('error' as const)
      })(),
      (async () => {
        const lndUrl = process.env.LND_REST_URL
        const macaroon = resolveLndMacaroon()
        if (!lndUrl || !macaroon) return null
        try {
          const r = await fetch(`${lndUrl}/v1/getinfo`, {
            headers: { 'Grpc-Metadata-macaroon': macaroon },
            signal: AbortSignal.timeout(3000),
          })
          if (!r.ok) return { ok: false, alias: null, synced: false }
          const data = await r.json() as { alias?: string; synced_to_chain?: boolean }
          return { ok: true, alias: data.alias ?? null, synced: data.synced_to_chain ?? false }
        } catch {
          return { ok: false, alias: null, synced: false }
        }
      })(),
    ])

    return res.json({
      db: dbResult.status === 'fulfilled' ? dbResult.value : 'error',
      redis: redisResult.status === 'fulfilled' ? redisResult.value : 'error',
      lnd: lndResult.status === 'fulfilled' ? lndResult.value : null,
      // Found live 2026-09-16: a production host running Stage 1 Direct-Pay
      // only (ADR-253, no ESCROW_ENABLED/COOP_ESCROW_ENABLED) deliberately
      // has no reachable LND node — LNBITS_ADMIN_KEY/LND_REST_URL/etc. are
      // set to fake/unreachable values on purpose (see
      // docker-compose.production.yml header). Without this flag the admin
      // panel showed a red "LND Node: Error" that looked like a real
      // incident. `lndRequired` lets the client render that as a neutral
      // "not needed" state instead of an alarm.
      lndRequired: isEscrowEnabled() || isCoopEscrowEnabled(),
      betaMode: isBetaMode(),
      paymentsPaused: process.env.PAYMENTS_PAUSED === 'true' || process.env.PAYMENTS_PAUSED === '1',
      // FU-655: null = cap disabled (LAUNCH_MAX_TX_SATS=0), otherwise sats.
      launchMaxTxSats: resolveLaunchMaxTxSats(),
      // Launch Sub-Plan 01 §1.3: both custodial-legacy escrow flags must read
      // false on a production host (ADR-253 — no custodial launch, ever).
      escrowEnabled: isEscrowEnabled(),
      coopEscrowEnabled: isCoopEscrowEnabled(),
      criticalAlertingConfigured: Boolean(process.env.RESEND_API_KEY && process.env.CRITICAL_ALERT_EMAIL),
      uptimeSeconds: Math.floor(process.uptime()),
      checkedInMs: Date.now() - started,
    })
  })

  // POST /api/admin/alerts/test — Gate G4 of the launch plan (ADR-252 D7 /
  // FU-252-A): fire one synthetic CRITICAL alert through the real on-call
  // channel so an operator can prove delivery on a fresh production host
  // without waiting for a real money-safety incident. Admin-gated by the
  // router mount (requireAdminPubkey). Writes the same console.error line a
  // real CRITICAL would, so the Loki side of the contract is exercised too.
  router.post('/alerts/test', async (req: AppRequest, res: Response) => {
    const caller = (req as AuthenticatedRequest).authPubkey ?? 'unknown'
    const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 200) : ''
    const message = `Synthetic test alert requested by admin ${caller.slice(0, 12)}… at ${new Date().toISOString()}${note ? ` — ${note}` : ''}. No action required.`
    console.error(`[admin-test-alert] CRITICAL: ${message}`)
    const result = await dispatchCriticalAlert('admin-test-alert', message)
    if (!result.configured) {
      return res.status(503).json({ error: 'ALERTING_NOT_CONFIGURED', message: 'RESEND_API_KEY and CRITICAL_ALERT_EMAIL must both be set on this host.', ...result })
    }
    if (!result.sent) {
      return res.status(502).json({ error: 'ALERT_DELIVERY_FAILED', message: 'The alert provider rejected the test alert — see server log.', ...result })
    }
    return res.json({ ok: true, ...result, sentAt: new Date().toISOString() })
  })

  // GET /api/admin/infrastructure — payment/search provider status + docker service health
  router.get('/infrastructure', async (_req: AppRequest, res: Response) => {
    const started = Date.now()

    const paymentProvider = process.env.PAYMENT_PROVIDER ?? ''
    const lnbitsUrl       = process.env.LNBITS_URL
    const lndUrl          = process.env.LND_REST_URL
    const lndMacaroon     = resolveLndMacaroon()
    const meiliUrl        = process.env.MEILISEARCH_URL
    const searchBackend   = process.env.SEARCH_BACKEND ?? 'database'
    const cacheEnabled    = process.env.CACHE_ENABLED === 'true'

    type ServiceStatus = 'ok' | 'warn' | 'error' | 'unavailable'

    const [dbResult, redisResult, lnbitsResult, meiliResult, lndResult] = await Promise.allSettled([
      prisma.$queryRaw`SELECT 1`.then(() => 'ok' as const),
      (async () => {
        const redis = getRedis()
        if (!redis) return 'unavailable' as const
        const pong = await redis.ping()
        return pong === 'PONG' ? ('ok' as const) : ('error' as const)
      })(),
      lnbitsUrl
        ? fetch(`${lnbitsUrl}/api/v1/health`, { signal: AbortSignal.timeout(3000) })
            .then(r => r.ok ? ('ok' as const) : ('error' as const))
            .catch(() => 'error' as const)
        : Promise.resolve('unavailable' as const),
      meiliUrl
        ? fetch(`${meiliUrl}/health`, { signal: AbortSignal.timeout(3000) })
            .then(r => r.ok ? ('ok' as const) : ('error' as const))
            .catch(() => 'error' as const)
        : Promise.resolve('unavailable' as const),
      (async () => {
        if (!lndUrl || !lndMacaroon) return null
        try {
          const r = await fetch(`${lndUrl}/v1/getinfo`, {
            headers: { 'Grpc-Metadata-macaroon': lndMacaroon },
            signal: AbortSignal.timeout(3000),
          })
          if (!r.ok) return { ok: false, alias: null as string | null, synced: false }
          const data = await r.json() as { alias?: string; synced_to_chain?: boolean }
          return { ok: true, alias: data.alias ?? null, synced: data.synced_to_chain ?? false }
        } catch {
          return { ok: false, alias: null as string | null, synced: false }
        }
      })(),
    ])

    const db     = (dbResult.status     === 'fulfilled' ? dbResult.value     : 'error') as ServiceStatus
    const redis  = (redisResult.status  === 'fulfilled' ? redisResult.value  : 'error') as ServiceStatus
    const lnbits = (lnbitsResult.status === 'fulfilled' ? lnbitsResult.value : 'error') as ServiceStatus
    const meili  = (meiliResult.status  === 'fulfilled' ? meiliResult.value  : 'error') as ServiceStatus
    const lnd    = lndResult.status === 'fulfilled' ? lndResult.value : null

    // Found live 2026-09-16: a Stage 1 Direct-Pay-only host (ADR-253, no
    // ESCROW_ENABLED/COOP_ESCROW_ENABLED) intentionally has no reachable
    // LND/LNBits node — the LNBITS_ADMIN_KEY/LND_REST_URL/etc. env vars are
    // set to fake/unreachable values on purpose (createProvider() boot
    // guard, see docker-compose.production.yml header). Without this check
    // the admin panel showed "LND Node: Error / unreachable" and
    // "Providers: None / not configured", which reads like a real incident
    // on a host that's actually working exactly as designed.
    const stage1DirectPayOnly = !isEscrowEnabled() && !isCoopEscrowEnabled()

    function paymentStatus(): ServiceStatus {
      if (!paymentProvider) return 'unavailable'
      if (paymentProvider === 'lnbits') return lnbits
      if (paymentProvider === 'lnd') return lnd?.ok ? 'ok' : (lnd ? 'error' : 'unavailable')
      return 'unavailable'
    }

    const lndServiceStatus: ServiceStatus = stage1DirectPayOnly ? 'unavailable' : lnd == null ? 'unavailable' : lnd.ok ? 'ok' : 'error'
    const bitcoindStatus: ServiceStatus   = stage1DirectPayOnly ? 'unavailable' : lnd == null ? 'unavailable' : lnd.ok && lnd.synced ? 'ok' : lnd.ok ? 'warn' : 'error'
    const lnbitsStatus: ServiceStatus     = stage1DirectPayOnly ? 'unavailable' : (lnbitsUrl ? lnbits : 'unavailable')

    return res.json({
      providers: [
        {
          id: 'payment',
          name: stage1DirectPayOnly ? 'Direct-Pay' : paymentProvider === 'lnbits' ? 'LNbits' : paymentProvider === 'lnd' ? 'LND Direct' : paymentProvider || 'None',
          status: stage1DirectPayOnly ? 'ok' : paymentStatus(),
          detail: stage1DirectPayOnly ? 'buyer pays seller directly (ADR-253)' : (paymentProvider || 'not configured'),
        },
        {
          id: 'search',
          name: searchBackend === 'meilisearch' ? 'Meilisearch' : searchBackend === 'database' ? 'PostgreSQL FTS' : searchBackend,
          status: (searchBackend === 'meilisearch' ? meili : searchBackend === 'database' ? db : 'unavailable') as ServiceStatus,
          detail: searchBackend,
        },
        {
          id: 'cache',
          name: 'Redis Cache',
          status: cacheEnabled ? redis : ('unavailable' as ServiceStatus),
          detail: cacheEnabled ? 'enabled' : 'disabled',
        },
        {
          id: 'demo-wallet',
          name: 'Demo Wallet',
          status: (isBetaMode() ? 'ok' : 'unavailable') as ServiceStatus,
          detail: isBetaMode() ? 'beta active' : 'off',
        },
      ],
      services: [
        { name: 'postgres',    status: db,              detail: 'PostgreSQL 16'                            },
        { name: 'redis',       status: redis,           detail: 'Redis 7'                                  },
        { name: 'meilisearch', status: meili,           detail: meiliUrl    ? 'v1.11'          : 'not set' },
        { name: 'lnd',         status: lndServiceStatus, detail: stage1DirectPayOnly ? 'not needed — Stage 1 Direct-Pay' : lnd == null ? (lndUrl ? 'not configured' : 'not set') : lnd.ok ? (lnd.alias ?? 'connected') : 'unreachable' },
        { name: 'lnbits',      status: lnbitsStatus,    detail: stage1DirectPayOnly ? 'not needed — Stage 1 Direct-Pay' : lnbitsUrl ? 'v1.5.4' : 'not set' },
        { name: 'bitcoind',    status: bitcoindStatus,  detail: stage1DirectPayOnly ? 'not needed — Stage 1 Direct-Pay' : lnd == null ? 'not set' : lnd.ok ? 'regtest' : 'unreachable' },
      ],
      checkedInMs: Date.now() - started,
    })
  })

  // ── Entity Explorer (generic DB browser) ────────────────────────────────────
  // Lists every public table with an approximate row count, plus paginated rows
  // and column metadata for a selected table. Table names are validated against
  // the live information_schema whitelist before any dynamic query runs.

  function sanitize(value: unknown): unknown {
    if (typeof value === 'bigint') return Number(value)
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return value.map(sanitize)
    if (value && typeof value === 'object') {
      for (const k of Object.keys(value as Record<string, unknown>)) {
        ;(value as Record<string, unknown>)[k] = sanitize((value as Record<string, unknown>)[k])
      }
    }
    return value
  }

  // GET /api/admin/entities — every public table with a real COUNT(*) per table.
  // n_live_tup from pg_stat_user_tables is 0 for freshly migrated tables until
  // VACUUM ANALYZE runs. Running COUNT(*) per table is accurate at all times;
  // for a small admin/beta DB the overhead is negligible.
  router.get('/entities', async (_req: AppRequest, res: Response) => {
    try {
      const tableNames = await prisma.$queryRaw<{ table: string }[]>`
        SELECT c.relname AS table
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY c.relname ASC
      `

      const entities = await Promise.all(
        tableNames.map(async t => {
          const tableId = `"${t.table.replace(/"/g, '""')}"`
          try {
            const result = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
              `SELECT count(*)::bigint AS count FROM ${tableId}`
            )
            return { table: t.table, count: Number(result[0]?.count ?? 0) }
          } catch {
            return { table: t.table, count: 0 }
          }
        })
      )

      return res.json({ entities })
    } catch (error) {
      console.error('[Admin/entities] Failed:', error)
      return res.status(500).json({ error: 'Failed to list entities' })
    }
  })

  // GET /api/admin/entities/:model — columns + paginated/filtered rows + facets + stats
  // Query params: page, limit, search, filterColumn, filterValue
  router.get('/entities/:model', async (req: AppRequest, res: Response) => {
    const model = String(req.params.model)
    const page  = Math.max(1, parseInt(String(req.query.page ?? '1'), 10))
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10)))
    const offset = (page - 1) * limit
    const search       = req.query.search       ? String(req.query.search)       : null
    // Legacy single-filter params — still honored for compat with old links/bookmarks.
    const filterColumn = req.query.filterColumn ? String(req.query.filterColumn) : null
    const filterValue  = req.query.filterValue  != null ? String(req.query.filterValue) : null
    // ADR-284 D1: multi-column filters, AND-combined. JSON-encoded column->value
    // map, e.g. ?filters={"status":"ACTIVE","offerType":"SERVICE"}.
    const columnFilters: Record<string, string> = {}
    if (req.query.filters) {
      try {
        const parsed: unknown = JSON.parse(String(req.query.filters))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof v === 'string') columnFilters[k] = v
          }
        }
      } catch {
        // Malformed filters param — ignore rather than 400 (fail-soft, matches
        // the rest of this handler's style).
      }
    }
    if (filterColumn && filterValue !== null) columnFilters[filterColumn] = filterValue

    try {
      // 1. Validate the requested table actually exists in the public schema.
      const known = await prisma.$queryRaw<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ${model}
        ) AS exists
      `
      if (!known[0]?.exists) {
        return res.status(404).json({ error: 'UNKNOWN_ENTITY', message: `Table "${model}" does not exist` })
      }

      // 2. Column metadata.
      const colRows = await prisma.$queryRaw<
        { column_name: string; data_type: string; is_nullable: string }[]
      >`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${model}
        ORDER BY ordinal_position ASC
      `
      const columnNames = colRows.map(c => c.column_name)
      const columns = colRows.map(c => ({
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === 'YES',
      }))

      // 3. Build a WHERE clause from search + filter. Identifiers are validated
      //    against the live column list; only parameterized values reach SQL.
      const textColumns = colRows
        .filter(c => /char|text/i.test(c.data_type))
        .map(c => c.column_name)

      const whereParts: string[] = []
      const whereParams: unknown[] = []
      let pIdx = 1

      if (search && textColumns.length) {
        const ph = `$${pIdx++}`
        whereParts.push('(' + textColumns.map(c => `"${c}"::text ILIKE ${ph}`).join(' OR ') + ')')
        whereParams.push(`%${search}%`)
      } else if (search) {
        // No text columns to search — force empty result.
        whereParts.push('FALSE')
      }

      for (const [col, val] of Object.entries(columnFilters)) {
        if (!columnNames.includes(col)) continue // unknown column — drop silently
        const ph = `$${pIdx++}`
        whereParts.push(`"${col}"::text = ${ph}`)
        whereParams.push(val)
      }

      const whereSql = whereParts.length ? 'WHERE ' + whereParts.join(' AND ') : ''
      const tableId  = `"${model.replace(/"/g, '""')}"`

      // 4. Counts: filtered total (for pagination) + unfiltered total (for info).
      const filteredCount = whereSql
        ? await prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*)::bigint AS count FROM ${tableId} ${whereSql}`, ...whereParams)
        : await prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*)::bigint AS count FROM ${tableId}`)
      const totalCount = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*)::bigint AS count FROM ${tableId}`)
      const total     = Number(filteredCount[0]?.count ?? 0)
      const totalAll  = Number(totalCount[0]?.count ?? 0)

      // 5. Rows (filtered + paginated).
      const rowsParams = [...whereParams, limit, offset]
      const rowsSql = `SELECT * FROM ${tableId} ${whereSql} ORDER BY 1 LIMIT $${whereParams.length + 1} OFFSET $${whereParams.length + 2}`
      const rows = await prisma.$queryRawUnsafe(rowsSql, ...rowsParams)

      // 6. Facets — value distribution for low-cardinality enum-like columns.
      const facetRegex = /^(status|type|provider|role|mode|state|category|kind|source|currency|network|severity|tier|level)$/i
      const facetCols = columnNames.filter(n => facetRegex.test(n)).slice(0, 6)
      const facets = await Promise.all(facetCols.map(async col => {
        try {
          const vals = await prisma.$queryRaw<{ val: string | null; count: bigint }[]>`
            SELECT "${Prisma.raw(col)}"::text AS val, count(*)::bigint AS count
            FROM ${Prisma.raw(tableId)}
            GROUP BY 1 ORDER BY count DESC LIMIT 15
          `
          return {
            column: col,
            values: vals.map(v => ({ value: v.val, count: Number(v.count) })),
          }
        } catch {
          return { column: col, values: [] as { value: string | null; count: number }[] }
        }
      }))

      // 7. Date stats — min/max for time columns (newest/oldest activity).
      const timeRegex = /timestamp|date/i
      const timeCols = colRows.filter(c => timeRegex.test(c.data_type)).slice(0, 4).map(c => c.column_name)
      const dateStats = await Promise.all(timeCols.map(async col => {
        try {
          const r = await prisma.$queryRaw<{ min: string | null; max: string | null }[]>`
            SELECT MIN("${Prisma.raw(col)}")::text AS min, MAX("${Prisma.raw(col)}")::text AS max
            FROM ${Prisma.raw(tableId)}
          `
          return { column: col, min: r[0]?.min ?? null, max: r[0]?.max ?? null }
        } catch {
          return { column: col, min: null, max: null }
        }
      }))

      return res.json({
        model,
        page,
        limit,
        total,        // filtered
        totalAll,     // unfiltered
        search,
        filterColumn: filterColumn && columnNames.includes(filterColumn) ? filterColumn : null,
        filterValue,
        filters: Object.fromEntries(Object.entries(columnFilters).filter(([col]) => columnNames.includes(col))),
        columns,
        rows: sanitize(rows) as Record<string, unknown>[],
        facets,
        dateStats,
      })
    } catch (error) {
      console.error('[Admin/entities/:model] Failed:', error)
      return res.status(500).json({ error: 'Failed to fetch entity rows' })
    }
  })

  // ── ADR-201: Entity action registry ──────────────────────────────────────

  // GET /api/admin/entities/:model/actions — metadata for the UI to render
  // the per-row + per-detail-panel action buttons.
  router.get('/entities/:model/actions', async (req: AppRequest, res: Response) => {
    const model = String(req.params.model)
    const actions: EntityActionMeta[] = listEntityActions(model)
    return res.json({ model, actions })
  })

  // POST /api/admin/entities/:model/:id/:action — execute a registered action.
  // Safety net (all must pass):
  //   1. Bearer-session auth + Foundation-DAO admin role check (mounted upstream, ADR-273)
  //   2. Whitelisted (model, action) pair exists in the registry
  //   3. Payload is validated against the registered schema
  //   4. AdminAuditLog entry written on success
  //   5. Response is sanitized (no raw JSON.stringify of `prisma` result rows)
  // ADR-273: the prior NODE_ENV/ADMIN_ACTIONS_IN_PROD kill-switch is removed —
  // the Foundation-DAO admin role check is the real gate, and a per-env opt-in
  // only got in the admin's way. The single-admin-by-env model it protected
  // against no longer exists.
  router.post('/entities/:model/:id/:action', async (req: AppRequest, res: Response) => {
    const model  = String(req.params.model)
    const id     = String(req.params.id)
    const action = String(req.params.action)
    const authReq = req as AuthenticatedRequest
    // ADR-273: requireAuth + requireFoundationAdminBySession upstream guarantee
    // a non-null authPubkey. Reject rather than silently using 'unknown' if a
    // future regression breaks the chain.
    const adminPubkey = authReq.authPubkey
    if (!adminPubkey) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing session' })
    }
    const ip = req.ip ?? 'unknown'

    // 1. Whitelist lookup.
    const entry = getEntityAction(model, action)
    if (!entry) {
      return res.status(404).json({
        error: 'UNKNOWN_ACTION',
        message: `Action "${action}" is not registered for model "${model}".`,
      })
    }

    // 2. Payload validation.
    const payload = (req.body ?? {}) as Record<string, unknown>
    for (const field of entry.meta.payloadSchema ?? []) {
      if (field.field in payload) {
        const raw = payload[field.field]
        if (field.type === 'enum') {
          if (typeof raw !== 'string' || !field.values.includes(raw)) {
            return res.status(400).json({
              error: 'INVALID_PAYLOAD',
              detail: `Field "${field.field}" must be one of: ${field.values.join(', ')}`,
            })
          }
        } else if (field.type === 'string') {
          if (typeof raw !== 'string') {
            return res.status(400).json({
              error: 'INVALID_PAYLOAD',
              detail: `Field "${field.field}" must be a string`,
            })
          }
        }
      }
    }

    // 3. Execute handler.
    const ctx: EntityActionContext = { model, id, adminPubkey, ip, payload, prisma }
    let result: EntityActionResult
    try {
      result = await entry.handler(ctx)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[Admin/entities] Handler failed: ${model}/${action}`, msg)
      return res.status(500).json({ error: 'HANDLER_ERROR', detail: msg })
    }

    if (!result.ok) {
      return res.status(400).json({ error: result.error, detail: result.detail })
    }

    // 4. Audit log — best-effort. Audit failures must NOT undo the action,
    //    but we surface them in the response so the UI can warn.
    let auditWarning: string | null = null
    try {
      await prisma.adminAuditLog.create({
        data: {
          adminPubkey,
          action: `${model}.${action}`,
          targetId: id,
          payload: JSON.stringify({ ip, payload, result: result.row ?? null }),
        },
      })
    } catch (err) {
      auditWarning = err instanceof Error ? err.message : String(err)
      console.error('[Admin/entities] AuditLog write failed:', auditWarning)
    }

    return res.json({ ...result, auditWarning })
  })

  // POST /api/admin/entities/:model/bulk-action — execute a registered action
  // over multiple row ids in one round-trip. Closes FU-201-B ("bulk actions")
  // for the delete case; other bulk ops (set-status, cancel) reuse the same
  // endpoint when the admin asks for them.
  //
  // Semantics:
  //   - Each id runs through the *same* registry handler + payload validation as
  //     the single-row endpoint — no shortcut, no bypass.
  //   - Per-row audit row, identical shape to the single-row endpoint.
  //   - Partial success: a failing id does NOT abort the batch. Response carries
  //     `{ okCount, failCount, results: [{ id, ok, error?, detail?, message? }] }`.
  //     Client shows the green total + a short error list.
  //   - Cap: 500 ids per request (defends against "select all on a 100k-row
  //     table" abuse; the UI's checkbox column is page-scoped so this is well
  //     above any realistic single-batch UI selection).
  router.post('/entities/:model/bulk-action', async (req: AppRequest, res: Response) => {
    const model = String(req.params.model)
    const authReq = req as AuthenticatedRequest
    const adminPubkey = authReq.authPubkey
    if (!adminPubkey) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing session' })
    }
    const ip = req.ip ?? 'unknown'

    const body = (req.body ?? {}) as { action?: unknown; ids?: unknown; payload?: unknown }
    const action = typeof body.action === 'string' ? body.action : ''
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : []
    const payload = (body.payload && typeof body.payload === 'object' ? body.payload : {}) as Record<string, unknown>

    if (!action || ids.length === 0) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', detail: 'action and non-empty ids[] are required' })
    }
    if (ids.length > 500) {
      return res.status(400).json({ error: 'BATCH_TOO_LARGE', detail: `Max 500 ids per request (got ${ids.length})` })
    }
    const entry = getEntityAction(model, action)
    if (!entry) {
      return res.status(404).json({ error: 'UNKNOWN_ACTION', detail: `Action "${action}" is not registered for model "${model}".` })
    }

    // Apply the same per-field validation as the single-row endpoint.
    for (const field of entry.meta.payloadSchema ?? []) {
      if (field.field in payload) {
        const raw = payload[field.field]
        if (field.type === 'enum') {
          if (typeof raw !== 'string' || !field.values.includes(raw)) {
            return res.status(400).json({
              error: 'INVALID_PAYLOAD',
              detail: `Field "${field.field}" must be one of: ${field.values.join(', ')}`,
            })
          }
        } else if (field.type === 'string') {
          if (typeof raw !== 'string') {
            return res.status(400).json({
              error: 'INVALID_PAYLOAD',
              detail: `Field "${field.field}" must be a string`,
            })
          }
        }
      }
    }

    // Dedupe + preserve order (defensive — UI sends unique ids already).
    const seen = new Set<string>()
    const uniqueIds: string[] = []
    for (const id of ids) {
      if (!seen.has(id)) { seen.add(id); uniqueIds.push(id) }
    }

    const results: { id: string; ok: boolean; error?: string; detail?: string; message?: string }[] = []
    let okCount = 0
    let failCount = 0

    for (const id of uniqueIds) {
      const ctx: EntityActionContext = { model, id, adminPubkey, ip, payload, prisma }
      try {
        const result = await entry.handler(ctx)
        if (result.ok) {
          okCount += 1
          results.push({ id, ok: true, message: result.message })
        } else {
          failCount += 1
          results.push({ id, ok: false, error: result.error, detail: result.detail })
        }
        // Best-effort audit — one row per id, mirroring the single-row endpoint.
        prisma.adminAuditLog.create({
          data: {
            adminPubkey,
            action: `${model}.${action}.bulk`,
            targetId: id,
            payload: JSON.stringify({ ip, payload, ok: result.ok, error: result.ok ? null : result.error }),
          },
        }).catch(err => {
          console.error('[Admin/entities/bulk] AuditLog write failed:', err instanceof Error ? err.message : err)
        })
      } catch (err) {
        failCount += 1
        const msg = err instanceof Error ? err.message : String(err)
        results.push({ id, ok: false, error: 'HANDLER_ERROR', detail: msg })
      }
    }

    return res.json({ okCount, failCount, total: uniqueIds.length, results })
  })

  // GET /api/admin/audit — most recent audit entries (paginated).
  router.get('/audit', async (req: AppRequest, res: Response) => {
    const page  = Math.max(1, parseInt(String(req.query.page ?? '1'),  10))
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10)))
    const skip  = (page - 1) * limit
    const admin = req.query.admin ? String(req.query.admin) : undefined
    const action = req.query.action ? String(req.query.action) : undefined
    try {
      const where: Prisma.AdminAuditLogWhereInput = {
        ...(admin  ? { adminPubkey: admin } : {}),
        ...(action ? { action } : {}),
      }
      const [rows, total] = await Promise.all([
        prisma.adminAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
        prisma.adminAuditLog.count({ where }),
      ])
      return res.json({ rows, total, page, limit })
    } catch (err) {
      return res.status(500).json({ error: 'AUDIT_QUERY_FAILED', detail: err instanceof Error ? err.message : String(err) })
    }
  })

  // GET /api/admin/launch-readiness — FU-681 + ADR-371 admin-visibility ask:
  // one place that surfaces the launch-relevant signals that aren't already
  // on /health (cap/rate-limit reject counters + the current Go-Launch-Gate
  // snapshot, G1-G10 from the Product-Launch-Masterplan). The gate list is a
  // maintained snapshot (see lib/launch-gates.ts), not a live probe — most
  // gates are founder/operator decisions no server-side check can verify.
  router.get('/launch-readiness', async (_req: AppRequest, res: Response) => {
    const metrics = await getLaunchReadinessMetrics()
    return res.json({
      cap: {
        launchMaxTxSats: resolveLaunchMaxTxSats(),
        rejectionsTotal: metrics.capRejections,
      },
      rateLimit: {
        rejections: metrics.rateLimitRejections,
      },
      canvas: {
        // ADR-370 / FU-675 / FU-682: proxy signals only — the canvas instance
        // itself is not something this server process can probe (it's a
        // separate host/service). Env presence is the honest best-effort.
        doopServiceConfigured: Boolean(process.env.DOOP_SERVICE_URL && process.env.DOOP_SERVICE_TOKEN),
        canvasRunnerConfigured: Boolean(process.env.CANVAS_RUNNER_URL && process.env.CANVAS_RUNNER_MASTER_SECRET),
        note: 'ADR-370 Phase 6 (FU-675) code-half is shipped. The live canvas deploy and the fork tag push to GitHub (FU-682) are still open — see FOLLOWUPS.md Section DS.',
      },
      escrowTradeDesk: {
        // FU-662: VITE_ESCROW_TRADE_DESK is a build-time client flag baked into
        // the frontend bundle at `docker build` time — the running server
        // process cannot see what a Docker-built client actually shipped with.
        // This reflects only what THIS process's own env happens to hold.
        envValueSeenByServer: process.env.VITE_ESCROW_TRADE_DESK ?? null,
        caveat: 'Build-time client flag — verify the actual deployed bundle (grep the built JS for the /trade route) rather than trusting this value alone in production.',
      },
      gates: LAUNCH_GATES,
    })
  })

  // ADR-371 D-admin-part: dedicated read/revoke view on the McpConnection
  // ledger (list of external-agent connections + who they belong to),
  // separate from the generic Entities browser so Admin can act on a
  // connection (revoke) without navigating the generic entity-action flow.
  router.get('/mcp-connections', async (req: AppRequest, res: Response) => {
    const status = typeof req.query.status === 'string' ? req.query.status : 'all'
    const page  = Math.max(1, parseInt(String(req.query.page ?? '1'), 10))
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '25'), 10)))
    const now = new Date()
    const where: Prisma.McpConnectionWhereInput =
      status === 'active'  ? { revokedAt: null, expiresAt: { gt: now } } :
      status === 'revoked' ? { revokedAt: { not: null } } :
      status === 'expired' ? { revokedAt: null, expiresAt: { lte: now } } :
      {}
    try {
      const [rows, total] = await Promise.all([
        prisma.mcpConnection.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            user: { select: { pubkey: true, nip05: true, picture: true, blockedAt: true } },
            _count: { select: { events: true } },
          },
        }),
        prisma.mcpConnection.count({ where }),
      ])
      return res.json({
        connections: rows.map((c) => ({
          id: c.id,
          pubkey: c.pubkey,
          user: c.user,
          scope: c.scope,
          label: c.label,
          createdAt: c.createdAt,
          expiresAt: c.expiresAt,
          revokedAt: c.revokedAt,
          lastUsedAt: c.lastUsedAt,
          eventCount: c._count.events,
          status: c.revokedAt ? 'revoked' : c.expiresAt < now ? 'expired' : 'active',
        })),
        total,
        page,
        limit,
      })
    } catch (err) {
      return res.status(500).json({ error: 'MCP_CONNECTIONS_QUERY_FAILED', detail: err instanceof Error ? err.message : String(err) })
    }
  })

  // POST /api/admin/mcp-connections/:id/revoke — admin-initiated revoke
  // (distinct from the user's own self-service revoke and from the
  // block-account cascade in admin-entity-actions.ts's revokeAllMcpConnections
  // call). Idempotent: revoking an already-revoked connection 404s.
  router.post('/mcp-connections/:id/revoke', async (req: AppRequest, res: Response) => {
    const ok = await revokeMcpConnection(prisma, req.params.id)
    if (!ok) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Connection not found or already revoked.' })
    }
    const adminPubkey = (req as AuthenticatedRequest).authPubkey ?? 'unknown'
    await prisma.adminAuditLog.create({
      data: { adminPubkey, action: 'mcpConnection.revoke', targetId: req.params.id, payload: '{}' },
    }).catch((err) => console.error('[Admin/mcp-connections] AuditLog write failed:', err))
    return res.json({ ok: true })
  })

  // GET /api/admin/newsletter/subscribers — ADR-400: unified newsletter audience
  // (confirmed footer signups + registered accounts that carry an email),
  // deduped by email, newest first. Admin-only via the /api/admin mount.
  // Query: status=all|CONFIRMED|PENDING|UNSUBSCRIBED, origin=all|subscriber|account,
  //        q=<email/pubkey substring>, page, limit.
  router.get('/newsletter/subscribers', async (req: AppRequest, res: Response) => {
    try {
      const rows = await loadNewsletterAudience(prisma)
      const filtered = filterNewsletterAudience(rows, req.query.status, req.query.origin, req.query.q)
      const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50))
      const start = (page - 1) * limit
      return res.json({
        subscribers: filtered.slice(start, start + limit),
        total: filtered.length,
        page,
        limit,
        stats: newsletterAudienceStats(rows),
      })
    } catch (err) {
      console.error('[Admin/newsletter] list failed:', err)
      return res.status(500).json({ error: 'NEWSLETTER_QUERY_FAILED' })
    }
  })

  // GET /api/admin/newsletter/subscribers/export — CSV of the filtered audience
  // (same filters as the list, no pagination). BOM-prefixed for Excel.
  router.get('/newsletter/subscribers/export', async (req: AppRequest, res: Response) => {
    try {
      const rows = filterNewsletterAudience(
        await loadNewsletterAudience(prisma),
        req.query.status,
        req.query.origin,
        req.query.q,
      )
      const header = ['email', 'origin', 'status', 'consent', 'email_verified', 'pubkey', 'source', 'confirmed_at', 'unsubscribed_at', 'created_at']
      const lines = [header.join(',')]
      for (const r of rows) {
        lines.push([
          r.email,
          r.origin,
          r.status,
          r.consent ? 'true' : 'false',
          r.emailVerified ? 'true' : 'false',
          r.pubkey ?? '',
          r.source,
          r.confirmedAt ? r.confirmedAt.toISOString() : '',
          r.unsubscribedAt ? r.unsubscribedAt.toISOString() : '',
          r.createdAt.toISOString(),
        ].map(csvCell).join(','))
      }
      const date = new Date().toISOString().slice(0, 10)
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="newsletter-audience-${date}.csv"`)
      return res.send('\uFEFF' + lines.join('\r\n') + '\r\n')
    } catch (err) {
      console.error('[Admin/newsletter] export failed:', err)
      return res.status(500).json({ error: 'NEWSLETTER_EXPORT_FAILED' })
    }
  })

  return router
}

/**
 * Load and unify both newsletter sources. Admin-only, low-volume list; the
 * per-source cap is a memory safety valve, not real pagination (ADR-400
 * Consequences). `token` is deliberately not selected — it is a capability
 * link the audience view never needs.
 */
const NEWSLETTER_AUDIENCE_MAX_ROWS = 5000

async function loadNewsletterAudience(prisma: PrismaClient): Promise<NewsletterAudienceRow[]> {
  const [subscribers, users] = await Promise.all([
    prisma.newsletterSubscriber.findMany({
      orderBy: { createdAt: 'desc' },
      take: NEWSLETTER_AUDIENCE_MAX_ROWS,
      select: {
        email: true,
        source: true,
        status: true,
        pubkey: true,
        confirmedAt: true,
        unsubscribedAt: true,
        consentAt: true,
        createdAt: true,
      },
    }),
    prisma.user.findMany({
      where: { email: { not: null } },
      select: { pubkey: true, email: true, emailVerified: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: NEWSLETTER_AUDIENCE_MAX_ROWS,
    }),
  ])
  if (subscribers.length >= NEWSLETTER_AUDIENCE_MAX_ROWS || users.length >= NEWSLETTER_AUDIENCE_MAX_ROWS) {
    console.warn(`[Admin/newsletter] audience capped at ${NEWSLETTER_AUDIENCE_MAX_ROWS} rows per source`)
  }
  return buildNewsletterAudience(
    subscribers.map((s) => ({
      email: s.email,
      source: s.source,
      status: s.status,
      pubkey: s.pubkey,
      confirmedAt: s.confirmedAt,
      unsubscribedAt: s.unsubscribedAt,
      consentAt: s.consentAt,
      createdAt: s.createdAt,
    })),
    users,
  )
}

function filterNewsletterAudience(
  rows: NewsletterAudienceRow[],
  status: unknown,
  origin: unknown,
  q: unknown,
): NewsletterAudienceRow[] {
  const statusFilter = typeof status === 'string' ? status : 'all'
  const originFilter = typeof origin === 'string' ? origin : 'all'
  const term = typeof q === 'string' ? q.trim().toLowerCase() : ''
  return rows.filter((r) =>
    (statusFilter === 'all' || r.status === statusFilter) &&
    (originFilter === 'all' || r.origin === originFilter) &&
    (!term || r.email.includes(term) || (r.pubkey ?? '').toLowerCase().includes(term)),
  )
}

function newsletterAudienceStats(rows: NewsletterAudienceRow[]) {
  return {
    total: rows.length,
    // ADR-402 D16: the campaign audience = confirmed rows with a recorded opt-in.
    confirmed: rows.filter((r) => r.status === 'CONFIRMED' && r.consent).length,
    pending: rows.filter((r) => r.status === 'PENDING').length,
    unsubscribed: rows.filter((r) => r.status === 'UNSUBSCRIBED').length,
    noConsent: rows.filter((r) => r.status === 'NO_CONSENT').length,
    subscribers: rows.filter((r) => r.origin === 'subscriber').length,
    accounts: rows.filter((r) => r.origin === 'account').length,
  }
}

function csvCell(value: string): string {
  // Neutralise spreadsheet formula triggers (=, +, -, @, tab, CR) before the
  // normal quoting — otherwise an attacker-supplied email starting with '='
  // executes as a formula when the export is opened in Excel/Sheets.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
