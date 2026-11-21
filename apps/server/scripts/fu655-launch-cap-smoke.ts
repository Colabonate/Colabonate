// FU-655 / ADR-252 D2 live smoke — launch-phase per-transaction cap.
// Proves the cap is enforced server-side on POST /api/tickets (the primary
// direct-pay entry point), the generic /api/lightning/invoice route, and the
// workspace recharge route — and that amounts AT the cap still pass.
//
// Run against a throwaway server (never the user's running dev instance):
//   cd apps/server && APP_PORT=4098 BETA_MODE=true ICP_WORKSPACE_CANISTER_ID="" npx tsx index.ts
//   DATABASE_URL=... BASE_URL=http://localhost:4098 npx tsx apps/server/scripts/fu655-launch-cap-smoke.ts
// Optional: LAUNCH_CAP_EXPECTED=<sats> if the server runs with an override.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4098'
const CAP = Number(process.env.LAUNCH_CAP_EXPECTED || 210_000)
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
  const token = randomBytes(32).toString('hex')

  await prisma.user.create({ data: { pubkey: buyerPubkey, identityLevel: 2, walletModeStrategy: 'NONCUSTODIAL_ONLY' } })
  const seller = await prisma.user.create({ data: { pubkey: sellerPubkey, identityLevel: 2 } })
  // Cashu rail resolves with zero network calls (see adr308 smoke).
  await prisma.wallet.create({
    data: {
      userId: seller.id, provider: 'CASHU', mode: 'NON_CUSTODIAL', status: 'ACTIVE',
      cashuReceivePubkey: '02' + randomBytes(32).toString('hex'), cashuReceiveMintUrl: 'https://smoke-mint.test.invalid',
    },
  })
  await prisma.session.create({ data: { pubkey: buyerPubkey, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 3600_000) } })

  const makeOffer = (priceSats: number, title: string) => prisma.offer.create({
    data: { title, priceSats, categoryCode: 'services/other', offerType: 'SERVICE', status: 'ACTIVE', creatorPubkey: sellerPubkey },
  })
  const aboveOffer = await makeOffer(CAP + 1, 'FU-655 Smoke above cap')
  const atOffer = await makeOffer(CAP, 'FU-655 Smoke at cap')
  const belowOffer = await makeOffer(1_000, 'FU-655 Smoke below cap')

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const createTicket = (offerId: string) => fetch(`${BASE_URL}/api/tickets`, { method: 'POST', headers, body: JSON.stringify({ offerId }) })
  const createdTicketIds: string[] = []
  const isCapError = (status: number, body: Record<string, unknown>) =>
    status === 400 && body?.code === 'TX_ABOVE_LAUNCH_CAP' && body?.error === 'TX_ABOVE_LAUNCH_CAP'

  try {
    // 1. POST /api/tickets above the cap
    let r = await createTicket(aboveOffer.id)
    let body = await r.json()
    check(`POST /api/tickets with priceSats=${CAP + 1} -> 400 TX_ABOVE_LAUNCH_CAP`, isCapError(r.status, body), { status: r.status, body })
    check('cap error body carries capSats + amountSats', body?.capSats === CAP && body?.amountSats === CAP + 1, body)
    const orphan = await prisma.ticket.findFirst({ where: { offerId: aboveOffer.id } })
    check('no Ticket row is created for a capped request', orphan === null, orphan)

    // 2. exactly at the cap passes the cap check (inclusive boundary)
    r = await createTicket(atOffer.id)
    body = await r.json()
    check(`POST /api/tickets with priceSats=${CAP} is NOT rejected by the cap`, !isCapError(r.status, body), { status: r.status, body })
    check('at-cap ticket is created (200/201)', r.status === 200 || r.status === 201, { status: r.status, body })
    if (body?.ticket?.id) createdTicketIds.push(body.ticket.id)

    // 3. well below the cap — regression guard
    r = await createTicket(belowOffer.id)
    body = await r.json()
    check('POST /api/tickets with priceSats=1000 -> 200/201 (regression)', r.status === 200 || r.status === 201, { status: r.status, body })
    if (body?.ticket?.id) createdTicketIds.push(body.ticket.id)

    // 4. generic invoice route
    r = await fetch(`${BASE_URL}/api/lightning/invoice`, { method: 'POST', headers, body: JSON.stringify({ amountSats: CAP + 1, description: 'FU-655 smoke' }) })
    body = await r.json()
    check(`POST /api/lightning/invoice with ${CAP + 1} sats -> 400 TX_ABOVE_LAUNCH_CAP`, isCapError(r.status, body), { status: r.status, body })

    // 5. workspace recharge — the cap runs before the workspace lookup, so a
    //    nonexistent id proves the gate order without needing a fixture.
    r = await fetch(`${BASE_URL}/api/workspaces/does-not-exist/recharge`, { method: 'POST', headers, body: JSON.stringify({ amountSats: CAP + 1 }) })
    body = await r.json()
    check(`POST /api/workspaces/:id/recharge with ${CAP + 1} sats -> 400 TX_ABOVE_LAUNCH_CAP (before lookup)`, isCapError(r.status, body), { status: r.status, body })
    r = await fetch(`${BASE_URL}/api/workspaces/does-not-exist/recharge`, { method: 'POST', headers, body: JSON.stringify({ amountSats: 500 }) })
    body = await r.json()
    check('recharge with 500 sats passes the cap and reaches the lookup (404 NOT_FOUND)', r.status === 404 && body?.error === 'NOT_FOUND', { status: r.status, body })
  } finally {
    await prisma.ticket.deleteMany({ where: { offerId: { in: [aboveOffer.id, atOffer.id, belowOffer.id] } } })
    await prisma.offer.deleteMany({ where: { id: { in: [aboveOffer.id, atOffer.id, belowOffer.id] } } })
    await prisma.session.deleteMany({ where: { pubkey: buyerPubkey } })
    await prisma.wallet.deleteMany({ where: { userId: seller.id } })
    await prisma.user.deleteMany({ where: { pubkey: { in: [buyerPubkey, sellerPubkey] } } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
