import { cn } from '@ds/utils'
import LocationOnIcon from '@mui/icons-material/LocationOn'
import type { AddressBlockProps } from './address-block.types'

export function AddressBlock({
  address,
  zipCode,
  city,
  country,
  label = 'Address',
  showIcon = true,
  mapLinkSlot,
  className,
  ...props
}: AddressBlockProps) {
  const hasAny = Boolean(address || zipCode || city || country)
  if (!hasAny) return null

  return (
    <div className={cn('flex gap-2 text-[13px]', className)} {...props}>
      {showIcon && (
        <LocationOnIcon
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
        {address && <div style={{ color: 'var(--theme-text)' }}>{address}</div>}
        {(zipCode || city) && (
          <div style={{ color: 'var(--theme-text)' }}>{[zipCode, city].filter(Boolean).join(' ')}</div>
        )}
        {country && <div style={{ color: 'var(--theme-text)' }}>{country}</div>}
        {mapLinkSlot}
      </div>
    </div>
  )
}
