// ADR-315 D3: small "Verified" chip for agent profiles. Renders nothing when
// the caller passes no isVerified=false (or no agentProfile at all). Used on
// MyAgents rows + BountyDetail applicant rows + (future) search/discovery cards.
import { Chip } from '@mui/material'
import VerifiedIcon from '@mui/icons-material/Verified'
import type { ReactElement } from 'react'

export interface VerifiedAgentBadgeProps {
  isVerified?: boolean | null
  size?: 'small' | 'medium'
  // Optional: a tooltip explaining what the badge means. The default copy
  // matches the D3 spec ("Foundation audit"); callers can override for a
  // page-specific framing (e.g. "Audit verified by the Colabonate Foundation").
  tooltip?: string
  label?: string
  // Visual variant — `chip` (default) renders an MUI Chip; `inline` renders a
  // naked icon + label pair for tight spaces where a Chip would feel heavy.
  variant?: 'chip' | 'inline'
  // Surface role — 'public' (default, neutral text) vs 'owner' (the agent
  // owner sees the badge on their own listing — same look, different tooltip).
  surface?: 'public' | 'owner'
}

const DEFAULT_PUBLIC_TOOLTIP = 'Verified by the Colabonate Foundation — audit-cleared agent profile'
const DEFAULT_OWNER_TOOLTIP = 'Your agent profile is verified by the Colabonate Foundation'

export function VerifiedAgentBadge(props: VerifiedAgentBadgeProps): ReactElement | null {
  if (!props.isVerified) return null
  const size = props.size ?? 'small'
  const tooltip = props.tooltip ?? (props.surface === 'owner' ? DEFAULT_OWNER_TOOLTIP : DEFAULT_PUBLIC_TOOLTIP)
  const label = props.label ?? 'Verified'
  const icon = <VerifiedIcon sx={{ fontSize: size === 'small' ? '0.85rem !important' : '1rem !important' }} />

  if (props.variant === 'inline') {
    return (
      <span
        title={tooltip}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          color: 'var(--identity-peer-color)',
          fontWeight: 600,
          fontSize: size === 'small' ? '0.7rem' : '0.8rem',
        }}
      >
        {icon}
        <span>{label}</span>
      </span>
    )
  }

  return (
    <Chip
      icon={icon}
      label={label}
      size={size}
      title={tooltip}
      sx={{
        height: size === 'small' ? 20 : 24,
        fontSize: size === 'small' ? '0.65rem' : '0.7rem',
        fontWeight: 700,
        bgcolor: 'rgba(42, 232, 102, 0.12)',
        color: 'var(--identity-peer-color)',
        border: '1px solid rgba(42, 232, 102, 0.4)',
        '& .MuiChip-icon': { color: 'var(--identity-peer-color)' },
      }}
    />
  )
}
