import { cn } from '@ds/utils'
import { FeatureCard } from '../feature-card/feature-card'
import type { FeatureGridProps } from './feature-grid.types'

export function FeatureGrid({
  title,
  subtitle,
  icon,
  features,
  columns = 4,
  showCta,
  ctaLabel,
  ctaHref,
  className,
  ...props
}: FeatureGridProps) {
  return (
    <div className={cn('flex flex-col gap-10 md:gap-12', className)} {...props}>
      {/* Header */}
      <div className="flex flex-col gap-4 md:gap-4">
        <div className="flex items-center gap-4 md:gap-4">
          {icon && (
            <div className="flex items-center justify-center flex-shrink-0 h-10 w-100 md:w-12 md:h-12 rounded-xl bg-primary-500/10 text-primary-500">
              {icon}
            </div>
          )}
          <h2
            className={cn(
              'text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight',
              'bg-gradient-to-r from-neutral-1 via-neutral-2 to-neutral-3 bg-clip-text text-transparent',
              'dark:from-neutral-white dark:via-neutral-2 dark:to-neutral-4'
            )}
            style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            {title}
          </h2>
        </div>
        {subtitle && (
          <p
            className={cn(
              'text-base md:text-lg lg:text-xl text-neutral-6 max-w-3xl leading-relaxed',
              'dark:text-neutral-7 mt-2 mb-4 md:mt-3 md:mb-6'
            )}
            style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            {subtitle}
          </p>
        )}
      </div>

      {/* Grid – mit explizitem CSS Grid Layout */}
      <div
        className="grid gap-4 md:gap-6"
        style={{
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        }}
      >
        {features.map((feature, index) => (
          <FeatureCard key={index} {...feature} />
        ))}
      </div>

      {/* Optional CTA Button */}
      {showCta && ctaLabel && ctaHref && (
        <div className="flex justify-center mt-4 md:mt-6">
          <a
            href={ctaHref}
            className={cn(
              'group inline-flex items-center gap-2.5 px-6 py-3 md:px-8 md:py-4 rounded-2xl',
              'bg-gradient-to-r from-primary-500 to-primary-600',
              'text-white font-semibold text-sm md:text-base',
              'shadow-lg shadow-primary-500/30',
              'transition-all duration-300 ease-out',
              'hover:shadow-xl hover:shadow-primary-500/40 hover:-translate-y-0.5 hover:scale-[1.02]',
              'active:translate-y-0 active:scale-[0.98]'
            )}
            style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            {ctaLabel}
            <svg
              className="w-4 h-4 transition-transform duration-300 md:w-5 md:h-5 group-hover:translate-x-1"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 8l4 4m0 0l-4 4m4-4H3"
              />
            </svg>
          </a>
        </div>
      )}
    </div>
  )
}
