import type { HTMLAttributes } from 'react'

export interface PartnerAvatarProps extends HTMLAttributes<HTMLDivElement> {
  /** Partner display name */
  name: string
  /** Partner role */
  role: string
  /** Avatar image URL */
  avatarUrl?: string
  /** Click handler */
  onClick?: () => void
}
