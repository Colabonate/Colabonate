// Availability derivation tests — ADR-271 D2/D7.

import { describe, expect, it } from 'vitest'

import {
  deriveAvailability,
  validateBookingRequest,
  type AvailabilityInputs,
  type BookingRequestInput,
  type SessionOccurrence,
} from './booking-availability.js'
import { zonedDateToUtc } from '@col/nostr-schema'

const NOW = new Date('2026-07-01T00:00:00Z')

function spaceResource(overrides: Partial<AvailabilityInputs['resource']> = {}): AvailabilityInputs['resource'] {
  return {
    id: 'res-1',
    kind: 'SPACE',
    timezone: 'UTC',
    capacity: 1,
    minUnits: null,
    maxUnits: null,
    leadTimeHours: 0,
    bufferMinutes: 0,
    isActive: true,
    ...overrides,
  }
}

function sessionResource(overrides: Partial<AvailabilityInputs['resource']> = {}): AvailabilityInputs['resource'] {
  return { ...spaceResource({ id: 'res-2', kind: 'SESSION', capacity: 12 }), ...overrides }
}

const AUG = (day: number) => zonedDateToUtc(`2026-08-${String(day).padStart(2, '0')}`, 'UTC')

describe('SPACE derivation', () => {
  it('merges an open date range into one window', () => {
    const slots = deriveAvailability({
      resource: spaceResource(),
      rules: [{ ruleKind: 'DATE_RANGE', weekday: null, startMinute: null, endMinute: null, validFrom: AUG(3), validUntil: AUG(31) }],
      blackouts: [],
      confirmed: [],
      now: NOW,
      from: AUG(1),
      to: AUG(31),
    }).slots
    expect(slots).toEqual([
      { kind: 'SPACE', startDate: '2026-08-03', endDate: '2026-08-31' },
    ])
  })

  it('a blackout splits the window', () => {
    const slots = deriveAvailability({
      resource: spaceResource(),
      rules: [{ ruleKind: 'DATE_RANGE', weekday: null, startMinute: null, endMinute: null, validFrom: AUG(1), validUntil: AUG(31) }],
      blackouts: [{ start: AUG(10), end: AUG(12) }], // local days 10 + 11 removed
      confirmed: [],
      now: NOW,
      from: AUG(1),
      to: AUG(31),
    }).slots
    expect(slots).toEqual([
      { kind: 'SPACE', startDate: '2026-08-01', endDate: '2026-08-10' },
      { kind: 'SPACE', startDate: '2026-08-12', endDate: '2026-08-31' },
    ])
  })

  it('a confirmed booking blocks its nights and frees the checkout day (half-open, D7)', () => {
    const slots = deriveAvailability({
      resource: spaceResource(),
      rules: [{ ruleKind: 'DATE_RANGE', weekday: null, startMinute: null, endMinute: null, validFrom: AUG(1), validUntil: AUG(31) }],
      blackouts: [],
      confirmed: [{ start: AUG(3), end: AUG(10), units: 7 }],
      now: NOW,
      from: AUG(1),
      to: AUG(31),
    }).slots
    expect(slots).toEqual([
      { kind: 'SPACE', startDate: '2026-08-01', endDate: '2026-08-03' },
      { kind: 'SPACE', startDate: '2026-08-10', endDate: '2026-08-31' },
    ])
  })

  it('lead time drops too-soon dates', () => {
    const now = AUG(1)
    const slots = deriveAvailability({
      resource: spaceResource({ leadTimeHours: 72 }),
      rules: [{ ruleKind: 'DATE_RANGE', weekday: null, startMinute: null, endMinute: null, validFrom: AUG(1), validUntil: AUG(31) }],
      blackouts: [],
      confirmed: [],
      now,
      from: AUG(1),
      to: AUG(31),
    }).slots
    // earliest = Aug 4 → first free date 2026-08-04
    expect(slots[0]).toEqual({ kind: 'SPACE', startDate: '2026-08-04', endDate: '2026-08-31' })
  })

  it('same-day check-in is bookable with leadTimeHours = 0 (D8 date granularity)', () => {
    // Local midnight of "today" is already in the past — a date-granular
    // booking can still start today while any part of the day remains.
    const now = new Date('2026-08-05T18:30:00Z')
    const slots = deriveAvailability({
      resource: spaceResource(),
      rules: [{ ruleKind: 'DATE_RANGE', weekday: null, startMinute: null, endMinute: null, validFrom: AUG(1), validUntil: AUG(31) }],
      blackouts: [],
      confirmed: [],
      now,
      from: AUG(1),
      to: AUG(31),
    }).slots
    expect(slots[0]).toEqual({ kind: 'SPACE', startDate: '2026-08-05', endDate: '2026-08-31' })
  })

  it('surfaces unexpired advisory holds without blocking slots (D4)', () => {
    const result = deriveAvailability({
      resource: spaceResource(),
      rules: [{ ruleKind: 'DATE_RANGE', weekday: null, startMinute: null, endMinute: null, validFrom: AUG(1), validUntil: AUG(31) }],
      blackouts: [],
      confirmed: [],
      holds: [
        { start: AUG(5), end: AUG(8), units: 3, holdExpiresAt: new Date(NOW.getTime() + 10 * 60000) },
        { start: AUG(20), end: AUG(22), units: 2, holdExpiresAt: new Date(NOW.getTime() - 60000) }, // expired → hidden
      ],
      now: NOW,
      from: AUG(1),
      to: AUG(31),
    })
    // The held window is NOT subtracted from the slots (advisory only)…
    expect(result.slots).toEqual([{ kind: 'SPACE', startDate: '2026-08-01', endDate: '2026-08-31' }])
    // …but is echoed for honest "requested" rendering.
    expect(result.holds).toEqual([
      { start: AUG(5).toISOString(), end: AUG(8).toISOString(), units: 3, expiresAt: new Date(NOW.getTime() + 10 * 60000).toISOString() },
    ])
  })

  it('weekly windows scope SPACE to specific weekdays (weekends only)', () => {
    // 2026-08-03 is a Sunday (0); Saturdays are 6.
    const slots = deriveAvailability({
      resource: spaceResource(),
      rules: [{ ruleKind: 'WEEKLY_WINDOW', weekday: 6, startMinute: 0, endMinute: 1440, validFrom: null, validUntil: null }],
      blackouts: [],
      confirmed: [],
      now: NOW,
      from: AUG(1),
      to: AUG(10),
    }).slots
    // Aug 1 + Aug 8 are the Saturdays in range
    expect(slots).toEqual([
      { kind: 'SPACE', startDate: '2026-08-01', endDate: '2026-08-02' },
      { kind: 'SPACE', startDate: '2026-08-08', endDate: '2026-08-09' },
    ])
  })
})

describe('SESSION derivation', () => {
  const weeklyRule = (weekday: number, startMinute = 14 * 60, endMinute = 17 * 60) => ({
    ruleKind: 'WEEKLY_WINDOW', weekday, startMinute, endMinute, validFrom: null, validUntil: null,
  })

  it('expands a weekly rule into occurrences with seats', () => {
    const slots = deriveAvailability({
      resource: sessionResource(),
      rules: [weeklyRule(3)], // Wednesdays
      blackouts: [],
      confirmed: [],
      now: NOW,
      from: AUG(1),
      to: AUG(15),
    }).slots
    // Wednesdays in Aug 2026: 5th and 12th
    expect(slots).toHaveLength(2)
    expect(slots[0]).toMatchObject({ seatsTotal: 12, seatsLeft: 12 })
    expect((slots[0] as { start: string }).start).toBe('2026-08-05T14:00:00.000Z')
    expect((slots[1] as { start: string }).start).toBe('2026-08-12T14:00:00.000Z')
  })

  it('confirmed seats reduce seatsLeft; blackouts remove occurrences', () => {
    const slots = deriveAvailability({
      resource: sessionResource({ capacity: 10 }),
      rules: [weeklyRule(3)],
      blackouts: [{ start: AUG(5), end: AUG(6) }],
      confirmed: [{ start: new Date('2026-08-12T14:00:00Z'), end: new Date('2026-08-12T17:00:00Z'), units: 4 }],
      now: NOW,
      from: AUG(1),
      to: AUG(15),
    }).slots
    expect(slots).toEqual([
      { kind: 'SESSION', start: '2026-08-12T14:00:00.000Z', end: '2026-08-12T17:00:00.000Z', seatsTotal: 10, seatsLeft: 6 },
    ])
  })
})

describe('validateBookingRequest', () => {
  const spaceInputs = (overrides: Partial<AvailabilityInputs> = {}): AvailabilityInputs => ({
    resource: spaceResource(),
    rules: [{ ruleKind: 'DATE_RANGE', weekday: null, startMinute: null, endMinute: null, validFrom: AUG(1), validUntil: AUG(31) }],
    blackouts: [],
    confirmed: [],
    now: NOW,
    from: AUG(1),
    to: AUG(31),
    ...overrides,
  })

  it('accepts a clean SPACE week', () => {
    const result = validateBookingRequest(spaceInputs(), { start: AUG(3), end: AUG(10), units: 7 })
    expect(result).toEqual({ ok: true })
  })

  it('rejects when nights do not match units', () => {
    const result = validateBookingRequest(spaceInputs(), { start: AUG(3), end: AUG(10), units: 5 })
    expect(result).toMatchObject({ ok: false, code: 'UNITS_INVALID' })
  })

  it('rejects when a night is blacked out', () => {
    const result = validateBookingRequest(
      spaceInputs({ blackouts: [{ start: AUG(5), end: AUG(6) }] }),
      { start: AUG(3), end: AUG(10), units: 7 },
    )
    expect(result).toMatchObject({ ok: false, code: 'BLACKOUT' })
  })

  it('rejects overlap with a confirmed booking (half-open: same-day checkout is fine)', () => {
    const inputs = spaceInputs({ confirmed: [{ start: AUG(3), end: AUG(10), units: 7 }] })
    expect(validateBookingRequest(inputs, { start: AUG(10), end: AUG(14), units: 4 })).toEqual({ ok: true })
    expect(validateBookingRequest(inputs, { start: AUG(9), end: AUG(14), units: 5 })).toMatchObject({ ok: false, code: 'TAKEN' })
  })

  it('buffer extends a confirmed booking for overlap purposes only (D7)', () => {
    // Booking ends Aug 10 at 10:00; 60 min buffer blocks a 10:30 check-in same day
    const inputs = spaceInputs({
      resource: spaceResource({ bufferMinutes: 60 }),
      confirmed: [{ start: AUG(3), end: new Date('2026-08-10T10:00:00Z'), units: 7 }],
    })
    const early = validateBookingRequest(inputs, { start: new Date('2026-08-10T10:30:00Z'), end: AUG(13), units: 3 })
    expect(early).toMatchObject({ ok: false, code: 'TAKEN' })
  })

  it('enforces offer min/max unit overrides (D6)', () => {
    const result = validateBookingRequest(
      spaceInputs({ resource: spaceResource({ minUnits: 3 }) }),
      { start: AUG(3), end: AUG(5), units: 2 },
    )
    expect(result).toMatchObject({ ok: false, code: 'UNITS_INVALID' })
  })

  it('enforces lead time at SPACE day granularity', () => {
    // now = Aug 2 12:00, 24h lead → horizon Aug 3 12:00. Check-in Aug 3 is
    // legal (a valid arrival time exists within the day, after 12:00);
    // check-in TODAY (Aug 2) is not — the day ends before the horizon.
    const inputs = spaceInputs({ resource: spaceResource({ leadTimeHours: 24 }), now: new Date('2026-08-02T12:00:00Z') })
    expect(validateBookingRequest(inputs, { start: AUG(3), end: AUG(6), units: 3 })).toEqual({ ok: true })
    expect(validateBookingRequest(inputs, { start: AUG(2), end: AUG(6), units: 4 })).toMatchObject({ ok: false, code: 'LEAD_TIME' })
  })

  it('accepts a same-day SPACE check-in when leadTimeHours = 0', () => {
    const inputs = spaceInputs({ now: new Date('2026-08-05T18:30:00Z') })
    expect(validateBookingRequest(inputs, { start: AUG(5), end: AUG(9), units: 4 })).toEqual({ ok: true })
  })

  it('enforces lead time on SESSION start instants', () => {
    // now = Aug 5 02:00, 24h lead → horizon Aug 6 02:00; the Aug 5 occurrence
    // start (14:00) lies before it.
    const result = validateBookingRequest(
      sessionInputs({ resource: sessionResource({ capacity: 2, leadTimeHours: 24 }), now: new Date('2026-08-05T02:00:00Z') }),
      { start: new Date('2026-08-05T14:00:00Z'), end: new Date('2026-08-05T17:00:00Z'), units: 1 },
    )
    expect(result).toMatchObject({ ok: false, code: 'LEAD_TIME' })
  })

  const sessionInputs = (overrides: Partial<AvailabilityInputs> = {}): AvailabilityInputs => ({
    resource: sessionResource({ capacity: 2 }),
    rules: [{ ruleKind: 'WEEKLY_WINDOW', weekday: 3, startMinute: 14 * 60, endMinute: 17 * 60, validFrom: null, validUntil: null }],
    blackouts: [],
    confirmed: [],
    now: NOW,
    from: AUG(1),
    to: AUG(31),
    ...overrides,
  })

  it('accepts an exact SESSION occurrence match', () => {
    const result = validateBookingRequest(sessionInputs(), {
      start: new Date('2026-08-05T14:00:00Z'), end: new Date('2026-08-05T17:00:00Z'), units: 2,
    })
    expect(result).toEqual({ ok: true })
  })

  it('rejects a SESSION request that matches no occurrence', () => {
    const result = validateBookingRequest(sessionInputs(), {
      start: new Date('2026-08-05T15:00:00Z'), end: new Date('2026-08-05T17:00:00Z'), units: 1,
    })
    expect(result).toMatchObject({ ok: false, code: 'NOT_OPEN' })
  })

  it('rejects when seats are sold out', () => {
    const inputs = sessionInputs({
      confirmed: [{ start: new Date('2026-08-05T14:00:00Z'), end: new Date('2026-08-05T17:00:00Z'), units: 2 }],
    })
    const result = validateBookingRequest(inputs, {
      start: new Date('2026-08-05T14:00:00Z'), end: new Date('2026-08-05T17:00:00Z'), units: 1,
    })
    expect(result).toMatchObject({ ok: false, code: 'SOLD_OUT' })
  })
})

describe('OPEN SESSION derivation + validation (ADR-369)', () => {
  // Open window: Wednesday 14:00–17:00, buyer books start + whole hours.
  const openWindow = { ruleKind: 'WEEKLY_WINDOW', weekday: 3, startMinute: 14 * 60, endMinute: 17 * 60, validFrom: null, validUntil: null }

  function openInputs(overrides: Partial<AvailabilityInputs> = {}): AvailabilityInputs {
    return {
      resource: sessionResource({ capacity: 1, bookingStyle: 'OPEN', slotMinutes: 60, minUnits: 1, maxUnits: 8 }),
      rules: [openWindow],
      blackouts: [],
      confirmed: [],
      now: NOW,
      from: AUG(1),
      to: AUG(31),
      ...overrides,
    }
  }

  it('derives each open window as a free segment carrying the window bounds', () => {
    const result = deriveAvailability(openInputs())
    expect(result.style).toBe('OPEN')
    expect(result.slotMinutes).toBe(60)
    expect(result.slots).toHaveLength(4) // Aug 5/12/19/26 (Wednesdays)
    expect(result.slots[0]).toMatchObject({
      kind: 'SESSION',
      start: '2026-08-05T14:00:00.000Z',
      end: '2026-08-05T17:00:00.000Z',
      seatsLeft: 1,
      windowStart: '2026-08-05T14:00:00.000Z',
      windowEnd: '2026-08-05T17:00:00.000Z',
    })
  })

  it('splits a window around a confirmed booking (buffer respected)', () => {
    const result = deriveAvailability(openInputs({
      confirmed: [{ start: new Date('2026-08-05T15:00:00Z'), end: new Date('2026-08-05T16:00:00Z'), units: 1 }],
    }))
    const day = result.slots.filter(s => (s as SessionOccurrence).start.startsWith('2026-08-05'))
    expect(day.map(s => ({ s: (s as SessionOccurrence).start, e: (s as SessionOccurrence).end }))).toEqual([
      { s: '2026-08-05T14:00:00.000Z', e: '2026-08-05T15:00:00.000Z' },
      { s: '2026-08-05T16:00:00.000Z', e: '2026-08-05T17:00:00.000Z' },
    ])
  })

  it('applies lead time to the free START instant, not the window', () => {
    const now = new Date('2026-08-05T14:30:00Z')
    const result = deriveAvailability(openInputs({ now, from: AUG(5), to: AUG(6) }))
    expect(result.slots).toHaveLength(1)
    expect(result.slots[0]).toMatchObject({
      start: '2026-08-05T14:30:00.000Z',
      end: '2026-08-05T17:00:00.000Z',
      windowStart: '2026-08-05T14:00:00.000Z',
    })
  })

  it('accepts a grid-aligned whole-hour block', () => {
    expect(validateBookingRequest(openInputs(), {
      start: new Date('2026-08-05T15:00:00Z'), end: new Date('2026-08-05T16:00:00Z'), units: 1,
    })).toEqual({ ok: true })
    expect(validateBookingRequest(openInputs(), {
      start: new Date('2026-08-05T14:00:00Z'), end: new Date('2026-08-05T17:00:00Z'), units: 3,
    })).toEqual({ ok: true })
  })

  it('rejects off-grid starts', () => {
    const result = validateBookingRequest(openInputs(), {
      start: new Date('2026-08-05T15:30:00Z'), end: new Date('2026-08-05T16:30:00Z'), units: 1,
    })
    expect(result).toMatchObject({ ok: false, code: 'UNITS_INVALID' })
  })

  it('rejects non-whole-hour intervals and units that are not the booked hours', () => {
    const fractional = validateBookingRequest(openInputs(), {
      start: new Date('2026-08-05T15:00:00Z'), end: new Date('2026-08-05T16:30:00Z'), units: 1,
    })
    expect(fractional).toMatchObject({ ok: false, code: 'UNITS_INVALID' })
    const wrongUnits = validateBookingRequest(openInputs(), {
      start: new Date('2026-08-05T15:00:00Z'), end: new Date('2026-08-05T17:00:00Z'), units: 1,
    })
    expect(wrongUnits).toMatchObject({ ok: false, code: 'UNITS_INVALID' })
  })

  it('rejects blocks that overlap a confirmed booking (no free segment contains them)', () => {
    const inputs = openInputs({
      confirmed: [{ start: new Date('2026-08-05T15:00:00Z'), end: new Date('2026-08-05T16:00:00Z'), units: 1 }],
    })
    const result = validateBookingRequest(inputs, {
      start: new Date('2026-08-05T14:30:00Z'), end: new Date('2026-08-05T15:30:00Z'), units: 1,
    })
    expect(result).toMatchObject({ ok: false, code: 'NOT_OPEN' })
    const touching = validateBookingRequest(inputs, {
      start: new Date('2026-08-05T16:00:00Z'), end: new Date('2026-08-05T17:00:00Z'), units: 1,
    })
    expect(touching).toEqual({ ok: true }) // half-open: touching is free
  })

  it('respects offer min/max hour overrides', () => {
    const result = validateBookingRequest(openInputs(), {
      start: new Date('2026-08-05T14:00:00Z'), end: new Date('2026-08-05T16:00:00Z'), units: 2,
      minUnits: 3,
    })
    expect(result).toMatchObject({ ok: false, code: 'UNITS_INVALID' })
  })
})
