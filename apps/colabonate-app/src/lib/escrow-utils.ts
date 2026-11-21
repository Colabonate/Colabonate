export type EscrowDisplayStatus = 'pending' | 'held' | 'partially-released' | 'fully-released' | 'refunded'

/** Canonical server escrow statuses (matches apps/server/lib/enums.ts). */
export type ServerEscrowStatus =
  | 'NONE'
  | 'INITIATED'
  | 'PHASE_1_PENDING'
  | 'RESERVED'
  | 'PHASE_2_PENDING'
  | 'DELIVERY_STARTED'
  | 'PHASE_3_PENDING'
  | 'DELIVERY_CONFIRMED'
  | 'RELEASED'
  | 'CANCELLED'
  | 'DISPUTED'

const HELD_STATUSES: ServerEscrowStatus[] = [
  'INITIATED',
  'PHASE_1_PENDING',
  'RESERVED',
  'PHASE_2_PENDING',
  'DELIVERY_STARTED',
  'PHASE_3_PENDING',
  'DELIVERY_CONFIRMED',
]

/**
 * Map the server's canonical EscrowStatus to a UI display state.
 * ADR-184: this is the single source of truth for the frontend; it replaces
 * the previous mapping that referenced non-existent states like ORDER_PLACED.
 */
export function getEscrowDisplayStatus(rawStatus?: string): EscrowDisplayStatus {
  if (!rawStatus || rawStatus === 'NONE') return 'pending'
  const status = rawStatus as ServerEscrowStatus
  if (HELD_STATUSES.includes(status)) return 'held'
  if (status === 'RELEASED') return 'fully-released'
  if (status === 'CANCELLED') return 'refunded'
  if (status === 'DISPUTED') return 'pending'
  return 'pending'
}

/**
 * Return the percentage of funds that have been released to the seller.
 * With the current 25/50/25 hold-invoice design, funds are released all at
 * once when the buyer confirms quality (or on auto-release). Partial release
 * of individual phases is not supported until a future SPLIT settlement design.
 */
export function getEscrowReleasedPct(escrowStatus?: string): number {
  if (!escrowStatus || escrowStatus === 'NONE') return 0
  if (escrowStatus === 'RELEASED') return 100
  if (escrowStatus === 'CANCELLED' || escrowStatus === 'DISPUTED') return 0
  return 0
}
