/**
 * Remote Offer Candidate Admin API — ADR-139 Phase 5
 *
 * Endpoints:
 *   GET    /api/admin/remote-candidates          — list candidates (filterable by status)
 *   GET    /api/admin/remote-candidates/:id       — get single candidate
 *   POST   /api/admin/remote-candidates/:id/approve  — approve → create Offer (source=REMOTE)
 *   POST   /api/admin/remote-candidates/:id/reject   — reject with reason
 *   POST   /api/admin/remote-candidates/approve-all  — approve up to `limit` PENDING_REVIEW candidates
 *   GET    /api/admin/remote-candidates/stats     — summary counts
 */

import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'
import { requireAuth, type AuthenticatedRequest } from '../middleware/require-auth.js'
import { requireFoundationAdminBySession } from '../middleware/require-admin.js'
import { invalidateListCache } from '../middleware/cache.js'
import { approveCandidate, approvePendingCandidates } from '../services/remote-candidate-approval.js'

export function createRemoteCandidateRouter(prisma: PrismaClient): Router {
  const router = Router()

  // ADR-145: approve/reject decides what real, public marketplace content
  // ingested from external Nostr relays goes live — same launch-scope
  // Foundation-admin gate as community DAO creation (require-admin.ts).
  router.use(requireAuth(prisma), requireFoundationAdminBySession(prisma))

  /**
   * GET /api/admin/remote-candidates/stats
   * Summary counts by status
   */
  router.get('/stats', async (_req: AuthenticatedRequest, res) => {
    try {
      const counts = await prisma.remoteOfferCandidate.groupBy({
        by: ['status'],
        _count: { id: true },
      })

      const stats = Object.fromEntries(
        counts.map(c => [c.status, c._count.id]),
      )

      res.json({
        PENDING_REVIEW: stats.PENDING_REVIEW ?? 0,
        APPROVED: stats.APPROVED ?? 0,
        REJECTED: stats.REJECTED ?? 0,
        EXPIRED: stats.EXPIRED ?? 0,
      })
    } catch (error) {
      console.error('[remote-candidates] stats error:', error)
      res.status(500).json({ error: 'Failed to fetch stats' })
    }
  })

  /**
   * GET /api/admin/remote-candidates
   * List candidates with optional status filter
   */
  router.get('/', async (req: AuthenticatedRequest, res) => {
    try {
      const status = req.query.status as string | undefined
      const page = Math.max(1, Number(req.query.page) || 1)
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
      const skip = (page - 1) * limit

      const where = status ? { status: status as any } : {}

      const [candidates, total] = await Promise.all([
        prisma.remoteOfferCandidate.findMany({
          where,
          orderBy: { fetchedAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.remoteOfferCandidate.count({ where }),
      ])

      res.json({
        candidates,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    } catch (error) {
      console.error('[remote-candidates] list error:', error)
      res.status(500).json({ error: 'Failed to list candidates' })
    }
  })

  /**
   * GET /api/admin/remote-candidates/:id
   */
  router.get('/:id', async (req: AuthenticatedRequest, res) => {
    try {
      const candidate = await prisma.remoteOfferCandidate.findUnique({
        where: { id: req.params.id },
      })

      if (!candidate) {
        return res.status(404).json({ error: 'Candidate not found' })
      }

      res.json(candidate)
    } catch (error) {
      console.error('[remote-candidates] get error:', error)
      res.status(500).json({ error: 'Failed to fetch candidate' })
    }
  })

  /**
   * POST /api/admin/remote-candidates/:id/approve
   * Approve candidate → create Offer (source=REMOTE) → write to outbox
   */
  router.post('/:id/approve', async (req: AuthenticatedRequest, res) => {
    try {
      const candidate = await prisma.remoteOfferCandidate.findUnique({
        where: { id: req.params.id },
      })

      if (!candidate) {
        return res.status(404).json({ error: 'Candidate not found' })
      }

      // ADR-363 D4: APPROVED candidates may be re-approved — a re-published
      // NIP-99 listing (new event id, same d-tag) refreshes the candidate's
      // rawEvent via the subscriber while keeping status APPROVED; re-approving
      // then flows through approveCandidate's in-place guard below and updates
      // the live offer (plus outbox + cache invalidation) instead of creating
      // a duplicate. REJECTED/EXPIRED stay terminal.
      if (candidate.status === 'REJECTED' || candidate.status === 'EXPIRED') {
        return res.status(400).json({ error: `Candidate is ${candidate.status}, expected PENDING_REVIEW or APPROVED` })
      }

      const offer = await approveCandidate(prisma, candidate, req.authPubkey!)
      // ADR-363 D5: the outbox event reaches Meilisearch, but the versioned
      // /api/offers + /api/search caches (shared `offers` tag) stay stale up
      // to their TTL without a bump. Invalidate after the commit so the
      // newly approved (or re-approved) remote offer appears on every public
      // surface on the next request instead of lagging behind Meili.
      await invalidateListCache('offers')
      res.json({ success: true, offerId: offer.id, reapproved: candidate.status === 'APPROVED' })
    } catch (error) {
      console.error('[remote-candidates] approve error:', error)
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to approve candidate' })
    }
  })

  /**
   * POST /api/admin/remote-candidates/approve-all
   * Approve up to `limit` PENDING_REVIEW candidates (oldest first), one at a
   * time so a single bad candidate doesn't abort the batch. Intended to be
   * called repeatedly by the client (see RemoteCandidatesSection.tsx) until
   * `remainingPending` reaches 0 — keeps each request short instead of
   * risking a proxy timeout on a large backlog.
   */
  router.post('/approve-all', async (req: AuthenticatedRequest, res) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.body?.limit) || 50))
      const result = await approvePendingCandidates(prisma, {
        limit,
        reviewerPubkey: req.authPubkey!,
        rejectReason: 'auto-rejected by approve-all: failed normalization',
      })
      // ADR-363 D5: one version bump per batch, after the loop, only when
      // something was actually approved (see single-approve route for why).
      if (result.approved > 0) await invalidateListCache('offers')
      res.json({
        approved: result.approved,
        failed: result.failed,
        failures: result.failures,
        remainingPending: result.remainingPending,
      })
    } catch (error) {
      console.error('[remote-candidates] approve-all error:', error)
      res.status(500).json({ error: 'Failed to run approve-all batch' })
    }
  })

  /**
   * POST /api/admin/remote-candidates/:id/reject
   * Reject candidate with optional reason
   */
  router.post('/:id/reject', async (req: AuthenticatedRequest, res) => {
    try {
      const { reason } = req.body as { reason?: string }
      const candidate = await prisma.remoteOfferCandidate.findUnique({
        where: { id: req.params.id },
      })

      if (!candidate) {
        return res.status(404).json({ error: 'Candidate not found' })
      }

      if (candidate.status !== 'PENDING_REVIEW') {
        return res.status(400).json({ error: `Candidate is ${candidate.status}, expected PENDING_REVIEW` })
      }

      await prisma.remoteOfferCandidate.update({
        where: { id: candidate.id },
        data: {
          status: 'REJECTED',
          reviewedBy: req.authPubkey!,
          reviewedAt: new Date(),
          rejectedReason: reason || null,
        },
      })

      res.json({ success: true })
    } catch (error) {
      console.error('[remote-candidates] reject error:', error)
      res.status(500).json({ error: 'Failed to reject candidate' })
    }
  })

  return router
}
