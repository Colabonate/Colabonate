/**
 * ADR-380: backfill the standard-category bridge for already-ingested offers.
 *
 * Two idempotent fixes over offers that carry Gamma `t` tags:
 *   1. An empty `categoryCode` is filled with the most specific category the
 *      tags resolve to (gamma-map-v2.json), so the offer shows up in the
 *      standard category tree, lists and counts.
 *   2. A REMOTE/foreign listing still classified `PRODUCT` whose resolved
 *      category lives under `services/*` is reclassified to `SERVICE`, so it
 *      enters the Services list and the Home slider. Only PRODUCT is touched —
 *      AGENT_SETUP/COOP/ITEM/SERVICE never lose their explicit type.
 *
 * Idempotent: rows that need no change are skipped. After running, reindex the
 * Meili offers index (`npx tsx apps/server/scripts/reindex-offers.ts`) because
 * `categoryCode`/`offerType` are indexed, or the list filter and the Search
 * backend will disagree until the next full reindex.
 *
 * Usage:
 *   npx tsx apps/server/scripts/backfill-gamma-category.ts
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
import { deriveCategoryCodeFromGammaTags, offerTypeForCategoryCode } from '../services/gamma-category-map.js'

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL! })) })
const BATCH = 100

async function run() {
  // Cursor by id, not skip: updates shrink the match set mid-scan, so a
  // skip-based offset would silently desync (same reason as the ADR-277 A7
  // backfill script).
  let cursor: string | undefined
  let updatedCat = 0
  let updatedType = 0
  let skipped = 0

  console.log('Starting gamma -> standard-category backfill...')

  while (true) {
    const offers = await prisma.offer.findMany({
      where: { gammaTags: { isEmpty: false }, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, categoryCode: true, offerType: true, gammaTags: true },
      take: BATCH,
      orderBy: { id: 'asc' },
    })

    if (offers.length === 0) break

    for (const offer of offers) {
      const resolved = offer.categoryCode || deriveCategoryCodeFromGammaTags(offer.gammaTags)
      const data: { categoryCode?: string; offerType?: 'SERVICE' } = {}

      if (!offer.categoryCode && resolved) {
        data.categoryCode = resolved
      }
      if (
        resolved &&
        offer.offerType === 'PRODUCT' &&
        offerTypeForCategoryCode(resolved) === 'SERVICE'
      ) {
        data.offerType = 'SERVICE'
      }

      if (Object.keys(data).length === 0) {
        skipped++
        continue
      }

      await prisma.offer.update({ where: { id: offer.id }, data })
      if (data.categoryCode) updatedCat++
      if (data.offerType) updatedType++
      process.stdout.write(`\r  categoryCode: ${updatedCat}, offerType: ${updatedType}, skipped: ${skipped}`)
    }

    cursor = offers[offers.length - 1].id
  }

  console.log(
    `\nDone. categoryCode filled: ${updatedCat}, offerType -> SERVICE: ${updatedType}, unchanged: ${skipped}`,
  )
  console.log('Next: npx tsx apps/server/scripts/reindex-offers.ts (Meili must see the new fields).')
  await prisma.$disconnect()
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
