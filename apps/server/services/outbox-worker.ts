import type { PrismaClient } from '@prisma/client'
import type { OutboxEvent, Offer } from '@prisma/client'
import { OFFER_INDEX_ALIAS, OFFER_INDEX_NAME, OFFER_INDEX_SETTINGS, type OfferSearchDocument } from './search-config.js'
import { getMeili } from '../lib/meili.js'
import { isProfileIndexable } from './tradeVisibility.js'
import { processCanvasProbe } from './canvas-probe.js'
import { processCanvasProvisioning } from './canvas-provisioning.js'
import { processCanvasLifecycle } from './canvas-lifecycle.js'
import { processCanvasAgentRunner } from './canvas-agent-runner.js'
import { readCanvasConfig } from '../lib/canvas-config.js'

const BATCH_SIZE = 50
const MEILI_TASK_TIMEOUT_MS = 15_000

/**
 * FU-233-C: addDocuments/deleteDocument only *enqueue* a Meili task — the
 * task itself can still fail asynchronously (e.g. invalid_document_id),
 * which previously left the outbox event DONE while the document silently
 * never reached the index. Await the task and throw on failure so the
 * poll loop's retry/DEAD handling records the real error in `lastError`.
 */
async function awaitMeiliTask(client: NonNullable<ReturnType<typeof getMeili>>, taskUid: number): Promise<void> {
  const task = await client.waitForTask(taskUid, { timeOutMs: MEILI_TASK_TIMEOUT_MS })
  if (task.status === 'failed') {
    throw new Error(`Meili task ${task.type} failed: ${task.error?.code ?? 'unknown'} — ${task.error?.message ?? ''}`)
  }
}
const MAX_ATTEMPTS = 5

interface ProcessedOffer extends Offer {
  company: { name: string | null; logoUrl: string | null } | null
  // ADR-313 D1: only populated for AGENT_SETUP offers.
  // ADR-315 D3: isVerified joins the embedded shape so the search document
  // can carry the badge flag without a re-fetch.
  agentProfile: { capabilities: string[]; reputationScore: number | null; isVerified: boolean } | null
}

function buildOfferDocument(offer: ProcessedOffer): OfferSearchDocument {
  return {
    id: offer.id,
    title: offer.title,
    description: offer.description || '',
    priceSats: offer.priceSats,
    offerType: offer.offerType,
    category: offer.category,
    categoryCode: offer.categoryCode,
    gammaTags: offer.gammaTags,
    subcategory: null,
    images: Array.isArray(offer.images) ? (offer.images as string[]) : null,
    country: offer.country,
    region: offer.region,
    city: offer.city,
    companyName: offer.company?.name ?? null,
    companyLogoUrl: offer.company?.logoUrl ?? null,
    creatorPubkey: offer.creatorPubkey,
    publishedAt: offer.publishedAt ? new Date(offer.publishedAt).getTime() : null,
    createdAt: new Date(offer.createdAt).getTime(),
    source: offer.source,
    isRemote: offer.isRemote,
    language: offer.language,
    status: offer.status,
    agentCapabilities: offer.agentProfile?.capabilities ?? [],
    agentBillingModel: offer.agentBillingModel,
    agentReputationScore: offer.agentProfile?.reputationScore ?? null,
    agentIsVerified: offer.agentProfile?.isVerified ?? false,
    // ADR-342 D1 (amendment A1): flat denormalized canvas facet so "has a
    // collaboration canvas" is filterable — the nested agentConfigMeta.canvas
    // object stays the source of truth; null for non-AGENT_SETUP / no canvas.
    canvasProvider: offer.offerType === 'AGENT_SETUP' ? (readCanvasConfig(offer.agentConfigMeta)?.provider ?? null) : null,
    // ADR-370 D6 (Phase 2): opt-in agent-in-canvas flag next to the provider
    // facet (index v4). False for non-AGENT_SETUP / doop-local / opt-out.
    canvasAgentInCanvas: offer.offerType === 'AGENT_SETUP'
      ? (readCanvasConfig(offer.agentConfigMeta)?.agentInCanvas ?? false)
      : false,
  }
}

export async function processOfferUpsert(prisma: PrismaClient, event: OutboxEvent): Promise<void> {
  const client = getMeili()
  if (!client) throw new Error('Meilisearch not configured')

  const offer = await prisma.offer.findUnique({
    where: { id: event.aggregateId },
    include: {
      company: { select: { name: true, logoUrl: true } },
      creator: { select: { profileVisibility: true } },
      // ADR-315 D3: isVerified joins the embedded select so the badge facet
      // updates whenever ADMIN toggles verification (the admin endpoint
      // re-enqueues an outbox event for every offer of that agent).
      agentProfile: { select: { capabilities: true, reputationScore: true, isVerified: true } },
    },
  })

  if (!offer) {
    const task = await client.index(OFFER_INDEX_ALIAS).deleteDocument(event.aggregateId)
    await awaitMeiliTask(client, task.taskUid)
    return
  }

  // ADR-270 D7: Never index variation children directly in search surfaces
  if (offer.productType === 'variation') {
    try {
      const task = await client.index(OFFER_INDEX_ALIAS).deleteDocument(offer.id)
      await awaitMeiliTask(client, task.taskUid)
    } catch {
      // document might not exist, ignore
    }
    // If child is linked to a parent, ensure the parent document is re-indexed
    if (offer.parentOfferId) {
      await prisma.outboxEvent.create({
        data: {
          aggregate: 'offer',
          aggregateId: offer.parentOfferId,
          eventType: 'upsert',
          payload: { id: offer.parentOfferId },
        },
      }).catch(() => {})
    }
    return
  }

  // ADR-159 §D3: never index offers from PRIVATE-profile creators.
  // Mirrors the DB browse/search `where.creator` filter (ADR-152 Phase 4.2)
  // so the global Meilisearch index can never leak PRIVATE-profile offers.
  if (!isProfileIndexable(offer.creator?.profileVisibility)) {
    const task = await client.index(OFFER_INDEX_ALIAS).deleteDocument(offer.id)
    await awaitMeiliTask(client, task.taskUid)
    return
  }

  const doc = buildOfferDocument(offer)

  // ADR-270 D7: Parent variable offer aggregates min child price and child facet keywords
  if (offer.productType === 'variable') {
    const children = await prisma.offer.findMany({
      where: {
        parentOfferId: offer.id,
        status: 'ACTIVE',
        listingVisibility: { not: 'hidden' },
      },
      select: { priceSats: true, variantValues: true },
    })
    if (children.length > 0) {
      const childPrices = children.map(c => c.priceSats).filter(p => typeof p === 'number')
      if (childPrices.length > 0) {
        doc.priceSats = Math.min(...childPrices)
      }
      const facetValues: string[] = []
      for (const child of children) {
        if (child.variantValues && typeof child.variantValues === 'object') {
          facetValues.push(...Object.values(child.variantValues as Record<string, string>))
        }
      }
      if (facetValues.length > 0) {
        doc.description = [doc.description, Array.from(new Set(facetValues)).join(' ')].filter(Boolean).join(' ')
      }
    }
  }

  const task = await client.index(OFFER_INDEX_ALIAS).addDocuments([doc])
  await awaitMeiliTask(client, task.taskUid)
}

async function processOfferDelete(event: OutboxEvent): Promise<void> {
  const client = getMeili()
  if (!client) throw new Error('Meilisearch not configured')
  const task = await client.index(OFFER_INDEX_ALIAS).deleteDocument(event.aggregateId)
  await awaitMeiliTask(client, task.taskUid)
}

/**
 * ADR-159 §D3: keep the global search index in sync when a creator flips their
 * ProfileVisibility. PRIVATE → purge all of their offer docs from Meilisearch
 * immediately ("KEIN globaler Index"); back to an indexable state (PUBLIC /
 * PSEUDO_PRIVATE) → re-enqueue upsert events so the guarded indexer re-adds
 * them. No-op when the change is not index-relevant (e.g. PUBLIC↔PSEUDO_PRIVATE).
 * Best-effort: Meilisearch is optional, errors are logged and swallowed.
 */
export async function syncCreatorOfferIndex(
  prisma: PrismaClient,
  creatorPubkey: string,
  oldProfileVisibility: string | null | undefined,
  newProfileVisibility: string,
): Promise<void> {
  if (isProfileIndexable(oldProfileVisibility) === isProfileIndexable(newProfileVisibility)) return

  const offers = await prisma.offer.findMany({ where: { creatorPubkey }, select: { id: true } })
  const ids = offers.map((o) => o.id)
  if (ids.length === 0) return

  if (!isProfileIndexable(newProfileVisibility)) {
    const client = getMeili()
    if (!client) return
    try {
      const task = await client.index(OFFER_INDEX_ALIAS).deleteDocuments(ids)
      await awaitMeiliTask(client, task.taskUid)
    } catch (err) {
      console.error('[outbox-worker] syncCreatorOfferIndex purge error:', err)
    }
    return
  }

  // Became indexable again: enqueue re-index tasks through the guarded indexer.
  for (const id of ids) {
    try {
      await prisma.outboxEvent.create({
        data: { aggregate: 'offer', aggregateId: id, eventType: 'upsert', payload: { reindex: true } },
      })
    } catch (err) {
      console.error('[outbox-worker] syncCreatorOfferIndex reindex enqueue error:', err)
    }
  }
}

async function initializeIndex(): Promise<void> {
  const client = getMeili()
  if (!client) return
  try {
    await client.getIndex(OFFER_INDEX_NAME)
  } catch {
    await client.createIndex(OFFER_INDEX_NAME, { primaryKey: 'id' })
  }
  await client.index(OFFER_INDEX_NAME).updateSettings(OFFER_INDEX_SETTINGS)
  try {
    await client.updateIndex(OFFER_INDEX_NAME, { primaryKey: 'id' })
  } catch { /* already set */ }
  try {
    await client.swapIndexes([{ indexes: [OFFER_INDEX_NAME, OFFER_INDEX_ALIAS] }])
  } catch { /* swap failed */ }
}

async function ensureIndex(): Promise<void> {
  const client = getMeili()
  if (!client) return
  try {
    const indexes = await client.getIndexes()
    const aliasIndex = indexes.results.find((i: any) => i.uid === OFFER_INDEX_ALIAS)
    if (aliasIndex) {
      // Re-apply settings on every boot: the alias index may have been created
      // implicitly by a document add (then it has NO filterable attributes and
      // every filtered search errors into the DB fallback), and new filterable
      // attributes would otherwise never reach existing deployments.
      await client.index(OFFER_INDEX_ALIAS).updateSettings(OFFER_INDEX_SETTINGS)
      return
    }

    const versionIndex = indexes.results.find((i: any) => i.uid === OFFER_INDEX_NAME)
    if (!versionIndex) {
      await client.createIndex(OFFER_INDEX_NAME, { primaryKey: 'id' })
    }

    await client.index(OFFER_INDEX_NAME).updateSettings(OFFER_INDEX_SETTINGS)

    try {
      await client.swapIndexes([{ indexes: [OFFER_INDEX_NAME, OFFER_INDEX_ALIAS] }])
    } catch {
      const meiliIndex = client.index(OFFER_INDEX_NAME)
      await meiliIndex.updateSettings(OFFER_INDEX_SETTINGS)
    }
  } catch (err) {
    console.error('[outbox-worker] ensureIndex error:', err)
  }
}

export class OutboxWorker {
  private running = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private draining = false
  private baseDelayMs = 1000
  private maxDelayMs = 30000
  private attempt = 0

  start(prisma: PrismaClient): void {
    if (this.running) return
    this.running = true
    this.attempt = 0
    this.init(prisma)
  }

  private async init(prisma: PrismaClient): Promise<void> {
    await ensureIndex()
    this.schedule(prisma)
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.draining = true
  }

  async stopAndDrain(prisma: PrismaClient): Promise<void> {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.draining = true
    await new Promise(resolve => setTimeout(resolve, 30000))
    this.draining = false
  }

  private schedule(prisma: PrismaClient): void {
    if (!this.running) return
    const delay = Math.min(this.baseDelayMs * Math.pow(2, this.attempt) + Math.random() * 500, this.maxDelayMs)
    this.timer = setTimeout(() => {
      this.poll(prisma).catch(console.error)
    }, delay)
  }

  private async poll(prisma: PrismaClient): Promise<void> {
    // ADR-342 D2: canvas-probe events must also flow when Meilisearch is not
    // configured, so polling no longer short-circuits on !getMeili() — the
    // offer branch is guarded per-event instead (offer events stay PENDING
    // until Meili is back, exactly like the old whole-poll early return).
    if (!this.running) {
      this.schedule(prisma)
      return
    }

    try {

      const meiliReady = getMeili() != null
      const events = await prisma.$queryRaw<OutboxEvent[]>`
        UPDATE "OutboxEvent"
        SET status = 'PROCESSING'
        WHERE id IN (
          SELECT id FROM "OutboxEvent"
          WHERE status = 'PENDING'
            AND (aggregate <> 'offer' OR ${meiliReady})
          ORDER BY "createdAt" ASC
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *
      `

      this.attempt = 0

      for (const event of events) {
        try {
          if (event.aggregate === 'offer') {
            if (event.eventType === 'upsert') {
              await processOfferUpsert(prisma, event)
            } else if (event.eventType === 'delete') {
              await processOfferDelete(event)
            }
          } else if (event.aggregate === 'canvas-probe' && event.eventType === 'probe') {
            // ADR-342 D2: async doop-local health probe (P1 — never in the
            // offer-save request path).
            await processCanvasProbe(prisma, event)
          } else if (event.aggregate === 'canvas-provision' && event.eventType === 'provision') {
            // ADR-342 D3 (Phase B) + ADR-370 D2 (Phase 1, FU-670): async
            // doop-hosted canvas provisioning (A2 — never in the payment or
            // workspace-create request path). Two event shapes dispatch here:
            // ticket-anchored (payload { ticketId }, enqueued at first PAID)
            // and workspace-anchored (legacy + ADR-352 coop workspaces).
            // Failures mark the anchor 'failed' and the event stays DONE; the
            // ticket UI's retry action (POST /api/tickets/:id/canvas-retry)
            // re-enqueues.
            await processCanvasProvisioning(prisma, event)
          } else if (event.aggregate === 'canvas-lifecycle') {
            // ADR-353 (FU-547): terminal ticket states lock the hosted
            // canvas read-only, reopen unlocks. Unlike provisioning this
            // handler THROWS on failure — a missed lock is a silent policy
            // violation, so the bounded retry (MAX_ATTEMPTS → DEAD) applies.
            await processCanvasLifecycle(prisma, event)
          } else if (event.aggregate === 'canvas-agent-runner') {
            // ADR-370 D4/D5 (Phase 4, FU-673): start/stop the canvas agent
            // runner (the separate process that acts as the seller's agent on
            // the ticket canvas via doop MCP). Start is best-effort with a
            // bounded retry (a transient runner outage should not silently
            // strand the agent); stop is a policy chokepoint like lifecycle.
            await processCanvasAgentRunner(prisma, event)
          }

          await prisma.outboxEvent.update({
            where: { id: event.id },
            data: { status: 'DONE', processedAt: new Date() },
          })
        } catch (err) {
          const attempts = event.attempts + 1
          const lastError = err instanceof Error ? err.message : String(err)

          if (attempts >= MAX_ATTEMPTS) {
            await prisma.outboxEvent.update({
              where: { id: event.id },
              data: { status: 'DEAD', attempts, lastError },
            })
          } else {
            await prisma.outboxEvent.update({
              where: { id: event.id },
              data: { status: 'PENDING', attempts, lastError },
            })
          }
        }
      }
    } catch (err) {
      console.error('[outbox-worker] poll error:', err)
      this.attempt++
    }

    this.schedule(prisma)
  }
}