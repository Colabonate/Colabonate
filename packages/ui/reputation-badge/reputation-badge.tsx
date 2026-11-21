import { cn } from '@ds/utils'
import type { ReputationBadgeProps, IdentityLevelDisplay } from './reputation-badge.types'

const LEVEL_LABEL: Record<IdentityLevelDisplay, string> = {
  0: 'Anonymous',
  1: 'Nostr',
  2: 'Peer',
  3: 'HID',
}

const LEVEL_COLOR_CLASS: Record<IdentityLevelDisplay, string> = {
  0: 'rep-badge--level-0',
  1: 'rep-badge--level-1',
  2: 'rep-badge--level-2',
  3: 'rep-badge--level-3',
}

const SIZE_CLASS: Record<NonNullable<ReputationBadgeProps['size']>, string> = {
  small:  'rep-badge--sm',
  medium: 'rep-badge--md',
  large:  'rep-badge--lg',
}

function StarIcon({ fill = 'currentColor' }: { fill?: string }) {
  return (
    <svg width="1em" height="1em" viewBox="0 0 16 16" fill={fill} aria-hidden="true">
      <path d="M8 1l1.9 3.8L14 5.6l-3 2.9.7 4.1L8 10.4l-3.7 2.2.7-4.1-3-2.9 4.1-.8L8 1z" />
    </svg>
  )
}

export function ReputationBadge({
  score,
  identityLevel = 0,
  colPoints,
  variant = 'score',
  size = 'medium',
  loading = false,
  className,
  ...props
}: ReputationBadgeProps) {
  if (loading) {
    return (
      <div
        className={cn('rep-badge rep-badge--loading', SIZE_CLASS[size], className)}
        aria-busy="true"
        {...props}
      />
    )
  }

  const scoreDisplay = score !== undefined ? score.toFixed(1) : '–'
  const levelLabel = LEVEL_LABEL[identityLevel]

  return (
    <div
      className={cn(
        'rep-badge',
        SIZE_CLASS[size],
        LEVEL_COLOR_CLASS[identityLevel],
        className
      )}
      {...props}
    >
      {(variant === 'score' || variant === 'combined') && score !== undefined && (
        <span className="rep-badge__score">
          <StarIcon />
          <span className="rep-badge__score-value">{scoreDisplay}</span>
        </span>
      )}

      {(variant === 'level' || variant === 'combined') && (
        <span className="rep-badge__level">
          L{identityLevel}
          {size !== 'small' && <span className="rep-badge__level-label"> {levelLabel}</span>}
        </span>
      )}

      {variant === 'combined' && colPoints !== undefined && size === 'large' && (
        <span className="rep-badge__col-points">
          {colPoints.toLocaleString()} pts
        </span>
      )}
    </div>
  )
}
