/**
 * Phase 2.3 Live-API Smoke Test: GET /api/nostr/dm/private-offers/:id
 *
 * ADR-152: Phase 2.3 — PrivateOfferDetailPage consumes this endpoint.
 * Verifies:
 * 1. DmMessage can be created with a parsed JSON payload
 * 2. GET /api/nostr/dm/private-offers/:id returns the DmMessage
 * 3. Payload is returned as-is (string), to be parsed client-side
 * 4. 404 is returned for unknown ids
 * 5. Visibility field is set to PRIVATE
 *
 * Run with:
 *   cd apps/server && DATABASE_URL="..." ../../apps/colabonate-app/node_modules/.bin/tsx scripts/phase2-3-dm-detail-smoke-test.ts
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set')
}

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL! })) })
const BASE = process.env.API_URL ?? 'http://localhost:4001'

async function main() {
  console.log('=== Phase 2.3 DmMessage Detail API Smoke Test ===\n')

  const user = await prisma.user.findFirst()
  if (!user) throw new Error('No user found in DB. Run seed first.')

  // 1. Create a DmMessage with a private offer payload
  console.log('1) Creating test DmMessage with private offer payload...')
  const eventId = 'phase2-3-test-' + Date.now()
  const payload = JSON.stringify({
    type: 'offer',
    offerId: 'test-offer-123',
    title: 'Encrypted Apple Juice 500ml',
    description: 'Test private offer payload',
    priceSats: 5000,
    images: ['https://example.com/juice.jpg'],
    deliveryTimeDays: 3,
    deliveryCostSats: 200,
    deliveryNotes: 'Ship within 3 days',
  })
  const dm = await prisma.dmMessage.create({
    data: {
      ownerPubkey: user.pubkey,
      peerPubkey: 'b'.repeat(64),
      eventId,
      kind: 1059, // gift wrap
      payload,
      ticketId: null,
      visibility: 'PRIVATE',
    },
  })
  console.log(`   ✓ Created DmMessage ${dm.id}`)
  console.log(`     eventId: ${dm.eventId}`)
  console.log(`     kind:    ${dm.kind}`)
  console.log(`     visibility: ${dm.visibility}`)

  // 2. Fetch via API
  console.log('\n2) GET /api/nostr/dm/private-offers/:id...')
  const res = await fetch(`${BASE}/api/nostr/dm/private-offers/${dm.id}`)
  const data = await res.json()
  console.log(`   Response status: ${res.status}`)
  console.log(`   Response body:   ${JSON.stringify(data).slice(0, 200)}`)

  if (res.status !== 200) {
    console.log(`   ❌ FAIL: Expected 200, got ${res.status}`)
    process.exit(1)
  }
  if (!data.message) {
    console.log('   ❌ FAIL: Response has no .message field')
    process.exit(1)
  }
  console.log('   ✓ API returned message')

  // 3. Verify payload is returned as string (client parses it)
  console.log('\n3) Verifying payload is returned as string...')
  if (typeof data.message.payload !== 'string') {
    console.log(`   ❌ FAIL: Expected string, got ${typeof data.message.payload}`)
    process.exit(1)
  }
  const parsed = JSON.parse(data.message.payload)
  if (parsed.type !== 'offer' || parsed.title !== 'Encrypted Apple Juice 500ml') {
    console.log(`   ❌ FAIL: Parsed payload does not match: ${JSON.stringify(parsed)}`)
    process.exit(1)
  }
  console.log(`   ✓ Payload is a string and parses correctly (type=${parsed.type}, title=${parsed.title})`)

  // 4. 404 for unknown id
  console.log('\n4) GET /api/nostr/dm/private-offers/unknown-id...')
  const notFoundRes = await fetch(`${BASE}/api/nostr/dm/private-offers/does-not-exist`)
  console.log(`   Response status: ${notFoundRes.status} (expected: 404)`)
  if (notFoundRes.status !== 404) {
    console.log(`   ❌ FAIL: Expected 404, got ${notFoundRes.status}`)
    process.exit(1)
  }
  console.log('   ✓ 404 returned for unknown id')

  // 5. Verify visibility is PRIVATE
  console.log('\n5) Verifying visibility is PRIVATE...')
  if (data.message.visibility !== 'PRIVATE') {
    console.log(`   ❌ FAIL: Expected PRIVATE, got ${data.message.visibility}`)
    process.exit(1)
  }
  console.log('   ✓ visibility is PRIVATE')

  // 6. Cleanup
  console.log('\n6) Cleaning up test DmMessage...')
  await prisma.dmMessage.delete({ where: { id: dm.id } })
  console.log('   ✓ Deleted test DmMessage')

  console.log('\n✅ All Phase 2.3 DmMessage detail API assertions passed.')
}

main()
  .catch((e) => { console.error('Smoke test failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
