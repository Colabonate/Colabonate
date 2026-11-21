import 'dotenv/config'
import { createHash } from 'crypto'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const SQLITE_DB_PATH = resolve(import.meta.dirname, '../../../prisma/dev.db')
const SNAPSHOT_FILE = resolve(import.meta.dirname, '../../../.migration-snapshot')
const BATCH_SIZE = 1000
const PG_LOCK_ID = 42_139

const isDryRun = process.argv.includes('--dry-run')

interface TableMigration {
  table: string
  order: number
  transform?: (row: Record<string, unknown>) => Record<string, unknown>
}

const TABLE_ORDER: TableMigration[] = [
  { table: 'User', order: 1 },
  { table: 'Session', order: 2 },
  { table: 'Wallet', order: 3 },
  { table: 'Company', order: 4, transform: transformCompanyJson },
  { table: 'StandardCategory', order: 5 },
  { table: 'Catalog', order: 6 },
  { table: 'Product', order: 7 },
  { table: 'DeliveryTemplate', order: 8 },
  { table: 'Offer', order: 9, transform: transformOfferJson },
  { table: 'OfferMilestone', order: 10 },
  { table: 'Ticket', order: 11, transform: transformTicketJson },
  { table: 'Milestone', order: 12 },
  { table: 'Review', order: 13 },
  { table: 'ColPointsEvent', order: 14 },
  { table: 'CompanyReview', order: 15 },
  { table: 'Cooperation', order: 16, transform: transformCooperationJson },
  { table: 'CoopMilestone', order: 17 },
  { table: 'CoopMilestoneMessage', order: 18 },
  { table: 'CoopMilestoneApplication', order: 19 },
  { table: 'CooperationTemplate', order: 20 },
  { table: 'Dao', order: 21 },
  { table: 'DaoMember', order: 22 },
  { table: 'DaoConfig', order: 23 },
  { table: 'Dispute', order: 24 },
  { table: 'ArbitrationVerdict', order: 25 },
  { table: 'AdminAuditLog', order: 26 },
  { table: 'NotificationLog', order: 27 },
  { table: 'AppealRequest', order: 28 },
  { table: 'NostrAuthChallenge', order: 29 },
  { table: 'DaoProposal', order: 30 },
  { table: 'DaoVote', order: 31 },
  { table: 'DaoGovernanceConfig', order: 32 },
  { table: 'DaoTreasury', order: 33 },
  { table: 'TreasuryTransaction', order: 34 },
]

function parseJsonSafe(val: unknown): unknown {
  if (typeof val !== 'string') return val
  try { return JSON.parse(val) } catch { return val }
}

function transformCompanyJson(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    images: parseJsonSafe(row.images),
    openingHours: parseJsonSafe(row.openingHours),
    businessFields: parseJsonSafe(row.businessFields),
    socialLinks: parseJsonSafe(row.socialLinks),
  }
}

function transformOfferJson(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    images: parseJsonSafe(row.images),
  }
}

function transformTicketJson(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    deliveryAddress: parseJsonSafe(row.deliveryAddress),
  }
}

function transformCooperationJson(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    skills: parseJsonSafe(row.skills),
    images: parseJsonSafe(row.images),
  }
}

function getFileHash(filePath: string): string {
  const content = readFileSync(filePath)
  return createHash('sha256').update(content).digest('hex')
}

async function main() {
  console.log(`\n=== SQLite → PostgreSQL Migration Script ===`)
  console.log(`Mode: ${isDryRun ? 'DRY RUN (no writes)' : 'LIVE MIGRATION'}\n`)

  if (!existsSync(SQLITE_DB_PATH)) {
    console.error(`SQLite database not found at: ${SQLITE_DB_PATH}`)
    console.error('This script requires the existing SQLite database to migrate from.')
    process.exit(1)
  }

  const currentHash = getFileHash(SQLITE_DB_PATH)
  console.log(`SQLite DB hash: ${currentHash}`)

  if (existsSync(SNAPSHOT_FILE)) {
    const savedHash = readFileSync(SNAPSHOT_FILE, 'utf-8').trim()
    if (savedHash !== currentHash) {
      console.error(`\nHash mismatch! SQLite DB has changed since last snapshot.`)
      console.error(`  Saved:   ${savedHash}`)
      console.error(`  Current: ${currentHash}`)
      console.error(`\nCreate a fresh snapshot first: echo "${currentHash}" > ${SNAPSHOT_FILE}`)
      process.exit(1)
    }
    console.log('Snapshot hash matches. Proceeding...\n')
  } else {
    console.error(`\nNo snapshot file found at: ${SNAPSHOT_FILE}`)
    console.error('Create one before running migration:')
    console.error(`  echo "${currentHash}" > ${SNAPSHOT_FILE}`)
    process.exit(1)
  }

  if (isDryRun) {
    console.log('DRY RUN: Would migrate the following tables in order:')
    for (const t of TABLE_ORDER) {
      console.log(`  ${t.order}. ${t.table}${t.transform ? ' (JSON transform)' : ''}`)
    }
    console.log('\nTo run the actual migration, remove --dry-run flag.')
    return
  }

  console.log('⚠️  LIVE MIGRATION: This will write to the PostgreSQL database.')
  console.log('Ensure you have a backup before proceeding.\n')

  const { PrismaClient } = await import('@prisma/client')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const adapter = new PrismaPg(pool)
  const prisma = new PrismaClient({ adapter })

  try {
    await prisma.$executeRawUnsafe(`SELECT pg_advisory_lock(${PG_LOCK_ID})`)
    console.log('Acquired PG advisory lock.\n')

    for (const { table, transform } of TABLE_ORDER) {
      const model = prisma[table.charAt(0).toLowerCase() + table.slice(1) as keyof typeof prisma]
      if (!model || typeof (model as any).count !== 'function') {
        console.log(`  SKIP ${table} (model not found in Prisma client)`)
        continue
      }

      const count = await (model as any).count()
      if (count === 0) {
        console.log(`  SKIP ${table} (0 rows)`)
        continue
      }

      console.log(`  MIGRATING ${table} (${count} rows)...`)

      let migrated = 0
      const cursor = { id: undefined as string | undefined }

      while (migrated < count) {
        const batch = await (model as any).findMany({
          where: cursor.id ? { id: { gt: cursor.id } } : {},
          take: BATCH_SIZE,
          orderBy: { id: 'asc' },
        })

        if (batch.length === 0) break

        for (const row of batch) {
          const data = transform ? transform(row) : row
          try {
            await (model as any).upsert({
              where: { id: data.id },
              update: data,
              create: data,
            })
          } catch (err) {
            console.error(`    ERROR on ${table}/${data.id}:`, err instanceof Error ? err.message : err)
          }
        }

        cursor.id = batch[batch.length - 1].id
        migrated += batch.length
        process.stdout.write(`    ${migrated}/${count}\r`)
      }

      console.log(`    ✓ ${table}: ${migrated}/${count} rows migrated`)
    }

    console.log('\n=== Migration Complete ===')
    console.log('Run verification: check row counts in PostgreSQL match SQLite source.')
  } catch (error) {
    console.error('\nMigration failed:', error)
    process.exit(1)
  } finally {
    await prisma.$executeRawUnsafe(`SELECT pg_advisory_unlock(${PG_LOCK_ID})`).catch(() => {})
    await prisma.$disconnect()
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
