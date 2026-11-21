import { Paper, Box, Typography } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import { cn } from '@ds/utils'
import type { HelpSectionDef } from './helpData'

interface HelpCategoryCardProps {
  section: HelpSectionDef
}

export function HelpCategoryCard({ section }: HelpCategoryCardProps) {
  const navigate = useNavigate()

  return (
    <Paper
      onClick={() => navigate(`/help/${section.id}`)}
      className={cn(
        'flex flex-col gap-3.5',
        'p-5',
        'rounded-xl',
        'border border-[var(--theme-border)]',
        'bg-[var(--theme-surface)]',
        'cursor-pointer',
        'help-category-card',
        'transition-all duration-150',
        'hover:-translate-y-0.5',
        'active:scale-[0.97]',
        'hover:shadow-[var(--theme-shadow)]',
      )}
      elevation={0}
    >
      <Box
        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
        sx={{
          backgroundColor: section.iconBg,
        }}
      >
        <Box sx={{ color: section.iconColor }}>
          {section.icon}
        </Box>
      </Box>

      <Box className="flex flex-col gap-1.5">
        <Typography
          className={cn(
            '!text-[length:var(--typography-paragraph-small-heavy-fontsize)] !font-semibold',
            'text-[var(--theme-text)]',
            'help-category-title',
          )}
        >
          {section.title}
        </Typography>
        <Typography
          className={cn(
            '!text-[length:var(--typography-paragraph-xsmall-regular-fontsize)]',
            'text-[var(--theme-text-muted)]',
            'leading-relaxed',
            'help-category-description',
          )}
        >
          {section.description}
        </Typography>
      </Box>

      <Box className="flex items-center justify-between mt-auto pt-2">
        <Typography
          className={cn(
            '!text-[length:var(--typography-paragraph-xsmall-regular-fontsize)]',
            'text-[var(--theme-text-muted)]',
          )}
        >
          {section.articles.length} articles
        </Typography>
        <Box
          className="w-2 h-2 rounded-full"
          sx={{ backgroundColor: section.color }}
        />
      </Box>
    </Paper>
  )
}
