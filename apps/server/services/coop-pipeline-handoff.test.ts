// ADR-352 D1 (FU-607): pure-function tests for cross-agent handoff detection
// + last-assistant-reply extraction, plus a fake-canister-client integration
// test for the orchestration function itself.
import { describe, expect, it, vi } from 'vitest'
import { extractLastAssistantReply, findHandoffSourceOfferId, seedHandoffContextIfApplicable, type PipelineStepRef } from './coop-pipeline-handoff.js'

describe('findHandoffSourceOfferId', () => {
  it('finds the preceding step assigned to a different offer', () => {
    const steps: PipelineStepRef[] = [
      { milestoneIndex: 1, stepIndex: 1, assigneeOfferId: 'offer-a' },
      { milestoneIndex: 1, stepIndex: 2, assigneeOfferId: 'offer-b' },
    ]
    expect(findHandoffSourceOfferId(steps, 'offer-b')).toBe('offer-a')
  })

  it('crosses milestone boundaries in global (milestoneIndex, stepIndex) order', () => {
    const steps: PipelineStepRef[] = [
      { milestoneIndex: 1, stepIndex: 1, assigneeOfferId: 'offer-a' },
      { milestoneIndex: 2, stepIndex: 1, assigneeOfferId: 'offer-b' },
    ]
    expect(findHandoffSourceOfferId(steps, 'offer-b')).toBe('offer-a')
  })

  it('returns null when the same agent continues across consecutive steps (no boundary)', () => {
    const steps: PipelineStepRef[] = [
      { milestoneIndex: 1, stepIndex: 1, assigneeOfferId: 'offer-a' },
      { milestoneIndex: 1, stepIndex: 2, assigneeOfferId: 'offer-a' },
    ]
    expect(findHandoffSourceOfferId(steps, 'offer-a')).toBeNull()
  })

  it('returns null for the very first step in the whole pipeline', () => {
    const steps: PipelineStepRef[] = [
      { milestoneIndex: 1, stepIndex: 1, assigneeOfferId: 'offer-a' },
      { milestoneIndex: 1, stepIndex: 2, assigneeOfferId: 'offer-b' },
    ]
    expect(findHandoffSourceOfferId(steps, 'offer-a')).toBeNull()
  })

  it('returns null when the preceding step is unassigned', () => {
    const steps: PipelineStepRef[] = [
      { milestoneIndex: 1, stepIndex: 1, assigneeOfferId: null },
      { milestoneIndex: 1, stepIndex: 2, assigneeOfferId: 'offer-b' },
    ]
    expect(findHandoffSourceOfferId(steps, 'offer-b')).toBeNull()
  })

  it('returns null when the target offer never appears', () => {
    const steps: PipelineStepRef[] = [{ milestoneIndex: 1, stepIndex: 1, assigneeOfferId: 'offer-a' }]
    expect(findHandoffSourceOfferId(steps, 'offer-z')).toBeNull()
  })

  it('uses only the FIRST occurrence of the target offer when it holds several consecutive steps', () => {
    const steps: PipelineStepRef[] = [
      { milestoneIndex: 1, stepIndex: 1, assigneeOfferId: 'offer-a' },
      { milestoneIndex: 1, stepIndex: 2, assigneeOfferId: 'offer-b' },
      { milestoneIndex: 1, stepIndex: 3, assigneeOfferId: 'offer-b' },
    ]
    // The 3rd step (also offer-b) must not report offer-b as its own predecessor.
    expect(findHandoffSourceOfferId(steps, 'offer-b')).toBe('offer-a')
  })
})

describe('extractLastAssistantReply', () => {
  it('returns the most recent assistant chat content', () => {
    const outputs = [
      { outputType: 'chat', metadata: JSON.stringify({ role: 'user', content: 'hi' }) },
      { outputType: 'chat', metadata: JSON.stringify({ role: 'assistant', content: 'first reply' }) },
      { outputType: 'chat', metadata: JSON.stringify({ role: 'user', content: 'more' }) },
      { outputType: 'chat', metadata: JSON.stringify({ role: 'assistant', content: 'final reply' }) },
    ]
    expect(extractLastAssistantReply(outputs)).toBe('final reply')
  })

  it('skips non-chat outputs (e.g. tool results)', () => {
    const outputs = [
      { outputType: 'chat', metadata: JSON.stringify({ role: 'assistant', content: 'reply' }) },
      { outputType: 'tool', metadata: JSON.stringify({ role: 'assistant', content: 'should be ignored' }) },
    ]
    expect(extractLastAssistantReply(outputs)).toBe('reply')
  })

  it('returns null when there is no assistant output', () => {
    expect(extractLastAssistantReply([{ outputType: 'chat', metadata: JSON.stringify({ role: 'user', content: 'hi' }) }])).toBeNull()
    expect(extractLastAssistantReply([])).toBeNull()
  })

  it('never throws on malformed metadata, just skips it', () => {
    const outputs = [
      { outputType: 'chat', metadata: 'not json' },
      { outputType: 'chat', metadata: JSON.stringify({ role: 'assistant', content: 'good reply' }) },
    ]
    expect(extractLastAssistantReply(outputs)).toBe('good reply')
  })

  it('ignores an assistant entry with empty/whitespace-only content', () => {
    const outputs = [
      { outputType: 'chat', metadata: JSON.stringify({ role: 'assistant', content: 'real answer' }) },
      { outputType: 'chat', metadata: JSON.stringify({ role: 'assistant', content: '   ' }) },
    ]
    expect(extractLastAssistantReply(outputs)).toBe('real answer')
  })
})

describe('seedHandoffContextIfApplicable', () => {
  function fakeClient(overrides: Partial<{ getOutputs: () => Promise<unknown[]>; seedContext: (...args: unknown[]) => Promise<void> }> = {}) {
    return {
      getOutputs: vi.fn(async () => [{ outputType: 'chat', metadata: JSON.stringify({ role: 'assistant', content: 'handoff payload' }) }]),
      seedContext: vi.fn(async () => {}),
      ...overrides,
    }
  }

  it('no-op for a ticket-anchored (non-cooperation) workspace', async () => {
    const prisma = { coopMilestoneStep: { findMany: vi.fn() } }
    await seedHandoffContextIfApplicable(prisma as never, { id: 'w1', cooperationId: null, offerId: 'offer-b', canisterWorkspaceId: 'cw1' })
    expect(prisma.coopMilestoneStep.findMany).not.toHaveBeenCalled()
  })

  it('no-op when there is no real agent boundary', async () => {
    const prisma = {
      coopMilestoneStep: {
        findMany: vi.fn(async () => [
          { stepIndex: 1, assigneeOfferId: 'offer-a', milestone: { milestoneIndex: 1 } },
        ]),
      },
    }
    await seedHandoffContextIfApplicable(prisma as never, { id: 'w1', cooperationId: 'coop1', offerId: 'offer-a', canisterWorkspaceId: 'cw1' })
    // Nothing else should have been queried — the pipeline stops right after
    // findHandoffSourceOfferId returns null (verified by findMany call count 1).
    expect(prisma.coopMilestoneStep.findMany).toHaveBeenCalledTimes(1)
  })

  it('no-op when the predecessor workspace never deployed to a canister', async () => {
    const prisma = {
      coopMilestoneStep: {
        findMany: vi.fn(async () => [
          { stepIndex: 1, assigneeOfferId: 'offer-a', milestone: { milestoneIndex: 1 } },
          { stepIndex: 2, assigneeOfferId: 'offer-b', milestone: { milestoneIndex: 1 } },
        ]),
      },
      workspace: { findUnique: vi.fn(async () => ({ canisterWorkspaceId: null })) },
    }
    await seedHandoffContextIfApplicable(prisma as never, { id: 'w2', cooperationId: 'coop1', offerId: 'offer-b', canisterWorkspaceId: 'cw2' })
    expect(prisma.workspace.findUnique).toHaveBeenCalledOnce()
  })
})
