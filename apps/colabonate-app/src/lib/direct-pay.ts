import { apiCall } from './api'

/**
 * ADR-253: after a *successful* wallet payment, a non-escrow direct-pay ticket
 * must be self-confirmed with the preimage the wallet returned — its invoice
 * belongs to the seller, so the platform never registered it and polling can
 * never observe it (the FU-757 bug: funds arrived, the ticket stayed PENDING).
 *
 * Pure so the gate is unit-testable: beta uses the DEMO rail (server-confirmed
 * by /api/beta/demo-pay), escrow tickets keep the hold-invoice poll, and a
 * wallet that exposes no preimage (older integrations) falls back to polling.
 */
export function shouldSelfConfirmDirectPayment(input: {
  isBeta: boolean
  isEscrow: boolean
  preimage?: string | null
}): boolean {
  return !input.isBeta && !input.isEscrow && Boolean(input.preimage)
}

/**
 * A direct-pay LN ticket's invoice belongs to the seller, so the
 * platform never had it and has no webhook/poll to observe. The buyer's
 * payment preimage is the only proof available — submit it to advance the
 * ticket to PAID (reuses the same `confirmPaymentByHash` state machine as
 * every other confirmation path).
 *
 * NWC, WebLN and Alby OAuth expose the preimage; a buyer paying from an
 * arbitrary external wallet can paste it on the ticket page (FU-755).
 */
export async function confirmDirectPayment(ticketId: string, preimage: string): Promise<void> {
  await apiCall(`/api/tickets/${ticketId}/confirm-direct-payment`, {
    method: 'POST',
    body: JSON.stringify({ preimage }),
  })
}
