import type { HTMLAttributes, ReactNode } from 'react'

export interface AddressBlockProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Street + house number. */
  address?: string | null
  zipCode?: string | null
  city?: string | null
  country?: string | null
  /** Section header label (default: "Address"). */
  label?: string
  /** Show the map-pin icon. */
  showIcon?: boolean
  /** Optional slot for a map/geocoding link (FU-648 — not built yet). */
  mapLinkSlot?: ReactNode
}
