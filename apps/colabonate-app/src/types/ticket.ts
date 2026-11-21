export type TicketStatus = 'open' | 'in-progress' | 'pending' | 'resolved' | 'disputed'
export type TicketType = 'transaction' | 'cooperation' | 'dispute' | 'general'
export type TicketPriority = 'low' | 'medium' | 'high'

export type EscrowStatus = 'pending' | 'held' | 'released' | 'refunded'

export interface Escrow {
  amount: number
  currency: 'sats' | 'eur'
  status: EscrowStatus
  releaseConditions: string[]
}

export interface Dispute {
  reason: string
  initiatedBy: string
  evidence: string[] // File URLs
  mediator?: string
  resolution?: string
}

export interface Ticket {
  id: string
  title: string
  description: string
  status: TicketStatus
  type: TicketType
  createdAt: string
  updatedAt: string
  parties: string[] // User IDs
  assignee?: string // User ID
  priority: TicketPriority
  
  // Escrow-specific
  escrow?: Escrow
  
  // Dispute-specific
  dispute?: Dispute
  
  // References
  offerId?: string
  sellerPubkey?: string
  buyerPubkey?: string
}

export interface TicketComment {
  id: string
  ticketId: string
  authorPubkey: string
  authorLnAddress?: string
  content: string
  createdAt: string
  mentions?: string[]
  attachments?: string[]
}

export interface CreateTicketInput {
  title: string
  description: string
  type: TicketType
  priority: TicketPriority
  offerId?: string
  sellerPubkey?: string
  buyerPubkey?: string
}

export interface CreateCommentInput {
  ticketId: string
  content: string
  mentions?: string[]
  attachments?: string[]
}
