/**
 * Reindex offers that exist in Postgres but are missing from Meilisearch.
 *
 * Root cause this heals: the catalog offer-creation routes
 * (POST /api/catalog/:catalogId/products and
 * POST /api/catalog/:catalogId/products/:productId/offers) created offers
 * without an outbox event, so the OutboxWorker never indexed them. The offers
 * were visible via /api/offers (Home sliders) but invisible in /api/search
 * (Buy dashboard + /search marketplace) when SEARCH_BACKEND=meilisearch.
 * The routes now write outbox events; this script heals the rows created
 * before that fix.
 *
 * The script diffs ALL offer ids (any status) against the Meili index —
 * DRAFT offers are indexed too (search filters status=ACTIVE at query time),
 * so comparing only ACTIVE rows would re-enqueue DRAFTs on every run.
 * PRIVATE-profile creators are safe: the worker's processOfferUpsert guard
 * purges instead of indexing (ADR-159 §D3).
 *
 * Idempotent: re-running finds no missing ids and exits.
 *
 * Pass `--all` to re-enqueue EVERY offer, not just missing ones. This also
 * heals stale docs whose DB row changed outside the outbox (e.g. account
 * deletions from before the FU-159-A fix, whose docs kept status=ACTIVE) —
 * the OutboxWorker rebuilds each doc from current DB truth.
 *
 * Usage:
 *   npx tsx apps/server/scripts/reindex-missing-offers.ts [--all]
 *
 * Runs against the DATABASE_URL and MEILISEARCH_URL / MEILISEARCH_MASTER_KEY
 * in .env (root). Point to the target environment first.
 * Requires the app's OutboxWorker to be running (SEARCH_BACKEND=meilisearch).
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
dotenv.config({ path: resolve(__rootDir, '.env') })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { MeiliSearch } from 'meilisearch'
import { OFFER_INDEX_ALIAS, OFFER_INDEX_NAME } from '../services/search-config.js'

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL! })) })

async function run(): Promise<void> {
  if (!process.env.MEILISEARCH_URL) {
    throw new Error('MEILISEARCH_URL not set — nothing to diff against.')
  }
  const client = new MeiliSearch({
    host: process.env.MEILISEARCH_URL,
    apiKey: process.env.MEILISEARCH_MASTER_KEY,
  })

  // Resolve the live index uid the same way the search route does.
  const indexes = await client.getIndexes()
  const uid = indexes.results.some((i: any) => i.uid === OFFER_INDEX_ALIAS)
    ? OFFER_INDEX_ALIAS
    : indexes.results.some((i: any) => i.uid === OFFER_INDEX_NAME)
      ? OFFER_INDEX_NAME
      : null
  if (!uid) {
    throw new Error(`Neither ${OFFER_INDEX_ALIAS} nor ${OFFER_INDEX_NAME} exists in Meilisearch.`)
  }

  const offers = await prisma.offer.findMany({ select: { id: true } })
  const docIds = new Set<string>()
  let offset = 0
  const pageSize = 1000
  for (;;) {
    const page = await client.index(uid).getDocuments({ limit: pageSize, offset, fields: ['id'] })
    for (const doc of page.results) docIds.add(String(doc.id))
    if (page.results.length < pageSize) break
    offset += pageSize
  }

  const reindexAll = process.argv.includes('--all')
  const targets = reindexAll ? offers : offers.filter(o => !docIds.has(o.id))
  console.log(`Offers in DB: ${offers.length} · docs in Meili (${uid}): ${docIds.size} · ${reindexAll ? 'reindexing ALL' : `missing: ${targets.length}`}`)
  if (targets.length === 0) {
    console.log('Nothing to do.')
    return
  }

  for (const o of targets) {
    await prisma.outboxEvent.create({
      data: { aggregate: 'offer', aggregateId: o.id, eventType: 'upsert', payload: { reindex: true } },
    })
    console.log(`ENQUEUED ${o.id}`)
  }
  console.log(`Done: ${targets.length} upsert events enqueued. The OutboxWorker will index them shortly.`)
}

run()
  .catch((err) => { console.error(err); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
