import type { PrismaClient } from '@prisma/client'
import { computeReputationScore, fetchReputationInput } from './reputationService.js'

// ADR-317 D2: multi-signal AgentProfile trust score (0.0-1.0), feeding ADR-307
// D3's `FinalScore = reputationScore × trustMultiplier`.
//
// Only two of the five documented signals are computable today without
// ADR-316's identity-delegation build-out: VerificationScore (from
// server-persisted AgentClaim rows, ADR-316 D2) and CompletionRate/
// DisputePenalty (from this agent's own ticket history). StakeWeight is
// Phase 2+ (FU-377) and always contributes 0 in V1.

// ADR-316 D2 attester-type weight table. 'customer' and — since ADR-315 D3's
// Foundation-admin verify workflow (2026-08-20, FU-414) — 'dao' are the only
// two written by this codebase in V1 (no agent-to-agent subcontracting yet).
// The other entries document the full spec for when those exist.
export const ATTESTER_WEIGHTS: Record<string, number> = {
  owner: 0.1,
  customer: 0.5,
  agent: 0.3,
  dao: 1.0,
}

const MIN_TICKETS_FOR_COMPLETION_RATE = 3

// ADR-317 D1/FU-414: a single Foundation AuditClaim (weight 1.0) alone caps
// VerificationScore, on top of whatever customer claims already contributed —
// a Foundation-audited agent doesn't need customer claims to reach the max.
export function computeVerificationScore(customerClaimCount: number, daoClaimCount = 0): number {
  return Math.min(customerClaimCount * ATTESTER_WEIGHTS.customer + daoClaimCount * ATTESTER_WEIGHTS.dao, 1.0)
}

// Fallback 1.0 (like reputationService's completion rate) until enough
// tickets exist to be a meaningful signal — an agent with 1 ticket shouldn't
// be penalized to 0 just because the sample size is tiny.
export function computeCompletionRate(completed: number, cancelled: number): number {
  const total = completed + cancelled
  return total >= MIN_TICKETS_FOR_COMPLETION_RATE ? completed / total : 1.0
}

export function computeDisputePenalty(disputesLost: number, disputesParticipated: number): number {
  const disputeRate = disputesParticipated >= 1 ? Math.min(disputesLost / disputesParticipated, 1.0) : 0.0
  return Math.max(1.0 - disputeRate * 2.0, 0.1)
}

export interface TrustScoreInput {
  verificationScore: number
  completionRate: number
  ownerReputationNormalized: number // 0-1 (ownerReputationScore / 5.0)
  stakeWeight: number // always 0 in V1 (FU-377, Phase 2+)
  disputePenalty: number
}

export function computeTrustScore(input: TrustScoreInput): number {
  const raw =
    input.verificationScore * 0.35 +
    input.completionRate * 0.25 +
    input.ownerReputationNormalized * 0.15 +
    input.stakeWeight * 0.10 +
    input.disputePenalty * 0.15
  return Math.round(Math.min(Math.max(raw, 0), 1.0) * 100) / 100
}

// ADR-307 D3: FinalScore = reputationScore × trustMultiplier. A null
// trustScore (not yet computed) is treated as an implicit 1.0 multiplier.
export function getAgentFinalScore(reputationScore: number | null | undefined, trustScore: number | null | undefined): number | null {
  if (reputationScore == null) return null
  return Math.round(reputationScore * (trustScore ?? 1.0) * 100) / 100
}

export async function recomputeTrustScore(agentProfileId: string, prisma: PrismaClient): Promise<number> {
  const agentProfile = await prisma.agentProfile.findUniqueOrThrow({ where: { id: agentProfileId } })

  // ADR-318: disputesParticipated/disputesLost are derived from the resolved
  // Dispute record itself, not from Ticket.status — the verdict routes
  // (dispute.ts, private-verdict.ts) write the terminal ticket status
  // straight to COMPLETED/CANCELLED and never touch the ARBITRATION_LOST/
  // ARBITRATION_WON values, so a status-filter here would always read 0.
  // The agent is always the seller side of an AGENT_SETUP ticket, so a
  // resolved dispute is a loss for the agent exactly when its outcome is
  // CANCEL (buyer refunded).
  // Counted in the DB rather than findMany+filter — an agent with a large
  // ticket history would otherwise load every historical ticket row into
  // memory on every single review submission just to compute two counts.
  const [customerClaimCount, daoClaimCount, completed, cancelled, disputesParticipated, disputesLost] = await Promise.all([
    prisma.agentClaim.count({ where: { agentProfileId, attesterType: 'customer' } }),
    prisma.agentClaim.count({ where: { agentProfileId, attesterType: 'dao' } }),
    prisma.ticket.count({ where: { offer: { agentProfileId }, status: 'COMPLETED' } }),
    prisma.ticket.count({ where: { offer: { agentProfileId }, status: 'CANCELLED' } }),
    prisma.dispute.count({ where: { status: 'RESOLVED', ticket: { offer: { agentProfileId } } } }),
    prisma.dispute.count({ where: { status: 'RESOLVED', outcome: 'CANCEL', ticket: { offer: { agentProfileId } } } }),
  ])

  const ownerReputationInput = await fetchReputationInput(agentProfile.ownerPubkey, prisma)
  const ownerReputationScore = computeReputationScore(ownerReputationInput)

  const trustScore = computeTrustScore({
    verificationScore: computeVerificationScore(customerClaimCount, daoClaimCount),
    completionRate: computeCompletionRate(completed, cancelled),
    ownerReputationNormalized: ownerReputationScore / 5.0,
    stakeWeight: 0,
    disputePenalty: computeDisputePenalty(disputesLost, disputesParticipated),
  })

  await prisma.agentProfile.update({ where: { id: agentProfileId }, data: { trustScore } })
  return trustScore
}
