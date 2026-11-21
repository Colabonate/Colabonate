import { Chip } from '@mui/material'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ReplayIcon from '@mui/icons-material/Replay'
import GavelIcon from '@mui/icons-material/Gavel'
import type { EscrowTradeState } from '../../lib/escrow-trade'

/**
 * TradeStateBadge — the canister state as icon + label + colour, never colour
 * alone (ADR-355 D3). Every badge carries a provenance marker next to it (the
 * caller renders a ProvenanceChip), so the state and its source stay distinct.
 */

const META: Record<EscrowTradeState, { label: string; icon: React.ReactElement; color: string; bg: string; border: string }> = {
  PENDING_FUNDING: {
    label: 'Awaiting funding',
    icon: <HourglassEmptyIcon sx={{ fontSize: 14 }} />,
    color: 'var(--color-status-info)',
    bg: 'var(--color-status-info-bg)',
    border: 'var(--color-status-info)',
  },
  FUNDED: {
    label: 'Funded',
    icon: <AccountBalanceWalletIcon sx={{ fontSize: 14 }} />,
    color: 'var(--color-status-info)',
    bg: 'var(--color-status-info-bg)',
    border: 'var(--color-status-info)',
  },
  RELEASED: {
    label: 'Released',
    icon: <CheckCircleIcon sx={{ fontSize: 14 }} />,
    color: 'var(--color-status-success)',
    bg: 'var(--color-status-success-bg)',
    border: 'var(--color-status-success)',
  },
  REFUNDED: {
    label: 'Refunded',
    icon: <ReplayIcon sx={{ fontSize: 14 }} />,
    color: 'var(--theme-text-muted)',
    bg: 'var(--theme-bg-subtle)',
    border: 'var(--theme-border)',
  },
  DISPUTED: {
    label: 'Disputed',
    icon: <GavelIcon sx={{ fontSize: 14 }} />,
    color: 'var(--color-status-warning)',
    bg: 'var(--theme-bg-subtle)',
    border: 'var(--color-status-warning)',
  },
  DISPUTE_SETTLED: {
    label: 'Dispute settled',
    icon: <CheckCircleIcon sx={{ fontSize: 14 }} />,
    color: 'var(--color-status-success)',
    bg: 'var(--color-status-success-bg)',
    border: 'var(--color-status-success)',
  },
}

export function TradeStateBadge({ state }: { state: EscrowTradeState }) {
  const meta = META[state] ?? META.PENDING_FUNDING
  return (
    <Chip
      size="small"
      variant="outlined"
      icon={meta.icon}
      label={meta.label}
      sx={{
        height: 24,
        fontSize: '0.72rem',
        color: meta.color,
        borderColor: meta.border,
        bgcolor: meta.bg,
        '& .MuiChip-icon': { color: meta.color, marginLeft: '6px' },
        '& .MuiChip-label': { paddingLeft: '4px', paddingRight: '10px' },
      }}
    />
  )
}
