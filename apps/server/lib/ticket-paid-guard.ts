export interface TicketPaidGuardInput {
  fromStatus: string
  toStatus: string
  directPayRail: string | null
  sellerPubkey: string
  authPubkey: string
}

// ADR-253 / ADR-394: the transition INTO PAID from a pre-payment state
// (PENDING or ACCEPTED) must not be freely settable through the generic
// PATCH /api/tickets/:id route — without this guard EITHER party could set
// PAID with no payment proof at all, bypassing the preimage check in
// POST /api/tickets/:id/confirm-direct-payment (LN rail) or any
// webhook/hold-invoice settlement (escrow/custodial). ADR-394 closed the
// ACCEPTED gap: an AGENT_SETUP ticket born ACCEPTED (requireHumanApproval
// =false) previously slipped through because only PENDING was checked.
// The one exception is the Cashu rail, where redemption itself is the only
// available proof — the SELLER (the only one who can redeem a P2PK-locked
// token) may self-report PAID. Returns true when the transition is ALLOWED.
export function canSelfReportPaid(input: TicketPaidGuardInput): boolean {
  if (input.toStatus !== 'PAID') return true
  const isPrePaymentState = input.fromStatus === 'PENDING' || input.fromStatus === 'ACCEPTED'
  if (!isPrePaymentState) return true
  return input.directPayRail === 'CASHU' && input.authPubkey === input.sellerPubkey
}
