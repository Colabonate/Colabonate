/**
 * ADR-412 D4 backfill: publish every ACTIVE/PUBLIC offer that was
 * created before this ADR's fix (POST/PATCH /api/offers never called
 * nostrService.publishOffer() at all, ADR-412 Bug A) and therefore has no
 * nostrEventId yet.
 *
 * `--all` (ADR-412 amendment 2026-11-20): re-publish ALL ACTIVE/PUBLIC LOCAL
 * offers, including ones already published. Kind 30402/30017 are parameterized
 * replaceable, so each publish replaces the previous event at the same
 * (pubkey, d-tag) coordinate — used to refresh existing listings with the
 * new `client` tag after that amendment's deploy. LOCAL-only since the
 * 2026-11-20 incident (never re-publish foreign REMOTE listings under our keys).
 *
 * Run manually, against the DATABASE_URL in .env (root). Point to the
 * target DB first:
 *   npx tsx apps/server/scripts/backfill-offer-nostr-publish.ts [--all]
 */
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
dotenv.config({ path: resolve(__rootDir, '.env') })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { publishAndSyncOffer } from '../routes/nostr.js'

async function main() {
  const republishAll = process.argv.includes('--all')

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const adapter = new PrismaPg(pool)
  const prisma = new PrismaClient({ adapter })

  const offers = await prisma.offer.findMany({
    where: {
      status: 'ACTIVE',
      visibility: 'PUBLIC',
      // Incident 2026-11-20: LOCAL only. Without this, `--all` re-published
      // REMOTE (foreign, ingested) listings under our signing keys with our
      // client tag. `publishAndSyncOffer` guards the same rule at the choke
      // point; the filter here keeps the printed count honest.
      source: 'LOCAL',
      // Default (ADR-412 D4): only offers never published. `--all` drops this
      // filter so already-published offers get re-published (and thereby
      // replaced) at their existing coordinate.
      ...(republishAll ? {} : { nostrEventId: null }),
    },
    select: { id: true, title: true },
  })

  console.log(`[ADR-412 backfill] ${offers.length} offer(s) to publish${republishAll ? ' (--all: re-publishing already-published offers too)' : ''}`)

  let ok = 0
  let failed = 0
  for (const offer of offers) {
    try {
      const eventId = await publishAndSyncOffer(prisma, offer.id)
      if (eventId) {
        ok++
        console.log(`  OK   ${offer.id} "${offer.title}" -> ${eventId}`)
      } else {
        failed++
        console.warn(`  SKIP ${offer.id} "${offer.title}" -> publish returned null`)
      }
    } catch (err) {
      failed++
      console.error(`  FAIL ${offer.id} "${offer.title}":`, err)
    }
  }

  console.log(`[ADR-412 backfill] done: ${ok} published, ${failed} failed/skipped`)
  await prisma.$disconnect()
  await pool.end()
}

main().catch(err => {
  console.error('[ADR-412 backfill] fatal:', err)
  process.exit(1)
})
