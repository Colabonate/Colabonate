// Re-export of the pure reputation score computation function
// Available in both server (apps/server/services/reputationService.ts) and client (packages/utils)

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

  const completionRate = ticketsAccepted >= 5
    ? Math.min(ticketsCompleted / ticketsAccepted, 1.0)
    : 1.0

  const disputeLossRate = disputesParticipated >= 1
    ? Math.min(disputesLost / disputesParticipated, 1.0)
    : 0.0

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
