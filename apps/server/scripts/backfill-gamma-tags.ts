/**
 * ADR-277 A7: Backfill Offer.gammaTags for existing offers, deriving tags
 * from categoryCode via the seed map (packages/data/categories/gamma-map-v2.json).
 * Idempotent: only touches offers with an empty gammaTags array and a
 * categoryCode that has a mapped entry.
 *
 * Usage:
 *   npx tsx apps/server/scripts/backfill-gamma-tags.ts
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
import { tagsForCategoryCode } from '../services/gamma-category-map.js'

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL! })) })
const BATCH = 50

async function run() {
  // Cursor by id, not skip: updates remove rows from the `gammaTags: []`
  // match set mid-scan, which would desync a skip-based offset against the
  // shrinking result set and silently drop rows.
  let cursor: string | undefined
  let updated = 0
  let skipped = 0

  console.log('Starting gammaTags backfill...')

  while (true) {
    const offers = await prisma.offer.findMany({
      where: { gammaTags: { equals: [] }, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, categoryCode: true },
      take: BATCH,
      orderBy: { id: 'asc' },
    })

    if (offers.length === 0) break

    for (const offer of offers) {
      const tags = tagsForCategoryCode(offer.categoryCode)
      if (tags.length === 0) { skipped++; continue }
      await prisma.offer.update({
        where: { id: offer.id },
        data: { gammaTags: tags },
      })
      updated++
      process.stdout.write(`\r  updated ${updated}, skipped ${skipped}`)
    }

    cursor = offers[offers.length - 1].id
  }

  console.log(`\nDone. Updated: ${updated}, skipped (no seed-map entry for categoryCode): ${skipped}`)
  await prisma.$disconnect()
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
