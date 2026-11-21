/**
 * SellBookings — seller-side booking request queue (ADR-271 D4/D5).
 *
 * Accepting a request = countersigning it: the kind 31922/31923 booking event
 * is signed + published HERE with the seller's key (the server only verifies
 * and mirrors — it never signs, D3 invariant). Manual confirmation is the
 * default; instant confirmation would require a NIP-46 delegate (D5).
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Box, Button, Chip, Divider, Typography } from '@mui/material'
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined'
import CloseIcon from '@mui/icons-material/Close'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { SatsAmount } from '../../components/currency/SatsAmount'
import {
  useBookableResource,
  useCancelBooking,
  useConfirmBooking,
  useDeclineBooking,
  useIncomingBookings,
} from '../../hooks/useBookingQueries'
import { formatBookingInterval, publishBookingConfirmation, type BookingDTO } from '../../lib/booking'
import { publishDeletionRequest } from '../../lib/nip09'

const STATUS_COLORS: Record<string, 'warning' | 'success' | 'default' | 'error'> = {
  REQUESTED: 'warning',
  CONFIRMED: 'success',
  DECLINED: 'default',
  CANCELLED: 'error',
  LAPSED: 'default',
}

function BookingRow({ booking }: { booking: BookingDTO }) {
  const resourceQuery = useBookableResource(booking.resourceId)
  const confirmBooking = useConfirmBooking()
  const declineBooking = useDeclineBooking()
  const cancelBooking = useCancelBooking()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const resource = resourceQuery.data?.resource
  const kind = resource?.kind === 'SESSION' ? 'SESSION' : 'SPACE'
  const isOpen = kind === 'SESSION' && resource?.bookingStyle === 'OPEN'
  const tz = resource?.timezone ?? 'UTC'

  const accept = async () => {
    setError('')
    setBusy(true)
    try {
      if (!resource) throw new Error('Resource not loaded yet')
      if (!booking.requestEventId) throw new Error("Buyer's RSVP event is missing — ask them to re-send the request")
      const event = await publishBookingConfirmation({
        booking,
        resource,
        rsvpEventId: booking.requestEventId,
      })
      await confirmBooking.mutateAsync({ bookingId: booking.id, event })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Countersignature failed')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    setError('')
    setBusy(true)
    try {
      const res = await cancelBooking.mutateAsync(booking.id)
      // ADR-271 consequence: a CONFIRMED booking lives on Nostr — cancelling
      // the mirror is not enough. Publish the NIP-09 deletion request (kind 5)
      // client-side; the server never signs (D3). Best-effort: relays decide
      // whether to honour it, and the mirror treats it as authoritative.
      if (res.requiresNip09Deletion && res.nip09EventIds.length > 0) {
        try {
          await publishDeletionRequest(res.nip09EventIds, 'Booking cancelled')
        } catch (delErr) {
          console.warn('[ADR-271] NIP-09 deletion publish failed:', delErr)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{
      p: 2.5,
      borderRadius: 'var(--radius-md, 8px)',
      border: '1px solid var(--theme-border, rgba(0,0,0,0.1))',
      opacity: booking.status === 'REQUESTED' || booking.status === 'CONFIRMED' ? 1 : 0.6,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" fontWeight={700}>
          {booking.resource?.title ?? resource?.title ?? 'Resource'}
        </Typography>
        <Chip size="small" color={STATUS_COLORS[booking.status] ?? 'default'} label={booking.status} />
      </Box>
      <Typography variant="body2" sx={{ mb: 0.5 }}>
        {formatBookingInterval(booking.start, booking.end, kind, tz)}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.6 }}>
        {isOpen
          ? `${booking.units} hour${booking.units === 1 ? '' : 's'}`
          : kind === 'SPACE'
            ? `${booking.units} night${booking.units === 1 ? '' : 's'}`
            : `${booking.units} seat${booking.units === 1 ? '' : 's'}`}
        {' · '}buyer {booking.buyerPubkey.slice(0, 8)}…
        {booking.priceSats != null && (
          <>{' · '}<SatsAmount sats={booking.priceSats} /></>
        )}
      </Typography>
      {booking.note && (
        <Typography variant="caption" sx={{ display: 'block', mt: 1, fontStyle: 'italic' }}>
          “{booking.note}”
        </Typography>
      )}

      {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}

      {booking.status === 'REQUESTED' && (
        <Box sx={{ display: 'flex', gap: 1.5, mt: 2 }}>
          <Button
            variant="contained"
            size="small"
            disabled={busy || !resource || !booking.requestEventId}
            onClick={accept}
            startIcon={<EventAvailableOutlinedIcon sx={{ fontSize: 16 }} />}
          >
            {busy ? 'Countersigning…' : 'Accept & Countersign'}
          </Button>
          <Button
            variant="outlined"
            size="small"
            color="inherit"
            disabled={busy}
            onClick={() => declineBooking.mutate(booking.id)}
            startIcon={<CloseIcon sx={{ fontSize: 16 }} />}
          >
            Decline
          </Button>
          {!booking.requestEventId && (
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
              Waiting for the buyer&apos;s RSVP event…
            </Typography>
          )}
        </Box>
      )}

      {booking.status === 'CONFIRMED' && (
        <Box sx={{ display: 'flex', gap: 1.5, mt: 2, alignItems: 'center' }}>
          <Button
            variant="outlined"
            size="small"
            color="inherit"
            disabled={busy}
            onClick={cancel}
          >
            {busy ? 'Cancelling…' : 'Cancel booking'}
          </Button>
          <Typography variant="caption" color="text.secondary">
            Countersigned — the booking exists on Nostr. Cancelling prompts a NIP-09 deletion.
          </Typography>
        </Box>
      )}
    </Box>
  )
}

export function SellBookings() {
  const navigate = useNavigate()
  const pubkey = localStorage.getItem('pubkey') ?? ''
  const bookingsQuery = useIncomingBookings(pubkey || undefined)
  const bookings = bookingsQuery.data?.bookings ?? []
  const requested = bookings.filter(b => b.status === 'REQUESTED')
  const settled = bookings.filter(b => b.status !== 'REQUESTED')

  if (!pubkey) {
    return (
      <PageContainer size="narrow">
        <PageHeader title="Booking Requests" onBack={() => navigate('/sell')} backLabel="Back" />
        <Alert severity="info">Log in to see your booking requests.</Alert>
      </PageContainer>
    )
  }

  return (
    <PageContainer size="narrow">
      <PageHeader
        title="Booking Requests"
        subtitle="Accepting a request countersigns it with your key — that signature is what makes the booking exist. Declined or unanswered requests expire automatically."
        onBack={() => navigate('/sell')}
        backLabel="Back"
      />

      {bookingsQuery.isLoading && (
        <Typography variant="body2" color="text.secondary">Loading requests…</Typography>
      )}

      {!bookingsQuery.isLoading && requested.length === 0 && settled.length === 0 && (
        <Alert severity="info">
          No booking requests yet. Enable “Bookable” in the offer wizard to sell time-based
          listings — spaces by the night, fixed sessions with seats or open time blocks by the hour.
        </Alert>
      )}

      {requested.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 4 }}>
          {requested.map(b => <BookingRow key={b.id} booking={b} />)}
        </Box>
      )}

      {settled.length > 0 && (
        <>
          <Divider sx={{ mb: 2.5 }}>
            <Typography variant="caption" color="text.secondary">HISTORY</Typography>
          </Divider>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {settled.map(b => <BookingRow key={b.id} booking={b} />)}
          </Box>
        </>
      )}
    </PageContainer>
  )
}
