import { describe, it, expect } from 'vitest'
import { applicationStillEligible, hasRequiredCapabilities, matchesSupervision, withinBudget } from './agent-task-matcher.js'

describe('hasRequiredCapabilities', () => {
  it('true when every required capability is present', () => {
    expect(hasRequiredCapabilities(['a', 'b'], ['a', 'b', 'c'])).toBe(true)
  })

  it('false when any required capability is missing', () => {
    expect(hasRequiredCapabilities(['a', 'd'], ['a', 'b', 'c'])).toBe(false)
  })

  it('true for an empty requirement list regardless of capabilities', () => {
    expect(hasRequiredCapabilities([], [])).toBe(true)
    expect(hasRequiredCapabilities([], ['a'])).toBe(true)
  })

  it('false when the agent has no capabilities at all', () => {
    expect(hasRequiredCapabilities(['a'], [])).toBe(false)
  })
})

describe('withinBudget', () => {
  it('true when price is at or under budget', () => {
    expect(withinBudget(1000, 1000)).toBe(true)
    expect(withinBudget(999, 1000)).toBe(true)
  })

  it('false when price exceeds budget', () => {
    expect(withinBudget(1001, 1000)).toBe(false)
  })
})

describe('matchesSupervision (FU-483)', () => {
  it('accepts any agent when no preference is set', () => {
    expect(matchesSupervision(null, true)).toBe(true)
    expect(matchesSupervision(null, false)).toBe(true)
  })
  it('requires a human-in-the-loop agent for HUMAN and an autonomous one for AUTONOMOUS', () => {
    expect(matchesSupervision('HUMAN', true)).toBe(true)
    expect(matchesSupervision('HUMAN', false)).toBe(false)
    expect(matchesSupervision('AUTONOMOUS', false)).toBe(true)
    expect(matchesSupervision('AUTONOMOUS', true)).toBe(false)
  })
})

describe('applicationStillEligible (ADR-397 / FU-870)', () => {
  const task = { requiredCapabilities: ['research'], budgetSats: 10_000, preferredSupervision: null as string | null }
  const app = { proposedPriceSats: 8_000 as number | null, offerPriceSats: 20_000, agentCapabilities: ['research', 'writing'], agentHumanInLoop: false }

  it('keeps an application that still fits', () => {
    expect(applicationStillEligible(task, app)).toBe(true)
  })
  it('drops it when the budget falls below the bid', () => {
    expect(applicationStillEligible({ ...task, budgetSats: 7_000 }, app)).toBe(false)
  })
  it('uses the listing price when no bid was stored', () => {
    expect(applicationStillEligible(task, { ...app, proposedPriceSats: null })).toBe(false)
  })
  it('drops it when a new capability is required', () => {
    expect(applicationStillEligible({ ...task, requiredCapabilities: ['research', 'design'] }, app)).toBe(false)
  })
  it('drops it when the supervision preference changes against the agent', () => {
    expect(applicationStillEligible({ ...task, preferredSupervision: 'HUMAN' }, app)).toBe(false)
  })
})
