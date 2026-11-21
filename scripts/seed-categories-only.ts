/**
 * One-shot script: seed only StandardCategories into the DB.
 * Fixes missing Level-3 categories (ADR-078).
 *
 * Usage: npx tsx scripts/seed-categories-only.ts
 */
import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { createClient } from '@libsql/client'
import { seedStandardCategories } from '../apps/server/services/categorySeed'

const client = createClient({ url: 'file:../../dev.db' })
const adapter = new PrismaLibSql(client as any)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Seeding StandardCategories only (ADR-078 v2)...')

  // Check existing
  const existing = await prisma.standardCategory.findMany()
  const byLevel: Record<number, number> = {}
  existing.forEach(c => { byLevel[c.level] = (byLevel[c.level] || 0) + 1 })
  console.log(`  Existing:  ${existing.length}  total (L1:  ${byLevel[1] || 0} , L2:  ${byLevel[2] || 0} , L3:  ${byLevel[3] || 0})`)

  const result = await seedStandardCategories(prisma)
  console.log(`Seeded  ${result.count}  StandardCategory entries`)
  console.log(`  After: (L1:  ${result.byLevel[1] || 0} , L2:  ${result.byLevel[2] || 0} , L3:  ${result.byLevel[3] || 0})`)
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
