import { cn } from '@ds/utils'

interface BetaBadgeProps {
  /** Extra classes — used by AppLogo to pin the badge (e.g. absolute offsets). */
  className?: string
  /** When provided, the badge renders as a real button (e.g. link to the product notes). */
  onClick?: () => void
}

/**
 * Small "BETA" pill with a soft, breathing glow.
 *
 * - Token-based colors (no hardcoded values): brand primary + white text.
 * - Glow color is derived from the token via `color-mix`.
 * - Animation runs ONLY when the user allows motion (`prefers-reduced-motion: reduce`
 *   disables it) — pure CSS, no JS hook required.
 * - Renders as a `<span>` when decorative (no `onClick`, e.g. pinned to the login-page
 *   logo), or as a real `<button>` when interactive (main-menu placement).
 */
export function BetaBadge({ className, onClick }: BetaBadgeProps) {
  const pillClassName = cn(
    'inline-flex items-center justify-center rounded-full',
    'px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wider select-none',
    'beta-badge-glow',
    className,
  )
  const pillStyle = {
    background: 'var(--color-primary-50)',
    color: '#ffffff',
  }

  return (
    <>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className={cn(pillClassName, 'cursor-pointer border-0')}
          style={pillStyle}
          aria-label="Beta — read the product notes"
        >
          Beta
        </button>
      ) : (
        <span className={pillClassName} style={pillStyle} aria-label="Beta">
          Beta
        </span>
      )}

      <style>{`
        @keyframes betaBadgeGlow {
          0%, 100% { box-shadow: 0 0 3px 0 color-mix(in srgb, var(--color-primary-50) 45%, transparent); }
          50%      { box-shadow: 0 0 9px 1px color-mix(in srgb, var(--color-primary-50) 60%, transparent); }
        }
        .beta-badge-glow { animation: betaBadgeGlow 2.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .beta-badge-glow { animation: none; }
        }
      `}</style>
    </>
  )
}
