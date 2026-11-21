// ADR-372 live smoke test: hosted-canvas service fee (doop-hosted).
// Exercises the two-payment purchase end-to-end in Beta (DEMO rail):
//   seller-leg invoice (DEMO, price) + platform fee invoice (DEMO, 5 %),
//   with the two-confirm PENDING -> PAID gate. Requires the server under test
//   to run with BETA_MODE=true (local .env already sets it) so both the seller
//   rail and the platform receiving rail resolve DEMO.
//
// Run against a throwaway server (new code, own port) + local Postgres:
//   DATABASE_URL=postgresql://colabonate:dev@localhost:5434/colabonate BASE_URL=http://localhost:4098 npx tsx apps/server/scripts/adr372-hosted-canvas-fee-smoke.ts
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

const PRICE_SATS = 10_000
const FEE_SATS = 500 // floor(10000 * 500 / 10000)

async function main() {
  const buyerPubkey = randomBytes(32).toString('hex')
  const sellerPubkey = randomBytes(32).toString('hex')
  const buyerToken = randomBytes(32).toString('hex')

  const buyer = await prisma.user.create({ data: { pubkey: buyerPubkey, identityLevel: 2 } })
  const seller = await prisma.user.create({ data: { pubkey: sellerPubkey, identityLevel: 2 } })
  // DEMO wallets: buyer funded enough for price + fee; seller just needs the
  // ACTIVE DEMO row to resolve the seller rail (ADR-255 D1).
  const buyerWallet = await prisma.wallet.create({
    data: { userId: buyer.id, provider: 'DEMO', mode: 'NON_CUSTODIAL', balanceSats: 100_000 },
  })
  await prisma.wallet.create({ data: { userId: seller.id, provider: 'DEMO', mode: 'NON_CUSTODIAL', balanceSats: 0 } })
  await prisma.session.create({
    data: { pubkey: buyerPubkey, k1: randomUUID(), token: buyerToken, expiresAt: new Date(Date.now() + 3600_000) },
  })

  const agentProfile = await prisma.agentProfile.create({
    data: { ownerPubkey: sellerPubkey, name: 'smoke-372-agent', capabilities: ['research'], tools: [], isPublic: true },
  })
  const offer = await prisma.offer.create({
    data: {
      title: 'ADR-372 Smoke Hosted Agent', priceSats: PRICE_SATS, categoryCode: 'services/other',
      offerType: 'AGENT_SETUP', status: 'ACTIVE', creatorPubkey: sellerPubkey, agentProfileId: agentProfile.id,
      agentConfigSealed: 'fake', agentConfigMeta: { capabilities: ['research'], canvas: { provider: 'doop-hosted' } },
    },
  })

  const buyerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${buyerToken}` }

  let ticketId: string | undefined
  let sellerPaymentHash: string | undefined
  try {
    // 1. Purchase — the ticket must carry a separate DEMO fee leg.
    let r = await fetch(`${BASE_URL}/api/tickets`, { method: 'POST', headers: buyerHeaders, body: JSON.stringify({ offerId: offer.id }) })
    let body = await r.json()
    check('POST /api/tickets -> 200', r.status === 200, body)
    ticketId = body?.ticket?.id as string | undefined
    sellerPaymentHash = body?.paymentHash as string | undefined
    check('fee rail is DEMO (beta platform rail)', body?.feeRail === 'DEMO', body)
    check('fee invoice null on DEMO (no bolt11)', body?.feeInvoice === null, body)
    check(`feeSats = ${FEE_SATS} (5 % of ${PRICE_SATS})`, body?.feeSats === FEE_SATS, body)
    check('ticket snapshot hostedCanvasFeeBps = 500', body?.ticket?.hostedCanvasFeeBps === 500, body?.ticket)
    check('ticket snapshot hostedCanvasFeeSats = 500', body?.ticket?.hostedCanvasFeeSats === FEE_SATS, body?.ticket)
    check('platformFee row created, rail DEMO', body?.ticket?.platformFee?.rail === 'DEMO', body?.ticket?.platformFee)
    check('platformFee row PENDING', body?.ticket?.platformFee?.status === 'PENDING', body?.ticket?.platformFee)
    check('platformFee amountSats = 500', body?.ticket?.platformFee?.amountSats === FEE_SATS, body?.ticket?.platformFee)

    // 2. Seller leg (demo-pay) — must NOT flip PAID while the fee is open.
    r = await fetch(`${BASE_URL}/api/beta/demo-pay`, { method: 'POST', headers: buyerHeaders, body: JSON.stringify({ paymentHash: sellerPaymentHash }) })
    body = await r.json()
    check('demo-pay seller leg -> 200', r.status === 200, body)
    check('seller leg records SELLER_LEG_CONFIRMED (not PAID)', (body?.updated ?? []).includes(`ticket:${ticketId}:SELLER_LEG_CONFIRMED`), body)

    let ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { platformFee: true } })
    check('ticket still NOT PAID after seller leg', ticket?.status !== 'PAID', ticket?.status)
    check('fee row sellerLegConfirmedAt set', ticket?.platformFee?.sellerLegConfirmedAt != null, ticket?.platformFee)

    const buyerAfterSellerLeg = (await prisma.wallet.findUnique({ where: { id: buyerWallet.id } }))!.balanceSats
    check('buyer demo balance debited price (100000 -> 90000)', buyerAfterSellerLeg === 100_000 - PRICE_SATS, buyerAfterSellerLeg)
    const sellerWallet = await prisma.wallet.findUnique({ where: { userId_provider: { userId: seller.id, provider: 'DEMO' } } })
    check('seller demo balance credited price (10000)', sellerWallet?.balanceSats === PRICE_SATS, sellerWallet?.balanceSats)

    // 3. Fee leg — DEMO confirm (no preimage) debits the fee and flips PAID.
    r = await fetch(`${BASE_URL}/api/tickets/${ticketId}/confirm-canvas-fee`, { method: 'POST', headers: buyerHeaders, body: JSON.stringify({}) })
    body = await r.json()
    check('confirm-canvas-fee -> 200', r.status === 200, body)
    check('fee leg flips ticket PAID', (body?.updated ?? []).includes(`ticket:${ticketId}:PAID`), body)
    check('fee row marked PAID', body?.fee?.status === 'PAID', body?.fee)

    ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { platformFee: true } })
    check('ticket PAID after both legs', ticket?.status === 'PAID', ticket?.status)
    check('fee row PAID', ticket?.platformFee?.status === 'PAID', ticket?.platformFee)
    check('fee row confirmedAt set', ticket?.platformFee?.confirmedAt != null, ticket?.platformFee)

    const buyerFinal = (await prisma.wallet.findUnique({ where: { id: buyerWallet.id } }))!.balanceSats
    check('buyer demo balance debited price + fee (89000)', buyerFinal === 100_000 - PRICE_SATS - FEE_SATS, buyerFinal)

    // 4. Non-hosted control: a plain AGENT_SETUP offer must NOT carry a fee.
    const plainOffer = await prisma.offer.create({
      data: {
        title: 'ADR-372 Smoke Plain Agent', priceSats: 5000, categoryCode: 'services/other',
        offerType: 'AGENT_SETUP', status: 'ACTIVE', creatorPubkey: sellerPubkey, agentProfileId: agentProfile.id,
        agentConfigSealed: 'fake', agentConfigMeta: { capabilities: ['research'] },
      },
    })
    r = await fetch(`${BASE_URL}/api/tickets`, { method: 'POST', headers: buyerHeaders, body: JSON.stringify({ offerId: plainOffer.id }) })
    body = await r.json()
    check('non-hosted AGENT_SETUP -> no fee leg', r.status === 200 && body?.feeSats === null && body?.ticket?.platformFee == null, body)
    await prisma.ticket.deleteMany({ where: { offerId: plainOffer.id } })
    await prisma.offer.delete({ where: { id: plainOffer.id } })
  } finally {
    if (ticketId) await prisma.ticketPlatformFee.deleteMany({ where: { ticketId } })
    if (ticketId) await prisma.ticket.deleteMany({ where: { id: ticketId } })
    await prisma.offer.deleteMany({ where: { id: offer.id } })
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
