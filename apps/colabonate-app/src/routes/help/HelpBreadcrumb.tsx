import { useNavigate } from 'react-router-dom'
import { Box, Typography } from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { cn } from '@ds/utils'

interface HelpBreadcrumbProps {
  sectionTitle: string
  className?: string
}

export function HelpBreadcrumb({ sectionTitle, className }: HelpBreadcrumbProps) {
  const navigate = useNavigate()

  return (
    <Box
      className={cn(
        'flex items-center gap-1',
        'text-[length:var(--typography-paragraph-small-regular-fontsize)]',
        'help-breadcrumb',
        className,
      )}
    >
      <Typography
        component="button"
        onClick={() => navigate('/help')}
        className={cn(
          '!text-[var(--theme-text-muted)]',
          '!bg-transparent',
          '!border-none',
          '!p-0',
          '!cursor-pointer',
          'hover:!text-[var(--theme-text)]',
          'hover:underline',
          'transition-colors duration-150',
        )}
      >
        Help
      </Typography>

      <ChevronRightIcon sx={{ fontSize: 14, color: 'var(--theme-text-muted)' }} />

      <Typography className="!text-[var(--theme-text)]">
        {sectionTitle}
      </Typography>
    </Box>
  )
}
