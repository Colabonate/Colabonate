// coop-filters — shared coop-type category constants + filter/sort memos
// (ADR-237 review finding #2).
//
// Both CoopExplore.tsx and Search.tsx render the coop context through the
// same category tree (cooperation types as synthetic roots, ADR-220) and the
// same client-side filter/sort pipeline. Extracting them here guarantees the
// two surfaces stay in lockstep — if the coop-type taxonomy or filtering
// logic changes, there is exactly one implementation to update.

import { useMemo } from 'react'
import type { BrowsableCategory } from '../buy/CategorySidebar'
import type { StandardCategory } from '../../types/api'
import { COOPERATION_TYPES } from './guide/coopGuideConstants'
import type { CoopItem } from './coop-cards'

// ── Cooperation types as synthetic category roots (ADR-220) ───────────
// Slugs use a dash (not '/') so CategorySidebar/CategoryTopPanel path
// reconstruction (slug.split('/')) treats them as plain level-1 entries.
// TENDER is omitted — the Tenders filter tab already covers it.
// Each entry carries the type's own accent color + icon from COOPERATION_TYPES.
export const COOP_TYPE_SLUG_PREFIX = 'coop-type-'

export const COOP_TYPE_CATEGORIES: BrowsableCategory[] = COOPERATION_TYPES
  .filter(t => t.id !== 'TENDER')
  .map((t, i) => ({
    id: `${COOP_TYPE_SLUG_PREFIX}${t.id.toLowerCase()}`,
    slug: `${COOP_TYPE_SLUG_PREFIX}${t.id.toLowerCase()}`,
    name: t.label,
    nameKey: t.id.toLowerCase(),
    offerType: 'SERVICE',
    level: 1,
    sortOrder: i,
    createdAt: '',
    updatedAt: '',
    accent: {
      color: t.color,
      bg: t.bg,
      border: `color-mix(in srgb, ${t.color} 30%, transparent)`,
      icon: t.icon,
    },
  }))

export function coopTypeFromSlug(slug: string): string {
  return slug.slice(COOP_TYPE_SLUG_PREFIX.length).toUpperCase()
}

// ADR-363 D3: dedup contract for the merged coop pool. fetchCoopExploreData
// concatenates disjoint id spaces (cooperations/offers/companies/partners/
// bounties/service offers/agent offers), so a true duplicate only shares the
// same `${itemType}:${id}`. Beyond that, the same logical entity can surface
// under two item types on one tab and must collapse to the richer card:
//   - a `network` offer whose companyId matches a `vendor` card is dropped
//     (the company card is the richer one);
//   - ADR-368 D4: a `service` offer (SERVICE offer row) whose companyId matches
//     a `vendor` card is dropped the same way — service offers belong to the
//     company card exactly like network offers do;
//   - a `partner` card whose owner pubkey matches a `vendor` card's owner is
//     dropped into the vendor card.
// Agent offers are NEVER collapsed — an AI Agent Setup is the browseable unit,
// not its (often absent) company shell.
// First occurrence wins, order preserved.
export function dedupeCoopItems(items: CoopItem[]): CoopItem[] {
  const seen = new Set<string>()
  const vendorById = new Map<string, string>()
  const vendorByOwner = new Map<string, string>()
  for (const item of items) {
    if (item.itemType !== 'vendor') continue
    vendorById.set(item.id, item.id)
    if (item.initiatorPubkey) vendorByOwner.set(item.initiatorPubkey, item.id)
  }

  const out: CoopItem[] = []
  for (const item of items) {
    const key = `${item.itemType}:${item.id}`
    if (seen.has(key)) continue
    seen.add(key)
    if ((item.itemType === 'network' || item.itemType === 'service') && item.companyId && vendorById.has(item.companyId)) continue
    if (item.itemType === 'partner' && item.initiatorPubkey && vendorByOwner.has(item.initiatorPubkey)) continue
    out.push(item)
  }
  return out
}

// ── useCoopFilters — the shared filter/sort pipeline ──────────────────
//
// Mirrors the memo chain that previously lived inline in CoopExplore.tsx
// (and was duplicated in Search.tsx). Tab + search applied first (preCategoryItems);
// category/type selection applied after so the pre-selection set can drive
// sibling category counts (categoryCountItems); sort applied last.

export interface UseCoopFiltersArgs {
  cooperations: CoopItem[]
  categories: StandardCategory[]
  filterTab: string
  query: string
  selectedCategory: string
  sortBy: string
  // ADR-277 D7/D8: optional — omitting both keeps pre-existing standard-axis-only behavior.
  // Only offer-sourced CoopItems (offerToCoopItem) carry real gammaTags; cooperations/companies
  // legitimately have none, so the gamma axis is naturally thin here and hidden by the D7
  // visibility rule until it isn't (empty gammaTagFacets = ListBrowser hides the switch).
  taxonomy?: 'standard' | 'gamma'
  selectedGammaTags?: string[]
  // ADR-363 D6: coop client-pipeline mirror of the Marketplace Locations /
  // Images filter panels (see ListingFilterSidebar). Country matches the
  // item's mapped `country` (offers + companies only); hideNoImageOffers
  // keeps only items that carry an images array.
  selectedCountry?: string
  hideNoImageOffers?: boolean
  // ADR-368 follow-up: agent axis — coop-side mirror of the marketplace
  // AgentFilterPanel (ADR-313 D2/D3), driven client-side instead of
  // /api/search params. Only agent items carry these signals, so any active
  // agent filter narrows the pool to itemType === 'agent' first.
  selectedCapabilities?: string[]
  agentBillingModel?: string
  minReputation?: number
  canvasProvider?: string
}

export interface UseCoopFiltersResult {
  coopCategories: BrowsableCategory[]
  preCategoryItems: CoopItem[]
  categoryCountItems: Array<{ categoryCode?: string | null }>
  allItems: CoopItem[]
  gammaTagFacets: Array<{ tag: string; count: number }>
  agentCapabilityFacets: Array<{ tag: string; count: number }>
}

export function useCoopFilters(args: UseCoopFiltersArgs): UseCoopFiltersResult {
  const { cooperations, categories, filterTab, query, selectedCategory, sortBy, taxonomy = 'standard', selectedGammaTags = [], selectedCountry = '', hideNoImageOffers = false, selectedCapabilities = [], agentBillingModel = '', minReputation = 0, canvasProvider = '' } = args

  // ── Unified filter tree: cooperation types + Services subtree (ADR-220) ──
  // Goods/Digital are dissolved for the coop context; the cooperation types
  // take their place as level-1 entries in the same category filter.
  // Exception: the Partners tab (Companies/People) uses the FULL StandardCategory
  // tree instead — companies commonly sell physical Goods, and coop-types are
  // meaningless for them, so neither belongs in that tab's sidebar (ADR-227).
  const coopCategories = useMemo((): BrowsableCategory[] => {
    if (filterTab === 'partners') return categories
    return [
      ...COOP_TYPE_CATEGORIES,
      ...categories
        .filter(c => c.slug !== 'goods' && !c.slug.startsWith('goods/')
          && c.slug !== 'digital' && !c.slug.startsWith('digital/'))
        .map(c => c.level === 1 ? { ...c, sortOrder: 100 + c.sortOrder } : c),
    ]
  }, [categories, filterTab])

  // ── Tab + search applied first (ADR-218 D6 — order preserved) ──────────
  const preCategoryItems = useMemo((): CoopItem[] => {
    let items: CoopItem[] = [...cooperations]
    if (filterTab === 'tenders') items = items.filter(i => i.itemType === 'tender')
    else if (filterTab === 'projects') items = items.filter(i => i.itemType === 'project')
    else if (filterTab === 'network') items = items.filter(i => i.itemType === 'network')
    else if (filterTab === 'partners') items = items.filter(i => i.itemType === 'vendor' || i.itemType === 'partner')
    // ADR-338: bounties (AgentTask) get their own tab, same as Partners — a
    // different underlying data type, excluded from the default "All" bucket.
    else if (filterTab === 'bounties') items = items.filter(i => i.itemType === 'bounty')
    // ADR-368 D4: the Services tab is the SERVICE-offer + Service-Bundle
    // (cooperationType === 'SERVICE', mapped to 'bundle') union — Service
    // Offers (single provider) and Service Bundles (multi-actor) side by side.
    else if (filterTab === 'services') items = items.filter(i => i.itemType === 'service' || i.itemType === 'bundle')
    // ADR-368 D4: the Agents tab shows AI Agent Setups (AGENT_SETUP offers).
    else if (filterTab === 'agents') items = items.filter(i => i.itemType === 'agent')
    else items = items.filter(i => i.itemType !== 'vendor' && i.itemType !== 'partner' && i.itemType !== 'bounty')

    if (query.trim()) {
      const q = query.toLowerCase()
      items = items.filter(i =>
        i.title.toLowerCase().includes(q) ||
        (i.description ?? '').toLowerCase().includes(q),
      )
    }

    return items
  }, [cooperations, filterTab, query])

  // Count basis for the sidebar/top-panel: each item counts once under its real
  // categoryCode, once under its synthetic cooperation-type slug, and once per
  // entry in categoryCodes (Company/Partner items can carry several categories).
  // ADR-363 D3: dedup by (slug, itemId) so an item that lists the same slug
  // both as categoryCode and inside categoryCodes is counted once, and
  // duplicate items (already removed by dedupeCoopItems upstream) never
  // inflate a badge twice.
  const categoryCountItems = useMemo(() => {
    const seen = new Set<string>()
    const entries: Array<{ categoryCode?: string | null }> = []
    for (const i of preCategoryItems) {
      const candidates: Array<string | null | undefined> = [i.categoryCode]
      if (i.cooperationType) {
        candidates.push(`${COOP_TYPE_SLUG_PREFIX}${i.cooperationType.toLowerCase()}`)
      }
      candidates.push(...(i.categoryCodes ?? []))
      for (const code of candidates) {
        if (!code) continue
        // ADR-363 review fix: itemType in the key so an id collision between
        // item types can never undercount a badge.
        const k = `${i.itemType}|${i.id}|${code}`
        if (seen.has(k)) continue
        seen.add(k)
        entries.push({ categoryCode: code })
      }
    }
    return entries
  }, [preCategoryItems])

  // ADR-277 D4/D7: frequency-sorted gamma tag facets from the pre-category-filter set
  // (mirrors BuyDashboard) — so sibling counts don't collapse to 0 once a tag is selected.
  const gammaTagFacets = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of preCategoryItems) {
      for (const tag of item.gammaTags ?? []) {
        counts.set(tag, (counts.get(tag) || 0) + 1)
      }
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
  }, [preCategoryItems])

  // ADR-368 follow-up: frequency-sorted capability facets for the agent axis,
  // derived from the tab-scoped pre-filter pool's agent items only (mirrors
  // buildAgentCapabilityFacets in components/marketplace/filterPipeline.ts).
  const agentCapabilityFacets = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of preCategoryItems) {
      if (item.itemType !== 'agent') continue
      for (const skill of item.skills ?? []) {
        counts.set(skill, (counts.get(skill) || 0) + 1)
      }
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
  }, [preCategoryItems])
  const allItems = useMemo((): CoopItem[] => {
    let items = preCategoryItems

    // ADR-277 D7: the two axes are mutually exclusive — only the active axis's
    // selection narrows the item set.
    if (taxonomy === 'gamma') {
      if (selectedGammaTags.length > 0) {
        items = items.filter(i => i.gammaTags?.some(t => selectedGammaTags.includes(t)))
      }
    } else if (selectedCategory.startsWith(COOP_TYPE_SLUG_PREFIX)) {
      const type = coopTypeFromSlug(selectedCategory)
      items = items.filter(i => i.cooperationType?.toUpperCase() === type)
    } else if (selectedCategory) {
      items = items.filter(i =>
        i.categoryCode?.startsWith(selectedCategory) ||
        i.categoryCodes?.some(c => c.startsWith(selectedCategory)),
      )
    }

    // ADR-363 D6: client-pipeline mirror of the Marketplace Locations/Images
    // panels — country + no-image hiding run before sort, after the
    // category/type selection, so the sidebar badges reflect the pre-panel
    // set while the list honors the panels.
    if (selectedCountry) {
      items = items.filter(i => i.country === selectedCountry)
    }
    if (hideNoImageOffers) {
      items = items.filter(i => (i.images?.length ?? 0) > 0)
    }

    // ADR-368 follow-up: agent axis — when any agent filter is active, only
    // agent items survive (non-agent items carry no agent signals), then each
    // axis narrows. Runs after category/type + country/images so the sidebar
    // badges reflect the pre-agent-filter set while the list honors the axis.
    const hasAgentFilter = selectedCapabilities.length > 0
      || !!agentBillingModel
      || minReputation > 0
      || !!canvasProvider
    if (hasAgentFilter) {
      items = items.filter(i => i.itemType === 'agent')
      if (selectedCapabilities.length > 0) {
        items = items.filter(i => i.skills?.some(s => selectedCapabilities.includes(s)))
      }
      if (agentBillingModel) {
        items = items.filter(i => i.billingModel === agentBillingModel)
      }
      if (minReputation > 0) {
        items = items.filter(i => (i.reputation ?? 0) >= minReputation)
      }
      if (canvasProvider) {
        items = items.filter(i => i.canvasProvider === canvasProvider)
      }
    }

    switch (sortBy) {
      case 'name':
        items = [...items].sort((a, b) => a.title.localeCompare(b.title))
        break
      case 'price-asc':
        items = [...items].sort((a, b) => (a.budgetSats ?? 0) - (b.budgetSats ?? 0))
        break
      case 'price-desc':
        items = [...items].sort((a, b) => (b.budgetSats ?? 0) - (a.budgetSats ?? 0))
        break
      default:
        items = [...items].sort((a, b) =>
          new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
        )
    }

    return items
  }, [preCategoryItems, selectedCategory, sortBy, taxonomy, selectedGammaTags, selectedCountry, hideNoImageOffers, selectedCapabilities, agentBillingModel, minReputation, canvasProvider])

  return { coopCategories, preCategoryItems, categoryCountItems, allItems, gammaTagFacets, agentCapabilityFacets }
}
