// ADR-411 live smoke: notification coverage + ticket-integrity hardening.
// Runs against a live server (tsx watch on :4001 picks up the ADR-411 code):
//   npx tsx apps/server/scripts/adr411-notification-coverage-smoke.ts
// With an explicit DB (mirrors the other ADR smokes):
//   DATABASE_URL=postgresql://colabonate:dev@localhost:5434/colabonate BASE_URL=http://localhost:4001 \
//     npx tsx apps/server/scripts/adr411-notification-coverage-smoke.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'
import { confirmPaymentByHash } from '../services/paymentConfirmation.js'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4001'
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, JSON.stringify(detail) ?? '') }
}

async function mkUser() {
  const pubkey = randomBytes(32).toString('hex')
  const token = randomBytes(32).toString('hex')
  const user = await prisma.user.create({ data: { pubkey, identityLevel: 2 } })
  await prisma.session.create({ data: { pubkey, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 3600_000) } })
  return { pubkey, token, userId: user.id }
}

type User = Awaited<ReturnType<typeof mkUser>>

function api(u: User | null, method: string, path: string, body?: unknown) {
  return fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(u ? { Authorization: `Bearer ${u.token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async r => ({ status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }))
}

async function notifications(u: User) {
  const r = await api(u, 'GET', '/api/notifications?limit=200')
  return { status: r.status, rows: (r.body.notifications ?? []) as Array<Record<string, any>>, body: r.body }
}

async function main() {
  const A = await mkUser() // initiator / buyer
  const B = await mkUser() // partner / seller
  const C = await mkUser() // third party (attacker probes)

  // Entities (created directly — the routes under test are status/auth paths,
  // not the creation paths, which have their own coverage).
  const ticket1 = await prisma.ticket.create({ data: { buyerPubkey: A.pubkey, sellerPubkey: B.pubkey, status: 'PENDING', amountSats: 1000 } })
  const milestone1 = await prisma.milestone.create({ data: { ticketId: ticket1.id, title: 'Smoke milestone' } })
  const coop1 = await prisma.cooperation.create({ data: { title: 'ADR-411 smoke coop 1', initiatorPubkey: A.pubkey, budgetSats: 5000, status: 'OPEN' } })
  const coopTicket1 = await prisma.ticket.create({ data: { cooperationId: coop1.id, buyerPubkey: A.pubkey, sellerPubkey: B.pubkey, status: 'PENDING', amountSats: 5000 } })
  const coop2 = await prisma.cooperation.create({ data: { title: 'ADR-411 smoke coop 2', initiatorPubkey: A.pubkey, budgetSats: 5000, status: 'DRAFT' } })
  const ticketPaid = await prisma.ticket.create({ data: { buyerPubkey: A.pubkey, sellerPubkey: B.pubkey, status: 'PENDING', amountSats: 700, paymentHash: randomBytes(32).toString('hex') } })
  const ticketReleased = await prisma.ticket.create({ data: { buyerPubkey: A.pubkey, sellerPubkey: B.pubkey, status: 'IN_PROGRESS', amountSats: 700, paymentHash: randomBytes(32).toString('hex') } })
  const ticketPatched = await prisma.ticket.create({ data: { buyerPubkey: A.pubkey, sellerPubkey: B.pubkey, status: 'PENDING', amountSats: 100 } })

  const cleanup = async () => {
    const pubkeys = [A.pubkey, B.pubkey, C.pubkey]
    const ticketIds = [ticket1.id, coopTicket1.id, ticketPaid.id, ticketReleased.id, ticketPatched.id]
    await prisma.notification.deleteMany({ where: { ownerPubkey: { in: pubkeys } } })
    await prisma.milestone.deleteMany({ where: { ticketId: { in: ticketIds } } })
    await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } })
    await prisma.cooperation.deleteMany({ where: { id: { in: [coop1.id, coop2.id] } } })
    await prisma.session.deleteMany({ where: { pubkey: { in: pubkeys } } })
    await prisma.user.deleteMany({ where: { pubkey: { in: pubkeys } } })
  }

  try {
    // ── 1. Security gates ────────────────────────────────────────────────────
    console.log('\n[1] Security gates (ADR-411 D6)')
    let r = await api(null, 'POST', '/api/milestones', { ticketId: ticket1.id, title: 'x' })
    check('POST /api/milestones without auth -> 401', r.status === 401, r)
    r = await api(null, 'PATCH', `/api/milestones/${milestone1.id}`, { status: 'COMPLETED' })
    check('PATCH /api/milestones/:id without auth -> 401', r.status === 401, r)
    r = await api(C, 'POST', '/api/milestones', { ticketId: ticket1.id, title: 'x' })
    check('POST /api/milestones non-party -> 403 FORBIDDEN', r.status === 403 && r.body.code === 'FORBIDDEN', r)
    r = await api(C, 'PATCH', `/api/milestones/${milestone1.id}`, { status: 'COMPLETED' })
    check('PATCH /api/milestones/:id non-party -> 403 FORBIDDEN', r.status === 403 && r.body.code === 'FORBIDDEN', r)
    r = await api(C, 'GET', `/api/tickets?cooperationId=${coop1.id}`)
    check('GET /api/tickets?cooperationId third party -> 403 FORBIDDEN', r.status === 403 && r.body.code === 'FORBIDDEN', r)
    r = await api(B, 'GET', `/api/tickets?cooperationId=${coop1.id}`)
    check('GET /api/tickets?cooperationId partner -> 200 with the coop ticket',
      r.status === 200 && (r.body.tickets as any[])?.length === 1 && r.body.tickets[0]?.id === coopTicket1.id, r.status)

    // ── 2. Generic coop PATCH: status validation ─────────────────────────────
    console.log('\n[2] Cooperation PATCH status validation (ADR-411 D4)')
    r = await api(A, 'PATCH', `/api/cooperations/${coop2.id}`, { status: 'PAID' })
    check('generic PATCH illegal transition DRAFT->PAID -> 409 INVALID_STATUS_TRANSITION',
      r.status === 409 && r.body.code === 'INVALID_STATUS_TRANSITION', r)
    r = await api(A, 'PATCH', `/api/cooperations/${coop2.id}`, { status: 'OPEN' })
    check('generic PATCH legal transition DRAFT->OPEN -> 200', r.status === 200 && r.body.cooperation?.status === 'OPEN', r.status)

    // ── 3. Cooperation lifecycle notifications ───────────────────────────────
    console.log('\n[3] Cooperation lifecycle notifications (ADR-411 D4)')
    r = await api(B, 'POST', `/api/cooperations/${coop1.id}/accept`, {})
    check('partner accepts coop1 -> 200 ACCEPTED', r.status === 200 && r.body.cooperation?.status === 'ACCEPTED', r.status)
    let nA = await notifications(A)
    check('initiator notified "Cooperation accepted" (relatedId coop1)',
      nA.rows.some(n => n.type === 'cooperation' && n.title === 'Cooperation accepted' && n.relatedId === coop1.id && !n.read), nA.rows.slice(0, 3))

    r = await api(A, 'POST', `/api/cooperations/${coop1.id}/cancel`, {})
    check('initiator cancels coop1 -> 200 CANCELLED', r.status === 200 && r.body.cooperation?.status === 'CANCELLED', r.status)
    let nB = await notifications(B)
    check('partner notified "Cooperation cancelled" (fromStatus ACCEPTED)',
      nB.rows.some(n => n.type === 'cooperation' && n.title === 'Cooperation cancelled' && n.relatedId === coop1.id && n.meta?.statusFrom === 'ACCEPTED'), nB.rows.slice(0, 3))

    r = await api(B, 'POST', `/api/cooperations/${coop2.id}/accept`, {})
    check('partner accepts coop2 -> 200', r.status === 200, r.status)
    r = await api(A, 'PATCH', `/api/cooperations/${coop2.id}`, { status: 'CANCELLED' })
    check('generic PATCH legal transition ACCEPTED->CANCELLED -> 200', r.status === 200, r.status)
    nB = await notifications(B)
    check('partner notified via generic-PATCH status write (Announce+Notify parity)',
      nB.rows.some(n => n.type === 'cooperation' && n.title === 'Cooperation cancelled' && n.relatedId === coop2.id && n.meta?.statusFrom === 'ACCEPTED' && n.meta?.statusTo === 'CANCELLED'), nB.rows.slice(0, 3))

    // ── 4. Payment-confirmation choke point (in-process) ─────────────────────
    console.log('\n[4] confirmPaymentByHash choke point (ADR-411 D2)')
    const paid = await confirmPaymentByHash(prisma, ticketPaid.paymentHash!)
    check('choke point reports ticket:PAID', paid.includes(`ticket:${ticketPaid.id}:PAID`), paid)
    const paidRow = await prisma.ticket.findUnique({ where: { id: ticketPaid.id } })
    check('ticket is PAID', paidRow?.status === 'PAID', paidRow?.status)
    nB = await notifications(B)
    check('seller notified "Payment received" (meta.statusTo PAID, role seller)',
      nB.rows.some(n => n.type === 'ticket' && n.title === 'Payment received' && n.relatedId === ticketPaid.id && n.meta?.statusTo === 'PAID' && n.meta?.role === 'seller'), nB.rows.slice(0, 3))

    const released = await confirmPaymentByHash(prisma, ticketReleased.paymentHash!)
    check('choke point reports ticket:COMPLETED (release payment)', released.includes(`ticket:${ticketReleased.id}:COMPLETED`), released)
    nB = await notifications(B)
    check('seller notified "Order completed"', nB.rows.some(n => n.type === 'ticket' && n.title === 'Order completed' && n.relatedId === ticketReleased.id), undefined)

    // ── 5. Ticket PATCH notify (pre-existing path, regression) ───────────────
    console.log('\n[5] Ticket PATCH notify regression')
    r = await api(A, 'PATCH', `/api/tickets/${ticketPatched.id}`, { status: 'ACCEPTED' })
    check('buyer PATCH ticket -> 200 ACCEPTED', r.status === 200 && r.body.ticket?.status === 'ACCEPTED', r.status)
    nB = await notifications(B)
    check('seller notified "Request accepted"', nB.rows.some(n => n.type === 'ticket' && n.title === 'Request accepted' && n.relatedId === ticketPatched.id), undefined)

    // ── 6. Feed contract regression (routes/notifications.ts) ────────────────
    console.log('\n[6] /api/notifications contract regression')
    const unreadBefore = nB.rows.filter(n => !n.read).length
    check('feed returns unread count matching rows', (nB.body as any).unread === unreadBefore && unreadBefore > 0, (nB.body as any).unread)
    const firstUnread = nB.rows.find(n => !n.read)!
    r = await api(B, 'PATCH', `/api/notifications/${firstUnread.id}`, { read: true })
    check('PATCH /:id mark read -> success', r.body.success === true, r)
    r = await api(C, 'PATCH', `/api/notifications/${firstUnread.id}`, { read: true })
    check('PATCH /:id as non-owner -> 404 (owner-scoped)', r.status === 404, r)
    r = await api(B, 'POST', '/api/notifications/read-all', {})
    check('POST /read-all -> success', r.body.success === true, r)
    const nB2 = await notifications(B)
    check('unread is 0 after read-all', (nB2.body as any).unread === 0, (nB2.body as any).unread)
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
