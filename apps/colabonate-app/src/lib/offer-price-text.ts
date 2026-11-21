import type { Offer } from '../types/api'

/**
 * Display text for a foreign-currency offer price (ADR-277 D9.1/R5).
 * Returns null for normal sats offers so callers keep their sats rendering.
 */
export function foreignPriceText(
  offer: Pick<Offer, 'source' | 'priceSats' | 'priceAmount' | 'priceCurrency'>,
): string | null {
  if (offer.priceCurrency) {
    return `${offer.priceAmount ?? '?'} ${offer.priceCurrency.toUpperCase()}`
  }
  if (offer.source === 'REMOTE' && !(offer.priceSats > 0)) {
    return 'Price on request'
  }
  return null
}
