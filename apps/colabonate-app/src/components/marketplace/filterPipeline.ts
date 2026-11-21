// ADR-335 FU-532 (D0, Phase A): pure filter/sort/facet helpers shared between
// BuyDashboard.tsx and Search.tsx's marketplace branch — previously two
// near-identical copies of this logic (~150 LOC combined) drifted subtly
// (see the country-matching fix below). No React deps, so every function is
// unit-testable without rendering.

import { COUNTRIES } from '../offers/offerFormConstants'
import type { Offer, Company } from '../../types/api'
import type { TaxonomyAxis, GammaTagFacet } from '../list-browser'

export type MarketplaceSortOption = 'newest' | 'price-asc' | 'price-desc' | 'name'
export type VendorSortOption = 'newest' | 'name'

// Same predicate as usesNonSatsPriceLabel() in components/offers/RemotePriceLabel.tsx.
// Inlined here because this pipeline is a plain .ts module (no component imports).
function hasNoSatsPrice(o: Offer): boolean {
  return Boolean(o.priceCurrency) || (o.source === 'REMOTE' && !((o.priceSats ?? 0) > 0))
}

// Price sort: offers without a comparable sats price always go last, in both
// directions; ties keep incoming order (Array.prototype.sort is stable).
// `direction` is 1 for ascending, -1 for descending.
function comparePriceRows(a: Offer, b: Offer, direction: 1 | -1): number {
  const aNoSats = hasNoSatsPrice(a)
  const bNoSats = hasNoSatsPrice(b)
  if (aNoSats !== bNoSats) return aNoSats ? 1 : -1
  if (aNoSats) return 0
  return direction * ((a.priceSats ?? 0) - (b.priceSats ?? 0))
}

export function buildFilteredOffers(input: {
  searchResults: Offer[]
  showFavoritesOnly?: boolean
  isFavorite?: (id: string) => boolean
  hideNoImageOffers: boolean
  isUsableImage: (url?: string) => boolean
  taxonomy: TaxonomyAxis
  selectedGammaTags: string[]
  sortBy: string
}): Offer[] {
  const { searchResults, showFavoritesOnly, isFavorite, hideNoImageOffers, isUsableImage, taxonomy, selectedGammaTags, sortBy } = input

  let filtered = searchResults.filter((o: Offer) => o.offerType !== 'COOP')

  // BuyDashboard-only (Search.tsx never sets showFavoritesOnly).
  if (showFavoritesOnly && isFavorite) {
    filtered = filtered.filter(o => isFavorite(o.id))
  }

  // Client-side image filter (extends the marketplace-cards hasImage check
  // with a probe that drops dead URLs and 1x1 placeholder pixels).
  if (hideNoImageOffers) {
    filtered = filtered.filter(o => {
      const firstImg = Array.isArray(o.images) ? o.images[0] : (typeof o.images === 'string' ? o.images : undefined)
      return isUsableImage(firstImg)
    })
  }

  // ADR-277 D7: gamma axis is multi-select, OR-combined.
  if (taxonomy === 'gamma' && selectedGammaTags.length > 0) {
    filtered = filtered.filter(o => o.gammaTags?.some(t => selectedGammaTags.includes(t)))
  }

  filtered = [...filtered]
  switch (sortBy) {
    case 'price-asc': filtered.sort((a, b) => comparePriceRows(a, b, 1)); break
    case 'price-desc': filtered.sort((a, b) => comparePriceRows(a, b, -1)); break
    case 'name': filtered.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '')); break
    // createdAt may be undefined on some offer shapes (e.g. remote/slim API
    // rows) — null-safe compare so "Newest" sort can't crash the render.
    default: filtered.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')); break
  }

  return filtered
}

export function buildVendorOfferCounts(searchResults: Offer[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const o of searchResults) {
    if (o.offerType === 'COOP') continue
    const key = o.companyId || o.creatorPubkey
    map.set(key, (map.get(key) || 0) + 1)
  }
  return map
}

export function buildFilteredVendors(input: {
  companies: Company[]
  query: string
  countryFilter: string
  selectedCategory: string
  searchResults: Offer[]
  companyId?: string
  sellerPubkey?: string
  sortBy: string
}): Company[] {
  const { companies, query, countryFilter, selectedCategory, searchResults, companyId, sellerPubkey, sortBy } = input

  let filtered = [...companies]

  if (query.trim()) {
    const q = query.toLowerCase()
    filtered = filtered.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.city?.toLowerCase().includes(q) ||
      c.description?.toLowerCase().includes(q) ||
      c.country?.toLowerCase().includes(q),
    )
  }

  if (countryFilter) {
    // Offers store ISO codes ('DE') and so does `countryFilter`, but
    // Company.country is written as a display name ('Germany', see
    // SellCompanySetup). Match either spelling — Search.tsx's own copy of
    // this filter previously matched only the raw ISO code, silently
    // failing to filter German-named companies (fixed by this unification).
    const countryName = COUNTRIES.find(c => c.code === countryFilter)?.name
    filtered = filtered.filter(c => c.country === countryFilter || (!!countryName && c.country === countryName))
  }

  if (selectedCategory) {
    const matchingKeys = new Set<string>()
    for (const o of searchResults) {
      if (o.categoryCode?.startsWith(selectedCategory)) {
        matchingKeys.add(o.companyId || o.creatorPubkey)
      }
    }
    filtered = filtered.filter(c => matchingKeys.has(c.id) || matchingKeys.has(c.ownerPubkey))
  }

  if (companyId) filtered = filtered.filter(c => c.id === companyId)
  if (sellerPubkey) filtered = filtered.filter(c => c.ownerPubkey === sellerPubkey)

  switch (sortBy) {
    case 'name': filtered.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')); break
    default: filtered.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')); break
  }

  return filtered
}

export function buildGammaTagFacets(searchResults: Offer[]): GammaTagFacet[] {
  const counts = new Map<string, number>()
  for (const o of searchResults) {
    if (o.offerType === 'COOP') continue
    for (const tag of o.gammaTags ?? []) {
      counts.set(tag, (counts.get(tag) || 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
}

export function buildAgentCapabilityFacets(searchResults: Offer[]): GammaTagFacet[] {
  const counts = new Map<string, number>()
  for (const o of searchResults) {
    if (o.offerType !== 'AGENT_SETUP') continue
    for (const cap of o.agentProfile?.capabilities ?? []) {
      counts.set(cap, (counts.get(cap) || 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
}
