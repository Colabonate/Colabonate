import type { HTMLAttributes } from 'react'

export type ReputationBadgeVariant = 'score' | 'level' | 'combined'
export type ReputationBadgeSize = 'small' | 'medium' | 'large'
export type IdentityLevelDisplay = 0 | 1 | 2 | 3

export interface ReputationBadgeProps extends HTMLAttributes<HTMLDivElement> {
  /** Reputation score 0.0–5.0 */
  score?: number
  /** Identity level 0–3 */
  identityLevel?: IdentityLevelDisplay
  /** COL-Points (shown in 'combined' variant) */
  colPoints?: number
  /** Display variant */
  variant?: ReputationBadgeVariant
  /** Size variant */
  size?: ReputationBadgeSize
  /** Show loading skeleton */
  loading?: boolean
}
