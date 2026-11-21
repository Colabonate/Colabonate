import { type ReactNode } from 'react'
import { ArrowRight, ChevronRight } from 'lucide-react'
import { cn } from '@ds/utils'

/**
 * OnboardingFooter — the standard Back / Continue / Skip footer shared by most
 * onboarding pages (ADR-151). Renders the exact same markup the three routes used
 * inline before consolidation, so the visual chrome is preserved:
 *
 *   [ ← Back ]  [  Continue  → ]  [ Skip ]
 *
 * Pass the optional handlers to show/hide Back or Skip. The Continue button is
 * fully styleable (label, icon, color, disabled) so it covers the Welcome,
 * Features and Creator (basics/details) variants. Pages with bespoke footers
 * (Creator welcome / done) pass a custom node to `OnboardingSectionPage` instead.
 */
interface OnboardingFooterProps {
  /** If omitted, no Back button is rendered (e.g. first page). */
  onBack?: () => void
  onContinue: () => void
  continueLabel?: string
  /** Defaults to a trailing ChevronRight. */
  continueIcon?: ReactNode
  continueDisabled?: boolean
  /** Background of the Continue button. Defaults to brand primary. */
  continueColor?: string
  /** Text color of the Continue button. Defaults to white. */
  continueTextColor?: string
  /** If omitted, no Skip button is rendered. */
  onSkip?: () => void
  skipLabel?: string
}

export function OnboardingFooter({
  onBack,
  onContinue,
  continueLabel = 'Continue',
  continueIcon,
  continueDisabled,
  continueColor = 'var(--color-primary-50)',
  continueTextColor = 'white',
  onSkip,
  skipLabel = 'Skip',
}: OnboardingFooterProps) {
  return (
    <div className="px-6 pb-8 pt-2">
      <div className="flex items-center max-w-md gap-3 mx-auto">
        {/* Back */}
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Back"
            className="flex items-center justify-center w-12 h-12 transition-all duration-200 border-none cursor-pointer rounded-xl active:scale-95 shrink-0"
            style={{
              background: 'var(--theme-surface-secondary)',
              color: 'var(--theme-text-muted)',
            }}
          >
            <ArrowRight size={20} className="rotate-180" />
          </button>
        )}

        {/* Continue */}
        <button
          onClick={onContinue}
          disabled={continueDisabled}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 h-12 rounded-xl border-none text-[15px] font-semibold cursor-pointer transition-all duration-200 active:scale-[0.98]',
            continueDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90',
          )}
          style={{ background: continueColor, color: continueTextColor }}
        >
          {continueLabel}
          {continueIcon ?? <ChevronRight size={18} />}
        </button>

        {/* Skip */}
        {onSkip && (
          <button
            onClick={onSkip}
            className="text-[13px] font-medium cursor-pointer bg-transparent border-none transition-colors duration-200 hover:opacity-70 px-2 shrink-0"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            {skipLabel}
          </button>
        )}
      </div>
    </div>
  )
}
