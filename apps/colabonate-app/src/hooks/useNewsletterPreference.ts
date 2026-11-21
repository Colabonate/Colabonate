/**
 * ADR-402 D15: the signed-in identity's own newsletter status.
 * Server: GET /api/newsletter/me, POST /api/newsletter/me/{subscribe,unsubscribe}.
 * Only addresses bound to the caller (account email or rows linked to the
 * pubkey) are returned; subscribing an unlinked address starts a double opt-in.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiCall } from '../lib/api'

export type MyNewsletterStatus = 'CONFIRMED' | 'PENDING' | 'UNSUBSCRIBED' | 'NOT_SUBSCRIBED'

export interface MyNewsletterAddress {
  email: string
  status: MyNewsletterStatus
  accountEmail: boolean
  emailVerified: boolean
  confirmedAt: string | null
  unsubscribedAt: string | null
}

interface MyNewsletterResponse {
  addresses: MyNewsletterAddress[]
}

const QUERY_KEY = ['newsletter', 'me'] as const

export function useNewsletterPreference(enabled = true) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: QUERY_KEY,
    enabled,
    queryFn: async (): Promise<MyNewsletterResponse> => {
      const res = await apiCall('/api/newsletter/me')
      return res.json()
    },
  })

  const onSuccess = (data: MyNewsletterResponse) => queryClient.setQueryData(QUERY_KEY, data)

  const subscribe = useMutation({
    mutationFn: async (email?: string): Promise<MyNewsletterResponse> => {
      const res = await apiCall('/api/newsletter/me/subscribe', {
        method: 'POST',
        body: JSON.stringify(email ? { email } : {}),
      })
      return res.json()
    },
    onSuccess,
  })

  const unsubscribe = useMutation({
    mutationFn: async (email?: string): Promise<MyNewsletterResponse> => {
      const res = await apiCall('/api/newsletter/me/unsubscribe', {
        method: 'POST',
        body: JSON.stringify(email ? { email } : {}),
      })
      return res.json()
    },
    onSuccess,
  })

  return {
    addresses: query.data?.addresses ?? [],
    isLoading: query.isLoading,
    loadError: query.error instanceof Error ? query.error.message : null,
    subscribe,
    unsubscribe,
  }
}
