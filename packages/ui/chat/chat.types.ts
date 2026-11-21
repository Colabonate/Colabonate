export interface ChatMessage {
  id: string
  pubkey: string
  content: string
  createdAt: number
  isOwn: boolean
}

export interface ChatProps {
  messages: ChatMessage[]
  myPubkey: string
  otherPartyPubkey: string
  onSendMessage: (content: string) => Promise<void>
  loading?: boolean
}

export interface ChatInputProps {
  onSend: (content: string) => Promise<void>
  disabled?: boolean
  placeholder?: string
}

export interface ChatBubbleProps {
  content: string
  isOwn: boolean
  timestamp: number
}