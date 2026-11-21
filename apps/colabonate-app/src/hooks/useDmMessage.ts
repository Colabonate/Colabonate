/**
 * useDmMessage — Fetch a single DmMessage (cached gift-wrapped event) by id.
 *
 * ADR-152: Phase 2.3 — Privat-Offer-Detail-Page.
 * The DmMessage is the local cache of a decrypted NIP-17 gift wrap. The
 * `payload` field is the JSON-decrypted content of the inner rumor.
 *
 * Usage:
 *   const { data, isLoading, error } = useDmMessage(messageId)
 *
 * Returns null when the message is not found or the query is disabled.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { apiCall, ApiError } from '../lib/api'

/** Raw DmMessage row as returned by GET /api/nostr/dm/private-offers/:id */
export interface DmMessage {
  id: string
  ownerPubkey: string
  peerPubkey: string
  eventId: string
  kind: number // 14 = chat (legacy plaintext), 1059 = gift wrap
  payload: string // JSON-encoded decrypted content
  ticketId: string | null
  visibility: 'PUBLIC' | 'PRIVATE'
  createdAt: string
}

/**
 * Decrypted payload of a private offer DM.
 * Shape: { type: 'offer' | 'cooperation' | 'message' | 'counter' | ..., offerId, title, ... }
 */
export interface PrivateOfferPayload {
  type: 'offer' | 'cooperation' | 'message' | 'counter' | string
  offerId?: string
  cooperationId?: string
  title?: string
  description?: string
  priceSats?: number
  categoryCode?: string
  images?: string[]
  creatorPubkey?: string
  deliveryTimeDays?: number
  deliveryCostSats?: number
  deliveryNotes?: string
  // Counter-offer specific
  counterPriceSats?: number
  counterNotes?: string
  // Free-text message
  message?: string
}

export function useDmMessage(
  id: string | undefined | null,
  options?: { enabled?: boolean },
): UseQueryResult<{ message: DmMessage; payload: PrivateOfferPayload | null }, ApiError> {
  return useQuery<{ message: DmMessage; payload: PrivateOfferPayload | null }, ApiError>({
    queryKey: ['dm-message', id],
    enabled: (options?.enabled ?? true) && !!id,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!id) throw new ApiError(0, 'No message id provided')
      const res = await apiCall(`/api/nostr/dm/private-offers/${id}`)
      if (res.status === 404) {
        throw new ApiError(404, 'DmMessage not found')
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to load message' }))
        throw new ApiError(res.status, err.error ?? 'Failed to load message', err)
      }
      const data = await res.json()
      const message: DmMessage = data.message
      let payload: PrivateOfferPayload | null = null
      try {
        payload = message.payload ? JSON.parse(message.payload) : null
      } catch {
        // Payload is not valid JSON — treat as plain text message
        payload = { type: 'message', message: message.payload }
      }
      return { message, payload }
    },
  })
}
