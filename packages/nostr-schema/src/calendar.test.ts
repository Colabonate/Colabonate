// NIP-52 calendar booking vocabulary (ADR-271).

import { describe, expect, it } from 'vitest'

import {
  addDays,
  buildBookingConfirmationTags,
  buildBookingRsvpTags,
  buildCalendarTags,
  buildDateOccurrenceTags,
  buildTimeOccurrenceTags,
  dayTags,
  isValidTimezone,
  nightsBetween,
  parseBookingConfirmation,
  parseBookingRsvp,
  toCoord,
  utcToZonedDate,
  zonedDateToUtc,
} from './calendar.js'
import {
  BookingConfirmationSchema,
  BookingRsvpEventSchema,
  validateBookingConfirmation,
  validateBookingRsvp,
} from './schemas/calendar.js'

const CAL = { pubkey: 'a'.repeat(64), d: 'cal-1' }
const OCC = { pubkey: CAL.pubkey, d: 'occ-1' }

describe('calendar tags', () => {
  it('builds a 31924 calendar', () => {
    const tags = buildCalendarTags({ d: 'cal-1', title: 'Lake House', description: 'Rent by the night' })
    expect(tags).toContainEqual(['d', 'cal-1'])
    expect(tags).toContainEqual(['title', 'Lake House'])
    // Canonical NIP-52 interop: fork uses `title`, canonical NIP uses `name`.
    expect(tags).toContainEqual(['name', 'Lake House'])
  })

  it('includes occurrence refs as a tags', () => {
    const tags = buildCalendarTags({
      d: 'cal-1', title: 'Studio',
      eventRefs: [{ kind: 31923, ...OCC }],
    })
    expect(tags).toContainEqual(['a', `31923:${OCC.pubkey}:occ-1`])
  })
})

describe('availability occurrences', () => {
  it('builds a date-based (SPACE) occurrence', () => {
    const tags = buildDateOccurrenceTags({
      d: 'occ-1', title: 'August open', startDate: '2026-08-03', endDate: '2026-08-10',
      calendar: CAL, capacity: 1, unit: 'per_night', priceSats: 25000,
    })
    expect(tags).toContainEqual(['start', '2026-08-03'])
    expect(tags).toContainEqual(['end', '2026-08-10'])
    expect(tags).toContainEqual(['a', `31924:${CAL.pubkey}:cal-1`])
    expect(tags).toContainEqual(['booking', 'availability'])
    expect(tags).toContainEqual(['capacity', '1'])
    expect(tags).toContainEqual(['unit', 'per_night'])
    expect(tags).toContainEqual(['price', '25000', 'sats'])
  })

  it('builds a time-based (SESSION) occurrence with D tags and tzid', () => {
    const start = 1760000000 // 2025-10-09T08:26:40Z
    const end = start + 3 * 3600
    const tags = buildTimeOccurrenceTags({
      d: 'occ-2', title: 'Workshop', startTime: start, endTime: end, tzid: 'Europe/Berlin',
      calendar: CAL, capacity: 12, unit: 'per_seat', priceSats: 5000,
    })
    expect(tags).toContainEqual(['start', String(start)])
    expect(tags).toContainEqual(['end', String(end)])
    expect(tags).toContainEqual(['start_tzid', 'Europe/Berlin'])
    expect(tags).toContainEqual(['unit', 'per_seat'])
    const dTags = tags.filter(t => t[0] === 'D')
    expect(dTags.length).toBeGreaterThanOrEqual(1)
    expect(dTags.every(t => t[1] === String(Math.floor(start / 86400)) || Number(t[1]) > Math.floor(start / 86400))).toBe(true)
  })

  it('dayTags covers every day of a multi-day span', () => {
    const start = 1760000000
    const end = start + 3 * 86400 + 3600
    const tags = dayTags(start, end)
    const first = Math.floor(start / 86400)
    const last = Math.floor((end - 1) / 86400)
    expect(tags.map(t => Number(t[1]))).toEqual(
      Array.from({ length: last - first + 1 }, (_, i) => first + i),
    )
  })
})

describe('booking request RSVP', () => {
  it('builds and parses a SPACE sub-range RSVP', () => {
    const tags = buildBookingRsvpTags({
      d: 'rsvp-1', occurrence: { kind: 31922, ...OCC }, occurrenceEventId: 'b'.repeat(64),
      units: 7, startDate: '2026-08-03', endDate: '2026-08-10', sellerPubkey: CAL.pubkey,
    })
    expect(tags).toContainEqual(['status', 'accepted'])
    expect(tags).toContainEqual(['fb', 'busy'])
    expect(tags).toContainEqual(['units', '7'])
    expect(tags).toContainEqual(['start', '2026-08-03'])
    expect(tags).toContainEqual(['end', '2026-08-10'])

    const parsed = parseBookingRsvp(tags)
    expect(parsed).not.toBeNull()
    expect(parsed?.occurrenceKind).toBe(31922)
    expect(parsed?.occurrenceD).toBe('occ-1')
    expect(parsed?.units).toBe(7)
    expect(parsed?.startDate).toBe('2026-08-03')
    expect(parsed?.status).toBe('accepted')
  })

  it('rejects an RSVP without a tag', () => {
    expect(parseBookingRsvp([['d', 'x']])).toBeNull()
  })

  it('passes the zod validator', () => {
    const tags = buildBookingRsvpTags({
      d: 'rsvp-1', occurrence: { kind: 31923, ...OCC }, units: 2, sellerPubkey: CAL.pubkey,
    })
    const result = BookingRsvpEventSchema.safeParse({ kind: 31925, content: '', tags })
    expect(result.success).toBe(true)
  })

  it('fails the zod validator for a non-coordinate a tag', () => {
    const result = validateBookingRsvp({
      kind: 31925, content: '',
      tags: [['d', 'x'], ['a', '30402:abc:not-a-coord'], ['status', 'accepted']],
    })
    expect(result.success).toBe(false)
  })
})

describe('seller-countersigned booking', () => {
  const buyer = 'c'.repeat(64)

  it('builds and parses a date-based confirmation', () => {
    const tags = buildBookingConfirmationTags({
      d: 'book-1', title: 'Booking: Lake House', interval: 'date',
      start: '2026-08-03', end: '2026-08-10', buyerPubkey: buyer,
      rsvpEventId: 'b'.repeat(64), occurrence: { kind: 31922, ...OCC }, units: 7, priceSats: 175000,
    })
    const parsed = parseBookingConfirmation(31922, tags)
    expect(parsed).not.toBeNull()
    expect(parsed?.start).toBe('2026-08-03')
    expect(parsed?.buyerPubkey).toBe(buyer)
    expect(parsed?.units).toBe(7)
    expect(parsed?.priceSats).toBe(175000)

    const zod = BookingConfirmationSchema.safeParse({ kind: 31922, content: '', tags })
    expect(zod.success).toBe(true)
  })

  it('builds a time-based confirmation with tzid and D tags', () => {
    const start = 1760000000
    const tags = buildBookingConfirmationTags({
      d: 'book-2', title: 'Booking: Workshop', interval: 'time',
      start, end: start + 3 * 3600, tzid: 'Europe/Berlin', buyerPubkey: buyer,
      rsvpEventId: 'b'.repeat(64), occurrence: { kind: 31923, ...OCC }, units: 2,
    })
    expect(tags).toContainEqual(['start_tzid', 'Europe/Berlin'])
    expect(tags.some(t => t[0] === 'D')).toBe(true)
    expect(validateBookingConfirmation({ kind: 31923, content: '', tags }).success).toBe(true)
  })

  it('rejects an event without the booking marker', () => {
    const tags = [['d', 'x'], ['start', '2026-08-03'], ['end', '2026-08-10']]
    expect(parseBookingConfirmation(31922, tags)).toBeNull()
  })

  it('rejects a confirmation missing the RSVP e tag', () => {
    const tags = buildBookingConfirmationTags({
      d: 'book-1', title: 'x', interval: 'date', start: '2026-08-03', end: '2026-08-10',
      buyerPubkey: buyer, rsvpEventId: 'b'.repeat(64), occurrence: { kind: 31922, ...OCC }, units: 1,
    }).filter(t => t[0] !== 'e')
    expect(validateBookingConfirmation({ kind: 31922, content: '', tags }).success).toBe(false)
  })
})

describe('timezone date helpers', () => {
  it('maps resource-local midnight to the correct UTC instant', () => {
    // Europe/Berlin is UTC+2 in August (CEST)
    expect(zonedDateToUtc('2026-08-03', 'Europe/Berlin').toISOString()).toBe('2026-08-02T22:00:00.000Z')
    // Winter (CET, UTC+1)
    expect(zonedDateToUtc('2026-01-15', 'Europe/Berlin').toISOString()).toBe('2026-01-14T23:00:00.000Z')
    // UTC itself
    expect(zonedDateToUtc('2026-08-03', 'UTC').toISOString()).toBe('2026-08-03T00:00:00.000Z')
  })

  it('round-trips a date through zoned midnight', () => {
    const tz = 'America/New_York'
    const utc = zonedDateToUtc('2026-08-03', tz)
    expect(utcToZonedDate(utc, tz)).toBe('2026-08-03')
  })

  it('validates timezones', () => {
    expect(isValidTimezone('Europe/Berlin')).toBe(true)
    expect(isValidTimezone('Mars/Olympus')).toBe(false)
  })

  it('adds days and counts nights', () => {
    expect(addDays('2026-08-03', 7)).toBe('2026-08-10')
    expect(nightsBetween('2026-08-03', '2026-08-10')).toBe(7)
    // half-open: checkout on the 10th, checkin on the 10th → 0 nights, no conflict window
    expect(nightsBetween('2026-08-10', '2026-08-10')).toBe(0)
  })
})
