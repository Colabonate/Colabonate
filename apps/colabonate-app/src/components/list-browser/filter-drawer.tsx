// FilterDrawer – ListBrowser's scroll-revealed filter drawer content.
// Built on the shared FilterFAB + FilterDrawerShell (components/ui/FilterDrawerShell):
// once the list header is scrolled out of view, the FAB opens this left slide-in
// drawer exposing every header filter vertically: filter tabs, sort options,
// consumer extras (saved filters, location, seller info) and the full 3-level
// category navigation via CategorySidebar.

import type { ReactNode } from 'react'
import { Check, Hash, LayoutGrid, Tag } from 'lucide-react'
import { FilterDrawerSectionLabel, FilterDrawerShell } from '../ui/FilterDrawerShell'
import { CategorySidebar } from '../../routes/buy/CategorySidebar'
import { GammaTagPanel } from '../../routes/buy/GammaTagPanel'
import type { StandardCategory } from '../../types/api'
import type { GammaTagFacet, ListBrowserFilterTab, ListBrowserSortOption, TaxonomyAxis } from './list-browser.types'

export { FilterFAB } from '../ui/FilterDrawerShell'

// Fixed inner width for the drawer's category slide panels; the drawer panel is
// sized so this always fits (360px base viewport → 86vw − 2×16px padding > 272).
const DRAWER_CATEGORY_PANEL_W = 272

export interface FilterDrawerProps {
  open: boolean
  onClose: () => void
  filterTabs: ListBrowserFilterTab[]
  activeFilterTab: string
  onFilterTabChange: (key: string) => void
  sortBy?: string
  onSortChange?: (s: string) => void
  sortOptions?: ListBrowserSortOption[]
  categories: StandardCategory[]
  selectedCategory: string
  onSelectCategory: (slug: string) => void
  countItems: Array<{ categoryCode?: string | null }>
  hideEmptyCategories: boolean
  showOfferCounts: boolean
  resultCount: number
  /** Same node as ListBrowser's sidebarExtraTop (e.g. saved filters + location). */
  extraTop?: ReactNode
  /** Same node as ListBrowser's sidebarExtraBottom (e.g. seller filter info). */
  extraBottom?: ReactNode

  // ── Gamma taxonomy axis (ADR-277 D4) — mirrors ListBrowser's own axis props ──
  taxonomy?: TaxonomyAxis
  onTaxonomyChange?: (axis: TaxonomyAxis) => void
  gammaTagFacets?: GammaTagFacet[]
  selectedGammaTags?: string[]
  onSelectGammaTags?: (tags: string[]) => void
}

export function FilterDrawer({
  open,
  onClose,
  filterTabs,
  activeFilterTab,
  onFilterTabChange,
  sortBy,
  onSortChange,
  sortOptions,
  categories,
  selectedCategory,
  onSelectCategory,
  countItems,
  hideEmptyCategories,
  showOfferCounts,
  resultCount,
  extraTop,
  extraBottom,
  taxonomy,
  onTaxonomyChange,
  gammaTagFacets,
  selectedGammaTags,
  onSelectGammaTags,
}: FilterDrawerProps) {
  const gammaAxisAvailable = taxonomy !== undefined && onTaxonomyChange !== undefined
    && gammaTagFacets !== undefined && gammaTagFacets.length > 0
    && selectedGammaTags !== undefined && onSelectGammaTags !== undefined
  const effectiveTaxonomy: TaxonomyAxis = gammaAxisAvailable ? taxonomy! : 'standard'

  return (
    <FilterDrawerShell open={open} onClose={onClose} resultCount={resultCount}>
      <div className="flex flex-col gap-1.5">
        <FilterDrawerSectionLabel>Browse</FilterDrawerSectionLabel>
        <div className="grid grid-cols-2 gap-1.5">
          {filterTabs.map(tab => {
            const isActive = activeFilterTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => onFilterTabChange(tab.key)}
                className="flex items-center justify-center text-[12px] px-2 py-2 rounded-lg cursor-pointer transition-all duration-150"
                style={{
                  background: isActive ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
                  color: isActive ? 'white' : 'var(--theme-text)',
                  border: isActive ? 'none' : '1px solid var(--theme-border)',
                  fontWeight: 600,
                }}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {sortOptions && sortOptions.length > 0 && onSortChange && (
        <div className="flex flex-col gap-1.5">
          <FilterDrawerSectionLabel>Sort by</FilterDrawerSectionLabel>
          <div className="flex flex-col gap-1">
            {sortOptions.map(opt => {
              const isActive = sortBy === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => onSortChange(opt.value)}
                  className="flex items-center justify-between text-[12px] px-2.5 py-1.5 rounded-lg cursor-pointer transition-all duration-150 text-left"
                  style={{
                    background: isActive ? 'rgba(99,179,237,0.12)' : 'var(--theme-bg-subtle)',
                    color: isActive ? 'var(--color-primary-50)' : 'var(--theme-text)',
                    border: isActive ? '1px solid rgba(99,179,237,0.30)' : '1px solid var(--theme-border)',
                    fontWeight: isActive ? 600 : 400,
                  }}
                >
                  {opt.label}
                  {isActive && <Check size={13} />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {extraTop}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <Tag size={10} style={{ color: 'var(--theme-text-muted)' }} />
          <FilterDrawerSectionLabel>Categories</FilterDrawerSectionLabel>
        </div>
        {gammaAxisAvailable && (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => onTaxonomyChange!('standard')}
              className="flex items-center justify-center gap-1.5 text-[11px] px-2 py-1.5 rounded-lg cursor-pointer transition-all duration-150"
              style={{
                background: effectiveTaxonomy === 'standard' ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
                color: effectiveTaxonomy === 'standard' ? 'white' : 'var(--theme-text)',
                border: effectiveTaxonomy === 'standard' ? 'none' : '1px solid var(--theme-border)',
                fontWeight: 600,
              }}
              title="Standard: browse by the curated product category tree"
            >
              <LayoutGrid size={12} />
              Standard
            </button>
            <button
              onClick={() => onTaxonomyChange!('gamma')}
              className="flex items-center justify-center gap-1.5 text-[11px] px-2 py-1.5 rounded-lg cursor-pointer transition-all duration-150"
              style={{
                background: effectiveTaxonomy === 'gamma' ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
                color: effectiveTaxonomy === 'gamma' ? 'white' : 'var(--theme-text)',
                border: effectiveTaxonomy === 'gamma' ? 'none' : '1px solid var(--theme-border)',
                fontWeight: 600,
              }}
              title="Gamma: browse by free-form marketplace tags (NIP-99), shared with other Nostr marketplaces"
            >
              <Hash size={12} />
              Gamma
            </button>
          </div>
        )}
        {effectiveTaxonomy === 'gamma' ? (
          <div style={{ width: DRAWER_CATEGORY_PANEL_W }}>
            <GammaTagPanel
              facets={gammaTagFacets!}
              selectedTags={selectedGammaTags!}
              onSelectTags={onSelectGammaTags!}
              showOfferCounts={showOfferCounts}
              chipsMaxHeight={360}
            />
          </div>
        ) : (
          <div style={{ width: DRAWER_CATEGORY_PANEL_W, height: 360 }}>
            <CategorySidebar
              categories={categories}
              selectedCategory={selectedCategory}
              onSelectCategory={onSelectCategory}
              filterTab={activeFilterTab}
              offers={countItems}
              hideEmptyCategories={hideEmptyCategories}
              showOfferCounts={showOfferCounts}
              panelWidth={DRAWER_CATEGORY_PANEL_W}
            />
          </div>
        )}
      </div>

      {extraBottom}
    </FilterDrawerShell>
  )
}
