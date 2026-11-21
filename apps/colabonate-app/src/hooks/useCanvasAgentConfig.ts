/**
 * ADR-370 D4/D5 (Phase 4b + Phase 5 / FU-674): ticket canvas-agent re-seal.
 *
 * The seller's agent persona (LLM provider key, model, system prompt) is
 * stored on the Offer sealed to the SELLER's own key (ADR-306 D2). To hand it
 * to the ticket's canvas-agent runner (the Colabonate-side MCP client), the
 * seller re-seals it to the runner's per-ticket pubkey — the ticket-keyed
 * counterpart of useInjectWorkspaceConfig (useWorkspaceQueries.ts). The server
 * only ever stores/forwards ciphertext and never holds the runner's private
 * key or sees the persona plaintext (FU-195-C).
 *
 * Server contract (apps/server/routes/ticket-agent-runner.ts, seller only):
 *   GET  /api/tickets/:id/agent-runner-key    → { pubkey }
 *   POST /api/tickets/:id/agent-runner-config → { ok, status } — body
 *        { ciphertext } (NO senderPubkey — the endpoint takes ciphertext
 *        alone).
 *
 * Errors are surfaced untouched (react-query `error`) so callers can branch on
 * the ApiError CODE (e.g. TICKET_TERMINAL / NO_HOSTED_CANVAS) and show the
 * server's human-readable `.data.message` otherwise.
 */
import { useMutation } from '@tanstack/react-query'
import { apiCall } from '../lib/api'
import { getPrivkeyHex } from '../lib/nostr-identity'
import { sealForRecipient, unsealAgentConfig, toWorkspaceInjectedConfig } from '../lib/agentConfig'
import { fetchPinnedAgentConfig } from './useWorkspaceQueries'

// ADR-396 D1: same mapping as useInjectWorkspaceConfig (shared
// `toWorkspaceInjectedConfig`), so the canister and a canvas runner always
// receive the same persona shape.
export function useInjectCanvasAgentConfig(ticketId: string, opts?: { onSuccess?: () => void }) {
  const mutation = useMutation({
    // `offerId` stays in the signature for callers; the config itself comes
    // from the ticket's booking pin (ADR-396 D3), not from the offer.
    mutationFn: async (_args: { offerId: string }) => {
      const privkeyHex = getPrivkeyHex()

      // ADR-396 D3: the canvas runner gets the config pinned at booking.
      const sealed = await fetchPinnedAgentConfig(ticketId)
      if (!sealed) throw new Error('This offer has no sealed configuration to inject.')

      const secrets = await unsealAgentConfig(privkeyHex, sealed)

      const keyRes = await apiCall(`/api/tickets/${ticketId}/agent-runner-key`)
      const keyData = (await keyRes.json()) as { pubkey?: string }

      const config = toWorkspaceInjectedConfig(secrets)
      const ciphertext = sealForRecipient(privkeyHex, keyData.pubkey as string, config)

      const res = await apiCall(`/api/tickets/${ticketId}/agent-runner-config`, {
        method: 'POST',
        body: JSON.stringify({ ciphertext }),
      })
      return (await res.json()) as { ok: boolean; status: 'starting' | 'waiting_for_canvas' }
    },
    onSuccess: () => {
      opts?.onSuccess?.()
    },
  })

  return {
    inject: mutation.mutate,
    isPending: mutation.isPending,
    error: mutation.error,
  }
}