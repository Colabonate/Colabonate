import type { PrismaClient } from '@prisma/client'

// ADR-307 D2/D5: composite AGENT_SETUP reputation score.
//
// Mirrors the shape of reputationService.ts (human ReputationScore) but scores
// an AgentProfile from its AgentReviewMetrics instead of a User from its
// Review stars. D3 (trust-weight multiplier from ADR-317) is not applied here
// — ADR-317 is not built yet (FU-352 tracks wiring it in later).

export interface AgentReviewMetricInput {
  accuracy?: number | null
  speed?: number | null
  reliability?: number | null
  quality?: number | null
  wouldReuse?: boolean | null
  // D5: log10(ticket.amountSats / 1000) — 1k sats = 1.0, 10k = 2.0, 100k = 3.0.
  // Floored (not zero/negative) so a single micro-ticket review can't ever
  // fully cancel out a real review; missing/invalid amounts default to 1.0.
  weight: number
}

const DIMENSION_WEIGHTS: Array<[keyof Pick<AgentReviewMetricInput, 'accuracy' | 'speed' | 'reliability' | 'quality'>, number]> = [
  ['accuracy', 0.30],
  ['speed', 0.15],
  ['reliability', 0.25],
  ['quality', 0.20],
]
const WOULD_REUSE_WEIGHT = 0.10

export function ticketReputationWeight(amountSats: number | null | undefined): number {
  if (!amountSats || amountSats <= 0) return 1.0
  // ADR-307 D5 gives `log10(amountSats / 1000)` as the formula text but its own
  // worked examples (1k=1.0, 10k=2.0, 100k=3.0) only hold with a +1 offset
  // (log10(1000/1000)=0, not 1) — implemented to match the examples, which are
  // the actual intended weighting.
  return Math.max(1 + Math.log10(amountSats / 1000), 0.1)
}

function weightedAverage(items: AgentReviewMetricInput[], pick: (i: AgentReviewMetricInput) => number | null | undefined): number | null {
  let totalWeight = 0
  let weightedSum = 0
  for (const item of items) {
    const value = pick(item)
    if (value == null) continue
    totalWeight += item.weight
    weightedSum += value * item.weight
  }
  return totalWeight > 0 ? weightedSum / totalWeight : null
}

// Composite score per ADR-307 D2. Dimensions with no data across all reviews
// simply contribute nothing (not renormalized) — the literal documented
// formula, kept simple since reviewers are expected to rate all dimensions
// together via the review form.
export function computeAgentReputationScore(items: AgentReviewMetricInput[]): number | null {
  if (items.length === 0) return null

  let score = 0
  let anyDimensionPresent = false

  for (const [key, weight] of DIMENSION_WEIGHTS) {
    const avg = weightedAverage(items, i => i[key])
    if (avg == null) continue
    score += avg * weight
    anyDimensionPresent = true
  }

  const wouldReuseRatio = weightedAverage(items, i => (i.wouldReuse == null ? null : i.wouldReuse ? 1 : 0))
  if (wouldReuseRatio != null) {
    score += wouldReuseRatio * WOULD_REUSE_WEIGHT
    anyDimensionPresent = true
  }

  if (!anyDimensionPresent) return null
  return Math.round(Math.min(score, 5.0) * 100) / 100
}

// Recomputes and caches AgentProfile.reputationScore from every review left
// on tickets for that agent's offers. Call after creating an AgentReviewMetrics row.
export async function recomputeAgentReputationScore(agentProfileId: string, prisma: PrismaClient): Promise<number | null> {
  const reviews = await prisma.review.findMany({
    where: { ticket: { offer: { agentProfileId } } },
    include: { agentMetrics: true, ticket: { select: { amountSats: true } } },
  })

  const items: AgentReviewMetricInput[] = reviews
    .filter(r => r.agentMetrics)
    .map(r => ({
      accuracy: r.agentMetrics!.accuracy,
      speed: r.agentMetrics!.speed,
      reliability: r.agentMetrics!.reliability,
      quality: r.agentMetrics!.quality,
      wouldReuse: r.agentMetrics!.wouldReuse,
      weight: ticketReputationWeight(r.ticket?.amountSats),
    }))

  const score = computeAgentReputationScore(items)
  await prisma.agentProfile.update({ where: { id: agentProfileId }, data: { reputationScore: score } })
  return score
}
