import type { Transaction } from '../types/api'

/**
 * Presentation helpers for the wallet history (ADR-240/253 + the platform-payment
 * union in GET /api/wallet/transactions).
 *
 * Marketplace rows are ticket-derived; platform payments (AI credits, MCP passes,
 * workspace funding, support tips) are unioned in with `ticketId: null`. A ticket
 * row needs three ticket dimensions to be honest:
 *  · which rail paid it (`directPayRail`; DEMO is beta-only),
 *  · what state it is in (escrow phase wins over the coarse ticket status),
 *  · whether it still needs the user (open payment / active escrow).
 *
 * Pure functions so the wording and the "Open" filter are unit-tested instead
 * of living in JSX.
 */
export type StatusTone = 'success' | 'warning' | 'error' | 'neutral'

export interface StatusPresentation {
  label: string
  tone: StatusTone
}

interface RailInput {
  directPayRail?: Transaction['directPayRail']
}

/** Rail badge for a row; null when the ticket has no rail recorded. */
export function railBadge(tx: RailInput): { label: string; title: string } | null {
  switch (tx.directPayRail) {
    case 'LN':
      return { label: 'Lightning', title: 'Paid over Lightning (Direct-Pay)' }
    case 'CASHU':
      return { label: 'eCash', title: 'Paid with a Cashu eCash token' }
    case 'DEMO':
      return { label: 'Demo', title: 'Beta demo payment — simulated, no real sats' }
    default:
      return null
  }
}

type StatusInput = Pick<Transaction, 'type' | 'status'> & {
  escrowStatus?: string | null
  ticketStatus?: string
}

const RELEASE_ESCROW_STATES = new Set(['RELEASED', 'RELEASED_FULL'])

/** Human wording + tone for the row state. */
export function statusPresentation(tx: StatusInput): StatusPresentation {
  const escrow = tx.escrowStatus ?? null
  const ticketStatus = tx.ticketStatus ?? ''

  if (escrow === 'REFUNDED' || tx.status === 'REFUNDED') return { label: 'Refunded', tone: 'warning' }
  if (ticketStatus === 'CANCELLED') return { label: 'Cancelled', tone: 'error' }
  if (
    tx.type === 'ESCROW_RELEASE' ||
    (escrow !== null && (RELEASE_ESCROW_STATES.has(escrow) || escrow.startsWith('RELEASE_PHASE')))
  ) {
    return { label: 'Released', tone: 'success' }
  }
  if (tx.type === 'ESCROW_HOLD' || (escrow !== null && escrow !== 'NONE')) {
    return { label: 'In escrow', tone: 'warning' }
  }
  if (tx.status === 'COMPLETED') return { label: 'Completed', tone: 'success' }
  return { label: 'Awaiting payment', tone: 'warning' }
}

type OpenInput = Pick<Transaction, 'status'> & { ticketStatus?: string }

/** True while the row still needs the user: an open payment or an active escrow. */
export function isOpenTransaction(tx: OpenInput): boolean {
  if (tx.ticketStatus === 'CANCELLED') return false
  if (tx.status === 'COMPLETED' || tx.status === 'REFUNDED') return false
  return true
}
