// ESCROW-COPY (ADR-397): payment wording here assumes Direct-Pay. On escrow activation follow docs/plans/ESCROW-COPY-REACTIVATION.md.
/**
 * PrivateOfferDetail — Display a decrypted private offer with Accept/Decline/Counter actions.
 *
 * ADR-152: Phase 2.3 — Privat-Offer-Lifecycle.
 * - Accept: creates a Ticket via POST /api/tickets, inherits visibility=PRIVATE
 * - Decline: navigates back (full DM-reply flow is Phase 2.5+)
 * - Counter: opens a counter-proposal modal stub (full DM flow is Phase 2.5+)
 *
 * Props:
 * - message: the DmMessage cache row
 * - payload: parsed PrivateOfferPayload (decrypted rumor content)
 * - onAccepted: optional callback after successful Accept
 * - onClose: optional callback for Decline / Cancel
 */
import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined'
import ReplyOutlinedIcon from '@mui/icons-material/ReplyOutlined'
import CloseIcon from '@mui/icons-material/Close'
import BoltIcon from '@mui/icons-material/Bolt'
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined'
import { apiCall, ApiError } from '../../lib/api'
import { richTextToPlainText } from './'
import { useTranslation } from '../../contexts/LocaleContext'
import type { DmMessage, PrivateOfferPayload } from '../../hooks/useDmMessage'

export interface PrivateOfferDetailProps {
  message: DmMessage
  payload: PrivateOfferPayload | null
  onAccepted?: (ticketId: string) => void
  onClose?: () => void
}

function shortPubkey(pk: string): string {
  if (pk.length <= 12) return pk
  return `${pk.slice(0, 6)}…${pk.slice(-6)}`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function PrivateOfferDetail({ message, payload, onAccepted, onClose }: PrivateOfferDetailProps) {
  const navigate = useNavigate()
  const { formatNumber } = useTranslation()
  const [accepting, setAccepting] = useState(false)
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [counterOpen, setCounterOpen] = useState(false)
  const [counterPrice, setCounterPrice] = useState<string>('')
  const [counterNotes, setCounterNotes] = useState<string>('')
  const [counterSending, setCounterSending] = useState(false)
  const [counterError, setCounterError] = useState<string | null>(null)

  const offerId = payload?.offerId
  const title = payload?.title ?? '(no title)'
  const description = payload?.description
  const descriptionPlain = description ? richTextToPlainText(description) : undefined
  const priceSats = payload?.priceSats ?? 0
  const images = payload?.images ?? []
  const deliveryTimeDays = payload?.deliveryTimeDays
  const deliveryCostSats = payload?.deliveryCostSats
  const deliveryNotes = payload?.deliveryNotes

  const handleAcceptClick = useCallback(() => {
    if (!offerId) {
      setAcceptError('Cannot accept: offer payload is missing the offerId')
      return
    }
    setAcceptError(null)
    setConfirmOpen(true)
  }, [offerId])

  const handleConfirmAccept = useCallback(async () => {
    if (!offerId) return
    setAccepting(true)
    setAcceptError(null)
    try {
      const res = await apiCall('/api/tickets', {
        method: 'POST',
        body: JSON.stringify({
          offerId,
          // Note: server inherits visibility + disputeMode from the parent Offer (ADR-152, Phase 1.2c)
          // So we don't need to pass them — the PRIVATE visibility flows through automatically.
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to accept offer' }))
        throw new ApiError(res.status, err.error ?? 'Failed to accept offer', err)
      }
      const data = await res.json()
      const ticketId: string = data.ticket?.id
      if (!ticketId) {
        throw new Error('Server returned no ticket id')
      }
      setConfirmOpen(false)
      if (onAccepted) {
        onAccepted(ticketId)
      } else {
        navigate(`/tickets/${ticketId}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to accept offer'
      setAcceptError(msg)
    } finally {
      setAccepting(false)
    }
  }, [offerId, onAccepted, navigate])

  const handleDecline = useCallback(() => {
    if (onClose) onClose()
    else navigate(-1)
  }, [onClose, navigate])

  const handleCounterSubmit = useCallback(async () => {
    // Phase 2.5+ will wire this to NIP-17 gift wrap + relay publish.
    // For now, we just close the modal and inform the user.
    setCounterSending(true)
    setCounterError(null)
    try {
      // Placeholder: in a future iteration, this will encrypt via NIP-44,
      // gift-wrap via NIP-59, and POST to /api/nostr/dm/publish-offer.
      await new Promise((resolve) => setTimeout(resolve, 400))
      setCounterOpen(false)
      setCounterPrice('')
      setCounterNotes('')
    } catch (err) {
      setCounterError(err instanceof Error ? err.message : 'Failed to send counter')
    } finally {
      setCounterSending(false)
    }
  }, [])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* ── Encrypted Header Banner ── */}
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          borderRadius: 'var(--radius-md, 8px)',
          borderColor: 'rgba(159,122,234,0.4)',
          bgcolor: 'rgba(159,122,234,0.06)',
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <LockOutlinedIcon sx={{ fontSize: 22, color: '#B794F4' }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" fontWeight={700} sx={{ color: 'var(--theme-text)' }}>
              Encrypted Private Offer
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.5 }}>
              Sent via NIP-17 gift wrap. Only you and the sender can read this message.
            </Typography>
          </Box>
        </Stack>
      </Paper>

      {/* ── Offer Details ── */}
      <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 }, borderRadius: 'var(--radius-lg, 12px)' }}>
        <Stack spacing={2.5}>
          {/* Title */}
          <Box>
            <Typography variant="h6" fontWeight={700} sx={{ color: 'var(--theme-text)' }}>
              {title}
            </Typography>
          </Box>

          {/* Seller + Date */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ color: 'text.secondary' }}>
            <Stack direction="row" alignItems="center" spacing={0.75}>
              <PersonOutlineIcon sx={{ fontSize: 16 }} />
              <Typography variant="caption">
                From <span style={{ fontFamily: 'monospace' }}>{shortPubkey(message.peerPubkey)}</span>
              </Typography>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={0.75}>
              <ScheduleOutlinedIcon sx={{ fontSize: 16 }} />
              <Typography variant="caption">
                Received {formatDate(message.createdAt)}
              </Typography>
            </Stack>
          </Stack>

          {/* Images */}
          {images.length > 0 && (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' },
                gap: 1,
              }}
            >
              {images.map((url, i) => (
                <Box
                  key={`${url}-${i}`}
                  sx={{
                    aspectRatio: '1 / 1',
                    borderRadius: 'var(--radius-sm, 6px)',
                    overflow: 'hidden',
                    bgcolor: 'var(--theme-bg-subtle)',
                  }}
                >
                  <img
                    src={url}
                    alt={`offer-image-${i}`}
                    className="w-full h-full object-cover block"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                </Box>
              ))}
            </Box>
          )}

          {/* Description */}
          {descriptionPlain && (
            <Box>
              <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                Description
              </Typography>
              <Typography variant="body2" sx={{ color: 'var(--theme-text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                {descriptionPlain}
              </Typography>
            </Box>
          )}

          {/* Price + Delivery */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              p: 2,
              borderRadius: 'var(--radius-md, 8px)',
              bgcolor: 'var(--theme-bg-subtle)',
              flexWrap: 'wrap',
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1}>
              <BoltIcon sx={{ fontSize: 22, color: 'primary.main' }} />
              <Typography variant="h6" fontWeight={700} sx={{ color: 'var(--theme-text)' }}>
                {formatNumber(priceSats)} sats
              </Typography>
            </Stack>
            {(deliveryTimeDays || deliveryCostSats) && (
              <Stack direction="row" spacing={2} sx={{ color: 'text.secondary' }}>
                {deliveryTimeDays != null && (
                  <Typography variant="caption">Delivery: {deliveryTimeDays} days</Typography>
                )}
                {deliveryCostSats != null && deliveryCostSats > 0 && (
                  <Typography variant="caption">Shipping: {formatNumber(deliveryCostSats)} sats</Typography>
                )}
              </Stack>
            )}
          </Box>

          {deliveryNotes && (
            <Box>
              <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                Delivery Notes
              </Typography>
              <Typography variant="body2" sx={{ color: 'var(--theme-text-secondary)', lineHeight: 1.5 }}>
                {deliveryNotes}
              </Typography>
            </Box>
          )}
        </Stack>
      </Paper>

      {/* ── Action Buttons ── */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <Button
          variant="contained"
          color="primary"
          size="large"
          startIcon={<CheckCircleOutlineIcon />}
          onClick={handleAcceptClick}
          disabled={!offerId || accepting}
          fullWidth
          sx={{ flex: 1 }}
        >
          Accept Offer
        </Button>
        <Button
          variant="outlined"
          color="primary"
          size="large"
          startIcon={<ReplyOutlinedIcon />}
          onClick={() => setCounterOpen(true)}
          disabled={!offerId}
          fullWidth
          sx={{ flex: 1 }}
        >
          Counter
        </Button>
        <Button
          variant="text"
          color="inherit"
          size="large"
          startIcon={<CancelOutlinedIcon />}
          onClick={handleDecline}
          fullWidth
          sx={{ flex: 1, color: 'text.secondary' }}
        >
          Decline
        </Button>
      </Stack>

      {acceptError && (
        <Alert severity="error" onClose={() => setAcceptError(null)}>
          {acceptError}
        </Alert>
      )}

      {/* ── Accept Confirmation Modal ── */}
      <Dialog open={confirmOpen} onClose={() => !accepting && setConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CheckCircleOutlineIcon color="primary" />
          Accept this private offer?
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2, lineHeight: 1.6 }}>
            Accepting will create a private ticket. A Lightning invoice for{' '}
            <strong>{formatNumber(priceSats)} sats</strong> will be generated, which you pay directly to the
            seller. Colabonate never holds the funds.
          </Typography>
          <Alert severity="info" sx={{ mb: 1 }}>
            <Typography variant="caption" sx={{ lineHeight: 1.5 }}>
              This trade uses <strong>private mode (NIP-17)</strong>: no public listing, no reputation build, and dispute resolution is handled by a mutually-accepted arbiter (or none, if you opt out).
            </Typography>
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} disabled={accepting}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleConfirmAccept}
            disabled={accepting}
            startIcon={accepting ? <CircularProgress size={16} /> : undefined}
          >
            {accepting ? 'Creating ticket…' : 'Yes, accept'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Counter Modal (stub for Phase 2.5+) ── */}
      <Dialog open={counterOpen} onClose={() => !counterSending && setCounterOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ReplyOutlinedIcon color="primary" />
          Send Counter-Offer
          <IconButton
            onClick={() => setCounterOpen(false)}
            sx={{ ml: 'auto' }}
            size="small"
            disabled={counterSending}
            aria-label="close"
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, lineHeight: 1.5 }}>
            Suggest a different price or terms. The seller will receive your counter via encrypted DM.
          </Typography>
          <TextField
            label="Counter Price (Sats)"
            type="number"
            value={counterPrice}
            onChange={(e) => setCounterPrice(e.target.value)}
            placeholder={String(priceSats)}
            fullWidth
            sx={{ mb: 2 }}
            slotProps={{ htmlInput: { min: 1 } }}
          />
          <TextField
            label="Notes (optional)"
            value={counterNotes}
            onChange={(e) => setCounterNotes(e.target.value)}
            placeholder="Explain your counter-offer…"
            multiline
            rows={3}
            fullWidth
          />
          {counterError && (
            <Alert severity="error" sx={{ mt: 2 }}>{counterError}</Alert>
          )}
          <Alert severity="warning" sx={{ mt: 2 }}>
            <Typography variant="caption" sx={{ lineHeight: 1.5 }}>
              Counter-offer DM sending is implemented in <strong>Phase 2.5</strong>. For now, this dialog captures your input but does not transmit it.
            </Typography>
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCounterOpen(false)} disabled={counterSending}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleCounterSubmit}
            disabled={counterSending || !counterPrice}
            startIcon={counterSending ? <CircularProgress size={16} /> : undefined}
          >
            {counterSending ? 'Sending…' : 'Send Counter'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
