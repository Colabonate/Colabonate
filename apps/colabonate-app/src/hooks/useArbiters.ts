/**
 * useArbiters — Fetch the mutual-arbiter nomination state for a ticket.
 *
 * ADR-152 §A4 / PROB-002 A2: Phase 2.7 — Mutual-Arbiter UI.
 * Calls `GET /api/tickets/:id/arbiters` and returns the list of
 * `PrivateArbiterNomination` rows plus the `ready_for_dispute` flag.
 *
 * The route is **not gated by requireAuth** in the server implementation
 * (Phase 1.6), so the hook works for any caller — the server only
 * exposes nomination state, never writes.
 *
 * Usage:
 *   const { data, isLoading, error, refetch } = useArbiters(ticketId)
 *   if (data?.ready_for_dispute) ... // arbiter accepted
 *
 * Returns null when the ticket has no nominations yet or the query is disabled.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { apiCall, ApiError } from '../lib/api'
import type { ArbitersState, MutualArbiterPhase } from '../types/api'

export function useArbiters(
  ticketId: string | undefined | null,
  options?: { enabled?: boolean; refetchInterval?: number },
): UseQueryResult<ArbitersState, ApiError> {
  return useQuery<ArbitersState, ApiError>({
    queryKey: ['arbiters', ticketId],
    enabled: (options?.enabled ?? true) && !!ticketId,
    staleTime: 30_000,
    refetchInterval: options?.refetchInterval,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!ticketId) throw new ApiError(0, 'No ticket id provided')
      const res = await apiCall(`/api/tickets/${ticketId}/arbiters`)
      if (res.status === 404) {
        throw new ApiError(404, 'Ticket not found')
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to load arbiters' }))
        throw new ApiError(res.status, err.error ?? 'Failed to load arbiters', err)
      }
      const data: ArbitersState = await res.json()
      return data
    },
  })
}

/**
 * Pure helper: derive a human-readable phase from the raw `ArbitersState`.
 * Mirrors the server-side state machine (Phase 1.6 dispute.ts):
 *   NONE → ONE_NOMINATED → BOTH_NOMINATED → ACCEPTED
 *   any-state → REJECTED (only if a nomination has `rejectedAt` set).
 */
export function deriveArbiterPhase(state: ArbitersState | undefined | null): MutualArbiterPhase {
  if (!state) return 'NONE'
  const noms = state.nominations ?? []
  if (noms.length === 0) return 'NONE'

  const anyRejected = noms.some((n) => n.rejectedAt)
  if (anyRejected) return 'REJECTED'

  const anyAccepted = noms.some((n) => n.acceptedAt)
  if (anyAccepted) return 'ACCEPTED'

  const fullyNominated = noms.some(
    (n) => n.nominatedByBuyer && n.nominatedBySeller,
  )
  if (fullyNominated) return 'BOTH_NOMINATED'

  return 'ONE_NOMINATED'
}
