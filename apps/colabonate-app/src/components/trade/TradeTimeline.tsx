import { Box, Chip, Typography } from '@mui/material'
import FlagIcon from '@mui/icons-material/Flag'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import VisibilityIcon from '@mui/icons-material/Visibility'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import type { EscrowTradeEvent, EscrowTradeEventKind, EscrowTradeState } from '../../lib/escrow-trade'

/**
 * TradeTimeline — the append-only event log (ADR-362 D2), chronological, the
 * dossier's source of record. Events are never editable; drift entries are
 * emphasised so a reconciliation gap is visible rather than invisible.
 *
 * Each entry now carries three layers so the reader can reconstruct *what
 * happened* (the message), *what state it produced* (a human description), and
 * *when* (relative + absolute) without decoding a bare kind label.
 */

const KIND_META: Record<EscrowTradeEventKind, { label: string; icon: React.ReactElement; color: string; soft: string }> = {
  STATE_TRANSITION: {
    label: 'State change',
    icon: <SwapHorizIcon sx={{ fontSize: 13 }} />,
    color: 'var(--color-status-info)',
    soft: 'rgba(99,179,237,0.14)',
  },
  CANISTER_CALL: {
    label: 'Canister call',
    icon: <FlagIcon sx={{ fontSize: 13 }} />,
    color: 'var(--theme-text-muted)',
    soft: 'rgba(113,128,150,0.14)',
  },
  CHAIN_OBSERVATION: {
    label: 'Chain observation',
    icon: <VisibilityIcon sx={{ fontSize: 13 }} />,
    color: 'var(--color-status-info)',
    soft: 'rgba(99,179,237,0.14)',
  },
  DRIFT_DETECTED: {
    label: 'Drift detected',
    icon: <WarningAmberIcon sx={{ fontSize: 13 }} />,
    color: 'var(--color-status-warning)',
    soft: 'rgba(245,166,35,0.16)',
  },
}

const STATE_DESCRIPTION: Record<EscrowTradeState, string> = {
  PENDING_FUNDING: 'Trade created. Awaiting the buyer deposit to the derived Bitcoin address.',
  FUNDED: 'Funding confirmed on chain. The canister now holds the escrowed amount.',
  RELEASED: 'Milestones released. The seller has been paid out.',
  REFUNDED: 'Timeout refund claimed. The buyer has been refunded.',
  DISPUTED: 'Dispute opened. Funds are frozen until a verdict is reached.',
  DISPUTE_SETTLED: 'Dispute settled. The split payout was signed on chain.',
}

const KIND_DESCRIPTION: Record<EscrowTradeEventKind, string> = {
  STATE_TRANSITION: 'A state transition recorded on the canister.',
  CANISTER_CALL: 'A call was relayed to the canister.',
  CHAIN_OBSERVATION: 'Read from the Bitcoin chain.',
  DRIFT_DETECTED: 'The mirror and the canister disagree. The canister wins.',
}

function eventState(event: EscrowTradeEvent): EscrowTradeState | null {
  const d = event.detail as { state?: unknown } | null | undefined
  if (d && typeof d.state === 'string' && d.state in STATE_DESCRIPTION) return d.state as EscrowTradeState
  return null
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

export function TradeTimeline({ events }: { events: EscrowTradeEvent[] }) {
  if (events.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)' }}>
        No events recorded yet.
      </Typography>
    )
  }

  const ordered = [...events].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {ordered.map((event, i) => {
        const meta = KIND_META[event.kind] ?? KIND_META.CANISTER_CALL
        const state = eventState(event)
        const description = state ? STATE_DESCRIPTION[state] : KIND_DESCRIPTION[event.kind]
        const isLast = i === ordered.length - 1
        const at = new Date(event.createdAt)
        return (
          <Box key={event.id} sx={{ display: 'flex', gap: 1.5, pb: isLast ? 0 : 2.5, position: 'relative' }}>
            {!isLast && (
              <Box
                sx={{
                  position: 'absolute',
                  left: 12,
                  top: 26,
                  bottom: -2,
                  width: 2,
                  borderRadius: 1,
                  bgcolor: 'var(--theme-border)',
                }}
              />
            )}
            {/* node: coloured circle + kind icon */}
            <Box
              sx={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: meta.soft,
                color: meta.color,
                zIndex: 1,
                border: `1px solid ${meta.color}55`,
              }}
            >
              {meta.icon}
            </Box>

            <Box sx={{ minWidth: 0, flex: 1, pt: 0.25 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap', justifyContent: 'space-between' }}>
                <Chip
                  size="small"
                  variant="outlined"
                  label={meta.label}
                  sx={{
                    height: 20,
                    fontSize: '0.62rem',
                    fontWeight: 600,
                    color: meta.color,
                    borderColor: meta.color,
                    '& .MuiChip-label': { px: '6px' },
                  }}
                />
                <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', whiteSpace: 'nowrap' }}>
                  {timeAgo(event.createdAt)} · {at.toLocaleDateString()} {at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Typography>
              </Box>

              {event.message && (
                <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 600, color: 'var(--theme-text)' }}>
                  {event.message}
                </Typography>
              )}

              <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', mt: 0.25, display: 'block', lineHeight: 1.5 }}>
                {description}
              </Typography>

              {state && (
                <Box sx={{ mt: 0.5, display: 'inline-flex', alignItems: 'center', gap: 1, px: 1, py: 0.25, borderRadius: 1, bgcolor: meta.soft }}>
                  <Typography variant="caption" sx={{ color: meta.color, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    {state.replace(/_/g, ' ')}
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
