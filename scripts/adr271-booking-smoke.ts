/**
 * ADR-271 booking smoke — exercises the real route handlers (express app on an
 * ephemeral port) against the dev database: resource CRUD, derived
 * availability, booking request + advisory hold, verified RSVP attach (real
 * buyer signature + occurrence linkage), seller countersignature verification
 * (real Nostr signature), the D4 collision rule, SESSION multi-seat semantics
 * (two buyers share one occurrence up to capacity), sold-out, expiry sweep.
 *
 * Run:  DATABASE_URL=postgresql://colabonate:dev@localhost:5434/colabonate \
 *       npx pnpm exec tsx scripts/adr271-booking-smoke.ts
 */

import { randomUUID } from 'crypto'
import express from 'express'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools/pure'
import {
  buildBookingConfirmationTags,
} from '../packages/nostr-schema/src/index.js'
import { createBookableResourceRouter, createBookingRouter } from '../apps/server/routes/bookable-resource.js'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://colabonate:dev@localhost:5434/colabonate'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    passed++
    console.log(`  OK  ${name}${extra ? ` — ${extra}` : ''}`)
  } else {
    failed++
    console.error(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL })
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

  // ── Fixtures: seller (with a real Nostr key), buyers, sessions ──────────────
  const sellerSk = generateSecretKey()
  const sellerPub = getPublicKey(sellerSk)
  const buyerSk = generateSecretKey()
  const buyerPub = getPublicKey(buyerSk)
  const buyer2Sk = generateSecretKey()
  const buyer2Pub = getPublicKey(buyer2Sk)
  const sellerToken = randomUUID()
  const buyerToken = randomUUID()
  const buyer2Token = randomUUID()
  const users = [
    { pubkey: sellerPub, token: sellerToken },
    { pubkey: buyerPub, token: buyerToken },
    { pubkey: buyer2Pub, token: buyer2Token },
  ]
  for (const u of users) {
    await prisma.user.create({ data: { pubkey: u.pubkey } })
    await prisma.session.create({
      data: { pubkey: u.pubkey, k1: randomUUID(), token: u.token, expiresAt: new Date(Date.now() + 3600_000) },
    })
  }

  // ── Ephemeral express app with the real routers ─────────────────────────────
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

  try {
    console.log('\n── SPACE flow ──────────────────────────────────────────────')
    // 1. Create resource
    let r = await call('POST', '/api/resources', sellerToken, {
      kind: 'SPACE',
      title: 'ADR-271 Smoke Lake House',
      timezone: 'UTC',
      capacity: 1,
      minUnits: 1,
      bufferMinutes: 60,
      rules: [{ ruleKind: 'DATE_RANGE', validFrom: '2026-10-01T00:00:00Z', validUntil: '2026-11-15T00:00:00Z' }],
      blackouts: [{ start: '2026-10-20T00:00:00Z', end: '2026-10-21T00:00:00Z', reason: 'maintenance' }],
    })
    check('POST /api/resources → 201', r.status === 201, `status=${r.status}`)
    const resource = r.data.resource
    check('calendarD assigned', typeof resource?.calendarD === 'string' && resource.calendarD.length > 0)
    const resourceId = resource.id

    // 2. Availability
    r = await call('GET', `/api/resources/${resourceId}/availability?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z`, null)
    check('GET availability → 200', r.status === 200)
    check('blackout splits the window', r.data.slots?.length === 2, JSON.stringify(r.data.slots))
    check('window 1 = Oct 1–20', r.data.slots?.[0]?.startDate === '2026-10-01' && r.data.slots?.[0]?.endDate === '2026-10-20')

    // 3. Booking request (buyer)
    r = await call('POST', `/api/resources/${resourceId}/bookings`, buyerToken, {
      start: '2026-10-03T00:00:00Z', end: '2026-10-10T00:00:00Z', units: 7, note: 'smoke request',
    })
    check('POST booking request → 201', r.status === 201, `status=${r.status}`)
    const booking = r.data.booking
    check('status REQUESTED + hold set', booking?.status === 'REQUESTED' && booking?.holdExpiresAt != null)
    check('RSVP template built (a-tag → 31922 occurrence)', r.data.rsvpTemplate?.kind === 31925
      && String(r.data.rsvpTemplate?.tags?.find((t: string[]) => t[0] === 'a')?.[1] ?? '').startsWith('31922:'))

    // 4. Buyer signs + publishes the RSVP (real signature), server verifies
    //    signature + schema + occurrence linkage before accepting the id.
    const rsvp = finalizeEvent(r.data.rsvpTemplate, buyerSk)
    r = await call('PATCH', `/api/bookings/${booking.id}/request-event`, buyerToken, { event: rsvp })
    check('PATCH request-event (verified RSVP) → 200', r.status === 200 && r.data.booking?.requestEventId === rsvp.id, `status=${r.status}`)

    // 4b. A forged RSVP (signed by the wrong key) is rejected.
    const otherBooking = await call('POST', `/api/resources/${resourceId}/bookings`, buyerToken, {
      start: '2026-10-12T00:00:00Z', end: '2026-10-14T00:00:00Z', units: 2,
    })
    check('second request → 201', otherBooking.status === 201, `status=${otherBooking.status}`)
    const forgedRsvp = finalizeEvent(otherBooking.data.rsvpTemplate, generateSecretKey())
    r = await call('PATCH', `/api/bookings/${otherBooking.data.booking.id}/request-event`, buyerToken, { event: forgedRsvp })
    check('forged RSVP rejected (wrong signer)', r.status === 400, `status=${r.status} error=${r.data.error}`)

    // 5. Seller countersigns (real signature) and the server verifies + mirrors
    const confirmTags = buildBookingConfirmationTags({
      d: randomUUID(),
      title: 'Booking: ADR-271 Smoke Lake House',
      interval: 'date',
      start: '2026-10-03',
      end: '2026-10-10',
      buyerPubkey: buyerPub,
      rsvpEventId: rsvp.id,
      occurrence: { kind: 31922, pubkey: sellerPub, d: `cbs-${resource.rules[0].id}` },
      units: 7,
      priceSats: 175000,
    })
    const signed = finalizeEvent({ kind: 31922, created_at: Math.floor(Date.now() / 1000), tags: confirmTags, content: 'Confirmed booking' }, sellerSk)
    r = await call('POST', `/api/bookings/${booking.id}/confirm`, sellerToken, { event: signed })
    check('POST confirm → 200 CONFIRMED', r.status === 200 && r.data.booking?.status === 'CONFIRMED', `status=${r.status}`)
    check('bookingEventId mirrored', r.data.booking?.bookingEventId === signed.id)

    // 6. Availability reflects the confirmed booking. With bufferMinutes=60 the
    //    booking Oct 3–10 removes Oct 2…Oct 10 (buffer extends both sides for
    //    overlap purposes only, D7) — the next free check-in is Oct 11.
    r = await call('GET', `/api/resources/${resourceId}/availability?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z`, null)
    const afterSlots = r.data.slots as Array<{ startDate: string; endDate: string }>
    check('booked nights + buffer removed, Oct 11 free',
      afterSlots.some(s => s.startDate === '2026-10-11') && !afterSlots.some(s => s.startDate === '2026-10-02' && s.endDate === '2026-10-03'),
      JSON.stringify(afterSlots))

    // 7. Overlapping request from buyer 2 → 409 TAKEN
    r = await call('POST', `/api/resources/${resourceId}/bookings`, buyer2Token, {
      start: '2026-10-09T00:00:00Z', end: '2026-10-13T00:00:00Z', units: 4,
    })
    check('overlap rejected with 409 TAKEN', r.status === 409 && r.data.error === 'TAKEN', `status=${r.status} error=${r.data.error}`)

    // 8. Tampered countersignature (wrong key) rejected — RSVP itself is valid
    r = await call('POST', `/api/resources/${resourceId}/bookings`, buyer2Token, {
      start: '2026-10-24T00:00:00Z', end: '2026-10-28T00:00:00Z', units: 4,
    })
    const b2 = r.data.booking
    const b2Rsvp = finalizeEvent(r.data.rsvpTemplate, buyer2Sk)
    await call('PATCH', `/api/bookings/${b2.id}/request-event`, buyer2Token, { event: b2Rsvp })
    const forged = finalizeEvent({
      kind: 31922, created_at: Math.floor(Date.now() / 1000),
      tags: buildBookingConfirmationTags({
        d: randomUUID(), title: 'forged', interval: 'date', start: '2026-10-24', end: '2026-10-28',
        buyerPubkey: buyer2Pub, rsvpEventId: b2Rsvp.id,
        occurrence: { kind: 31922, pubkey: sellerPub, d: `cbs-${resource.rules[0].id}` }, units: 4,
      }),
      content: '',
    }, generateSecretKey()) // NOT the seller's key
    r = await call('POST', `/api/bookings/${b2.id}/confirm`, sellerToken, { event: forged })
    check('forged countersignature rejected', r.status === 400, `status=${r.status} error=${r.data.error}`)

    // 8b. Countersignature with a mismatched occurrence a-tag (calendar d
    //     instead of the deterministic occurrence d) is rejected.
    r = await call('POST', `/api/resources/${resourceId}/bookings`, buyer2Token, {
      start: '2026-10-24T00:00:00Z', end: '2026-10-28T00:00:00Z', units: 4,
    })
    const b3 = r.data.booking
    const b3Rsvp = finalizeEvent(r.data.rsvpTemplate, buyer2Sk)
    await call('PATCH', `/api/bookings/${b3.id}/request-event`, buyer2Token, { event: b3Rsvp })
    const wrongOcc = finalizeEvent({
      kind: 31922, created_at: Math.floor(Date.now() / 1000),
      tags: buildBookingConfirmationTags({
        d: randomUUID(), title: 'wrong occurrence', interval: 'date', start: '2026-10-24', end: '2026-10-28',
        buyerPubkey: buyer2Pub, rsvpEventId: b3Rsvp.id,
        occurrence: { kind: 31922, pubkey: sellerPub, d: resource.calendarD }, units: 4,
      }),
      content: '',
    }, sellerSk)
    r = await call('POST', `/api/bookings/${b3.id}/confirm`, sellerToken, { event: wrongOcc })
    check('non-deterministic occurrence a-tag rejected', r.status === 400, `status=${r.status} error=${r.data.error}`)

    // 9. D4 collision: two overlapping requests; the confirm with the EARLIER
    //    event created_at wins and the later one is auto-cancelled.
    const mkReq = async (start: string, end: string, units: number, token: string, sk: Uint8Array) => {
      const res = await call('POST', `/api/resources/${resourceId}/bookings`, token, { start, end, units })
      const rsvpEv = finalizeEvent(res.data.rsvpTemplate, sk)
      await call('PATCH', `/api/bookings/${res.data.booking.id}/request-event`, token, { event: rsvpEv })
      return { booking: res.data.booking, rsvpId: rsvpEv.id }
    }
    const cA = await mkReq('2026-10-24T00:00:00Z', '2026-10-27T00:00:00Z', 3, buyerToken, buyerSk)
    const cB = await mkReq('2026-10-26T00:00:00Z', '2026-10-30T00:00:00Z', 4, buyer2Token, buyer2Sk)
    // confirm cB first (created_at = now)
    const evB = finalizeEvent({
      kind: 31922, created_at: Math.floor(Date.now() / 1000),
      tags: buildBookingConfirmationTags({
        d: randomUUID(), title: 'collision B', interval: 'date', start: '2026-10-26', end: '2026-10-30',
        buyerPubkey: buyer2Pub, rsvpEventId: cB.rsvpId,
        occurrence: { kind: 31922, pubkey: sellerPub, d: `cbs-${resource.rules[0].id}` }, units: 4,
      }),
      content: '',
    }, sellerSk)
    r = await call('POST', `/api/bookings/${cB.booking.id}/confirm`, sellerToken, { event: evB })
    check('cB confirmed first', r.status === 200 && r.data.booking?.status === 'CONFIRMED')
    // then confirm cA with created_at 10 min EARLIER → cA wins, cB cancelled
    const evA = finalizeEvent({
      kind: 31922, created_at: Math.floor(Date.now() / 1000) - 600,
      tags: buildBookingConfirmationTags({
        d: randomUUID(), title: 'collision A', interval: 'date', start: '2026-10-24', end: '2026-10-27',
        buyerPubkey: buyerPub, rsvpEventId: cA.rsvpId,
        occurrence: { kind: 31922, pubkey: sellerPub, d: `cbs-${resource.rules[0].id}` }, units: 3,
      }),
      content: '',
    }, sellerSk)
    r = await call('POST', `/api/bookings/${cA.booking.id}/confirm`, sellerToken, { event: evA })
    check('earlier created_at wins, loser auto-cancelled',
      r.status === 200 && r.data.cancelledConflicts?.some((x: { id: string }) => x.id === cB.booking.id),
      `status=${r.status} conflicts=${JSON.stringify(r.data.cancelledConflicts?.map((x: { id: string; status: string }) => [x.id, x.status]))}`)
    const cBfresh = await prisma.booking.findUnique({ where: { id: cB.booking.id } })
    check('loser marked CANCELLED with CONFLICT_LOST note', cBfresh?.status === 'CANCELLED' && (cBfresh?.note ?? '').includes('CONFLICT_LOST'))

    console.log('\n── SESSION flow (multi-seat, D7) ────────────────────────────')
    r = await call('POST', '/api/resources', sellerToken, {
      kind: 'SESSION', title: 'ADR-271 Smoke Workshop', timezone: 'Europe/Berlin', capacity: 3,
      rules: [{ ruleKind: 'WEEKLY_WINDOW', weekday: 3, startMinute: 840, endMinute: 1020 }],
    })
    const sessRes = r.data.resource
    check('SESSION resource created', r.status === 201 && sessRes?.kind === 'SESSION', `status=${r.status} data=${JSON.stringify(r.data).slice(0, 200)}`)
    r = await call('GET', `/api/resources/${sessRes.id}/availability?from=2026-10-01T00:00:00Z&to=2026-10-31T00:00:00Z`, null)
    const occ = r.data.slots as Array<{ start: string; end: string; seatsLeft: number }>
    check('Wednesday occurrences expanded (Berlin tz)', occ.length >= 4 && occ[0].start === '2026-10-07T12:00:00.000Z',
      `first=${occ[0]?.start} count=${occ.length}`)

    // P0 regression: two DIFFERENT buyers book seats on the SAME occurrence —
    // overlapping confirms are the normal case for SESSION (D7: Σ seats ≤
    // capacity) and must BOTH confirm. (The pre-fix collision rule cancelled
    // the second buyer as a SPACE-style conflict.)
    const sessOccD = `cbs-${sessRes.rules[0].id}-20261007`
    const mkSessionConfirm = (buyerPub: string, rsvpId: string, units: number, createdAtOffset = 0) => finalizeEvent({
      kind: 31923, created_at: Math.floor(Date.now() / 1000) + createdAtOffset,
      tags: buildBookingConfirmationTags({
        d: randomUUID(), title: 'Workshop booking', interval: 'time',
        start: Math.floor(new Date(occ[0].start).getTime() / 1000),
        end: Math.floor(new Date(occ[0].end).getTime() / 1000),
        tzid: 'Europe/Berlin', buyerPubkey: buyerPub, rsvpEventId: rsvpId,
        occurrence: { kind: 31923, pubkey: sellerPub, d: sessOccD }, units,
      }), content: '',
    }, sellerSk)

    r = await call('POST', `/api/resources/${sessRes.id}/bookings`, buyerToken, { start: occ[0].start, end: occ[0].end, units: 2 })
    check('SESSION request buyer1 (2 seats) accepted', r.status === 201, `status=${r.status} error=${r.data.error}`)
    const rsvp1 = finalizeEvent(r.data.rsvpTemplate, buyerSk) as Event
    r = await call('PATCH', `/api/bookings/${r.data.booking.id}/request-event`, buyerToken, { event: rsvp1 })
    check('buyer1 RSVP verified', r.status === 200, `status=${r.status}`)
    r = await call('POST', `/api/bookings/${r.data.booking.id}/confirm`, sellerToken, { event: mkSessionConfirm(buyerPub, rsvp1.id, 2) })
    check('buyer1 countersign confirmed (2 seats)', r.status === 200 && r.data.booking?.status === 'CONFIRMED', `status=${r.status}`)

    r = await call('POST', `/api/resources/${sessRes.id}/bookings`, buyer2Token, { start: occ[0].start, end: occ[0].end, units: 1 })
    check('SESSION request buyer2 (1 seat) accepted', r.status === 201, `status=${r.status} error=${r.data.error}`)
    const rsvp2 = finalizeEvent(r.data.rsvpTemplate, buyer2Sk) as Event
    await call('PATCH', `/api/bookings/${r.data.booking.id}/request-event`, buyer2Token, { event: rsvp2 })
    const b2Confirm = await call('POST', `/api/bookings/${r.data.booking.id}/confirm`, sellerToken, { event: mkSessionConfirm(buyer2Pub, rsvp2.id, 1) })
    check('buyer2 countersign confirmed (1 seat, same occurrence — D7 multi-seat)',
      b2Confirm.status === 200 && b2Confirm.data.booking?.status === 'CONFIRMED',
      `status=${b2Confirm.status} error=${b2Confirm.data.error ?? '-'} conflicts=${JSON.stringify(b2Confirm.data.cancelledConflicts ?? [])}`)

    // capacity 3 fully booked (2 + 1) → sold out for another request
    r = await call('POST', `/api/resources/${sessRes.id}/bookings`, buyerToken, {
      start: occ[0].start, end: occ[0].end, units: 1,
    })
    check('sold-out occurrence → 409 SOLD_OUT', r.status === 409 && r.data.error === 'SOLD_OUT', `status=${r.status} error=${r.data.error}`)

    // occurrence 2: second concurrent confirm path on a different occurrence
    r = await call('POST', `/api/resources/${sessRes.id}/bookings`, buyer2Token, { start: occ[1].start, end: occ[1].end, units: 1 })
    check('occurrence 2 request accepted', r.status === 201, `status=${r.status}`)
    const rsvp3 = finalizeEvent(r.data.rsvpTemplate, buyer2Sk) as Event
    await call('PATCH', `/api/bookings/${r.data.booking.id}/request-event`, buyer2Token, { event: rsvp3 })
    const occ2D = `cbs-${sessRes.rules[0].id}-${occ[1].start.slice(0, 10).replace(/-/g, '')}`
    const evOcc2 = finalizeEvent({
      kind: 31923, created_at: Math.floor(Date.now() / 1000),
      tags: buildBookingConfirmationTags({
        d: randomUUID(), title: 'occ2 booking', interval: 'time',
        start: Math.floor(new Date(occ[1].start).getTime() / 1000),
        end: Math.floor(new Date(occ[1].end).getTime() / 1000),
        tzid: 'Europe/Berlin', buyerPubkey: buyer2Pub, rsvpEventId: rsvp3.id,
        occurrence: { kind: 31923, pubkey: sellerPub, d: occ2D }, units: 1,
      }), content: '',
    }, sellerSk)
    r = await call('POST', `/api/bookings/${r.data.booking.id}/confirm`, sellerToken, { event: evOcc2 })
    check('occurrence 2 confirmed', r.status === 200, `status=${r.status} error=${r.data.error}`)

    console.log('\n── Expiry sweep ─────────────────────────────────────────────')
    r = await call('POST', `/api/resources/${sessRes.id}/bookings`, buyer2Token, {
      start: occ[1].start, end: occ[1].end, units: 1,
    })
    await prisma.booking.update({ where: { id: r.data.booking.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    r = await call('GET', '/api/bookings/incoming', sellerToken)
    const lapsed = (r.data.bookings as Array<{ id: string; status: string }>).find(b => b.id === r.data.bookings?.[0]?.id && b.status === 'LAPSED')
    check('expired request lapsed on read', Boolean(lapsed) || (r.data.bookings ?? []).some((b: { status: string }) => b.status === 'LAPSED'))

    console.log(`\n[adr271-smoke] ${passed} passed, ${failed} failed`)
  } finally {
    // ── Cleanup ────────────────────────────────────────────────────────────
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
  console.error('[adr271-smoke] FAILED', err)
  process.exit(1)
})
