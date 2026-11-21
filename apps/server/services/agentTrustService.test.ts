import { describe, it, expect } from 'vitest'
import { computeTrustScore, computeVerificationScore, computeCompletionRate, computeDisputePenalty, getAgentFinalScore } from './agentTrustService.js'

describe('computeVerificationScore', () => {
  it('weights each customer claim at 0.5 (ADR-316 D2), capped at 1.0', () => {
    expect(computeVerificationScore(0)).toBe(0)
    expect(computeVerificationScore(1)).toBeCloseTo(0.5)
    expect(computeVerificationScore(2)).toBeCloseTo(1.0)
    expect(computeVerificationScore(10)).toBe(1.0)
  })

  it('a single Foundation AuditClaim (weight 1.0) alone caps the score (ADR-317 D1/FU-414)', () => {
    expect(computeVerificationScore(0, 1)).toBe(1.0)
    expect(computeVerificationScore(0, 0)).toBe(0)
  })

  it('customer and dao claims add before the cap', () => {
    expect(computeVerificationScore(1, 1)).toBeCloseTo(1.0) // 0.5 + 1.0, capped
    expect(computeVerificationScore(0, 0)).toBe(0)
  })

  it('defaults daoClaimCount to 0 when omitted', () => {
    expect(computeVerificationScore(1)).toBe(computeVerificationScore(1, 0))
  })
})

describe('computeCompletionRate', () => {
  it('falls back to 1.0 below the minimum sample size', () => {
    expect(computeCompletionRate(1, 0)).toBe(1.0)
    expect(computeCompletionRate(0, 1)).toBe(1.0)
  })

  it('computes the real ratio once enough tickets exist', () => {
    expect(computeCompletionRate(2, 1)).toBeCloseTo(2 / 3)
    expect(computeCompletionRate(3, 0)).toBe(1.0)
    expect(computeCompletionRate(0, 3)).toBe(0)
  })
})

describe('computeDisputePenalty', () => {
  it('is 1.0 with no disputes', () => {
    expect(computeDisputePenalty(0, 0)).toBe(1.0)
  })

  it('floors at 0.1 even for a 100% dispute-loss rate', () => {
    expect(computeDisputePenalty(5, 5)).toBeCloseTo(0.1)
  })

  it('applies the ×2.0 penalty multiplier', () => {
    // disputeRate = 1/4 = .25 → penalty = 1 - .25*2 = .5
    expect(computeDisputePenalty(1, 4)).toBeCloseTo(0.5)
  })
})

describe('computeTrustScore', () => {
  it('returns 1.0 when every signal is maxed', () => {
    const score = computeTrustScore({
      verificationScore: 1, completionRate: 1, ownerReputationNormalized: 1, stakeWeight: 1, disputePenalty: 1,
    })
    expect(score).toBe(1.0)
  })

  it('returns 0 when every signal is 0', () => {
    const score = computeTrustScore({
      verificationScore: 0, completionRate: 0, ownerReputationNormalized: 0, stakeWeight: 0, disputePenalty: 0,
    })
    expect(score).toBe(0)
  })

  it('weights signals per the ADR-317 D2 formula', () => {
    // verification .35 + completion .25*.5 + owner .15*.5 + dispute .15*.5, stake 0
    const score = computeTrustScore({
      verificationScore: 1, completionRate: 0.5, ownerReputationNormalized: 0.5, stakeWeight: 0, disputePenalty: 0.5,
    })
    expect(score).toBeCloseTo(0.35 + 0.125 + 0.075 + 0.075, 2)
  })
})

describe('getAgentFinalScore', () => {
  it('treats a missing trustScore as an implicit 1.0 multiplier (ADR-307 D3 fallback)', () => {
    expect(getAgentFinalScore(4.6, null)).toBe(4.6)
    expect(getAgentFinalScore(4.6, undefined)).toBe(4.6)
  })

  it('multiplies reputationScore by trustScore', () => {
    expect(getAgentFinalScore(4.0, 0.5)).toBe(2.0)
  })

  it('returns null when there is no reputation score yet', () => {
    expect(getAgentFinalScore(null, 0.8)).toBeNull()
  })
})
