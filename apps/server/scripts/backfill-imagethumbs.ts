/**
 * Backfill imageThumbs for all Offers that have images but no thumbnails yet.
 * Idempotent: skips offers where imageThumbs is already set.
 *
 * Usage:
 *   npx tsx apps/server/scripts/backfill-imagethumbs.ts
 *
 * Runs against the DATABASE_URL in .env (root). Point to the target DB first.
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
dotenv.config({ path: resolve(__rootDir, '.env') })

import { Prisma, PrismaClient } from '@prisma/client'
import { makeThumbsFromImages } from '../lib/makeThumb.js'

const prisma = new PrismaClient()
const BATCH = 50

async function run() {
  let offset = 0
  let total = 0
  let skipped = 0

  console.log('Starting imageThumbs backfill...')

  while (true) {
    const offers = await prisma.offer.findMany({
      where: { images: { not: Prisma.DbNull }, imageThumbs: { equals: Prisma.DbNull } },
      select: { id: true, images: true },
      take: BATCH,
      skip: offset,
      orderBy: { createdAt: 'asc' },
    })

    if (offers.length === 0) break

    for (const offer of offers) {
      const thumbs = await makeThumbsFromImages(offer.images).catch(() => null)
      if (!thumbs) { skipped++; continue }
      await prisma.offer.update({
        where: { id: offer.id },
        data: { imageThumbs: thumbs },
      })
      total++
      process.stdout.write(`\r  updated ${total}, skipped ${skipped}`)
    }

    offset += offers.length
  }

  console.log(`\nDone. Updated: ${total}, skipped (no valid data-URLs): ${skipped}`)
  await prisma.$disconnect()
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
