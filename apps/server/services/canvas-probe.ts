/**
 * ADR-342 D2 (review amendment P1): asynchronous health probe for
 * `doop-local` canvas instances. The probe NEVER runs inside the
 * offer-save request path — saving enqueues a `canvas-probe` outbox event
 * and the OutboxWorker performs `GET {instanceUrl}/healthz` with a hard 2s
 * timeout, caching the result as `canvas.probeStatus` + `canvas.probeAt`
 * inside `Offer.agentConfigMeta`. The result gates only the DRAFT→ACTIVE
 * transition (see lib/canvas-config.ts:canvasPublishGate).
 *
 * FU-548 scope note: `/healthz` → `{ ok: true }` proves liveness, not that
 * the host is actually doop — the signature check is deliberately left to
 * FU-548 (upstream contribution).
 */
import type { OutboxEvent, PrismaClient } from '@prisma/client'
import type { PrismaTransactionClient } from '../lib/outbox.js'
import { readCanvasConfig, type CanvasProbeStatus } from '../lib/canvas-config.js'

export const CANVAS_PROBE_TIMEOUT_MS = 2_000
const CANVAS_PROBE_AGGREGATE = 'canvas-probe'

/** Enqueue a probe for an offer (idempotent per save — the worker re-reads current state). */
export async function enqueueCanvasProbe(
  tx: PrismaTransactionClient,
  offerId: string,
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      aggregate: CANVAS_PROBE_AGGREGATE,
      aggregateId: offerId,
      eventType: 'probe',
      payload: { offerId },
    },
  })
}

/** Perform the actual probe. Returns the status to cache. */
export async function probeCanvasInstance(instanceUrl: string): Promise<CanvasProbeStatus> {
  try {
    const res = await fetch(`${instanceUrl}/healthz`, {
      signal: AbortSignal.timeout(CANVAS_PROBE_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return 'unreachable'
    const body = (await res.json()) as { ok?: unknown }
    return body?.ok === true ? 'ok' : 'unreachable'
  } catch {
    return 'unreachable'
  }
}

/**
 * OutboxWorker handler for `canvas-probe` events. Writes the result back
 * into `agentConfigMeta.canvas` — but only when the instanceUrl that was
 * probed is still the configured one (a concurrent edit must not be
 * clobbered by a stale probe result).
 */
export async function processCanvasProbe(prisma: PrismaClient, event: OutboxEvent): Promise<void> {
  const offer = await prisma.offer.findUnique({
    where: { id: event.aggregateId },
    select: { id: true, agentConfigMeta: true },
  })
  if (!offer) return // offer deleted between enqueue and processing — nothing to do

  const meta = (offer.agentConfigMeta ?? null) as Record<string, unknown> | null
  const canvas = readCanvasConfig(meta)
  if (!canvas || canvas.provider !== 'doop-local' || !canvas.instanceUrl) return // config changed since enqueue

  const probeStatus = await probeCanvasInstance(canvas.instanceUrl)

  // Re-read inside the update's where-free read-modify-write: merge onto the
  // freshest meta and bail out if the canvas config moved on meanwhile.
  const fresh = await prisma.offer.findUnique({ where: { id: offer.id }, select: { agentConfigMeta: true } })
  const freshMeta = (fresh?.agentConfigMeta ?? null) as Record<string, unknown> | null
  const freshCanvas = readCanvasConfig(freshMeta)
  if (!freshCanvas || freshCanvas.provider !== 'doop-local' || freshCanvas.instanceUrl !== canvas.instanceUrl) return

  await prisma.offer.update({
    where: { id: offer.id },
    data: {
      agentConfigMeta: {
        ...(freshMeta ?? {}),
        canvas: {
          ...freshCanvas,
          probeStatus,
          probeAt: new Date().toISOString(),
        },
      },
    },
  })
}
