/**
 * E2E Smoke Test: POST /api/nostr/offers with a PRIVATE offer
 * should return { success: false, skipped: true, reason: 'PRIVATE_OFFER_DM_ONLY' }
 * and NOT publish a Kind 30402 event.
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL! })) })
const BASE = process.env.API_URL ?? 'http://localhost:4001'

async function main() {
  console.log('=== E2E: Re-Publish PRIVATE Offer ===\n')

  const user = await prisma.user.findFirst()
  if (!user) throw new Error('No user found')

  // 1. Create PRIVATE offer
  console.log('1) Creating PRIVATE offer...')
  const priv = await prisma.offer.create({
    data: {
      title: '[E2E] Private Re-Publish Test',
      description: 'should not be published to Kind 30402',
      priceSats: 5000,
      category: 'Goods',
      categoryCode: 'goods',
      creatorPubkey: user.pubkey,
      offerType: 'ITEM',
      ticketType: 'SMART_ORDER',
      source: 'LOCAL',
      visibility: 'PRIVATE',
      disputeMode: 'PRIVATE',
    },
  })
  console.log(`   ✓ Created PRIVATE offer ${priv.id}`)

  // 2. Create PUBLIC offer for comparison
  console.log('\n2) Creating PUBLIC offer for comparison...')
  const pub = await prisma.offer.create({
    data: {
      title: '[E2E] Public Re-Publish Test',
      description: 'should be published to Kind 30402',
      priceSats: 5000,
      category: 'Goods',
      categoryCode: 'goods',
      creatorPubkey: user.pubkey,
      offerType: 'ITEM',
      ticketType: 'SMART_ORDER',
      source: 'LOCAL',
      visibility: 'PUBLIC',
      disputeMode: 'PUBLIC',
    },
  })
  console.log(`   ✓ Created PUBLIC offer ${pub.id}`)

  // 3. Call POST /api/nostr/offers for PRIVATE offer
  console.log('\n3) Re-publishing PRIVATE offer via API...')
  const privRes = await fetch(`${BASE}/api/nostr/offers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offerId: priv.id }),
  })
  const privData = await privRes.json()
  console.log(`   Response status: ${privRes.status}`)
  console.log(`   Response body: ${JSON.stringify(privData)}`)

  if (privRes.status === 200 && privData.skipped === true && privData.reason === 'PRIVATE_OFFER_DM_ONLY') {
    console.log('   ✓ PRIVATE offer was correctly SKIPPED (200, skipped=true, reason=PRIVATE_OFFER_DM_ONLY)')
  } else {
    console.log(`   ❌ FAIL: Expected skipped response, got: ${JSON.stringify(privData)}`)
    process.exit(1)
  }

  // 4. Call POST /api/nostr/offers for PUBLIC offer
  console.log('\n4) Re-publishing PUBLIC offer via API...')
  const pubRes = await fetch(`${BASE}/api/nostr/offers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offerId: pub.id }),
  })
  const pubData = await pubRes.json()
  console.log(`   Response status: ${pubRes.status}`)
  console.log(`   Response body: ${JSON.stringify(pubData).slice(0, 200)}`)

  if (pubRes.status === 200 && pubData.success === true && pubData.event?.kind === 30402) {
    console.log('   ✓ PUBLIC offer was correctly PUBLISHED (200, success=true, event.kind=30402)')
  } else {
    console.log(`   ❌ FAIL: Expected successful publish, got: ${JSON.stringify(pubData)}`)
    process.exit(1)
  }

  // 5. Verify no Kind 30402 event exists in the mock relay for the PRIVATE offer
  // (we can't easily query the mock relay, but the API response tells us the event was not created)
  console.log('\n5) Verifying DB state: PRIVATE offer should have no nostrEventId...')
  const privAfter = await prisma.offer.findUnique({ where: { id: priv.id } })
  const pubAfter = await prisma.offer.findUnique({ where: { id: pub.id } })
  console.log(`   PRIVATE offer.nostrEventId: ${privAfter?.nostrEventId ?? 'null'} (expected: null)`)
  console.log(`   PUBLIC  offer.nostrEventId: ${pubAfter?.nostrEventId ?? 'null'} (expected: <event-id>)`)

  if (privAfter?.nostrEventId === null && pubAfter?.nostrEventId) {
    console.log('   ✓ DB state confirms: PRIVATE offer has no nostrEventId, PUBLIC offer does')
  } else {
    console.log('   ❌ FAIL: DB state does not match expected')
    process.exit(1)
  }

  // 6. Cleanup
  console.log('\n6) Cleaning up test offers...')
  await prisma.offer.delete({ where: { id: priv.id } })
  await prisma.offer.delete({ where: { id: pub.id } })
  console.log('   ✓ Deleted both test offers')

  console.log('\n✅ All E2E visibility filter assertions passed.')
}

main()
  .catch((e) => { console.error('E2E test failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
