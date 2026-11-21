import type { HTMLAttributes } from 'react'

export interface ProviderCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Provider display name */
  name: string
  /** Provider category */
  category: string
  /** Avatar image URL */
  avatarUrl?: string
  /** Rating 0–5 */
  rating?: number
  /** Price range display string (e.g. "500–2000 sats") */
  priceRange?: string
  /** Is this provider in the user's favorites? */
  isFavorite?: boolean
  /** Called when favorite toggle is clicked */
  onFavoriteToggle?: () => void
}
