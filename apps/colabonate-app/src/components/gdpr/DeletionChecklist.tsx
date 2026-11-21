/**
 * ADR-156 §7 — Pre-Deletion Checklist (presentational).
 *
 * Shows the user, before they confirm, exactly what blocks deletion and what
 * will be anonymized vs. hard-deleted. Pure presentational component — no
 * data fetching, no state beyond props. Token-only colors via the project's
 * MUI + var(--theme-*) pattern (matches Settings.tsx).
 */

import { Box, Paper, Typography, LinearProgress, Chip } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import type { DeletionPreCheck } from '../../types/api'

const C = {
  surface: 'var(--theme-surface)',
  text: 'var(--theme-text)',
  textMuted: 'var(--theme-text-muted)',
  border: 'var(--theme-border)',
}

function ChecklistRow({
  ok,
  label,
  detail,
}: {
  ok: boolean
  label: string
  detail: string
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
      {ok ? (
        <CheckCircleIcon sx={{ fontSize: 18, color: 'var(--color-status-success)', mt: '2px' }} />
      ) : (
        <WarningAmberIcon sx={{ fontSize: 18, color: 'var(--color-status-error)', mt: '2px' }} />
      )}
      <Box>
        <Typography variant="body2" fontWeight={600} sx={{ color: C.text }}>
          {label}
        </Typography>
        <Typography variant="caption" sx={{ color: C.textMuted }}>
          {detail}
        </Typography>
      </Box>
    </Box>
  )
}

export function DeletionChecklist({ pre }: { pre: DeletionPreCheck }) {
  const { blockers, summary } = pre
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <ChecklistRow
          ok={blockers.activeEscrows === 0}
          label="No active escrows"
          detail={
            blockers.activeEscrows === 0
              ? 'No locked hold invoices.'
              : `${blockers.activeEscrows} active escrow(s) — resolve (release/cancel) first.`
          }
        />
        <ChecklistRow
          ok={blockers.openDisputes === 0}
          label="No open disputes"
          detail={
            blockers.openDisputes === 0
              ? 'No pending arbitration.'
              : `${blockers.openDisputes} open dispute(s) — wait for resolution.`
          }
        />
      </Box>

      <Box>
        <Typography variant="caption" fontWeight={600} sx={{ color: C.textMuted, mb: 1, display: 'block' }}>
          What will be affected
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          <Chip size="small" label={`${summary.tickets ?? 0} tickets (anonymized)`} variant="outlined" />
          <Chip size="small" label={`${summary.offers ?? 0} offers (archived)`} variant="outlined" />
          <Chip size="small" label={`${summary.reviews ?? 0} reviews`} variant="outlined" />
          <Chip size="small" label={`${summary.cooperations ?? 0} cooperations`} variant="outlined" />
          <Chip size="small" label={`${summary.dmMessages ?? 0} DMs (deleted)`} variant="outlined" />
          <Chip size="small" label={`${summary.wallets ?? 0} wallet(s)`} variant="outlined" />
          <Chip
            size="small"
            icon={<LockOutlinedIcon sx={{ fontSize: 14 }} />}
            label={`${summary.nostrEvents ?? 0} Nostr events (NIP-09 requested)`}
            variant="outlined"
          />
        </Box>
      </Box>

      <Paper
        variant="outlined"
        sx={{
          p: 1.5,
          borderRadius: 1.5,
          borderColor: 'var(--color-status-warning)',
          bgcolor: 'color-mix(in srgb, var(--color-status-warning) 8%, transparent)',
        }}
      >
        <Typography variant="caption" sx={{ color: C.text }}>
          <strong>Two-party trades are preserved for the other side.</strong> Your counterparty keeps
          their ticket / review history; only your identity is scrubbed to a tombstone. Your own data
          (inbox DMs, wallet, reviews you wrote) is permanently deleted.
        </Typography>
      </Paper>
    </Box>
  )
}

/** Inline busy bar used by the section while the cascade runs. */
export function DeletionProgress({ label }: { label: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <LinearProgress sx={{ flex: 1 }} />
      <Typography variant="caption" sx={{ color: C.textMuted }}>{label}</Typography>
    </Box>
  )
}
