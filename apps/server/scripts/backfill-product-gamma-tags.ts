/**
 * ADR-277 D-6: Backfill Product.gammaTags for existing products, deriving tags as the
 * deduped union of gammaTags across each product's offers[] (the ADR-066 Product↔Offer
 * bridge, 1:N). Idempotent: only touches products with an empty gammaTags array and at
 * least one offer carrying gamma tags.
 *
 * Going forward, apps/server/routes/nostr.ts's `POST /offers` handler keeps a product's
 * gammaTags in sync on every offer publish via gamma-category-map.ts::syncProductGammaTags
 * — this script only needs to run once against existing data.
 *
 * Usage:
 *   npx tsx apps/server/scripts/backfill-product-gamma-tags.ts
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
const BATCH = 50

async function run() {
  // Cursor by id, not skip: updates remove rows from the `gammaTags: []` match set
  // mid-scan, which would desync a skip-based offset against the shrinking result set
  // and silently drop rows (same reasoning as backfill-gamma-tags.ts A7).
  let cursor: string | undefined
  let updated = 0
  let skipped = 0

  console.log('Starting Product.gammaTags backfill...')

  while (true) {
    const products = await prisma.product.findMany({
      where: { gammaTags: { equals: [] }, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, offers: { select: { gammaTags: true } } },
      take: BATCH,
      orderBy: { id: 'asc' },
    })

    if (products.length === 0) break

    for (const product of products) {
      const union = Array.from(new Set(product.offers.flatMap(o => o.gammaTags)))
      if (union.length === 0) { skipped++; continue }
      await prisma.product.update({
        where: { id: product.id },
        data: { gammaTags: union },
      })
      updated++
      process.stdout.write(`\r  updated ${updated}, skipped ${skipped}`)
    }

    cursor = products[products.length - 1].id
  }

  console.log(`\nDone. Updated: ${updated}, skipped (no offer with gammaTags): ${skipped}`)
  await prisma.$disconnect()
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
