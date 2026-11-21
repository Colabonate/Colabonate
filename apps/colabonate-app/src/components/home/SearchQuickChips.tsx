import { memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Chip } from '@mui/material'

import { cn } from '@ds/utils'

import type { SearchChip } from '../../config/search-chips'
import { buildSearchUrl } from '../../config/search-chips'

interface SearchQuickChipsProps {
  chips: SearchChip[]
  className?: string
}

/** Quick-search chip row (navigates to /search) — shared by SearchHeroSection (desktop/tablet)
 * and the Home "Services & Collaborations" slider header (mobile). */
export const SearchQuickChips = memo(function SearchQuickChips({ chips, className }: SearchQuickChipsProps) {
  const navigate = useNavigate()

  if (chips.length === 0) return null

  return (
    <div
      className={cn(
        'flex-nowrap gap-1.5 overflow-x-auto overflow-y-hidden scroll-smooth',
        '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
      role="toolbar"
      aria-label="Quick searches"
    >
      {chips.map(chip => {
        const key = chip.type === 'term'
          ? `term-${chip.query}`
          : `filter-${chip.offerType ?? ''}-${chip.categoryCode ?? ''}`
        return (
          <Chip
            key={key}
            label={chip.label}
            size="small"
            clickable
            onClick={() => navigate(buildSearchUrl(chip))}
            sx={{
              flexShrink: 0,
              backgroundColor: 'color-mix(in srgb, var(--theme-bg-subtle) 30%, transparent)',
              backdropFilter: 'blur(6px)',
              color: 'var(--theme-text)',
              borderColor: 'color-mix(in srgb, var(--theme-border) 50%, transparent)',
              borderStyle: 'solid',
              borderWidth: 1,
              fontSize: 'var(--typography-paragraph-xsmall-heavy-fontsize)',
              fontWeight: 'var(--typography-paragraph-xsmall-heavy-fontweight)',
              lineHeight: 'var(--typography-paragraph-xsmall-heavy-lineheight)',
              transition: 'all 150ms ease',
              '&:hover': {
                backgroundColor: 'color-mix(in srgb, var(--theme-surface) 50%, transparent)',
                borderColor: 'var(--color-primary-50)',
                color: 'var(--color-primary-50)',
              },
            }}
          />
        )
      })}
    </div>
  )
})
