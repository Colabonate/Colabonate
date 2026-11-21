// Throwaway helper: mints a user + session (+ optional company) against the
// dev DB so a Playwright script can drive an authenticated browser session.
// Prints { pubkey, token } as JSON on stdout. Run against the DATABASE_URL
// the running dev server (:4001) actually points at.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  const pubkey = randomBytes(32).toString('hex')
  const token = randomBytes(32).toString('hex')
  await prisma.user.create({ data: { pubkey, identityLevel: 2, lnAddress: `${pubkey.slice(0, 8)}@ln.tld` } })
  await prisma.session.create({
    data: { pubkey, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 3600_000) },
  })
  const company = await prisma.company.create({ data: { ownerPubkey: pubkey, name: 'FU492 Playwright Co', isActive: true } })
  console.log(JSON.stringify({ pubkey, token, companyId: company.id }))
  await prisma.$disconnect()
}
main()
