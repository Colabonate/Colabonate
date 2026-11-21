import { cn } from '@ds/utils'
import PersonIcon from '@mui/icons-material/Person'
import StorefrontIcon from '@mui/icons-material/Storefront'
import type { EntityProfileHeaderProps } from './entity-profile-header.types'

export function EntityProfileHeader({
  variant,
  bannerUrl,
  avatarUrl,
  title,
  subtitle,
  badges,
  avatarFallback,
  className,
  ...props
}: EntityProfileHeaderProps) {
  const initial = (title || '')[0]?.toUpperCase() || null
  const avatarShape = variant === 'company' ? 'rounded-xl' : 'rounded-full'
  const FallbackIcon = variant === 'company' ? StorefrontIcon : PersonIcon

  return (
    <div
      className={cn(
        'rounded-2xl',
        'border',
        'border-[var(--theme-border)]',
        'bg-[var(--theme-surface)]',
        'px-6',
        'py-6',
        'md:px-8',
        'md:py-8',
        'overflow-hidden',
        className,
      )}
      {...props}
    >
      {bannerUrl && (
        <div
          className="-mx-6 -mt-6 md:-mx-8 md:-mt-8 mb-5 h-24 md:h-28 relative bg-cover bg-center"
          style={{
            backgroundImage: `url(${bannerUrl})`,
            backgroundColor: 'var(--theme-bg-subtle)',
          }}
        >
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(to bottom, transparent 45%, var(--theme-surface) 100%)' }}
          />
        </div>
      )}

      <div className="flex flex-wrap items-start gap-6 md:gap-8">
        <div
          className={cn(
            'relative flex items-center justify-center w-16 h-16 md:w-20 md:h-20 border-4 flex-shrink-0 text-2xl md:text-3xl overflow-hidden',
            avatarShape,
            bannerUrl && '-mt-10 md:-mt-12',
          )}
          style={{
            backgroundColor: 'var(--color-primary-10)',
            borderColor: bannerUrl ? 'var(--theme-surface)' : 'var(--color-primary-10)',
            color: 'var(--color-primary-50)',
          }}
        >
          {avatarFallback ?? (initial ?? <FallbackIcon sx={{ fontSize: '1.75rem' }} />)}
          {avatarUrl && (
            <img
              src={avatarUrl}
              alt=""
              aria-hidden
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span
              className={cn(
                'text-[var(--typography-heading-h5-mobile-regular-fontsize,20px)]',
                'font-[var(--typography-heading-h5-mobile-regular-fontweight,400)]',
                'text-[var(--theme-text)]',
              )}
            >
              {title}
            </span>
            {badges}
          </div>
          {subtitle}
        </div>
      </div>
    </div>
  )
}
