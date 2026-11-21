/**
 * ADR-342 D3/D4 (Phase B): canvas provisioning worker + login-url bridge.
 * Prisma is faked in-memory; the doop service route is a stubbed fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutboxEvent } from '@prisma/client'
import {
  CANVAS_PROVISION_AGGREGATE,
  enqueueCanvasProvisioning,
  enqueueProvisioningOnPaid,
  processCanvasProvisioning,
  requestCanvasLoginUrl,
} from './canvas-provisioning.js'

const ENV_KEYS = ['DOOP_SERVICE_URL', 'DOOP_SERVICE_TOKEN'] as const
let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))
  process.env.DOOP_SERVICE_URL = 'https://canvas.internal'
  process.env.DOOP_SERVICE_TOKEN = 'test-service-token'
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function fakeEvent(workspaceId: string): OutboxEvent {
  return {
    id: 'evt-1',
    aggregate: CANVAS_PROVISION_AGGREGATE,
    aggregateId: workspaceId,
    eventType: 'provision',
    payload: { workspaceId },
    status: 'PENDING',
    attempts: 0,
    lastError: null,
    createdAt: new Date(),
    processedAt: null,
  } as unknown as OutboxEvent
}

const baseWorkspace = {
  id: 'ws-1',
  canvasProvider: 'doop-hosted',
  canvasProvisioningStatus: 'pending',
  canvasBuyerAccess: 'edit',
  canvasId: null,
  buyerPubkey: 'b'.repeat(64),
  buyer: { name: 'Buyer' },
  offer: { title: 'Design agent' },
  agentProfile: null,
  ticket: {
    id: 'ticket-1',
    sellerPubkey: 's'.repeat(64),
    seller: { name: 'Seller' },
  },
}

function fakePrisma(workspace: unknown, userByPubkey: Record<string, { name: string | null }> = {}) {
  const updates: unknown[] = []
  return {
    updates,
    prisma: {
      workspace: {
        findUnique: vi.fn(async () => workspace),
        update: vi.fn(async (args: unknown) => { updates.push(args); return {} }),
      },
      // Fresh-status re-read after provisioning (terminal-during-flight guard):
      // default to the workspace's own ticket status when one is present.
      ticket: {
        findUnique: vi.fn(async () =>
          workspace && typeof workspace === 'object' && 'ticket' in workspace
            ? { status: (workspace as { ticket: { status: string } }).ticket?.status }
            : null,
        ),
      },
      user: {
        findUnique: vi.fn(async ({ where }: { where: { pubkey: string } }) => userByPubkey[where.pubkey] ?? null),
      },
    },
  }
}

function stubService(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }))
  return calls
}

describe('enqueueCanvasProvisioning', () => {
  it('creates a canvas-provision outbox event', async () => {
    const created: unknown[] = []
    const tx = { outboxEvent: { create: async (args: unknown) => { created.push(args) } } }
    await enqueueCanvasProvisioning(tx as never, 'ws-1')
    const data = (created[0] as { data: Record<string, unknown> }).data
    expect(data.aggregate).toBe('canvas-provision')
    expect(data.aggregateId).toBe('ws-1')
    expect(data.eventType).toBe('provision')
  })
})

describe('processCanvasProvisioning', () => {
  it('provisions: seller owns, buyer becomes member (buyerAccess edit)', async () => {
    const calls = stubService(200, { canvasId: 'canvas-42' })
    const { prisma, updates } = fakePrisma(baseWorkspace)
    await processCanvasProvisioning(prisma as never, fakeEvent('ws-1'))

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://canvas.internal/api/service/provision-canvas')
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer test-service-token')
    const body = JSON.parse(calls[0].init.body as string)
    expect(body.ticketId).toBe('ticket-1')
    expect(body.owner.pubkey).toBe('s'.repeat(64))
    expect(body.members).toEqual([{ pubkey: 'b'.repeat(64), displayName: 'Buyer' }])
    expect(body.canvasId).toBeUndefined()

    const last = updates.at(-1) as { data: Record<string, unknown> }
    expect(last.data.canvasId).toBe('canvas-42')
    expect(last.data.canvasProvisioningStatus).toBe('ready')
  })

  it('buyerAccess none: buyer is not added as a member (D4a snapshot)', async () => {
    const calls = stubService(200, { canvasId: 'canvas-7' })
    const ws = { ...baseWorkspace, canvasBuyerAccess: 'none' }
    const { prisma } = fakePrisma(ws)
    await processCanvasProvisioning(prisma as never, fakeEvent('ws-1'))
    const body = JSON.parse(calls[0].init.body as string)
    expect(body.members).toEqual([])
  })

  it('pinned canvasId is bound instead of creating a new canvas', async () => {
    const calls = stubService(200, { canvasId: 'pinned-1' })
    const ws = { ...baseWorkspace, canvasId: 'pinned-1' }
    const { prisma } = fakePrisma(ws)
    await processCanvasProvisioning(prisma as never, fakeEvent('ws-1'))
    const body = JSON.parse(calls[0].init.body as string)
    expect(body.canvasId).toBe('pinned-1')
  })

  it('skips non-hosted and already-ready workspaces', async () => {
    const calls = stubService(200, { canvasId: 'x' })
    const { prisma } = fakePrisma({ ...baseWorkspace, canvasProvider: 'doop-local' })
    await processCanvasProvisioning(prisma as never, fakeEvent('ws-1'))
    const { prisma: prisma2 } = fakePrisma({ ...baseWorkspace, canvasProvisioningStatus: 'ready', canvasId: 'c1' })
    await processCanvasProvisioning(prisma2 as never, fakeEvent('ws-1'))
    expect(calls).toHaveLength(0)
  })

  it('ADR-352 D1: cooperation-anchored workspace (no ticket) resolves seller via AgentProfile owner', async () => {
    const calls = stubService(200, { canvasId: 'canvas-coop-1' })
    const ws = {
      ...baseWorkspace,
      ticket: null,
      agentProfile: { ownerPubkey: 'a'.repeat(64) },
    }
    const { prisma, updates } = fakePrisma(ws, { ['a'.repeat(64)]: { name: 'Agent Owner' } })
    await processCanvasProvisioning(prisma as never, fakeEvent('ws-1'))

    expect(calls).toHaveLength(1)
    const body = JSON.parse(calls[0].init.body as string)
    expect(body.ticketId).toBe('ws-1') // falls back to the workspace's own id — no Ticket exists
    expect(body.owner.pubkey).toBe('a'.repeat(64))
    expect(body.owner.displayName).toBe('Agent Owner')
    const last = updates.at(-1) as { data: Record<string, unknown> }
    expect(last.data.canvasId).toBe('canvas-coop-1')
  })

  it('ADR-352 D1: cooperation-anchored workspace with no resolvable seller marks failed', async () => {
    const calls = stubService(200, { canvasId: 'x' })
    const ws = { ...baseWorkspace, ticket: null, agentProfile: null }
    const { prisma, updates } = fakePrisma(ws)
    await processCanvasProvisioning(prisma as never, fakeEvent('ws-1'))
    expect(calls).toHaveLength(0)
    const last = updates.at(-1) as { data: Record<string, unknown> }
    expect(last.data.canvasProvisioningStatus).toBe('failed')
  })

  it('service failure marks the workspace failed (convergent, no throw)', async () => {
    stubService(500, { error: 'boom' })
    const { prisma, updates } = fakePrisma(baseWorkspace)
    await expect(processCanvasProvisioning(prisma as never, fakeEvent('ws-1'))).resolves.toBeUndefined()
    const last = updates.at(-1) as { data: Record<string, unknown> }
    expect(last.data.canvasProvisioningStatus).toBe('failed')
  })

  it('missing service configuration marks failed without calling out', async () => {
    delete process.env.DOOP_SERVICE_URL
    delete process.env.DOOP_SERVICE_TOKEN
    const calls = stubService(200, {})
    const { prisma, updates } = fakePrisma(baseWorkspace)
    await processCanvasProvisioning(prisma as never, fakeEvent('ws-1'))
    expect(calls).toHaveLength(0)
    const last = updates.at(-1) as { data: Record<string, unknown> }
    expect(last.data.canvasProvisioningStatus).toBe('failed')
  })

  describe('ADR-370 Phase 1: ticket-anchored provisioning (payload { ticketId })', () => {
    const baseTicket = {
      id: 'ticket-1',
      canvasProvider: 'doop-hosted',
      canvasProvisioningStatus: 'pending',
      canvasBuyerAccess: 'edit',
      canvasId: null,
      status: 'PAID',
      buyerPubkey: 'b'.repeat(64),
      buyer: { name: 'Buyer' },
      sellerPubkey: 's'.repeat(64),
      seller: { name: 'Seller' },
      offer: { title: 'Design agent', agentConfigMeta: { canvas: { provider: 'doop-hosted', agentInCanvas: false } } },
      workspace: null,
    }

    function fakeTicketEvent(): OutboxEvent {
      return {
        id: 'evt-t-1',
        aggregate: CANVAS_PROVISION_AGGREGATE,
        aggregateId: 'ticket-1',
        eventType: 'provision',
        payload: { ticketId: 'ticket-1' },
        status: 'PENDING',
        attempts: 0,
        lastError: null,
        createdAt: new Date(),
        processedAt: null,
      } as unknown as OutboxEvent
    }

    function fakeTicketPrisma(ticket: unknown, workspaceUpdate = true) {
      const updates: unknown[] = []
      const workspaceUpdates: unknown[] = []
      const outboxEvents: unknown[] = []
      return {
        updates,
        workspaceUpdates,
        outboxEvents,
        prisma: {
          ticket: {
            findUnique: vi.fn(async () => ticket),
            update: vi.fn(async (args: unknown) => { updates.push(args); return {} }),
          },
          workspace: {
            update: workspaceUpdate
              ? vi.fn(async (args: unknown) => { workspaceUpdates.push(args); return {} })
              : vi.fn(),
          },
          outboxEvent: {
            create: vi.fn(async (args: unknown) => { outboxEvents.push(args) }),
          },
        },
      }
    }

    it('provisions ticket-anchored: seller owns, buyer member per ticket buyerAccess snapshot', async () => {
      const calls = stubService(200, { canvasId: 'canvas-t-1' })
      const { prisma, updates } = fakeTicketPrisma(baseTicket)
      await processCanvasProvisioning(prisma as never, fakeTicketEvent())

      expect(calls).toHaveLength(1)
      const body = JSON.parse(calls[0].init.body as string)
      expect(body.ticketId).toBe('ticket-1')
      expect(body.name).toBe('Design agent')
      expect(body.owner.pubkey).toBe('s'.repeat(64))
      expect(body.members).toEqual([{ pubkey: 'b'.repeat(64), displayName: 'Buyer' }])

      const last = updates.at(-1) as { data: Record<string, unknown> }
      expect(last.data.canvasId).toBe('canvas-t-1')
      expect(last.data.canvasProvisioningStatus).toBe('ready')
    })

    it('buyerAccess none on the ticket snapshot: no buyer member (D4a preserved)', async () => {
      const calls = stubService(200, { canvasId: 'canvas-t-2' })
      const { prisma } = fakeTicketPrisma({ ...baseTicket, canvasBuyerAccess: 'none' })
      await processCanvasProvisioning(prisma as never, fakeTicketEvent())
      const body = JSON.parse(calls[0].init.body as string)
      expect(body.members).toEqual([])
    })

    it('pinned ticket canvasId is bound, not created', async () => {
      const calls = stubService(200, { canvasId: 'pinned-t-1' })
      const { prisma } = fakeTicketPrisma({ ...baseTicket, canvasId: 'pinned-t-1' })
      await processCanvasProvisioning(prisma as never, fakeTicketEvent())
      const body = JSON.parse(calls[0].init.body as string)
      expect(body.canvasId).toBe('pinned-t-1')
    })

    it('mirrors the ready canvas onto an existing workspace (never provisions twice)', async () => {
      const calls = stubService(200, { canvasId: 'canvas-t-3' })
      const { prisma, workspaceUpdates } = fakeTicketPrisma({
        ...baseTicket,
        workspace: { id: 'ws-1', canvasProvider: 'doop-hosted', canvasProvisioningStatus: 'pending' },
      })
      await processCanvasProvisioning(prisma as never, fakeTicketEvent())
      expect(calls).toHaveLength(1)
      expect(workspaceUpdates).toHaveLength(1)
      const wu = workspaceUpdates[0] as { where: Record<string, unknown>; data: Record<string, unknown> }
      expect(wu.where.id).toBe('ws-1')
      expect(wu.data.canvasId).toBe('canvas-t-3')
      expect(wu.data.canvasProvisioningStatus).toBe('ready')
    })

    it('ADR-370 D5 (Phase 4): ready + agentInCanvas opt-in enqueues a runner start; opt-out does not', async () => {
      const calls = stubService(200, { canvasId: 'canvas-t-4' })
      const { prisma, outboxEvents } = fakeTicketPrisma(baseTicket) // agentInCanvas false
      await processCanvasProvisioning(prisma as never, fakeTicketEvent())
      expect(outboxEvents.filter(e => (e as { data: { aggregate: string } }).data?.aggregate === 'canvas-agent-runner')).toHaveLength(0)

      const calls2 = stubService(200, { canvasId: 'canvas-t-5' })
      const { prisma: prisma2, outboxEvents: events2 } = fakeTicketPrisma({
        ...baseTicket,
        offer: { title: 'Design agent', agentConfigMeta: { canvas: { provider: 'doop-hosted', agentInCanvas: true } } },
      })
      await processCanvasProvisioning(prisma2 as never, fakeTicketEvent())
      const runnerEvents = events2.filter(e => (e as { data: { aggregate: string } }).data?.aggregate === 'canvas-agent-runner')
      expect(runnerEvents).toHaveLength(1)
      const data = (runnerEvents[0] as { data: Record<string, unknown> }).data
      expect(data.eventType).toBe('start')
      expect(data.payload).toMatchObject({ ticketId: 'ticket-1', canvasId: 'canvas-t-5' })
    })

    it('ADR-370 D5: no runner start for a ticket that is already terminal at ready time', async () => {
      const calls = stubService(200, { canvasId: 'canvas-t-6' })
      const { prisma, outboxEvents } = fakeTicketPrisma({
        ...baseTicket,
        status: 'COMPLETED',
        offer: { title: 'Design agent', agentConfigMeta: { canvas: { provider: 'doop-hosted', agentInCanvas: true } } },
      })
      await processCanvasProvisioning(prisma as never, fakeTicketEvent())
      expect(outboxEvents.filter(e => (e as { data: { aggregate: string } }).data?.aggregate === 'canvas-agent-runner')).toHaveLength(0)
    })

    it('ADR-353/ADR-370 D7 fix: ticket that went terminal DURING provisioning still chains the lock and never starts the runner', async () => {
      // First findUnique (pre-HTTP snapshot) sees PAID; the re-read AFTER the
      // provisioning call + ready write sees COMPLETED (terminal mid-flight).
      const calls = stubService(200, { canvasId: 'canvas-t-7' })
      const events: unknown[] = []
      const terminalTicket = {
        ...baseTicket,
        status: 'COMPLETED',
        offer: { title: 'Design agent', agentConfigMeta: { canvas: { provider: 'doop-hosted', agentInCanvas: true } } },
      }
      const paidTicket = {
        ...baseTicket,
        status: 'PAID',
        offer: { title: 'Design agent', agentConfigMeta: { canvas: { provider: 'doop-hosted', agentInCanvas: true } } },
      }
      const results = [paidTicket, terminalTicket]
      const prisma = {
        ticket: {
          findUnique: vi.fn(async () => results.shift() ?? paidTicket),
          update: vi.fn(async () => ({})),
        },
        workspace: { update: vi.fn(async () => ({ })) },
        outboxEvent: { create: vi.fn(async (args: unknown) => { events.push(args) }) },
      }
      await processCanvasProvisioning(prisma as never, fakeTicketEvent())
      const aggregate = (a: unknown) => (a as { data: { aggregate?: string; eventType?: string } }).data
      const lifecycleLocks = events.filter(e => aggregate(e).aggregate === 'canvas-lifecycle' && aggregate(e).eventType === 'lock')
      const runnerStarts = events.filter(e => aggregate(e).aggregate === 'canvas-agent-runner')
      expect(lifecycleLocks).toHaveLength(1)
      expect(runnerStarts).toHaveLength(0)
    })

    it('skips non-hosted / already-ready tickets', async () => {
      const calls = stubService(200, { canvasId: 'x' })
      const { prisma } = fakeTicketPrisma({ ...baseTicket, canvasProvider: 'doop-local' })
      await processCanvasProvisioning(prisma as never, fakeTicketEvent())
      const { prisma: prisma2 } = fakeTicketPrisma({ ...baseTicket, canvasProvisioningStatus: 'ready', canvasId: 'c1' })
      await processCanvasProvisioning(prisma2 as never, fakeTicketEvent())
      expect(calls).toHaveLength(0)
    })

    it('service failure marks the ticket failed (no throw, no workspace touch)', async () => {
      stubService(500, { error: 'boom' })
      const { prisma, updates, workspaceUpdates } = fakeTicketPrisma(baseTicket)
      await expect(processCanvasProvisioning(prisma as never, fakeTicketEvent())).resolves.toBeUndefined()
      const last = updates.at(-1) as { data: Record<string, unknown> }
      expect(last.data.canvasProvisioningStatus).toBe('failed')
      expect(workspaceUpdates).toHaveLength(0)
    })
  })
})

describe('enqueueProvisioningOnPaid (ADR-370 D2, fix G2)', () => {
  it('sets the ticket provisioning to pending and enqueues a ticket-anchored event', async () => {
    let updateArgs: unknown
    const created: unknown[] = []
    const txFn = async (fn: unknown) => {
      await (fn as (tx: never) => Promise<void>)({
        ticket: { update: async (a: unknown) => { updateArgs = a } },
        outboxEvent: { create: async (a: unknown) => { created.push(a) } },
      } as never)
    }
    const prisma = {
      ticket: {
        findUnique: vi.fn(async () => ({ id: 'ticket-1', offerType: 'AGENT_SETUP', canvasProvider: 'doop-hosted', canvasProvisioningStatus: null })),
      },
      $transaction: txFn,
    }
    const ok = await enqueueProvisioningOnPaid(prisma as never, 'ticket-1')
    expect(ok).toBe(true)
    expect((updateArgs as { data: Record<string, unknown> }).data.canvasProvisioningStatus).toBe('pending')
    const evt = (created[0] as { data: Record<string, unknown> }).data
    expect(evt.aggregateId).toBe('ticket-1')
    expect(evt.payload).toEqual({ ticketId: 'ticket-1' })
  })

  it('no-op for non-AGENT_SETUP, non-hosted, or already-in-flight tickets', async () => {
    for (const t of [
      { offerType: 'SERVICE', canvasProvider: 'doop-hosted', canvasProvisioningStatus: null },
      { offerType: 'AGENT_SETUP', canvasProvider: null, canvasProvisioningStatus: null },
      { offerType: 'AGENT_SETUP', canvasProvider: 'doop-local', canvasProvisioningStatus: null },
      { offerType: 'AGENT_SETUP', canvasProvider: 'doop-hosted', canvasProvisioningStatus: 'pending' },
      { offerType: 'AGENT_SETUP', canvasProvider: 'doop-hosted', canvasProvisioningStatus: 'ready' },
    ]) {
      const prisma = {
        ticket: { findUnique: vi.fn(async () => t) },
        $transaction: vi.fn(),
      }
      const ok = await enqueueProvisioningOnPaid(prisma as never, 'ticket-1')
      expect(ok).toBe(false)
      expect(prisma.$transaction).not.toHaveBeenCalled()
    }
  })
})

describe('requestCanvasLoginUrl (D4)', () => {
  it('returns the one-time login URL from the service route', async () => {
    const calls = stubService(200, { url: 'https://canvas.example.com/api/service/consume-login?token=abc' })
    const url = await requestCanvasLoginUrl({ pubkey: 'p'.repeat(64), displayName: 'Buyer' }, 'canvas-42')
    expect(url).toContain('consume-login')
    const body = JSON.parse(calls[0].init.body as string)
    expect(body.canvasId).toBe('canvas-42')
    expect(body.pubkey).toBe('p'.repeat(64))
  })

  it('throws when the service returns no url', async () => {
    stubService(200, {})
    await expect(requestCanvasLoginUrl({ pubkey: 'p'.repeat(64) }, 'c1')).rejects.toThrow('no url')
  })
})
