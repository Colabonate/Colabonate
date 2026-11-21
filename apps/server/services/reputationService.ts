import type { PrismaClient } from '@prisma/client'

export interface ReputationInput {
  reviews: Array<{ stars: number; reviewerIdentityLevel: number }>
  ticketsCompleted: number
  ticketsAccepted: number
  disputesLost: number
  disputesParticipated: number
  colPoints: number
  identityLevel: number
}

const IDENTITY_MULTIPLIERS: Record<number, number> = {
  0: 0.80,
  1: 0.90,
  2: 1.00,
  3: 1.10,
}

const REVIEWER_WEIGHTS: Record<number, number> = {
  0: 1.0,
  1: 1.0,
  2: 1.2,
  3: 1.5,
}

export function computeReputationScore(input: ReputationInput): number {
  const { reviews, ticketsCompleted, ticketsAccepted, disputesLost, disputesParticipated, colPoints, identityLevel } = input

  // star_average: weighted avg, fallback 3.0 if < 3 reviews
  let starAverage = 3.0
  if (reviews.length >= 3) {
    let totalWeight = 0
    let weightedSum = 0
    for (const r of reviews) {
      const w = REVIEWER_WEIGHTS[r.reviewerIdentityLevel] ?? 1.0
      weightedSum += r.stars * w
      totalWeight += w
    }
    starAverage = totalWeight > 0 ? weightedSum / totalWeight : 3.0
  }

  // completion_rate: fallback 1.0 if < 5 accepted tickets
  const completionRate = ticketsAccepted >= 5
    ? Math.min(ticketsCompleted / ticketsAccepted, 1.0)
    : 1.0

  // dispute_loss_rate: fallback 0.0 if < 1 dispute
  const disputeLossRate = disputesParticipated >= 1
    ? Math.min(disputesLost / disputesParticipated, 1.0)
    : 0.0

  // col_points_factor: capped at 1000
  const colPointsFactor = Math.min(colPoints, 1000) / 1000

  const rawScore =
    starAverage * 0.50 +
    completionRate * 5.0 * 0.25 +
    (1 - disputeLossRate) * 5.0 * 0.15 +
    colPointsFactor * 0.10

  const multiplier = IDENTITY_MULTIPLIERS[identityLevel] ?? 0.80
  const finalScore = Math.min(rawScore * multiplier, 5.0)

  return Math.round(finalScore * 100) / 100
}

export async function fetchReputationInput(
  pubkey: string,
  prisma: PrismaClient
): Promise<ReputationInput> {
  const [user, reviews, completedAsSellerCount, acceptedAsSellerCount] = await Promise.all([
    prisma.user.findUnique({ where: { pubkey }, select: { colPoints: true, identityLevel: true } }),
    prisma.review.findMany({
      where: { revieweePubkey: pubkey },
      select: { stars: true, reviewerPubkey: true },
    }),
    prisma.ticket.count({
      where: { sellerPubkey: pubkey, status: 'COMPLETED' },
    }),
    prisma.ticket.count({
      where: { sellerPubkey: pubkey, status: { in: ['ACCEPTED', 'PAID', 'IN_PROGRESS', 'COMPLETED'] } },
    }),
  ])

  // Resolve reviewer identity levels
  const reviewerPubkeys = [...new Set(reviews.map(r => r.reviewerPubkey))]
  const reviewers = await prisma.user.findMany({
    where: { pubkey: { in: reviewerPubkeys } },
    select: { pubkey: true, identityLevel: true },
  })
  const reviewerLevelMap = new Map(reviewers.map(r => [r.pubkey, r.identityLevel]))

  // ADR-318: derived from the resolved Dispute record's outcome, not from
  // Ticket.status — the verdict routes write the terminal ticket status
  // straight to COMPLETED/CANCELLED and never set ARBITRATION_LOST/DISPUTED,
  // so a status-filter here would always read 0. A pubkey lost a resolved
  // dispute when it was the seller and the outcome was CANCEL (no payout),
  // or the buyer and the outcome was RELEASE (no refund).
  const [disputesLost, disputesParticipated] = await Promise.all([
    prisma.dispute.count({
      where: {
        status: 'RESOLVED',
        OR: [
          { outcome: 'CANCEL', ticket: { sellerPubkey: pubkey } },
          { outcome: 'RELEASE', ticket: { buyerPubkey: pubkey } },
        ],
      },
    }),
    prisma.dispute.count({
      where: {
        status: 'RESOLVED',
        ticket: { OR: [{ buyerPubkey: pubkey }, { sellerPubkey: pubkey }] },
      },
    }),
  ])

  return {
    reviews: reviews.map(r => ({
      stars: r.stars,
      reviewerIdentityLevel: reviewerLevelMap.get(r.reviewerPubkey) ?? 0,
    })),
    ticketsCompleted: completedAsSellerCount,
    ticketsAccepted: acceptedAsSellerCount,
    disputesLost,
    disputesParticipated,
    colPoints: user?.colPoints ?? 0,
    identityLevel: user?.identityLevel ?? 0,
  }
}
