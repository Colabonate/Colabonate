/**
 * ADR-353 (FU-547): canvas lifecycle — lock/unlock outbox events for the
 * hosted doop canvas on terminal ticket transitions. Prisma is faked
 * in-memory; the doop service route is a stubbed fetch (same harness as
 * canvas-provisioning.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutboxEvent } from '@prisma/client'
import {
  CANVAS_LIFECYCLE_AGGREGATE,
  enqueueCanvasLifecycleForTicket,
  isTerminalTicketStatus,
  processCanvasLifecycle,
} from './canvas-lifecycle.js'

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

const readyHostedWorkspace = {
  id: 'ws-1',
  canvasProvider: 'doop-hosted',
  canvasProvisioningStatus: 'ready',
  canvasId: 'canvas-42',
}

function fakeClient(workspace: unknown = readyHostedWorkspace, ticket: unknown | undefined = undefined) {
  const events: unknown[] = []
  const client = {
    workspace: { findUnique: vi.fn(async () => workspace) },
    ticket: ticket === undefined ? undefined : { findUnique: vi.fn(async () => ticket) },
    outboxEvent: { create: vi.fn(async (args: unknown) => { events.push(args) }) },
  }
  return { client, events }
}

function fakeEvent(payload: Record<string, unknown>): OutboxEvent {
  return {
    id: 'evt-lc-1',
    aggregate: CANVAS_LIFECYCLE_AGGREGATE,
    aggregateId: 'ws-1',
    eventType: 'lock',
    payload,
    status: 'PENDING',
    attempts: 0,
    lastError: null,
    createdAt: new Date(),
    processedAt: null,
  } as unknown as OutboxEvent
}

function stubService(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }))
  return calls
}

describe('isTerminalTicketStatus (D1)', () => {
  it('COMPLETED/DISPUTED/CANCELLED/REFUNDED are terminal, everything else is not', () => {
    for (const s of ['COMPLETED', 'DISPUTED', 'CANCELLED', 'REFUNDED']) {
      expect(isTerminalTicketStatus(s)).toBe(true)
    }
    for (const s of ['PENDING', 'ACCEPTED', 'PAID', 'IN_PROGRESS']) {
      expect(isTerminalTicketStatus(s)).toBe(false)
    }
  })
})

describe('enqueueCanvasLifecycleForTicket', () => {
  it('terminal transition enqueues a lock event with the canvas id', async () => {
    const { client, events } = fakeClient()
    await enqueueCanvasLifecycleForTicket(client as never, 'ticket-1', 'IN_PROGRESS', 'COMPLETED')
    expect(events).toHaveLength(1)
    const data = (events[0] as { data: Record<string, unknown> }).data
    expect(data.aggregate).toBe(CANVAS_LIFECYCLE_AGGREGATE)
    expect(data.aggregateId).toBe('ws-1')
    expect(data.eventType).toBe('lock')
    expect(data.payload).toMatchObject({ workspaceId: 'ws-1', canvasId: 'canvas-42', locked: true, ticketStatus: 'COMPLETED' })
  })

  it('reopen out of a terminal state enqueues an unlock event (Q2)', async () => {
    const { client, events } = fakeClient()
    await enqueueCanvasLifecycleForTicket(client as never, 'ticket-1', 'DISPUTED', 'ACCEPTED')
    expect(events).toHaveLength(1)
    const data = (events[0] as { data: Record<string, unknown> }).data
    expect(data.eventType).toBe('unlock')
    expect(data.payload).toMatchObject({ locked: false })
  })

  it('non-boundary transitions enqueue nothing', async () => {
    const { client, events } = fakeClient()
    await enqueueCanvasLifecycleForTicket(client as never, 'ticket-1', 'PENDING', 'PAID')
    await enqueueCanvasLifecycleForTicket(client as never, 'ticket-1', 'IN_PROGRESS', 'IN_PROGRESS')
    expect(events).toHaveLength(0)
  })

  it('skips when no hosted ready canvas exists', async () => {
    for (const ws of [
      null,
      { ...readyHostedWorkspace, canvasProvider: 'doop-local' },
      { ...readyHostedWorkspace, canvasProvisioningStatus: 'pending' },
      { ...readyHostedWorkspace, canvasProvisioningStatus: 'failed' },
      { ...readyHostedWorkspace, canvasId: null },
    ]) {
      const { client, events } = fakeClient(ws)
      await enqueueCanvasLifecycleForTicket(client as never, 'ticket-1', 'IN_PROGRESS', 'DISPUTED')
      expect(events).toHaveLength(0)
    }
  })

  it('ADR-370 D2: ticket-level binding (no workspace) enqueues the lock keyed on the ticket', async () => {
    const { client, events } = fakeClient(null, {
      canvasProvider: 'doop-hosted',
      canvasProvisioningStatus: 'ready',
      canvasId: 'canvas-t-1',
    })
    await enqueueCanvasLifecycleForTicket(client as never, 'ticket-1', 'IN_PROGRESS', 'COMPLETED')
    expect(events).toHaveLength(1)
    const data = (events[0] as { data: Record<string, unknown> }).data
    expect(data.aggregate).toBe(CANVAS_LIFECYCLE_AGGREGATE)
    expect(data.aggregateId).toBe('ticket-1')
    expect(data.eventType).toBe('lock')
    expect(data.payload).toMatchObject({ ticketId: 'ticket-1', canvasId: 'canvas-t-1', locked: true, ticketStatus: 'COMPLETED' })
  })

  it('ADR-370 D2: ticket-level binding takes precedence over a stale workspace binding', async () => {
    // A legacy workspace binding may still exist but be stale/not-ready — the
    // ticket binding (ready) wins.
    const { client, events } = fakeClient({ ...readyHostedWorkspace, canvasProvisioningStatus: 'pending' }, {
      canvasProvider: 'doop-hosted',
      canvasProvisioningStatus: 'ready',
      canvasId: 'canvas-t-2',
    })
    await enqueueCanvasLifecycleForTicket(client as never, 'ticket-1', 'IN_PROGRESS', 'CANCELLED')
    expect(events).toHaveLength(1)
    const data = (events[0] as { data: Record<string, unknown> }).data
    expect(data.aggregateId).toBe('ticket-1')
    expect(data.payload).toMatchObject({ ticketId: 'ticket-1', canvasId: 'canvas-t-2', locked: true })
  })

  it('ADR-370 D2: legacy fallback still locks via the workspace when the ticket has no binding', async () => {
    const { client, events } = fakeClient(readyHostedWorkspace, {
      canvasProvider: null,
      canvasProvisioningStatus: null,
      canvasId: null,
    })
    await enqueueCanvasLifecycleForTicket(client as never, 'ticket-1', 'IN_PROGRESS', 'DISPUTED')
    expect(events).toHaveLength(1)
    const data = (events[0] as { data: Record<string, unknown> }).data
    expect(data.aggregateId).toBe('ws-1')
    expect(data.payload).toMatchObject({ workspaceId: 'ws-1', canvasId: 'canvas-42', locked: true })
  })
})

describe('processCanvasLifecycle', () => {
  it('calls the fork-side set-canvas-lock route with the bearer token', async () => {
    const calls = stubService(200, { canvasId: 'canvas-42', locked: true })
    await processCanvasLifecycle({} as never, fakeEvent({ canvasId: 'canvas-42', locked: true }))
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://canvas.internal/api/service/set-canvas-lock')
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer test-service-token')
    const body = JSON.parse(calls[0].init.body as string)
    expect(body).toEqual({ canvasId: 'canvas-42', locked: true })
  })

  it('unlock events pass locked:false through', async () => {
    const calls = stubService(200, { canvasId: 'canvas-42', locked: false })
    await processCanvasLifecycle({} as never, fakeEvent({ canvasId: 'canvas-42', locked: false }))
    const body = JSON.parse(calls[0].init.body as string)
    expect(body.locked).toBe(false)
  })

  it('throws on service failure so the outbox retry applies (unlike provisioning)', async () => {
    stubService(500, { error: 'boom' })
    await expect(
      processCanvasLifecycle({} as never, fakeEvent({ canvasId: 'canvas-42', locked: true })),
    ).rejects.toThrow('HTTP 500')
  })

  it('malformed payloads resolve without a service call (DONE, no retry)', async () => {
    const calls = stubService(200, {})
    await expect(
      processCanvasLifecycle({} as never, fakeEvent({ locked: true })),
    ).resolves.toBeUndefined()
    await expect(
      processCanvasLifecycle({} as never, fakeEvent({ canvasId: 'x', locked: 'yes' })),
    ).resolves.toBeUndefined()
    expect(calls).toHaveLength(0)
  })
})
