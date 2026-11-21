import { useMemo, useRef } from 'react'
import type { SliderListItem } from '@ds/ui'

/**
 * Shared memo scaffolding for the detail↔slider binding (ADR-188).
 *
 * Every detail page that mounts a `DetailSliderNav` needs two derived lists —
 * "vendor" siblings and the "all marketplace" list — mapped to `SliderListItem`.
 * Each page previously inlined its own pair of `useMemo` calls with subtly
 * different guards, which drifts silently as more pages copy either version.
 *
 * This hook centralises the guard + memo so the contract is defined once:
 *   - vendor items are only built once the anchor entity is resolved
 *   - all-marketplace items are built as soon as the list is available
 *
 * Callers still own their entity-specific mapper (Offer → SliderListItem vs
 * Cooperation → SliderListItem), since those domain mappings genuinely differ.
 */
export function useDetailSliderItems<TItem>(args: {
  vendorList: TItem[] | undefined
  allList: TItem[] | undefined
  /** the entity the surrounding detail view is currently bound to.
   *  While falsy (still loading / not found) vendor items resolve to []. */
  anchor: unknown
  mapItem: (item: TItem) => SliderListItem
}): { vendorItems: SliderListItem[]; allItems: SliderListItem[] } {
  const { vendorList, allList, anchor } = args

  // Keep the latest mapper without busting the memos below when the caller
  // passes a fresh inline function each render (matches the original closure
  // behaviour where the mapper was not a memo dependency).
  const mapRef = useRef(args.mapItem)
  mapRef.current = args.mapItem

  const vendorItems = useMemo(() => {
    if (!vendorList || !anchor) return []
    return vendorList.map(mapRef.current)
  }, [vendorList, anchor])

  const allItems = useMemo(() => {
    if (!allList) return []
    return allList.map(mapRef.current)
  }, [allList])

  return { vendorItems, allItems }
}
