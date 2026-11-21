import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OutboxEvent } from '@prisma/client'
import {
  CANVAS_AGENT_RUNNER_AGGREGATE,
  enqueueCanvasAgentRunnerStart,
  enqueueCanvasAgentRunnerStop,
  processCanvasAgentRunner,
  requestRunnerTicketPubkey,
} from './canvas-agent-runner.js'

function fakeEvent(ticketId: string, eventType: 'start' | 'stop'): OutboxEvent {
  return {
    id: `evt-${eventType}`,
    aggregate: CANVAS_AGENT_RUNNER_AGGREGATE,
    aggregateId: ticketId,
    eventType,
    payload: { ticketId, canvasId: 'canvas-1' },
    status: 'PENDING',
    attempts: 0,
    lastError: null,
    createdAt: new Date(),
    processedAt: null,
  } as unknown as OutboxEvent
}

function fakePrisma(intent: unknown) {
  const updates: unknown[] = []
  const ticket = {
    findUnique: vi.fn(async () => intent),
    update: vi.fn(async (args: unknown) => { updates.push(args); return {} }),
  }
  return { updates, prisma: { ticket } }
}

describe('enqueue helpers (ADR-370 Phase 4)', () => {
  it('enqueue start writes a canvas-agent-runner/start event keyed on ticketId', async () => {
    const events: unknown[] = []
    const tx = { outboxEvent: { create: async (a: unknown) => events.push(a) } }
    await enqueueCanvasAgentRunnerStart(tx as never, 'ticket-1', 'canvas-1')
    const data = (events[0] as { data: Record<string, unknown> }).data
    expect(data.aggregate).toBe(CANVAS_AGENT_RUNNER_AGGREGATE)
    expect(data.aggregateId).toBe('ticket-1')
    expect(data.eventType).toBe('start')
    expect(data.payload).toMatchObject({ ticketId: 'ticket-1', canvasId: 'canvas-1' })
  })

  it('enqueue stop writes a stop event', async () => {
    const events: unknown[] = []
    const tx = { outboxEvent: { create: async (a: unknown) => events.push(a) } }
    await enqueueCanvasAgentRunnerStop(tx as never, 'ticket-1', 'canvas-1')
    const data = (events[0] as { data: Record<string, unknown> }).data
    expect(data.eventType).toBe('stop')
  })
})

describe('processCanvasAgentRunner start', () => {
  const runnerEnv = { url: process.env.CANVAS_RUNNER_URL, token: process.env.DOOP_SERVICE_TOKEN }
  afterEach(() => {
    process.env.CANVAS_RUNNER_URL = runnerEnv.url
    process.env.DOOP_SERVICE_TOKEN = runnerEnv.token
    vi.unstubAllGlobals()
  })

  const baseIntent = {
    id: 'ticket-1',
    status: 'PAID',
    canvasProvider: 'doop-hosted',
    canvasId: 'canvas-1',
    agentRunnerSealed: 'sealed-blob',
    sellerPubkey: 's'.repeat(64),
    offer: { agentProfile: { name: 'Builder' }, agentConfigMeta: { canvas: { provider: 'doop-hosted', agentInCanvas: true } } },
  }

  it('no-ops (never starts) when the ticket is terminal at processing time', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetchMock)
    const { prisma, updates } = fakePrisma({ ...baseIntent, status: 'COMPLETED' })
    await processCanvasAgentRunner(prisma as never, fakeEvent('ticket-1', 'start'))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it('no-ops when the offer no longer opts into agent-in-canvas', async () => {
    const intent = { ...baseIntent, offer: { agentProfile: { id: 'ap-1', name: 'Builder', ownerPubkey: 's'.repeat(64) }, agentConfigMeta: { canvas: { provider: 'doop-hosted', agentInCanvas: false } } } }
    const { prisma, updates } = fakePrisma(intent)
    await processCanvasAgentRunner(prisma as never, fakeEvent('ticket-1', 'start'))
    expect(updates).toHaveLength(0)
  })

  it('no-ops when the persona is not relayed yet (waits for the seller re-seal)', async () => {
    const { prisma, updates } = fakePrisma({ ...baseIntent, agentRunnerSealed: null })
    await processCanvasAgentRunner(prisma as never, fakeEvent('ticket-1', 'start'))
    expect(updates).toHaveLength(0)
  })

  it('calls runner control and marks the ticket running on success', async () => {
    process.env.CANVAS_RUNNER_URL = 'http://runner.internal:4010'
    process.env.DOOP_SERVICE_TOKEN = 'token'
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetchMock)

    const { prisma, updates } = fakePrisma(baseIntent)
    await processCanvasAgentRunner(prisma as never, fakeEvent('ticket-1', 'start'))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string; headers: Record<string, string> }]
    expect(url).toBe('http://runner.internal:4010/control/start')
    const body = JSON.parse(init.body)
    expect(body.ticketId).toBe('ticket-1')
    expect(body.canvasId).toBe('canvas-1')
    expect(body.sealed).toBe('sealed-blob')
    expect(body.agentName).toBe('Builder')

    const statusUpdates = updates.filter(u => (u as { data: Record<string, unknown> }).data?.agentRunnerStatus !== undefined)
    expect((statusUpdates[0] as { data: Record<string, unknown> }).data.agentRunnerStatus).toBe('starting')
    expect((statusUpdates.at(-1) as { data: Record<string, unknown> }).data.agentRunnerStatus).toBe('running')
  })

  it('marks failed + throws when runner control is down', async () => {
    process.env.CANVAS_RUNNER_URL = 'http://runner.internal:4010'
    process.env.DOOP_SERVICE_TOKEN = 'token'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })))

    const { prisma, updates } = fakePrisma(baseIntent)
    await expect(processCanvasAgentRunner(prisma as never, fakeEvent('ticket-1', 'start'))).rejects.toThrow(/HTTP 503/)
    const failed = updates.filter(u => (u as { data: Record<string, unknown> }).data?.agentRunnerStatus === 'failed')
    expect(failed).toHaveLength(1)
  })

  it('stop marks the ticket stopped after a successful runner call', async () => {
    process.env.CANVAS_RUNNER_URL = 'http://runner.internal:4010'
    process.env.DOOP_SERVICE_TOKEN = 'token'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })))

    const { prisma, updates } = fakePrisma({ ...baseIntent, agentRunnerStatus: 'running' })
    await processCanvasAgentRunner(prisma as never, fakeEvent('ticket-1', 'stop'))
    const stopped = updates.filter(u => (u as { data: Record<string, unknown> }).data?.agentRunnerStatus === 'stopped')
    expect(stopped).toHaveLength(1)
    const last = updates.at(-1) as { data: Record<string, unknown> }
    expect(last.data.agentRunnerStoppedAt).toBeInstanceOf(Date)
  })

  it('stop is a no-op for a ticket whose runner never started', async () => {
    process.env.CANVAS_RUNNER_URL = 'http://runner.internal:4010'
    process.env.DOOP_SERVICE_TOKEN = 'token'
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetchMock)

    const { prisma, updates } = fakePrisma({ ...baseIntent, agentRunnerStatus: 'none' })
    await processCanvasAgentRunner(prisma as never, fakeEvent('ticket-1', 'stop'))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })
})

describe('requestRunnerTicketPubkey', () => {
  afterEach(() => {
    process.env.CANVAS_RUNNER_URL = undefined
    process.env.DOOP_SERVICE_TOKEN = undefined
    vi.unstubAllGlobals()
  })

  it('returns the runner pubkey from the control API', async () => {
    process.env.CANVAS_RUNNER_URL = 'http://runner.internal:4010'
    process.env.DOOP_SERVICE_TOKEN = 'token'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ pubkey: 'a'.repeat(64) }) })))
    const pubkey = await requestRunnerTicketPubkey('ticket-1')
    expect(pubkey).toBe('a'.repeat(64))
  })

  it('throws when the runner is not configured', async () => {
    delete process.env.CANVAS_RUNNER_URL
    await expect(requestRunnerTicketPubkey('ticket-1')).rejects.toThrow(/not configured/)
  })
})
