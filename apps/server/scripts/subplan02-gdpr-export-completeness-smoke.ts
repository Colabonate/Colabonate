// Product-Launch Sub-Plan 02 §2.5.1 — GDPR Art. 15 export completeness check.
// The sub-plan asks to "manually verify GET /api/gdpr/export against a test
// user (all sections, no gaps)" — this script does that empirically instead
// of eyeballing the code: create one user with real data in every entity
// account-export.ts documents (Offer/Ticket/Review-written/Review-received/
// Cooperation/DmMessage/Company/Wallet/Session), hit the live HTTP endpoint,
// and assert every section round-trips with the right data AND that the two
// documented exclusions (Wallet.nwcConnectionUriEnc, Session.token/k1) are
// genuinely absent from the response, not just absent by convention.
//
// Run against a throwaway server (not the dev instance):
//   APP_PORT=4098 ICP_WORKSPACE_CANISTER_ID="" npx tsx index.ts
//   BASE_URL=http://localhost:4098 npx tsx scripts/subplan02-gdpr-export-completeness-smoke.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { randomBytes, randomUUID } from 'node:crypto'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4098'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d?: unknown) => {
  ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${n}`, ok ? '' : JSON.stringify(d))
}

async function main() {
  const A = randomBytes(32).toString('hex')
  const B = randomBytes(32).toString('hex')
  const token = randomBytes(32).toString('hex')

  const userA = await prisma.user.create({ data: { pubkey: A, identityLevel: 2 } })
  await prisma.user.create({ data: { pubkey: B, identityLevel: 2 } })
  await prisma.session.create({ data: { pubkey: A, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 600_000) } })

  const offer = await prisma.offer.create({
    data: {
      title: '[SMOKE] subplan02 gdpr export offer', priceSats: 5000, categoryCode: 'goods',
      creatorPubkey: A, offerType: 'ITEM', ticketType: 'SMART_ORDER', source: 'LOCAL', status: 'DRAFT',
    },
  })
  const ticket = await prisma.ticket.create({
    data: { offerId: offer.id, buyerPubkey: B, sellerPubkey: A, status: 'COMPLETED', escrowStatus: 'RELEASED' },
  })
  await prisma.review.create({
    data: { ticketId: ticket.id, reviewerPubkey: A, revieweePubkey: B, stars: 5, content: '[SMOKE] A wrote this' },
  })
  await prisma.review.create({
    data: { ticketId: ticket.id, reviewerPubkey: B, revieweePubkey: A, stars: 4, content: '[SMOKE] B wrote this about A' },
  })
  const coop = await prisma.cooperation.create({ data: { title: '[SMOKE] subplan02 coop', initiatorPubkey: A, budgetSats: 10000 } })
  await prisma.dmMessage.create({
    data: { ownerPubkey: A, peerPubkey: B, eventId: randomBytes(32).toString('hex'), kind: 1059, payload: '[SMOKE] dm', visibility: 'PRIVATE' },
  })
  const company = await prisma.company.create({ data: { ownerPubkey: A, name: '[SMOKE] subplan02 co' } })
  const wallet = await prisma.wallet.create({
    data: {
      userId: userA.id, provider: 'NWC', mode: 'NON_CUSTODIAL', status: 'ACTIVE', balanceSats: 1234,
      nwcConnectionUriEnc: 'THIS-MUST-NEVER-LEAVE-THE-SERVER', nwcWalletPubkey: 'deadbeef'.repeat(8),
    },
  })

  try {
    const res = await fetch(`${BASE_URL}/api/gdpr/export`, { headers: { Authorization: `Bearer ${token}` } })
    check('200 OK', res.status === 200, res.status)
    const body = await res.json() as Record<string, any>

    check('gdprLegalBasis present', typeof body.gdprLegalBasis === 'string' && body.gdprLegalBasis.includes('Art. 15'), body.gdprLegalBasis)
    check('exportedAt is a recent ISO timestamp', !Number.isNaN(Date.parse(body.exportedAt)), body.exportedAt)
    check('user.pubkey matches caller', body.user?.pubkey === A, body.user?.pubkey)

    check('offers[] contains the created offer', Array.isArray(body.offers) && body.offers.some((o: any) => o.id === offer.id), body.offers)
    check('tickets[] contains the created ticket (as seller)', Array.isArray(body.tickets) && body.tickets.some((t: any) => t.id === ticket.id), body.tickets)
    check('reviews.written[] contains A\'s own review', Array.isArray(body.reviews?.written) && body.reviews.written.some((r: any) => r.content === '[SMOKE] A wrote this'), body.reviews)
    check('reviews.received[] contains the review about A', Array.isArray(body.reviews?.received) && body.reviews.received.some((r: any) => r.content === '[SMOKE] B wrote this about A'), body.reviews)
    check('cooperations[] contains the created cooperation', Array.isArray(body.cooperations) && body.cooperations.some((c: any) => c.id === coop.id), body.cooperations)
    check('dmMessages[] contains the created DM', Array.isArray(body.dmMessages) && body.dmMessages.some((d: any) => d.eventId), body.dmMessages)
    check('companies[] contains the created company', Array.isArray(body.companies) && body.companies.some((c: any) => c.id === company.id), body.companies)

    const exportedWallet = Array.isArray(body.wallets) ? body.wallets.find((w: any) => w.id === wallet.id) : undefined
    check('wallets[] contains the created wallet', Boolean(exportedWallet), body.wallets)
    check('wallet balanceSats present', exportedWallet?.balanceSats === 1234, exportedWallet)
    check('wallet nwcConnectionUriEnc is EXCLUDED (live secret)', exportedWallet && !('nwcConnectionUriEnc' in exportedWallet), exportedWallet)
    check('wallet nwcWalletPubkey IS included (non-secret)', exportedWallet?.nwcWalletPubkey === 'deadbeef'.repeat(8), exportedWallet)

    check('sessions[] contains the active session', Array.isArray(body.sessions) && body.sessions.length >= 1, body.sessions)
    const exportedSession = body.sessions?.[0]
    check('session token is EXCLUDED (live bearer credential)', exportedSession && !('token' in exportedSession), exportedSession)
    check('session k1 is EXCLUDED', exportedSession && !('k1' in exportedSession), exportedSession)

    // Full-body scan: the raw wallet secret and the bearer token must not
    // appear ANYWHERE in the JSON, not just be absent from their own field.
    const raw = JSON.stringify(body)
    check('raw response never contains the NWC secret string', !raw.includes('THIS-MUST-NEVER-LEAVE-THE-SERVER'), null)
    check('raw response never contains the session bearer token', !raw.includes(token), null)

    // 401 without auth
    const unauth = await fetch(`${BASE_URL}/api/gdpr/export`)
    check('401 without Authorization header', unauth.status === 401, unauth.status)
  } finally {
    await prisma.session.deleteMany({ where: { pubkey: { in: [A, B] } } }).catch(() => {})
    await prisma.review.deleteMany({ where: { ticketId: ticket.id } }).catch(() => {})
    await prisma.dmMessage.deleteMany({ where: { ownerPubkey: { in: [A, B] } } }).catch(() => {})
    await prisma.wallet.delete({ where: { id: wallet.id } }).catch(() => {})
    await prisma.ticket.delete({ where: { id: ticket.id } }).catch(() => {})
    await prisma.offer.deleteMany({ where: { creatorPubkey: A } }).catch(() => {})
    await prisma.outboxEvent.deleteMany({ where: { aggregate: 'offer', aggregateId: offer.id } }).catch(() => {})
    await prisma.cooperation.delete({ where: { id: coop.id } }).catch(() => {})
    await prisma.company.delete({ where: { id: company.id } }).catch(() => {})
    await prisma.user.deleteMany({ where: { pubkey: { in: [A, B] } } }).catch(() => {})
    await pool.end()
  }

  console.log(`\n${pass}/${pass + fail} checks passed`)
  if (fail > 0) process.exitCode = 1
}

main().catch((e) => { console.error('SMOKE CRASHED:', e); process.exitCode = 1 })
