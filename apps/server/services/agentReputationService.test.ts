import { describe, it, expect } from 'vitest'
import { computeAgentReputationScore, ticketReputationWeight } from './agentReputationService.js'

describe('ticketReputationWeight', () => {
  it('matches the ADR-307 D5 examples (1k=1.0, 10k=2.0, 100k=3.0)', () => {
    expect(ticketReputationWeight(1000)).toBeCloseTo(1.0)
    expect(ticketReputationWeight(10000)).toBeCloseTo(2.0)
    expect(ticketReputationWeight(100000)).toBeCloseTo(3.0)
  })

  it('floors micro-ticket weight instead of going to zero or negative', () => {
    expect(ticketReputationWeight(100)).toBeCloseTo(0.1)
    expect(ticketReputationWeight(1)).toBeCloseTo(0.1)
  })

  it('defaults to 1.0 for missing or invalid amounts', () => {
    expect(ticketReputationWeight(null)).toBe(1.0)
    expect(ticketReputationWeight(undefined)).toBe(1.0)
    expect(ticketReputationWeight(0)).toBe(1.0)
    expect(ticketReputationWeight(-500)).toBe(1.0)
  })
})

describe('computeAgentReputationScore', () => {
  it('returns null for no reviews', () => {
    expect(computeAgentReputationScore([])).toBeNull()
  })

  it('returns null when reviews carry no dimension data at all', () => {
    expect(computeAgentReputationScore([{ weight: 1 }, { weight: 2 }])).toBeNull()
  })

  it('computes the D2 weighted composite for a single fully-rated review', () => {
    // 5*.30 + 5*.15 + 5*.25 + 5*.20 + 1*.10 = 1.5+.75+1.25+1.0+.10 = 4.6
    const score = computeAgentReputationScore([
      { accuracy: 5, speed: 5, reliability: 5, quality: 5, wouldReuse: true, weight: 1 },
    ])
    expect(score).toBeCloseTo(4.6)
  })

  it('weights reviews by ticket value (D5) — a 100k-sats review outweighs a 1k-sats one', () => {
    const score = computeAgentReputationScore([
      { accuracy: 1, weight: ticketReputationWeight(1000) },
      { accuracy: 5, weight: ticketReputationWeight(100000) },
    ])
    // weighted accuracy avg ≈ (1*1 + 5*3) / (1+3) = 16/4 = 4.0 → *0.30 = 1.2
    expect(score).toBeCloseTo(1.2, 1)
  })

  it('skips a dimension entirely absent across all reviews rather than scoring it as 0', () => {
    const withSpeed = computeAgentReputationScore([{ accuracy: 5, speed: 5, weight: 1 }])
    const withoutSpeed = computeAgentReputationScore([{ accuracy: 5, weight: 1 }])
    // accuracy contributes 5*.30=1.5 either way; speed adds 5*.15=.75 only when present
    expect(withoutSpeed).toBeCloseTo(1.5)
    expect(withSpeed).toBeCloseTo(2.25)
  })

  it('caps the score at 5.0', () => {
    const score = computeAgentReputationScore(
      Array.from({ length: 3 }, () => ({ accuracy: 5, speed: 5, reliability: 5, quality: 5, wouldReuse: true, weight: 1 }))
    )
    expect(score).toBeLessThanOrEqual(5.0)
  })
})
