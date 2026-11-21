/**
 * Rename Offer ids that Meilisearch rejects as document ids.
 *
 * Meili document ids only allow [a-zA-Z0-9_-]. The pre-fix seed scripts
 * derived offer ids from titles without transliteration, producing ids like
 * `seed-offer-logo-design-für-startup` or `seed-offer-rgb-bitcoin-poster-(digital)`.
 * The OutboxWorker's addDocuments task then fails Meili-side with
 * `invalid_document_id` — silently, because the worker does not await the
 * task — and those offers never appear in Meili-backed search results.
 *
 * This script renames the affected offers in place (copy row under the
 * sanitized id, re-point all FK children, delete the old row) and enqueues
 * outbox upsert events so the running OutboxWorker indexes the renamed rows.
 *
 * Only seed data can be affected: real offers get cuid() ids, which are
 * always Meili-safe.
 *
 * Idempotent: re-running finds no invalid ids and exits.
 *
 * Usage:
 *   npx tsx apps/server/scripts/fix-meili-unsafe-seed-ids.ts
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

// Mirrors seedSlug() in prisma/seed.ts / prisma/seed-en.ts.
function sanitizeId(id: string): string {
  return id.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function run(): Promise<void> {
  const invalid = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Offer" WHERE id !~ '^[a-zA-Z0-9_-]+$'
  `
  if (invalid.length === 0) {
    console.log('No Meili-unsafe offer ids found — nothing to do.')
    return
  }

  let renamed = 0
  for (const { id: oldId } of invalid) {
    const newId = sanitizeId(oldId)
    const collision = await prisma.offer.findUnique({ where: { id: newId }, select: { id: true } })
    if (collision) {
      console.warn(`SKIP ${oldId} → ${newId} (target id already exists — resolve manually)`)
      continue
    }

    await prisma.$transaction([
      // Copy the full row under the sanitized id.
      prisma.$executeRaw`
        INSERT INTO "Offer"
        SELECT (jsonb_populate_record(NULL::"Offer", to_jsonb(o) || jsonb_build_object('id', ${newId}::text))).*
        FROM "Offer" o WHERE o.id = ${oldId}
      `,
      // Re-point every FK child, then drop the old row.
      prisma.$executeRaw`UPDATE "Ticket" SET "offerId" = ${newId} WHERE "offerId" = ${oldId}`,
      prisma.$executeRaw`UPDATE "OfferMilestone" SET "offerId" = ${newId} WHERE "offerId" = ${oldId}`,
      prisma.$executeRaw`UPDATE "OfferMember" SET "offerId" = ${newId} WHERE "offerId" = ${oldId}`,
      prisma.$executeRaw`UPDATE "Cooperation" SET "offerId" = ${newId} WHERE "offerId" = ${oldId}`,
      prisma.$executeRaw`UPDATE "Offer" SET "parentOfferId" = ${newId} WHERE "parentOfferId" = ${oldId}`,
      prisma.$executeRaw`DELETE FROM "Offer" WHERE id = ${oldId}`,
      // Let the OutboxWorker index the renamed row (requires SEARCH_BACKEND=meilisearch).
      prisma.outboxEvent.create({
        data: { aggregate: 'offer', aggregateId: newId, eventType: 'upsert', payload: { reindex: true } },
      }),
    ])
    console.log(`RENAMED ${oldId} → ${newId}`)
    renamed++
  }

  console.log(`Done: ${renamed}/${invalid.length} offer ids renamed. The OutboxWorker will index them shortly.`)
}

run()
  .catch((err) => { console.error(err); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
