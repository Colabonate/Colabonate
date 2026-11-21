import { describe, it, expect } from 'vitest'
import { validateOrchestrationSteps, rankOrchestrationCandidates } from './agent-orchestration.js'

describe('validateOrchestrationSteps', () => {
  const validPipeline = [
    { order: 1, title: 'Market Analysis', requiredAgentCapabilities: ['text-generation', 'data-analysis'], inputFromStep: null, outputToSteps: [2, 3] },
    { order: 2, title: 'Copywriting', requiredAgentCapabilities: ['text-generation'], inputFromStep: 1, outputToSteps: [3] },
    { order: 3, title: 'Visual Assets', requiredAgentCapabilities: ['image-generation'], inputFromStep: 2, outputToSteps: [] },
  ]

  it('accepts a valid pipeline and normalizes + sorts by order', () => {
    const result = validateOrchestrationSteps([validPipeline[2], validPipeline[0], validPipeline[1]])
    if ('error' in result) throw new Error(`expected success, got: ${result.error}`)
    expect(result.steps.map(s => s.order)).toEqual([1, 2, 3])
    expect(result.steps[0].requiredAgentCapabilities).toEqual(['text-generation', 'data-analysis'])
  })

  it('normalizes capability casing/spacing', () => {
    const result = validateOrchestrationSteps([{ order: 1, title: 'Step', requiredAgentCapabilities: ['Text Generation'], inputFromStep: null, outputToSteps: [] }])
    if ('error' in result) throw new Error(`expected success, got: ${result.error}`)
    expect(result.steps[0].requiredAgentCapabilities).toEqual(['text-generation'])
  })

  it('rejects an empty array', () => {
    const result = validateOrchestrationSteps([])
    expect('error' in result).toBe(true)
  })

  it('rejects non-array input', () => {
    const result = validateOrchestrationSteps('not an array')
    expect('error' in result).toBe(true)
  })

  it('rejects a step missing requiredAgentCapabilities', () => {
    const result = validateOrchestrationSteps([{ order: 1, title: 'x', requiredAgentCapabilities: [], inputFromStep: null, outputToSteps: [] }])
    expect('error' in result).toBe(true)
  })

  it('rejects duplicate order values', () => {
    const result = validateOrchestrationSteps([
      { order: 1, title: 'a', requiredAgentCapabilities: ['x'], inputFromStep: null, outputToSteps: [] },
      { order: 1, title: 'b', requiredAgentCapabilities: ['y'], inputFromStep: null, outputToSteps: [] },
    ])
    expect('error' in result).toBe(true)
  })

  it('rejects inputFromStep referencing a non-existent step', () => {
    const result = validateOrchestrationSteps([{ order: 1, title: 'a', requiredAgentCapabilities: ['x'], inputFromStep: 99, outputToSteps: [] }])
    expect('error' in result).toBe(true)
  })

  it('rejects outputToSteps referencing a non-existent step', () => {
    const result = validateOrchestrationSteps([{ order: 1, title: 'a', requiredAgentCapabilities: ['x'], inputFromStep: null, outputToSteps: [99] }])
    expect('error' in result).toBe(true)
  })

  it('rejects a capability that normalizes to nothing', () => {
    const result = validateOrchestrationSteps([{ order: 1, title: 'a', requiredAgentCapabilities: ['!!!'], inputFromStep: null, outputToSteps: [] }])
    expect('error' in result).toBe(true)
  })
})

describe('rankOrchestrationCandidates', () => {
  it('ranks higher reputation above lower reputation at equal price', () => {
    const ranked = rankOrchestrationCandidates([
      { agentProfileId: 'low', reputationScore: 2, minOfferPriceSats: 1000 },
      { agentProfileId: 'high', reputationScore: 4.5, minOfferPriceSats: 1000 },
    ])
    expect(ranked[0].agentProfileId).toBe('high')
  })

  it('ranks cheaper above pricier at equal reputation', () => {
    const ranked = rankOrchestrationCandidates([
      { agentProfileId: 'expensive', reputationScore: 4, minOfferPriceSats: 10000 },
      { agentProfileId: 'cheap', reputationScore: 4, minOfferPriceSats: 1000 },
    ])
    expect(ranked[0].agentProfileId).toBe('cheap')
  })

  it('treats a null reputationScore as the neutral default, not zero', () => {
    const ranked = rankOrchestrationCandidates([
      { agentProfileId: 'unrated', reputationScore: null, minOfferPriceSats: 1000 },
      { agentProfileId: 'bad', reputationScore: 0.5, minOfferPriceSats: 1000 },
    ])
    expect(ranked[0].agentProfileId).toBe('unrated')
  })

  it('gives every candidate score 1 for price relevance when all prices are equal', () => {
    const ranked = rankOrchestrationCandidates([
      { agentProfileId: 'a', reputationScore: 5, minOfferPriceSats: 500 },
      { agentProfileId: 'b', reputationScore: 5, minOfferPriceSats: 500 },
    ])
    expect(ranked[0].score).toBeCloseTo(1, 5)
    expect(ranked[1].score).toBeCloseTo(1, 5)
  })

  it('handles a single candidate without dividing by zero', () => {
    const ranked = rankOrchestrationCandidates([{ agentProfileId: 'solo', reputationScore: 3, minOfferPriceSats: 2000 }])
    expect(ranked).toHaveLength(1)
    expect(Number.isFinite(ranked[0].score)).toBe(true)
  })
})
