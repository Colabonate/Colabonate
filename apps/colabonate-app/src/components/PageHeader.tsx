import { IconButton } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import type { ReactNode } from 'react'
import { cn, useIsMobile } from '@ds/utils'
import { usePref } from '../utils/userPreferences'
import { useSetMobileNavHeader } from '../context/MobileNavHeaderContext'

interface PageHeaderProps {
  /** Seiten-Icon rechts vom Back-Button (immer sichtbar).
   *  Standard: 64×64px Box. Bei compact: 40×40px Kreis/Quadrat. */
  icon?: ReactNode
  /** Haupt-Titel */
  title: ReactNode
  /** Zweite Zeile (Subtitle / Count / Meta) */
  subtitle?: ReactNode
  /** Wenn gesetzt: Back-Button wird links vom Icon gezeigt */
  onBack?: () => void
  /** Aria-Label für den Back-Button */
  backLabel?: string
  /** Wenn true: Back-Button wird auf Mobile ausgeblendet (z.B. wenn das MainMenu ihn bereits anbietet) */
  hideBackOnMobile?: boolean
  /** Wenn true: Header wird komplett ausgeblendet, speist aber trotzdem die Mobile-Nav-Bar */
  hidden?: boolean
  /** Wenn true: Komponente nimmt nur den Platz ein, den sie braucht (z.B. neben KPIStrip) */
  shrink?: boolean
  /** Kompakter Modus: kleineres Icon (40px), weniger Padding, besser für KPI-Strip-Nebenanordnung */
  compact?: boolean
  /** Optionale Actions rechts (z.B. KPIStrip, Buttons) */
  actions?: ReactNode
  /** Wenn true: Titel und Subtitle werden zentriert (für Full-Page-Formulare) */
  centered?: boolean
  /** Wenn true: Header auch auf Mobile rendern, auch wenn keine Actions vorhanden sind. */
  alwaysShow?: boolean
  /** Actions-Layout: 'strip' (default) = breiter, scrollbarer Bereich für eine
   *  KPIStrip (flex-1 + min-w-70 + overflow-x-auto). 'inline' = Actions nehmen
   *  nur ihre Content-Breite ein (shrink-0) — für kleine Buttons wie ein
   *  More-Menü, damit diese den Titel nicht verdrängen (auf Mobile sonst
   *  min-w-70 = 280px → Titel wird auf 0 gequetscht). */
  actionsFit?: 'strip' | 'inline'
}

/**
 * Globaler Seitenheader für alle Unterseiten.
 *
 * Layout ohne Back:   [ Icon | Titel    ]
 * Layout mit Back:    [ ←  Icon | Titel ]
 * Mit actions:        [ ←  Icon | Titel | actions ]
 *
 * compact=true  →  Icon 40×40px,  weniger Spacing
 * compact=false →  Icon 64×64px,  großzügiges Spacing (Default)
 *
 * Typografie folgt dem Design-System mit Token-Referenzen.
 */
export function PageHeader({ icon, title, subtitle, onBack, backLabel, hideBackOnMobile, hidden, shrink, compact, actions, centered, alwaysShow, actionsFit = 'strip' }: PageHeaderProps) {
  const hasActions = !!actions
  const [hidePageHeaders] = usePref('hidePageHeaders', false)
  const isMobile = useIsMobile()
  const isCompact = compact || isMobile

  // Feed the mobile bottom nav bar with page header info automatically.
  // Only scalar strings can be passed as nav bar title/subtitle (no JSX).
  const titleStr    = typeof title    === 'string' ? title    : undefined
  const subtitleStr = typeof subtitle === 'string' ? subtitle : undefined
  useSetMobileNavHeader(
    titleStr && !hidePageHeaders ? { title: titleStr, subtitle: subtitleStr, icon, onBack } : null
  )

  // On mobile the nav bar already shows title/subtitle/back — hide the page-level
  // header to avoid duplication. Keep it if there are actions that must stay in content.
  if (hidden || hidePageHeaders || (isMobile && !!titleStr && !hasActions && !alwaysShow)) {
    return null
  }

  if (centered) {
    return (
      <div
        className={cn(
          'flex flex-col items-center text-center',
          'gap-2',
          'my-0',
          // Mobile: pull the header up to cut ~65% of the PageContainer top gap
          // (default lg spacing = mt-5/20px → ~7px). Safe: PageContainer adds
          // pt-[58px] nav padding above, so the negative margin never overlaps.
          isMobile && '-mt-[13px]',
        )}
      >
        {/* ── Back-Button (centered above title) ──────────────────── */}
        {onBack && (
          <IconButton
            size="small"
            onClick={onBack}
            aria-label={backLabel ?? 'Zurück'}
            className={cn(
              'p-2',
              'border',
              'border-divider',
              'rounded-xl',
              'text-[var(--theme-text-muted)]',
              'transition-colors',
              'duration-450',
              'hover:bg-[var(--theme-item-hover)]',
              'hover:border-[var(--theme-text-muted)]',
            )}
          >
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        )}

        {/* ── Seiten-Icon (centered) ─────────────────────────────── */}
        {icon && (
          <div
            className={cn(
              'flex',
              'items-center',
              'justify-center',
              'shrink-0',
              'w-16 h-16 rounded-lg',
              'border',
              'border-(--theme-border)',
              'bg-(--theme-bg-subtle)',
              'text-[var(--theme-text-muted)]',
              '[&_svg]:w-12 [&_svg]:h-12',
            )}
          >
            {icon}
          </div>
        )}

        {/* ── Titel + Subtitle (zentriert) ───────────────────────── */}
        <div className={cn('flex flex-col items-center gap-1 max-w-lg')}>
          <h4
            className={cn(
              'text-[var(--theme-text-muted)]',
              'leading-tight',
              'm-0',
              'text-2xl font-light md:text-3xl',
              'text-center',
            )}
          >
            {title}
          </h4>
          {subtitle && (
            <span
              className={cn(
                'text-[var(--theme-text-muted)]',
                'text-sm',
                'text-center',
              )}
            >
              {subtitle}
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex',
        'items-center',
        isCompact ? 'gap-3' : 'gap-4',
        'py-2',
        'my-0',
        // Mobile: pull the header up to cut ~65% of the PageContainer top gap
        // (default lg spacing = mt-5/20px → ~7px). Safe: PageContainer adds
        // pt-[58px] nav padding above, so the negative margin never overlaps.
        isMobile && '-mt-[13px]',
      )}
    >
      {/* ── Back-Button ─────────────────────────────────────────── */}
      {onBack && (!hideBackOnMobile || !isMobile) && (
        <IconButton
          size="small"
          onClick={onBack}
          aria-label={backLabel ?? 'Zurück'}
          className={cn(
            'p-2',
            'border',
            'border-divider',
            'rounded-xl',
            'text-[var(--theme-text-muted)]',
            'transition-colors',
            'duration-450',
            'hover:bg-[var(--theme-item-hover)]',
            'hover:border-[var(--theme-text-muted)]',
            isCompact && 'shrink-0',
          )}
        >
          <ArrowBackIcon fontSize={isCompact ? 'small' : 'medium'} />
        </IconButton>
      )}

      {/* ── Seiten-Icon ─────────────────────────────────────────── */}
      {icon && (
        <div
          className={cn(
            'flex',
            'items-center',
            'justify-center',
            'shrink-0',
            isCompact ? 'w-10 h-10 rounded-xl' : 'w-16 h-16 rounded-lg',
            'border',
            'border-(--theme-border)',
            'bg-(--theme-bg-subtle)',
            'text-[var(--theme-text-muted)]',
            isCompact ? '[&_svg]:w-8 [&_svg]:h-8' : '[&_svg]:w-12 [&_svg]:h-12',
          )}
        >
          {icon}
        </div>
      )}

      {/* ── Titel + Subtitle (einzeilig, inline) ─────────────────── */}
      <div className={cn(
        'flex flex-col justify-center gap-0.5 min-w-0',
        isCompact ? 'min-w-0' : 'ml-2',
        shrink ? 'shrink-0' : 'flex-1',
        hasActions && 'min-w-0',
      )}>
        <h4
          className={cn(
            'text-[var(--theme-text-muted)]',
            'leading-tight',
            'm-0',
            'truncate',
            isCompact
              ? 'text-xl font-light'
              : 'text-2xl font-light md:text-3xl',
          )}
        >
          {title}
        </h4>
        {subtitle && (
          <span
            className={cn(
              'text-[var(--theme-text-muted)]',
              'shrink-0',
              'text-xs sm:text-sm',
            )}
          >
            {subtitle}
          </span>
        )}
      </div>

      {/* ── Actions (z.B. KPIStrip) ────────────────────────────────── */}
      {actions && (
        <div className={cn(
          actionsFit === 'inline'
            ? cn('shrink-0', !isCompact && 'ml-2')
            : cn(
                'flex-1',
                'min-w-70',
                'overflow-x-auto',
                '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
                !isCompact && 'ml-4',
              ),
        )}>
          {actions}
        </div>
      )}
    </div>
  )
}
