/**
 * useAcceptArbiter — Accept the mutual-arbiter role for a ticket.
 *
 * ADR-152 §A4 / PROB-002 A2: Phase 2.7 — Mutual-Arbiter UI.
 * Calls `POST /api/tickets/:id/accept-arbiter` with the nominated npub and
 * an optional `arbiterSignature` (Phase 2.8 will verify a NIP-17 DM-signed
 * intent; for now the server flips the `acceptedAt` timestamp whenever the
 * server-side check passes).
 *
 * Server-side guards (Phase 1.6):
 *   - 404 if no nomination row exists for this (ticketId, arbiterPubkey)
 *   - 409 { error: 'BOTH_PARTIES_REQUIRED' } if buyer or seller hasn't
 *     nominated yet
 *
 * Usage:
 *   const accept = useAcceptArbiter(ticketId)
 *   accept.mutate({ arbiterPubkey, arbiterSignature? })
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiCall, ApiError } from '../lib/api'
import type { PrivateArbiterNomination } from '../types/api'

interface AcceptArbiterInput {
  arbiterPubkey: string
  /** Optional NIP-17 signed intent — Phase 2.8 will populate this */
  arbiterSignature?: string
}

interface AcceptArbiterResponse {
  nomination: PrivateArbiterNomination
  status: 'accepted'
}

export function useAcceptArbiter(ticketId: string) {
  const queryClient = useQueryClient()
  return useMutation<AcceptArbiterResponse, ApiError, AcceptArbiterInput>({
    mutationFn: async (body) => {
      const res = await apiCall(`/api/tickets/${ticketId}/accept-arbiter`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to accept arbiter role' }))
        throw new ApiError(res.status, err.error ?? 'Failed to accept arbiter role', err)
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['arbiters', ticketId] })
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] })
    },
  })
}
