/**
 * ADR-369 OPEN-window booking smoke — exercises the real route handlers
 * (express app on an ephemeral port) against the dev database: resource CRUD
 * with bookingStyle/slotMinutes validation, OPEN availability sub-windows,
 * grid/containment/units request validation, RSVP attach with containment
 * occurrence addressing, seller countersignature whose interval is the actual
 * sub-block while the a-tag addresses the CONTAINING window, availability
 * split after confirmation, and the exclusive-block confirm collision rule
 * (later overlapping confirm loses).
 *
 * Closes FU-664 (FU-369-A) — the accepted -> implemented verification gate of
 * ADR-369.
 *
 * Run:  DATABASE_URL=postgresql://colabonate:dev@localhost:5434/colabonate \
 *       npx pnpm exec tsx scripts/adr369-open-window-smoke.ts
 */

import { randomUUID } from 'crypto'
import express from 'express'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools/pure'
import { buildBookingConfirmationTags } from '../packages/nostr-schema/src/index.js'
import { createBookableResourceRouter, createBookingRouter } from '../apps/server/routes/bookable-resource.js'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://colabonate:dev@localhost:5434/colabonate'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    passed++
    console.log(`  OK  ${name}${extra ? ` -- ${extra}` : ''}`)
  } else {
    failed++
    console.error(`  FAIL ${name}${extra ? ` -- ${extra}` : ''}`)
  }
}

const OCCURRENCE_D = (ruleId: string, dateCompact: string) => `cbs-${ruleId}-${dateCompact}`

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  // -- Fixtures: seller + two buyers (real Nostr keys), sessions -------------
  const sellerSk = generateSecretKey()
  const sellerPub = getPublicKey(sellerSk)
  const buyerSk = generateSecretKey()
  const buyerPub = getPublicKey(buyerSk)
  const buyer2Sk = generateSecretKey()
  const buyer2Pub = getPublicKey(buyer2Sk)
  const sellerToken = randomUUID()
  const buyerToken = randomUUID()
  const buyer2Token = randomUUID()
  for (const u of [
    { pubkey: sellerPub, token: sellerToken },
    { pubkey: buyerPub, token: buyerToken },
    { pubkey: buyer2Pub, token: buyer2Token },
  ]) {
    await prisma.user.create({ data: { pubkey: u.pubkey } })
    await prisma.session.create({
      data: { pubkey: u.pubkey, k1: randomUUID(), token: u.token, expiresAt: new Date(Date.now() + 3600_000) },
    })
  }

  const app = express()
  app.use(express.json({ limit: '1mb' }))
  app.use('/api/resources', createBookableResourceRouter(prisma))
  app.use('/api/bookings', createBookingRouter(prisma))
  const server = app.listen(0)
  await new Promise<void>(r => server.once('listening', r))
  const port = (server.address() as { port: number }).port
  const api = `http://127.0.0.1:${port}`

  async function call(method: string, path: string, token: string | null, body?: unknown) {
    const res = await fetch(api + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    return { status: res.status, data }
  }

  const occurrenceDOf = (tags: string[][]) =>
    (tags.find(t => t[0] === 'a')?.[1] ?? '').split(':')[2] ?? ''

  // mk OPEN countersignature: interval = the actual sub-block instants, a-tag
  // = the CONTAINING weekly window occurrence (ADR-369 D4).
  const mkOpenConfirm = (ruleId: string, startIso: string, endIso: string, buyerPub: string, rsvpEventId: string, units: number) => finalizeEvent({
    kind: 31923,
    created_at: Math.floor(Date.now() / 1000),
    tags: buildBookingConfirmationTags({
      d: randomUUID(),
      title: 'ADR-369 open-window booking',
      interval: 'time',
      start: Math.floor(new Date(startIso).getTime() / 1000),
      end: Math.floor(new Date(endIso).getTime() / 1000),
      tzid: 'UTC',
      buyerPubkey: buyerPub,
      rsvpEventId,
      occurrence: { kind: 31923, pubkey: sellerPub, d: OCCURRENCE_D(ruleId, startIso.slice(0, 10).replace(/-/g, '')) },
      units,
    }),
    content: '',
  }, sellerSk)

  try {
    // -- Resource-create validation (D1) ------------------------------------
    let r = await call('POST', '/api/resources', sellerToken, {
      kind: 'SPACE', title: 'ADR-369 Illegal OPEN Space', timezone: 'UTC', capacity: 1, bookingStyle: 'OPEN',
    })
    check('OPEN on SPACE resource rejected (400)', r.status === 400, `status=${r.status}`)
    r = await call('POST', '/api/resources', sellerToken, {
      kind: 'SESSION', title: 'ADR-369 Illegal OPEN capacity', timezone: 'UTC', capacity: 3, bookingStyle: 'OPEN',
      rules: [{ ruleKind: 'WEEKLY_WINDOW', weekday: 3, startMinute: 540, endMinute: 1020 }],
    })
    check('OPEN with capacity 3 rejected (400)', r.status === 400, `status=${r.status}`)
    r = await call('POST', '/api/resources', sellerToken, {
      kind: 'SESSION', title: 'ADR-369 Smoke Consultation', timezone: 'UTC', capacity: 1, minUnits: 1, maxUnits: 8,
      bufferMinutes: 0, bookingStyle: 'OPEN', slotMinutes: 60,
      rules: [{ ruleKind: 'WEEKLY_WINDOW', weekday: 3, startMinute: 540, endMinute: 1020, validFrom: '2026-10-01T00:00:00Z', validUntil: '2026-11-01T00:00:00Z' }],
    })
    check('OPEN SESSION resource created (201)', r.status === 201, `status=${r.status}`)
    const resA = r.data.resource
    const ruleId = resA.rules[0].id
    check('bookingStyle/slotMinutes echoed', resA?.bookingStyle === 'OPEN' && resA?.slotMinutes === 60,
      JSON.stringify({ style: resA?.bookingStyle, slot: resA?.slotMinutes }))

    // -- Availability: full-window occurrences with windowStart/windowEnd -----
    r = await call('GET', `/api/resources/${resA.id}/availability?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z`, null)
    const avail = r.data
    check('availability carries style + slotMinutes', r.status === 200 && avail?.style === 'OPEN' && avail?.slotMinutes === 60)
    const wed = (avail?.slots ?? []) as Array<{ start: string; end: string; seatsLeft: number; windowStart: string; windowEnd: string }>
    check('4 Wednesday windows derived (Oct 2026)', wed.length === 4, `count=${wed.length}`)
    check('first window 2026-10-07 09:00-17:00Z anchored', wed[0]?.start === '2026-10-07T09:00:00.000Z' && wed[0]?.end === '2026-10-07T17:00:00.000Z'
      && wed[0]?.windowStart === '2026-10-07T09:00:00.000Z' && wed[0]?.windowEnd === '2026-10-07T17:00:00.000Z',
      JSON.stringify(wed[0]))

    // -- Request validation (D3) ---------------------------------------------
    // Valid: grid-aligned whole-hour block fully inside a free window.
    r = await call('POST', `/api/resources/${resA.id}/bookings`, buyerToken, { start: '2026-10-07T10:00:00.000Z', end: '2026-10-07T12:00:00.000Z', units: 2 })
    check('valid 10:00-12:00 request -> 201', r.status === 201, `status=${r.status} error=${r.data.error ?? ''}`)
    const booking1 = r.data.booking
    check('priceSats null without offer', booking1?.priceSats == null)
    const rsvp1 = finalizeEvent(r.data.rsvpTemplate, buyerSk) as Event
    const d1 = occurrenceDOf(r.data.rsvpTemplate?.tags ?? [])
    check('RSVP a-tag addresses the CONTAINING window occurrence (cbs-<rule>-20261007)', d1 === OCCURRENCE_D(ruleId, '20261007'), `d=${d1}`)
    r = await call('PATCH', `/api/bookings/${booking1.id}/request-event`, buyerToken, { event: rsvp1 })
    check('RSVP attach verified (200)', r.status === 200 && r.data.booking?.requestEventId === rsvp1.id, `status=${r.status}`)

    // Rejections on a free day (2026-10-21):
    const expect = async (start: string, end: string, units: number, code: string, label: string) => {
      const rr = await call('POST', `/api/resources/${resA.id}/bookings`, buyerToken, { start, end, units })
      check(label, rr.status === 409 && rr.data.error === code, `status=${rr.status} error=${rr.data.error}`)
    }
    await expect('2026-10-21T09:30:00.000Z', '2026-10-21T11:30:00.000Z', 2, 'UNITS_INVALID', 'off-grid start (09:30) rejected')
    await expect('2026-10-21T10:00:00.000Z', '2026-10-21T11:30:00.000Z', 1, 'UNITS_INVALID', 'non-whole-hour duration rejected')
    await expect('2026-10-21T10:00:00.000Z', '2026-10-21T12:00:00.000Z', 3, 'UNITS_INVALID', 'units != booked hours rejected')
    await expect('2026-10-21T07:00:00.000Z', '2026-10-21T09:00:00.000Z', 2, 'NOT_OPEN', 'block before the window rejected')
    await expect('2026-10-21T12:00:00.000Z', '2026-10-21T18:00:00.000Z', 6, 'NOT_OPEN', 'block crossing window end rejected')

    // -- Seller countersignature: sub-block instants + containing window -----
    const confirm1 = mkOpenConfirm(ruleId, '2026-10-07T10:00:00.000Z', '2026-10-07T12:00:00.000Z', buyerPub, rsvp1.id, 2)
    r = await call('POST', `/api/bookings/${booking1.id}/confirm`, sellerToken, { event: confirm1 })
    check('countersignature confirms (200 CONFIRMED)', r.status === 200 && r.data.booking?.status === 'CONFIRMED', `status=${r.status} error=${r.data.error ?? ''}`)

    // A countersignature carrying the FULL window instead of the sub-block instants is rejected.
    r = await call('POST', '/api/resources', sellerToken, {
      kind: 'SESSION', title: 'ADR-369 Smoke Reject', timezone: 'UTC', capacity: 1, bufferMinutes: 0,
      bookingStyle: 'OPEN', slotMinutes: 60,
      rules: [{ ruleKind: 'WEEKLY_WINDOW', weekday: 3, startMinute: 540, endMinute: 1020 }],
    })
    const resRej = r.data.resource
    r = await call('POST', `/api/resources/${resRej.id}/bookings`, buyerToken, { start: '2026-10-07T10:00:00.000Z', end: '2026-10-07T12:00:00.000Z', units: 2 })
    const rejBooking = r.data.booking
    const rejRsvp = finalizeEvent(r.data.rsvpTemplate, buyerSk) as Event
    await call('PATCH', `/api/bookings/${rejBooking.id}/request-event`, buyerToken, { event: rejRsvp })
    const windowEvent = finalizeEvent({
      kind: 31923, created_at: Math.floor(Date.now() / 1000),
      tags: buildBookingConfirmationTags({
        d: randomUUID(), title: 'wrong full-window interval', interval: 'time',
        start: Math.floor(new Date('2026-10-07T09:00:00.000Z').getTime() / 1000),
        end: Math.floor(new Date('2026-10-07T17:00:00.000Z').getTime() / 1000),
        tzid: 'UTC', buyerPubkey: buyerPub, rsvpEventId: rejRsvp.id,
        occurrence: { kind: 31923, pubkey: sellerPub, d: OCCURRENCE_D(resRej.rules[0].id, '20261007') },
        units: 2,
      }), content: '',
    }, sellerSk)
    r = await call('POST', `/api/bookings/${rejBooking.id}/confirm`, sellerToken, { event: windowEvent })
    check('countersignature with full-window (not sub-block) instants rejected (400)', r.status === 400, `status=${r.status} error=${r.data.error ?? ''}`)

    // -- Availability split after a confirmed block (segment disappears) ------
    r = await call('GET', `/api/resources/${resA.id}/availability?from=2026-10-07T00:00:00Z&to=2026-10-08T00:00:00Z`, null)
    const oct7 = (r.data.slots ?? []) as Array<{ start: string; end: string }>
    check('Oct 7 split into 09-10 and 12-17 after confirm', oct7.length === 2
      && oct7.some(s => s.start === '2026-10-07T09:00:00.000Z' && s.end === '2026-10-07T10:00:00.000Z')
      && oct7.some(s => s.start === '2026-10-07T12:00:00.000Z' && s.end === '2026-10-07T17:00:00.000Z'),
      JSON.stringify(oct7))

    // -- Blackout splits the window; partial-overlap request rejected ---------
    r = await call('POST', '/api/resources', sellerToken, {
      kind: 'SESSION', title: 'ADR-369 Smoke Blackout', timezone: 'UTC', capacity: 1, bufferMinutes: 0,
      bookingStyle: 'OPEN', slotMinutes: 60,
      rules: [{ ruleKind: 'WEEKLY_WINDOW', weekday: 3, startMinute: 540, endMinute: 1020 }],
      blackouts: [{ start: '2026-10-14T11:00:00.000Z', end: '2026-10-14T13:00:00.000Z', reason: 'maintenance' }],
    })
    const resB = r.data.resource
    r = await call('GET', `/api/resources/${resB.id}/availability?from=2026-10-14T00:00:00Z&to=2026-10-15T00:00:00Z`, null)
    const oct14 = (r.data.slots ?? []) as Array<{ start: string; end: string }>
    check('blackout splits Oct 14 into 09-11 + 13-17', oct14.length === 2
      && oct14.some(s => s.start === '2026-10-14T09:00:00.000Z' && s.end === '2026-10-14T11:00:00.000Z')
      && oct14.some(s => s.start === '2026-10-14T13:00:00.000Z' && s.end === '2026-10-14T17:00:00.000Z'),
      JSON.stringify(oct14))
    r = await call('POST', `/api/resources/${resB.id}/bookings`, buyerToken, { start: '2026-10-14T10:00:00.000Z', end: '2026-10-14T12:00:00.000Z', units: 2 })
    check('request spanning a blackout -> 409 BLACKOUT', r.status === 409 && r.data.error === 'BLACKOUT', `status=${r.status} error=${r.data.error}`)
    r = await call('POST', `/api/resources/${resB.id}/bookings`, buyerToken, { start: '2026-10-14T10:00:00.000Z', end: '2026-10-14T11:00:00.000Z', units: 1 })
    check('clean sub-window request accepted (201)', r.status === 201, `status=${r.status}`)

    // -- Exclusive-block confirm collision: later overlapping confirm loses ---
    // Both requests are made BEFORE any confirm on Oct 28 (validation still
    // sees a free window); the confirms then race and the earlier event wins.
    const mkReq = async (token: string, sk: Uint8Array) => {
      const rr = await call('POST', `/api/resources/${resA.id}/bookings`, token, { start: '2026-10-28T10:00:00.000Z', end: '2026-10-28T12:00:00.000Z', units: 2 })
      const b = rr.data.booking
      const ev = finalizeEvent(rr.data.rsvpTemplate, sk) as Event
      await call('PATCH', `/api/bookings/${b.id}/request-event`, token, { event: ev })
      return { booking: b, rsvpId: ev.id }
    }
    const cA = await mkReq(buyerToken, buyerSk)
    const cB = await mkReq(buyer2Token, buyer2Sk)
    const evB = mkOpenConfirm(ruleId, '2026-10-28T10:00:00.000Z', '2026-10-28T12:00:00.000Z', buyer2Pub, cB.rsvpId, 2)
    r = await call('POST', `/api/bookings/${cB.booking.id}/confirm`, sellerToken, { event: evB })
    check('first confirm (B, later created_at) succeeds', r.status === 200 && r.data.booking?.status === 'CONFIRMED', `status=${r.status}`)
    // A has the EARLIER created_at (-600s) → on its confirm the collision rule
    // must let A win and auto-cancel the already-confirmed B (CONFLICT_LOST).
    const evA = finalizeEvent({
      kind: 31923, created_at: Math.floor(Date.now() / 1000) - 600, // earlier created_at but confirmed later
      tags: buildBookingConfirmationTags({
        d: randomUUID(), title: 'ADR-369 collision A', interval: 'time',
        start: Math.floor(new Date('2026-10-28T10:00:00.000Z').getTime() / 1000),
        end: Math.floor(new Date('2026-10-28T12:00:00.000Z').getTime() / 1000),
        tzid: 'UTC', buyerPubkey: buyerPub, rsvpEventId: cA.rsvpId,
        occurrence: { kind: 31923, pubkey: sellerPub, d: OCCURRENCE_D(ruleId, '20261028') },
        units: 2,
      }), content: '',
    }, sellerSk)
    r = await call('POST', `/api/bookings/${cA.booking.id}/confirm`, sellerToken, { event: evA })
    check('earlier created_at (A) wins -> 200 + B auto-cancelled',
      r.status === 200 && r.data.booking?.status === 'CONFIRMED'
      && r.data.cancelledConflicts?.some((x: { id: string }) => x.id === cB.booking.id),
      `status=${r.status} error=${r.data.error ?? ''} conflicts=${JSON.stringify(r.data.cancelledConflicts?.map((x: { id: string }) => x.id))}`)
    const bFresh = await prisma.booking.findUnique({ where: { id: cB.booking.id } })
    check('loser B marked CANCELLED with CONFLICT_LOST note', bFresh?.status === 'CANCELLED' && (bFresh?.note ?? '').includes('CONFLICT_LOST'),
      JSON.stringify({ status: bFresh?.status, note: bFresh?.note }))

    console.log(`\n[adr369-open-window-smoke] ${passed} passed, ${failed} failed`)
  } finally {
    await prisma.booking.deleteMany({ where: { resource: { ownerPubkey: sellerPub } } }).catch(() => {})
    await prisma.resourceAvailabilityRule.deleteMany({ where: { resource: { ownerPubkey: sellerPub } } }).catch(() => {})
    await prisma.resourceBlackout.deleteMany({ where: { resource: { ownerPubkey: sellerPub } } }).catch(() => {})
    await prisma.bookableResource.deleteMany({ where: { ownerPubkey: sellerPub } }).catch(() => {})
    await prisma.session.deleteMany({ where: { pubkey: { in: [sellerPub, buyerPub, buyer2Pub] } } }).catch(() => {})
    await prisma.user.deleteMany({ where: { pubkey: { in: [sellerPub, buyerPub, buyer2Pub] } } }).catch(() => {})
    server.close()
    await prisma.$disconnect()
  }

  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error('[adr369-open-window-smoke] FAILED', err)
  process.exit(1)
})
