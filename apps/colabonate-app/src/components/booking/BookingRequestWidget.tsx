/**
 * BookingRequestWidget — buyer-side booking flow for bookable offers (ADR-271,
 * ADR-369).
 *
 * SPACE (DATE_RANGE): pick a check-in/check-out date range; nights = units.
 * SESSION (FIXED, ADR-271): pick an occurrence; seats = units.
 * SESSION (OPEN, ADR-369): the resource is a recurring window — the buyer picks
 * a date, a grid-aligned start time and a whole-hour duration; hours = units.
 * Total = priceSats × hours and is shown BEFORE the request is sent (D6). The
 * request itself is the buyer's kind 31925 RSVP: the server builds the
 * template, this widget signs + publishes it client-side and attaches the event
 * id. The slot shows as "requested" — an advisory hold, never a reservation
 * (D4 copy rule). Confirmation badge per D5: "Instant confirmation" only when
 * the seller connected a NIP-46 delegate (offer.autoConfirm), otherwise the
 * honest "Confirmation within Xh".
 */

import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, Grid, MenuItem, TextField, Tooltip, Typography } from '@mui/material'
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined'
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined'
import { addDays, nightsBetween, utcToZonedDate, zonedDateToUtc } from '@col/nostr-schema'
import { SatsAmount } from '../currency/SatsAmount'
import {
  useAttachRequestEvent,
  useAvailability,
  useBookableResource,
  useRequestBooking,
} from '../../hooks/useBookingQueries'
import { formatBookingInterval, publishBookingRsvpTemplate } from '../../lib/booking'
import type { Offer } from '../../types/api'

const UNIT_LABELS: Record<string, string> = {
  per_night: 'per night',
  per_day: 'per day',
  per_hour: 'per hour',
  per_seat: 'per seat',
  flat: 'flat',
}

function formatOccurrence(startIso: string, endIso: string, timezone: string): string {
  const start = new Date(startIso)
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })
  const endFmt = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' })
  return `${fmt.format(start)} – ${endFmt.format(new Date(endIso))}`
}

/** Resource-local HH:mm of a UTC instant. */
function formatTimeLabel(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' })
    .format(new Date(ms))
}

/** Weekday + day label for a resource-local YYYY-MM-DD date. */
function formatDateLabel(dateIso: string, timezone: string): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d))
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short',
  })
  return fmt.format(at)
}

export function BookingRequestWidget({ offer }: { offer: Offer }) {
  const resourceQuery = useBookableResource(offer.resourceId ?? null)
  const availabilityQuery = useAvailability(offer.resourceId ?? null)
  const requestBooking = useRequestBooking()
  const attachEvent = useAttachRequestEvent()

  const resource = resourceQuery.data?.resource
  const isSession = offer.bookingMode === 'SESSION'
  const timezone = resource?.timezone ?? 'UTC'
  // ADR-369: an OPEN resource is booked as start-time + whole-hour duration.
  const isOpen = isSession && resource?.bookingStyle === 'OPEN'

  const [selectedOccurrence, setSelectedOccurrence] = useState(0)
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [seats, setSeats] = useState(1)
  // OPEN state: resource-local date + UTC start instant + whole hours.
  const [openDate, setOpenDate] = useState<string | null>(null)
  const [openStart, setOpenStart] = useState<number | null>(null)
  const [openHours, setOpenHours] = useState<number | null>(null)
  const [selectionGone, setSelectionGone] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState('')

  const occurrences = useMemo(
    () => (availabilityQuery.data?.slots ?? []).slice(0, 8),
    [availabilityQuery.data],
  )

  const minUnits = offer.bookingMinUnits ?? resource?.minUnits ?? 1
  const maxUnits = offer.bookingMaxUnits ?? resource?.maxUnits ?? 365

  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0

  // ── OPEN free segments (server-derived: window − blackouts − bookings) ─────
  const openSegments = useMemo(() => {
    if (!isOpen) return []
    return (availabilityQuery.data?.slots ?? [])
      .filter(s => s.start && s.end && s.windowStart)
      .map(s => ({
        start: new Date(s.start!),
        end: new Date(s.end!),
        windowStart: new Date(s.windowStart!),
      }))
  }, [isOpen, availabilityQuery.data])

  const openDates = useMemo(() => {
    const byDate = new Map<string, typeof openSegments>()
    for (const seg of openSegments) {
      const date = utcToZonedDate(seg.start, timezone)
      const list = byDate.get(date) ?? []
      list.push(seg)
      byDate.set(date, list)
    }
    return [...byDate.entries()].map(([date, segs]) => ({ date, segs }))
  }, [openSegments, timezone])

  /** Grid-aligned possible start instants for the selected OPEN date. */
  const openStartOptions = useMemo(() => {
    if (!isOpen || !openDate) return []
    const group = openDates.find(g => g.date === openDate)
    if (!group) return []
    const slotMs = (resource?.slotMinutes ?? 60) * 60000
    const minH = Math.max(1, minUnits)
    // Never offer a start that has meanwhile fallen inside the lead-time
    // window (the page may be open for a while; the server re-checks anyway).
    const earliest = Date.now() + (resource?.leadTimeHours ?? 0) * 3600000
    const options: { start: number; end: number }[] = []
    for (const seg of group.segs) {
      const anchor = seg.windowStart.getTime()
      const first = Math.max(seg.start.getTime(), anchor, earliest)
      const gridStart = anchor + Math.ceil((first - anchor) / slotMs) * slotMs
      for (let t = gridStart; t + minH * 3600000 <= seg.end.getTime(); t += slotMs) {
        options.push({ start: t, end: seg.end.getTime() })
      }
    }
    return options
  }, [isOpen, openDate, openDates, minUnits, resource])

  /** Max whole hours bookable from the chosen start (segment end + offer cap). */
  const openMaxHours = useMemo(() => {
    if (openStart == null) return 0
    const seg = openSegments.find(s => s.start.getTime() <= openStart && openStart < s.end.getTime())
    if (!seg) return 0
    const lo = Math.max(1, minUnits)
    return Math.min(Math.floor((seg.end.getTime() - openStart) / 3600000), Math.max(lo, maxUnits))
  }, [openStart, openSegments, minUnits, maxUnits])

  const durationOptions = useMemo(() => {
    const lo = Math.max(1, minUnits)
    const out: number[] = []
    for (let h = lo; h <= openMaxHours; h++) out.push(h)
    return out
  }, [openMaxHours, minUnits])

  // Drop a stale selection when availability refetches and the chosen
  // date/start disappears (just booked / hold expired) — never request blind.
  useEffect(() => {
    if (!isOpen) return
    if (openDate && !openDates.some(g => g.date === openDate)) {
      setOpenDate(null); setOpenStart(null); setOpenHours(null); setSelectionGone(true)
    } else if (openStart != null && !openSegments.some(s => s.start.getTime() <= openStart && openStart < s.end.getTime())) {
      setOpenStart(null); setOpenHours(null); setSelectionGone(true)
    }
  }, [isOpen, openDates, openSegments, openDate, openStart])

  const isFlat = offer.priceUnit === 'flat'
  const hours = useMemo(() => {
    if (isOpen) return openHours ?? 1
    if (offer.priceUnit !== 'per_hour') return 1
    if (isSession) {
      return occurrences[selectedOccurrence]?.start && occurrences[selectedOccurrence]?.end
        ? Math.max(1, Math.ceil((new Date(occurrences[selectedOccurrence]!.end!).getTime()
          - new Date(occurrences[selectedOccurrence]!.start!).getTime()) / 3600000))
        : 1
    }
    return checkIn && checkOut
      ? Math.max(1, Math.ceil((nightsBetween(checkIn, checkOut) * 86400000) / 3600000))
      : 1
  }, [isOpen, openHours, offer.priceUnit, isSession, occurrences, selectedOccurrence, checkIn, checkOut])

  const units = isOpen ? (openHours ?? 0) : (isSession ? seats : nights)
  const totalSats = isFlat ? offer.priceSats
    : isOpen
      ? offer.priceSats * (openHours ?? 0)
      : offer.priceSats * units * hours

  const canRequest = isOpen
    ? openStart != null && openHours != null && openHours >= Math.max(1, minUnits) && openHours <= openMaxHours
    : isSession
      ? Boolean(occurrences[selectedOccurrence]) && seats >= 1
      : nights >= Math.max(1, minUnits)

  // D4 advisory holds: unexpired requests overlapping the current selection.
  // Never blocks — the first CONFIRMED booking wins.
  const pendingHolds = useMemo(() => {
    const holds = availabilityQuery.data?.holds ?? []
    if (!canRequest) return []
    let selStart = 0
    let selEnd = 0
    if (isOpen && openStart != null && openHours != null) {
      selStart = openStart
      selEnd = openStart + openHours * 3600000
    } else if (isSession) {
      selStart = new Date(occurrences[selectedOccurrence]?.start ?? 0).getTime()
      selEnd = new Date(occurrences[selectedOccurrence]?.end ?? 0).getTime()
    } else {
      selStart = checkIn ? zonedDateToUtc(checkIn, timezone).getTime() : 0
      selEnd = checkOut ? zonedDateToUtc(checkOut, timezone).getTime() : 0
    }
    if (!selStart || !selEnd) return []
    return holds.filter(h => {
      const hStart = new Date(h.start).getTime()
      const hEnd = new Date(h.end).getTime()
      return hStart < selEnd && selStart < hEnd
    })
  }, [availabilityQuery.data, canRequest, checkIn, checkOut, isSession, occurrences, selectedOccurrence, timezone, isOpen, openStart, openHours])

  if (!offer.resourceId || !offer.bookingMode) return null

  if (resourceQuery.isLoading || availabilityQuery.isLoading) {
    return (
      <Box sx={{ mb: 2.5, py: 2, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">Loading availability…</Typography>
      </Box>
    )
  }

  if (done) {
    return (
      <Alert severity="success" sx={{ mb: 2.5 }} icon={<EventAvailableOutlinedIcon fontSize="small" />}>
        <Typography variant="body2" fontWeight={700}>Booking requested</Typography>
        <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.6 }}>
          {done} Your request was sent to the seller — the slot is marked as
          {' '}<strong>requested</strong>, not reserved. It becomes binding only with the
          seller&apos;s countersignature{offer.autoConfirm ? ' (auto-confirmed by their delegate).' : '.'}
        </Typography>
      </Alert>
    )
  }

  const submit = async () => {
    setError('')
    try {
      let start = ''
      let end = ''
      if (isOpen) {
        if (openStart == null || openHours == null) return
        start = new Date(openStart).toISOString()
        end = new Date(openStart + openHours * 3600000).toISOString()
      } else if (isSession) {
        const occurrence = occurrences[selectedOccurrence]
        if (!occurrence?.start || !occurrence?.end) return
        start = occurrence.start
        end = occurrence.end
      } else {
        // D8: SPACE intervals start at the resource's LOCAL midnight, never
        // UTC midnight — a UTC-midnight instant shifts the local dates (and the
        // booked nights) by one day for any timezone west of UTC.
        if (!checkIn || !checkOut) return
        start = zonedDateToUtc(checkIn, timezone).toISOString()
        end = zonedDateToUtc(checkOut, timezone).toISOString()
      }
      const res = await requestBooking.mutateAsync({
        resourceId: offer.resourceId!,
        offerId: offer.id,
        start,
        end,
        units: isOpen ? openHours! : units,
      })
      // Sign + publish the kind 31925 RSVP with the buyer's key, then send the
      // signed event so the server can verify it (signature + occurrence
      // linkage) before the seller's countersignature may reference it (D3).
      if (res.rsvpTemplate) {
        try {
          const event = await publishBookingRsvpTemplate(res.rsvpTemplate)
          await attachEvent.mutateAsync({ bookingId: res.booking.id, event })
        } catch (pubErr) {
          console.warn('[ADR-271] RSVP publish failed — request still recorded:', pubErr)
        }
      }
      setDone(formatBookingInterval(start, end, 'SESSION', timezone))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Booking request failed.')
    }
  }

  return (
    <Box sx={{ mb: 2.5 }}>
      {/* D5 badge — honest confirmation promise */}
      <Tooltip title={offer.autoConfirm
        ? 'A seller-connected NIP-46 delegate countersigns matching requests automatically.'
        : `The seller personally confirms requests. Unanswered requests expire after ${offer.confirmationWindowHours ?? 24}h.`}
        arrow>
        <Chip
          size="small"
          color={offer.autoConfirm ? 'success' : 'default'}
          variant={offer.autoConfirm ? 'filled' : 'outlined'}
          icon={<ScheduleOutlinedIcon sx={{ fontSize: 14 }} />}
          label={offer.autoConfirm ? 'Instant confirmation' : `Confirmation within ${offer.confirmationWindowHours ?? 24} h`}
          sx={{ mb: 2 }}
        />
      </Tooltip>

      {isOpen ? (
        <>
          <Typography variant="body2" fontWeight={700} sx={{ mb: 1 }}>
            1. Pick a date
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 2 }}>
            {openDates.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                No upcoming windows — check back later
              </Typography>
            ) : openDates.map(g => (
              <Button
                key={g.date}
                size="small"
                variant={openDate === g.date ? 'contained' : 'outlined'}
                color={openDate === g.date ? 'primary' : 'inherit'}
                onClick={() => {
                  setOpenDate(g.date)
                  setOpenStart(null)
                  setOpenHours(null)
                  setSelectionGone(false)
                }}
                sx={{ minWidth: 0, px: 1.25, py: 0.5, fontSize: '0.72rem', fontWeight: 600, lineHeight: 1.3, borderRadius: 'var(--radius-sm, 6px)' }}
              >
                {formatDateLabel(g.date, timezone)}
              </Button>
            ))}
          </Box>

          {openDate && (
            <>
              <Typography variant="body2" fontWeight={700} sx={{ mb: 1 }}>
                2. Start time {timezone !== 'UTC' && `(${timezone})`}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 2 }}>
                {openStartOptions.length === 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    No free start times left that day — pick another date
                  </Typography>
                ) : openStartOptions.map(opt => {
                  const active = openStart === opt.start
                  return (
                    <Button
                      key={opt.start}
                      size="small"
                      variant={active ? 'contained' : 'outlined'}
                      color={active ? 'primary' : 'inherit'}
                      onClick={() => {
                        setOpenStart(opt.start)
                        setOpenHours(null)
                        setSelectionGone(false)
                      }}
                      sx={{ minWidth: 0, px: 1.25, py: 0.5, fontSize: '0.72rem', fontWeight: 600, lineHeight: 1.3, borderRadius: 'var(--radius-sm, 6px)', fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatTimeLabel(opt.start, timezone)}
                    </Button>
                  )
                })}
              </Box>
            </>
          )}

          {openStart != null && (
            <>
              <Typography variant="body2" fontWeight={700} sx={{ mb: 1 }}>
                3. Duration
              </Typography>
              <TextField
                select
                label="Hours"
                value={openHours == null ? '' : String(openHours)}
                onChange={(e) => {
                  setOpenHours(e.target.value ? Number(e.target.value) : null)
                  setSelectionGone(false)
                }}
                fullWidth
                helperText={durationOptions.length === 0 ? 'Nothing bookable from this start — pick an earlier time' : `Whole hours until ${formatTimeLabel(openStart + openMaxHours * 3600000, timezone)}`}
                sx={{ mb: 1 }}
              >
                {durationOptions.map(h => (
                  <MenuItem key={h} value={String(h)}>{h} hour{h === 1 ? '' : 's'}</MenuItem>
                ))}
              </TextField>
            </>
          )}

          {selectionGone && (
            <Typography variant="caption" color="warning.main" sx={{ display: 'block', mb: 1, lineHeight: 1.6 }}>
              That slot was just booked — pick another date or time.
            </Typography>
          )}
        </>
      ) : isSession ? (
        <>
          <TextField
            select
            label="Choose a date"
            value={occurrences.length > 0 ? String(selectedOccurrence) : ''}
            onChange={(e) => setSelectedOccurrence(Number(e.target.value))}
            fullWidth
            disabled={occurrences.length === 0}
            helperText={occurrences.length === 0 ? 'No upcoming dates — check back later' : `Times shown in the resource timezone (${timezone})`}
            sx={{ mb: 2 }}
          >
            {occurrences.map((occ, i) => (
              <MenuItem key={occ.start} value={i}>
                {formatOccurrence(occ.start!, occ.end!, timezone)} — {occ.seatsLeft ?? 0} seat{(occ.seatsLeft ?? 0) === 1 ? '' : 's'} left
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Seats"
            type="number"
            value={seats}
            onChange={(e) => setSeats(Math.max(1, parseInt(e.target.value, 10) || 1))}
            fullWidth
            inputProps={{ min: Math.max(1, minUnits), max: Math.min(maxUnits, occurrences[selectedOccurrence]?.seatsLeft ?? maxUnits) }}
            helperText={`${minUnits}–${Math.min(maxUnits, occurrences[selectedOccurrence]?.seatsLeft ?? maxUnits)} seats`}
            sx={{ mb: 1 }}
          />
        </>
      ) : (
        <>
          <Grid container spacing={2} sx={{ mb: 1 }}>
            <Grid size={{ xs: 6 }}>
              <TextField
                label="Check-in"
                type="date"
                value={checkIn}
                onChange={(e) => { setCheckIn(e.target.value); setCheckOut('') }}
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <TextField
                label="Check-out"
                type="date"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
                fullWidth
                error={Boolean(checkIn && checkOut && nights < Math.max(1, minUnits))}
                helperText={nights > 0 ? `${nights} night${nights === 1 ? '' : 's'}` : `Min ${minUnits} night${minUnits === 1 ? '' : 's'}`}
                slotProps={{ inputLabel: { shrink: true } }}
                inputProps={{ min: checkIn ? addDays(checkIn, Math.max(1, minUnits)) : undefined }}
              />
            </Grid>
          </Grid>
        </>
      )}

      {/* Total — computed and displayed BEFORE the request is sent (D6) */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: pendingHolds.length > 0 ? 1 : 2 }}>
        <Typography variant="body2" color="text.secondary">
          {canRequest
            ? `Total (${units} × ${UNIT_LABELS[offer.priceUnit ?? ''] ?? offer.priceUnit}${hours > 1 && !isOpen ? `, ${hours} h` : ''})`
            : isOpen && openStart == null
              ? 'Pick a date and time to see the total'
              : 'Rate'}
        </Typography>
        <Typography variant="h6" fontWeight={700}>
          <SatsAmount sats={canRequest ? totalSats : offer.priceSats} />
        </Typography>
      </Box>

      {pendingHolds.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2, lineHeight: 1.6 }}>
          {pendingHolds.length} pending request{pendingHolds.length === 1 ? '' : 's'} for this window —
          {' '}advisory only, the first confirmed booking wins.
        </Typography>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Button
        fullWidth
        variant="contained"
        size="large"
        disabled={!canRequest || requestBooking.isPending}
        onClick={submit}
        sx={{ py: 1.5, fontSize: '1rem', fontWeight: 700 }}
      >
        {requestBooking.isPending ? 'Sending request…' : isOpen ? 'Request this time' : 'Request Booking'}
      </Button>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, lineHeight: 1.6 }}>
        No payment yet — you pay only after the seller confirms the booking.
      </Typography>
    </Box>
  )
}
