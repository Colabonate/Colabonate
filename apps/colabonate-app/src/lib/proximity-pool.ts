// ADR-421: Home's Marketplace teaser filters Nearby / Region in the browser, so
// the pool it filters must actually contain the visitor's country. The global
// newest-100 window is dominated by foreign listings (production: 100 of 100
// REMOTE, 0 from Germany), so the country's own offers are fetched separately
// and merged in here. Dedupes by id and returns newest-first, the order the
// slider caps and the Nearby-then-Region grouping rely on.
interface PoolOffer {
  id: string
  publishedAt?: string | null
  createdAt?: string | null
}

function stamp(o: PoolOffer): number {
  const t = Date.parse(o.publishedAt ?? o.createdAt ?? '')
  return Number.isFinite(t) ? t : 0
}

export function mergeProximityPool<T extends PoolOffer>(countryOffers: readonly T[], globalOffers: readonly T[]): T[] {
  if (countryOffers.length === 0) return globalOffers as T[]
  const seen = new Set<string>()
  const merged: T[] = []
  for (const o of [...countryOffers, ...globalOffers]) {
    if (seen.has(o.id)) continue
    seen.add(o.id)
    merged.push(o)
  }
  return merged.sort((a, b) => stamp(b) - stamp(a))
}
