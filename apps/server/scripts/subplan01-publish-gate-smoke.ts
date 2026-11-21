// Product-Launch Sub-Plan 01 §1.4 — Publish-Gate audit (seller-wallet check).
// Verifies hasSellerPaymentMethodConfigured()'s DEMO-wallet fallback (ADR-255
// D1, services/sellerPaymentResolver.ts:174-177) does NOT mask a missing real
// payment method once BETA_MODE is off — the sub-plan's original wording
// only suspected this ("aktuell maskiert der Demo-Wallet-Fallback den
// Fehlerfall"); this smoke settles it empirically instead of by code reading
// alone. Run this script TWICE, once against each throwaway server:
//   1) APP_PORT=4098 BETA_MODE=true  npx tsx index.ts   -> BASE_URL=...4098 SCENARIO=beta
//   2) APP_PORT=4099 BETA_MODE=false npx tsx index.ts   -> BASE_URL=...4099 SCENARIO=prod
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4098'
const SCENARIO = process.env.SCENARIO === 'prod' ? 'prod' : 'beta' // matches the server's own BETA_MODE
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
let pass = 0, fail = 0
const check = (n: string, ok: boolean, d?: unknown) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${n}`, ok ? '' : JSON.stringify(d)) }

async function main() {
  const noWalletSeller = randomBytes(32).toString('hex')
  const demoOnlySeller = randomBytes(32).toString('hex')
  const token = randomBytes(32).toString('hex')

  const noWalletUser = await prisma.user.create({ data: { pubkey: noWalletSeller, identityLevel: 2 } })
  const demoUser = await prisma.user.create({ data: { pubkey: demoOnlySeller, identityLevel: 2 } })
  await prisma.wallet.create({ data: { userId: demoUser.id, provider: 'DEMO', mode: 'CUSTODIAL', status: 'ACTIVE' } })
  await prisma.session.create({ data: { pubkey: noWalletSeller, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 600_000) } })
  const demoToken = randomBytes(32).toString('hex')
  await prisma.session.create({ data: { pubkey: demoOnlySeller, k1: randomUUID(), token: demoToken, expiresAt: new Date(Date.now() + 600_000) } })

  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const HD = { 'Content-Type': 'application/json', Authorization: `Bearer ${demoToken}` }
  const createdOfferIds: string[] = []

  try {
    // 1. seller with NO wallet at all -> 422 regardless of BETA_MODE
    let r = await fetch(`${BASE_URL}/api/offers`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ title: 'Subplan01 no-wallet offer', priceSats: 5000, categoryCode: 'services/other', offerType: 'SERVICE', status: 'ACTIVE' }),
    })
    let b = await r.json()
    check(`[${SCENARIO}] no-wallet seller publishing ACTIVE -> 422 SELLER_PAYMENT_NOT_CONFIGURED`, r.status === 422 && b.error === 'SELLER_PAYMENT_NOT_CONFIGURED', { status: r.status, b })
    if (b?.offer?.id) createdOfferIds.push(b.offer.id)

    // 2. seller with ONLY a DEMO wallet
    r = await fetch(`${BASE_URL}/api/offers`, {
      method: 'POST', headers: HD,
      body: JSON.stringify({ title: 'Subplan01 demo-wallet offer', priceSats: 5000, categoryCode: 'services/other', offerType: 'SERVICE', status: 'ACTIVE' }),
    })
    b = await r.json()
    if (SCENARIO === 'beta') {
      check('[beta] DEMO-only seller publishing ACTIVE -> allowed (control case, ADR-255 D1 intentional)', r.status === 200 && b?.success === true, { status: r.status, b })
    } else {
      check('[prod] DEMO-only seller publishing ACTIVE -> 422 SELLER_PAYMENT_NOT_CONFIGURED (fallback does NOT leak past BETA_MODE=false)', r.status === 422 && b.error === 'SELLER_PAYMENT_NOT_CONFIGURED', { status: r.status, b })
    }
    if (b?.offer?.id) createdOfferIds.push(b.offer.id)

    // 3. same no-wallet seller can still save a DRAFT (gate is ACTIVE-only)
    r = await fetch(`${BASE_URL}/api/offers`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ title: 'Subplan01 draft offer', priceSats: 5000, categoryCode: 'services/other', offerType: 'SERVICE', status: 'DRAFT' }),
    })
    b = await r.json()
    check('DRAFT is exempt from the publish gate -> 200', r.status === 200 && b?.success === true, { status: r.status, b })
    if (b?.offer?.id) createdOfferIds.push(b.offer.id)
  } finally {
    await prisma.offer.deleteMany({ where: { id: { in: createdOfferIds } } })
    await prisma.session.deleteMany({ where: { pubkey: { in: [noWalletSeller, demoOnlySeller] } } })
    await prisma.wallet.deleteMany({ where: { userId: demoUser.id } })
    await prisma.user.deleteMany({ where: { pubkey: { in: [noWalletSeller, demoOnlySeller] } } })
    await prisma.$disconnect()
  }
  console.log(`[${SCENARIO}] ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
