/**
 * Admin Agent-Profile Verification API — ADR-315 D3.
 *
 * Endpoints (all Foundation-admin-only, sub-router mounts
 * requireAuth + requireFoundationAdminBySession itself):
 *   GET    /api/admin/agent-profiles?verified=true|false&page&limit&ownerPubkey&q
 *                                                — paginated list with filters
 *   POST   /api/admin/agent-profiles/:id/verify  — body { notes?: string }
 *                                                — sets isVerified, verifiedAt, verifiedByPubkey
 *   POST   /api/admin/agent-profiles/:id/unverify
 *                                                — clears the four verification fields
 *   GET    /api/admin/agent-profiles/:id         — single profile (admin view, includes notes)
 *
 * Idempotency: verify on an already-verified profile overwrites notes + verifiedAt
 * + verifiedByPubkey (latest audit wins — the model already represents "one
 * current auditor", not a history). unverify on a non-verified profile is a
 * no-op success.
 *
 * ADR-317 D1 / FU-414 (2026-08-20): verify also upserts a single
 * `AgentClaim{claimType:'AuditClaim', attesterType:'dao'}` row and recomputes
 * the agent's trustScore (ATTESTER_WEIGHTS.dao = 1.0 alone caps
 * VerificationScore); unverify deletes it and recomputes again. This is the
 * "Foundation-Kuratierungs-Workflow" FU-414 was waiting on — it didn't exist
 * when ADR-317 was written, ADR-315 D3 built it the same day.
 *
 * Audit-criteria policy (documented in ADR-315 Implementation Record, not
 * enforced here — the ADR explicitly defers the criteria rubric to a DAO
 * proposal, per ADR-244's Chamber-1 reputation rule on trust criteria):
 *   - Code quality (config-sealed, no plain-text secrets)
 *   - Config security (NIP-44 sealing intact per ADR-306)
 *   - Performance history (reviews / resolution rate)
 *   - Dispute rate (clean, no unresolved escalations)
 */

import { Router } from 'express'
import type { Prisma, PrismaClient } from '@prisma/client'
import { getRedis } from '../lib/redis.js'
import { requireAuth, type AuthenticatedRequest } from '../middleware/require-auth.js'
import { requireFoundationAdminBySession } from '../middleware/require-admin.js'
import { recomputeTrustScore } from '../services/agentTrustService.js'
import { publishVerifiedBadgeAttestation } from '../services/agent-attestation.js'

const MAX_NOTES_LENGTH = 2000
const MAX_LIMIT = 100
const DEFAULT_LIMIT = 20

export function createAdminAgentProfilesRouter(prisma: PrismaClient) {
  const router = Router()

  // Mirror the remote-candidates router pattern: sub-router mounts its own
  // auth + admin gates so the parent /api/admin mount (which would otherwise
  // double-stack requireAuth) doesn't apply.
  router.use(requireAuth(prisma), requireFoundationAdminBySession(prisma))

  // GET /api/admin/agent-profiles — paginated list with filters.
  router.get('/', async (req: AuthenticatedRequest, res) => {
    try {
      const verifiedParam = typeof req.query.verified === 'string' ? req.query.verified : undefined
      const ownerPubkey = typeof req.query.ownerPubkey === 'string' && req.query.ownerPubkey.trim()
        ? req.query.ownerPubkey.trim()
        : undefined
      const q = typeof req.query.q === 'string' && req.query.q.trim()
        ? req.query.q.trim().slice(0, 80)
        : undefined

      const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1)
      const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))
      const skip = (page - 1) * limit

      const where: Prisma.AgentProfileWhereInput = {}
      if (verifiedParam === 'true') where.isVerified = true
      else if (verifiedParam === 'false') where.isVerified = false
      if (ownerPubkey) where.ownerPubkey = ownerPubkey
      if (q) {
        where.OR = [
          { name: { contains: q, mode: 'insensitive' } },
          { ownerPubkey: { contains: q } },
        ]
      }

      const [rows, total] = await Promise.all([
        prisma.agentProfile.findMany({
          where,
          orderBy: [{ isVerified: 'desc' }, { updatedAt: 'desc' }],
          skip,
          take: limit,
          include: {
            owner: { select: { pubkey: true, lnAddress: true, nip05: true, picture: true } },
            _count: { select: { offers: true } },
          },
        }),
        prisma.agentProfile.count({ where }),
      ])

      return res.json({
        agentProfiles: rows.map(r => ({
          id: r.id,
          name: r.name,
          description: r.description,
          ownerPubkey: r.ownerPubkey,
          owner: r.owner,
          capabilities: r.capabilities,
          isPublic: r.isPublic,
          isVerified: r.isVerified,
          verifiedAt: r.verifiedAt,
          verifiedByPubkey: r.verifiedByPubkey,
          verificationNotes: r.verificationNotes,
          reputationScore: r.reputationScore,
          trustScore: r.trustScore,
          offersCount: r._count.offers,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
        total,
        page,
        limit,
      })
    } catch (err) {
      console.error('[admin/agent-profiles] GET / error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // GET /api/admin/agent-profiles/:id — single profile (admin view, includes notes).
  router.get('/:id', async (req: AuthenticatedRequest, res) => {
    try {
      const profile = await prisma.agentProfile.findUnique({
        where: { id: req.params.id },
        include: {
          owner: { select: { pubkey: true, lnAddress: true, nip05: true, picture: true } },
          _count: { select: { offers: true } },
        },
      })
      if (!profile) return res.status(404).json({ error: 'NOT_FOUND' })
      return res.json({ agentProfile: profile })
    } catch (err) {
      console.error('[admin/agent-profiles] GET /:id error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // POST /api/admin/agent-profiles/:id/verify — body { notes?: string }.
  // Idempotent: re-verifying overwrites notes + verifiedAt + verifiedByPubkey.
  router.post('/:id/verify', async (req: AuthenticatedRequest, res) => {
    const callerPubkey = req.authPubkey
    if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const id = req.params.id
    const body = (req.body ?? {}) as { notes?: unknown }

    let notes: string | null = null
    if (body.notes !== undefined && body.notes !== null) {
      if (typeof body.notes !== 'string') {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'notes must be a string' })
      }
      const trimmed = body.notes.trim()
      if (trimmed.length > MAX_NOTES_LENGTH) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: `notes must not exceed ${MAX_NOTES_LENGTH} characters` })
      }
      notes = trimmed || null
    }

    try {
      const existing = await prisma.agentProfile.findUnique({ where: { id }, select: { id: true, capabilities: true, ownerPubkey: true } })
      if (!existing) return res.status(404).json({ error: 'NOT_FOUND' })

      const updated = await prisma.agentProfile.update({
        where: { id },
        data: {
          isVerified: true,
          verifiedAt: new Date(),
          verifiedByPubkey: callerPubkey,
          verificationNotes: notes,
        },
      })

      // FU-450: portable Kind 31423 attestation, fire-and-forget — a publish
      // failure (or no attestation key configured) must never block the
      // verify response, mirroring ADR-307 D4's review-attestation publish.
      publishVerifiedBadgeAttestation({
        agentProfileId: id,
        ownerPubkey: existing.ownerPubkey,
        status: 'verified',
        verifiedAt: updated.verifiedAt,
      }).catch(err => console.error('[admin/agent-profiles] publishVerifiedBadgeAttestation failed (non-fatal):', err))

      // ADR-317 D1/FU-414: a Foundation verify is also an AuditClaim, feeding
      // agentTrustService's VerificationScore (ATTESTER_WEIGHTS.dao = 1.0).
      // One current AuditClaim per agent, same "latest audit wins" semantics
      // as the isVerified fields above — upsert, not accumulate.
      const auditClaim = await prisma.agentClaim.findFirst({
        where: { agentProfileId: id, claimType: 'AuditClaim', attesterType: 'dao' },
        select: { id: true },
      })
      const auditClaimData = { attesterPubkey: callerPubkey, capabilities: existing.capabilities }
      if (auditClaim) {
        await prisma.agentClaim.update({ where: { id: auditClaim.id }, data: auditClaimData })
      } else {
        await prisma.agentClaim.create({
          data: { agentProfileId: id, claimType: 'AuditClaim', attesterType: 'dao', ...auditClaimData },
        })
      }
      try {
        await recomputeTrustScore(id, prisma)
      } catch (err) {
        console.error('[admin/agent-profiles] recomputeTrustScore failed (non-fatal, verify already committed):', err)
      }

      // Invalidate the public list cache so the next /api/agent-profiles/:id
      // read sees the new verified status. The cache key shape must match
      // whatever setCachedRead wraps; the simpler thing is to bust the search
      // index aliases since the badge flows through them. Outbox re-enqueue
      // is the safer path than scrape-the-cache.
      const redis = getRedis()
      if (redis) {
        try {
          // Best-effort cache bust — search index will catch up via outbox.
          await redis.del('api:agent-profiles:list')
        } catch { /* cache miss is fine */ }
      }

      // Enqueue an outbox upsert for every offer of this agent so the Meili
      // search document picks up the new agentIsVerified facet on the next
      // worker tick. Cheaper than a full reindex.
      const offers = await prisma.offer.findMany({
        where: { agentProfileId: id },
        select: { id: true },
      })
      if (offers.length > 0) {
        await prisma.outboxEvent.createMany({
          data: offers.map(o => ({
            aggregate: 'offer',
            aggregateId: o.id,
            eventType: 'upsert',
            payload: { id: o.id, reason: 'agent-verified' },
          })),
          skipDuplicates: true,
        })
      }

      return res.json({
        agentProfile: {
          id: updated.id,
          isVerified: updated.isVerified,
          verifiedAt: updated.verifiedAt,
          verifiedByPubkey: updated.verifiedByPubkey,
          verificationNotes: updated.verificationNotes,
        },
      })
    } catch (err) {
      console.error('[admin/agent-profiles] POST /:id/verify error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // POST /api/admin/agent-profiles/:id/unverify — clears the four verification fields.
  // Idempotent: unverify on a non-verified profile is a no-op success.
  router.post('/:id/unverify', async (req: AuthenticatedRequest, res) => {
    const id = req.params.id
    try {
      const existing = await prisma.agentProfile.findUnique({ where: { id }, select: { id: true, isVerified: true, ownerPubkey: true } })
      if (!existing) return res.status(404).json({ error: 'NOT_FOUND' })

      if (!existing.isVerified) {
        return res.json({
          agentProfile: {
            id: existing.id,
            isVerified: false,
            verifiedAt: null,
            verifiedByPubkey: null,
            verificationNotes: null,
          },
          alreadyUnverified: true,
        })
      }

      const updated = await prisma.agentProfile.update({
        where: { id },
        data: {
          isVerified: false,
          verifiedAt: null,
          verifiedByPubkey: null,
          verificationNotes: null,
        },
      })

      // ADR-317 D1/FU-414: remove the AuditClaim this profile's verify
      // created — an unverified agent should not keep the max VerificationScore.
      await prisma.agentClaim.deleteMany({ where: { agentProfileId: id, claimType: 'AuditClaim', attesterType: 'dao' } })
      try {
        await recomputeTrustScore(id, prisma)
      } catch (err) {
        console.error('[admin/agent-profiles] recomputeTrustScore failed (non-fatal, unverify already committed):', err)
      }

      // FU-450: republish the same Kind 31423 address with status=unverified
      // so a portable badge already seen by other clients reflects the
      // revocation instead of staying stale. Fire-and-forget, see verify above.
      publishVerifiedBadgeAttestation({
        agentProfileId: id,
        ownerPubkey: existing.ownerPubkey,
        status: 'unverified',
      }).catch(err => console.error('[admin/agent-profiles] publishVerifiedBadgeAttestation failed (non-fatal):', err))

      const offers = await prisma.offer.findMany({
        where: { agentProfileId: id },
        select: { id: true },
      })
      if (offers.length > 0) {
        await prisma.outboxEvent.createMany({
          data: offers.map(o => ({
            aggregate: 'offer',
            aggregateId: o.id,
            eventType: 'upsert',
            payload: { id: o.id, reason: 'agent-unverified' },
          })),
          skipDuplicates: true,
        })
      }

      return res.json({
        agentProfile: {
          id: updated.id,
          isVerified: updated.isVerified,
          verifiedAt: updated.verifiedAt,
          verifiedByPubkey: updated.verifiedByPubkey,
          verificationNotes: updated.verificationNotes,
        },
      })
    } catch (err) {
      console.error('[admin/agent-profiles] POST /:id/unverify error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  return router
}
