/**
 * Migration script: populate categoryCode (UNSPSC) from existing category names.
 * ADR-059 – Standardized Category Protocol
 *
 * Run: npx tsx scripts/migrate-category-codes.ts
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'

const adapter = new PrismaLibSql({ url: process.env.DATABASE_URL || 'file:./dev.db' })
const prisma = new PrismaClient({ adapter })

// Mapping from legacy category string → UNSPSC code (matches categories-v1.json)
const CATEGORY_CODE_MAP: Record<string, string> = {
  Goods:       '31000000',
  Digital:     '43230000',
  Services:    '80000000',
  Cooperation: '80000000',
}

async function main() {
  const offers = await prisma.offer.findMany({
    where: { categoryCode: null },
    select: { id: true, category: true },
  })

  console.log(`Found ${offers.length} offers without categoryCode`)

  let updated = 0
  let skipped = 0

  for (const offer of offers) {
    const code = offer.category ? CATEGORY_CODE_MAP[offer.category] : undefined
    if (!code) {
      console.warn(`  SKIP id=${offer.id} — unknown category: "${offer.category}"`)
      skipped++
      continue
    }
    await prisma.offer.update({
      where: { id: offer.id },
      data: { categoryCode: code },
    })
    updated++
  }

  console.log(`Done: ${updated} updated, ${skipped} skipped`)
}

main()
  .catch(err => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
