import { cn } from '@ds/utils'
import type { IdentityStatus } from '../../lib/nostr-identity'

/**
 * ADR-195 §3.1 — three-level Identity Status badge.
 *
 * Distinct from `IdentityLevelBadge` (which is the trust ladder L0–L3).
 * This reflects *key custody + backup state*: is the identity key secured,
 * and who holds it? Colours map to project status tokens so they read
 * consistently across light/dark themes.
 */

interface StatusConfig {
  label: string
  dot: string
  color: string
  bg: string
  border: string
  /** One-sentence explanation shown when `withExplanation` is set. */
  explanation: string
}

const STATUS_CONFIG: Record<IdentityStatus, StatusConfig> = {
  GREEN: {
    label: 'Secured identity',
    dot: 'var(--color-status-success)',
    color: 'var(--color-status-success)',
    bg: 'color-mix(in srgb, var(--color-status-success) 12%, transparent)',
    border: 'color-mix(in srgb, var(--color-status-success) 35%, transparent)',
    explanation: 'Your identity key is held by a portable signer you back up yourself.',
  },
  YELLOW: {
    label: 'Real key. Back it up',
    dot: 'var(--color-status-warning)',
    color: 'var(--color-status-warning)',
    bg: 'color-mix(in srgb, var(--color-status-warning) 12%, transparent)',
    border: 'color-mix(in srgb, var(--color-status-warning) 35%, transparent)',
    explanation: 'You use a real key, but we have no record that you backed it up.',
  },
  RED: {
    label: 'Burner. Device only',
    dot: 'var(--color-status-error)',
    color: 'var(--color-status-error)',
    bg: 'color-mix(in srgb, var(--color-status-error) 12%, transparent)',
    border: 'color-mix(in srgb, var(--color-status-error) 35%, transparent)',
    explanation: 'This identity lives only in this browser. Clearing it loses your identity and reputation.',
  },
}

interface IdentityStatusBadgeProps {
  status: IdentityStatus
  /** Show the text label next to the dot. Default true. */
  showLabel?: boolean
  /** Render the one-sentence explanation below the pill. */
  withExplanation?: boolean
  size?: 'small' | 'medium'
  className?: string
}

export function IdentityStatusBadge({
  status,
  showLabel = true,
  withExplanation = false,
  size = 'small',
  className,
}: IdentityStatusBadgeProps) {
  const cfg = STATUS_CONFIG[status]

  return (
    <div className={cn('inline-flex', 'flex-col', 'gap-1', className)}>
      <span
        className={cn(
          'inline-flex',
          'items-center',
          'gap-1.5',
          'rounded-full',
          'font-semibold',
          'whitespace-nowrap',
          size === 'small' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[12px]',
        )}
        style={{ color: cfg.color, backgroundColor: cfg.bg, border: `1px solid ${cfg.border}` }}
      >
        <span
          className="inline-block rounded-full flex-shrink-0"
          style={{ width: 7, height: 7, backgroundColor: cfg.dot }}
        />
        {showLabel && cfg.label}
      </span>
      {withExplanation && (
        <p className="text-[13px] leading-relaxed text-(--theme-text-muted) max-w-prose">
          {cfg.explanation}
        </p>
      )}
    </div>
  )
}
