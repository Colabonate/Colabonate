/**
 * Re-enqueue every Offer as an outbox "upsert" event so the OutboxWorker
 * rebuilds the Meilisearch offers index from the database.
 *
 * Needed after seeding (prisma/seed.ts writes no outbox events) or whenever
 * the Meili index is empty/stale while /api/offers has data. The running
 * server's OutboxWorker picks the events up and applies all indexing guards
 * (ADR-159 profile-visibility filtering, document shape).
 *
 * Idempotent: re-running only re-upserts documents by id.
 *
 * Usage:
 *   npx tsx apps/server/scripts/reindex-offers.ts
 *
 * Runs against the DATABASE_URL in .env (root). Point to the target DB first.
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
dotenv.config({ path: resolve(__rootDir, '.env') })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL! })) })

async function run() {
  const offers = await prisma.offer.findMany({ select: { id: true } })
  if (offers.length === 0) {
    console.log('No offers found — nothing to reindex.')
    return
  }

  const { count } = await prisma.outboxEvent.createMany({
    data: offers.map(o => ({
      aggregate: 'offer',
      aggregateId: o.id,
      eventType: 'upsert',
      payload: { reindex: true },
    })),
  })

  console.log(`Enqueued ${count} outbox upsert events for ${offers.length} offers.`)
  console.log('The server\'s OutboxWorker will index them shortly (requires a running server with SEARCH_BACKEND=meilisearch).')
}

run()
  .catch(err => { console.error(err); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
