import type { PrismaClient } from '@prisma/client'
import { normalizeCapability } from '../lib/capability-normalize.js'

// ADR-310 D1/D4: multi-agent orchestration. D1 (template schema validation)
// + D4 (capability-ranked agent matching per step). D2 steps 1-4 (template
// select → match → confirm → Cooperation+CoopMilestone creation) are wired
// via POST /api/cooperations (index.ts). D2 steps 5-6 (Canister-run pipeline,
// step-to-step output handoff) and D3 (canister-internal agent messaging)
// are NOT built — the ADR-311 Workspace-Canister runtime (FU-434) is a
// single-agent-per-workspace harness with no multi-step handoff protocol;
// see FOLLOWUPS.md FU-452. D5 dynamic orchestration is ADR-319 (separate,
// already implemented). D6 (live in-chat orchestrator role) is blocked on
// ADR-314 — see FU-441.

const TOP_N_PER_STEP = 3
const MAX_STEPS = 20

export interface OrchestrationStep {
  order: number
  title: string
  requiredAgentCapabilities: string[]
  inputFromStep: number | null
  outputToSteps: number[]
}

// D1: shape + referential validation (order uniqueness, inputFromStep /
// outputToSteps must reference an order that exists in the same pipeline) —
// catches an author typo (e.g. step order 3 referencing a non-existent step
// 4) at template save time instead of silently producing a dead-end step.
export function validateOrchestrationSteps(raw: unknown): { steps: OrchestrationStep[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'orchestrationSteps must be a non-empty array' }
  if (raw.length > MAX_STEPS) return { error: `orchestrationSteps must not exceed ${MAX_STEPS} entries` }

  const steps: OrchestrationStep[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return { error: 'each orchestration step must be an object' }
    const s = entry as Record<string, unknown>
    if (typeof s.order !== 'number' || !Number.isInteger(s.order) || s.order < 1) return { error: 'step.order must be a positive integer' }
    if (typeof s.title !== 'string' || !s.title.trim()) return { error: 'step.title is required' }
    if (!Array.isArray(s.requiredAgentCapabilities) || s.requiredAgentCapabilities.length === 0 || !s.requiredAgentCapabilities.every((c: unknown) => typeof c === 'string' && c.trim())) {
      return { error: 'step.requiredAgentCapabilities must be a non-empty array of strings' }
    }
    if (s.inputFromStep !== null && (typeof s.inputFromStep !== 'number' || !Number.isInteger(s.inputFromStep))) {
      return { error: 'step.inputFromStep must be a step order number or null' }
    }
    if (!Array.isArray(s.outputToSteps) || !s.outputToSteps.every((o: unknown) => typeof o === 'number' && Number.isInteger(o))) {
      return { error: 'step.outputToSteps must be an array of step order numbers' }
    }
    steps.push({
      order: s.order,
      title: s.title.trim(),
      requiredAgentCapabilities: s.requiredAgentCapabilities.map(c => normalizeCapability(c as string)).filter(Boolean),
      inputFromStep: s.inputFromStep as number | null,
      outputToSteps: s.outputToSteps as number[],
    })
  }

  const orders = new Set(steps.map(s => s.order))
  if (orders.size !== steps.length) return { error: 'step.order values must be unique' }
  for (const step of steps) {
    if (step.inputFromStep !== null && !orders.has(step.inputFromStep)) return { error: `step ${step.order}: inputFromStep ${step.inputFromStep} does not reference an existing step` }
    if (step.outputToSteps.some(o => !orders.has(o))) return { error: `step ${step.order}: outputToSteps references a step order that does not exist` }
    if (step.requiredAgentCapabilities.length === 0) return { error: `step ${step.order}: requiredAgentCapabilities normalized to nothing` }
  }

  return { steps: steps.sort((a, b) => a.order - b.order) }
}

// ADR-352 D1a: AgentProfile↔Offer is many-to-one (an agent can back several
// AGENT_SETUP offers at different price points/configs) — CoopMilestone(Step)
// need a companion assigneeOfferId to identify the *specific* offer booked,
// since that's what the execution Workspace (ADR-352 D1) anchors to. This
// pure helper collects every (agentProfileId, offerId) pair declared across
// milestones + nested steps for POST /api/cooperations to validate against
// the DB in one query; an offerId declared without an agentProfileId has
// nothing to check ownership against and is returned separately so the
// caller can 400 without a round trip.
export interface MilestoneAssigneePair {
  assigneeAgentProfileId?: string | null
  assigneeOfferId?: string | null
}
export interface MilestoneAssigneeInput extends MilestoneAssigneePair {
  steps?: MilestoneAssigneePair[]
}

export function collectAssigneeOfferPairs(milestones: MilestoneAssigneeInput[]): {
  pairs: Array<{ agentProfileId: string; offerId: string }>
  orphaned: string[]
} {
  const entries: MilestoneAssigneePair[] = []
  for (const m of milestones) {
    entries.push(m)
    if (Array.isArray(m.steps)) entries.push(...m.steps)
  }
  const pairs: Array<{ agentProfileId: string; offerId: string }> = []
  const orphaned: string[] = []
  for (const e of entries) {
    if (!e.assigneeOfferId) continue
    if (e.assigneeAgentProfileId) {
      pairs.push({ agentProfileId: e.assigneeAgentProfileId, offerId: e.assigneeOfferId })
    } else {
      orphaned.push(e.assigneeOfferId)
    }
  }
  return { pairs, orphaned }
}

export interface OrchestrationCandidate {
  agentProfileId: string
  reputationScore: number | null
  minOfferPriceSats: number | null
}

const DEFAULT_REPUTATION = 2.5
const MAX_REPUTATION = 5

// D4 ranking, gated on candidates already guaranteed to hold every required
// capability (the DB query in matchAgentsToOrchestration does that via
// hasEvery — this stays pure/testable and only ranks). reputationScore
// dominates (agents without any review yet get a neutral mid-score, not a
// last-place 0); priceRelevance is a relative, pool-local cheapest-wins
// signal (min-max normalized), not a hard budget cutoff — orchestrationSteps
// carries no per-step budget field to cut against.
export function rankOrchestrationCandidates(candidates: OrchestrationCandidate[]): Array<OrchestrationCandidate & { score: number }> {
  const prices = candidates.map(c => c.minOfferPriceSats).filter((p): p is number => p != null)
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0
  const priceRange = maxPrice - minPrice

  const scored = candidates.map(c => {
    const reputationFactor = (c.reputationScore ?? DEFAULT_REPUTATION) / MAX_REPUTATION
    const priceRelevance = c.minOfferPriceSats == null
      ? 0.5
      : priceRange > 0
        ? 1 - (c.minOfferPriceSats - minPrice) / priceRange
        : 1
    return { ...c, score: reputationFactor * priceRelevance }
  })

  return scored.sort((a, b) => b.score - a.score)
}

export interface OrchestrationStepMatch {
  step: OrchestrationStep
  candidates: Array<{ agentProfileId: string; name: string; avatarUrl: string | null; reputationScore: number | null; minOfferPriceSats: number | null; cheapestOfferId: string | null; score: number }>
}

// D4 steps 1-3: for each step, load public AgentProfiles holding every
// required capability (Postgres hasEvery — requires the query-side
// capabilities to already be normalized, same as write-side ADR-320 D1),
// rank, return the top-N per step for the buyer to review/override (D4
// step 4 override stays a client concern — no server enforcement of the pick).
//
// ADR-352 D1a (FU-606): AgentProfile<->Offer is many-to-one, and the
// execution Workspace anchors to a specific Offer, not just the profile — so
// each candidate also carries its cheapest matching Offer's id (the same
// "cheapest wins" signal already used for ranking, just surfaced as a
// concrete id instead of a bare price) for the client to send back as
// assigneeOfferId. Fetches full offer rows instead of Prisma's groupBy(_min)
// because groupBy's aggregate cannot return the winning row's own id.
export async function matchAgentsToOrchestration(prisma: PrismaClient, steps: OrchestrationStep[]): Promise<OrchestrationStepMatch[]> {
  const results: OrchestrationStepMatch[] = []
  for (const step of steps) {
    const profiles = await prisma.agentProfile.findMany({
      where: { isPublic: true, capabilities: { hasEvery: step.requiredAgentCapabilities } },
      select: { id: true, name: true, avatarUrl: true, reputationScore: true },
    })
    if (profiles.length === 0) {
      results.push({ step, candidates: [] })
      continue
    }

    const offers = await prisma.offer.findMany({
      where: { agentProfileId: { in: profiles.map(p => p.id) }, offerType: 'AGENT_SETUP', status: 'ACTIVE' },
      select: { id: true, agentProfileId: true, priceSats: true },
      orderBy: { priceSats: 'asc' },
    })
    const cheapestOfferByProfile = new Map<string, { id: string; priceSats: number }>()
    for (const o of offers) {
      if (!o.agentProfileId || cheapestOfferByProfile.has(o.agentProfileId)) continue // first hit per profile is the cheapest (orderBy asc)
      cheapestOfferByProfile.set(o.agentProfileId, { id: o.id, priceSats: o.priceSats })
    }

    const ranked = rankOrchestrationCandidates(profiles.map(p => ({
      agentProfileId: p.id,
      reputationScore: p.reputationScore,
      minOfferPriceSats: cheapestOfferByProfile.get(p.id)?.priceSats ?? null,
    })))

    const profileById = new Map(profiles.map(p => [p.id, p]))
    results.push({
      step,
      candidates: ranked.slice(0, TOP_N_PER_STEP).map(r => ({
        agentProfileId: r.agentProfileId,
        name: profileById.get(r.agentProfileId)!.name,
        avatarUrl: profileById.get(r.agentProfileId)!.avatarUrl,
        reputationScore: r.reputationScore,
        minOfferPriceSats: r.minOfferPriceSats,
        cheapestOfferId: cheapestOfferByProfile.get(r.agentProfileId)?.id ?? null,
        score: r.score,
      })),
    })
  }
  return results
}
