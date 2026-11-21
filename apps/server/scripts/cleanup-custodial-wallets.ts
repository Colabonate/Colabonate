// FU-751 / ADR-381 addendum — remove stale custodial wallet rows.
//
// On a Direct-Pay-only production host (ADR-253) there is no LNBits/LND node,
// so a `Wallet{provider: LNBITS|LIGHTSPARK|MOCK}` row is not a usable wallet.
// `GET /api/wallet` already hides them (ADR-381 D4) and the four creation
// paths are gated (FU-753), but rows created before that guard can linger and
// stay `isActive`. This script deletes them.
//
// Safe by default: DRY RUN. It only mutates with `--apply`.
//
//   # inspect what would be removed
//   DATABASE_URL=postgres://... npx tsx apps/server/scripts/cleanup-custodial-wallets.ts
//
//   # actually remove
//   DATABASE_URL=postgres://... npx tsx apps/server/scripts/cleanup-custodial-wallets.ts --apply
//
// DEMO wallets are intentionally NOT touched (beta-only, ADR-197).
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const CUSTODIAL_PROVIDERS = ['LNBITS', 'LIGHTSPARK', 'MOCK'] as const
const apply = process.argv.includes('--apply')

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required.')
    process.exit(1)
  }
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const prisma = new PrismaClient({ adapter })

  try {
    const rows = await prisma.wallet.findMany({
      where: { provider: { in: [...CUSTODIAL_PROVIDERS] } },
      select: { id: true, userId: true, provider: true, mode: true, status: true, isActive: true, balanceSats: true },
    })

    const byProvider = rows.reduce<Record<string, number>>((acc, w) => {
      acc[w.provider] = (acc[w.provider] ?? 0) + 1
      return acc
    }, {})
    const activeCount = rows.filter(w => w.isActive).length
    const nonZeroBalance = rows.filter(w => w.balanceSats !== 0).length

    console.log('Custodial wallet rows found:', rows.length)
    console.log('  by provider:', byProvider)
    console.log('  currently active:', activeCount)
    console.log('  non-zero balance (should be 0 on a Direct-Pay-only host — investigate before deleting):', nonZeroBalance)

    if (rows.length === 0) {
      console.log('Nothing to do.')
      return
    }

    if (!apply) {
      console.log('\nDRY RUN — nothing deleted. Re-run with --apply to remove these rows.')
      return
    }

    if (nonZeroBalance > 0) {
      console.error('\nRefusing to delete: some rows carry a non-zero balance. A custodial row with real funds must never be silently dropped — investigate first (ADR-253: production never holds funds, so this indicates unexpected data).')
      process.exit(2)
    }

    const result = await prisma.wallet.deleteMany({ where: { provider: { in: [...CUSTODIAL_PROVIDERS] } } })
    console.log(`\nDeleted ${result.count} custodial wallet row(s).`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
