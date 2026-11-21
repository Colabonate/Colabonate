import { type ReactNode } from 'react'
import { useReducedMotion } from '../../../hooks/useReducedMotion'

interface OnboardingStaggerProps {
  /** Sections to reveal one after another (e.g. the ≤3 sections of a page). */
  children: ReactNode[] | ReactNode
  /** Delay between successive items in ms. */
  step?: number
  /** Applied to the wrapping container (e.g. vertical spacing via space-y-*). */
  className?: string
}

/**
 * OnboardingStagger — reveals its child sections one after another with a short
 * rise + fade (the ADR-151 section entrance). Each child is wrapped in a block
 * that starts at `opacity: 0` and animates in with an incremental
 * `animation-delay`, so the ≤3 sections of a page cascade in sequence.
 *
 * - Respects `prefers-reduced-motion`: renders instantly, no animation, no
 *   hidden state (sections are fully visible).
 * - Re-triggers automatically whenever the parent remounts — give the page
 *   content a `key` that changes per page (Welcome) or rely on the conditional
 *   block swapping (Creator) / single mount (Features).
 *
 * App-level helper (decorative motion), stays out of headless `packages/ui`.
 */
export function OnboardingStagger({
  children,
  step = 90,
  className,
}: OnboardingStaggerProps) {
  const prefersReduced = useReducedMotion()
  const items = Array.isArray(children) ? children : [children]

  return (
    <div className={className}>
      {items.map((child, i) => (
        <div
          key={i}
          className={prefersReduced ? undefined : 'onboarding-stagger-item'}
          style={prefersReduced ? undefined : { animationDelay: `${i * step}ms` }}
        >
          {child}
        </div>
      ))}

      {!prefersReduced && (
        <style>{`
          @keyframes onboardingStaggerRise {
            from { opacity: 0; transform: translateY(12px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .onboarding-stagger-item {
            opacity: 0;
            animation: onboardingStaggerRise 0.42s ease-out forwards;
          }
        `}</style>
      )}
    </div>
  )
}
