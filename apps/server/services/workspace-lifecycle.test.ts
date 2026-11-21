import { describe, it, expect } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { WorkspaceStatusSchema, type WorkspaceStatus } from '../lib/enums.js'
import { canTransitionWorkspace, isWorkspaceStatus, runWorkspaceExpirySweep } from './workspace-lifecycle.js'
import { WorkspaceCanisterError, type WorkspaceCanisterClient } from './workspace-canister-client.js'

const ALL_STATES = WorkspaceStatusSchema.options

// ADR-311 D2: the complete legal transition set. Anything not listed here
// must be rejected — including self-transitions.
const LEGAL: ReadonlyArray<readonly [WorkspaceStatus, WorkspaceStatus]> = [
  ['PENDING_DEPLOY', 'RUNNING'],
  ['RUNNING', 'SUSPENDED'],
  ['RUNNING', 'COMPLETED'],
  ['SUSPENDED', 'RUNNING'], // resume after cycle reload
  ['SUSPENDED', 'COMPLETED'], // buyer may confirm without reloading first
  ['COMPLETED', 'EXPIRED'],
]

describe('canTransitionWorkspace', () => {
  it('accepts exactly the ADR-311 D2 transition set (exhaustive 5×5)', () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        const expected = LEGAL.some(([f, t]) => f === from && t === to)
        expect(canTransitionWorkspace(from, to), `${from} -> ${to}`).toBe(expected)
      }
    }
  })

  it('rejects skipping states (PENDING_DEPLOY -> COMPLETED/EXPIRED)', () => {
    expect(canTransitionWorkspace('PENDING_DEPLOY', 'COMPLETED')).toBe(false)
    expect(canTransitionWorkspace('PENDING_DEPLOY', 'EXPIRED')).toBe(false)
  })

  it('EXPIRED is terminal', () => {
    for (const to of ALL_STATES) {
      expect(canTransitionWorkspace('EXPIRED', to)).toBe(false)
    }
  })
})

describe('isWorkspaceStatus', () => {
  it('accepts all schema values', () => {
    for (const s of ALL_STATES) expect(isWorkspaceStatus(s)).toBe(true)
  })

  it('rejects unknown values', () => {
    expect(isWorkspaceStatus('RUNNINGG')).toBe(false)
    expect(isWorkspaceStatus('')).toBe(false)
    expect(isWorkspaceStatus('running')).toBe(false)
  })
})

// FU-435: the sweep relays expiry to the canister first and only flips rows
// the canister agrees on. Tested with a fake prisma + fake client, no replica.
describe('runWorkspaceExpirySweep (canister relay)', () => {
  type DueRow = { id: string; canisterWorkspaceId: string | null }

  function fakePrisma(due: DueRow[]) {
    const flipped: string[] = []
    const prisma = {
      workspace: {
        findMany: async () => due,
        updateMany: async (args: { where: { id: { in: string[] } } }) => {
          flipped.push(...args.where.id.in)
          return { count: args.where.id.in.length }
        },
      },
    }
    return { prisma: prisma as unknown as PrismaClient, flipped }
  }

  function relayClient(behavior: (id: string) => Promise<'EXPIRED'>): { client: WorkspaceCanisterClient; calls: string[] } {
    const calls: string[] = []
    const client = {
      expireWorkspace: async (id: string) => { calls.push(id); return behavior(id) },
    } as unknown as WorkspaceCanisterClient
    return { client, calls }
  }

  it('flips nothing when nothing is due', async () => {
    const { prisma, flipped } = fakePrisma([])
    const { client, calls } = relayClient(async () => 'EXPIRED')
    expect(await runWorkspaceExpirySweep(prisma, new Date(), client)).toBe(0)
    expect(flipped).toEqual([])
    expect(calls).toEqual([])
  })

  it('relays expiry per canister-backed row and flips on success', async () => {
    const { prisma, flipped } = fakePrisma([
      { id: 'a', canisterWorkspaceId: '1' },
      { id: 'b', canisterWorkspaceId: null }, // no canister backend — plain flip
    ])
    const { client, calls } = relayClient(async () => 'EXPIRED')
    expect(await runWorkspaceExpirySweep(prisma, new Date(), client)).toBe(2)
    expect(calls).toEqual(['1'])
    expect(flipped).toEqual(['a', 'b'])
  })

  it('still flips on in-sync rejections (canister already expired/gone)', async () => {
    const { prisma, flipped } = fakePrisma([{ id: 'a', canisterWorkspaceId: '1' }])
    const { client } = relayClient(async () => {
      throw new WorkspaceCanisterError('expire_workspace', {
        InvalidTransition: { action: 'expire', from: { Expired: null } },
      })
    })
    expect(await runWorkspaceExpirySweep(prisma, new Date(), client)).toBe(1)
    expect(flipped).toEqual(['a'])
  })

  it('keeps the row COMPLETED on transient relay failure (next tick retries)', async () => {
    const { prisma, flipped } = fakePrisma([
      { id: 'a', canisterWorkspaceId: '1' },
      { id: 'b', canisterWorkspaceId: '2' },
    ])
    const { client } = relayClient(async (id) => {
      if (id === '1') throw new WorkspaceCanisterError('expire_workspace', { NotExpired: { now: 1n, expires_at: 2n } })
      return 'EXPIRED'
    })
    expect(await runWorkspaceExpirySweep(prisma, new Date(), client)).toBe(1)
    expect(flipped).toEqual(['b'])
  })
})
