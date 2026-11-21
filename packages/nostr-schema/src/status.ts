// Canonical ticket status vocabulary — single source of truth (ADR-150).
//
// Colabonate keeps UPPERCASE as the canonical value internally and on the native
// wire (Kind 30407/30408). The market-spec lowercase bridge (ADR-153) maps FROM
// this single source, so it must not fork a second status definition. Server
// (apps/server/lib/enums.ts) and client (apps/colabonate-app/src/types/api.ts)
// should re-export from here rather than redeclaring the list.
export const TICKET_STATUSES = [
  'PENDING', 'INTEREST_SENT', 'ACCEPTED', 'PAID', 'IN_PROGRESS',
  'COMPLETED', 'DISPUTED', 'ARBITRATION_LOST', 'ARBITRATION_WON', 'CANCELLED',
] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]

// The 4 interoperable escrow states defined by NIP-115 (the public protocol layer).
// Colabonate's richer 10-state internal machine (the product layer) projects onto these.
export type EscrowState = 'HELD' | 'RELEASED' | 'REFUNDED' | 'DISPUTED'

/**
 * Project an internal escrow status (the product-layer phase machine) onto the 4 public
 * NIP-115 escrow states (the protocol layer). All "funds locked" phases collapse to HELD;
 * CANCELLED means funds returned to the buyer (REFUNDED). Used when emitting the public
 * `escrow_status` tag so any client/arbitrator can read the funds lifecycle interoperably
 * without knowing Colabonate's internal phase machine (ADR-142/143/149).
 */
export function toEscrowState(internal: string | null | undefined): EscrowState | null {
  switch (internal) {
    case 'INITIATED':
    case 'PHASE_1_PENDING':
    case 'RESERVED':
    case 'PHASE_2_PENDING':
    case 'DELIVERY_STARTED':
    case 'PHASE_3_PENDING':
    case 'DELIVERY_CONFIRMED':
      return 'HELD'
    case 'RELEASED':
      return 'RELEASED'
    case 'CANCELLED':
      return 'REFUNDED'
    case 'DISPUTED':
      return 'DISPUTED'
    default:
      return null
  }
}
