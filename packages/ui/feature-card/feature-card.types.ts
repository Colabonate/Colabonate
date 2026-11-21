import type { HTMLAttributes, ReactNode } from 'react'

export interface FeatureCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Icon component to display (placeholder for future images) */
  icon: ReactNode
  /** Optional image URL – when provided, replaces icon with an <img> */
  image?: string
  /** Feature title */
  title: string
  /** Feature description */
  description: string
  /** Visual variant */
  variant?: 'default' | 'highlighted'
}
