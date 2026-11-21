import { Accordion, AccordionSummary, AccordionDetails, Box, Typography, Chip } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import LightbulbIcon from '@mui/icons-material/Lightbulb'
import WarningIcon from '@mui/icons-material/Warning'
import InfoIcon from '@mui/icons-material/Info'
import { cn } from '@ds/utils'
import type { HelpArticle as HelpArticleType } from './helpData'
import { HelpStepFlow } from './HelpStepFlow'

interface HelpArticleAccordionProps {
  article: HelpArticleType
  accentColor?: string
  defaultExpanded?: boolean
}

const TIP_ICONS = {
  lightbulb: <LightbulbIcon sx={{ fontSize: 14 }} />,
  warning: <WarningIcon sx={{ fontSize: 14 }} />,
  info: <InfoIcon sx={{ fontSize: 14 }} />,
}

export function HelpArticleAccordion({
  article,
  accentColor = 'var(--color-accent-1)',
  defaultExpanded = false,
}: HelpArticleAccordionProps) {
  return (
    <Accordion
      id={article.id}
      defaultExpanded={defaultExpanded}
      disableGutters
      className={cn(
        '!bg-transparent',
        '!shadow-none',
        '!rounded-lg',
        'border border-[var(--theme-border)]',
        'help-article-accordion',
        'overflow-hidden',
      )}
      sx={{
        '&::before': { display: 'none' },
        '&.Mui-expanded': {
          margin: 0,
        },
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon sx={{ color: 'var(--theme-text-muted)' }} />}
        className={cn(
          '!bg-[var(--theme-surface)]',
          '!min-h-[64px]',
          '!px-4 !py-3',
          'help-article-summary',
        )}
      >
        <Box className="flex flex-col gap-1.5 w-full">
          <Typography
            className={cn(
              '!text-[length:var(--typography-paragraph-small-heavy-fontsize)] !font-medium',
              'text-[var(--theme-text)]',
              'help-article-title',
            )}
          >
            {article.title}
          </Typography>
          <Typography
            className={cn(
              '!text-[length:var(--typography-paragraph-xsmall-regular-fontsize)]',
              'text-[var(--theme-text-muted)]',
              'help-article-summary-text',
            )}
          >
            {article.summary}
          </Typography>
          {article.tags.length > 0 && (
            <Box className="flex flex-wrap gap-1.5 mt-2">
              {article.tags.slice(0, 4).map(tag => (
                <Chip
                  key={tag}
                  label={tag}
                  size="small"
                  className={cn(
                    '!text-[length:var(--typography-paragraph-xsmall-regular-fontsize)] !h-[18px]',
                    '!rounded',
                    '!border',
                  )}
                  sx={{
                    borderColor: accentColor,
                    color: accentColor,
                    backgroundColor: 'transparent',
                  }}
                />
              ))}
            </Box>
          )}
        </Box>
      </AccordionSummary>

      <AccordionDetails
        className={cn(
          '!px-5 !pt-5 !pb-6',
          '!bg-[var(--theme-surface)]',
          'border-t border-[var(--theme-border)]',
          'help-article-details',
        )}
      >
        <div className="prose">
          <Typography
            className={cn(
              '!text-[length:var(--typography-paragraph-small-heavy-fontsize)]',
              'text-[var(--theme-text)]',
              'leading-relaxed',
            )}
          >
            {article.content}
          </Typography>
        </div>

        {article.steps && article.steps.length > 0 && (
          <Box className="mt-5">
            <HelpStepFlow steps={article.steps} accentColor={accentColor} />
          </Box>
        )}

        {article.tips && article.tips.length > 0 && (
          <Box className="flex flex-col gap-3">
            {article.tips.map((tip, index) => (
              <Box
                key={index}
                className={cn(
                  'flex items-start gap-2.5',
                  'p-3.5',
                  'rounded-lg',
                )}
                sx={{
                  backgroundColor: 'color-mix(in srgb, var(--color-accent-2) 8%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-accent-2) 20%, transparent)',
                }}
              >
                <Box
                  className="flex-shrink-0 mt-0.5"
                  sx={{ color: 'var(--color-accent-2)' }}
                >
                  {TIP_ICONS[tip.icon]}
                </Box>
                <Typography className="!text-[length:var(--typography-paragraph-xsmall-regular-fontsize)] text-[var(--theme-text-muted)] leading-relaxed">
                  {tip.text}
                </Typography>
              </Box>
            ))}
          </Box>
        )}

        {article.expandedSections && article.expandedSections.length > 0 && (
          <Box className="flex flex-col gap-4 mt-6 pt-4 border-t border-[var(--theme-border)]">
            {article.expandedSections.map((section, index) => (
              <div key={index} className="prose">
                <Typography
                  className={cn(
                    '!text-[length:var(--typography-paragraph-small-heavy-fontsize)] !font-semibold',
                    'text-[var(--theme-text)]',
                  )}
                >
                  {section.title}
                </Typography>
                <Typography
                  className={cn(
                    '!text-[length:var(--typography-paragraph-xsmall-regular-fontsize)]',
                    'text-[var(--theme-text-muted)]',
                    'leading-relaxed',
                  )}
                >
                  {section.content}
                </Typography>
              </div>
            ))}
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  )
}
