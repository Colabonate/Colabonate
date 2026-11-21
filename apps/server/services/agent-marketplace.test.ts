import { describe, it, expect } from 'vitest'
import { computeSimilarityScore } from './agent-marketplace.js'

const base = { id: 'a', capabilities: ['research', 'writing'], minOfferPriceSats: 1000 }

describe('computeSimilarityScore', () => {
  it('is 1.0 for an identical agent with a common customer and equal price', () => {
    const score = computeSimilarityScore(base, { ...base, id: 'b' }, true)
    expect(score).toBeCloseTo(1.0)
  })

  it('is 0 for zero capability overlap, no common customer, no price data', () => {
    const score = computeSimilarityScore(base, { id: 'b', capabilities: ['legal'], minOfferPriceSats: null }, false)
    expect(score).toBe(0)
  })

  it('weights capability overlap (jaccard) at 0.6', () => {
    // overlap {research} of union {research, writing, legal} = 1/3
    const score = computeSimilarityScore(base, { id: 'b', capabilities: ['research', 'legal'], minOfferPriceSats: null }, false)
    expect(score).toBeCloseTo((1 / 3) * 0.6, 5)
  })

  it('adds 0.3 for a shared customer', () => {
    const withCommon = computeSimilarityScore(base, { ...base, id: 'b' }, true)
    const withoutCommon = computeSimilarityScore(base, { ...base, id: 'b' }, false)
    expect(withCommon - withoutCommon).toBeCloseTo(0.3, 5)
  })

  it('weights price proximity at 0.1, scaled by relative distance', () => {
    // price 1000 vs 500 -> proximity = 1 - |1000-500|/1000 = 0.5
    const score = computeSimilarityScore(base, { id: 'b', capabilities: [], minOfferPriceSats: 500 }, false)
    expect(score).toBeCloseTo(0.5 * 0.1, 5)
  })
})
