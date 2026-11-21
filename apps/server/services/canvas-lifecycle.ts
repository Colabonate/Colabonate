/**
 * ADR-353 (closes FU-547) + ADR-370 D2/D7 (Phase 1, FU-670): canvas lifecycle —
 * terminal ticket states freeze the doop-hosted canvas read-only (owner
 * decisions 2026-08-30: read-only = JA; Q1 every terminal state; Q2 reopen
 * unlocks; Q3 comments stay writable — enforced on the doop side).
 *
 * Anchor model since ADR-370 Phase 1: the doop-hosted binding is snapshotted
 * onto the **Ticket** (created at purchase, provisioned at first PAID) — a
 * canvas can be ready with NO Workspace row at all (canvas-only setups, fix
 * G2). `enqueueCanvasLifecycleForTicket()` therefore consults the ticket's
 * canvas columns first and only falls back to the legacy Workspace binding
 * (pre-Phase-1 tickets). Cooperation-anchored workspaces (ADR-352) have no
 * ticket; they use `enqueueCanvasLifecycleForWorkspace()`.
 *
 * The outbox handler calls the fork-side service route
 * `POST {DOOP_SERVICE_URL}/api/service/set-canvas-lock` (idempotent,
 * env-token-guarded). `processCanvasLifecycle` is anchor-agnostic (payload
 * carries canvasId + locked), so no dispatch change is needed for the
 * ticket-bound events.
 *
 * Retry policy (deliberately unlike provisioning, ADR-342): a missed lock is
 * a silent policy violation, so failures propagate and the OutboxWorker's
 * bounded retry applies (MAX_ATTEMPTS → DEAD). The lock call is idempotent.
 *
 * Key-management rule (FU-195-C): DOOP_SERVICE_TOKEN never appears in logs
 * or client payloads; error logging is limited to status codes/messages.
 */
import type { OutboxEvent, PrismaClient, Prisma } from '@prisma/client'
import type { PrismaTransactionClient } from '../lib/outbox.js'
import { doopServiceRequest } from './canvas-provisioning.js'
import { enqueueCanvasAgentRunnerStop } from './canvas-agent-runner.js'

export const CANVAS_LIFECYCLE_AGGREGATE = 'canvas-lifecycle'
const SERVICE_TIMEOUT_MS = 5_000

/** D1: every state from which the ticket never becomes active again. */
const TERMINAL_TICKET_STATUSES = new Set(['COMPLETED', 'DISPUTED', 'CANCELLED', 'REFUNDED'])

type LifecycleClient = PrismaTransactionClient | PrismaClient

export function isTerminalTicketStatus(status: string): boolean {
  return TERMINAL_TICKET_STATUSES.has(status)
}

interface CanvasBinding {
  anchor: 'ticket' | 'workspace'
  aggregateId: string
  workspaceId?: string
  canvasId: string
}

/**
 * Resolve the provisioned hosted-canvas binding for a ticket. Ticket columns
 * are authoritative (ADR-370 D2 — canvas exists independently of a Workspace);
 * the legacy Workspace row is the fallback for pre-Phase-1 tickets.
 */
async function resolveReadyBindingForTicket(
  client: LifecycleClient,
  ticketId: string,
): Promise<CanvasBinding | null> {
  if (client.ticket?.findUnique) {
    const ticket = await client.ticket.findUnique({
      where: { id: ticketId },
      select: { canvasProvider: true, canvasProvisioningStatus: true, canvasId: true },
    })
    if (ticket?.canvasProvider === 'doop-hosted' && ticket.canvasProvisioningStatus === 'ready' && ticket.canvasId) {
      return { anchor: 'ticket', aggregateId: ticketId, canvasId: ticket.canvasId }
    }
  }
  if (client.workspace?.findUnique) {
    const workspace = await client.workspace.findUnique({
      where: { ticketId },
      select: { id: true, canvasId: true, canvasProvider: true, canvasProvisioningStatus: true },
    })
    if (workspace?.canvasProvider === 'doop-hosted' && workspace.canvasProvisioningStatus === 'ready' && workspace.canvasId) {
      return { anchor: 'workspace', aggregateId: workspace.id, workspaceId: workspace.id, canvasId: workspace.canvasId }
    }
  }
  return null
}

/**
 * Derive + enqueue the lock/unlock event for a ticket status transition.
 * No-op unless the transition crosses the terminal boundary in either
 * direction AND a ready hosted canvas binding exists (ticket-first, legacy
 * workspace fallback).
 */
export async function enqueueCanvasLifecycleForTicket(
  client: LifecycleClient,
  ticketId: string,
  prevStatus: string,
  nextStatus: string,
): Promise<void> {
  if (prevStatus === nextStatus) return
  const lock = isTerminalTicketStatus(nextStatus)
  const unlock = !lock && isTerminalTicketStatus(prevStatus)
  if (!lock && !unlock) return

  const binding = await resolveReadyBindingForTicket(client, ticketId)
  // No binding / not provisioned yet → nothing to lock now. The
  // terminal-before-ready race is closed inside processCanvasProvisioning.
  if (!binding) return

  const payload: Record<string, string | boolean> = {
    canvasId: binding.canvasId,
    locked: lock,
    ticketStatus: nextStatus,
  }
  if (binding.anchor === 'ticket') {
    payload.ticketId = ticketId
  } else if (binding.workspaceId) {
    payload.workspaceId = binding.workspaceId
  }

  await client.outboxEvent.create({
    data: {
      aggregate: CANVAS_LIFECYCLE_AGGREGATE,
      aggregateId: binding.aggregateId,
      eventType: lock ? 'lock' : 'unlock',
      payload: payload as unknown as Prisma.InputJsonValue,
    },
  })
}

/** Enqueue a lock for a ticket-bound canvas directly (provisioning-completion path). */
export async function enqueueCanvasLifecycleLockForTicket(
  client: LifecycleClient,
  ticketId: string,
  canvasId: string,
): Promise<void> {
  await client.outboxEvent.create({
    data: {
      aggregate: CANVAS_LIFECYCLE_AGGREGATE,
      aggregateId: ticketId,
      eventType: 'lock',
      payload: { ticketId, canvasId, locked: true },
    },
  })
}

/** Enqueue a lock for a workspace directly (coop/legacy provisioning-completion path). */
export async function enqueueCanvasLifecycleForWorkspace(
  client: LifecycleClient,
  workspaceId: string,
  canvasId: string,
): Promise<void> {
  await client.outboxEvent.create({
    data: {
      aggregate: CANVAS_LIFECYCLE_AGGREGATE,
      aggregateId: workspaceId,
      eventType: 'lock',
      payload: { workspaceId, canvasId, locked: true },
    },
  })
}

/**
 * OutboxWorker handler for `canvas-lifecycle` events. Calls the fork-side
 * lock route; throws on failure so the worker's bounded retry applies.
 */
export async function processCanvasLifecycle(prisma: PrismaClient, event: OutboxEvent): Promise<void> {
  const payload = (event.payload ?? {}) as { canvasId?: unknown; locked?: unknown; ticketId?: unknown }
  if (typeof payload.canvasId !== 'string' || !payload.canvasId || typeof payload.locked !== 'boolean') {
    // Malformed beyond repair — DONE without action, same discipline as the
    // probe handler (retrying can't fix a bad payload).
    console.error(`[canvas-lifecycle] event ${event.id}: malformed payload, skipping`)
    return
  }
  await doopServiceRequest(
    '/api/service/set-canvas-lock',
    { canvasId: payload.canvasId, locked: payload.locked },
    SERVICE_TIMEOUT_MS,
  )
  // ADR-370 D5 (Phase 4, FU-673): a lock means the ticket is terminal — the
  // canvas agent must stop mutating. Chokepointed HERE (not at the 13 enqueue
  // sites) because every terminal write path funnels into this handler. The
  // fork-side lock is the enforcement safety net even if the stop races.
  // Best-effort enqueue: a failure must not fail the already-successful lock.
  if (payload.locked === true && typeof payload.ticketId === 'string') {
    enqueueCanvasAgentRunnerStop(prisma, payload.ticketId, payload.canvasId).catch((err) =>
      console.error('[canvas-agent-runner] enqueue stop after lock failed:', err instanceof Error ? err.message : err),
    )
  }
}
