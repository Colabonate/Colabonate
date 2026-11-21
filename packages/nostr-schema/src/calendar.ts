// Calendar — NIP-52 booking vocabulary (ADR-271).
//
// Adopts NIP-52 (kinds 31922/31923/31924/31925) for bookable resources:
// one kind 31924 calendar per resource, kind 31922 (date-based, SPACE) or
// 31923 (time-based, SESSION) availability occurrences expanded from rules,
// kind 31925 RSVP as the buyer's booking request, and a seller-countersigned
// 31922/31923 booking event as the ONLY thing that makes a booking exist
// (D3 invariant — no server record creates a booking).
//
// Colabonate extension tags layered on top of the NIP-52 vocabulary (unknown
// tags are ignored by other clients):
//   ["booking", "availability" | "confirmed"]  — discriminator for our events
//   ["capacity", "<N>"]                         — units (SPACE) or seats (SESSION)
//   ["unit", "<per_night|per_day|per_hour|per_seat|flat>"]
//   ["price", "<sats>", "sats"]
//   ["units", "<N>"]                            — RSVP: requested seats; booking: booked units
//   ["offer", "<colabonate offer id>"]          — optional link to the selling offer

export const CALENDAR_KINDS = {
  DATE_EVENT: 31922,
  TIME_EVENT: 31923,
  CALENDAR: 31924,
  RSVP: 31925,
} as const

export const BOOKING_UNITS = ['per_night', 'per_day', 'per_hour', 'per_seat', 'flat'] as const
export type BookingUnit = (typeof BOOKING_UNITS)[number]

export const BOOKING_EVENT_TYPES = ['availability', 'confirmed'] as const
export type BookingEventType = (typeof BOOKING_EVENT_TYPES)[number]

const HEX_PUBKEY = /^[0-9a-f]{64}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export interface CalendarRef {
  pubkey: string
  d: string
}

/** Addressable-event coordinate `kind:pubkey:d`. */
export function toCoord(kind: number, ref: CalendarRef): string {
  return `${kind}:${ref.pubkey}:${ref.d}`
}

// ── Deterministic occurrence d-tags (ADR-271 D2/D3) ───────────────────────────
// Rules are a Colabonate-side authoring convenience; what gets PUBLISHED is
// concrete occurrences. Both the seller's publisher and the server derive the
// same d-tag from the rule so an RSVP can address the occurrence without a
// round-trip: SPACE → one addressable 31922 per rule (re-published when the
// open range shrinks; the RSVP's e tag pins the revision); SESSION → one 31923
// per concrete slot (d carries the resource-local date).

export const OCCURRENCE_D_PREFIX = 'cbs'

/** SPACE: stable addressable occurrence per open-window rule. */
export function spaceOccurrenceD(ruleId: string): string {
  return `${OCCURRENCE_D_PREFIX}-${ruleId}`
}

/** SESSION: one occurrence per concrete slot, `YYYYMMDD` in the resource timezone. */
export function sessionOccurrenceD(ruleId: string, localDate: string): string {
  return `${OCCURRENCE_D_PREFIX}-${ruleId}-${localDate.replace(/-/g, '')}`
}

// ── Kind 31924 — Calendar ─────────────────────────────────────────────────────

export interface CalendarTagInput {
  d: string
  title: string
  description?: string
  /** Calendar events referenced for inclusion (a tags). */
  eventRefs?: Array<{ kind: 31922 | 31923 } & CalendarRef>
}

export function buildCalendarTags(input: CalendarTagInput): string[][] {
  const tags: string[][] = [
    ['d', input.d],
    ['title', input.title],
    // Canonical NIP-52 calls the 31924 name tag `name`; our fork uses `title`.
    // Emit both so every NIP-52 client can render the calendar.
    ['name', input.title],
  ]
  for (const ref of input.eventRefs ?? []) {
    tags.push(['a', toCoord(ref.kind, ref)])
  }
  return tags
}

// ── Kind 31922 — Date-based availability occurrence (SPACE) ──────────────────

export interface DateOccurrenceTagInput {
  d: string
  title: string
  summary?: string
  /** Inclusive start date, resource-local YYYY-MM-DD. */
  startDate: string
  /** Exclusive end date, resource-local YYYY-MM-DD. */
  endDate: string
  calendar: CalendarRef
  capacity: number
  unit: BookingUnit
  priceSats: number
  location?: string
  geohash?: string
  offerId?: string
}

export function buildDateOccurrenceTags(input: DateOccurrenceTagInput): string[][] {
  const tags: string[][] = [
    ['d', input.d],
    ['title', input.title],
    ['start', input.startDate],
    ['end', input.endDate],
    ['a', toCoord(CALENDAR_KINDS.CALENDAR, input.calendar)],
    ['booking', 'availability'],
    ['capacity', String(input.capacity)],
    ['unit', input.unit],
    ['price', String(input.priceSats), 'sats'],
  ]
  if (input.summary) tags.push(['summary', input.summary])
  if (input.location) tags.push(['location', input.location])
  if (input.geohash) tags.push(['g', input.geohash])
  if (input.offerId) tags.push(['offer', input.offerId])
  return tags
}

// ── Kind 31923 — Time-based availability occurrence (SESSION) ─────────────────

export interface TimeOccurrenceTagInput {
  d: string
  title: string
  summary?: string
  /** Inclusive start, Unix seconds. */
  startTime: number
  /** Exclusive end, Unix seconds. */
  endTime: number
  /** IANA timezone of the start timestamp (NIP-52 start_tzid). */
  tzid: string
  calendar: CalendarRef
  capacity: number
  unit: BookingUnit
  priceSats: number
  location?: string
  geohash?: string
  offerId?: string
}

/** Day-granularity D tags covering [start, end), per NIP-52. */
export function dayTags(startTime: number, endTime: number): string[][] {
  const tags: string[][] = []
  const firstDay = Math.floor(startTime / 86400)
  const lastDay = Math.floor((endTime - 1) / 86400)
  for (let day = firstDay; day <= lastDay; day++) {
    tags.push(['D', String(day)])
  }
  return tags
}

export function buildTimeOccurrenceTags(input: TimeOccurrenceTagInput): string[][] {
  const tags: string[][] = [
    ['d', input.d],
    ['title', input.title],
    ['start', String(input.startTime)],
    ['end', String(input.endTime)],
    ['start_tzid', input.tzid],
    ['a', toCoord(CALENDAR_KINDS.CALENDAR, input.calendar)],
    ['booking', 'availability'],
    ['capacity', String(input.capacity)],
    ['unit', input.unit],
    ['price', String(input.priceSats), 'sats'],
    ...dayTags(input.startTime, input.endTime),
  ]
  if (input.summary) tags.push(['summary', input.summary])
  if (input.location) tags.push(['location', input.location])
  if (input.geohash) tags.push(['g', input.geohash])
  if (input.offerId) tags.push(['offer', input.offerId])
  return tags
}

// ── Kind 31925 — Booking request RSVP ─────────────────────────────────────────

export interface BookingRsvpTagInput {
  d: string
  occurrence: { kind: 31922 | 31923 } & CalendarRef
  /** Event id of the occurrence revision being responded to (e tag). */
  occurrenceEventId?: string
  /** Requested seats (SESSION) or nights (SPACE). */
  units: number
  /** SPACE only: sub-range within the occurrence, resource-local dates. */
  startDate?: string
  /** SPACE only: exclusive end date. */
  endDate?: string
  sellerPubkey: string
  offerId?: string
}

export function buildBookingRsvpTags(input: BookingRsvpTagInput): string[][] {
  const tags: string[][] = [
    ['d', input.d],
    ['a', toCoord(input.occurrence.kind, input.occurrence)],
    ['status', 'accepted'],
    ['fb', 'busy'],
    ['units', String(input.units)],
    ['p', input.sellerPubkey],
  ]
  if (input.occurrenceEventId) tags.push(['e', input.occurrenceEventId])
  if (input.startDate) tags.push(['start', input.startDate])
  if (input.endDate) tags.push(['end', input.endDate])
  if (input.offerId) tags.push(['offer', input.offerId])
  return tags
}

export interface ParsedBookingRsvp {
  d: string
  occurrenceKind: 31922 | 31923
  occurrencePubkey: string
  occurrenceD: string
  occurrenceEventId?: string
  status: 'accepted' | 'declined' | 'tentative'
  units: number
  startDate?: string
  endDate?: string
  sellerPubkey?: string
  offerId?: string
}

/** Parse a kind 31925 RSVP into Colabonate booking-request semantics. */
export function parseBookingRsvp(tags: string[][]): ParsedBookingRsvp | null {
  const find = (name: string) => tags.find(t => t[0] === name)
  const d = find('d')?.[1]
  const a = find('a')?.[1]
  const status = find('status')?.[1]
  if (!d || !a || !status) return null
  const parts = a.split(':')
  if (parts.length < 3) return null
  const kind = Number(parts[0])
  if (kind !== 31922 && kind !== 31923) return null
  const units = find('units')?.[1]
  const startDate = find('start')?.[1]
  const endDate = find('end')?.[1]
  return {
    d,
    occurrenceKind: kind,
    occurrencePubkey: parts[1],
    occurrenceD: parts.slice(2).join(':'),
    occurrenceEventId: find('e')?.[1],
    status: status as ParsedBookingRsvp['status'],
    units: units ? parseInt(units, 10) : 1,
    startDate: ISO_DATE.test(startDate ?? '') ? startDate : undefined,
    endDate: ISO_DATE.test(endDate ?? '') ? endDate : undefined,
    sellerPubkey: find('p')?.[1]?.match(HEX_PUBKEY) ? find('p')?.[1] : undefined,
    offerId: find('offer')?.[1],
  }
}

// ── Kind 31922/31923 — Seller-countersigned booking (the commitment, D3) ─────

export interface BookingConfirmationTagInput {
  d: string
  title: string
  /** 'date' → kind 31922 with YYYY-MM-DD; 'time' → kind 31923 with Unix seconds. */
  interval: 'date' | 'time'
  start: string | number
  end: string | number
  tzid?: string
  buyerPubkey: string
  /** Buyer's kind 31925 RSVP being countersigned (e tag). */
  rsvpEventId: string
  occurrence: { kind: 31922 | 31923 } & CalendarRef
  units: number
  priceSats?: number
  offerId?: string
}

export function buildBookingConfirmationTags(input: BookingConfirmationTagInput): string[][] {
  const tags: string[][] = [
    ['d', input.d],
    ['title', input.title],
    ['start', String(input.start)],
    ['end', String(input.end)],
    ['e', input.rsvpEventId],
    ['a', toCoord(input.occurrence.kind, input.occurrence)],
    ['booking', 'confirmed'],
    ['units', String(input.units)],
    ['p', input.buyerPubkey],
  ]
  if (input.tzid && input.interval === 'time') tags.push(['start_tzid', input.tzid])
  if (typeof input.start === 'number' && typeof input.end === 'number') {
    tags.push(...dayTags(input.start, input.end))
  }
  if (input.priceSats != null) tags.push(['price', String(input.priceSats), 'sats'])
  if (input.offerId) tags.push(['offer', input.offerId])
  return tags
}

export interface ParsedBookingConfirmation {
  kind: 31922 | 31923
  d: string
  start: string
  end: string
  buyerPubkey: string
  rsvpEventId: string
  occurrenceKind: 31922 | 31923
  occurrencePubkey: string
  occurrenceD: string
  units: number
  priceSats?: number
  offerId?: string
}

/**
 * Parse a seller-countersigned booking event. Returns null unless the event
 * carries the Colabonate booking marker (["booking","confirmed"]), an e tag
 * referencing the buyer's RSVP and a p tag with the buyer's pubkey.
 */
export function parseBookingConfirmation(kind: number, tags: string[][]): ParsedBookingConfirmation | null {
  if (kind !== 31922 && kind !== 31923) return null
  const find = (name: string) => tags.find(t => t[0] === name)
  const marker = find('booking')?.[1]
  if (marker !== 'confirmed') return null
  const d = find('d')?.[1]
  const start = find('start')?.[1]
  const end = find('end')?.[1]
  const rsvpEventId = find('e')?.[1]
  const buyer = find('p')?.[1]
  const a = find('a')?.[1]
  if (!d || !start || !end || !rsvpEventId || !buyer || !buyer.match(HEX_PUBKEY) || !a) return null
  const parts = a.split(':')
  if (parts.length < 3) return null
  const occKind = Number(parts[0])
  if (occKind !== 31922 && occKind !== 31923) return null
  const units = find('units')?.[1]
  const price = find('price')?.[1]
  return {
    kind: kind as 31922 | 31923,
    d,
    start,
    end,
    buyerPubkey: buyer,
    rsvpEventId,
    occurrenceKind: occKind as 31922 | 31923,
    occurrencePubkey: parts[1],
    occurrenceD: parts.slice(2).join(':'),
    units: units ? parseInt(units, 10) : 1,
    priceSats: price ? parseInt(price, 10) : undefined,
    offerId: find('offer')?.[1],
  }
}

// ── Timezone-safe date helpers (shared by server derivation + client UI) ──────

/** True when `timeZone` is a valid IANA identifier. */
export function isValidTimezone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

function timezoneOffsetMs(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = dtf.formatToParts(at)
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0')
  const asUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour') % 24, get('minute'), get('second'),
  )
  return asUtc - at.getTime()
}

/** UTC instant of local midnight on `date` (YYYY-MM-DD) in `timeZone`. */
export function zonedDateToUtc(date: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
  const offset = timezoneOffsetMs(timeZone, guess)
  return new Date(guess.getTime() - offset)
}

/** Resource-local YYYY-MM-DD of a UTC instant, in `timeZone`. */
export function utcToZonedDate(at: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return dtf.format(at)
}

/** `date` + `days` in YYYY-MM-DD arithmetic (timezone-free). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d))
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

/** Nights between two resource-local dates (exclusive end). */
export function nightsBetween(startDate: string, endDate: string): number {
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = endDate.split('-').map(Number)
  return Math.round(
    (Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000,
  )
}
