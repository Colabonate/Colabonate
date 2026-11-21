// Shared "explanatory form section" card: title + description above the actual
// fields. Icons are optional — bounty pages pass none so their headings stay
// icon-free like the offer-detail design language (ADR-368 follow-up
// 2026-09-05). Established by the Post-a-Bounty page and reused by any
// full-fledged create/edit form that wants explained, grouped fields instead
// of a flat vertical stack. Pass `animate={false}` to opt out of the
// `.task-form-animate` GSAP stagger hook used by pages built with
// `usePageAnimation`.
import type { ReactNode } from 'react'
import { cn } from '@ds/utils'

export function FormSection({
  icon, title, description, children, className, animateClassName = 'task-form-animate',
}: {
  icon?: ReactNode
  title: string
  description: string
  children: ReactNode
  className?: string
  /** Selector class the page's usePageAnimation stagger targets. Pass '' to disable. */
  animateClassName?: string
}) {
  return (
    <div
      className={cn('flex flex-col gap-4 p-5 rounded-xl', animateClassName, className)}
      style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}
    >
      <div className={cn('min-w-0', icon ? 'flex items-start gap-3' : '')}>
        {icon && (
          <div
            className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0"
            // Same icon-tile pairing as the wizard's hero + "How it works"
            // tiles (blue tint + primary). The old purple tint +
            // var(--color-secondary-50) pair mismatched in light mode and
            // vanished in dark mode — secondary-50 is a dark slate from the
            // dark-theme background scale (see index.css --coop-guide-neutral).
            style={{ background: 'rgba(99,179,237,0.12)', color: 'var(--color-primary-50)' }}
          >
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold" style={{ color: 'var(--theme-text)' }}>{title}</h3>
          <p className="text-[12px] leading-relaxed mt-0.5" style={{ color: 'var(--theme-text-muted)' }}>{description}</p>
        </div>
      </div>
      {children}
    </div>
  )
}
