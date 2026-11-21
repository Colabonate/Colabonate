import { cn } from '@ds/utils'
import GavelIcon from '@mui/icons-material/Gavel'
import type { TermsBlockProps } from './terms-block.types'

export function TermsBlock({ terms, label, showIcon = true, className, ...props }: TermsBlockProps) {
  if (!terms) return null

  return (
    <div className={cn('flex gap-2 text-[13px]', className)} {...props}>
      {showIcon && (
        <GavelIcon
          sx={{ fontSize: 18 }}
          className="mt-0.5 shrink-0"
          style={{ color: 'var(--theme-text-muted)' }}
        />
      )}
      <div className="flex-1 min-w-0">
        {label && (
          <div
            className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            {label}
          </div>
        )}
        <p className="text-[14px] leading-[1.6] text-[var(--theme-text)] whitespace-pre-line">
          {terms}
        </p>
      </div>
    </div>
  )
}
