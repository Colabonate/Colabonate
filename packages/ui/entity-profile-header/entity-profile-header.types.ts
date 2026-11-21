import type { HTMLAttributes, ReactNode } from 'react'

export type EntityProfileHeaderVariant = 'user' | 'company'

export interface EntityProfileHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Which identity shape the header renders — controls avatar fallback icon + shape. */
  variant: EntityProfileHeaderVariant
  /** Full-bleed background image (Kind 0 banner / Company bannerUrl). */
  bannerUrl?: string | null
  /** Avatar/logo image overlaying the banner (or standalone when no banner). */
  avatarUrl?: string | null
  /** Display name / company name. */
  title: string
  /** Node rendered below the title row (NIP-05, about, city, etc.). */
  subtitle?: ReactNode
  /** Inline nodes rendered right of the title (identity-level badge, status chip, etc.). */
  badges?: ReactNode
  /** Fallback content shown in place of the avatar (defaults to the first title letter). */
  avatarFallback?: ReactNode
}
