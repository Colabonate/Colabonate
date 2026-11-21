export type IdentityLevel = 0 | 1 | 2 | 3

export interface IdentityData {
  pubkey: string
  identityLevel: IdentityLevel
  nostrPubkey?: string
  nip05?: string
  picture?: string
  /** Nostr Kind 0 display metadata (synced fill-once, display-only) */
  name?: string
  about?: string
  banner?: string
  colPoints: number
  reputationScore: number
  reviewCount: number
}

export interface Review {
  id: string
  ticketId: string
  reviewerPubkey: string
  revieweePubkey: string
  stars: number
  content: string
  nostrEventId?: string
  createdAt: string
}

export interface ColPointsHistoryEntry {
  id: string
  pubkey: string
  delta: number
  reason: string
  ticketId?: string
  createdAt: string
}

export interface SubmitReviewInput {
  ticketId: string
  reviewerPubkey: string
  revieweePubkey: string
  stars: number
  content: string
  nostrEventId?: string
}

export interface ReviewsResponse {
  reviews: Review[]
  averageStars: number
  totalCount: number
}
