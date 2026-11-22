// ADR-399 live smoke: server-side Direct-Pay LN settlement (on-demand via
// /payment-status and via the reconcile tick) and Cashu token delivery,
// against a RUNNING server.
//
// Fixtures are created directly in the DB and deleted at the end, pass or fail.
// The LN seller uses a real Lightning address (LN_ADDRESS, default the
// platform's own address) so ticket creation exercises the real LNURL path and
// records the provider's LUD-21 verify URL. Settlement itself is simulated: the
// ticket is pointed at a local fake verify endpoint with a known preimage.
//
// Run against a throwaway server started with DIRECT_PAY_RECONCILE_TICK_MS=3000:
//   BASE_URL=http://localhost:4098 npx tsx scripts/adr399-payment-settlement-smoke.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4098'
const LN_ADDRESS = process.env.LN_ADDRESS || 'platform@example.com'
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS ${name}`) } else { fail++; console.log(`  FAIL ${name}`, detail ?? '') }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const sha256 = (hex: string) => createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex')

// Fake LUD-21 verify endpoint: /verify/<key> → { settled, preimage }
const verifyState = new Map<string, { settled: boolean; preimage: string | null }>()
const verifyServer = createServer((req, res) => {
  const key = (req.url ?? '').split('/').pop() ?? ''
  const state = verifyState.get(key) ?? { settled: false, preimage: null }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ status: 'OK', settled: state.settled, preimage: state.preimage, pr: '' }))
})

async function main() {
  await new Promise<void>((r) => verifyServer.listen(0, '127.0.0.1', () => r()))
  const verifyBase = `http://127.0.0.1:${(verifyServer.address() as AddressInfo).port}/verify`

  const buyerPubkey = randomBytes(32).toString('hex')
  const strangerPubkey = randomBytes(32).toString('hex')
  const lnSellerPubkey = randomBytes(32).toString('hex')
  const cashuSellerPubkey = randomBytes(32).toString('hex')
  const pubkeys = [buyerPubkey, strangerPubkey, lnSellerPubkey, cashuSellerPubkey]
  const tokens = {
    buyer: randomBytes(32).toString('hex'),
    stranger: randomBytes(32).toString('hex'),
    cashuSeller: randomBytes(32).toString('hex'),
  }
  const offerIds: string[] = []
  const userIds: string[] = []

  try {
    for (const pk of [buyerPubkey, strangerPubkey]) {
      userIds.push((await prisma.user.create({ data: { pubkey: pk, identityLevel: 2, walletModeStrategy: 'NONCUSTODIAL_ONLY' } })).id)
    }
    userIds.push((await prisma.user.create({ data: { pubkey: lnSellerPubkey, identityLevel: 2, lnAddress: LN_ADDRESS } })).id)
    const cashuSeller = await prisma.user.create({ data: { pubkey: cashuSellerPubkey, identityLevel: 2 } })
    userIds.push(cashuSeller.id)
    await prisma.wallet.create({
      data: {
        userId: cashuSeller.id, provider: 'CASHU', mode: 'NON_CUSTODIAL', status: 'ACTIVE',
        cashuReceivePubkey: '02' + randomBytes(32).toString('hex'), cashuReceiveMintUrl: 'https://smoke-mint.test.invalid',
      },
    })
    const expiresAt = new Date(Date.now() + 3600_000)
    await prisma.session.create({ data: { pubkey: buyerPubkey, k1: randomUUID(), token: tokens.buyer, expiresAt } })
    await prisma.session.create({ data: { pubkey: strangerPubkey, k1: randomUUID(), token: tokens.stranger, expiresAt } })
    await prisma.session.create({ data: { pubkey: cashuSellerPubkey, k1: randomUUID(), token: tokens.cashuSeller, expiresAt } })

    const makeOffer = async (creatorPubkey: string) => {
      const o = await prisma.offer.create({
        data: {
          title: 'ADR-399 smoke (throwaway)', priceSats: 21, categoryCode: 'services/other',
          offerType: 'ITEM', status: 'DRAFT', creatorPubkey, stock: 10, physicalType: 'digital',
        },
      })
      offerIds.push(o.id)
      return o.id
    }
    const lnOfferId = await makeOffer(lnSellerPubkey)
    const cashuOfferId = await makeOffer(cashuSellerPubkey)

    const api = (token: string, path: string, init: RequestInit = {}) =>
      fetch(`${BASE_URL}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
      })
    const buy = async (offerId: string) => {
      const r = await api(tokens.buyer, '/api/tickets', { method: 'POST', body: JSON.stringify({ offerId }) })
      return { status: r.status, body: await r.json() }
    }

    // ── D1: the ticket records how the seller invoice was minted ────────────
    console.log('\nD1: invoice source on the ticket')
    const t1 = await buy(lnOfferId)
    check('LN ticket created', t1.status === 200 && t1.body.ticket?.directPayRail === 'LN', t1)
    const t1Id: string = t1.body.ticket?.id
    const row1 = await prisma.ticket.findUnique({ where: { id: t1Id } })
    check('sellerInvoiceSource = LNURL', row1?.sellerInvoiceSource === 'LNURL', row1?.sellerInvoiceSource)
    check('LUD-21 verify URL recorded', Boolean(row1?.sellerVerifyUrl?.startsWith('https://')), row1?.sellerVerifyUrl)

    // ── D2: on-demand check through /payment-status ─────────────────────────
    console.log('\nD2: settlement detected without the buyer preimage')
    let r = await api(tokens.buyer, `/api/tickets/${t1Id}/payment-status`)
    let b = await r.json()
    check('real provider: unpaid invoice reported unpaid', r.status === 200 && b.paid === false && b.rail === 'LN', b)

    const p1 = randomBytes(32).toString('hex')
    verifyState.set('t1', { settled: true, preimage: p1 })
    await prisma.ticket.update({ where: { id: t1Id }, data: { paymentHash: sha256(p1), sellerVerifyUrl: `${verifyBase}/t1` } })
    await sleep(10_500) // on-demand throttle window
    r = await api(tokens.buyer, `/api/tickets/${t1Id}/payment-status`)
    b = await r.json()
    check('settled + matching preimage → paid via /payment-status', b.paid === true && b.status === 'PAID', b)

    const r2 = await api(tokens.stranger, `/api/tickets/${t1Id}/payment-status`)
    check('stranger cannot read payment status', r2.status === 403, r2.status)

    const t2 = await buy(lnOfferId)
    const t2Id: string = t2.body.ticket?.id
    const p2 = randomBytes(32).toString('hex')
    verifyState.set('t2', { settled: true, preimage: randomBytes(32).toString('hex') })
    await prisma.ticket.update({ where: { id: t2Id }, data: { paymentHash: sha256(p2), sellerVerifyUrl: `${verifyBase}/t2` } })
    r = await api(tokens.buyer, `/api/tickets/${t2Id}/payment-status`)
    b = await r.json()
    check('settled claim with a WRONG preimage stays unpaid', b.paid === false && b.status === 'PENDING', b)
    await prisma.ticket.update({ where: { id: t2Id }, data: { sellerVerifyUrl: null } })

    console.log('\nD2: settlement detected by the reconcile tick')
    const t3 = await buy(lnOfferId)
    const t3Id: string = t3.body.ticket?.id
    const p3 = randomBytes(32).toString('hex')
    verifyState.set('t3', { settled: true, preimage: p3 })
    await prisma.ticket.update({ where: { id: t3Id }, data: { paymentHash: sha256(p3), sellerVerifyUrl: `${verifyBase}/t3` } })
    let t3Status = 'PENDING'
    for (let i = 0; i < 20 && t3Status === 'PENDING'; i++) {
      await sleep(1_000)
      t3Status = (await prisma.ticket.findUnique({ where: { id: t3Id } }))?.status ?? 'PENDING'
    }
    check('tick flips a paid ticket without any client call', t3Status === 'PAID', t3Status)

    // ── D3: Cashu token delivery through the ticket ─────────────────────────
    console.log('\nD3: Cashu token delivery')
    const c = await buy(cashuOfferId)
    const cId: string = c.body.ticket?.id
    check('Cashu ticket created', c.status === 200 && c.body.ticket?.directPayRail === 'CASHU', c)
    const token = 'cashuB' + randomBytes(48).toString('base64url')
    r = await api(tokens.buyer, `/api/tickets/${cId}/cashu-token`, { method: 'POST', body: JSON.stringify({ token: 'not-a-token' }) })
    check('malformed token → 400', r.status === 400, r.status)
    r = await api(tokens.stranger, `/api/tickets/${cId}/cashu-token`, { method: 'POST', body: JSON.stringify({ token }) })
    check('non-buyer → 403', r.status === 403, r.status)
    r = await api(tokens.buyer, `/api/tickets/${t2Id}/cashu-token`, { method: 'POST', body: JSON.stringify({ token }) })
    check('LN ticket rejects a Cashu token → 400', r.status === 400, r.status)
    r = await api(tokens.buyer, `/api/tickets/${cId}/cashu-token`, { method: 'POST', body: JSON.stringify({ token }) })
    b = await r.json()
    check('buyer delivers the token → 200', r.status === 200 && typeof b.cashuTokenSentAt === 'string', b)
    r = await api(tokens.buyer, `/api/tickets/${cId}/cashu-token`, { method: 'POST', body: JSON.stringify({ token }) })
    b = await r.json()
    check('second delivery → 409 CASHU_TOKEN_ALREADY_SENT', r.status === 409 && b.error === 'CASHU_TOKEN_ALREADY_SENT', b)

    r = await api(tokens.cashuSeller, `/api/tickets/${cId}`)
    b = await r.json()
    check('seller sees the token on the ticket', b.ticket?.cashuToken === token && Boolean(b.ticket?.cashuTokenSentAt), b.ticket?.cashuTokenSentAt)
    r = await api(tokens.stranger, `/api/tickets/${cId}`)
    check('stranger cannot read the ticket', r.status === 403, r.status)
    r = await api(tokens.buyer, `/api/tickets/${cId}/payment-status`)
    b = await r.json()
    check('/payment-status reports the delivery', b.rail === 'CASHU' && typeof b.cashuTokenSentAt === 'string' && b.paid === false, b)
    const notif = await prisma.notification.findFirst({ where: { ownerPubkey: cashuSellerPubkey, relatedId: cId } })
    check('seller got a "redeem it" notification', Boolean(notif), notif?.title)

    r = await api(tokens.cashuSeller, `/api/tickets/${cId}`, { method: 'PATCH', body: JSON.stringify({ status: 'PAID' }) })
    check('seller confirms after redeeming → PAID', r.status === 200, r.status)
  } finally {
    await prisma.notification.deleteMany({ where: { ownerPubkey: { in: pubkeys } } }).catch(() => {})
    await prisma.ticket.deleteMany({ where: { OR: [{ buyerPubkey: { in: pubkeys } }, { sellerPubkey: { in: pubkeys } }] } }).catch((e) => console.error('cleanup tickets', e))
    await prisma.offer.deleteMany({ where: { id: { in: offerIds } } }).catch((e) => console.error('cleanup offers', e))
    await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {})
    await prisma.session.deleteMany({ where: { pubkey: { in: pubkeys } } }).catch(() => {})
    await prisma.user.deleteMany({ where: { pubkey: { in: pubkeys } } }).catch((e) => console.error('cleanup users', e))
    verifyServer.close()
    await prisma.$disconnect()
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
