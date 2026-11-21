import type { HTMLAttributes, ReactNode } from 'react'

export interface ActionItem {
  icon: ReactNode
  label: string
  to: string
}

export interface UserSectionProps extends HTMLAttributes<HTMLDivElement> {
  /** User display name */
  name: string
  /** Lightning address */
  lnAddress?: string
  /** Avatar image URL */
  avatarUrl?: string
  /** Action buttons (Wallet, Settings, Profil) */
  actions: ActionItem[]
}
