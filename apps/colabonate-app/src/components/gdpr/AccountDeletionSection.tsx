/**
 * ADR-156 — Settings "Danger Zone" account-deletion section.
 *
 * Orchestrates the full GDPR Art. 17 flow from the client:
 *   1. GET /api/gdpr/pre-check  → blockers + event ids + summary
 *   2. User confirms by typing the exact phrase
 *   3. publishDeletionRequest(eventIds)  — sign + publish Kind 5 via NIP-07
 *      (client-side; the server never holds the privkey, ADR-141)
 *   4. POST /api/gdpr/delete-account with {kind5EventId, relayResponses}
 *      → server runs the cascade + writes the anonymized audit log
 *   5. Local logout: clear identity/session keys, redirect to /login
 *
 * NIP-09 is best-effort: if signing/publishing fails, deletion still proceeds
 * (the DB cascade is the GDPR-critical part) and the user is informed.
 */

import { useEffect, useState } from 'react'
import {
  Box,
  Paper,
  Typography,
  Button,
  TextField,
  Alert,
  CircularProgress,
} from '@mui/material'
import DeleteForeverIcon from '@mui/icons-material/DeleteForever'
import { apiCall, ApiError } from '../../lib/api'
import { publishDeletionRequest } from '../../lib/nip09'
import type { DeletionPreCheck, DeletionResult } from '../../types/api'
import { DeletionChecklist } from './DeletionChecklist'

const C = {
  surface: 'var(--theme-surface)',
  text: 'var(--theme-text)',
  textMuted: 'var(--theme-text-muted)',
  border: 'var(--theme-border)',
}
const CONFIRMATION_PHRASE = 'DELETE MY ACCOUNT'

/** Wipes all local identity/session keys so the deleted user cannot be reloaded. */
function clearLocalIdentity(): void {
  const keys = [
    'authToken',
    'pubkey',
    'nostr_burner_key',
    'colabonate:dm_relay_list',
    'colabonate:settings:defaultTradeMode',
  ]
  for (const k of keys) {
    try {
      localStorage.removeItem(k)
    } catch {
      /* ignore */
    }
  }
}

export function AccountDeletionSection() {
  const [pre, setPre] = useState<DeletionPreCheck | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<DeletionResult | null>(null)
  const [nip09Note, setNip09Note] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiCall('/api/gdpr/pre-check')
      .then(r => r.json())
      .then((data: DeletionPreCheck) => {
        if (!cancelled) setPre(data)
      })
      .catch(e => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load pre-check')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const canConfirm = pre?.canDelete === true && confirmation === CONFIRMATION_PHRASE && !busy

  async function handleDelete() {
    if (!pre || !canConfirm) return
    setBusy(true)
    setError(null)
    setNip09Note(null)
    try {
      // 1. Sign + publish the NIP-09 Kind 5 client-side (best-effort).
      let nip09: { kind5EventId: string | null; relayResponses: Record<string, { success: boolean; error?: string }>; relaysOk: number } = {
        kind5EventId: null,
        relayResponses: {},
        relaysOk: 0,
      }
      try {
        nip09 = await publishDeletionRequest(pre.eventIds)
      } catch (e) {
        // NIP-09 failure does NOT block the GDPR-critical DB cascade.
        setNip09Note(
          `Nostr deletion request could not be published (${e instanceof Error ? e.message : 'unknown error'}). ` +
            'Your account data will still be deleted from our database; public relays may retain your signed events.',
        )
      }

      // 2. Run the server cascade with the (possibly empty) NIP-09 results.
      const resp = await apiCall('/api/gdpr/delete-account', {
        method: 'POST',
        body: JSON.stringify({
          confirmation: CONFIRMATION_PHRASE,
          kind5EventId: nip09.kind5EventId,
          relayResponses: nip09.relayResponses,
        }),
      })
      const result: DeletionResult = await resp.json()
      setDone(result)

      // 3. Local logout. The server session row is cascade-deleted with the user.
      clearLocalIdentity()
      // Brief delay so the user reads the result screen, then redirect.
      setTimeout(() => {
        window.location.href = '/login'
      }, 4000)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError(
          (e.data?.message as string) ??
            'Deletion blocked — resolve active escrows or open disputes first.',
        )
      } else {
        setError(e instanceof Error ? e.message : 'Deletion failed')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{ mt: 3 }}>
      <Paper
        variant="outlined"
        sx={{
          borderRadius: 2,
          borderColor: 'var(--color-status-error)',
          bgcolor: C.surface,
        }}
      >
        <Box sx={{ px: 2.5, py: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <DeleteForeverIcon sx={{ color: 'var(--color-status-error)' }} />
            <Typography variant="subtitle1" fontWeight={700} sx={{ color: C.text }}>
              Delete Account (GDPR — Right to Erasure)
            </Typography>
          </Box>

          <Alert severity="error" variant="outlined">
            <strong>This action is irreversible.</strong> Your wallet, inbox DMs, sessions, and the
            reviews you wrote are permanently deleted. Public Nostr events you signed are requested for
            deletion via NIP-09, but relays may not honour the request. Two-party trades are preserved
            for the other side with your identity scrubbed.
          </Alert>

          {loading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <CircularProgress size={18} />
              <Typography variant="caption" sx={{ color: C.textMuted }}>
                Checking account state…
              </Typography>
            </Box>
          )}

          {error && (
            <Alert severity="error" variant="outlined" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {nip09Note && (
            <Alert severity="warning" variant="outlined">
              {nip09Note}
            </Alert>
          )}

          {pre && !done && (
            <>
              <DeletionChecklist pre={pre} />

              <TextField
                fullWidth
                size="small"
                label={`Type "${CONFIRMATION_PHRASE}" to confirm`}
                value={confirmation}
                onChange={e => setConfirmation(e.target.value)}
                error={confirmation.length > 0 && confirmation !== CONFIRMATION_PHRASE}
                helperText={
                  confirmation.length > 0 && confirmation !== CONFIRMATION_PHRASE
                    ? 'Phrase does not match'
                    : ''
                }
                sx={{
                  '& .MuiInputLabel-root': { color: C.textMuted },
                  '& .MuiOutlinedInput-input': { color: C.text },
                }}
              />

              <Button
                variant="contained"
                color="error"
                disabled={!canConfirm}
                onClick={handleDelete}
                startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <DeleteForeverIcon />}
              >
                {busy ? 'Deleting…' : 'Delete My Account Permanently'}
              </Button>
            </>
          )}

          {done && (
            <Alert severity="success" variant="outlined">
              Your account has been deleted. An anonymized record (SHA-256 of your pubkey only) is kept
              for the compliance audit log. {done.nip09.kind5EventId ? `NIP-09 request published to ${done.nip09.relaysOk} relay(s). ` : ''}
              Redirecting to login…
            </Alert>
          )}
        </Box>
      </Paper>
    </Box>
  )
}
