// Bookable resources + bookings — ADR-271.
//
// The server is an INDEX and an advisory hold (D4), never the authority:
// a booking exists only through the seller's countersigned NIP-52 event (D3),
// which the seller's client publishes and this route verifies + mirrors.
// Availability is derived on read (D2) via services/booking-availability.

import { randomUUID } from 'crypto'
import { Router } from 'express'
import type { PrismaClient, Booking } from '@prisma/client'
import { verifyEvent, type Event } from 'nostr-tools'
import { AvailabilityRuleKindSchema, BookingStyleSchema, SlotMinutesSchema } from '../lib/enums.js'
import { requireAuth } from '../middleware/require-auth.js'
import type { AuthenticatedRequest } from '../types/express.js'
import {
  deriveAvailability,
  validateBookingRequest,
  type AvailabilityInputs,
} from '../services/booking-availability.js'
import {
  buildBookingRsvpTags,
  isValidTimezone,
  parseBookingConfirmation,
  parseBookingRsvp,
  sessionOccurrenceD,
  spaceOccurrenceD,
  utcToZonedDate,
  validateBookingConfirmation,
  validateBookingRsvp,
  zonedDateToUtc,
} from '@col/nostr-schema'

const HOLD_TTL_MINUTES = 15 // D4: advisory soft-hold, courtesy only
const DEFAULT_CONFIRMATION_WINDOW_HOURS = 24 // D5

type RulePayload = {
  ruleKind?: unknown
  weekday?: unknown
  startMinute?: unknown
  endMinute?: unknown
  validFrom?: unknown
  validUntil?: unknown
}

function parseRule(raw: RulePayload): { ok: true; value: PrismaRuleCreate } | { ok: false; error: string } {
  const kind = AvailabilityRuleKindSchema.safeParse(raw.ruleKind)
  if (!kind.success) return { ok: false, error: 'rule.ruleKind must be WEEKLY_WINDOW or DATE_RANGE' }
  // Absent/null → no bound; a present-but-invalid value → error.
  const toNullableDate = (v: unknown): Date | null | 'invalid' => {
    if (v === undefined || v === null || v === '') return null
    if (typeof v !== 'string') return 'invalid'
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? 'invalid' : d
  }
  const validFrom = toNullableDate(raw.validFrom)
  const validUntil = toNullableDate(raw.validUntil)
  if (validFrom === 'invalid' || validUntil === 'invalid') {
    return { ok: false, error: 'rule.validFrom/validUntil must be ISO dates or null' }
  }
  if (kind.data === 'WEEKLY_WINDOW') {
    const weekday = raw.weekday
    const startMinute = raw.startMinute
    const endMinute = raw.endMinute
    if (typeof weekday !== 'number' || weekday < 0 || weekday > 6 || !Number.isInteger(weekday)) {
      return { ok: false, error: 'WEEKLY_WINDOW rule.weekday must be an integer 0–6 (0=Sunday)' }
    }
    if (typeof startMinute !== 'number' || typeof endMinute !== 'number'
      || startMinute < 0 || endMinute > 1440 || endMinute <= startMinute) {
      return { ok: false, error: 'WEEKLY_WINDOW needs numeric startMinute < endMinute (0–1440)' }
    }
    return {
      ok: true,
      value: { ruleKind: 'WEEKLY_WINDOW', weekday, startMinute, endMinute, validFrom, validUntil },
    }
  }
  return {
    ok: true,
    value: { ruleKind: 'DATE_RANGE', weekday: null, startMinute: null, endMinute: null, validFrom, validUntil },
  }
}

type PrismaRuleCreate = {
  ruleKind: string
  weekday: number | null
  startMinute: number | null
  endMinute: number | null
  validFrom: Date | null | undefined
  validUntil: Date | null | undefined
}

function parseBlackout(raw: { start?: unknown; end?: unknown; reason?: unknown }): { ok: true; value: { start: Date; end: Date; reason: string | null } } | { ok: false; error: string } {
  if (typeof raw.start !== 'string' || typeof raw.end !== 'string') {
    return { ok: false, error: 'blackout needs ISO start and end' }
  }
  const start = new Date(raw.start)
  const end = new Date(raw.end)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return { ok: false, error: 'blackout start must be before end' }
  }
  return { ok: true, value: { start, end, reason: typeof raw.reason === 'string' ? raw.reason : null } }
}

/** D4/D5: lazily lapse unanswered/expired requests (advisory holds die with them). */
async function sweepExpiredBookings(prisma: PrismaClient): Promise<void> {
  const now = new Date()
  await prisma.booking.updateMany({
    where: { status: 'REQUESTED', expiresAt: { lt: now } },
    data: { status: 'LAPSED' },
  }).catch(() => {})
}

async function loadAvailabilityInputs(
  prisma: PrismaClient,
  resourceId: string,
  from: Date,
  to: Date,
): Promise<AvailabilityInputs | null> {
  const resource = await prisma.bookableResource.findUnique({
    where: { id: resourceId },
    include: { rules: true, blackouts: true },
  })
  if (!resource) return null
  const now = new Date()
  const confirmed = await prisma.booking.findMany({
    where: { resourceId, status: 'CONFIRMED', start: { lt: to }, end: { gt: from } },
    select: { start: true, end: true, units: true },
  })
  const holds = await prisma.booking.findMany({
    where: { resourceId, status: 'REQUESTED', holdExpiresAt: { gt: now }, start: { lt: to }, end: { gt: from } },
    select: { start: true, end: true, units: true, holdExpiresAt: true },
  })
  return { resource, rules: resource.rules, blackouts: resource.blackouts, confirmed, holds, now, from, to }
}

/** Structural shape of a resource + rules used by occurrenceCoordFor. */
type OccurrenceResource = {
  kind: string
  ownerPubkey: string
  timezone: string
  bookingStyle?: string | null
  rules: Array<{
    id: string
    ruleKind: string
    weekday: number | null
    startMinute: number | null
    endMinute: number | null
    validFrom: Date | null
    validUntil: Date | null
  }>
}

/**
 * Deterministic occurrence coordinate for a request (see calendar.ts
 * d-convention). FIXED sessions address the occurrence whose start matches the
 * request start; OPEN sessions (ADR-369) address the WEEKLY_WINDOW that
 * CONTAINS the requested block — both resolve to sessionOccurrenceD(ruleId,
 * localDate), so RSVP and countersignature always reference the same event.
 */
export function occurrenceCoordFor(
  resource: OccurrenceResource,
  req: { start: Date; end: Date },
): { kind: 31922 | 31923; pubkey: string; d: string } | null {
  if (resource.kind === 'SPACE') {
    const rule = resource.rules.find(r => r.ruleKind === 'DATE_RANGE'
      && (!r.validFrom || r.validFrom <= req.start)
      && (!r.validUntil || r.validUntil >= req.start))
    if (!rule) return null
    return { kind: 31922, pubkey: resource.ownerPubkey, d: spaceOccurrenceD(rule.id) }
  }
  // Weekday of the resource-LOCAL date string — NOT of the midnight instant:
  // east of UTC the midnight instant lies on the previous UTC day and would
  // yield the wrong weekday (client lib/booking.ts computes it this way too).
  const localDate = utcToZonedDate(req.start, resource.timezone)
  const [y, m, d] = localDate.split('-').map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  // SESSION occurrences start at local midnight + startMinute — re-derive the rule.
  const midnight = zonedDateToUtc(localDate, resource.timezone)
  const offsetStart = Math.round((req.start.getTime() - midnight.getTime()) / 60000)
  const offsetEnd = Math.round((req.end.getTime() - midnight.getTime()) / 60000)
  let rule: OccurrenceResource['rules'][number] | undefined
  if (resource.bookingStyle === 'OPEN') {
    // ADR-369: the request is a sub-interval — address the window that CONTAINS it.
    rule = resource.rules.find(r => r.ruleKind === 'WEEKLY_WINDOW'
      && r.weekday === weekday
      && r.startMinute != null && r.endMinute != null
      && r.startMinute <= offsetStart && offsetEnd <= r.endMinute)
  } else {
    // FIXED: only a request starting exactly at the occurrence start can exist.
    rule = resource.rules.find(r => r.ruleKind === 'WEEKLY_WINDOW'
      && r.weekday === weekday && r.startMinute === offsetStart)
  }
  if (!rule) return null
  return { kind: 31923, pubkey: resource.ownerPubkey, d: sessionOccurrenceD(rule.id, localDate) }
}

export function createBookableResourceRouter(prisma: PrismaClient) {
  const router = Router()

  // ── Resource CRUD ───────────────────────────────────────────────────────────

  router.get('/mine', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
    try {
      const resources = await prisma.bookableResource.findMany({
        where: { ownerPubkey: req.authPubkey! },
        include: { rules: true, blackouts: { orderBy: { start: 'asc' } }, _count: { select: { bookings: true, offers: true } } },
        orderBy: { createdAt: 'desc' },
      })
      res.json({ resources })
    } catch (error) {
      console.error('[resources] GET /mine failed:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to list resources' })
    }
  })

  router.post('/', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
    try {
      const b = req.body as Record<string, unknown>
      const title = typeof b.title === 'string' ? b.title.trim() : ''
      const timezone = typeof b.timezone === 'string' ? b.timezone : ''
      if (title.length < 2) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'title is required' })
        return
      }
      if (!isValidTimezone(timezone)) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'timezone must be a valid IANA identifier' })
        return
      }
      const kind = resourceKindOf(b.kind)
      if (!kind) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'kind must be SPACE or SESSION' })
        return
      }
      const intOrNull = (v: unknown, min: number): number | null | undefined => {
        if (v === undefined) return undefined
        if (v === null) return null
        return typeof v === 'number' && Number.isInteger(v) && v >= min ? v : undefined
      }
      const capacity = intOrNull(b.capacity, 1)
      if (capacity === undefined) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'capacity must be an integer ≥ 1' })
        return
      }
      // ADR-369: SESSION availability style (OPEN = buyer picks start + duration).
      const styleParsed = BookingStyleSchema.safeParse(b.bookingStyle === undefined ? 'FIXED' : b.bookingStyle)
      if (!styleParsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'bookingStyle must be FIXED or OPEN' })
        return
      }
      const bookingStyle = styleParsed.data
      const slotParsed = SlotMinutesSchema.safeParse(b.slotMinutes === undefined ? 60 : b.slotMinutes)
      if (!slotParsed.success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'slotMinutes must be 15, 30 or 60' })
        return
      }
      const slotMinutes = slotParsed.data
      if (bookingStyle === 'OPEN' && kind !== 'SESSION') {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'bookingStyle OPEN requires a SESSION resource' })
        return
      }
      if (bookingStyle === 'OPEN' && capacity !== 1) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'bookingStyle OPEN requires capacity 1 (exclusive time blocks)' })
        return
      }
      const rulesRaw = Array.isArray(b.rules) ? b.rules : []
      const parsedRules: PrismaRuleCreate[] = []
      for (const raw of rulesRaw) {
        const parsed = parseRule(raw as RulePayload)
        if (!parsed.ok) {
          res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error })
          return
        }
        parsedRules.push(parsed.value)
      }
      if (kind === 'SESSION' && !parsedRules.some(r => r.ruleKind === 'WEEKLY_WINDOW')) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'SESSION resources need at least one WEEKLY_WINDOW rule' })
        return
      }
      if (bookingStyle === 'OPEN' && parsedRules.some(r => r.ruleKind === 'WEEKLY_WINDOW'
        && (r.startMinute == null || r.endMinute == null || r.endMinute - r.startMinute < slotMinutes))) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'OPEN windows must be at least slotMinutes long' })
        return
      }
      const blackoutsRaw = Array.isArray(b.blackouts) ? b.blackouts : []
      const parsedBlackouts: { start: Date; end: Date; reason: string | null }[] = []
      for (const raw of blackoutsRaw) {
        const parsed = parseBlackout(raw as { start?: unknown })
        if (!parsed.ok) {
          res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error })
          return
        }
        parsedBlackouts.push(parsed.value)
      }

      const resource = await prisma.bookableResource.create({
        data: {
          ownerPubkey: req.authPubkey!,
          companyId: typeof b.companyId === 'string' ? b.companyId : null,
          kind,
          title,
          description: typeof b.description === 'string' ? b.description : null,
          timezone,
          capacity: capacity ?? undefined,
          bookingStyle,
          slotMinutes,
          minUnits: intOrNull(b.minUnits, 1) ?? undefined,
          maxUnits: intOrNull(b.maxUnits, 1) ?? undefined,
          leadTimeHours: intOrNull(b.leadTimeHours, 0) ?? 0,
          bufferMinutes: intOrNull(b.bufferMinutes, 0) ?? 0,
          country: typeof b.country === 'string' ? b.country : null,
          city: typeof b.city === 'string' ? b.city : null,
          lat: typeof b.lat === 'number' ? b.lat : null,
          lng: typeof b.lng === 'number' ? b.lng : null,
          calendarD: randomUUID(),
          rules: { create: parsedRules },
          blackouts: { create: parsedBlackouts },
        },
        include: { rules: true, blackouts: true },
      })
      res.status(201).json({ resource })
    } catch (error) {
      console.error('[resources] POST failed:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to create resource' })
    }
  })

  router.get('/:id', async (req, res) => {
    try {
      const resource = await prisma.bookableResource.findUnique({
        where: { id: req.params.id },
        include: { rules: true, blackouts: { orderBy: { start: 'asc' } } },
      })
      if (!resource || !resource.isActive) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Resource not found' })
        return
      }
      res.json({ resource })
    } catch (error) {
      console.error('[resources] GET /:id failed:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch resource' })
    }
  })

  router.patch('/:id', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
    try {
      const existing = await prisma.bookableResource.findUnique({
        where: { id: req.params.id },
        include: { rules: true },
      })
      if (!existing) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Resource not found' })
        return
      }
      if (existing.ownerPubkey !== req.authPubkey) {
        res.status(403).json({ error: 'FORBIDDEN', message: 'Only the resource owner may edit it' })
        return
      }
      const b = req.body as Record<string, unknown>
      // Parse ALL payload parts up front — a validation error must not leave a
      // half-applied PATCH (resource updated, rules not).
      const data: Record<string, unknown> = {}
      if (typeof b.title === 'string' && b.title.trim().length >= 2) data.title = b.title.trim()
      if (typeof b.description === 'string' || b.description === null) data.description = b.description
      if (typeof b.timezone === 'string') {
        if (!isValidTimezone(b.timezone)) {
          res.status(400).json({ error: 'VALIDATION_ERROR', message: 'timezone must be a valid IANA identifier' })
          return
        }
        data.timezone = b.timezone
      }
      const intOrNull = (v: unknown, min: number): number | null | undefined => {
        if (v === undefined) return undefined
        if (v === null) return null
        return typeof v === 'number' && Number.isInteger(v) && v >= min ? v : undefined
      }
      for (const field of ['capacity', 'minUnits', 'maxUnits', 'leadTimeHours', 'bufferMinutes'] as const) {
        const v = intOrNull(b[field], field === 'capacity' || field === 'minUnits' || field === 'maxUnits' ? 1 : 0)
        if (v === undefined && b[field] !== undefined) {
          res.status(400).json({ error: 'VALIDATION_ERROR', message: `${field} must be an integer ≥ 1` })
          return
        }
        if (v !== undefined) data[field] = v
      }
      // ADR-369: availability style + start-grid step (OPEN = time blocks).
      if (b.bookingStyle !== undefined) {
        const styleParsed = BookingStyleSchema.safeParse(b.bookingStyle)
        if (!styleParsed.success) {
          res.status(400).json({ error: 'VALIDATION_ERROR', message: 'bookingStyle must be FIXED or OPEN' })
          return
        }
        data.bookingStyle = styleParsed.data
      }
      if (b.slotMinutes !== undefined) {
        const slotParsed = SlotMinutesSchema.safeParse(b.slotMinutes)
        if (!slotParsed.success) {
          res.status(400).json({ error: 'VALIDATION_ERROR', message: 'slotMinutes must be 15, 30 or 60' })
          return
        }
        data.slotMinutes = slotParsed.data
      }
      for (const field of ['country', 'city'] as const) {
        if (typeof b[field] === 'string' || b[field] === null) data[field] = b[field]
      }
      if (typeof b.lat === 'number' || b.lat === null) data.lat = b.lat
      if (typeof b.lng === 'number' || b.lng === null) data.lng = b.lng
      if (typeof b.isActive === 'boolean') data.isActive = b.isActive

      let parsedRules: PrismaRuleCreate[] | null = null
      if (Array.isArray(b.rules)) {
        parsedRules = []
        for (const raw of b.rules) {
          const parsed = parseRule(raw as RulePayload)
          if (!parsed.ok) {
            res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error })
            return
          }
          parsedRules.push(parsed.value)
        }
      }
      let parsedBlackouts: { start: Date; end: Date; reason: string | null }[] | null = null
      if (Array.isArray(b.blackouts)) {
        parsedBlackouts = []
        for (const raw of b.blackouts) {
          const parsed = parseBlackout(raw as { start?: unknown })
          if (!parsed.ok) {
            res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error })
            return
          }
          parsedBlackouts.push(parsed.value)
        }
      }

      // Combined consistency (resulting state, not just the patch): OPEN
      // requires a SESSION resource with capacity 1 and windows ≥ slotMinutes.
      const finalStyle = (data.bookingStyle as 'FIXED' | 'OPEN' | undefined) ?? existing.bookingStyle ?? 'FIXED'
      const finalCapacity = (data.capacity as number | undefined) ?? existing.capacity
      const finalSlotMinutes = (data.slotMinutes as number | undefined) ?? existing.slotMinutes
      const effectiveRules = parsedRules ?? existing.rules
      if (finalStyle === 'OPEN' && existing.kind !== 'SESSION') {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'bookingStyle OPEN requires a SESSION resource' })
        return
      }
      if (finalStyle === 'OPEN' && finalCapacity !== 1) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'bookingStyle OPEN requires capacity 1 (exclusive time blocks)' })
        return
      }
      if (finalStyle === 'OPEN' && effectiveRules.some(r => r.ruleKind === 'WEEKLY_WINDOW'
        && (r.startMinute == null || r.endMinute == null || r.endMinute - r.startMinute < finalSlotMinutes))) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'OPEN windows must be at least slotMinutes long' })
        return
      }

      // Rules/blackouts are replaced wholesale (derivation is stateless, D2) —
      // atomically with the resource update. NOTE: new rule ids mean new
      // deterministic occurrence d-tags; previously published occurrences are
      // not retracted (FU-271-L).
      const resource = await prisma.$transaction(async (tx) => {
        const updated = await tx.bookableResource.update({
          where: { id: existing.id },
          data,
          include: { rules: true, blackouts: true },
        })
        if (parsedRules) {
          await tx.resourceAvailabilityRule.deleteMany({ where: { resourceId: existing.id } })
          await tx.resourceAvailabilityRule.createMany({
            data: parsedRules.map(r => ({ ...r, resourceId: existing.id })),
          })
        }
        if (parsedBlackouts) {
          await tx.resourceBlackout.deleteMany({ where: { resourceId: existing.id } })
          await tx.resourceBlackout.createMany({
            data: parsedBlackouts.map(x => ({ ...x, resourceId: existing.id })),
          })
        }
        return tx.bookableResource.findUnique({
          where: { id: existing.id },
          include: { rules: true, blackouts: { orderBy: { start: 'asc' } } },
        })
      })
      res.json({ resource: resource ?? existing })
    } catch (error) {
      console.error('[resources] PATCH failed:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to update resource' })
    }
  })

  // ── Availability (D2: derived on read) ──────────────────────────────────────

  router.get('/:id/availability', async (req, res) => {
    try {
      const from = req.query.from ? new Date(String(req.query.from)) : new Date()
      const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.now() + 60 * 86400000)
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'from/to must be ISO dates with from < to' })
        return
      }
      const inputs = await loadAvailabilityInputs(prisma, req.params.id, from, to)
      if (!inputs || !inputs.resource.isActive) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Resource not found' })
        return
      }
      await sweepExpiredBookings(prisma)
      const availability = deriveAvailability(inputs)
      res.json(availability)
    } catch (error) {
      console.error('[resources] availability failed:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to derive availability' })
    }
  })

  // ── Booking request (buyer) — creates the advisory hold (D4) ────────────────

  router.post('/:id/bookings', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
    try {
      await sweepExpiredBookings(prisma)
      const b = req.body as Record<string, unknown>
      const start = new Date(String(b.start ?? ''))
      const end = new Date(String(b.end ?? ''))
      const units = typeof b.units === 'number' ? b.units : NaN
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !Number.isInteger(units) || units < 1) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'start/end (ISO) and units (positive int) are required' })
        return
      }
      const resource = await prisma.bookableResource.findUnique({
        where: { id: req.params.id },
        include: { rules: true, blackouts: true },
      })
      if (!resource || !resource.isActive) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Resource not found' })
        return
      }
      if (resource.ownerPubkey === req.authPubkey) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Cannot book your own resource' })
        return
      }

      let offer: Awaited<ReturnType<PrismaClient['offer']['findFirst']>> = null
      if (typeof b.offerId === 'string' && b.offerId) {
        offer = await prisma.offer.findFirst({ where: { id: b.offerId, resourceId: resource.id } })
        if (!offer) {
          res.status(400).json({ error: 'VALIDATION_ERROR', message: 'offerId does not reference this resource' })
          return
        }
      }

      const horizonEnd = new Date(Math.max(end.getTime(), start.getTime()) + 86400000)
      const confirmed = await prisma.booking.findMany({
        where: { resourceId: resource.id, status: 'CONFIRMED', start: { lt: horizonEnd }, end: { gt: start } },
        select: { start: true, end: true, units: true },
      })
      const validation = validateBookingRequest(
        {
          resource,
          rules: resource.rules,
          blackouts: resource.blackouts,
          confirmed,
          now: new Date(),
          from: start,
          to: horizonEnd,
        },
        {
          start,
          end,
          units,
          minUnits: offer?.bookingMinUnits ?? undefined,
          maxUnits: offer?.bookingMaxUnits ?? undefined,
        },
      )
      if (!validation.ok) {
        res.status(409).json({ error: validation.code, message: validation.message })
        return
      }

      // D6: computed before the request is sent. per_hour prices by the
      // covered hours (ceil — a 90-minute session costs 2 hours); every other
      // unit prices by the booked units alone. OPEN time blocks (ADR-369) are
      // whole hours with units == hours, so a single multiply applies.
      const isOpenSession = resource.kind === 'SESSION' && resource.bookingStyle === 'OPEN'
      const hours = offer?.priceUnit === 'per_hour'
        ? Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 3600000))
        : 1
      const priceSats = offer ? offer.priceSats * (isOpenSession ? hours : units * hours) : null
      const now = new Date()
      const holdExpiresAt = new Date(now.getTime() + HOLD_TTL_MINUTES * 60000)
      const windowHours = offer?.confirmationWindowHours ?? DEFAULT_CONFIRMATION_WINDOW_HOURS
      const expiresAt = new Date(Math.min(
        now.getTime() + windowHours * 3600000,
        start.getTime(), // never longer than the time until the booking starts (ADR-272 D2)
      ))

      const booking = await prisma.booking.create({
        data: {
          resourceId: resource.id,
          offerId: offer?.id ?? null,
          buyerPubkey: req.authPubkey!,
          sellerPubkey: resource.ownerPubkey,
          start,
          end,
          units,
          priceSats,
          holdExpiresAt,
          expiresAt,
          note: typeof b.note === 'string' ? b.note.slice(0, 500) : null,
        },
      })

      // RSVP template for the buyer's client to sign + publish (kind 31925).
      const occurrence = occurrenceCoordFor(resource, { start, end })
      const rsvpTemplate = occurrence
        ? {
            kind: 31925,
            content: typeof b.note === 'string' ? b.note.slice(0, 500) : '',
            tags: buildBookingRsvpTags({
              d: randomUUID(),
              occurrence,
              units,
              ...(resource.kind === 'SPACE'
                ? {
                    startDate: utcToZonedDate(start, resource.timezone),
                    endDate: utcToZonedDate(end, resource.timezone),
                  }
                : {}),
              sellerPubkey: resource.ownerPubkey,
              ...(offer ? { offerId: offer.id } : {}),
            }),
            created_at: Math.floor(now.getTime() / 1000),
          }
        : null

      res.status(201).json({ booking, rsvpTemplate })
    } catch (error) {
      console.error('[bookings] POST request failed:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to create booking request' })
    }
  })

  return router
}

function resourceKindOf(v: unknown): 'SPACE' | 'SESSION' | null {
  return v === 'SPACE' || v === 'SESSION' ? v : null
}

export function createBookingRouter(prisma: PrismaClient) {
  const router = Router()

  // ── Queues ──────────────────────────────────────────────────────────────────

  router.get('/incoming', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
    try {
      await sweepExpiredBookings(prisma)
      const bookings = await prisma.booking.findMany({
        where: { sellerPubkey: req.authPubkey!, status: { in: ['REQUESTED', 'CONFIRMED', 'DECLINED', 'CANCELLED', 'LAPSED'] } },
        include: { resource: { select: { id: true, title: true, kind: true, timezone: true } } },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: 200,
      })
      res.json({ bookings })
    } catch (error) {
      console.error('[bookings] GET /incoming failed:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to list incoming bookings' })
    }
  })

  router.get('/mine', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
    try {
      await sweepExpiredBookings(prisma)
      const bookings = await prisma.booking.findMany({
        where: { buyerPubkey: req.authPubkey! },
        include: { resource: { select: { id: true, title: true, kind: true, timezone: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })
      res.json({ bookings })
    } catch (error) {
      console.error('[bookings] GET /mine failed:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to list my bookings' })
    }
  })

  router.get('/:id', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
    try {
      const booking = await prisma.booking.findUnique({
        where: { id: req.params.id },
        include: { resource: { include: { rules: true } } },
      })
      if (!booking || (booking.buyerPubkey !== req.authPubkey && booking.sellerPubkey !== req.authPubkey)) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Booking not found' })
        return
      }
      res.json({ booking })
    } catch (error) {
      console.error('[bookings] GET /:id failed:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to fetch booking' })
    }
  })

  // ── Attach the published RSVP event (buyer, after client-side publish) ───
  //
  // The signed kind 31925 event itself is required — a bare event id cannot
  // be checked: without the event there is no proof that a buyer-signed RSVP
  // for THIS booking exists on Nostr, and the seller's countersignature would
  // e-tag an unverifiable id. Signature, schema, occurrence coordinate,
  // units and interval must all match the booking row.

  router.patch('/:id/request-event', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
    try {
      const { event } = req.body as { event?: unknown }
      if (typeof event !== 'object' || event === null) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'event (signed kind 31925 RSVP) is required' })
        return
      }
      const rsvp = event as Partial<Event>
      if (!verifyEvent(rsvp as Event)) {
        res.status(400).json({ error: 'INVALID_SIGNATURE', message: 'RSVP failed Nostr verification' })
        return
      }
      const booking = await prisma.booking.findUnique({ where: { id: req.params.id } })
      if (!booking || booking.buyerPubkey !== req.authPubkey) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Booking not found' })
        return
      }
      if (booking.status !== 'REQUESTED') {
        res.status(409).json({ error: 'INVALID_STATE', message: `Cannot attach request event in status ${booking.status}` })
        return
      }
      if (rsvp.pubkey !== booking.buyerPubkey || rsvp.kind !== 31925) {
        res.status(400).json({ error: 'INVALID_SIGNATURE', message: 'RSVP must be a kind 31925 signed by the buyer' })
        return
      }
      if (!validateBookingRsvp(rsvp).success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Event does not match the booking-RSVP schema' })
        return
      }
      const parsed = parseBookingRsvp(rsvp.tags as string[][])
      if (!parsed || parsed.status !== 'accepted') {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'RSVP must be parseable with status accepted' })
        return
      }
      const resource = await prisma.bookableResource.findUnique({
        where: { id: booking.resourceId },
        include: { rules: true },
      })
      if (!resource) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Resource not found' })
        return
      }
      const coord = occurrenceCoordFor(resource, { start: booking.start, end: booking.end })
      if (!coord || parsed.occurrenceKind !== coord.kind
        || parsed.occurrencePubkey !== coord.pubkey || parsed.occurrenceD !== coord.d) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'RSVP a-tag must reference the occurrence of this booking' })
        return
      }
      if (parsed.units !== booking.units) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'RSVP units do not match the booking request' })
        return
      }
      if (resource.kind === 'SPACE') {
        const startDate = utcToZonedDate(booking.start, resource.timezone)
        const endDate = utcToZonedDate(booking.end, resource.timezone)
        if (parsed.startDate !== startDate || parsed.endDate !== endDate) {
          res.status(400).json({ error: 'VALIDATION_ERROR', message: 'RSVP start/end dates do not match the booking request' })
          return
        }
      }
      const updated = await prisma.booking.update({
        where: { id: booking.id },
        data: { requestEventId: rsvp.id },
      })
      res.json({ booking: updated })
    } catch (error) {
      console.error('[bookings] PATCH request-event failed:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to attach request event' })
    }
  })

  // ── Countersignature ingest — the ONLY thing that confirms a booking (D3) ───

  router.post('/:id/confirm', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
    try {
      const preBooking = await prisma.booking.findUnique({ where: { id: req.params.id } })
      if (!preBooking || preBooking.sellerPubkey !== req.authPubkey) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Booking not found' })
        return
      }
      if (preBooking.status !== 'REQUESTED') {
        res.status(409).json({ error: 'INVALID_STATE', message: `Cannot confirm a booking in status ${preBooking.status}` })
        return
      }
      const { event } = req.body as { event?: unknown }
      if (typeof event !== 'object' || event === null) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'event (signed countersignature) is required' })
        return
      }
      const signed = event as Partial<Event>
      if (!verifyEvent(signed as Event)) {
        res.status(400).json({ error: 'INVALID_SIGNATURE', message: 'Countersignature failed Nostr verification' })
        return
      }
      if (signed.pubkey !== preBooking.sellerPubkey) {
        res.status(400).json({ error: 'INVALID_SIGNATURE', message: 'Countersignature must be signed by the resource owner' })
        return
      }
      if (!validateBookingConfirmation(signed).success) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Event does not match the booking-confirmation schema' })
        return
      }
      const resource = await prisma.bookableResource.findUnique({
        where: { id: preBooking.resourceId },
        include: { rules: true },
      })
      if (!resource) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Resource not found' })
        return
      }
      const parsed = parseBookingConfirmation(signed.kind!, signed.tags as string[][])
      if (!parsed) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Unparseable booking confirmation' })
        return
      }
      // Event kind must match the resource kind (SPACE → 31922, SESSION → 31923).
      if ((resource.kind === 'SPACE') !== (parsed.kind === 31922)) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: `Countersignature kind ${parsed.kind} does not match a ${resource.kind} resource` })
        return
      }
      // a-tag must address the DETERMINISTIC occurrence coordinate of this
      // booking (cbs-<ruleId>[-<date>]) — not just any event of the owner.
      const expectedCoord = occurrenceCoordFor(resource, { start: preBooking.start, end: preBooking.end })
      if (!expectedCoord || parsed.occurrenceKind !== expectedCoord.kind
        || parsed.occurrencePubkey !== expectedCoord.pubkey || parsed.occurrenceD !== expectedCoord.d) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'a-tag must reference the deterministic occurrence of this booking' })
        return
      }
      if (parsed.buyerPubkey !== preBooking.buyerPubkey) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'p-tag buyer does not match the booking' })
        return
      }
      if (!preBooking.requestEventId || parsed.rsvpEventId !== preBooking.requestEventId) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'e-tag must reference the buyer\'s RSVP event' })
        return
      }
      // Interval match: SPACE dates → instants via the resource timezone; SESSION unix seconds.
      const evStart = parsed.kind === 31922
        ? zonedDateToUtc(parsed.start, resource.timezone)
        : new Date(Number(parsed.start) * 1000)
      const evEnd = parsed.kind === 31922
        ? zonedDateToUtc(parsed.end, resource.timezone)
        : new Date(Number(parsed.end) * 1000)
      if (evStart.getTime() !== preBooking.start.getTime() || evEnd.getTime() !== preBooking.end.getTime() || parsed.units !== preBooking.units) {
        res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Event interval/units do not match the booking request' })
        return
      }

      const eventCreatedAt = new Date(signed.created_at! * 1000)

      // D4 conflict resolution runs in one transaction, serialized per
      // resource via a PG advisory lock, so two concurrent countersignatures
      // cannot both confirm against stale state.
      const outcome = await prisma.$transaction(async (tx) => {
        // $executeRaw: advisory lock returns void, which $queryRaw cannot deserialize.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${preBooking.resourceId}))`
        const booking = await tx.booking.findUnique({ where: { id: preBooking.id } })
        if (!booking || booking.status !== 'REQUESTED') {
          return { raced: true as const }
        }
        const confirmed = await tx.booking.update({
          where: { id: booking.id },
          data: { status: 'CONFIRMED', bookingEventId: signed.id!, eventCreatedAt },
        })

        // D4 + D7 collision rule, capacity-aware. FIXED SESSION occurrences
        // hold `capacity` seats — overlapping confirmed bookings are the NORMAL
        // case there, and only overflow is a conflict (D7: Σ seats ≤ capacity);
        // each booking consumes its `units` seats. SPACE and OPEN time blocks
        // (ADR-369) are exclusive — any overlap conflicts and each consumes one
        // slot regardless of nights/hours. Among candidates (existing
        // overlapping CONFIRMED + this booking), the earliest event created_at
        // wins (ties: lexicographically lowest event id); later ones that no
        // longer fit are cancelled with a full refund owed (ADR-272 D6).
        const effectiveCapacity = resource.kind === 'SESSION' ? resource.capacity : 1
        const exclusiveBlock = resource.kind !== 'SESSION' || resource.bookingStyle === 'OPEN'
        const consumed = (u: number) => exclusiveBlock ? 1 : u
        const overlapping = await tx.booking.findMany({
          where: {
            resourceId: booking.resourceId,
            status: 'CONFIRMED',
            id: { not: booking.id },
            start: { lt: booking.end },
            end: { gt: booking.start },
          },
        })
        const candidates = [
          ...overlapping.map(b => ({ id: b.id, units: b.units, eventCreatedAt: b.eventCreatedAt, bookingEventId: b.bookingEventId, isNew: false })),
          { id: booking.id, units: booking.units, eventCreatedAt, bookingEventId: signed.id!, isNew: true },
        ].sort((a, b) =>
          a.eventCreatedAt!.getTime() - b.eventCreatedAt!.getTime()
          || String(a.bookingEventId).localeCompare(String(b.bookingEventId)))
        let seats = 0
        const losers = candidates.filter(c => {
          if (seats + consumed(c.units) <= effectiveCapacity) {
            seats += consumed(c.units)
            return false
          }
          return true
        })
        const conflicts: Booking[] = []
        let newBookingLost = false
        for (const loser of losers) {
          await tx.booking.update({
            where: { id: loser.id },
            data: { status: 'CANCELLED', note: 'CONFLICT_LOST: overlapping countersigned booking with earlier created_at' },
          })
          if (loser.isNew) {
            newBookingLost = true
          } else {
            const fresh = await tx.booking.findUnique({ where: { id: loser.id } })
            if (fresh) conflicts.push(fresh)
          }
        }
        return { raced: false as const, confirmed, conflicts, newBookingLost }
      })

      if (outcome.raced) {
        res.status(409).json({ error: 'INVALID_STATE', message: 'Booking was modified concurrently — reload and retry' })
        return
      }
      if (outcome.newBookingLost) {
        res.status(409).json({
          error: 'CONFLICT_LOST',
          message: 'An earlier countersigned booking overlaps this interval — this booking is cancelled and the buyer is owed a full refund (ADR-272 D6).',
          booking: { ...outcome.confirmed, status: 'CANCELLED' },
        })
        return
      }
      res.json({ booking: outcome.confirmed, cancelledConflicts: outcome.conflicts })
    } catch (error) {
      console.error('[bookings] POST confirm failed:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to confirm booking' })
    }
  })

  // ── Decline / cancel ────────────────────────────────────────────────────────

  router.post('/:id/decline', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
    try {
      const booking = await prisma.booking.findUnique({ where: { id: req.params.id } })
      if (!booking || booking.sellerPubkey !== req.authPubkey) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Booking not found' })
        return
      }
      if (booking.status !== 'REQUESTED') {
        res.status(409).json({ error: 'INVALID_STATE', message: 'Only REQUESTED bookings can be declined' })
        return
      }
      const updated = await prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'DECLINED' },
      })
      res.json({ booking: updated })
    } catch (error) {
      console.error('[bookings] decline failed:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to decline booking' })
    }
  })

  router.post('/:id/cancel', requireAuth(prisma), async (req: AuthenticatedRequest, res) => {
    try {
      const booking = await prisma.booking.findUnique({ where: { id: req.params.id } })
      if (!booking || (booking.buyerPubkey !== req.authPubkey && booking.sellerPubkey !== req.authPubkey)) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Booking not found' })
        return
      }
      if (booking.status !== 'REQUESTED' && booking.status !== 'CONFIRMED') {
        res.status(409).json({ error: 'INVALID_STATE', message: 'Only REQUESTED or CONFIRMED bookings can be cancelled' })
        return
      }
      const updated = await prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'CANCELLED' },
      })
      // ADR-271 consequence: deleting a CONFIRMED booking means NIP-09 (kind 5)
      // — prompt the seller's client to publish it (ADR-156 idiom).
      res.json({ booking: updated, requiresNip09Deletion: booking.status === 'CONFIRMED', nip09EventIds: booking.bookingEventId ? [booking.bookingEventId] : [] })
    } catch (error) {
      console.error('[bookings] cancel failed:', error)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to cancel booking' })
    }
  })

  return router
}
