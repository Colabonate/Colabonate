/**
 * Phase 2.1 Live-DB Smoke Test (ADR-152 — Visibility + DisputeMode)
 *
 * Verifies that an Offer can be created and updated with visibility=PRIVATE
 * + disputeMode=PRIVATE, that the DB persists the values, and that the
 * default PUBLIC behavior is preserved for offers without explicit fields.
 *
 * This script is a sanity check for the Phase 2.1 UI implementation. The
 * UI sends visibility + disputeMode via the buildPayload() in useOfferForm.
 * This test verifies the DB layer accepts the same values.
 *
 * Run with:
 *   cd apps/server && DATABASE_URL="postgresql://colabonate:dev@localhost:5434/colabonate" \
 *     ../../apps/colabonate-app/node_modules/.bin/tsx scripts/phase2-visibility-smoke-test.ts
 *
 * The test creates one offer (PRIVATE), verifies the values, then updates
 * it to PUBLIC, verifies, and finally deletes the test offer to leave the
 * DB clean.
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set (e.g. postgresql://colabonate:dev@localhost:5434/colabonate)')
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

let createdOfferId: string | null = null

async function main() {
  console.log('=== Phase 2.1 Visibility Smoke Test ===\n')

  // 1. Find a test user to own the offer
  const testUser = await prisma.user.findFirst()
  if (!testUser) {
    throw new Error('No user found in DB. Run seed first.')
  }
  console.log(`Using test user: ${testUser.pubkey} (id=${testUser.id})`)

  // 2. Create offer with visibility=PRIVATE + disputeMode=PRIVATE
  console.log('\n1) Creating PRIVATE offer (visibility=PRIVATE, disputeMode=PRIVATE)...')
  const created = await prisma.offer.create({
    data: {
      title: '[TEST] Phase 2.1 Privat Offer',
      description: 'Smoke test for visibility toggle',
      priceSats: 1000,
      category: 'Goods',
      categoryCode: 'goods',
      creatorPubkey: testUser.pubkey,
      offerType: 'ITEM',
      ticketType: 'SMART_ORDER',
      source: 'LOCAL',
      visibility: 'PRIVATE',
      disputeMode: 'PRIVATE',
    },
  })
  createdOfferId = created.id
  console.log(`   ✓ Created offer ${created.id}`)
  console.log(`     visibility  = ${created.visibility} (expected: PRIVATE)`)
  console.log(`     disputeMode = ${created.disputeMode} (expected: PRIVATE)`)
  if (created.visibility !== 'PRIVATE') throw new Error('DB did not persist visibility=PRIVATE')
  if (created.disputeMode !== 'PRIVATE') throw new Error('DB did not persist disputeMode=PRIVATE')

  // 3. Verify default behavior (no visibility field → PUBLIC)
  console.log('\n2) Verifying default behavior (omitting visibility → PUBLIC)...')
  const defaultCreated = await prisma.offer.create({
    data: {
      title: '[TEST] Default Visibility Offer',
      description: 'No visibility field set',
      priceSats: 2000,
      category: 'Goods',
      categoryCode: 'goods',
      creatorPubkey: testUser.pubkey,
      offerType: 'ITEM',
      ticketType: 'SMART_ORDER',
      source: 'LOCAL',
      // visibility + disputeMode omitted → should default to PUBLIC
    },
  })
  console.log(`   ✓ Created offer ${defaultCreated.id}`)
  console.log(`     visibility  = ${defaultCreated.visibility} (expected: PUBLIC)`)
  console.log(`     disputeMode = ${defaultCreated.disputeMode} (expected: PUBLIC)`)
  if (defaultCreated.visibility !== 'PUBLIC') throw new Error('Default visibility should be PUBLIC')
  if (defaultCreated.disputeMode !== 'PUBLIC') throw new Error('Default disputeMode should be PUBLIC')

  // Cleanup default offer
  await prisma.offer.delete({ where: { id: defaultCreated.id } })
  console.log(`   ✓ Cleaned up default offer`)

  // 4. Toggle to PUBLIC via update
  console.log('\n3) Updating PRIVATE → PUBLIC...')
  const updated = await prisma.offer.update({
    where: { id: created.id },
    data: { visibility: 'PUBLIC', disputeMode: 'PUBLIC' },
  })
  console.log(`   ✓ Updated offer ${updated.id}`)
  console.log(`     visibility  = ${updated.visibility} (expected: PUBLIC)`)
  console.log(`     disputeMode = ${updated.disputeMode} (expected: PUBLIC)`)
  if (updated.visibility !== 'PUBLIC') throw new Error('Update to PUBLIC failed')

  // 5. Toggle to NONE dispute mode (allowed per ADR-152)
  console.log('\n4) Updating to visibility=PRIVATE + disputeMode=NONE...')
  const noneUpdated = await prisma.offer.update({
    where: { id: created.id },
    data: { visibility: 'PRIVATE', disputeMode: 'NONE' },
  })
  console.log(`   ✓ Updated offer ${noneUpdated.id}`)
  console.log(`     visibility  = ${noneUpdated.visibility} (expected: PRIVATE)`)
  console.log(`     disputeMode = ${noneUpdated.disputeMode} (expected: NONE)`)
  if (noneUpdated.disputeMode !== 'NONE') throw new Error('disputeMode=NONE not accepted')

  // 6. Cleanup
  console.log('\n5) Cleaning up test offer...')
  await prisma.offer.delete({ where: { id: created.id } })
  createdOfferId = null
  console.log('   ✓ Deleted test offer')

  console.log('\n✅ All Phase 2.1 visibility smoke test assertions passed.')
}

main()
  .catch(async (e) => {
    console.error('\n❌ Smoke test failed:', e)
    if (createdOfferId) {
      try {
        await prisma.offer.delete({ where: { id: createdOfferId } })
        console.log('Cleaned up test offer on failure')
      } catch { /* best effort */ }
    }
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
