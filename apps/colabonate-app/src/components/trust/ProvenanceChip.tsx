import { Chip } from '@mui/material'
import DescriptionIcon from '@mui/icons-material/Description'
import VerifiedIcon from '@mui/icons-material/Verified'
import VisibilityIcon from '@mui/icons-material/Visibility'

/**
 * ProvenanceChip — the three-way marker that binds every displayed fact to how
 * it was established (ADR-355 D3 rule 1). Distinct icon, label and colour, so
 * provenance is never conveyed by colour alone.
 *
 * - `on-chain`    — verified on-chain (certified read, L1). The strongest claim.
 * - `observation` — chain observation (seen on chain, not certified).
 * - `app-record`  — app record (stored by the platform, not on-chain).
 */

export type Provenance = 'on-chain' | 'observation' | 'app-record'

const META: Record<Provenance, { label: string; icon: React.ReactElement; color: string; bg: string; border: string }> = {
  'on-chain': {
    label: 'Verified on-chain',
    icon: <VerifiedIcon sx={{ fontSize: 14 }} />,
    color: 'var(--color-status-success)',
    bg: 'var(--color-status-success-bg)',
    border: 'var(--color-status-success)',
  },
  observation: {
    label: 'Chain observation',
    icon: <VisibilityIcon sx={{ fontSize: 14 }} />,
    color: 'var(--color-status-info)',
    bg: 'var(--color-status-info-bg)',
    border: 'var(--color-status-info)',
  },
  'app-record': {
    label: 'App record',
    icon: <DescriptionIcon sx={{ fontSize: 14 }} />,
    color: 'var(--theme-text-muted)',
    bg: 'var(--theme-bg-subtle)',
    border: 'var(--theme-border)',
  },
}

export function ProvenanceChip({ provenance }: { provenance: Provenance }) {
  const meta = META[provenance]
  return (
    <Chip
      size="small"
      variant="outlined"
      icon={meta.icon}
      label={meta.label}
      sx={{
        height: 22,
        fontSize: '0.7rem',
        color: meta.color,
        borderColor: meta.border,
        bgcolor: meta.bg,
        '& .MuiChip-icon': { color: meta.color, marginLeft: '6px' },
        '& .MuiChip-label': { paddingLeft: '4px', paddingRight: '8px' },
      }}
    />
  )
}
