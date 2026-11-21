/**
 * ADR-399 D4: pure helpers behind the ticket payment card, one view for every
 * payment rail (Lightning, Cashu, demo, legacy escrow).
 */

export type TicketPaymentRail = 'LN' | 'CASHU' | 'DEMO' | 'ESCROW'

export type TicketPaymentPhase = 'awaiting' | 'token-sent' | 'paid' | 'cancelled' | 'fee-pending'

export interface TicketPaymentInput {
  status: string
  directPayRail?: string | null
  escrowEnabled?: boolean
  lightningInvoice?: string | null
  sellerInvoiceSource?: string | null
  sellerVerifyUrl?: string | null
  cashuTokenSentAt?: string | null
  /** Preimage of the settled seller invoice — set once the seller leg is confirmed. */
  preimage?: string | null
  /** ADR-372 fee row — the second leg of a hosted-canvas purchase. */
  platformFee?: { status?: string | null; sellerLegConfirmedAt?: string | null } | null
}

export interface TicketPaymentView {
  rail: TicketPaymentRail
  phase: TicketPaymentPhase
  /** The buyer can still pay (ticket not paid, cancelled, or past payment). */
  canPay: boolean
  /** The server can notice the payment without the buyer's preimage (ADR-399 D2). */
  autoDetect: boolean
}

const AWAITING_STATUSES = new Set(['PENDING', 'ACCEPTED'])

/** Returns null for legacy tickets that carry no payment at all. */
export function deriveTicketPaymentView(ticket: TicketPaymentInput, paidLocally = false): TicketPaymentView | null {
  let rail: TicketPaymentRail | null = null
  if (ticket.escrowEnabled) rail = ticket.lightningInvoice ? 'ESCROW' : null
  else if (ticket.directPayRail === 'LN' || ticket.directPayRail === 'CASHU' || ticket.directPayRail === 'DEMO') rail = ticket.directPayRail
  else if (ticket.lightningInvoice) rail = 'LN'
  if (!rail) return null

  const awaiting = AWAITING_STATUSES.has(ticket.status) && !paidLocally
  let phase: TicketPaymentPhase
  if (ticket.status === 'CANCELLED') phase = 'cancelled'
  else if (!awaiting) phase = 'paid'
  // ADR-372 D7.3 two-confirm gate: a hosted-canvas purchase is price + fee.
  // Once the seller leg is confirmed the price is PAID, but the ticket stays
  // PENDING until the platform fee is confirmed too. Reading only the ticket
  // status would tell both parties "awaiting payment" for money that already
  // arrived — and would offer the buyer a "Pay" button on the settled seller
  // invoice (the wallet then answers "invoice already paid").
  else if (isFeePaid(ticket)) phase = 'paid'
  else if (isFeePending(ticket)) phase = 'fee-pending'
  else if (rail === 'CASHU' && ticket.cashuTokenSentAt) phase = 'token-sent'
  else phase = 'awaiting'

  const source = ticket.sellerInvoiceSource
  const autoDetect =
    rail === 'LN' && (source === 'NWC' || source === 'ALBY_OAUTH' || (source === 'LNURL' && Boolean(ticket.sellerVerifyUrl)))

  return { rail, phase, canPay: phase === 'awaiting', autoDetect }
}

/** The seller invoice is settled: the price leg is done. */
function isSellerLegConfirmed(ticket: TicketPaymentInput): boolean {
  return Boolean(ticket.preimage) || Boolean(ticket.platformFee?.sellerLegConfirmedAt)
}

/**
 * Both legs are done — the ticket status may still lag for a moment (the
 * reconcile tick flips it), the money is in.
 */
function isFeePaid(ticket: TicketPaymentInput): boolean {
  return ticket.platformFee?.status === 'PAID' && isSellerLegConfirmed(ticket)
}

/**
 * The seller leg is confirmed and the platform fee is still open: the price is
 * paid, the ticket only waits for the second (buyer → Colabonate) leg.
 */
function isFeePending(ticket: TicketPaymentInput): boolean {
  return ticket.platformFee?.status === 'PENDING' && isSellerLegConfirmed(ticket)
}

/**
 * ADR-413 D5: the escrow panel only belongs on a ticket that actually used
 * escrow. A direct-pay ticket (escrowEnabled = false — the production default
 * per the ADR-381 production escrow guard) has no escrow, so an "Escrow
 * pending" card with the full amount would claim a state that does not exist.
 */
export function showsEscrowPanel(ticket: { ticketType?: string | null; escrowEnabled?: boolean | null }): boolean {
  return ticket.ticketType === 'SMART_ORDER' && Boolean(ticket.escrowEnabled)
}

/** True while the seller leg is confirmed and the platform fee is still open. */
export function isFeePendingTicket(ticket: TicketPaymentInput): boolean {
  return isFeePending(ticket)
}

/**
 * The one-line state of the order tracker. It must agree with the payment
 * card — a tracker that still says "waiting for buyer payment" next to a card
 * that says "price received" is the same defect as the card itself (ADR-413).
 */
export function orderHeadline(
  ticket: { status: string },
  roles: { isBuyer: boolean; isSeller: boolean; isService: boolean },
): string {
  const { isBuyer, isSeller, isService } = roles
  if (ticket.status === 'PENDING') {
    if (isFeePendingTicket(ticket as TicketPaymentInput)) {
      return isSeller ? 'Price received — waiting for the platform fee' : 'Price paid — the platform fee is still open'
    }
    if (isSeller) return isService ? 'Review and accept the request to begin' : 'Waiting for buyer payment'
    return 'Waiting for seller confirmation'
  }
  if (ticket.status === 'PAID') {
    return isSeller ? 'Payment received — confirm to start fulfillment' : 'Payment confirmed — waiting for seller to start'
  }
  if (ticket.status === 'IN_PROGRESS') {
    return isBuyer ? 'Work is underway — release payment when done' : 'Complete and deliver your work'
  }
  if (ticket.status === 'COMPLETED') return 'Transaction completed'
  if (ticket.status === 'DISPUTED') return 'Dispute in progress'
  return ticket.status
}

export const PAYMENT_RAIL_LABEL: Record<TicketPaymentRail, string> = {
  LN: 'Lightning',
  CASHU: 'Cashu eCash',
  DEMO: 'Demo wallet',
  ESCROW: 'Lightning escrow',
}

export const PAYMENT_PHASE_LABEL: Record<TicketPaymentPhase, string> = {
  awaiting: 'Awaiting payment',
  'token-sent': 'Token sent',
  paid: 'Paid',
  cancelled: 'Cancelled',
  'fee-pending': 'Paid — fee pending',
}

/**
 * Mints that hold enough eCash to cover `amountSats`, largest balance first.
 * The melt fee reserve is only known after a quote, so callers still check
 * `requiredSats` against the balance per candidate.
 */
export function meltMintCandidates(
  buckets: ReadonlyArray<{ mintUrl: string; proofs: ReadonlyArray<{ amount: number }> }>,
  amountSats: number,
): Array<{ mintUrl: string; balanceSats: number }> {
  return buckets
    .map((b) => ({ mintUrl: b.mintUrl, balanceSats: b.proofs.reduce((s, p) => s + p.amount, 0) }))
    .filter((b) => b.balanceSats >= amountSats)
    .sort((a, b) => b.balanceSats - a.balanceSats)
}

// ── Undelivered Cashu token (ADR-399 D3) ────────────────────────────────────
// A token is spent from the buyer's wallet the moment it is created. Until the
// server has stored it, it lives here, so a reload resends it instead of
// paying a second time.

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function pendingKey(ticketId: string): string {
  return `ticket_cashu_pending_${ticketId}`
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function readPendingCashuToken(ticketId: string, storage: StorageLike | null = defaultStorage()): string | null {
  try {
    return storage?.getItem(pendingKey(ticketId)) ?? null
  } catch {
    return null
  }
}

export function writePendingCashuToken(ticketId: string, token: string, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(pendingKey(ticketId), token)
  } catch {
    /* storage unavailable: the token is still shown for manual copy */
  }
}

export function clearPendingCashuToken(ticketId: string, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(pendingKey(ticketId))
  } catch {
    /* ignore */
  }
}
