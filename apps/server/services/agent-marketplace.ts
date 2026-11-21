import type { PrismaClient, Ticket } from '@prisma/client'

// ADR-320: Network Effects — D2 (similar agents), D4 (early-booking COL-Points
// bonus), D5 (ecosystem stats). D1 (capability normalization) lives in
// lib/capability-normalize.ts; D3 (cross-agent context sharing) and D6
// (protocol-openness claims) are not built — see FOLLOWUPS.md.

const DEFAULT_ROOKIE_BOOKING_BONUS_LIMIT = 10
const STANDARD_MUTUAL_REVIEW_BONUS = 3
const ROOKIE_MUTUAL_REVIEW_BONUS = 5

export interface SimilarityCandidate {
  id: string
  capabilities: string[]
  minOfferPriceSats: number | null
}

// D2: Jaccard capability overlap (0.6) + a shared-customer signal (0.3) +
// price-range proximity (0.1). Weighted so capability match dominates —
// the other two signals are ADR-320's own tie-breakers, not the primary axis.
export function computeSimilarityScore(
  target: SimilarityCandidate,
  candidate: SimilarityCandidate,
  hasCommonCustomer: boolean
): number {
  const targetSet = new Set(target.capabilities)
  const candidateSet = new Set(candidate.capabilities)
  const intersectionSize = [...targetSet].filter(c => candidateSet.has(c)).length
  const unionSize = new Set([...targetSet, ...candidateSet]).size
  const jaccard = unionSize > 0 ? intersectionSize / unionSize : 0

  let priceProximity = 0
  if (target.minOfferPriceSats != null && candidate.minOfferPriceSats != null) {
    const maxPrice = Math.max(target.minOfferPriceSats, candidate.minOfferPriceSats)
    priceProximity = maxPrice > 0 ? 1 - Math.abs(target.minOfferPriceSats - candidate.minOfferPriceSats) / maxPrice : 1
  }

  return jaccard * 0.6 + (hasCommonCustomer ? 0.3 : 0) + priceProximity * 0.1
}

export interface SimilarAgentResult {
  // ADR-315 D3: isVerified + verifiedAt surface here so the badge renders on
  // agent recommendation cards.
  agentProfile: {
    id: string
    name: string
    avatarUrl: string | null
    reputationScore: number | null
    trustScore: number | null
    capabilities: string[]
    isVerified: boolean
    verifiedAt: Date | null
  }
  score: number
}

export async function findSimilarAgentProfiles(prisma: PrismaClient, agentProfileId: string, limit = 6): Promise<SimilarAgentResult[]> {
  const target = await prisma.agentProfile.findUnique({ where: { id: agentProfileId }, select: { capabilities: true } })
  if (!target || target.capabilities.length === 0) return []

  const candidates = await prisma.agentProfile.findMany({
    where: { id: { not: agentProfileId }, isPublic: true, capabilities: { hasSome: target.capabilities } },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      reputationScore: true,
      trustScore: true,
      capabilities: true,
      // ADR-315 D3: badge fields surface on the public recommendation card.
      isVerified: true,
      verifiedAt: true,
    },
    take: 50,
  })
  if (candidates.length === 0) return []

  const involvedIds = [agentProfileId, ...candidates.map(c => c.id)]
  const priceRows = await prisma.offer.groupBy({
    by: ['agentProfileId'],
    where: { agentProfileId: { in: involvedIds }, offerType: 'AGENT_SETUP', status: 'ACTIVE' },
    _min: { priceSats: true },
  })
  const minPriceByProfile = new Map(priceRows.map(r => [r.agentProfileId as string, r._min.priceSats]))

  const targetOffers = await prisma.offer.findMany({
    where: { agentProfileId, offerType: 'AGENT_SETUP' },
    select: { tickets: { where: { status: 'COMPLETED' }, select: { buyerPubkey: true } } },
  })
  const targetCustomers = new Set(targetOffers.flatMap(o => o.tickets.map(t => t.buyerPubkey)))

  const scored: SimilarAgentResult[] = []
  for (const candidate of candidates) {
    let hasCommonCustomer = false
    if (targetCustomers.size > 0) {
      const candidateOffers = await prisma.offer.findMany({
        where: { agentProfileId: candidate.id, offerType: 'AGENT_SETUP' },
        select: { tickets: { where: { status: 'COMPLETED' }, select: { buyerPubkey: true } } },
      })
      hasCommonCustomer = candidateOffers.some(o => o.tickets.some(t => targetCustomers.has(t.buyerPubkey)))
    }

    const score = computeSimilarityScore(
      { id: agentProfileId, capabilities: target.capabilities, minOfferPriceSats: minPriceByProfile.get(agentProfileId) ?? null },
      { id: candidate.id, capabilities: candidate.capabilities, minOfferPriceSats: minPriceByProfile.get(candidate.id) ?? null },
      hasCommonCustomer
    )
    scored.push({ agentProfile: candidate, score })
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

// D4: "erste 10 Bookings eines neuen Agent-Setups" — the only COL-Points
// award that actually fires for a direct-pay AGENT_SETUP ticket is the
// mutual-review bonus in reviews.ts (the milestone-completion bonus in
// index.ts only fires for cooperation-milestone tickets, never SMART_ORDER).
// "Booking" is interpreted here as a COMPLETED ticket for the same offer,
// counted at the moment this review's mutual-reward fires.
export async function resolveMutualReviewBonus(prisma: PrismaClient, ticket: Pick<Ticket, 'offerType' | 'offerId'>): Promise<number> {
  if (ticket.offerType !== 'AGENT_SETUP' || !ticket.offerId) return STANDARD_MUTUAL_REVIEW_BONUS
  const completedCount = await prisma.ticket.count({ where: { offerId: ticket.offerId, status: 'COMPLETED' } })
  return completedCount <= DEFAULT_ROOKIE_BOOKING_BONUS_LIMIT ? ROOKIE_MUTUAL_REVIEW_BONUS : STANDARD_MUTUAL_REVIEW_BONUS
}

export interface AgentMarketplaceStats {
  activeAgentSetupCount: number
  averageReputationScore: number | null
  topCapabilities: Array<{ capability: string; count: number }>
  completedAgentTicketCount: number
  averageTimeToCompletionHours: number | null
}

// D5: public ecosystem KPIs. Dashboard UI is a separate follow-up (FU-387) —
// this is the read-only aggregation endpoint it would consume.
export async function computeAgentMarketplaceStats(prisma: PrismaClient): Promise<AgentMarketplaceStats> {
  const [activeAgentSetupCount, avgReputation, completedTickets, publicProfiles] = await Promise.all([
    prisma.offer.count({ where: { offerType: 'AGENT_SETUP', status: 'ACTIVE' } }),
    prisma.agentProfile.aggregate({ where: { reputationScore: { not: null } }, _avg: { reputationScore: true } }),
    prisma.ticket.findMany({ where: { offerType: 'AGENT_SETUP', status: 'COMPLETED' }, select: { createdAt: true, updatedAt: true, deliveryConfirmedAt: true } }),
    prisma.agentProfile.findMany({ where: { isPublic: true }, select: { capabilities: true } }),
  ])

  const durationsMs = completedTickets.map(t => (t.deliveryConfirmedAt ?? t.updatedAt).getTime() - t.createdAt.getTime())
  const averageTimeToCompletionHours = durationsMs.length > 0
    ? durationsMs.reduce((sum, ms) => sum + ms, 0) / durationsMs.length / 3_600_000
    : null

  const capabilityCounts = new Map<string, number>()
  for (const profile of publicProfiles) {
    for (const capability of profile.capabilities) {
      capabilityCounts.set(capability, (capabilityCounts.get(capability) ?? 0) + 1)
    }
  }
  const topCapabilities = [...capabilityCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([capability, count]) => ({ capability, count }))

  return {
    activeAgentSetupCount,
    averageReputationScore: avgReputation._avg.reputationScore,
    topCapabilities,
    completedAgentTicketCount: completedTickets.length,
    averageTimeToCompletionHours,
  }
}
