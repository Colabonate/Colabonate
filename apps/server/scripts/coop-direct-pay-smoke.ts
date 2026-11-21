// Cooperation direct-pay (escrow off) live smoke. Run against a server started with
// COOP_ESCROW_ENABLED unset, e.g.:
//   DATABASE_URL=... BASE_URL=http://localhost:4098 npx tsx apps/server/scripts/coop-direct-pay-smoke.ts
// The partner uses a real LN address, so it mints (never pays) one unpaid invoice.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'
const BASE = process.env.BASE_URL || 'http://localhost:4098'
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
let pass = 0, fail = 0
const check = (n: string, ok: boolean, d?: unknown) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${n}`, ok ? '' : JSON.stringify(d)) }
async function main() {
  const init = randomBytes(32).toString('hex'), partner = randomBytes(32).toString('hex'), noRail = randomBytes(32).toString('hex'), cashuP = randomBytes(32).toString('hex')
  const tC = randomBytes(32).toString('hex')
  const tI = randomBytes(32).toString('hex'), tP = randomBytes(32).toString('hex')
  await prisma.user.create({ data: { pubkey: init, identityLevel: 2 } })
  await prisma.user.create({ data: { pubkey: partner, identityLevel: 2, lnAddress: 'LN_ADDRESS_REDACTED' } })
  await prisma.user.create({ data: { pubkey: noRail, identityLevel: 2 } })
  const cashuUser = await prisma.user.create({ data: { pubkey: cashuP, identityLevel: 2 } })
  await prisma.wallet.create({ data: { userId: cashuUser.id, provider: 'CASHU', mode: 'NON_CUSTODIAL', cashuReceivePubkey: randomBytes(32).toString('hex'), cashuReceiveMintUrl: 'https://mint.minibits.cash/Bitcoin' } })
  for (const [pk, t] of [[init, tI], [partner, tP], [cashuP, tC]]) await prisma.session.create({ data: { pubkey: pk, k1: randomUUID(), token: t, expiresAt: new Date(Date.now() + 600_000) } })
  const mk = async (partnerPk: string, msStatus: 'COMPLETED' | 'PENDING' = 'COMPLETED') => {
    const c = await prisma.cooperation.create({ data: { title: 'tmp direct', initiatorPubkey: init, partnerPubkey: partnerPk, budgetSats: 2000, status: 'ACCEPTED' } })
    const m = await prisma.coopMilestone.create({ data: { cooperationId: c.id, milestoneIndex: 1, title: 'M1', amountSats: 1000, status: msStatus } })
    return { c, m }
  }
  const ok = await mk(partner), bad = await mk(noRail), cashu = await mk(cashuP, 'PENDING')
  const H = (t: string) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` })
  try {
    let r = await fetch(`${BASE}/api/cooperations/${ok.c.id}/status`, { method: 'PATCH', headers: H(tI), body: JSON.stringify({ status: 'IN_PROGRESS' }) })
    check('ACCEPTED -> IN_PROGRESS without escrow -> 200', r.status === 200, await r.text())
    r = await fetch(`${BASE}/api/cooperations/${ok.c.id}/fund-escrow`, { method: 'POST', headers: H(tI) })
    check('fund-escrow -> 403 COOP_ESCROW_DISABLED', r.status === 403, r.status)
    r = await fetch(`${BASE}/api/cooperations/${ok.c.id}/milestones/${ok.m.id}/pay-direct`, { method: 'POST', headers: H(tP) })
    check('partner cannot pay-direct -> 403', r.status === 403, r.status)
    r = await fetch(`${BASE}/api/cooperations/${ok.c.id}/milestones/${ok.m.id}/pay-direct`, { method: 'POST', headers: H(tI) })
    const b: any = await r.json()
    check('initiator pay-direct -> 200 real bolt11', r.status === 200 && /^lnbc/i.test(b.invoice) && b.paymentHash, b)
    r = await fetch(`${BASE}/api/cooperations/${ok.c.id}/milestones/${ok.m.id}/pay-direct`, { method: 'POST', headers: H(tI) })
    check('second call reuses invoice', (await r.json() as any).alreadyCreated === true)
    r = await fetch(`${BASE}/api/cooperations/${ok.c.id}/milestones/${ok.m.id}/confirm-direct-payment`, { method: 'POST', headers: H(tI), body: JSON.stringify({ preimage: '00'.repeat(32) }) })
    check('wrong preimage -> 400 PREIMAGE_MISMATCH', r.status === 400, r.status)
    r = await fetch(`${BASE}/api/cooperations/${bad.c.id}/milestones/${bad.m.id}/pay-direct`, { method: 'POST', headers: H(tI) })
    const e: any = await r.json()
    check('partner without rail -> 422 PARTNER_PAYMENT_NOT_CONFIGURED', r.status === 422 && e.error === 'PARTNER_PAYMENT_NOT_CONFIGURED', e)

    // --- Cashu rail + upfront payment + partner confirmation ---
    const cu = `${BASE}/api/cooperations/${cashu.c.id}/milestones/${cashu.m.id}`
    r = await fetch(`${cu}/pay-direct`, { method: 'POST', headers: H(tI) })
    const cj: any = await r.json()
    check('upfront pay-direct on a PENDING milestone, Cashu partner -> rail CASHU + pubkey/mint', r.status === 200 && cj.rail === 'CASHU' && cj.cashu?.mintUrl, cj)
    r = await fetch(`${cu}/cashu-token`, { method: 'POST', headers: H(tI), body: JSON.stringify({ token: 'not-a-token' }) })
    check('invalid cashu token -> 400', r.status === 400, r.status)
    r = await fetch(`${cu}/cashu-token`, { method: 'POST', headers: H(tP), body: JSON.stringify({ token: 'cashuA' + 'x'.repeat(40) }) })
    check('partner cannot post the payment token -> 403', r.status === 403, r.status)
    r = await fetch(`${cu}/cashu-token`, { method: 'POST', headers: H(tI), body: JSON.stringify({ token: 'cashuA' + 'x'.repeat(40) }) })
    check('initiator posts a token -> 200', r.status === 200, r.status)
    const tokenMsgs = await prisma.coopMilestoneMessage.count({ where: { milestoneId: cashu.m.id, action: 'CASHU_TOKEN' } })
    check('token stored as a milestone message', tokenMsgs === 1, tokenMsgs)
    r = await fetch(`${cu}/confirm-received`, { method: 'POST', headers: H(tI) })
    check('initiator cannot attest receipt -> 403', r.status === 403, r.status)
    r = await fetch(`${cu}/confirm-received`, { method: 'POST', headers: H(tC) })
    check('partner confirms receipt -> 200', r.status === 200, r.status)
    const paid = await prisma.coopMilestone.findUnique({ where: { id: cashu.m.id } })
    check('paidAt + paidRail=PARTNER_CONFIRMED recorded', !!paid?.paidAt && paid.paidRail === 'PARTNER_CONFIRMED', paid)
    r = await fetch(`${cu}/pay-direct`, { method: 'POST', headers: H(tI) })
    check('paying an already-paid milestone -> 409 ALREADY_PAID', r.status === 409 && ((await r.json()) as any).error === 'ALREADY_PAID')
    r = await fetch(`${cu}/confirm-received`, { method: 'POST', headers: H(tC) })
    check('confirm-received is idempotent', r.status === 200, r.status)
    r = await fetch(`${BASE}/api/beta/status`)
    check('/api/beta/status exposes coopEscrowEnabled=false', (await r.json() as any).coopEscrowEnabled === false)
  } finally {
    for (const x of [ok, bad, cashu]) { await prisma.coopMilestoneMessage.deleteMany({ where: { milestoneId: x.m.id } }); await prisma.coopMilestone.deleteMany({ where: { cooperationId: x.c.id } }); await prisma.ticket.deleteMany({ where: { cooperationId: x.c.id } }); await prisma.cooperation.delete({ where: { id: x.c.id } }) }
    await prisma.session.deleteMany({ where: { pubkey: { in: [init, partner, cashuP] } } })
    await prisma.wallet.deleteMany({ where: { userId: cashuUser.id } })
    await prisma.user.deleteMany({ where: { pubkey: { in: [init, partner, noRail, cashuP] } } })
    await prisma.$disconnect()
  }
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
