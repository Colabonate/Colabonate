/**
 * Backfill imageThumbs for all Cooperations that have images but no
 * thumbnails yet (ADR-376 D3, migration 20260915011811 added the column
 * with no backfill). Idempotent: skips rows where imageThumbs is already set.
 *
 * Cooperation.images is a JSON-string column (String?), unlike Offer.images
 * (native Json?) — parse it before handing it to makeThumbsFromImages().
 *
 * Usage:
 *   npx tsx apps/server/scripts/backfill-cooperation-imagethumbs.ts
 *
 * Runs against the DATABASE_URL in .env (root). Point to the target DB first.
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
dotenv.config({ path: resolve(__rootDir, '.env') })

import { Prisma, PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { makeThumbsFromImages } from '../lib/makeThumb.js'

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL! })) })
const BATCH = 50

function parseImages(value: string | null): unknown[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function run() {
  let offset = 0
  let total = 0
  let skipped = 0

  console.log('Starting Cooperation.imageThumbs backfill...')

  while (true) {
    const coops = await prisma.cooperation.findMany({
      where: { images: { not: null }, imageThumbs: { equals: Prisma.DbNull } },
      select: { id: true, images: true },
      take: BATCH,
      skip: offset,
      orderBy: { createdAt: 'asc' },
    })

    if (coops.length === 0) break

    for (const coop of coops) {
      const images = parseImages(coop.images)
      const thumbs = images.length > 0 ? await makeThumbsFromImages(images).catch(() => null) : null
      if (!thumbs) { skipped++; continue }
      await prisma.cooperation.update({
        where: { id: coop.id },
        data: { imageThumbs: thumbs },
      })
      total++
      process.stdout.write(`\r  updated ${total}, skipped ${skipped}`)
    }

    offset += coops.length
  }

  console.log(`\nDone. Updated: ${total}, skipped (no valid data-URLs): ${skipped}`)
  await prisma.$disconnect()
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
