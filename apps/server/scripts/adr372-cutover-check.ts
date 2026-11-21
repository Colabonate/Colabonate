// ADR-372 flag-removal cutover check (D7 / open question 4): with the Beta
// flag OFF and PLATFORM_LN_ADDRESS unset, a doop-hosted purchase must fail with
// 503 PLATFORM_PAYMENT_NOT_CONFIGURED BEFORE any seller invoice is issued —
// no half-paid ticket can exist. Run against a throwaway NON-beta server:
//   DATABASE_URL=... BASE_URL=http://localhost:4099 npx tsx apps/server/scripts/adr372-cutover-check.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4001'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, detail ?? '') }
}

async function main() {
  const buyerPubkey = randomBytes(32).toString('hex')
  const sellerPubkey = randomBytes(32).toString('hex')
  const buyerToken = randomBytes(32).toString('hex')

  const buyer = await prisma.user.create({ data: { pubkey: buyerPubkey, identityLevel: 2 } })
  const seller = await prisma.user.create({ data: { pubkey: sellerPubkey, identityLevel: 2 } })
  await prisma.wallet.create({ data: { userId: buyer.id, provider: 'DEMO', mode: 'NON_CUSTODIAL', balanceSats: 100_000 } })
  await prisma.wallet.create({ data: { userId: seller.id, provider: 'DEMO', mode: 'NON_CUSTODIAL', balanceSats: 0 } })
  await prisma.session.create({
    data: { pubkey: buyerPubkey, k1: randomUUID(), token: buyerToken, expiresAt: new Date(Date.now() + 3600_000) },
  })

  const agentProfile = await prisma.agentProfile.create({
    data: { ownerPubkey: sellerPubkey, name: 'smoke-372-cutover', capabilities: ['research'], tools: [], isPublic: true },
  })
  const offer = await prisma.offer.create({
    data: {
      title: 'ADR-372 Cutover Agent', priceSats: 10_000, categoryCode: 'services/other',
      offerType: 'AGENT_SETUP', status: 'ACTIVE', creatorPubkey: sellerPubkey, agentProfileId: agentProfile.id,
      agentConfigSealed: 'fake', agentConfigMeta: { capabilities: ['research'], canvas: { provider: 'doop-hosted' } },
    },
  })

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${buyerToken}` }
  try {
    const r = await fetch(`${BASE_URL}/api/tickets`, { method: 'POST', headers, body: JSON.stringify({ offerId: offer.id }) })
    const body = await r.json()
    check('non-beta + address unset -> 503', r.status === 503, body)
    check('reason PLATFORM_PAYMENT_NOT_CONFIGURED', body?.error === 'PLATFORM_PAYMENT_NOT_CONFIGURED', body)

    const tickets = await prisma.ticket.findMany({ where: { offerId: offer.id } })
    check('no half-paid ticket created (no seller invoice issued)', tickets.length === 0, tickets.length)
  } finally {
    await prisma.ticket.deleteMany({ where: { offerId: offer.id } })
    await prisma.offer.delete({ where: { id: offer.id } })
    await prisma.agentProfile.delete({ where: { id: agentProfile.id } })
    await prisma.session.deleteMany({ where: { pubkey: buyerPubkey } })
    await prisma.wallet.deleteMany({ where: { userId: { in: [buyer.id, seller.id] } } })
    await prisma.user.deleteMany({ where: { pubkey: { in: [buyerPubkey, sellerPubkey] } } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
