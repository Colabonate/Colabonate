import { Box, Typography } from '@mui/material'
import { cn } from '@ds/utils'
import type { HelpStep } from './helpData'

interface HelpStepFlowProps {
  steps: HelpStep[]
  accentColor?: string
  className?: string
}

export function HelpStepFlow({ steps, accentColor = 'var(--color-accent-1)', className }: HelpStepFlowProps) {
  return (
    <Box
      className={cn(
        'flex flex-wrap items-center gap-3',
        'py-4 px-5',
        'rounded-lg',
        'bg-[var(--theme-surface)]',
        'border border-[var(--theme-border)]',
        'help-step-flow',
        className,
      )}
    >
      {steps.map((step, index) => (
        <Box key={index} className="flex items-center gap-2.5">
          <Box className="flex items-center gap-2.5">
            <Box
              className={cn(
                'w-6 h-6 rounded-full',
                'flex items-center justify-center',
                'text-[length:var(--typography-paragraph-small-heavy-fontsize)] font-bold',
                'flex-shrink-0',
              )}
              sx={{
                backgroundColor: accentColor,
                color: 'var(--color-neutral-white)',
              }}
            >
              {index + 1}
            </Box>
            <Box className="flex flex-col gap-0.5">
              <Typography
                className={cn(
                  '!text-[length:var(--typography-paragraph-small-regular-fontsize)] !font-medium',
                  'text-[var(--theme-text)]',
                  'leading-tight',
                )}
              >
                {step.label}
              </Typography>
              {step.description && (
                <Typography
                  className={cn(
                    'text-[length:var(--typography-paragraph-xsmall-regular-fontsize)]',
                    'text-[var(--theme-text-muted)]',
                    'leading-[length:var(--typography-paragraph-xsmall-regular-lineheight)]',
                  )}
                >
                  {step.description}
                </Typography>
              )}
            </Box>
          </Box>
          {index < steps.length - 1 && (
            <Box
              className={cn(
                'hidden sm:block',
                'w-8 h-px',
                'mx-2',
              )}
              sx={{ backgroundColor: 'var(--theme-border)' }}
            />
          )}
        </Box>
      ))}
    </Box>
  )
}
