/**
 * ADR-420: Backfill Offer.country for LOCAL offers whose country column is null
 * although their free-text `location` names one (the listing/service edit forms
 * used to write only the text, so every country filter, facet and search missed
 * those offers).
 *
 * LOCAL only: REMOTE offers get their country from the Nostr normalizer at
 * ingest; a null there means the listing really carries none.
 *
 * Dry-run by default: prints counts and each offerId -> derived ISO code.
 * Pass --apply to write; it also enqueues a Meili upsert per updated offer.
 *
 * Usage:
 *   npx tsx apps/server/scripts/backfill-offer-country-from-location.ts           # dry run
 *   npx tsx apps/server/scripts/backfill-offer-country-from-location.ts --apply   # write
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
import { deriveCountryIsoFromLocation } from '../services/nostr-normalizer.js'

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL! })) })
const APPLY = process.argv.includes('--apply')

async function run() {
  console.log(APPLY ? 'Mode: APPLY (writing country)' : 'Mode: DRY RUN (no writes; pass --apply to write)')

  const offers = await prisma.offer.findMany({
    where: { source: 'LOCAL', country: null, location: { not: null } },
    select: { id: true, title: true, location: true, status: true },
  })

  let derivable = 0
  let updated = 0
  const skipped: string[] = []
  for (const offer of offers) {
    const iso = deriveCountryIsoFromLocation(offer.location)
    if (!iso) { skipped.push(`${offer.id} (${offer.status}) "${offer.location}"`); continue }
    derivable++
    console.log(`  ${offer.id} (${offer.status}) "${offer.location}" -> ${iso}`)
    if (!APPLY) continue
    await prisma.$transaction([
      prisma.offer.update({ where: { id: offer.id }, data: { country: iso } }),
      prisma.outboxEvent.create({ data: { aggregate: 'offer', aggregateId: offer.id, eventType: 'upsert', payload: { reindex: true } } }),
    ])
    updated++
  }

  console.log(`LOCAL offers with a location but no country: ${offers.length}`)
  console.log(`country derivable: ${derivable}`)
  if (APPLY) console.log(`offers updated: ${updated}`)
  for (const line of skipped) console.log(`  not derivable: ${line}`)
  await prisma.$disconnect()
}

run().catch(err => {
  console.error('backfill failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
