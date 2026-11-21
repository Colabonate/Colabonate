/**
 * Trade-Visibility Helpers (ADR-152 §A3 — Reputation-Gating)
 *
 * Centralizes the policy "reputation is built only on PUBLIC trades". Used at
 * every reward-grant site (Reviews, ColPoints) to prevent private-mode users
 * from accidentally building public reputation. The same function gates
 * whether DAO-Council disputes are available.
 *
 * Single source of truth: if you need to check "is this thing allowed in
 * private mode?", use one of the functions in this file. Do not duplicate
 * the visibility check inline.
 *
 * ADR-159 extends the SOT to discovery surfaces: `isProfileIndexable` is the
 * single rule deciding whether a creator's offers may appear in the global
 * search index / public marketplace browse ("KEIN globaler Index" for
 * PRIVATE profiles).
 */

import type { PrismaClient, TradeVisibility } from '@prisma/client'

/**
 * Returns true if a ticket's visibility allows reputation to be built.
 * Per ADR-152 §A3, only PUBLIC tickets contribute to reviews + ColPoints.
 * Private tickets explicitly opt out of the reputation system (with a UI
 * warning shown to the user at offer/cooperation creation time).
 */
export function canBuildReputation(visibility: TradeVisibility | string | null | undefined): boolean {
  return visibility === 'PUBLIC'
}

/**
 * Returns true if a ticket's dispute mode is PUBLIC (DAO-Council arbitration).
 * Private-mode tickets use the mutual-arbiter pattern (PROB-002 A2) or NONE.
 */
export function isDaoArbitrable(disputeMode: DisputeModeLike | string | null | undefined): boolean {
  return disputeMode === 'PUBLIC'
}

export type DisputeModeLike = 'PUBLIC' | 'PRIVATE' | 'NONE'

/**
 * Maps a visibility + disputeMode pair to a human-readable label for the UI.
 */
export function describeTradeMode(
  visibility: TradeVisibility | string | null | undefined,
  disputeMode: DisputeModeLike | string | null | undefined,
): string {
  if (visibility === 'PRIVATE') {
    if (disputeMode === 'PRIVATE') return 'Private (with mutual arbiter)'
    if (disputeMode === 'NONE') return 'Private (no dispute protection)'
    return 'Private'
  }
  return 'Public'
}

/**
 * Returns true if a creator's ProfileVisibility permits their offers to appear
 * on any public discovery surface (Meilisearch global index + marketplace
 * browse). Per ADR-152 §D3 + ADR-159, a PRIVATE profile is globally excluded
 * ("KEIN globaler Index"). PSEUDO_PRIVATE is still indexable (it restricts
 * only profile stammdaten, not offers). Used by the outbox indexer, the
 * profile-flip purge path, and mirrors the DB browse/search `where.creator`
 * filter so all three backends share one rule.
 */
export function isProfileIndexable(profileVisibility: string | null | undefined): boolean {
  return profileVisibility !== 'PRIVATE'
}

/**
 * Helper for callers that have a Prisma ticket in hand. Throws nothing; just
 * centralizes the policy lookup so call sites don't need to know the field name.
 */
export async function ticketCanBuildReputation(
  prisma: PrismaClient,
  ticketId: string,
): Promise<boolean> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { visibility: true },
  })
  return canBuildReputation(ticket?.visibility)
}
