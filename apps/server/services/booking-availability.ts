// Booking availability derivation — ADR-271 D2/D7.
//
// Availability is DERIVED at query time: open windows − blackouts − confirmed
// bookings. Never materialised (no free/busy grid, no drift, no horizon).
//
// Interval semantics (D7): half-open [start, end) — a checkout on the 10th and
// a check-in on the 10th do not conflict. bufferMinutes extends each confirmed
// booking on both sides for overlap purposes only (never charged). SPACE is
// whole local days in the resource timezone (a night is a date, not an
// instant); SESSION occurrences are UTC instants expanded from WEEKLY_WINDOW
// rules in the resource timezone (D8).

import type {
  BookableResource,
  Booking,
  ResourceAvailabilityRule,
} from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { addDays, nightsBetween, utcToZonedDate, zonedDateToUtc } from '@col/nostr-schema'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SpaceWindow {
  kind: 'SPACE'
  /** Inclusive start date, resource-local YYYY-MM-DD. */
  startDate: string
  /** Exclusive end date, resource-local YYYY-MM-DD. */
  endDate: string
}

export interface SessionOccurrence {
  kind: 'SESSION'
  /** Inclusive start, UTC ISO instant. */
  start: string
  /** Exclusive end, UTC ISO instant. */
  end: string
  seatsTotal: number
  seatsLeft: number
  /** ADR-369 OPEN sessions only: bounds of the containing WEEKLY_WINDOW rule
   * (the buyer's start grid is anchored to `windowStart`). */
  windowStart?: string
  windowEnd?: string
}

export type AvailabilitySlot = SpaceWindow | SessionOccurrence

export interface DerivedAvailability {
  resourceId: string
  kind: 'SPACE' | 'SESSION'
  timezone: string
  /** ADR-369: how SESSION slots are booked — FIXED (exact occurrence) or OPEN
   * (buyer picks a start + duration inside each slot). */
  style: 'FIXED' | 'OPEN'
  /** ADR-369: start-time grid step in minutes (OPEN sessions). */
  slotMinutes: number
  slots: AvailabilitySlot[]
  /** Advisory holds (D4): unexpired REQUESTED bookings overlapping the window. Advisory only — never blocks. */
  holds: Array<{ start: string; end: string; units: number; expiresAt: string }>
}

export interface AvailabilityInputs {
  resource: Pick<
    BookableResource,
    'id' | 'kind' | 'timezone' | 'capacity' | 'minUnits' | 'maxUnits' | 'leadTimeHours' | 'bufferMinutes' | 'isActive'
  > & {
    /** ADR-369: FIXED (occurrence + seats) | OPEN (start + duration inside windows). */
    bookingStyle?: string | null
    /** ADR-369: start-time grid step in minutes for OPEN sessions. */
    slotMinutes?: number | null
  }
  rules: Pick<ResourceAvailabilityRule, 'ruleKind' | 'weekday' | 'startMinute' | 'endMinute' | 'validFrom' | 'validUntil'>[]
  blackouts: { start: Date; end: Date }[]
  /** CONFIRMED bookings only — requests/holds never block (advisory, D4). */
  confirmed: Pick<Booking, 'start' | 'end' | 'units'>[]
  /** REQUESTED bookings with an unexpired hold (D4). Optional: absent = no holds to surface. */
  holds?: Pick<Booking, 'start' | 'end' | 'units' | 'holdExpiresAt'>[] // holdExpiresAt is non-null in practice (queried with gt: now); null is filtered below
  now: Date
  from: Date
  to: Date
}

export interface BookingRequestInput {
  /** UTC instant; for SPACE the resource-local dates of [start,end) must lie in open windows. */
  start: Date
  end: Date
  units: number
  minUnits?: number | null
  maxUnits?: number | null
}

export type RequestValidation =
  | { ok: true }
  | { ok: false; code: 'INTERVAL_INVALID' | 'UNITS_INVALID' | 'LEAD_TIME' | 'BLACKOUT' | 'NOT_OPEN' | 'TAKEN' | 'SOLD_OUT'; message: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function localDatesBetween(from: Date, to: Date, timezone: string): string[] {
  const dates: string[] = []
  let cursor = utcToZonedDate(from, timezone)
  const last = utcToZonedDate(to, timezone)
  for (let i = 0; i < 400 && cursor < last; i++) {
    dates.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return dates
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd
}

/** Rule applies at `at` when both validFrom/validUntil (if set) contain it. */
function ruleInValidity(rule: AvailabilityInputs['rules'][number], at: Date): boolean {
  if (rule.validFrom && at < rule.validFrom) return false
  if (rule.validUntil && at > rule.validUntil) return false
  return true
}

// ── SPACE: open local-date windows ────────────────────────────────────────────

function computeSpaceSlots(inputs: AvailabilityInputs): SpaceWindow[] {
  const { resource, rules, blackouts, confirmed, now } = inputs
  const tz = resource.timezone
  const earliest = new Date(now.getTime() + resource.leadTimeHours * 3600000)

  // 1. Candidate local dates from rules, within the query horizon.
  const candidates = new Set<string>()
  const horizonDates = localDatesBetween(inputs.from, inputs.to, tz)
  for (const date of horizonDates) {
    const midnight = zonedDateToUtc(date, tz)
    const nextMidnight = zonedDateToUtc(addDays(date, 1), tz)
    // Lead time at DAY granularity for SPACE (a night is a date, not an
    // instant): a date is a valid check-in while any part of the day lies at
    // or after `earliest`. A same-day check-in with leadTimeHours = 0 stays
    // bookable even though local midnight already passed.
    if (nextMidnight <= earliest) continue // lead time
    const weekday = weekdayOf(date)
    for (const rule of rules) {
      if (!ruleInValidity(rule, midnight)) continue
      if (rule.ruleKind === 'DATE_RANGE') {
        candidates.add(date)
      } else if (rule.ruleKind === 'WEEKLY_WINDOW' && rule.weekday === weekday) {
        // Weekday-scoped SPACE windows (e.g. weekends-only); time-of-day ignored.
        candidates.add(date)
      }
    }
  }

  // 2. Subtract blackouts (a partial-day blackout removes the whole local day).
  const taken = (start: Date, end: Date) =>
    blackouts.some(b => overlaps(start, end, b.start, b.end)) ||
    confirmed.some(c => {
      const b = buffered(c, resource.bufferMinutes)
      return overlaps(start, end, b.start, b.end)
    })

  const freeDates = [...candidates]
    .sort()
    .filter(date => {
      const start = zonedDateToUtc(date, tz)
      const end = zonedDateToUtc(addDays(date, 1), tz)
      return !taken(start, end)
    })

  // 3. Merge consecutive dates into maximal windows (half-open: a free date
  // following another free date extends the window; a gap starts a new one).
  const windows: SpaceWindow[] = []
  for (const date of freeDates) {
    const last = windows[windows.length - 1]
    // endDate is exclusive: the next consecutive date equals the current endDate
    if (last && last.endDate === date) {
      last.endDate = addDays(date, 1)
    } else {
      windows.push({ kind: 'SPACE', startDate: date, endDate: addDays(date, 1) })
    }
  }
  return windows
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Booking extended by the buffer on both sides — overlap math only (D7). */
function buffered(booking: Pick<Booking, 'start' | 'end'>, bufferMinutes: number): { start: Date; end: Date } {
  const buf = bufferMinutes * 60000
  return { start: new Date(booking.start.getTime() - buf), end: new Date(booking.end.getTime() + buf) }
}

/** Maximal free sub-windows inside [windowStart, windowEnd) after subtracting
 * `blocked` intervals (buffered confirmed bookings + blackouts), half-open. */
function freeSubWindows(
  windowStart: Date,
  windowEnd: Date,
  blocked: Array<{ start: Date; end: Date }>,
): Array<{ start: Date; end: Date }> {
  const events = blocked
    .map(b => ({
      s: Math.max(b.start.getTime(), windowStart.getTime()),
      e: Math.min(b.end.getTime(), windowEnd.getTime()),
    }))
    .filter(x => x.e > x.s)
    .sort((a, b) => a.s - b.s)
  const free: Array<{ start: Date; end: Date }> = []
  let cursor = windowStart.getTime()
  for (const b of events) {
    if (b.s > cursor) free.push({ start: new Date(cursor), end: new Date(b.s) })
    if (b.e > cursor) cursor = b.e
  }
  if (cursor < windowEnd.getTime()) free.push({ start: new Date(cursor), end: new Date(windowEnd) })
  return free
}

// ── SESSION: fixed occurrences with seats ─────────────────────────────────────

function computeSessionSlots(inputs: AvailabilityInputs): SessionOccurrence[] {
  const { resource, rules, blackouts, confirmed, now } = inputs
  const tz = resource.timezone
  const earliest = new Date(now.getTime() + resource.leadTimeHours * 3600000)
  const occurrences: SessionOccurrence[] = []

  for (const date of localDatesBetween(inputs.from, inputs.to, tz)) {
    const weekday = weekdayOf(date)
    for (const rule of rules) {
      if (rule.ruleKind !== 'WEEKLY_WINDOW' || rule.weekday !== weekday) continue
      if (rule.startMinute == null || rule.endMinute == null || rule.endMinute <= rule.startMinute) continue
      const midnight = zonedDateToUtc(date, tz)
      // NOTE: minute offset from local midnight — on DST-transition days the
      // wall-clock start shifts with the offset change (acceptable v1 edge; FU-271-J).
      const start = new Date(midnight.getTime() + rule.startMinute * 60000)
      const end = new Date(midnight.getTime() + rule.endMinute * 60000)
      if (start < earliest) continue
      if (!ruleInValidity(rule, start)) continue
      if (blackouts.some(b => overlaps(start, end, b.start, b.end))) continue
      const seatsTaken = confirmed
        .filter(c => overlaps(start, end, c.start, c.end))
        .reduce((sum, c) => sum + c.units, 0)
      occurrences.push({
        kind: 'SESSION',
        start: start.toISOString(),
        end: end.toISOString(),
        seatsTotal: resource.capacity,
        seatsLeft: Math.max(0, resource.capacity - seatsTaken),
      })
    }
  }

  occurrences.sort((a, b) => a.start.localeCompare(b.start))
  return occurrences
}

// ── OPEN sessions: free time inside recurring windows (ADR-369) ──────────────

function computeOpenSlots(inputs: AvailabilityInputs): SessionOccurrence[] {
  const { resource, rules, blackouts, confirmed, now } = inputs
  const tz = resource.timezone
  const slotMs = (resource.slotMinutes ?? 60) * 60000
  const earliest = new Date(now.getTime() + resource.leadTimeHours * 3600000)
  const segments: SessionOccurrence[] = []

  for (const date of localDatesBetween(inputs.from, inputs.to, tz)) {
    const weekday = weekdayOf(date)
    for (const rule of rules) {
      if (rule.ruleKind !== 'WEEKLY_WINDOW' || rule.weekday !== weekday) continue
      if (rule.startMinute == null || rule.endMinute == null || rule.endMinute <= rule.startMinute) continue
      const midnight = zonedDateToUtc(date, tz)
      // NOTE: minute offset from local midnight — on DST-transition days the
      // wall-clock start shifts with the offset change (acceptable v1 edge; FU-271-J).
      const windowStart = new Date(midnight.getTime() + rule.startMinute * 60000)
      const windowEnd = new Date(midnight.getTime() + rule.endMinute * 60000)
      if (!ruleInValidity(rule, windowStart)) continue
      const blocked: Array<{ start: Date; end: Date }> = [
        ...blackouts.filter(b => overlaps(windowStart, windowEnd, b.start, b.end)),
        ...confirmed.filter(c => overlaps(windowStart, windowEnd, c.start, c.end)).map(c => buffered(c, resource.bufferMinutes)),
      ]
      for (const seg of freeSubWindows(windowStart, windowEnd, blocked)) {
        // Lead time truncates the FREE START, not the window (a window open
        // earlier today may still be booked later); segments with no whole
        // grid step left are dropped.
        const firstStart = Math.max(seg.start.getTime(), earliest.getTime())
        if (windowEnd.getTime() - firstStart < slotMs) continue
        segments.push({
          kind: 'SESSION',
          start: new Date(firstStart).toISOString(),
          end: seg.end.toISOString(),
          seatsTotal: 1,
          seatsLeft: 1,
          windowStart: windowStart.toISOString(),
          windowEnd: windowEnd.toISOString(),
        })
      }
    }
  }

  segments.sort((a, b) => a.start.localeCompare(b.start))
  return segments
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Derive availability over [from, to) — D2: computed on read, never stored. */
export function deriveAvailability(inputs: AvailabilityInputs): DerivedAvailability {
  const kind = inputs.resource.kind === 'SPACE' ? 'SPACE' : 'SESSION'
  const isOpen = kind === 'SESSION' && inputs.resource.bookingStyle === 'OPEN'
  // D4 advisory holds: surfaced for honest "requested" rendering, never subtracted from slots.
  const holds = (inputs.holds ?? [])
    .filter(h => h.holdExpiresAt != null && h.holdExpiresAt > inputs.now && overlaps(h.start, h.end, inputs.from, inputs.to))
    .map(h => ({
      start: h.start.toISOString(),
      end: h.end.toISOString(),
      units: h.units,
      expiresAt: h.holdExpiresAt!.toISOString(),
    }))
  return {
    resourceId: inputs.resource.id,
    kind,
    style: isOpen ? 'OPEN' : 'FIXED',
    slotMinutes: inputs.resource.slotMinutes ?? 60,
    timezone: inputs.resource.timezone,
    slots: kind === 'SPACE' ? computeSpaceSlots(inputs) : isOpen ? computeOpenSlots(inputs) : computeSessionSlots(inputs),
    holds,
  }
}

/**
 * Validate a booking request against the SAME derivation (D7 semantics).
 * `minUnits`/`maxUnits` are the offer-level overrides (D6) falling back to the
 * resource defaults. A request is valid when every requested unit of time lies
 * in an open window, is not blacked out, not taken (buffered), respects lead
 * time, and — for SESSION — the occurrence still has seats.
 */
export function validateBookingRequest(inputs: AvailabilityInputs, req: BookingRequestInput): RequestValidation {
  const { resource } = inputs
  const tz = resource.timezone

  if (!(req.start < req.end)) {
    return { ok: false, code: 'INTERVAL_INVALID', message: 'start must be before end' }
  }
  const minUnits = req.minUnits ?? resource.minUnits ?? 1
  const maxUnits = req.maxUnits ?? resource.maxUnits ?? 365
  if (!Number.isInteger(req.units) || req.units < 1 || req.units < minUnits || req.units > maxUnits) {
    return { ok: false, code: 'UNITS_INVALID', message: `units must be between ${minUnits} and ${maxUnits}` }
  }
  const earliest = new Date(inputs.now.getTime() + resource.leadTimeHours * 3600000)
  if (resource.kind === 'SESSION') {
    // SESSION occurrences are instants — lead time applies to the start instant.
    if (req.start < earliest) {
      return { ok: false, code: 'LEAD_TIME', message: `bookings must start at least ${resource.leadTimeHours}h from now` }
    }
  } else {
    // SPACE is date-granular (D8): lead time applies at day granularity, so a
    // same-day check-in is legal while any part of the local day is still
    // ahead of the lead-time horizon (mirrors computeSpaceSlots).
    const startNextMidnight = zonedDateToUtc(addDays(utcToZonedDate(req.start, tz), 1), tz)
    if (startNextMidnight <= earliest) {
      return { ok: false, code: 'LEAD_TIME', message: `check-in must be at least ${resource.leadTimeHours}h from now` }
    }
  }
  if (inputs.blackouts.some(b => overlaps(req.start, req.end, b.start, b.end))) {
    return { ok: false, code: 'BLACKOUT', message: 'requested interval is closed (blackout)' }
  }

  if (resource.kind === 'SPACE') {
    // Whole local days: [start,end) must map 1:1 onto requested nights.
    const startDate = utcToZonedDate(req.start, tz)
    const endDate = utcToZonedDate(req.end, tz)
    const nights = nightsBetween(startDate, endDate)
    if (nights !== req.units) {
      return { ok: false, code: 'UNITS_INVALID', message: `requested nights (${nights}) do not match units (${req.units})` }
    }
    // Overlap with a confirmed booking (buffered) is reported before the
    // window scan so the buyer sees TAKEN, not a generic closed-day error.
    const conflictsWithBuffer = inputs.confirmed.some(c => {
      const b = buffered(c, resource.bufferMinutes)
      return overlaps(req.start, req.end, b.start, b.end)
    })
    if (conflictsWithBuffer) {
      return { ok: false, code: 'TAKEN', message: 'requested interval overlaps a confirmed booking' }
    }
    // Every night must sit in an open window of the derivation.
    const availability = deriveAvailability({ ...inputs, from: req.start, to: req.end })
    const windows = availability.slots as SpaceWindow[]
    for (let date = startDate; date < endDate; date = addDays(date, 1)) {
      const inWindow = windows.some(w => date >= w.startDate && date < w.endDate)
      if (!inWindow) {
        return { ok: false, code: 'NOT_OPEN', message: `${date} is not available` }
      }
    }
    // v1: capacity 1 semantics per window (multi-unit SPACE is FU-271-C).
    return { ok: true }
  }

  // OPEN SESSION (ADR-369): the request is a whole-hour block inside a free
  // sub-window of an open WEEKLY_WINDOW, start-aligned to the window's grid.
  // units = booked hours (capacity is 1, so overlap is binary).
  if (resource.kind === 'SESSION' && resource.bookingStyle === 'OPEN') {
    const slotMs = (resource.slotMinutes ?? 60) * 60000
    const durationHours = (req.end.getTime() - req.start.getTime()) / 3600000
    if (!Number.isInteger(durationHours) || durationHours < 1) {
      return { ok: false, code: 'UNITS_INVALID', message: 'open-window bookings must be a whole number of hours (1+)' }
    }
    if (req.units !== durationHours) {
      return { ok: false, code: 'UNITS_INVALID', message: `units must equal the booked hours (${durationHours})` }
    }
    // Containment in a derived free segment is the same check as "inside an
    // open window, not blacked out, not overlapping a buffered booking, after
    // lead time" — the derivation performs all four (D7).
    const availability = deriveAvailability({
      ...inputs,
      from: new Date(req.start.getTime() - 86400000),
      to: new Date(req.end.getTime() + 86400000),
    })
    const segment = (availability.slots as SessionOccurrence[]).find(s =>
      new Date(s.start).getTime() <= req.start.getTime() && req.end.getTime() <= new Date(s.end).getTime())
    if (!segment?.windowStart) {
      return { ok: false, code: 'NOT_OPEN', message: 'the requested block is not inside an open window' }
    }
    const anchor = new Date(segment.windowStart).getTime()
    if ((req.start.getTime() - anchor) % slotMs !== 0) {
      return { ok: false, code: 'UNITS_INVALID', message: `start must align to the ${(slotMs / 60000)}-minute grid of the open window` }
    }
    return { ok: true }
  }

  // FIXED SESSION: the request must exactly match one derived occurrence. The
  // derivation horizon is widened by a day on both sides so an occurrence
  // containing the request is found even when from/to cut into it.
  const availability = deriveAvailability({
    ...inputs,
    from: new Date(req.start.getTime() - 86400000),
    to: new Date(req.end.getTime() + 86400000),
  })
  const occurrence = (availability.slots as SessionOccurrence[])
    .find(o => new Date(o.start).getTime() === req.start.getTime() && new Date(o.end).getTime() === req.end.getTime())
  if (!occurrence) {
    return { ok: false, code: 'NOT_OPEN', message: 'no occurrence at the requested time' }
  }
  if (occurrence.seatsLeft < req.units) {
    return { ok: false, code: 'SOLD_OUT', message: `only ${occurrence.seatsLeft} seat(s) left` }
  }
  return { ok: true }
}

/** DB-touching wrapper: loads rules/blackouts/confirmed bookings and derives. */
export async function getAvailability(
  prisma: PrismaClient,
  resourceId: string,
  from: Date,
  to: Date,
  now: Date = new Date(),
): Promise<DerivedAvailability | null> {
  const resource = await prisma.bookableResource.findUnique({
    where: { id: resourceId },
    include: { rules: true, blackouts: true },
  })
  if (!resource || !resource.isActive) return null
  const confirmed = await prisma.booking.findMany({
    where: {
      resourceId,
      status: 'CONFIRMED',
      start: { lt: to },
      end: { gt: from },
    },
    select: { start: true, end: true, units: true },
  })
  const holds = await prisma.booking.findMany({
    where: {
      resourceId,
      status: 'REQUESTED',
      holdExpiresAt: { gt: now },
      start: { lt: to },
      end: { gt: from },
    },
    select: { start: true, end: true, units: true, holdExpiresAt: true },
  })
  return deriveAvailability({
    resource,
    rules: resource.rules,
    blackouts: resource.blackouts,
    confirmed,
    holds,
    now,
    from,
    to,
  })
}
