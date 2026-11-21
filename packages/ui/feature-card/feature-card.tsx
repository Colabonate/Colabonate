import { cn, useTheme } from '@ds/utils'
import type { FeatureCardProps } from './feature-card.types'

// ─── Card-Theme (aus SliderList übernommen) ────────────────────────────────────────
const CARD_THEME = {
  bg: (theme: 'light' | 'dark') => 
    theme === 'dark' 
      ? `linear-gradient(105deg, var(--color-secondary-90) 0%, var(--color-secondary-80) 35%, var(--color-secondary-90) 100%)`
      : `linear-gradient(105deg, var(--color-secondary-10) 0%, var(--color-secondary-20) 55%, var(--color-secondary-20) 100%)`,
  
  overlay: (theme: 'light' | 'dark') =>
    theme === 'dark'
      ? `linear-gradient(135deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.02) 45%, transparent 100%)`
      : `linear-gradient(135deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.1) 45%, transparent 100%)`,
  
  bottomScrim: `linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.38) 100%)`,

  shadow:          '0 1px 2px rgba(0,0,0,0.08)',
  shadowHover:     '0 16px 40px rgba(0,0,0,0.38), 0 4px 16px rgba(61,76,83,0.45)',

  font: {
    sans:   'var(--typography-fontfamily-sans)',
    barlow: 'var(--typography-fontfamily-barlow, Barlow, sans-serif)',
  },
  
  colors: (theme: 'light' | 'dark') => ({
    textPrimary:       theme === 'dark' ? 'var(--color-neutral-white)' : 'var(--color-secondary-80)',
    textSecondary:     theme === 'dark' ? 'rgba(255,255,255,0.6)' : 'var(--color-secondary-60)',
    categoryBg:        theme === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)',
    categoryColor:     theme === 'dark' ? 'rgba(255,255,255,0.6)' : 'var(--color-secondary-50)',
    categoryBorder:    theme === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)',
    placeholder:       theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    border:            theme === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.12)',
  }),
}

export function FeatureCard({
  icon,
  image,
  title,
  description,
  variant = 'default',
  className,
  ...props
}: FeatureCardProps) {
  const { theme } = useTheme()
  const C = CARD_THEME.colors(theme)

  return (
    <div
      className={cn(
        'relative rounded-xl cursor-pointer group overflow-hidden',
        'transition-all duration-300 ease-out',
        'hover:-translate-y-1.5',
        className
      )}
      style={{
        background: CARD_THEME.bg(theme),
        boxShadow: CARD_THEME.shadow,
        border: `1px solid ${C.border}`,
        minHeight: '220px',
      }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = CARD_THEME.shadowHover)}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = CARD_THEME.shadow)}
      {...props}
    >
      {/* Overlay */}
      <div className="absolute inset-0 pointer-events-none rounded-xl" style={{ background: CARD_THEME.overlay(theme) }} />

      {/* ── Image/Icon-Bereich oben ────────────────────────────────────────────────── */}
      <div className="relative w-full h-30 rounded-t-[11px] overflow-hidden bg-gradient-to-b from-primary-500/10 to-transparent">
        {image ? (
          /* Bild-Anzeige */
          <img
            src={image}
            alt=""
            className="absolute inset-0 object-cover w-full h-full"
          />
        ) : (
          /* Icon-Placeholder für zukünftige Bilder */
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="flex items-center justify-center leading-none select-none"
              style={{
                width: '100%',
                height: '100%',
                fontSize: '48px',
                color: C.placeholder,
                opacity: 0.6,
              }}
            >
              {icon}
            </div>
          </div>
        )}

        {/* Bottom Scrim für besseren Text-Übergang */}
        <div className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none" style={{ background: CARD_THEME.bottomScrim }} />
      </div>

      {/* ── Info-Bereich ───────────────────────────────── */}
      <div className="relative px-3 pt-2.5 pb-3 h-27 flex flex-col gap-1 overflow-hidden">
        {/* Titel */}
        <p
          className="line-clamp-2 shrink-0"
          style={{ 
            fontFamily: CARD_THEME.font.sans, 
            fontSize: '20px', 
            fontWeight: 200, 
            lineHeight: 1.3, 
            color: C.textPrimary,
            height: '32px'
          }}
        >
          {title}
        </p>

        {/* Beschreibung */}
        {description && (
          <p
            className="leading-none shrink-0"
            style={{ 
              fontFamily: CARD_THEME.font.sans, 
              fontSize: '12px', 
              color: C.textSecondary 
            }}
          >
            {description}
          </p>
        )}
      </div>
    </div>
  )
}
