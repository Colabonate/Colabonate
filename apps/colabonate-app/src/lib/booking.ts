/**
 * NIP-52 booking client (ADR-271).
 *
 * All Nostr-authoritative publishing happens HERE, client-side: the kind 31924
 * calendar, the 31922/31923 availability occurrences (expanded from the
 * resource rules over a rolling window), the buyer's kind 31925 RSVP and the
 * seller's countersigned booking event — the only thing that makes a booking
 * exist (D3). The server indexes and verifies; it never signs.
 *
 * Signing goes through signAndPublishEvent (burner key or NIP-46 bunker), the
 * same identity the session pubkey — and therefore resource.ownerPubkey — is
 * derived from, so the server's countersignature verification (pubkey match +
 * verifyEvent) succeeds.
 */

import type { Event } from 'nostr-tools'
import {
  addDays,
  buildBookingConfirmationTags,
  buildCalendarTags,
  buildDateOccurrenceTags,
  buildTimeOccurrenceTags,
  sessionOccurrenceD,
  spaceOccurrenceD,
  utcToZonedDate,
  zonedDateToUtc,
} from '@col/nostr-schema'
import { signAndPublishEvent } from './nostr'
import { getMyPubkey } from './nostr-identity'

export const OCCURRENCE_HORIZON_DAYS = 180 // D2: rolling re-expansion window

export interface AvailabilityRuleDTO {
  id: string
  ruleKind: 'WEEKLY_WINDOW' | 'DATE_RANGE' | string
  weekday: number | null
  startMinute: number | null
  endMinute: number | null
  validFrom: string | null
  validUntil: string | null
}

export interface BookableResourceDTO {
  id: string
  ownerPubkey: string
  kind: 'SPACE' | 'SESSION'
  title: string
  description: string | null
  timezone: string
  capacity: number
  minUnits: number | null
  maxUnits: number | null
  leadTimeHours: number
  bufferMinutes: number
  /** ADR-369: 'FIXED' (fixed occurrence with seats) | 'OPEN' (buyer picks a
   * start + whole-hour duration inside recurring windows). */
  bookingStyle?: 'FIXED' | 'OPEN'
  slotMinutes?: number
  calendarD: string
  rules: AvailabilityRuleDTO[]
}

export interface BookingDTO {
  id: string
  resourceId: string
  offerId: string | null
  buyerPubkey: string
  sellerPubkey: string
  status: 'REQUESTED' | 'CONFIRMED' | 'DECLINED' | 'CANCELLED' | 'LAPSED' | string
  start: string
  end: string
  units: number
  priceSats: number | null
  requestEventId: string | null
  bookingEventId: string | null
  expiresAt: string | null
  note: string | null
  resource?: { id: string; title: string; kind: string; timezone: string }
}

/** Publish/refresh the resource's kind 31924 public calendar. */
export async function publishBookableCalendar(resource: BookableResourceDTO): Promise<Event> {
  return signAndPublishEvent({
    kind: 31924,
    tags: buildCalendarTags({
      d: resource.calendarD,
      title: resource.title,
      description: resource.description ?? undefined,
    }),
    content: resource.description ?? '',
  })
}

/**
 * Expand the resource rules into concrete occurrences over the rolling
 * horizon and publish them (D2: rules are an authoring convenience; only
 * concrete occurrences are published). Returns the signed events.
 */
export async function publishAvailabilityOccurrences(
  resource: BookableResourceDTO,
  priceSats: number,
  unit: 'per_night' | 'per_day' | 'per_hour' | 'per_seat' | 'flat',
  offerId?: string,
): Promise<Event[]> {
  const calendar = { pubkey: resource.ownerPubkey, d: resource.calendarD }
  const today = utcToZonedDate(new Date(), resource.timezone)
  const horizon = addDays(today, OCCURRENCE_HORIZON_DAYS)
  const events: Event[] = []

  for (const rule of resource.rules) {
    if (rule.ruleKind === 'DATE_RANGE') {
      const from = rule.validFrom
        ? utcToZonedDate(new Date(rule.validFrom), resource.timezone)
        : today
      const to = rule.validUntil
        ? utcToZonedDate(new Date(rule.validUntil), resource.timezone)
        : horizon
      const startDate = from > today ? from : today
      const endDate = to < horizon ? to : horizon
      if (startDate >= endDate) continue
      events.push(await signAndPublishEvent({
        kind: 31922,
        tags: buildDateOccurrenceTags({
          d: spaceOccurrenceD(rule.id),
          title: resource.title,
          startDate,
          endDate,
          calendar,
          capacity: resource.capacity,
          unit,
          priceSats,
          offerId,
        }),
        content: resource.description ?? '',
      }))
    } else if (rule.ruleKind === 'WEEKLY_WINDOW' && rule.weekday != null
      && rule.startMinute != null && rule.endMinute != null) {
      for (let date = today; date < horizon; date = addDays(date, 1)) {
        const [y, m, d] = date.split('-').map(Number)
        const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
        if (weekday !== rule.weekday) continue
        if (rule.validFrom && date < utcToZonedDate(new Date(rule.validFrom), resource.timezone)) continue
        if (rule.validUntil && date > utcToZonedDate(new Date(rule.validUntil), resource.timezone)) continue
        const midnight = zonedDateToUtc(date, resource.timezone)
        events.push(await signAndPublishEvent({
          kind: 31923,
          tags: buildTimeOccurrenceTags({
            d: sessionOccurrenceD(rule.id, date),
            title: resource.title,
            startTime: Math.floor(midnight.getTime() / 1000) + rule.startMinute * 60,
            endTime: Math.floor(midnight.getTime() / 1000) + rule.endMinute * 60,
            tzid: resource.timezone,
            calendar,
            capacity: resource.capacity,
            unit,
            priceSats,
            offerId,
          }),
          content: resource.description ?? '',
        }))
      }
    }
  }
  return events
}

/**
 * Sign + publish the server-built kind 31925 RSVP template (the booking
 * request) and return the SIGNED event. The caller sends the whole event to
 * the server, which verifies signature, schema and occurrence linkage before
 * accepting the requestEventId — a bare id proves nothing.
 */
export async function publishBookingRsvpTemplate(template: {
  kind: 31925
  content: string
  tags: string[][]
  created_at: number
}): Promise<Event> {
  return signAndPublishEvent({
    kind: template.kind,
    tags: template.tags,
    content: template.content,
  })
}

/**
 * Deterministic occurrence coordinate for a booking — mirrors the server's
 * occurrenceCoordFor so RSVP and countersign address the same occurrence.
 * FIXED sessions must start exactly at the occurrence; OPEN sessions address
 * the WEEKLY_WINDOW that CONTAINS the requested block (ADR-369).
 */
export function occurrenceCoordFor(
  resource: BookableResourceDTO,
  start: string,
  end?: string,
): { kind: 31922 | 31923; pubkey: string; d: string } | null {
  const startAt = new Date(start)
  if (resource.kind === 'SPACE') {
    const rule = resource.rules.find(r => r.ruleKind === 'DATE_RANGE'
      && (!r.validFrom || new Date(r.validFrom) <= startAt)
      && (!r.validUntil || new Date(r.validUntil) >= startAt))
    if (!rule) return null
    return { kind: 31922, pubkey: resource.ownerPubkey, d: spaceOccurrenceD(rule.id) }
  }
  const localDate = utcToZonedDate(startAt, resource.timezone)
  const midnight = zonedDateToUtc(localDate, resource.timezone)
  const [y, m, d] = localDate.split('-').map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const offsetMinutes = Math.round((startAt.getTime() - midnight.getTime()) / 60000)
  if (resource.bookingStyle === 'OPEN' && end) {
    const endAt = new Date(end)
    const offsetEnd = Math.round((endAt.getTime() - midnight.getTime()) / 60000)
    const rule = resource.rules.find(r => r.ruleKind === 'WEEKLY_WINDOW'
      && r.weekday === weekday
      && r.startMinute != null && r.endMinute != null
      && r.startMinute <= offsetMinutes && offsetEnd <= r.endMinute)
    if (!rule) return null
    return { kind: 31923, pubkey: resource.ownerPubkey, d: sessionOccurrenceD(rule.id, localDate) }
  }
  const rule = resource.rules.find(r => r.ruleKind === 'WEEKLY_WINDOW'
    && r.weekday === weekday && r.startMinute === offsetMinutes)
  if (!rule) return null
  return { kind: 31923, pubkey: resource.ownerPubkey, d: sessionOccurrenceD(rule.id, localDate) }
}

/**
 * Seller countersignature (D3): signs + publishes the kind 31922/31923 booking
 * event referencing the buyer's RSVP. Returns the signed event for the server
 * verify + mirror call.
 */
export async function publishBookingConfirmation(params: {
  booking: BookingDTO
  resource: BookableResourceDTO
  title?: string
  rsvpEventId: string
  offerId?: string
}): Promise<Event> {
  const { booking, resource } = params
  const isSpace = resource.kind === 'SPACE'
  // No silent fallback: a countersignature MUST address the deterministic
  // occurrence coordinate — falling back to the calendar d would produce an
  // a-tag the server (rightly) rejects.
  const occurrence = occurrenceCoordFor(resource, booking.start, booking.end)
  if (!occurrence) {
    throw new Error('No availability rule matches this booking interval — cannot determine the occurrence to countersign')
  }
  return signAndPublishEvent({
    kind: isSpace ? 31922 : 31923,
    tags: buildBookingConfirmationTags({
      d: `booking-${booking.id}`,
      title: params.title ?? `Booking: ${resource.title}`,
      interval: isSpace ? 'date' : 'time',
      start: isSpace
        ? utcToZonedDate(new Date(booking.start), resource.timezone)
        : Math.floor(new Date(booking.start).getTime() / 1000),
      end: isSpace
        ? utcToZonedDate(new Date(booking.end), resource.timezone)
        : Math.floor(new Date(booking.end).getTime() / 1000),
      tzid: isSpace ? undefined : resource.timezone,
      buyerPubkey: booking.buyerPubkey,
      rsvpEventId: params.rsvpEventId,
      occurrence,
      units: booking.units,
      priceSats: booking.priceSats ?? undefined,
      offerId: params.offerId ?? booking.offerId ?? undefined,
    }),
    content: 'Colabonate booking confirmation',
  })
}

// ── Display helpers (D8: resource timezone is primary) ───────────────────────

export function formatBookingInterval(
  start: string,
  end: string,
  kind: 'SPACE' | 'SESSION',
  timezone: string,
): string {
  const startAt = new Date(start)
  const endAt = new Date(end)
  if (kind === 'SPACE') {
    const dateFmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, day: 'numeric', month: 'short', year: 'numeric',
    })
    return `${dateFmt.format(startAt)} → ${dateFmt.format(endAt)} (${timezone})`
  }
  const startFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })
  const endFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit',
  })
  return `${startFmt.format(startAt)} – ${endFmt.format(endAt)} (${timezone})`
}

export { getMyPubkey }
