import { cn } from '@ds/utils'
import LocalOfferIcon from '@mui/icons-material/LocalOffer'
import type { BusinessFieldsChipsProps } from './business-fields-chips.types'

export function BusinessFieldsChips({
  fields,
  label = 'Business Fields',
  showIcon = true,
  className,
  ...props
}: BusinessFieldsChipsProps) {
  const list = fields && fields.length > 0 ? fields : null
  if (!list) return null

  return (
    <div className={cn('flex gap-2 text-[13px]', className)} {...props}>
      {showIcon && (
        <LocalOfferIcon
          sx={{ fontSize: 18 }}
          className="mt-0.5 shrink-0"
          style={{ color: 'var(--theme-text-muted)' }}
        />
      )}
      <div className="flex-1 min-w-0">
        <div
          className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--theme-text-muted)' }}
        >
          {label}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {list.map((f) => (
            <span
              key={f.id ?? f.slug ?? f.name}
              className="inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-medium"
              style={{
                background: 'var(--theme-bg-subtle)',
                color: 'var(--theme-text)',
                border: '1px solid var(--theme-border)',
              }}
            >
              {f.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
