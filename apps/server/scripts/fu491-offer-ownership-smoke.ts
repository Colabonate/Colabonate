// FU-491 live smoke test: exercises the offer-ownership + companyId
// ownership fixes over real HTTP against a throwaway server instance —
//   1. PATCH /api/offers/:id by a non-owner is rejected 403 (previously had
//      NO ownership check at all — any authenticated pubkey could edit any
//      other user's offer).
//   2. DELETE /api/offers/:id by a non-owner is rejected 403 (same bug).
//   3. The actual owner can still PATCH/DELETE their own offer.
//   4. POST /api/offers with a companyId the caller doesn't own is rejected
//      400 (ADR-326 D10.1 / FU-491 — companyId was previously accepted
//      verbatim with no ownership check).
//   5. POST /api/offers with the caller's own companyId succeeds and
//      persists it.
// Run with (spin a throwaway server first — the :4001 dev instance does not
// hot-reload):
//   $env:APP_PORT='4099'; npx tsx apps/server/index.ts
//   $env:DATABASE_URL='<from .env>'; npx tsx apps/server/scripts/fu491-offer-ownership-smoke.ts
// (BASE_URL defaults to http://localhost:4099)
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4099'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, detail ?? '') }
}

async function makeUser() {
  const pubkey = randomBytes(32).toString('hex')
  const token = randomBytes(32).toString('hex')
  await prisma.user.create({ data: { pubkey, identityLevel: 2, lnAddress: `${pubkey.slice(0, 8)}@ln.tld` } })
  await prisma.session.create({
    data: { pubkey, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 3600_000) },
  })
  return { pubkey, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }
}

async function main() {
  const owner = await makeUser()
  const stranger = await makeUser()

  const call = (headers: Record<string, string>, path: string, method = 'GET', body?: unknown) =>
    fetch(`${BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })

  const createdOfferIds: string[] = []
  const createdCompanyIds: string[] = []

  try {
    // ── setup: owner creates an offer ───────────────────────────────────
    let r = await call(owner.headers, '/api/offers', 'POST', {
      title: 'fu491-smoke-offer', description: 'x', priceSats: 1000, category: 'Goods', offerType: 'ITEM', status: 'DRAFT',
    })
    let data = await r.json()
    check('setup: owner creates offer', r.status === 201 || r.status === 200, { status: r.status, data })
    const offerId = data.offer?.id ?? data.id
    if (offerId) createdOfferIds.push(offerId)

    // ── 1: stranger PATCHes owner's offer → 403 ─────────────────────────
    r = await call(stranger.headers, `/api/offers/${offerId}`, 'PATCH', { title: 'hijacked' })
    check('stranger PATCH on owner offer -> 403', r.status === 403, { status: r.status })

    // verify title unchanged
    r = await call(owner.headers, `/api/offers/${offerId}`)
    data = await r.json()
    check('offer title unchanged after rejected PATCH', (data.offer?.title ?? data.title) === 'fu491-smoke-offer', data)

    // ── 2: stranger DELETEs owner's offer → 403 ─────────────────────────
    r = await call(stranger.headers, `/api/offers/${offerId}`, 'DELETE')
    check('stranger DELETE on owner offer -> 403', r.status === 403, { status: r.status })

    const stillExists = await prisma.offer.findUnique({ where: { id: offerId } })
    check('offer still exists after rejected DELETE', !!stillExists, stillExists)

    // ── 3: owner can still PATCH their own offer ────────────────────────
    r = await call(owner.headers, `/api/offers/${offerId}`, 'PATCH', { title: 'fu491-smoke-offer-edited' })
    data = await r.json()
    check('owner PATCH on own offer -> 200', r.status === 200, { status: r.status, data })

    // ── 4: companyId ownership — stranger's company can't be attached ──
    const strangerCompany = await prisma.company.create({
      data: { ownerPubkey: stranger.pubkey, name: 'stranger-co' },
    })
    createdCompanyIds.push(strangerCompany.id)

    r = await call(owner.headers, '/api/offers', 'POST', {
      title: 'fu491-spoof-attempt', description: 'x', priceSats: 1000, category: 'Goods', offerType: 'ITEM', status: 'DRAFT',
      companyId: strangerCompany.id,
    })
    check('POST with someone else\'s companyId -> 400', r.status === 400, { status: r.status, body: await r.json() })

    // ── 5: owner's own companyId is accepted and persisted ─────────────
    const ownerCompany = await prisma.company.create({
      data: { ownerPubkey: owner.pubkey, name: 'owner-co' },
    })
    createdCompanyIds.push(ownerCompany.id)

    r = await call(owner.headers, '/api/offers', 'POST', {
      title: 'fu491-own-company-offer', description: 'x', priceSats: 1000, category: 'Goods', offerType: 'ITEM', status: 'DRAFT',
      companyId: ownerCompany.id,
    })
    data = await r.json()
    check('POST with own companyId -> 200/201', r.status === 200 || r.status === 201, { status: r.status, data })
    const companyOfferId = data.offer?.id ?? data.id
    if (companyOfferId) createdOfferIds.push(companyOfferId)
    check('own companyId persisted', (data.offer?.companyId ?? data.companyId) === ownerCompany.id, data)

    // ── 6: PATCH with someone else's companyId is also rejected ────────
    r = await call(owner.headers, `/api/offers/${offerId}`, 'PATCH', { companyId: strangerCompany.id })
    check('PATCH with someone else\'s companyId -> 400', r.status === 400, { status: r.status, body: await r.json() })
  } finally {
    for (const id of createdOfferIds) {
      await prisma.offer.deleteMany({ where: { id } }).catch(() => {})
    }
    for (const id of createdCompanyIds) {
      await prisma.company.deleteMany({ where: { id } }).catch(() => {})
    }
    await prisma.session.deleteMany({ where: { pubkey: { in: [owner.pubkey, stranger.pubkey] } } })
    await prisma.user.deleteMany({ where: { pubkey: { in: [owner.pubkey, stranger.pubkey] } } })
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  await prisma.$disconnect()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
