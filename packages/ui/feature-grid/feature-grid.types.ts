import type { HTMLAttributes, ReactNode } from 'react'
import type { FeatureCardProps } from '../feature-card/feature-card.types'

export interface FeatureGridProps extends HTMLAttributes<HTMLDivElement> {
  /** Section title */
  title: string
  /** Optional subtitle */
  subtitle?: string
  /** Optional icon for the header */
  icon?: ReactNode
  /** Array of feature cards */
  features: FeatureCardProps[]
  /** Number of columns on desktop */
  columns?: 2 | 3 | 4
  /** Show CTA button */
  showCta?: boolean
  /** CTA button label */
  ctaLabel?: string
  /** CTA button href */
  ctaHref?: string
}
