/**
 * useDmInbox — Fetch the user's DmMessage inbox (cursor-paginated).
 *
 * ADR-152: Phase 2.5 — Globaler DM-Inbox-View.
 * Calls GET /api/nostr/dm/private-offers?ownerPubkey=<myPubkey>&limit=<n>[&after=<cursor>]
 * and returns pages of cached DmMessage rows (newest first). Use fetchNextPage
 * to load older pages — the server caps each page at 200 rows.
 *
 * The endpoint does NOT use requireAuth (only ownerPubkey query param),
 * so this hook reads the pubkey from localStorage like the other Dm code.
 *
 * Usage:
 *   const { data, isLoading, error, fetchNextPage, hasNextPage } = useDmInbox()
 *   const messages = data?.pages.flatMap((p) => p.messages) ?? []
 *
 * Returns an infinite query result; data.pages[0].totalCount is the real
 * total number of inbox rows.
 */

import {
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query'
import { apiCall, ApiError } from '../lib/api'
import type { DmMessage } from './useDmMessage'

export interface DmInboxPage {
  messages: DmMessage[]
  totalCount: number
  pageInfo: {
    hasNextPage: boolean
    endCursor: string | null
  }
}

const EMPTY_PAGE: DmInboxPage = {
  messages: [],
  totalCount: 0,
  pageInfo: { hasNextPage: false, endCursor: null },
}

export function useDmInbox(
  options?: { enabled?: boolean; limit?: number },
): UseInfiniteQueryResult<InfiniteData<DmInboxPage>, ApiError> {
  const ownerPubkey = typeof window !== 'undefined' ? localStorage.getItem('pubkey') : null
  const limit = options?.limit ?? 50

  return useInfiniteQuery<
    DmInboxPage,
    ApiError,
    InfiniteData<DmInboxPage>,
    readonly unknown[],
    string | null
  >({
    queryKey: ['dm-inbox', ownerPubkey, limit],
    enabled: (options?.enabled ?? true) && !!ownerPubkey,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    initialPageParam: null,
    queryFn: async ({ pageParam }) => {
      if (!ownerPubkey) return EMPTY_PAGE
      const params = new URLSearchParams({ ownerPubkey, limit: String(limit) })
      if (pageParam) params.set('after', pageParam)
      const res = await apiCall(`/api/nostr/dm/private-offers?${params.toString()}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to load inbox' }))
        throw new ApiError(res.status, err.error ?? 'Failed to load inbox', err)
      }
      return (await res.json()) as DmInboxPage
    },
    getNextPageParam: (lastPage) =>
      lastPage.pageInfo.hasNextPage ? lastPage.pageInfo.endCursor : undefined,
  })
}
