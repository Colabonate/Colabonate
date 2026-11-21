// ADR-352 FU-605: tests for syncMilestoneStatusFromSteps + its pure
// areAllStepsCompleted helper. This is the money-adjacent piece (it gates
// whether a milestone can ever reach the buyer-only ACCEPTED/release
// transition) so it gets exhaustive coverage of the transition table, not
// spot checks.
import { describe, expect, it, vi } from 'vitest'
import { areAllStepsCompleted, syncMilestoneStatusFromSteps } from './coop-milestone-progress.js'

describe('areAllStepsCompleted', () => {
  it('true only when every step is COMPLETED', () => {
    expect(areAllStepsCompleted(['COMPLETED'])).toBe(true)
    expect(areAllStepsCompleted(['COMPLETED', 'COMPLETED'])).toBe(true)
    expect(areAllStepsCompleted(['COMPLETED', 'PENDING'])).toBe(false)
    expect(areAllStepsCompleted(['PENDING'])).toBe(false)
  })

  it('an empty step list is never "all completed" (no vacuous-truth false positive)', () => {
    expect(areAllStepsCompleted([])).toBe(false)
  })
})

describe('syncMilestoneStatusFromSteps', () => {
  function fakePrisma(milestone: { id: string; status: string; steps: Array<{ status: string }> }) {
    const updates: Array<{ status?: string }> = []
    const messages: Array<{ action?: string }> = []
    return {
      updates,
      messages,
      prisma: {
        coopMilestone: {
          findUnique: vi.fn(async () => milestone),
          update: vi.fn((args: { data: { status?: string } }) => {
            updates.push(args.data)
            return Promise.resolve({})
          }),
        },
        coopMilestoneMessage: {
          create: vi.fn((args: { data: { action?: string } }) => {
            messages.push(args.data)
            return Promise.resolve({})
          }),
        },
        $transaction: vi.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
      },
    }
  }

  it('single-step milestone still visits IN_PROGRESS before COMPLETED, even though both fire in one call', async () => {
    const { prisma, updates, messages } = fakePrisma({ id: 'm1', status: 'PENDING', steps: [{ status: 'COMPLETED' }] })
    await syncMilestoneStatusFromSteps(prisma as never, 'm1', 'buyer-pubkey')
    expect(updates.map(u => u.status)).toEqual(['IN_PROGRESS', 'COMPLETED'])
    expect(messages.map(m => m.action)).toEqual(['STARTED', 'COMPLETED'])
  })

  it('multi-step milestone with one pending step only advances to IN_PROGRESS', async () => {
    const { prisma, updates } = fakePrisma({ id: 'm1', status: 'PENDING', steps: [{ status: 'COMPLETED' }, { status: 'PENDING' }] })
    await syncMilestoneStatusFromSteps(prisma as never, 'm1', 'buyer-pubkey')
    expect(updates.map(u => u.status)).toEqual(['IN_PROGRESS'])
  })

  it('already-IN_PROGRESS milestone with the last step just completed advances straight to COMPLETED (no duplicate STARTED)', async () => {
    const { prisma, updates, messages } = fakePrisma({ id: 'm1', status: 'IN_PROGRESS', steps: [{ status: 'COMPLETED' }, { status: 'COMPLETED' }] })
    await syncMilestoneStatusFromSteps(prisma as never, 'm1', 'buyer-pubkey')
    expect(updates.map(u => u.status)).toEqual(['COMPLETED'])
    expect(messages.map(m => m.action)).toEqual(['COMPLETED'])
  })

  it('already-COMPLETED milestone is never touched again (idempotent re-completion of a step)', async () => {
    const { prisma, updates, messages } = fakePrisma({ id: 'm1', status: 'COMPLETED', steps: [{ status: 'COMPLETED' }] })
    await syncMilestoneStatusFromSteps(prisma as never, 'm1', 'buyer-pubkey')
    expect(updates).toHaveLength(0)
    expect(messages).toHaveLength(0)
  })

  it('already-DISPUTED milestone is never touched', async () => {
    const { prisma, updates, messages } = fakePrisma({ id: 'm1', status: 'DISPUTED', steps: [{ status: 'COMPLETED' }] })
    await syncMilestoneStatusFromSteps(prisma as never, 'm1', 'buyer-pubkey')
    expect(updates).toHaveLength(0)
    expect(messages).toHaveLength(0)
  })

  it('already-ACCEPTED milestone is never touched', async () => {
    const { prisma, updates, messages } = fakePrisma({ id: 'm1', status: 'ACCEPTED', steps: [{ status: 'COMPLETED' }] })
    await syncMilestoneStatusFromSteps(prisma as never, 'm1', 'buyer-pubkey')
    expect(updates).toHaveLength(0)
    expect(messages).toHaveLength(0)
  })

  it('missing milestone is a no-op, not a throw', async () => {
    const prisma = {
      coopMilestone: { findUnique: vi.fn(async () => null), update: vi.fn() },
      coopMilestoneMessage: { create: vi.fn() },
      $transaction: vi.fn(),
    }
    await expect(syncMilestoneStatusFromSteps(prisma as never, 'missing', 'buyer-pubkey')).resolves.toBeUndefined()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
