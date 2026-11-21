// ADR-403 (subtab-aware search): pure helpers for /search's subtab result
// counts + auto-switch. Kept React-free and separate from Search.tsx so the
// mapping and the "pick the tab with results" rule are unit-testable.

import type { CoopItem } from '../routes/coop/coop-cards'

export type CoopTab =
  | 'all' | 'tenders' | 'projects' | 'network' | 'partners' | 'bounties' | 'agents' | 'services'

// Subtab membership mirrors the filter mapping in useCoopFilters
// (coop-filters.ts) so a tab's count agrees with what the tab actually renders:
// an item can be on 'all' AND on its specific type tab (e.g. an agent on
// Agents + All), while vendor/partner/bounty items are excluded from 'all'.
export function coopItemMatchesTab(item: CoopItem, tab: CoopTab): boolean {
  switch (tab) {
    case 'tenders': return item.itemType === 'tender'
    case 'projects': return item.itemType === 'project'
    case 'network': return item.itemType === 'network'
    case 'partners': return item.itemType === 'vendor' || item.itemType === 'partner'
    case 'bounties': return item.itemType === 'bounty'
    case 'services': return item.itemType === 'service' || item.itemType === 'bundle'
    case 'agents': return item.itemType === 'agent'
    default: return item.itemType !== 'vendor' && item.itemType !== 'partner' && item.itemType !== 'bounty'
  }
}

// When the active subtab has no matches, pick the tab with the most matches —
// specific tabs first, 'all' only as a fallback (the superset is a last
// resort, not a magnet). Returns null when the current tab already has results
// or nothing matches anywhere, so callers never yank the user off a tab that
// still has results.
export function pickBestTab<T extends string>(
  counts: Record<T, number>, current: T, order: readonly T[], allKey: T,
): T | null {
  if ((counts[current] ?? 0) > 0) return null
  let best: T | null = null
  for (const tab of order) {
    if (tab === allKey) continue
    if ((counts[tab] ?? 0) > (best ? counts[best] : 0)) best = tab
  }
  if (best) return best
  return (counts[allKey] ?? 0) > 0 ? allKey : null
}
