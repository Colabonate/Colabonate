/**
 * useArbiterVerdict — Submit a private-arbiter verdict for a disputed ticket.
 *
 * ADR-152 §A4 / PROB-002 A2: Phase 2.8 — Private-Verdict (NIP-17-DM-signed).
 *
 * Flow:
 *  1. The hook signs a Kind 30022 Nostr event client-side via
 *     `signVerdictIntent(arbiterPubkey, ticketId, outcome, reasoning)`.
 *     The event's Schnorr signature proves the caller controls the
 *     privkey for the nominated+accepted arbiter pubkey.
 *  2. The signed event is POSTed to `/api/tickets/:id/private-verdict`.
 *  3. The server:
 *     - verifies the signature (verifyEvent)
 *     - confirms the caller is the accepted arbiter for the ticket
 *     - settles (RELEASE) or cancels (CANCEL) the hold invoices
 *     - updates ticket + dispute + privateArbiter rows
 *     - writes DmMessage inbox rows for buyer + seller (notification)
 *
 * Usage:
 *   const submit = useArbiterVerdict()
 *   submit.mutate({ ticketId, arbiterPubkey, outcome: 'RELEASE', reasoning: '...' })
 *
 * On success, the `useTicket` + `useArbiters` queries are invalidated so
 * the UI reflects the new ticket status (COMPLETED / CANCELLED) and the
 * accepted nomination row carries the verdict metadata.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiCall, ApiError } from '../lib/api'
import { signVerdictIntent } from '../lib/nostr'
import type { MutualArbiterPhase } from '../types/api'

export type PrivateVerdictOutcome = 'RELEASE' | 'CANCEL'

export interface SubmitPrivateVerdictInput {
  ticketId: string
  arbiterPubkey: string
  outcome: PrivateVerdictOutcome
  reasoning?: string
}

export interface PrivateVerdictResult {
  success: true
  verdict: {
    outcome: PrivateVerdictOutcome
    escrowAction: 'released' | 'cancelled' | 'partial_failure'
    escrowFailures?: string[]
    signedEventId: string
  }
  nostrEventTemplate: {
    kind: 30022
    pubkey: string
    created_at: number
    tags: string[][]
    content: string
  }
}

export function useArbiterVerdict() {
  const queryClient = useQueryClient()
  return useMutation<PrivateVerdictResult, ApiError, SubmitPrivateVerdictInput>({
    mutationFn: async ({ ticketId, arbiterPubkey, outcome, reasoning }) => {
      // Step 1: client-side sign (proves ownership of arbiter privkey)
      const signedEvent = await signVerdictIntent(arbiterPubkey, ticketId, outcome, reasoning)
      // Step 2: POST to server (server verifies signature + applies verdict)
      const res = await apiCall(`/api/tickets/${ticketId}/private-verdict`, {
        method: 'POST',
        body: JSON.stringify({
          arbiterPubkey,
          outcome,
          reasoning: reasoning ?? '',
          signedEvent,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to submit private verdict' }))
        throw new ApiError(res.status, err.error ?? 'Failed to submit private verdict', err)
      }
      return res.json()
    },
    onSuccess: (_data, variables) => {
      // Invalidate queries so the panel + ticket view reflect the new state
      queryClient.invalidateQueries({ queryKey: ['arbiters', variables.ticketId] })
      queryClient.invalidateQueries({ queryKey: ['ticket', variables.ticketId] })
      queryClient.invalidateQueries({ queryKey: ['dispute'] })
      queryClient.invalidateQueries({ queryKey: ['dm-inbox'] })
    },
  })
}

/**
 * Pure helper: which UI states should the verdict card appear in?
 *
 * - arbiter role (the only role allowed to submit)
 * - phase === 'ACCEPTED' (arbiter must have accepted the role)
 * - ticket.status === 'DISPUTED' (a dispute must be open)
 * - the nomination row must not already carry a verdictOutcome
 */
export interface ShowVerdictCardArgs {
  viewerRole?: 'buyer' | 'seller' | 'arbiter' | null
  phase: MutualArbiterPhase
  ticketStatus: string
  nomination: { verdictOutcome: 'RELEASE' | 'CANCEL' | 'SPLIT' | null } | null
}

export function shouldShowVerdictCard(args: ShowVerdictCardArgs): boolean {
  if (args.viewerRole !== 'arbiter') return false
  if (args.phase !== 'ACCEPTED') return false
  if (args.ticketStatus !== 'DISPUTED') return false
  if (args.nomination?.verdictOutcome) return false
  return true
}
