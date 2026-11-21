export interface ChatRoomMessage {
  id: string
  pubkey: string
  content: string
  createdAt: number
}

/** Display identity resolved for a message author (e.g. Nostr Kind-0 metadata). */
export interface ChatRoomProfile {
  name?: string
  picture?: string
}

export interface ChatRoomProps {
  messages: ChatRoomMessage[]
  myPubkey: string
  onSendMessage: (content: string) => Promise<void>
  loading?: boolean
  disabled?: boolean
  formatSender?: (pubkey: string) => string
  /** Optional author profiles keyed by hex pubkey (display name + avatar picture). */
  profiles?: Record<string, ChatRoomProfile>
  /** Optional timestamp formatter (date + time). Defaults to a short locale string. */
  formatTimestamp?: (createdAt: number) => string
  className?: string
}
