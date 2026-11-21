// ADR-366 follow-on: shared owner-management actions for an Offer — the same
// publish/archive/toggle-active/delete operations the Sell Listings card menu
// exposes (ListingsTab.tsx), extracted so any surface showing one of the
// viewer's own offers (e.g. the marketplace detail page) can offer the same
// actions without reimplementing the NIP-09/Kind-5 delete fallback.
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiCall } from '../lib/api'
import type { Offer } from '../types/api'

export type OfferManageStatus = 'ACTIVE' | 'ARCHIVED' | 'DRAFT'

function invalidateOfferQueries(queryClient: QueryClient, offerId: string) {
  queryClient.invalidateQueries({ queryKey: ['listings'] })
  queryClient.invalidateQueries({ queryKey: ['offer', offerId] })
  queryClient.invalidateQueries({ queryKey: ['entity', offerId] })
  // Partial matches (no pubkey suffix) — react-query's default key matching
  // invalidates every query whose key starts with this prefix.
  queryClient.invalidateQueries({ queryKey: ['user-product-offers'] })
  queryClient.invalidateQueries({ queryKey: ['user-service-offers'] })
  queryClient.invalidateQueries({ queryKey: ['user-agent-offers'] })
  queryClient.invalidateQueries({ queryKey: ['user-all-offers'] })
}

export function useOfferListActions(pubkey: string) {
  const queryClient = useQueryClient()

  async function setStatus(offer: Offer, status: OfferManageStatus) {
    const res = await apiCall(`/api/offers/${offer.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, creatorPubkey: pubkey }),
    })
    if (!res.ok) throw new Error(`Failed to set offer status to ${status}`)
    invalidateOfferQueries(queryClient, offer.id)
  }

  // FU-472 (ADR-326 D6.1): agents toggle ACTIVE<->DRAFT directly, they don't
  // use the ARCHIVED state.
  async function toggleActive(offer: Offer) {
    await setStatus(offer, offer.status === 'ACTIVE' ? 'DRAFT' : 'ACTIVE')
  }

  async function deleteOffer(offer: Offer): Promise<void> {
    const response = await apiCall(`/api/offers/${offer.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ creatorPubkey: pubkey }),
    })

    if (response.status === 409) {
      const data = await response.json()
      if (data.needsKind5 && data.eventId) {
        const signed = await window.nostr?.signEvent({
          kind: 5,
          tags: [['e', data.eventId]],
          content: 'Deletion request for Colabonate offer',
          created_at: Math.floor(Date.now() / 1000),
        })
        if (!signed) {
          throw new Error('NIP-07 signing failed or was cancelled. Please try again with your Nostr extension.')
        }
        const relayUrls = import.meta.env.VITE_NOSTR_RELAY_URLS?.split(',') || [`ws://${window.location.hostname}:4001`]
        const relayResults = await Promise.allSettled(
          relayUrls.map((url: string) =>
            fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(signed),
            })
          )
        )
        if (relayResults.every(r => r.status === 'rejected')) {
          console.warn('Kind 5 event may not have reached all relays')
        }
        const retryResponse = await apiCall(`/api/offers/${offer.id}`, {
          method: 'DELETE',
          body: JSON.stringify({ creatorPubkey: pubkey }),
        })
        if (!retryResponse.ok) throw new Error('Failed to delete offer after Kind 5')
      } else {
        throw new Error(data.message || 'Unknown Nostr deletion error')
      }
    } else if (!response.ok) {
      throw new Error('Failed to delete offer')
    }

    invalidateOfferQueries(queryClient, offer.id)
  }

  return { setStatus, toggleActive, deleteOffer }
}
