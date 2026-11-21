/**
 * Phase 2.5 Live-API Smoke Test: GET /api/nostr/dm/private-offers (list)
 *
 * ADR-152: Phase 2.5 — Globaler DM-Inbox-View.
 * Verifies:
 * 1. GET /api/nostr/dm/private-offers returns the user's DmMessage list
 * 2. List is sorted by createdAt desc (newest first)
 * 3. limit param caps the result
 * 4. ownerPubkey missing → 400
 * 5. Bad ownerPubkey format → 400
 *
 * Run with:
 *   cd apps/server && DATABASE_URL="..." ./node_modules/.bin/tsx scripts/phase2-5-inbox-smoke-test.ts
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set')
}

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL! })) })
const BASE = process.env.API_URL ?? 'http://localhost:4001'

const createdIds: string[] = []
let testOwner: string | null = null

async function main() {
  console.log('=== Phase 2.5 Inbox List API Smoke Test ===\n')

  // 1. Pick a test owner — must be a 64-char hex string (API validates format)
  // The default seed user 'test-buyer-pubkey' is too short, so create a dedicated test user
  testOwner = 'a'.repeat(64)
  const user = await prisma.user.findUnique({ where: { pubkey: testOwner } })
  if (!user) {
    await prisma.user.create({
      data: { pubkey: testOwner, lnAddress: `${testOwner.slice(0, 8)}@ln.test`, identityLevel: 0, colPoints: 0 },
    })
  }
  console.log(`Test owner: ${testOwner}`)

  // 2. Create 3 test DmMessages (newest last → newest first in result)
  console.log('\n1) Creating 3 test DmMessages (1 offer, 1 cooperation, 1 chat)...')
  const now = Date.now()
  for (let i = 0; i < 3; i++) {
    const dm = await prisma.dmMessage.create({
      data: {
        ownerPubkey: testOwner,
        peerPubkey: 'c'.repeat(64),
        eventId: `phase2-5-test-${i}-${now}`,
        kind: i === 0 ? 1059 : 14, // first is gift-wrapped offer, rest are legacy
        payload: i === 0
          ? JSON.stringify({ type: 'offer', offerId: `o-${i}`, title: `Inbox Test Offer ${i}`, priceSats: 1000 * (i + 1) })
          : i === 1
            ? JSON.stringify({ type: 'cooperation', cooperationId: `coop-${i}`, title: `Inbox Test Coop ${i}` })
            : `Plain text chat message ${i}`,
        visibility: 'PRIVATE',
        createdAt: new Date(now + i * 1000), // ensure ordering
      },
    })
    createdIds.push(dm.id)
  }
  console.log(`   ✓ Created ${createdIds.length} DmMessages`)

  // 3. GET /api/nostr/dm/private-offers (list)
  console.log('\n2) GET /api/nostr/dm/private-offers (list)...')
  const res = await fetch(`${BASE}/api/nostr/dm/private-offers?ownerPubkey=${testOwner}&limit=10`)
  const data = await res.json()
  console.log(`   Response status: ${res.status}`)
  console.log(`   Total messages returned: ${data.messages?.length}`)

  if (res.status !== 200 || !data.messages) {
    console.log(`   ❌ FAIL: ${JSON.stringify(data).slice(0, 200)}`)
    process.exit(1)
  }
  console.log('   ✓ API returned message list')

  // 4. Verify the 3 test messages are in the list
  const ourIds = new Set(createdIds)
  const found = data.messages.filter((m: { id: string }) => ourIds.has(m.id))
  console.log(`\n3) Verifying all 3 test DmMessages are in the list...`)
  console.log(`   Found ${found.length} of ${createdIds.length}`)
  if (found.length !== 3) {
    console.log('   ❌ FAIL: Not all test messages returned')
    process.exit(1)
  }
  console.log('   ✓ All 3 test messages returned')

  // 5. Verify sort order: createdAt desc
  console.log('\n4) Verifying sort order (newest first)...')
  const ourMessages = data.messages.filter((m: { id: string }) => ourIds.has(m.id))
  const dates = ourMessages.map((m: { createdAt: string }) => new Date(m.createdAt).getTime())
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] > dates[i - 1]) {
      console.log(`   ❌ FAIL: Sort order broken at index ${i}: ${dates[i]} > ${dates[i - 1]}`)
      process.exit(1)
    }
  }
  console.log(`   ✓ Sort order correct: ${dates.map((d: number) => new Date(d).toISOString()).join(' < ')}`)

  // 6. Verify kind mix
  console.log('\n5) Verifying kind mix (1059, 14)...')
  const kinds = new Set(found.map((m: { kind: number }) => m.kind))
  if (!kinds.has(1059) || !kinds.has(14)) {
    console.log(`   ❌ FAIL: Expected kinds {1059, 14}, got {${[...kinds].join(', ')}}`)
    process.exit(1)
  }
  console.log(`   ✓ Kinds present: {${[...kinds].join(', ')}}`)

  // 7. Verify limit param
  console.log('\n6) Verifying limit=2 caps the result...')
  const limitedRes = await fetch(`${BASE}/api/nostr/dm/private-offers?ownerPubkey=${testOwner}&limit=2`)
  const limitedData = await limitedRes.json()
  if (limitedData.messages.length !== 2) {
    console.log(`   ❌ FAIL: Expected 2, got ${limitedData.messages.length}`)
    process.exit(1)
  }
  console.log(`   ✓ limit=2 capped the result to 2 messages`)

  // 6b. Verify cursor pagination (after = endCursor) + real totalCount
  console.log('\n6b) Verifying cursor pagination (after=endCursor)...')
  const page1 = limitedData // reuse the limit=2 response above
  if (!page1.pageInfo?.hasNextPage || !page1.pageInfo?.endCursor) {
    console.log(`   ❌ FAIL: Expected pageInfo.hasNextPage=true with endCursor, got ${JSON.stringify(page1.pageInfo)}`)
    process.exit(1)
  }
  const page2Res = await fetch(
    `${BASE}/api/nostr/dm/private-offers?ownerPubkey=${testOwner}&limit=2&after=${encodeURIComponent(page1.pageInfo.endCursor)}`,
  )
  const page2 = await page2Res.json()
  const page1Ids = new Set(page1.messages.map((m: { id: string }) => m.id))
  const overlap = (page2.messages ?? []).filter((m: { id: string }) => page1Ids.has(m.id))
  if (overlap.length > 0) {
    console.log(`   ❌ FAIL: Page 2 overlaps page 1 by ${overlap.length} row(s)`)
    process.exit(1)
  }
  const lastP1 = page1.messages[page1.messages.length - 1]
  const firstP2 = page2.messages[0]
  if (firstP2 && new Date(firstP2.createdAt).getTime() > new Date(lastP1.createdAt).getTime()) {
    console.log('   ❌ FAIL: Page 2 is not older than the end of page 1')
    process.exit(1)
  }
  if (typeof page1.totalCount !== 'number' || page1.totalCount < 3) {
    console.log(`   ❌ FAIL: totalCount should be >= 3, got ${page1.totalCount}`)
    process.exit(1)
  }
  console.log(
    `   ✓ Cursor pagination works (page1: ${page1.messages.length}, page2: ${page2.messages.length}, totalCount: ${page1.totalCount})`,
  )

  // 8. Verify 400 on missing ownerPubkey
  console.log('\n7) GET /api/nostr/dm/private-offers (no ownerPubkey)...')
  const noOwnerRes = await fetch(`${BASE}/api/nostr/dm/private-offers`)
  console.log(`   Response status: ${noOwnerRes.status} (expected: 400)`)
  if (noOwnerRes.status !== 400) {
    console.log('   ❌ FAIL: Expected 400 for missing ownerPubkey')
    process.exit(1)
  }
  console.log('   ✓ 400 returned for missing ownerPubkey')

  // 9. Verify 400 on bad ownerPubkey format
  console.log('\n8) GET /api/nostr/dm/private-offers (bad format)...')
  const badRes = await fetch(`${BASE}/api/nostr/dm/private-offers?ownerPubkey=not-hex`)
  console.log(`   Response status: ${badRes.status} (expected: 400)`)
  if (badRes.status !== 400) {
    console.log('   ❌ FAIL: Expected 400 for bad ownerPubkey format')
    process.exit(1)
  }
  console.log('   ✓ 400 returned for bad ownerPubkey format')

  // 10. Cleanup
  console.log('\n9) Cleaning up test DmMessages...')
  await prisma.dmMessage.deleteMany({ where: { id: { in: createdIds } } })
  console.log(`   ✓ Deleted ${createdIds.length} test DmMessages`)

  console.log('\n✅ All Phase 2.5 Inbox list API assertions passed.')
}

main()
  .catch((e) => { console.error('Smoke test failed:', e); process.exit(1) })
  .finally(async () => {
    if (createdIds.length > 0) {
      try { await prisma.dmMessage.deleteMany({ where: { id: { in: createdIds } } }) } catch {}
    }
    if (testOwner) {
      try { await prisma.user.delete({ where: { pubkey: testOwner } }) } catch {}
    }
    await prisma.$disconnect()
  })
