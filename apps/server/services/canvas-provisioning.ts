/**
 * ADR-342 D3/D4 (Phase B) + ADR-370 D2/D7 (Phase 1, FU-670): asynchronous
 * provisioning of the Colabonate-hosted doop canvas (`canvas.colabonate.app`)
 * for paid AGENT_SETUP tickets whose offer declares `canvas.provider ===
 * 'doop-hosted'`.
 *
 * Anchor model since ADR-370 Phase 1: the canvas binding is snapshotted onto
 * the **Ticket** at purchase and provisioning is auto-enqueued at the first
 * transition to PAID — a doop-hosted canvas can exist with NO Workspace row
 * (canvas-only setups, fix G2/G3). Two event shapes flow through the same
 * outbox aggregate:
 *
 *   ticket-anchored:  aggregateId = ticketId,  payload { ticketId }
 *                     (PAID hook, ticket-canvas retry — Phase 1+)
 *   workspace-anchored: aggregateId = workspaceId, payload { workspaceId }
 *                     (legacy + ADR-352 cooperation workspaces — unchanged)
 *
 * Provisioning NEVER runs inside the payment/workspace request path (review
 * amendment A2 — a doop outage must not block payment or workspace creation).
 * The worker calls the fork-side server-to-server route
 * (`POST {DOOP_SERVICE_URL}/api/service/provision-canvas`, guarded by
 * `DOOP_SERVICE_TOKEN` — see docs/adr342/doop-fork/README.md) and stores the
 * result on the anchor row:
 *
 *   canvasProvisioningStatus: 'pending' → 'ready' | 'failed'
 *   canvasId:                 doop canvas id (created, or the pinned one)
 *   canvasBuyerAccess:        D4a snapshot ('edit' | 'none') — materialized
 *                             at ticket creation, later offer edits don't
 *                             rewrite it.
 *
 * Failure policy: a failed provision marks the anchor 'failed' and the outbox
 * event is DONE (no silent retry loop) — the ticket UI exposes an explicit
 * retry action (POST /api/tickets/:id/canvas-retry), matching D3's button
 * contract.
 *
 * Key-management rule (FU-195-C): DOOP_SERVICE_TOKEN never appears in logs
 * or client payloads; error logging is limited to status codes/messages.
 */
import type { OutboxEvent, PrismaClient } from '@prisma/client'
import type { PrismaTransactionClient } from '../lib/outbox.js'
import { readCanvasConfig } from '../lib/canvas-config.js'
import {
  enqueueCanvasLifecycleForWorkspace,
  enqueueCanvasLifecycleLockForTicket,
  isTerminalTicketStatus,
} from './canvas-lifecycle.js'
import { enqueueCanvasAgentRunnerStart } from './canvas-agent-runner.js'

export const CANVAS_PROVISION_AGGREGATE = 'canvas-provision'
const SERVICE_TIMEOUT_MS = 5_000

/** The hosted-canvas bridge is configured only when both env vars are set. */
export function isCanvasHostedConfigured(): boolean {
  return Boolean(process.env.DOOP_SERVICE_URL && process.env.DOOP_SERVICE_TOKEN)
}

/** Enqueue workspace-anchored provisioning (legacy + ADR-352 coop workspaces). */
export async function enqueueCanvasProvisioning(
  tx: PrismaTransactionClient,
  workspaceId: string,
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      aggregate: CANVAS_PROVISION_AGGREGATE,
      aggregateId: workspaceId,
      eventType: 'provision',
      payload: { workspaceId },
    },
  })
}

/** Enqueue ticket-anchored provisioning (ADR-370 Phase 1 — PAID hook, retry). */
export async function enqueueCanvasProvisioningForTicket(
  tx: PrismaTransactionClient,
  ticketId: string,
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      aggregate: CANVAS_PROVISION_AGGREGATE,
      aggregateId: ticketId,
      eventType: 'provision',
      payload: { ticketId },
    },
  })
}

/**
 * ADR-370 D2 (fix G2): idempotent first-PAID hook — flips the ticket's
 * hosted-canvas provisioning to 'pending' and enqueues a ticket-anchored
 * canvas-provision event. No-op for non-AGENT_SETUP tickets, tickets without a
 * doop-hosted snapshot, and tickets already pending/ready. DB-only (never a
 * doop HTTP call — A2); callers invoke it fire-and-forget AFTER the ticket was
 * updated to PAID. Returns true when an event was enqueued.
 */
export async function enqueueProvisioningOnPaid(
  prisma: PrismaClient,
  ticketId: string,
): Promise<boolean> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { offerType: true, canvasProvider: true, canvasProvisioningStatus: true },
  })
  if (!ticket || ticket.offerType !== 'AGENT_SETUP') return false
  if (ticket.canvasProvider !== 'doop-hosted') return false
  if (ticket.canvasProvisioningStatus === 'pending' || ticket.canvasProvisioningStatus === 'ready') return false

  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({
      where: { id: ticketId },
      data: { canvasProvisioningStatus: 'pending' },
    })
    await enqueueCanvasProvisioningForTicket(tx, ticketId)
  })
  return true
}

interface DoopUserRef {
  pubkey: string
  displayName?: string
}

/**
 * Authenticated call against the fork-side service route. Never logs the
 * token; throws on non-2xx with the status code only. Shared with the
 * ADR-353/ADR-370 canvas-lifecycle handler (set-canvas-lock).
 */
export async function doopServiceRequest(
  path: string,
  body: unknown,
  timeoutMs: number = SERVICE_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const base = (process.env.DOOP_SERVICE_URL ?? '').replace(/\/+$/, '')
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
      authorization: `Bearer ${process.env.DOOP_SERVICE_TOKEN}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`doop service ${path} failed with HTTP ${res.status}`)
  }
  return (await res.json()) as Record<string, unknown>
}

/**
 * D4: mint a one-time, short-TTL login URL for a ticket participant on the
 * ticket's canvas. The URL is the only thing that crosses to the browser.
 */
export async function requestCanvasLoginUrl(user: DoopUserRef, canvasId: string): Promise<string> {
  const data = await doopServiceRequest('/api/service/login-url', { ...user, canvasId })
  if (typeof data.url !== 'string' || !data.url) {
    throw new Error('doop service login-url returned no url')
  }
  return data.url
}

/**
 * OutboxWorker handler for `canvas-provision` events. Dispatches on the event
 * payload: `{ ticketId }` → ticket-anchored (ADR-370), anything else → the
 * legacy workspace-anchored path (aggregateId = workspaceId).
 */
export async function processCanvasProvisioning(prisma: PrismaClient, event: OutboxEvent): Promise<void> {
  const payload = (event.payload ?? {}) as { ticketId?: unknown; workspaceId?: unknown }
  if (typeof payload.ticketId === 'string' && payload.ticketId) {
    await provisionForTicket(prisma, payload.ticketId)
    return
  }
  const workspaceId = typeof payload.workspaceId === 'string' ? payload.workspaceId : event.aggregateId
  await provisionForWorkspace(prisma, workspaceId)
}

/**
 * Ticket-anchored provisioning (ADR-370 Phase 1): creates (or binds the
 * pinned) canvas on the hosted instance for a ticket's canvas binding, with
 * seller = ticket seller (owner) and buyer = member iff the ticket's D4a
 * snapshot says `canvasBuyerAccess === 'edit'`. Writes the result onto the
 * Ticket; an existing Workspace row for this ticket is mirrored so legacy
 * workspace-scoped consumers keep working. Orchestrator/multi-party access is
 * FU-550 — out of V1 scope.
 */
async function provisionForTicket(prisma: PrismaClient, ticketId: string): Promise<void> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      offer: { select: { title: true, agentConfigMeta: true } },
      buyer: { select: { name: true } },
      seller: { select: { name: true } },
      workspace: { select: { id: true, canvasProvider: true, canvasProvisioningStatus: true } },
    },
  })
  if (!ticket) return // ticket deleted between enqueue and processing
  if (ticket.canvasProvider !== 'doop-hosted') return // config moved on
  if (ticket.canvasProvisioningStatus === 'ready' && ticket.canvasId) return // already done

  const fail = async (reason: string) => {
    console.error(`[canvas-provision] ticket ${ticket.id}: ${reason}`)
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { canvasProvisioningStatus: 'failed' },
    })
  }

  if (!isCanvasHostedConfigured()) {
    await fail('hosted canvas is not configured (DOOP_SERVICE_URL/DOOP_SERVICE_TOKEN missing)')
    return
  }

  try {
    const members: DoopUserRef[] = []
    if (ticket.canvasBuyerAccess !== 'none') {
      members.push({ pubkey: ticket.buyerPubkey, displayName: ticket.buyer?.name ?? undefined })
    }
    const data = await doopServiceRequest('/api/service/provision-canvas', {
      ticketId: ticket.id,
      name: ticket.offer?.title ?? `Workspace ${ticket.id.slice(0, 8)}`,
      // A pinned canvasId binds a pre-existing canvas instead of creating one.
      ...(ticket.canvasId ? { canvasId: ticket.canvasId } : {}),
      owner: { pubkey: ticket.sellerPubkey, displayName: ticket.seller?.name ?? undefined },
      members,
    })
    if (typeof data.canvasId !== 'string' || !data.canvasId) {
      await fail('provision-canvas returned no canvasId')
      return
    }
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { canvasId: data.canvasId, canvasProvisioningStatus: 'ready' },
    })
    // Mirror onto a workspace that already exists for this ticket (e.g. it was
    // created between the PAID enqueue and this worker pass) so workspace-scoped
    // consumers stay correct — never provisions twice (ticket is the anchor).
    if (ticket.workspace?.canvasProvider === 'doop-hosted' && ticket.workspace.canvasProvisioningStatus !== 'ready') {
      await prisma.workspace.update({
        where: { id: ticket.workspace.id },
        data: { canvasId: data.canvasId, canvasProvisioningStatus: 'ready' },
      })
    }
    // The provisioning HTTP call above can take seconds; the ticket may have
    // gone terminal while it was in flight. Re-read the CURRENT status instead
    // of trusting the pre-call snapshot for BOTH decisions below (runner start
    // gate + terminal lock chain) — otherwise a ticket that ended mid-provision
    // could get a ready-but-unlocked canvas and a runner that keeps mutating.
    const freshStatus = (await prisma.ticket.findUnique({
      where: { id: ticket.id },
      select: { status: true },
    }))?.status
    const currentStatus = freshStatus ?? ticket.status
    const terminalNow = isTerminalTicketStatus(currentStatus)

    // ADR-370 D5 (Phase 4, FU-673): once the canvas is ready AND the offer
    // opted into agent-in-canvas, enqueue the runner start. Never start on a
    // terminal ticket (lock below wins) — the worker also re-checks terminal
    // state at processing time (canvas-agent-runner.ts), so this gate is belt
    // and suspenders against the in-flight window.
    if (!terminalNow && (currentStatus === 'PAID' || currentStatus === 'IN_PROGRESS')) {
      const canvas = readCanvasConfig(ticket.offer?.agentConfigMeta)
      if (canvas?.provider === 'doop-hosted' && canvas.agentInCanvas === true) {
        await enqueueCanvasAgentRunnerStart(prisma, ticket.id, data.canvasId as string)
      }
    }
    // ADR-353/ADR-370 D7: a ticket that went terminal while provisioning was
    // pending must not hand out an editable canvas — chain the lock immediately.
    // Evaluated on the FRESH status so terminal-during-provisioning is caught.
    if (terminalNow) {
      await enqueueCanvasLifecycleLockForTicket(prisma, ticket.id, data.canvasId)
    }
  } catch (err) {
    // Convergent failure: mark failed, event stays DONE — the ticket UI's
    // retry action re-enqueues (D3). No token/key material in the log line.
    await fail(err instanceof Error ? err.message : String(err))
  }
}

/**
 * Legacy workspace-anchored provisioning (ADR-342 D3, unchanged for ADR-352
 * cooperation workspaces): creates (or binds the pinned) canvas on the hosted
 * instance and sets memberships per the D4a snapshot: seller = owner, buyer =
 * member iff canvasBuyerAccess === 'edit'. Orchestrator/multi-party access is
 * FU-550 — out of V1 scope.
 */
async function provisionForWorkspace(prisma: PrismaClient, workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      // ADR-352 D1: a Cooperation-anchored workspace has no Ticket at all —
      // sellerPubkey is resolved below via the AgentProfile owner instead
      // (same fallback the workspace-routes' authorization checks use).
      ticket: { select: { id: true, status: true, sellerPubkey: true, seller: { select: { name: true } } } },
      offer: { select: { title: true } },
      buyer: { select: { name: true } },
      agentProfile: { select: { ownerPubkey: true } },
    },
  })
  if (!workspace) return // workspace deleted between enqueue and processing
  if (workspace.canvasProvider !== 'doop-hosted') return // config moved on
  if (workspace.canvasProvisioningStatus === 'ready' && workspace.canvasId) return // already done

  const fail = async (reason: string) => {
    console.error(`[canvas-provision] workspace ${workspace.id}: ${reason}`)
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { canvasProvisioningStatus: 'failed' },
    })
  }

  if (!isCanvasHostedConfigured()) {
    await fail('hosted canvas is not configured (DOOP_SERVICE_URL/DOOP_SERVICE_TOKEN missing)')
    return
  }

  const sellerPubkey = workspace.ticket?.sellerPubkey ?? workspace.agentProfile?.ownerPubkey ?? null
  if (!sellerPubkey) {
    await fail('workspace has no resolvable seller/agent-owner pubkey')
    return
  }

  try {
    // Ticket-anchored: seller display name comes for free via the include
    // above (unchanged query shape). Cooperation-anchored (ADR-352 D1): no
    // Ticket exists, so the AgentProfile owner's name needs its own lookup.
    const sellerName = workspace.ticket
      ? workspace.ticket.seller.name
      : (await prisma.user.findUnique({ where: { pubkey: sellerPubkey }, select: { name: true } }))?.name
    const members: DoopUserRef[] = []
    if (workspace.canvasBuyerAccess !== 'none') {
      members.push({ pubkey: workspace.buyerPubkey, displayName: workspace.buyer.name ?? undefined })
    }
    const data = await doopServiceRequest('/api/service/provision-canvas', {
      // The fork-side contract names this `ticketId` (ADR-342 was designed
      // ticket-only) — a Cooperation-anchored workspace has no ticket, so the
      // workspace's own id is used instead. Fine for V1 (no cooperation +
      // doop-hosted combo has shipped yet); revisit if the fork route ever
      // needs to look the id back up against a real Ticket row.
      ticketId: workspace.ticket?.id ?? workspace.id,
      name: workspace.offer?.title ?? `Workspace ${workspace.id.slice(0, 8)}`,
      // A pinned canvasId binds a pre-existing canvas instead of creating one.
      ...(workspace.canvasId ? { canvasId: workspace.canvasId } : {}),
      owner: { pubkey: sellerPubkey, displayName: sellerName ?? undefined },
      members,
    })
    if (typeof data.canvasId !== 'string' || !data.canvasId) {
      await fail('provision-canvas returned no canvasId')
      return
    }
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { canvasId: data.canvasId, canvasProvisioningStatus: 'ready' },
    })
    // ADR-353: a ticket that went terminal while provisioning was pending
    // must not hand out an editable canvas — chain the lock immediately.
    // Re-read the ticket status (the HTTP call above takes seconds and the
    // pre-call snapshot may be stale) so terminal-during-provisioning is caught.
    if (workspace.ticket) {
      const freshTicket = await prisma.ticket.findUnique({
        where: { id: workspace.ticket.id },
        select: { status: true },
      })
      const ticketStatus = freshTicket?.status ?? workspace.ticket.status
      if (isTerminalTicketStatus(ticketStatus)) {
        await enqueueCanvasLifecycleForWorkspace(prisma, workspace.id, data.canvasId)
      }
    }
  } catch (err) {
    // Convergent failure: mark failed, event stays DONE — the ticket UI's
    // retry action re-enqueues (D3). No token/key material in the log line.
    await fail(err instanceof Error ? err.message : String(err))
  }
}
