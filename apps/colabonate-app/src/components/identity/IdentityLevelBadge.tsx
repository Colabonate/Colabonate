import { Chip } from '@mui/material'
import PersonIcon from '@mui/icons-material/Person'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser'
import ShieldIcon from '@mui/icons-material/Shield'
import type { IdentityLevel } from '../../types/identity'

interface IdentityLevelBadgeProps {
  level: IdentityLevel
  showLabel?: boolean
  size?: 'small' | 'medium'
}

const LEVEL_CONFIG = {
  0: { label: 'Anonymous',    color: 'var(--identity-anonymous-color)', bgColor: 'var(--identity-anonymous-bg)', borderColor: 'var(--identity-anonymous-border)', Icon: PersonIcon },
  1: { label: 'Nostr Profile', color: 'var(--identity-nostr-color)',     bgColor: 'var(--identity-nostr-bg)',     borderColor: 'var(--identity-nostr-border)',     Icon: AccountCircleIcon },
  2: { label: 'Peer Verified', color: 'var(--identity-peer-color)',      bgColor: 'var(--identity-peer-bg)',      borderColor: 'var(--identity-peer-border)',      Icon: VerifiedUserIcon },
  3: { label: 'HID Verified',  color: 'var(--identity-hid-color)',       bgColor: 'var(--identity-hid-bg)',       borderColor: 'var(--identity-hid-border)',       Icon: ShieldIcon },
} as const

export function IdentityLevelBadge({ level, showLabel = true, size = 'small' }: IdentityLevelBadgeProps) {
  const config = LEVEL_CONFIG[level]
  const { label, color, bgColor, borderColor, Icon } = config

  return (
    <Chip
      icon={<Icon sx={{ color: `${color} !important`, fontSize: size === 'small' ? 14 : 18 }} />}
      label={showLabel ? `L${level} – ${label}` : `L${level}`}
      size={size}
      sx={{
        backgroundColor: bgColor,
        color,
        fontWeight: 600,
        border: `1px solid ${borderColor}`,
      }}
    />
  )
}
