/**
 * NominateArbiterModal — Capture an npub to nominate as the mutual arbiter.
 *
 * ADR-152 §A4 / PROB-002 A2: Phase 2.7 — Mutual-Arbiter UI.
 * Validates a 64-char lowercase hex pubkey, surfaces the server error, and
 * passes the value to `onSubmit` (which the parent wires to the
 * `useNominateArbiter` mutation).
 *
 * UX notes:
 *  - The modal is intentionally simple. The explanatory text is on the
 *    parent `MutualArbiterPanel` so the modal stays focused on input.
 *  - We do NOT auto-resolve npub → display name (L2 identity lookup is
 *    a Phase 4 feature). The user sees a truncated pubkey only.
 */

import { useState, useCallback, useMemo } from 'react'
import {
  Alert,
  Box,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import GavelIcon from '@mui/icons-material/Gavel'
import {
  Modal,
  ModalHeader,
  ModalContent,
  ModalActions,
} from '@ds/ui'

export interface NominateArbiterModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (arbiterPubkey: string) => Promise<void>
  /** Existing nomination to show as a hint (e.g. "The other party nominated …") */
  existingArbiterPubkey?: string
  submitting?: boolean
  errorMessage?: string | null
  /** ADR-162 / NIP-51: the user's trusted-arbiter follow-set, offered as a
   *  quick-pick above the manual input. */
  trustedArbiters?: string[]
}

const HEX64 = /^[0-9a-f]{64}$/

function shortPubkey(pk: string): string {
  if (pk.length <= 12) return pk
  return `${pk.slice(0, 6)}…${pk.slice(-6)}`
}

export function NominateArbiterModal({
  open,
  onClose,
  onSubmit,
  existingArbiterPubkey,
  submitting = false,
  errorMessage = null,
  trustedArbiters = [],
}: NominateArbiterModalProps) {
  const [value, setValue] = useState('')
  const [touched, setTouched] = useState(false)

  const isValid = useMemo(() => HEX64.test(value.trim().toLowerCase()), [value])
  const showError = touched && value.length > 0 && !isValid

  const handleClose = useCallback(() => {
    if (submitting) return
    setValue('')
    setTouched(false)
    onClose()
  }, [submitting, onClose])

  const handleSubmit = useCallback(async () => {
    if (!isValid) return
    try {
      await onSubmit(value.trim().toLowerCase())
      setValue('')
      setTouched(false)
    } catch {
      // error displayed via `errorMessage` prop, don't reset
    }
  }, [isValid, onSubmit, value])

  return (
    <Modal open={open} onClose={handleClose} size="sm">
      <ModalHeader
        title={
          <Stack direction="row" alignItems="center" spacing={1}>
            <GavelIcon color="primary" />
            <Typography variant="h6" fontWeight={700}>
              Nominate Mutual Arbiter
            </Typography>
          </Stack>
        }
        onClose={handleClose}
        hideCloseButton={submitting}
      />
      <ModalContent>
        <Stack spacing={2}>
          <Alert severity="info" icon={false}>
            <Typography variant="body2">
              Both you and the other party must nominate the <strong>same</strong> npub
              before that person can accept the role. Choose someone both sides trust.
            </Typography>
          </Alert>

          {existingArbiterPubkey && (
            <Alert severity="warning" icon={false}>
              <Typography variant="body2">
                The other party nominated{' '}
                <code style={{ fontFamily: 'monospace' }}>
                  {shortPubkey(existingArbiterPubkey)}
                </code>
                . Nominate the <strong>same</strong> npub to proceed, or a different
                one to start a new round.
              </Typography>
            </Alert>
          )}

          {trustedArbiters.length > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                From your trusted-arbiter list (NIP-51)
              </Typography>
              <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
                {trustedArbiters.map((pk) => (
                  <Chip
                    key={pk}
                    size="small"
                    variant={value.trim().toLowerCase() === pk ? 'filled' : 'outlined'}
                    color={value.trim().toLowerCase() === pk ? 'primary' : 'default'}
                    label={shortPubkey(pk)}
                    onClick={() => !submitting && setValue(pk)}
                    disabled={submitting}
                  />
                ))}
              </Stack>
            </Box>
          )}

          <TextField
            label="Arbiter npub (64-char hex pubkey)"
            placeholder="e.g. 3bf0c63fcb93463407af2cb1a9f7b32e4d4c83a9a96fd95ea48d8b0a1f8e4e7d"
            value={value}
            onChange={(e) => setValue(e.target.value.trim())}
            onBlur={() => setTouched(true)}
            fullWidth
            autoFocus
            error={showError}
            helperText={
              showError
                ? 'Must be a 64-character lowercase hex pubkey (no npub1… bech32 prefix).'
                : 'Paste the full 64-character hex pubkey of the person you both trust.'
            }
            disabled={submitting}
            inputProps={{
              'aria-label': 'Arbiter hex pubkey',
              'data-testid': 'arbiter-pubkey-input',
              spellCheck: false,
            }}
          />

          {errorMessage && (
            <Alert severity="error" onClose={() => undefined}>
              {errorMessage}
            </Alert>
          )}

          <Box
            sx={{
              p: 1.5,
              borderRadius: 'var(--radius-sm, 6px)',
              bgcolor: 'var(--theme-bg-subtle, rgba(0,0,0,0.04))',
            }}
          >
            <Typography variant="caption" color="text.secondary">
              <strong>Tip:</strong> Ask the other party out-of-band (chat, voice, …)
              to agree on an npub <em>before</em> you nominate — otherwise you'll
              need to start over if you choose different people.
            </Typography>
          </Box>
        </Stack>
      </ModalContent>
      <ModalActions
        align="space-between"
        cancel={{
          onClick: handleClose,
          children: 'Cancel',
          disabled: submitting,
        }}
        confirm={{
          onClick: handleSubmit,
          children: submitting ? 'Submitting…' : 'Nominate',
          color: 'primary',
          disabled: !isValid || submitting,
          loading: submitting,
        }}
      />
    </Modal>
  )
}
