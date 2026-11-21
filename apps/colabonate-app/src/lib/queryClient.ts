import { QueryClient } from '@tanstack/react-query'
import type { PersistQueryClientProviderProps } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'

// ADR-294 D5: single source of truth for the persisted-cache key and buster.
// main.tsx (snapshot seeding) and scripts/prerender.mjs must stay in sync with
// these values. Bump the buster on any cache-format change so old entries are
// discarded instead of misread.
export const QUERY_CACHE_STORAGE_KEY = 'TANSTACK_QUERY_OFFLINE_CACHE'
// ADR-372: bumped v1 → v2 to discard stale persisted query-cache entries whose
// shape predates the `data.tickets` unwrap in useUserTickets — those were
// hydrating `['user-tickets', pubkey]` as the raw `{ tickets, edges }` object,
// which crashed BuyOrders with `ticketData.filter is not a function` on the
// first synchronous render before the refetch could correct it.
// ADR-376: bumped v2 → v3 — `['coop-explore-data']` no longer exists (D1
// decomposed it into canonical per-entity keys); any persisted entry under
// the old key is now permanently unread dead weight, discarded on next boot.
export const QUERY_CACHE_BUSTER = 'v3'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 300_000,
      retry: (failureCount, error: any) => {
        // Do not retry on 401, 403, 404
        if (error?.status === 401 || error?.status === 403 || error?.status === 404) {
          return false
        }
        // Always retry on 429 Rate Limit
        if (error?.status === 429) {
          return true
        }
        return failureCount < 2
      },
      retryDelay: (attemptIndex, error: any) => {
        // Longer backoff for 429 Rate Limit
        if (error?.status === 429) {
          return Math.min(1000 * 2 ** (attemptIndex + 1), 60_000)
        }
        return Math.min(1000 * 2 ** attemptIndex, 30_000)
      },
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 1,
    },
  },
})

// ADR-294 D1 (Baustein A): the persister is no longer wired via the
// fire-and-forget `persistQueryClient()` side effect at module import — its
// async restore was never awaited, so Home re-fetched everything on every
// reload before its own persisted cache was restored. main.tsx passes these
// options to `PersistQueryClientProvider`, which pauses queries
// (`isRestoring`) until the localStorage restore finished, giving
// stale-while-revalidate behavior on reload.
export const persistOptions: NonNullable<PersistQueryClientProviderProps['persistOptions']> = {
  persister: createSyncStoragePersister({
    storage: window.localStorage,
    key: QUERY_CACHE_STORAGE_KEY,
    throttleTime: 1000,
  }),
  maxAge: 1000 * 60 * 60 * 24, // 24 hours
  buster: QUERY_CACHE_BUSTER,
}
