/**
 * PrivateVerdictCard — Verdict-submission UI for the mutual arbiter.
 *
 * ADR-152 §A4 / PROB-002 A2: Phase 2.8 — Private-Verdict (NIP-17-DM-signed).
 *
 * Shown only to the nominated+accepted arbiter when a private-mode ticket
 * is in DISPUTED status. Two outcome buttons:
 *
 *  - Release to seller — settles all hold invoices, marks ticket COMPLETED
 *  - Cancel & refund — cancels all hold invoices, marks ticket CANCELLED
 *
 * The arbiter may provide optional free-text reasoning that gets stored
 * on the PrivateArbiter.verdictReasoning column and surfaced to the
 * buyer + seller via DmMessage inbox rows.
 *
 * On submit:
 *  1. Client signs a Kind 30022 event with the arbiter's privkey via
 *     `signVerdictIntent` (proves ownership)
 *  2. Server verifies the Schnorr signature via `verifyEvent`
 *  3. Server applies the verdict: escrow settlement + status updates
 *  4. Server writes DmMessage inbox rows for buyer + seller
 *
 * UX considerations:
 *  - Confirmation dialog before each verdict (irreversible action)
 *  - Loading state during sign + POST
 *  - Inline error display for server rejections (e.g. signature failure)
 *  - Reason text is optional but encouraged — surfaces in buyer/seller
 *    inbox + email notifications
 */

import { useState, useCallback } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import GavelIcon from '@mui/icons-material/Gavel'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import {
  useArbiterVerdict,
  type PrivateVerdictOutcome,
} from '../../hooks/useArbiterVerdict'

export interface PrivateVerdictCardProps {
  ticketId: string
  arbiterPubkey: string
  ticketTitle?: string
  onResolved?: (outcome: PrivateVerdictOutcome) => void
}

function shortPubkey(pk: string): string {
  if (pk.length <= 12) return pk
  return `${pk.slice(0, 6)}…${pk.slice(-6)}`
}

export function PrivateVerdictCard({
  ticketId,
  arbiterPubkey,
  ticketTitle,
  onResolved,
}: PrivateVerdictCardProps) {
  const submit = useArbiterVerdict()
  const [confirmOpen, setConfirmOpen] = useState<PrivateVerdictOutcome | null>(null)
  const [reasoning, setReasoning] = useState('')
  const [showReason, setShowReason] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleOpenConfirm = useCallback((outcome: PrivateVerdictOutcome) => {
    setErrorMessage(null)
    setConfirmOpen(outcome)
  }, [])

  const handleCloseConfirm = useCallback(() => {
    if (submit.isPending) return
    setConfirmOpen(null)
  }, [submit.isPending])

  const handleSubmit = useCallback(async () => {
    if (!confirmOpen) return
    setErrorMessage(null)
    try {
      const result = await submit.mutateAsync({
        ticketId,
        arbiterPubkey,
        outcome: confirmOpen,
        reasoning: reasoning.trim() || undefined,
      })
      setConfirmOpen(null)
      setReasoning('')
      setShowReason(false)
      if (onResolved) {
        onResolved(result.verdict.outcome)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to submit verdict'
      setErrorMessage(msg)
    }
  }, [confirmOpen, submit, ticketId, arbiterPubkey, reasoning, onResolved])

  const outcomeLabel = confirmOpen === 'RELEASE' ? 'Release to seller' : 'Cancel & refund'
  const isRelease = confirmOpen === 'RELEASE'

  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 2, sm: 2.5 },
        borderRadius: 'var(--radius-lg, 12px)',
        borderColor: isRelease ? 'rgba(72,187,120,0.4)' : 'rgba(245,101,101,0.4)',
        bgcolor: isRelease ? 'rgba(72,187,120,0.04)' : 'rgba(245,101,101,0.04)',
      }}
      data-testid="private-verdict-card"
    >
      <Stack spacing={2}>
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <GavelIcon sx={{ color: isRelease ? 'var(--color-status-success, #48BB78)' : '#E53E3E' }} />
          <Typography variant="subtitle1" fontWeight={700} sx={{ color: 'var(--theme-text)' }}>
            Issue Private Verdict
          </Typography>
          <Box sx={{ ml: 'auto' }}>
            <Chip
              icon={<LockOutlinedIcon sx={{ fontSize: 14 }} />}
              label="SIGNED"
              size="small"
              sx={{
                bgcolor: 'rgba(159,122,234,0.10)',
                color: '#6B46C1',
                fontSize: '0.65rem',
                fontWeight: 700,
                letterSpacing: '0.08em',
                height: 20,
                '& .MuiChip-icon': { color: '#6B46C1' },
              }}
            />
          </Box>
        </Stack>

        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.55 }}>
          You were mutually accepted as the arbiter for this private trade. Your
          decision is final and will be cryptographically signed (Nostr Kind
          30022) and broadcast to both parties via DM.
        </Typography>

        {ticketTitle && (
          <Box
            sx={{
              p: 1.5,
              borderRadius: 'var(--radius-sm, 6px)',
              bgcolor: 'var(--theme-bg-subtle, rgba(0,0,0,0.04))',
            }}
          >
            <Typography variant="caption" color="text.secondary" display="block">
              Ticket
            </Typography>
            <Typography variant="body2" fontWeight={600}>
              {ticketTitle}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontFamily: 'monospace', mt: 0.5, display: 'block' }}
            >
              #{ticketId.slice(0, 12)}… · arbiter {shortPubkey(arbiterPubkey)}
            </Typography>
          </Box>
        )}

        {errorMessage && (
          <Alert severity="error" onClose={() => setErrorMessage(null)}>
            {errorMessage}
          </Alert>
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <Button
            fullWidth
            variant="contained"
            color="success"
            size="large"
            startIcon={<CheckCircleOutlineIcon />}
            onClick={() => handleOpenConfirm('RELEASE')}
            disabled={submit.isPending}
            data-testid="verdict-release-button"
            sx={{ textTransform: 'none', fontWeight: 600, py: 1.25 }}
          >
            Release to seller
          </Button>
          <Button
            fullWidth
            variant="outlined"
            color="error"
            size="large"
            startIcon={<CancelOutlinedIcon />}
            onClick={() => handleOpenConfirm('CANCEL')}
            disabled={submit.isPending}
            data-testid="verdict-cancel-button"
            sx={{ textTransform: 'none', fontWeight: 600, py: 1.25 }}
          >
            Cancel &amp; refund
          </Button>
        </Stack>

        <Stack direction="row" alignItems="center" spacing={0.5}>
          <Tooltip
            title="The verdict is a single on-chain escrow event per ticket. Once issued, it cannot be reversed. Both parties will be notified via DM."
            arrow
          >
            <HelpOutlineIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
          </Tooltip>
          <Typography variant="caption" color="text.secondary">
            Why two options?{' '}
            <strong>Release</strong> settles the hold invoices and pays the
            seller; <strong>Cancel</strong> refunds the buyer&apos;s hold
            invoices. The reasoning you provide is included in the inbox
            notification.
          </Typography>
        </Stack>
      </Stack>

      <Dialog
        open={confirmOpen !== null}
        onClose={handleCloseConfirm}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {isRelease ? (
            <CheckCircleOutlineIcon color="success" />
          ) : (
            <CancelOutlinedIcon color="error" />
          )}
          Confirm: {outcomeLabel}?
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity={isRelease ? 'success' : 'warning'} icon={false}>
              <Typography variant="body2">
                This will <strong>{isRelease ? 'settle' : 'cancel'}</strong> all
                active hold invoices on this ticket and mark the ticket{' '}
                <strong>{isRelease ? 'COMPLETED' : 'CANCELLED'}</strong>. Both
                parties will be notified via DM.
              </Typography>
            </Alert>

            {!showReason ? (
              <Button
                size="small"
                variant="text"
                onClick={() => setShowReason(true)}
                sx={{ alignSelf: 'flex-start' }}
              >
                + Add reasoning (optional, visible to both parties)
              </Button>
            ) : (
              <TextField
                label="Reasoning (optional)"
                placeholder={
                  isRelease
                    ? 'e.g. "Goods delivered as described, no issues."'
                    : 'e.g. "Seller did not deliver within the agreed window."'
                }
                multiline
                rows={3}
                value={reasoning}
                onChange={(e) => setReasoning(e.target.value)}
                fullWidth
                disabled={submit.isPending}
                inputProps={{ 'data-testid': 'verdict-reasoning' }}
              />
            )}

            {errorMessage && (
              <Alert severity="error" onClose={() => setErrorMessage(null)}>
                {errorMessage}
              </Alert>
            )}

            <Typography variant="caption" color="text.secondary">
              Your verdict will be signed with a Nostr Kind 30022 event. The
              signature is verified server-side before any escrow action runs.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleCloseConfirm} disabled={submit.isPending}>
            Back
          </Button>
          <Button
            variant="contained"
            color={isRelease ? 'success' : 'error'}
            onClick={handleSubmit}
            disabled={submit.isPending}
            startIcon={submit.isPending ? <CircularProgress size={16} /> : undefined}
            data-testid="verdict-confirm-button"
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            {submit.isPending ? 'Signing + submitting…' : `Yes, ${outcomeLabel.toLowerCase()}`}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  )
}
