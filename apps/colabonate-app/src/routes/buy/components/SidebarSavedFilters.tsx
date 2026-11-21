// SidebarSavedFilters — shared saved-filter chips + country filter sidebar
// extra (ADR-237 review finding #3).
//
// Rendered in ListBrowser's `sidebarExtraTop` slot by BuyDashboard.tsx and
// Search.tsx (marketplace context). Uses the FilterFavorite type from
// utils/filterFavorites (the same type useFilterFavorites returns) so the
// saved-filter apply/delete logic stays identical across surfaces.
//
// ADR-333 D3: thin composition of SaveFilterAction + ImagesFilterPanel +
// LocationsFilterPanel. Search.tsx (marketplace context) imports the three
// sub-components directly to interleave them in its configurable panel
// stack; BuyDashboard keeps using this bundle unchanged.

import { SaveFilterAction } from './SaveFilterAction'
import { ImagesFilterPanel } from './ImagesFilterPanel'
import { LocationsFilterPanel } from './LocationsFilterPanel'
import type { FilterFavorite } from '../../../utils/filterFavorites'

export function SidebarSavedFilters({
  savedFilters, currentFilters, onApplyFilter, onDeleteFilter, onSaveFilter,
  countryFilter, onCountryChange, allCountries,
  hideNoImageOffers, onHideNoImageOffersChange,
}: {
  savedFilters: FilterFavorite[]
  currentFilters: Record<string, unknown>
  onApplyFilter: (id: string) => void
  onDeleteFilter: (id: string) => void
  onSaveFilter: () => void
  countryFilter: string
  onCountryChange: (country: string) => void
  allCountries: string[]
  /** Offers without images are hidden by default; toggling re-shows them. */
  hideNoImageOffers: boolean
  onHideNoImageOffersChange: (hide: boolean) => void
}) {
  return (
    <div className="shrink-0 flex flex-col gap-1.5 pb-2 mb-2" style={{ borderBottom: '1px solid var(--theme-border)' }}>
      <SaveFilterAction
        savedFilters={savedFilters}
        currentFilters={currentFilters}
        onApplyFilter={onApplyFilter}
        onDeleteFilter={onDeleteFilter}
        onSaveFilter={onSaveFilter}
      />
      <ImagesFilterPanel
        hideNoImageOffers={hideNoImageOffers}
        onHideNoImageOffersChange={onHideNoImageOffersChange}
      />
      <LocationsFilterPanel
        countryFilter={countryFilter}
        onCountryChange={onCountryChange}
        allCountries={allCountries}
      />
    </div>
  )
}
