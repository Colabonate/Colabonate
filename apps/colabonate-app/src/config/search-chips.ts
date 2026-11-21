export interface SearchTermChip {
  type: 'term'
  label: string
  query: string
}

export interface SearchFilterChip {
  type: 'filter'
  label: string
  query?: string
  categoryCode?: string
  offerType?: 'PRODUCT' | 'SERVICE'
}

export type SearchChip = SearchTermChip | SearchFilterChip

export const SEARCH_TERM_CHIPS: SearchTermChip[] = [
  { type: 'term', label: 'Bitcoin', query: 'Bitcoin' },
  { type: 'term', label: 'Design', query: 'Design' },
  { type: 'term', label: 'Consulting', query: 'Consulting' },
  { type: 'term', label: 'Web hosting', query: 'Web hosting' },
  { type: 'term', label: 'Logo', query: 'Logo' },
  { type: 'term', label: 'Translation', query: 'Translation' },
]

export const SEARCH_FILTER_CHIPS: SearchFilterChip[] = [
  { type: 'filter', label: 'Products', offerType: 'PRODUCT' },
  { type: 'filter', label: 'Services', offerType: 'SERVICE' },
]

export const SEARCH_CHIPS: SearchChip[] = [...SEARCH_TERM_CHIPS, ...SEARCH_FILTER_CHIPS]

/**
 * Builds filter chips for the categories with the most items in the current
 * data (offer counts), capped at `limit`. Used for the mobile "Services &
 * Collaborations" chip row on Home, which surfaces data-driven categories
 * instead of the static SEARCH_CHIPS shown on desktop/tablet.
 */
export function buildCategoryFilterChips(
  categories: Array<{ slug: string; name: string }>,
  categoryCounts: Record<string, number>,
  limit: number,
): SearchFilterChip[] {
  const nameByCode = new Map(categories.map(c => [c.slug, c.name]))
  return Object.entries(categoryCounts)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([categoryCode]) => ({
      type: 'filter' as const,
      label: nameByCode.get(categoryCode) ?? categoryCode,
      categoryCode,
    }))
}

export function buildSearchUrl(chip: SearchChip): string {
  const params = new URLSearchParams()
  if (chip.type === 'term') {
    params.set('q', chip.query)
  } else {
    if (chip.query) params.set('q', chip.query)
    if (chip.categoryCode) params.set('categoryCode', chip.categoryCode)
    if (chip.offerType) params.set('offerType', chip.offerType)
  }
  const queryString = params.toString()
  return queryString ? `/search?${queryString}` : '/search'
}
