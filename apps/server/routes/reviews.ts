import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'
import type { ColPointsService } from '../services/colPointsService.js'
import { canBuildReputation } from '../services/tradeVisibility.js'
import { recomputeAgentReputationScore } from '../services/agentReputationService.js'
import { recomputeTrustScore, getAgentFinalScore } from '../services/agentTrustService.js'
import { resolveMutualReviewBonus } from '../services/agent-marketplace.js'

const AGENT_METRIC_DIMENSIONS = ['accuracy', 'speed', 'reliability', 'quality'] as const

export function createReviewsRouter(prisma: PrismaClient, colPointsService: ColPointsService) {
  const router = Router()

  // POST /api/reviews
  router.post('/', async (req, res) => {
    try {
      const { ticketId, reviewerPubkey, revieweePubkey, stars, content, nostrEventId, agentMetrics } = req.body

      // Basic validation
      if (!ticketId || !reviewerPubkey || !revieweePubkey || stars === undefined || !content) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'ticketId, reviewerPubkey, revieweePubkey, stars, and content are required' })
      }

      if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'stars must be an integer between 1 and 5' })
      }

      if (content.length > 2048) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'content must not exceed 2048 characters' })
      }

      // Ticket must be COMPLETED
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: { offer: { select: { agentProfileId: true } } },
      })
      if (!ticket) {
        return res.status(404).json({ error: 'TICKET_NOT_FOUND', message: 'Ticket not found' })
      }

      // ADR-307 D1: agentMetrics is only meaningful on AGENT_SETUP tickets.
      if (agentMetrics !== undefined) {
        if (ticket.offerType !== 'AGENT_SETUP') {
          return res.status(400).json({ error: 'AGENT_METRICS_NOT_APPLICABLE', message: 'agentMetrics is only accepted for AGENT_SETUP tickets' })
        }
        if (agentMetrics === null || typeof agentMetrics !== 'object' || Array.isArray(agentMetrics)) {
          return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'agentMetrics must be an object' })
        }
        for (const dim of AGENT_METRIC_DIMENSIONS) {
          const value = agentMetrics[dim]
          if (value !== undefined && value !== null && (!Number.isInteger(value) || value < 1 || value > 5)) {
            return res.status(400).json({ error: 'VALIDATION_ERROR', message: `agentMetrics.${dim} must be an integer between 1 and 5` })
          }
        }
        if (agentMetrics.wouldReuse !== undefined && agentMetrics.wouldReuse !== null && typeof agentMetrics.wouldReuse !== 'boolean') {
          return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'agentMetrics.wouldReuse must be a boolean' })
        }
      }

      if (ticket.status !== 'COMPLETED') {
        return res.status(400).json({ error: 'TICKET_NOT_COMPLETED', message: 'Ticket must be COMPLETED to leave a review' })
      }

      // ADR-152 §A3: Private trades explicitly opt out of reputation. Reviews
      // are PUBLIC-only; private tickets cannot be reviewed.
      if (!canBuildReputation(ticket.visibility)) {
        return res.status(403).json({
          error: 'PRIVATE_TRADE_NO_REPUTATION',
          message: 'Reviews are not available for private trades. This is by design (ADR-152 §A3).',
        })
      }

      // 14-day window
      const windowMs = 14 * 24 * 60 * 60 * 1000
      if (Date.now() - ticket.updatedAt.getTime() > windowMs) {
        return res.status(400).json({ error: 'REVIEW_WINDOW_CLOSED', message: 'Review window (14 days) has expired' })
      }

      // Reviewer must be a ticket participant
      if (reviewerPubkey !== ticket.buyerPubkey && reviewerPubkey !== ticket.sellerPubkey) {
        return res.status(403).json({ error: 'NOT_PARTICIPANT', message: 'Reviewer must be buyer or seller of the ticket' })
      }

      // No duplicate review
      const existingReview = await prisma.review.findFirst({
        where: { ticketId, reviewerPubkey },
      })
      if (existingReview) {
        return res.status(400).json({ error: 'DUPLICATE_REVIEW', message: 'You have already reviewed this ticket' })
      }

      // nostrEventId duplicate guard
      if (nostrEventId) {
        const existingByNostr = await prisma.review.findUnique({ where: { nostrEventId } })
        if (existingByNostr) {
          return res.status(400).json({ error: 'DUPLICATE_NOSTR_EVENT', message: 'This Nostr event has already been indexed' })
        }
      }

      const review = await prisma.review.create({
        data: {
          ticketId,
          reviewerPubkey,
          revieweePubkey,
          stars,
          content,
          nostrEventId: nostrEventId ?? null,
        },
      })

      // ADR-307 D1/D2: persist the extra dimensions and recompute the agent's
      // cached composite score. agentMetrics was already validated above; only
      // reachable when the ticket is AGENT_SETUP and its offer resolved to an
      // AgentProfile.
      let agentReputationScore: number | null | undefined
      if (agentMetrics !== undefined && ticket.offer?.agentProfileId) {
        await prisma.agentReviewMetrics.create({
          data: {
            reviewId: review.id,
            accuracy: agentMetrics.accuracy ?? null,
            speed: agentMetrics.speed ?? null,
            reliability: agentMetrics.reliability ?? null,
            quality: agentMetrics.quality ?? null,
            wouldReuse: agentMetrics.wouldReuse ?? null,
          },
        })
        agentReputationScore = await recomputeAgentReputationScore(ticket.offer.agentProfileId, prisma)
      }

      // ADR-316 D2/ADR-317 D1: any review on a completed AGENT_SETUP ticket is
      // itself Sybil-resistant evidence (ADR-316 D5 — ticket-bound, real paid
      // completion) that the agent's declared capabilities were exercised, so
      // it counts as a "customer" CapabilityClaim independent of whether the
      // reviewer also filled in the ADR-307 star-dimension breakdown above.
      let agentTrustScore: number | null | undefined
      if (ticket.offer?.agentProfileId) {
        const agentProfile = await prisma.agentProfile.findUnique({
          where: { id: ticket.offer.agentProfileId },
          select: { capabilities: true },
        })
        if (agentProfile) {
          await prisma.agentClaim.create({
            data: {
              agentProfileId: ticket.offer.agentProfileId,
              claimType: 'CapabilityClaim',
              attesterType: 'customer',
              attesterPubkey: reviewerPubkey,
              capabilities: agentProfile.capabilities,
              ticketId,
              reviewId: review.id,
            },
          })
          agentTrustScore = await recomputeTrustScore(ticket.offer.agentProfileId, prisma)
        }
      }

      // Mutual review check → award COL-Points if both parties have now reviewed.
      // The canBuildReputation check above already guards this path, but we
      // double-check here so the audit trail is explicit.
      const otherPartyPubkey = reviewerPubkey === ticket.buyerPubkey ? ticket.sellerPubkey : ticket.buyerPubkey
      const otherReview = await prisma.review.findFirst({
        where: { ticketId, reviewerPubkey: otherPartyPubkey },
      })

      let mutualRewardGranted = false
      if (otherReview && canBuildReputation(ticket.visibility)) {
        // ADR-320 D4: first 10 bookings of a new AGENT_SETUP offer earn +5
        // COL-Points instead of the standard +3.
        const bonus = await resolveMutualReviewBonus(prisma, ticket)
        const r1 = await colPointsService.awardPoints(reviewerPubkey, bonus, 'MUTUAL_REVIEW', ticketId)
        const r2 = await colPointsService.awardPoints(otherPartyPubkey, bonus, 'MUTUAL_REVIEW', ticketId)
        mutualRewardGranted = r1.awarded && r2.awarded
      }

      return res.status(201).json({
        review,
        mutualRewardGranted,
        agentReputationScore,
        agentTrustScore,
        // ADR-307 D3: FinalScore = reputationScore × trustMultiplier.
        agentFinalScore: agentReputationScore !== undefined ? getAgentFinalScore(agentReputationScore, agentTrustScore) : undefined,
      })
    } catch (err) {
      console.error('[reviews] POST / error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' })
    }
  })

  // GET /api/reviews/:pubkey
  router.get('/:pubkey', async (req, res) => {
    try {
      const { pubkey } = req.params
      const as = req.query.as === 'reviewer' ? 'reviewer' : 'reviewee'
      const where = as === 'reviewer'
        ? { reviewerPubkey: pubkey }
        : { revieweePubkey: pubkey }

      const reviews = await prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      })

      const averageStars = reviews.length > 0
        ? Math.round((reviews.reduce((sum, r) => sum + r.stars, 0) / reviews.length) * 10) / 10
        : 0

      return res.json({ reviews, averageStars, totalCount: reviews.length })
    } catch (err) {
      console.error('[reviews] GET /:pubkey error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' })
    }
  })

  return router
}
