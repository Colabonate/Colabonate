import type { CartItem } from '../types/api'

/**
 * Validates a cart value read from localStorage (already JSON-parsed).
 * Malformed entries and remote-origin items are dropped. Never throws.
 */
export function parseStoredCart(raw: unknown): CartItem[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is CartItem => {
    if (typeof entry !== 'object' || entry === null) return false
    const item = entry as Record<string, unknown>
    if (typeof item.offerId !== 'string' || item.offerId.length === 0) return false
    if (typeof item.title !== 'string') return false
    if (typeof item.priceSats !== 'number' || !Number.isFinite(item.priceSats)) return false
    if (typeof item.sellerPubkey !== 'string') return false
    if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity < 1) return false
    if (item.source === 'REMOTE') return false
    return true
  })
}

/** A legacy item (saved before the source field existed) has never been checked. */
export function needsSourceCheck(item: CartItem): boolean {
  return item.source === undefined
}

/**
 * Applies server source results to cart items. REMOTE items are removed and
 * returned; LOCAL items are marked; items without a result are kept unchanged.
 * Pure: inputs are not mutated and order is preserved.
 */
export function applySourceResults(
  items: CartItem[],
  results: Record<string, 'LOCAL' | 'REMOTE'>,
): { items: CartItem[]; removedRemote: CartItem[] } {
  const kept: CartItem[] = []
  const removedRemote: CartItem[] = []
  for (const item of items) {
    const result = results[item.offerId]
    if (result === 'REMOTE') {
      removedRemote.push(item)
    } else if (result === 'LOCAL') {
      kept.push({ ...item, source: 'LOCAL' })
    } else {
      kept.push(item)
    }
  }
  return { items: kept, removedRemote }
}
