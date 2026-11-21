// Zod schemas for NIP-52 calendar booking events (ADR-271).

import { z } from 'zod'

const hexPubkey = z.string().regex(/^[0-9a-f]{64}$/, 'expected 64-char hex pubkey')
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
const unixSeconds = z.string().regex(/^\d+$/, 'expected unix seconds string')
const ianaTzid = z.string().regex(/^[A-Za-z_]+\/[A-Za-z0-9_+\-/]+$/, 'expected IANA timezone')
const coord = z.string().regex(/^3192[23]:[0-9a-f]{64}:.+$/, 'expected 31922/31923 coordinate')
const bookingUnit = z.enum(['per_night', 'per_day', 'per_hour', 'per_seat', 'flat'])

const tagList = z.array(z.array(z.string()))

function has(tags: z.infer<typeof tagList>, name: string): boolean {
  return tags.some(t => t[0] === name)
}

// ── Kind 31924 — Calendar ─────────────────────────────────────────────────────

export const CalendarSchema = z.object({
  kind: z.literal(31924),
  content: z.string(),
  tags: tagList.refine(
    tags => has(tags, 'd') && has(tags, 'title'),
    { message: 'Missing required tags: d, title' },
  ),
})

// ── Kind 31922 — Date-based availability occurrence (SPACE) ──────────────────

export const DateOccurrenceEventSchema = z.object({
  kind: z.literal(31922),
  content: z.string(),
  tags: tagList.refine(
    tags => has(tags, 'd') && has(tags, 'title') && has(tags, 'start'),
    { message: 'Missing required tags: d, title, start' },
  ).superRefine((tags, ctx) => {
    const find = (name: string) => tags.find(t => t[0] === name)
    const start = find('start')?.[1]
    const end = find('end')?.[1]
    if (start && !isoDate.safeParse(start).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'start must be YYYY-MM-DD', path: ['start'] })
    }
    if (end && !isoDate.safeParse(end).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'end must be YYYY-MM-DD', path: ['end'] })
    }
    if (start && end && start >= end) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'start must be before end', path: ['start'] })
    }
  }),
})

// ── Kind 31923 — Time-based availability occurrence (SESSION) ─────────────────

export const TimeOccurrenceEventSchema = z.object({
  kind: z.literal(31923),
  content: z.string(),
  tags: tagList.refine(
    tags => has(tags, 'd') && has(tags, 'title') && has(tags, 'start'),
    { message: 'Missing required tags: d, title, start' },
  ).superRefine((tags, ctx) => {
    const find = (name: string) => tags.find(t => t[0] === name)
    const start = find('start')?.[1]
    const end = find('end')?.[1]
    if (start && !unixSeconds.safeParse(start).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'start must be unix seconds', path: ['start'] })
    }
    if (end && !unixSeconds.safeParse(end).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'end must be unix seconds', path: ['end'] })
    }
    if (start && end && Number(start) >= Number(end)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'start must be before end', path: ['start'] })
    }
    const tzid = find('start_tzid')?.[1]
    if (tzid && !ianaTzid.safeParse(tzid).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'start_tzid must be IANA timezone', path: ['start_tzid'] })
    }
    const unit = find('unit')?.[1]
    if (unit && !bookingUnit.safeParse(unit).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'unit must be a booking unit', path: ['unit'] })
    }
  }),
})

// ── Kind 31925 — Booking request RSVP ─────────────────────────────────────────

export const BookingRsvpEventSchema = z.object({
  kind: z.literal(31925),
  content: z.string().optional(),
  tags: tagList.refine(
    tags => has(tags, 'd') && has(tags, 'a') && has(tags, 'status'),
    { message: 'Missing required tags: d, a, status' },
  ).superRefine((tags, ctx) => {
    const find = (name: string) => tags.find(t => t[0] === name)
    const a = find('a')?.[1]
    if (a && !coord.safeParse(a).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'a must reference a 31922/31923 event', path: ['a'] })
    }
    const status = find('status')?.[1]
    if (status && !['accepted', 'declined', 'tentative'].includes(status)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'status must be accepted|declined|tentative', path: ['status'] })
    }
    const units = find('units')?.[1]
    if (units && (!/^\d+$/.test(units) || Number(units) < 1)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'units must be a positive integer string', path: ['units'] })
    }
    for (const name of ['start', 'end'] as const) {
      const tag = find(name)?.[1]
      if (tag && !isoDate.safeParse(tag).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${name} must be YYYY-MM-DD (SPACE sub-range)`, path: [name] })
      }
    }
  }),
})

// ── Seller-countersigned booking (kind 31922 or 31923 + booking marker) ───────

function confirmationTagChecks(ctx: z.RefinementCtx, tags: string[][]): void {
  const find = (name: string) => tags.find(t => t[0] === name)
  const marker = find('booking')?.[1]
  if (marker !== 'confirmed') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'booking marker must be "confirmed"', path: ['booking'] })
  }
  const a = find('a')?.[1]
  if (a && !coord.safeParse(a).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'a must reference a 31922/31923 event', path: ['a'] })
  }
}

const confirmationRequiredTags = tagList.refine(
  tags => has(tags, 'booking') && has(tags, 'd') && has(tags, 'start') && has(tags, 'end') && has(tags, 'e') && has(tags, 'p') && has(tags, 'a'),
  { message: 'Booking confirmation requires: booking, d, start, end, e (RSVP), p (buyer), a (occurrence)' },
)

export const DateBookingConfirmationSchema = z.object({
  kind: z.literal(31922),
  content: z.string(),
  tags: confirmationRequiredTags,
}).superRefine((event, ctx) => {
  confirmationTagChecks(ctx, event.tags)
  const find = (name: string) => event.tags.find(t => t[0] === name)
  const start = find('start')?.[1]
  const end = find('end')?.[1]
  if (start && !isoDate.safeParse(start).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'start must be YYYY-MM-DD for kind 31922', path: ['start'] })
  }
  if (end && !isoDate.safeParse(end).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'end must be YYYY-MM-DD for kind 31922', path: ['end'] })
  }
})

export const TimeBookingConfirmationSchema = z.object({
  kind: z.literal(31923),
  content: z.string(),
  tags: confirmationRequiredTags,
}).superRefine((event, ctx) => {
  confirmationTagChecks(ctx, event.tags)
  const find = (name: string) => event.tags.find(t => t[0] === name)
  const start = find('start')?.[1]
  const end = find('end')?.[1]
  if (start && !unixSeconds.safeParse(start).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'start must be unix seconds for kind 31923', path: ['start'] })
  }
  if (end && !unixSeconds.safeParse(end).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'end must be unix seconds for kind 31923', path: ['end'] })
  }
})

export const BookingConfirmationSchema = z.union([
  DateBookingConfirmationSchema,
  TimeBookingConfirmationSchema,
])

export function validateCalendar(event: unknown) {
  return CalendarSchema.safeParse(event)
}
export function validateBookingRsvp(event: unknown) {
  return BookingRsvpEventSchema.safeParse(event)
}
export function validateBookingConfirmation(event: unknown) {
  return BookingConfirmationSchema.safeParse(event)
}
export { hexPubkey, isoDate }
