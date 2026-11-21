/**
 * Phase 4.2 Meili-Index Integrity Smoke Test (ADR-159 — "KEIN globaler Index")
 *
 * Proves the global search index can NEVER leak offers from PRIVATE-profile
 * creators, across three real code paths against the LIVE Meilisearch (:7700):
 *
 *   1. purge-on-flip     — flipping a creator's profile to PRIVATE deletes all
 *                          their offer docs from Meili immediately
 *                          (syncCreatorOfferIndex, direct delete).
 *   2. indexer add       — with a PUBLIC profile the indexer adds the offer doc
 *                          (processOfferUpsert → addDocuments).
 *   3. indexer guard     — with a PRIVATE profile the indexer PURGES even a
 *                          stale/leaked doc instead of adding it
 *                          (processOfferUpsert → deleteDocument).
 *
 * Why this test exists: the original Phase 4.2 only filtered the DB browse +
 * DB-search paths. The Meilisearch source/index path was unguarded, so the
 * moment the `offers` index materialized (prod / fresh setup), PRIVATE-profile
 * offers would leak — contradicting the project goal "KEIN globaler Index".
 * ADR-159 closes that with an indexer guard + profile-flip sync.
 *
 * The indexer is invoked directly (processOfferUpsert) rather than via the
 * outbox worker, because the dev server only starts the worker when
 * SEARCH_BACKEND=meilisearch — calling the function exercises the exact same
 * code path deterministically, with no poll/timing dependency.
 *
 * Run with (Meili must be up on :7700):
 *   cd apps/server && DATABASE_URL="postgresql://colabonate:dev@localhost:5434/colabonate" \
 *     ../../apps/colabonate-app/node_modules/.bin/tsx scripts/phase4-meili-index-smoke-test.ts
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { MeiliSearch } from 'meilisearch'
import { processOfferUpsert, syncCreatorOfferIndex } from '../services/outbox-worker.js'
import { isProfileIndexable } from '../services/tradeVisibility.js'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set (e.g. postgresql://colabonate:dev@localhost:5434/colabonate)')
}

// The indexer + sync helpers call the app's getMeili(), which reads these env
// vars lazily on first use. Set sane dev defaults so they resolve in this
// process (the run command may only set DATABASE_URL).
process.env.MEILISEARCH_URL ??= 'http://localhost:7700'
process.env.MEILISEARCH_MASTER_KEY ??= 'dev-master-key'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const MEILI_URL = process.env.MEILISEARCH_URL
const INDEX = 'offers'
const client = new MeiliSearch({ host: MEILI_URL, apiKey: process.env.MEILISEARCH_MASTER_KEY })

const PRIVATE_PUBKEY = '5'.repeat(63) + 'a'
let userId: string | null = null
let offerId: string | null = null
let createdIndex = false

async function docExists(id: string): Promise<boolean> {
  try {
    await client.index(INDEX).getDocument(id)
    return true
  } catch {
    return false
  }
}

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 10000, intervalMs = 400): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: T | undefined
  while (Date.now() < deadline) {
    last = await fn()
    if (ok(last)) return last
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms (last=${JSON.stringify(last)})`)
}

async function ensureIndex(): Promise<void> {
  try {
    await client.getIndex(INDEX)
    createdIndex = false
  } catch {
    await client.createIndex(INDEX, { primaryKey: 'id' })
    createdIndex = true
    await new Promise((r) => setTimeout(r, 1000)) // let Meili materialise the index task
  }
}

const setProfile = (v: 'PUBLIC' | 'PRIVATE') =>
  prisma.user.update({ where: { pubkey: PRIVATE_PUBKEY }, data: { profileVisibility: v } })

async function main() {
  console.log('=== Phase 4.2 Meili-Index Integrity Smoke Test (ADR-159) ===\n')
  console.log(`Meili: ${MEILI_URL} (index "${INDEX}")`)

  // Sanity: the decision helper agrees PRIVATE is non-indexable.
  if (isProfileIndexable('PRIVATE')) throw new Error('isProfileIndexable(PRIVATE) must be false')
  if (!isProfileIndexable('PUBLIC')) throw new Error('isProfileIndexable(PUBLIC) must be true')

  await ensureIndex()
  console.log(`   index "${INDEX}" ready ${createdIndex ? '(created by test)' : '(already existed)'}`)

  // Fixture: a PUBLIC-profile creator with an ACTIVE offer. We flip the profile
  // in the DB at each step (exactly what PATCH /api/user/:pubkey/visibility does
  // before calling the sync helper), so the indexer reads the real value.
  const user = await prisma.user.create({
    data: { pubkey: PRIVATE_PUBKEY, lnAddress: `${PRIVATE_PUBKEY.slice(0, 8)}@ln.test`, profileVisibility: 'PUBLIC' },
  })
  userId = user.id
  const offer = await prisma.offer.create({
    data: {
      title: `[TEST] phase4-meili ${Date.now()}`,
      description: 'meili index integrity',
      priceSats: 1000,
      category: 'Goods', categoryCode: 'goods',
      creatorPubkey: PRIVATE_PUBKEY,
      offerType: 'ITEM', ticketType: 'SMART_ORDER', source: 'LOCAL',
      status: 'ACTIVE', publishedAt: new Date(),
      visibility: 'PUBLIC',
    },
  })
  offerId = offer.id
  console.log(`   fixture: user=${user.id.slice(-6)} offer=${offer.id.slice(-6)} (profile=PUBLIC)`)
  const evt = { aggregateId: offer.id } as any

  // ── 1) purge-on-flip (direct, deterministic) ──
  console.log('\n1) [purge-on-flip] seed stale doc, flip PUBLIC→PRIVATE, expect purge...')
  await client.index(INDEX).addDocuments([{ id: offer.id, title: 'stale', creatorPubkey: PRIVATE_PUBKEY }])
  await waitFor(() => docExists(offer.id), (e) => e, 5000) // seed landed
  await setProfile('PRIVATE')
  await syncCreatorOfferIndex(prisma, PRIVATE_PUBKEY, 'PUBLIC', 'PRIVATE')
  await waitFor(() => docExists(offer.id), (e) => !e, 10000)
  console.log('   ✓ stale offer doc purged from Meili after flip to PRIVATE')

  // ── 2) indexer adds when profile is PUBLIC ──
  console.log('\n2) [indexer add] flip PRIVATE→PUBLIC, run indexer, expect doc added...')
  await setProfile('PUBLIC')
  await processOfferUpsert(prisma, evt) // creator now PUBLIC → addDocuments
  await waitFor(() => docExists(offer.id), (e) => e, 10000)
  console.log('   ✓ offer indexed after flip back to PUBLIC')

  // ── 3) indexer guard purges a leaked doc when profile is PRIVATE ──
  console.log('\n3) [indexer guard] flip to PRIVATE, re-seed leaked doc, run indexer, expect purge...')
  await setProfile('PRIVATE')
  await client.index(INDEX).addDocuments([{ id: offer.id, title: 'leaked', creatorPubkey: PRIVATE_PUBKEY }])
  await waitFor(() => docExists(offer.id), (e) => e, 5000) // leak seeded
  await processOfferUpsert(prisma, evt) // creator PRIVATE → deleteDocument (guard)
  await waitFor(() => docExists(offer.id), (e) => !e, 10000)
  console.log('   ✓ indexer guard purged the leaked doc (creator profile = PRIVATE)')

  console.log('\n✅ All Phase 4.2 Meili-index integrity assertions passed (ADR-159).')
}

main()
  .catch(async (e) => {
    console.error('\n❌ Meili smoke test failed:', e)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      if (offerId) await client.index(INDEX).deleteDocument(offerId).catch(() => {})
      // restore prior dev state: remove the index only if this test created it
      if (createdIndex) await client.deleteIndex(INDEX).catch(() => {})
    } catch { /* ignore */ }
    try {
      if (offerId) await prisma.offer.delete({ where: { id: offerId } }).catch(() => {})
      if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {})
    } catch { /* ignore */ }
    await prisma.$disconnect()
  })
