// ADR-329 FU-498 live smoke test: Cooperation.ticketType (payment structure)
// against the running dev server + local Postgres. Verifies: enum validation
// (unknown -> 400 INVALID_TICKET_TYPE per ADR-179), MILESTONE default
// (back-compat), SMART_ORDER server-side 3-phase fallback (Start 25% /
// Progress 50% / Completion 25%, exact budget sum), PATCH round-trip
// (metadata-only), and fund-escrow mirroring cooperation.ticketType onto the
// ticket (regtest LNBits invoice — no real payments). Run with:
//   DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr329-tickettype-smoke.ts
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
  const pubkey = randomBytes(32).toString('hex')
  const token = randomBytes(32).toString('hex')
  await prisma.user.create({ data: { pubkey } })
  await prisma.session.create({
    data: { pubkey, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 3600_000) },
  })

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const post = (body: unknown) => fetch(`${BASE_URL}/api/cooperations`, { method: 'POST', headers, body: JSON.stringify(body) })
  const patch = (id: string, body: unknown) => fetch(`${BASE_URL}/api/cooperations/${id}`, { method: 'PATCH', headers, body: JSON.stringify(body) })

  const createdIds: string[] = []
  try {
    // 1. SMART_ORDER without milestones -> 3 canonical auto phases
    let r = await post({ title: 'ADR-329 smoke smart order', budgetSats: 100003, ticketType: 'SMART_ORDER' })
    let body = await r.json()
    check('POST SMART_ORDER without milestones -> 200', r.status === 200, body)
    const smart = body?.cooperation
    createdIds.push(smart?.id)
    check('ticketType stored as SMART_ORDER', smart?.ticketType === 'SMART_ORDER', smart?.ticketType)
    const ms = smart?.milestones ?? []
    check('3 auto milestones generated', ms.length === 3, ms.length)
    check('auto phases Start/Progress/Completion', ms.map((m: { title: string }) => m.title).join(',') === 'Start,Progress,Completion', ms.map((m: { title: string }) => m.title))
    check('Start = 25% (rounded)', ms[0]?.amountSats === 25001, ms[0]?.amountSats)
    check('Progress = 50% (rounded)', ms[1]?.amountSats === 50002, ms[1]?.amountSats)
    check('Completion absorbs remainder, sum == budget', ms[2]?.amountSats === 100003 - 25001 - 50002, ms[2]?.amountSats)

    // 2. MILESTONE with authored milestones -> unchanged behavior
    r = await post({
      title: 'ADR-329 smoke milestone', budgetSats: 50000, ticketType: 'MILESTONE',
      milestones: [{ title: 'Design', percentage: 40 }, { title: 'Build', percentage: 60 }],
    })
    body = await r.json()
    check('POST MILESTONE with authored milestones -> 200', r.status === 200, body)
    const milestone = body?.cooperation
    createdIds.push(milestone?.id)
    check('ticketType stored as MILESTONE', milestone?.ticketType === 'MILESTONE', milestone?.ticketType)
    check('authored milestones kept (2), not replaced by auto phases', milestone?.milestones?.length === 2, milestone?.milestones?.length)
    check('authored percentage conversion intact', milestone?.milestones?.[0]?.amountSats === 20000, milestone?.milestones?.[0]?.amountSats)

    // 3. Omitted ticketType -> defaults MILESTONE (back-compat)
    r = await post({ title: 'ADR-329 smoke default', budgetSats: 10000, milestones: [{ title: 'Only', percentage: 100 }] })
    body = await r.json()
    check('POST without ticketType -> 200', r.status === 200, body)
    const legacy = body?.cooperation
    createdIds.push(legacy?.id)
    check('ticketType defaults to MILESTONE', legacy?.ticketType === 'MILESTONE', legacy?.ticketType)

    // 3b. SMART_ORDER DRAFT -> no placeholder phases (submit-time generation only)
    r = await post({ title: 'ADR-329 smoke draft', budgetSats: 0, ticketType: 'SMART_ORDER', status: 'DRAFT' })
    body = await r.json()
    check('POST SMART_ORDER DRAFT -> 200', r.status === 200, body)
    const draft = body?.cooperation
    createdIds.push(draft?.id)
    check('DRAFT gets no auto phases (submit-time only)', (draft?.milestones ?? []).length === 0, draft?.milestones)

    // 4. Unknown ticketType -> structured 400 (ADR-179 code contract)
    r = await post({ title: 'ADR-329 smoke invalid', budgetSats: 10000, ticketType: 'WEEKLY' })
    body = await r.json()
    check('POST unknown ticketType -> 400', r.status === 400, { status: r.status, body })
    check('400 carries code INVALID_TICKET_TYPE', body?.code === 'INVALID_TICKET_TYPE', body)

    // 5. PATCH ticketType round-trip (metadata-only)
    if (legacy?.id) {
      r = await patch(legacy.id, { ticketType: 'SMART_ORDER' })
      body = await r.json()
      check('PATCH ticketType MILESTONE -> SMART_ORDER -> 200', r.status === 200 && body?.cooperation?.ticketType === 'SMART_ORDER', body)
      const afterFlip = await prisma.cooperation.findUnique({ where: { id: legacy.id }, include: { milestones: true } })
      check('PATCH does not create/replace milestones', afterFlip?.milestones.length === 1, afterFlip?.milestones.length)
      r = await patch(legacy.id, { ticketType: 'DISPUTE' })
      body = await r.json()
      check('PATCH unknown ticketType -> 400 + code', r.status === 400 && body?.code === 'INVALID_TICKET_TYPE', { status: r.status, body })
      r = await patch(legacy.id, { ticketType: 'MILESTONE' })
      body = await r.json()
      check('PATCH ticketType back to MILESTONE -> 200', r.status === 200 && body?.cooperation?.ticketType === 'MILESTONE', body)
    }

    // 6. fund-escrow mirrors cooperation.ticketType onto the ticket
    //    (regtest LNBits invoice creation only — nobody pays it)
    r = await post({ title: 'ADR-329 smoke escrow mirror', budgetSats: 21000, ticketType: 'SMART_ORDER' })
    body = await r.json()
    check('POST SMART_ORDER for escrow mirror -> 200', r.status === 200, body)
    const escrowCoop = body?.cooperation
    createdIds.push(escrowCoop?.id)
    await prisma.cooperation.update({ where: { id: escrowCoop.id }, data: { status: 'ACCEPTED', partnerPubkey: pubkey } })
    r = await fetch(`${BASE_URL}/api/cooperations/${escrowCoop.id}/fund-escrow`, { method: 'POST', headers })
    body = await r.json()
    check('fund-escrow -> 200', r.status === 200, body)
    const ticket = await prisma.ticket.findUnique({ where: { cooperationId: escrowCoop.id } })
    check('fund-escrow ticket mirrors cooperation.ticketType (SMART_ORDER)', ticket?.ticketType === 'SMART_ORDER', ticket?.ticketType)
    await prisma.ticket.deleteMany({ where: { cooperationId: escrowCoop.id } })
  } finally {
    await prisma.ticket.deleteMany({ where: { cooperationId: { in: createdIds.filter(Boolean) } } })
    await prisma.cooperation.deleteMany({ where: { id: { in: createdIds.filter(Boolean) } } })
    await prisma.session.deleteMany({ where: { pubkey } })
    await prisma.user.deleteMany({ where: { pubkey } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
