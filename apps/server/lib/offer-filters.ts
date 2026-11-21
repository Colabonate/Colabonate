// Shared Prisma where-fragments for Offer browse surfaces.

import type { Prisma } from '@prisma/client'

/**
 * ADR-270 D7: browse surfaces list parent offers only, never variation rows.
 *
 * `productType: { not: 'variation' }` cannot express this on its own — Prisma
 * translates it to SQL `<>`, which is UNKNOWN (and therefore false) for NULL,
 * so every offer without a productType is silently dropped too. Seed data and
 * all pre-ADR-270 offers have `productType = NULL`, which made /buy, the
 * category counts, the partner lists and autosuggest return zero rows.
 *
 * Spread into a query as `AND: [NON_VARIATION_OFFER]` so it never collides
 * with an `OR` the caller already uses for search terms or category lists.
 */
export const NON_VARIATION_OFFER: Prisma.OfferWhereInput = {
  OR: [
    { productType: null },
    { productType: { not: 'variation' } },
  ],
}
