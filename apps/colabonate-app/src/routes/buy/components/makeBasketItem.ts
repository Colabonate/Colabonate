// makeBasketItem — shared Offer → basket-item mapper (ADR-237 review finding #1).
//
// Used by BuyDashboard.tsx and Search.tsx so the checkout data path stays
// identical regardless of which surface the user adds an item from. If the
// Offer shape or CartItem contract changes, there is exactly one place to
// update.

import type { Offer } from '../../../types/api'
import { canvasCartFields } from '../../../lib/agentConfig'

export function makeBasketItem(offer: Offer) {
  return {
    offerId: offer.id,
    title: offer.title,
    priceSats: offer.priceSats,
    offerType: offer.offerType ?? 'PRODUCT',
    category: offer.categoryCode,
    image: offer.images?.[0],
    company: offer.company ?? null,
    sellerPubkey: offer.creatorPubkey,
    source: offer.source,
    stock: offer.product?.stock ?? null,
    deliveryTimeDays: offer.deliveryTimeDays ?? undefined,
    deliveryCostSats: offer.deliveryCostSats ?? undefined,
    deliveryNotes: offer.deliveryNotes ?? undefined,
    // ADR-183 Phase 2: forward offer.allowedVisibility so BuyCartFlow can
    // render a per-item tier selector. Missing/null is treated as [0].
    allowedVisibility: Array.isArray(offer.allowedVisibility) ? offer.allowedVisibility : null,
    // ADR-370 D6 (Phase 2): canvas declaration into the cart so the review
    // step repeats the disclosure. Shared helper — same derivation as the
    // detail page's inline cart item (ADR-237 mapper discipline).
    ...canvasCartFields(offer),
  }
}
