/**
 * ADR-415: Backfill Offer.originUrl for already-ingested REMOTE offers from
 * the `r` tag of their approved RemoteOfferCandidate raw event.
 *
 * Dry-run by default: prints counts and sample offerId -> url pairs only.
 * Pass --apply to write.
 *
 * Usage:
 *   npx tsx apps/server/scripts/backfill-remote-origin-url.ts           # dry run
 *   npx tsx apps/server/scripts/backfill-remote-origin-url.ts --apply   # write
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
import { extractOriginUrl } from '../services/nostr-normalizer.js'

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL! })) })
const APPLY = process.argv.includes('--apply')
const BATCH = 50

async function run() {
  console.log(APPLY ? 'Mode: APPLY (writing originUrl)' : 'Mode: DRY RUN (no writes; pass --apply to write)')

  let cursor: string | undefined
  let scanned = 0
  let withRTag = 0
  let wouldUpdate = 0
  let updated = 0
  const samples: string[] = []

  while (true) {
    const candidates = await prisma.remoteOfferCandidate.findMany({
      where: { status: 'APPROVED', ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, rawEvent: true, remoteAuthor: true, remoteDTag: true },
      take: BATCH,
      orderBy: { id: 'asc' },
    })
    if (candidates.length === 0) break

    for (const candidate of candidates) {
      scanned++
      const raw = candidate.rawEvent as { tags?: unknown } | null
      if (!raw || !Array.isArray(raw.tags)) continue
      const originUrl = extractOriginUrl(raw.tags as string[][])
      if (!originUrl) continue
      // A null d-tag would match every d-tag-less offer of this author and give them all the same URL.
      if (!candidate.remoteDTag) continue
      withRTag++

      const offers = await prisma.offer.findMany({
        where: {
          source: 'REMOTE',
          creatorPubkey: candidate.remoteAuthor,
          remoteDTag: candidate.remoteDTag,
          originUrl: null,
        },
        select: { id: true },
      })

      for (const offer of offers) {
        wouldUpdate++
        if (samples.length < 5) samples.push(`${offer.id} -> ${originUrl}`)
        if (APPLY) {
          await prisma.offer.update({ where: { id: offer.id }, data: { originUrl } })
          updated++
        }
      }
    }

    cursor = candidates[candidates.length - 1].id
  }

  console.log(`candidates scanned: ${scanned}`)
  console.log(`with r tag: ${withRTag}`)
  console.log(`offers that would be updated: ${wouldUpdate}`)
  if (APPLY) console.log(`offers updated: ${updated}`)
  for (const line of samples) console.log(`  sample: ${line}`)
  await prisma.$disconnect()
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
