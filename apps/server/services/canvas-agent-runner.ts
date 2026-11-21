/**
 * ADR-370 D1/D4/D5 (Phase 4, FU-673): canvas-agent-runner lifecycle.
 *
 * The runner is a SEPARATE deployable process (Owner decision 6, analogous to
 * apps/mcp-server) that connects to the ticket's doop-hosted canvas over MCP
 * (streamable HTTP) as the seller's configured agent, holding the decrypted
 * persona (seller's LLM provider key + system prompt, NIP-44 re-sealed to the
 * runner's per-ticket pubkey — ADR-306 discipline) in memory per session only.
 *
 * This server-side module owns the ORCHESTRATION, never the persona:
 *   - enqueue start/stop as `canvas-agent-runner` outbox events;
 *   - the worker handler calls the runner's control HTTP API
 *     (`{CANVAS_RUNNER_URL}/control/start|/control/stop`, guarded by the same
 *     DOOP_SERVICE_TOKEN server-to-server secret) with the ticket's sealed
 *     persona ciphertext — the plaintext never passes through this process;
 *   - it tracks intent in Ticket.agentRunnerStatus/StartedAt/StoppedAt so the
 *     ticket UI (Phase 5) can show agent state, and it can survive a runner
 *     restart (events are durable, idempotent).
 *
 * Triggers (enqueued from canvas-provisioning / canvas-lifecycle):
 *   - start: ticket canvas becomes 'ready' AND the offer declared
 *     agentConfigMeta.canvas.agentInCanvas === true (auto, opt-in — Owner
 *     decision 1) — also re-enqueued when the seller re-seals the persona via
 *     POST /api/tickets/:id/agent-runner-config (relay, Phase 4b).
 *   - stop: ticket reaches a terminal state (canvas locked) — chokepointed in
 *     processCanvasLifecycle so every terminal write path is covered.
 *
 * Retry policy: handler throws on failure → the OutboxWorker bounded retry
 * (MAX_ATTEMPTS → DEAD) applies. A start that never lands leaves the agent
 * off the canvas (visible via Ticket.agentRunnerStatus 'failed'); a stop that
 * never lands would leave a mutating agent after the ticket ended — the fork-
 * side lock (Phase 3, ADR-370 D7) is the enforcement safety net regardless.
 *
 * Key-management rule (FU-195-C): the sealed persona and any runner control
 * token never appear in logs or client payloads.
 */
import type { OutboxEvent, PrismaClient } from '@prisma/client'
import type { PrismaTransactionClient } from '../lib/outbox.js'
import { readCanvasConfig } from '../lib/canvas-config.js'

export const CANVAS_AGENT_RUNNER_AGGREGATE = 'canvas-agent-runner'

// Ticket.agentRunnerStatus values: 'none' | 'starting' | 'running' |
// 'stopping' | 'stopped' | 'failed' (schema column is a free string; the
// worker writes these literals).

type RunnerClient = PrismaTransactionClient | PrismaClient

// Mirror of canvas-lifecycle's terminal set. Kept local (not imported) to
// avoid a module cycle — canvas-lifecycle imports this module's stop enqueue.
// A drift here is caught by the chokepoint test in canvas-lifecycle.test.ts.
const TERMINAL_TICKET_STATUSES = new Set(['COMPLETED', 'DISPUTED', 'CANCELLED', 'REFUNDED'])

function isTerminalTicketStatus(status: string): boolean {
  return TERMINAL_TICKET_STATUSES.has(status)
}

/** The runner control endpoint is configured alongside the doop bridge. */
function runnerControlBase(): string | null {
  const url = (process.env.CANVAS_RUNNER_URL ?? '').replace(/\/+$/, '')
  return url || null
}

/**
 * Enqueue a runner start for a ticket whose canvas is provisioned and whose
 * offer opted into agent-in-canvas. Idempotent at the outbox level: the worker
 * handler re-checks current state before acting.
 */
export async function enqueueCanvasAgentRunnerStart(
  client: RunnerClient,
  ticketId: string,
  canvasId: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  await client.outboxEvent.create({
    data: {
      aggregate: CANVAS_AGENT_RUNNER_AGGREGATE,
      aggregateId: ticketId,
      eventType: 'start',
      payload: { ticketId, canvasId, ...payload } as never,
    },
  })
}

/** Enqueue a runner stop (terminal ticket / canvas locked). Idempotent. */
export async function enqueueCanvasAgentRunnerStop(
  client: RunnerClient,
  ticketId: string,
  canvasId: string,
): Promise<void> {
  await client.outboxEvent.create({
    data: {
      aggregate: CANVAS_AGENT_RUNNER_AGGREGATE,
      aggregateId: ticketId,
      eventType: 'stop',
      payload: { ticketId, canvasId } as never,
    },
  })
}

/**
 * Load the ticket's runner intent: canvas binding + agentInCanvas opt-in
 * (from the live offer — the ticket snapshots the canvas binding, the opt-in
 * flag is offer-level) + the re-sealed persona if the seller already relayed
 * one + the CURRENT ticket status (terminal tickets must never (re)start).
 * Returns null when no runner applies to this ticket.
 */
async function loadRunnerIntent(prisma: PrismaClient, ticketId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      offer: {
        select: {
          agentProfile: { select: { name: true } },
          agentConfigMeta: true,
        },
      },
    },
  })
  if (!ticket) return null
  if (ticket.canvasProvider !== 'doop-hosted' || !ticket.canvasId) return null
  const canvas = readCanvasConfig(ticket.offer?.agentConfigMeta)
  if (canvas?.provider !== 'doop-hosted' || canvas.agentInCanvas !== true) return null
  return {
    ticketId,
    canvasId: ticket.canvasId,
    sealed: ticket.agentRunnerSealed ?? null,
    agentName: ticket.offer?.agentProfile?.name ?? 'Canvas Agent',
    sellerPubkey: ticket.sellerPubkey,
    // Terminal tickets never (re)start — the relay route rejects them with a
    // 409, and this processing-time check closes the in-flight window (a stop
    // may still be queued behind this event; the fork-side lock is the net).
    status: ticket.status,
  }
}

interface ControlResponse {
  ok: boolean
  status?: string
  error?: string
}

/**
 * Call the runner's control API. The runner resolves the per-ticket keypair,
 * decrypts the sealed persona in memory, and starts/stops its caretaker loop.
 * Shared server-to-server secret (DOOP_SERVICE_TOKEN) mirrors the doop bridge
 * discipline — never surfaced to clients, never logged.
 */
async function callRunnerControl(
  path: '/control/start' | '/control/stop',
  body: Record<string, unknown>,
): Promise<ControlResponse> {
  const base = runnerControlBase()
  if (!base) return { ok: false, error: 'CANVAS_RUNNER_URL not configured' }
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    signal: AbortSignal.timeout(8_000),
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${process.env.DOOP_SERVICE_TOKEN ?? ''}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    return { ok: false, error: `runner control ${path} failed with HTTP ${res.status}` }
  }
  return (await res.json()) as ControlResponse
}

/**
 * Fetch the runner's per-ticket ECDH public key (Phase 4b, ADR-370 D4). The
 * runner derives a deterministic per-ticket keypair (own master secret), so
 * the seller can re-seal the persona NIP-44 to this pubkey BEFORE the runner
 * is even started. Public key — safe to return to the ticket seller; never a
 * secret (same stance as the canister output-key).
 */
export async function requestRunnerTicketPubkey(ticketId: string): Promise<string> {
  const base = runnerControlBase()
  if (!base) throw new Error('CANVAS_RUNNER_URL not configured')
  const res = await fetch(`${base}/control/key/${encodeURIComponent(ticketId)}`, {
    method: 'GET',
    signal: AbortSignal.timeout(8_000),
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${process.env.DOOP_SERVICE_TOKEN ?? ''}`,
    },
  })
  if (!res.ok) throw new Error(`runner control /control/key failed with HTTP ${res.status}`)
  const data = (await res.json()) as { pubkey?: unknown }
  if (typeof data.pubkey !== 'string' || !/^[0-9a-f]{64}$/i.test(data.pubkey)) {
    throw new Error('runner control /control/key returned no valid pubkey')
  }
  return data.pubkey
}

/** Worker handler for `canvas-agent-runner` events (start/stop). */
export async function processCanvasAgentRunner(prisma: PrismaClient, event: OutboxEvent): Promise<void> {
  const payload = (event.payload ?? {}) as { ticketId?: unknown; canvasId?: unknown }
  if (typeof payload.ticketId !== 'string' || typeof payload.canvasId !== 'string') {
    console.error(`[canvas-agent-runner] event ${event.id}: malformed payload, skipping`)
    return
  }
  const { ticketId, canvasId } = payload

  if (event.eventType === 'start') {
    // Re-check intent at processing time (agent may have been toggled off, the
    // offer detached, or the ticket may have gone terminal while the event was
    // queued — e.g. provision raced a dispute/escrow-end) — cheap and keeps
    // the event stream honest. A terminal ticket must NEVER (re)start.
    const intent = await loadRunnerIntent(prisma, ticketId)
    if (!intent) return // no longer applies — no-op
    if (isTerminalTicketStatus(intent.status)) {
      // Terminal: no start. If a stop is still queued behind this event the
      // worker's stop branch will settle the status; if the ticket ended
      // before this runner ever ran, there is nothing to stop.
      return
    }
    if (intent.sealed === null) {
      // Persona not yet relayed: leave the ticket in 'none' — the relay
      // endpoint (Phase 4b) re-enqueues start once the seller re-seals.
      return
    }
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { agentRunnerStatus: 'starting', agentRunnerLastError: null },
    })
    const result = await callRunnerControl('/control/start', {
      ticketId,
      // Use the freshly-loaded binding — the event-payload canvasId can be
      // stale if the canvas was reprovisioned between enqueue and processing.
      canvasId: intent.canvasId,
      agentName: intent.agentName,
      sellerPubkey: intent.sellerPubkey,
      sealed: intent.sealed,
    })
    if (!result.ok) {
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { agentRunnerStatus: 'failed', agentRunnerLastError: result.error ?? 'runner start failed' },
      })
      throw new Error(result.error ?? 'runner start failed')
    }
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { agentRunnerStatus: 'running', agentRunnerStartedAt: new Date(), agentRunnerStoppedAt: null },
    })
    return
  }

  if (event.eventType === 'stop') {
    // Only act when a runner is (or was) actually in flight — a ticket that
    // never opted in / never had its persona relayed has no runner to stop.
    const current = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { agentRunnerStatus: true },
    })
    const status = current?.agentRunnerStatus
    if (!status || status === 'none' || status === 'stopped' || status === 'stopping') return
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { agentRunnerStatus: 'stopping', agentRunnerLastError: null },
    })
    const result = await callRunnerControl('/control/stop', { ticketId, canvasId })
    if (!result.ok) {
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { agentRunnerStatus: 'failed', agentRunnerLastError: result.error ?? 'runner stop failed' },
      })
      throw new Error(result.error ?? 'runner stop failed')
    }
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { agentRunnerStatus: 'stopped', agentRunnerStoppedAt: new Date() },
    })
    return
  }

  console.error(`[canvas-agent-runner] event ${event.id}: unknown eventType ${event.eventType}`)
}
