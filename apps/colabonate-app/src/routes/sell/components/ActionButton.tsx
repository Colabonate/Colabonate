import type { ReactNode } from 'react'
import { Tooltip, IconButton } from '@mui/material'

export function ActionButton({
  icon,
  title,
  color,
  onClick,
}: {
  icon: ReactNode
  title: string
  color?: string
  onClick: (e: React.MouseEvent) => void
}) {
  return (
    <Tooltip title={title} arrow placement="top">
      <span>
        <IconButton
          onClick={onClick}
          size="small"
          sx={{
            width: 34, height: 34, borderRadius: 1.5,
            background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)',
            color: color || 'var(--theme-text-muted)', transition: 'all 150ms ease',
            '&:hover': { background: color ? `${color}14` : 'var(--theme-surface-secondary)', borderColor: color ? `${color}40` : 'var(--theme-border)', color: color || 'var(--theme-text)' },
          }}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  )
}
