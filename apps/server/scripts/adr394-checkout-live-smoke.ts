// ADR-394 live smoke — quantity, shipping, stock reservation + release,
// checkoutId grouping and the new error contract, against a RUNNING server.
//
// Creates throwaway fixtures directly in the DB (buyer, seller with a Cashu
// receive rail so no LN network call is needed, one DRAFT ITEM offer that is
// never listed publicly) and deletes all of them at the end, pass or fail.
// Side effect: each created ticket publishes a Kind 30407 event with the
// server's ephemeral key (random throwaway pubkeys, no real user data).
//
// Production (inside the server container, which has DATABASE_URL):
//   docker compose -f docker-compose.production.yml --env-file .env.production \
//     exec -T -e BASE_URL=https://colabonate.app server \
//     npx tsx apps/server/scripts/adr394-checkout-live-smoke.ts
//
// The stock-release check waits for the server's own release tick
// (STOCK_RELEASE_TICK_MS, default 5 min); RELEASE_WAIT_MS caps the wait.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4001'
const RELEASE_WAIT_MS = Number(process.env.RELEASE_WAIT_MS ?? 6.5 * 60_000)
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS ${name}`) } else { fail++; console.log(`  FAIL ${name}`, detail ?? '') }
}

const PRICE = 1000
const SHIPPING = 300

async function main() {
  const buyerPubkey = randomBytes(32).toString('hex')
  const buyer2Pubkey = randomBytes(32).toString('hex')
  const sellerPubkey = randomBytes(32).toString('hex')
  const tokens = { buyer: randomBytes(32).toString('hex'), buyer2: randomBytes(32).toString('hex') }
  const createdTicketIds: string[] = []
  let offerId = ''
  let sellerId = ''

  try {
    await prisma.user.create({ data: { pubkey: buyerPubkey, identityLevel: 2, walletModeStrategy: 'NONCUSTODIAL_ONLY' } })
    await prisma.user.create({ data: { pubkey: buyer2Pubkey, identityLevel: 2, walletModeStrategy: 'NONCUSTODIAL_ONLY' } })
    const seller = await prisma.user.create({ data: { pubkey: sellerPubkey, identityLevel: 2 } })
    sellerId = seller.id
    await prisma.wallet.create({
      data: {
        userId: seller.id, provider: 'CASHU', mode: 'NON_CUSTODIAL', status: 'ACTIVE',
        cashuReceivePubkey: '02' + randomBytes(32).toString('hex'), cashuReceiveMintUrl: 'https://smoke-mint.test.invalid',
      },
    })
    const expiresAt = new Date(Date.now() + 3600_000)
    await prisma.session.create({ data: { pubkey: buyerPubkey, k1: randomUUID(), token: tokens.buyer, expiresAt } })
    await prisma.session.create({ data: { pubkey: buyer2Pubkey, k1: randomUUID(), token: tokens.buyer2, expiresAt } })
    const offer = await prisma.offer.create({
      data: {
        title: 'ADR-394 live smoke (throwaway)', priceSats: PRICE, categoryCode: 'services/other',
        offerType: 'ITEM', status: 'DRAFT', creatorPubkey: sellerPubkey,
        stock: 2, deliveryCostSats: SHIPPING, deliveryTimeDays: 3, physicalType: 'physical',
      },
    })
    offerId = offer.id

    const post = (token: string, body: Record<string, unknown>) =>
      fetch(`${BASE_URL}/api/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ offerId, ...body }),
      })
    const list = (token: string, checkoutId: string) =>
      fetch(`${BASE_URL}/api/tickets?checkoutId=${encodeURIComponent(checkoutId)}`, { headers: { Authorization: `Bearer ${token}` } })

    // ── Validation / error contract (no ticket is created) ───────────────────
    for (const [label, quantity] of [['0', 0], ['true', true], ['[3]', [3]], ['1001', 1001]] as const) {
      const r = await post(tokens.buyer, { quantity })
      const b = await r.json()
      check(`quantity ${label} → 400 BAD_REQUEST`, r.status === 400 && b.code === 'BAD_REQUEST', { status: r.status, b })
    }
    let r = await post(tokens.buyer, { quantity: 1, checkoutId: 'bad' })
    check('malformed checkoutId → 400', r.status === 400, r.status)
    r = await post(tokens.buyer, { quantity: 3 })
    let b = await r.json()
    check('quantity 3 > stock 2 → 409 INSUFFICIENT_STOCK (availableStock 2)', r.status === 409 && b.code === 'INSUFFICIENT_STOCK' && b.availableStock === 2, { status: r.status, b })

    // ── Real purchase: quantity × price + shipping, reservation, checkoutId ──
    const checkoutId = randomUUID()
    r = await post(tokens.buyer, { quantity: 2, checkoutId, deliveryCostSats: 1, deliveryAddress: 'Smoke Street 1' })
    b = await r.json()
    const ticket = b.ticket
    if (ticket?.id) createdTicketIds.push(ticket.id)
    check('POST quantity 2 → 200', r.status === 200 && b.success === true, { status: r.status, b })
    check(`amountSats = 2 × ${PRICE} + ${SHIPPING} shipping = ${2 * PRICE + SHIPPING}`, b.amountSats === 2 * PRICE + SHIPPING, b.amountSats)
    check('ticket.quantity = 2', ticket?.quantity === 2, ticket?.quantity)
    check('shipping comes from the offer, body value (1) ignored', ticket?.deliveryCostSats === SHIPPING, ticket?.deliveryCostSats)
    check('delivery time copied from the offer', ticket?.deliveryTimeDays === 3, ticket?.deliveryTimeDays)
    check('ticket.stockReserved = 2', ticket?.stockReserved === 2, ticket?.stockReserved)
    check('ticket.checkoutId stored', ticket?.checkoutId === checkoutId, ticket?.checkoutId)
    check('direct-pay Cashu rail, no escrow', ticket?.directPayRail === 'CASHU' && ticket?.escrowEnabled === false, ticket)
    const afterReserve = await prisma.offer.findUnique({ where: { id: offerId }, select: { stock: true } })
    check('offer.stock decremented 2 → 0', afterReserve?.stock === 0, afterReserve)

    r = await post(tokens.buyer2, { quantity: 1 })
    b = await r.json()
    check('second buyer on sold-out offer → 409 INSUFFICIENT_STOCK (availableStock 0)', r.status === 409 && b.code === 'INSUFFICIENT_STOCK' && b.availableStock === 0, { status: r.status, b })

    // ── checkoutId grouping (buyer-scoped) ───────────────────────────────────
    r = await list(tokens.buyer, checkoutId)
    b = await r.json()
    check('GET ?checkoutId → the one ticket + totalSats', r.status === 200 && b.total === 1 && b.totalSats === 2 * PRICE + SHIPPING, b)
    r = await list(tokens.buyer2, checkoutId)
    b = await r.json()
    check('GET ?checkoutId as another user → empty (buyer-scoped)', r.status === 200 && b.total === 0, b)
    r = await list(tokens.buyer, 'x')
    check('GET ?checkoutId malformed → 400', r.status === 400, r.status)

    // ── Release: cancel in the DB, wait for the server's own release tick ────
    if (ticket?.id) {
      await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'CANCELLED' } })
      const deadline = Date.now() + RELEASE_WAIT_MS
      let stock: number | null | undefined
      let reserved: number | undefined
      while (Date.now() < deadline) {
        stock = (await prisma.offer.findUnique({ where: { id: offerId }, select: { stock: true } }))?.stock
        reserved = (await prisma.ticket.findUnique({ where: { id: ticket.id }, select: { stockReserved: true } }))?.stockReserved
        if (stock === 2 && reserved === 0) break
        await new Promise((res) => setTimeout(res, 15_000))
      }
      check('release tick returned the units (stock 0 → 2, stockReserved → 0)', stock === 2 && reserved === 0, { stock, reserved })
    }
  } finally {
    const pubkeys = [buyerPubkey, buyer2Pubkey, sellerPubkey]
    await prisma.notification.deleteMany({ where: { ownerPubkey: { in: pubkeys } } }).catch(() => {})
    if (createdTicketIds.length) await prisma.ticket.deleteMany({ where: { id: { in: createdTicketIds } } })
    await prisma.ticket.deleteMany({ where: { OR: [{ buyerPubkey: { in: pubkeys } }, { sellerPubkey: { in: pubkeys } }] } })
    if (offerId) await prisma.offer.deleteMany({ where: { id: offerId } })
    if (sellerId) await prisma.wallet.deleteMany({ where: { userId: sellerId } })
    await prisma.session.deleteMany({ where: { pubkey: { in: pubkeys } } })
    await prisma.user.deleteMany({ where: { pubkey: { in: pubkeys } } })
    const leftovers = await prisma.user.count({ where: { pubkey: { in: pubkeys } } })
    console.log(`  cleanup: fixtures removed (leftover users: ${leftovers})`)
    await prisma.$disconnect()
  }
  console.log(`\nADR-394 live smoke: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
