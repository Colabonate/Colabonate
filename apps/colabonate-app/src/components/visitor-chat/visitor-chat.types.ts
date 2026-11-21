export interface Visitor {
  pubkey: string
  lastMessageAt: number
  hasChat: boolean
}

export interface VisitorChatProps {
  offerId: string
  sellerPubkey: string
  onVisitorNotification?: (pubkey: string) => void
}