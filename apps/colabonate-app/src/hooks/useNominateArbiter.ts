/**
 * useNominateArbiter — Nominate an npub as the mutual arbiter for a ticket.
 *
 * ADR-152 §A4 / PROB-002 A2: Phase 2.7 — Mutual-Arbiter UI.
 * Calls `POST /api/tickets/:id/nominate-arbiter` with the caller's pubkey and
 * the npub they want to nominate. The server stores the nomination; the other
 * party must also nominate the same npub before the arbiter can accept.
 *
 * Usage:
 *   const nominate = useNominateArbiter(ticketId)
 *   nominate.mutate({ callerPubkey, arbiterPubkey })
 *
 * Server response (success):
 *   { nomination: PrivateArbiterNomination, awaiting: 'other_party_nomination' | 'arbiter_acceptance' }
 *
 * On 409, the server returns:
 *   { error: 'MUTUAL_ARBITER_NOT_APPLICABLE' } (disputeMode !== PRIVATE)
 *   { error: 'Arbiter has already accepted — dispute can be opened' }
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiCall, ApiError } from '../lib/api'
import type { PrivateArbiterNomination } from '../types/api'

interface NominateArbiterInput {
  callerPubkey: string
  arbiterPubkey: string
}

interface NominateArbiterResponse {
  nomination: PrivateArbiterNomination
  awaiting: 'other_party_nomination' | 'arbiter_acceptance'
}

export function useNominateArbiter(ticketId: string) {
  const queryClient = useQueryClient()
  return useMutation<NominateArbiterResponse, ApiError, NominateArbiterInput>({
    mutationFn: async (body) => {
      const res = await apiCall(`/api/tickets/${ticketId}/nominate-arbiter`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to nominate arbiter' }))
        throw new ApiError(res.status, err.error ?? 'Failed to nominate arbiter', err)
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['arbiters', ticketId] })
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] })
    },
  })
}
