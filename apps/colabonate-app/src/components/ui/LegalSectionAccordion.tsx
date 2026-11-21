import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Box,
  Typography,
  Chip,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { cn } from '@ds/utils'

export interface LegalSection {
  title: string
  badge?: string
  content: React.ReactNode
}

export function LegalSectionAccordion({ section }: { section: LegalSection }) {
  return (
    <Accordion
      disableGutters
      className={cn(
        '!bg-transparent',
        '!shadow-none',
        '!rounded-lg',
        'border border-[var(--theme-border)]',
        'overflow-hidden',
      )}
      sx={{
        '&::before': { display: 'none' },
        '&.Mui-expanded': { margin: 0 },
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon sx={{ color: 'var(--theme-text-muted)' }} />}
        className={cn(
          '!bg-[var(--theme-surface)]',
          '!min-h-[56px]',
          '!px-4 !py-3',
        )}
      >
        <Box className="flex items-center gap-2 w-full">
          <Typography
            className={cn(
              '!text-sm !font-medium',
              'text-[var(--theme-text)]',
            )}
          >
            {section.title}
          </Typography>
          {section.badge && (
            <Chip
              label={section.badge}
              size="small"
              className="!text-[10px] !h-[18px] !rounded"
              sx={{
                borderColor: 'var(--color-accent-1)',
                color: 'var(--color-accent-1)',
                backgroundColor: 'transparent',
              }}
            />
          )}
        </Box>
      </AccordionSummary>
      <AccordionDetails
        className={cn(
          '!px-5 !pt-4 !pb-5',
          '!bg-[var(--theme-surface)]',
          'border-t border-[var(--theme-border)]',
        )}
      >
        <Typography
          className={cn(
            '!text-sm',
            'text-[var(--theme-text)]',
            'leading-relaxed',
            'prose',
          )}
          component="div"
        >
          {section.content}
        </Typography>
      </AccordionDetails>
    </Accordion>
  )
}
