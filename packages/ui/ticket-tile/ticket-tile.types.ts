import type { HTMLAttributes } from 'react'

export type TicketTileVariant = 'overview' | 'pending' | 'list'

export interface TicketData {
  id: string
  title: string
  status: string
  amountSats?: number
  createdAt: string
}

export interface TicketTileProps extends HTMLAttributes<HTMLDivElement> {
  /** Display variant */
  variant: TicketTileVariant
  /** Ticket data to render */
  ticket: TicketData
  /** Status label mapping */
  statusLabel?: string
  /** Status color class (Tailwind) */
  statusColorClass?: string
  /** Click handler */
  onClick?: () => void
}
