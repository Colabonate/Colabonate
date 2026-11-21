// CategoriesFilterPanel — ADR-333 D5a. The combined Standard/Gamma sidebar
// entry: one toggle, one position in the configurable panel stack, one icon
// slot. Only ever DISPLAYS whichever taxonomy axis is currently active
// (driven by the existing `taxonomy` state — never switches it); the header
// Standard/Gamma control stays the one control that flips the axis.

import { LayoutGrid, Hash } from 'lucide-react'
import { CategorySidebar } from '../CategorySidebar'
import { GammaTagPanel } from '../GammaTagPanel'
import type { TaxonomyAxis, GammaTagFacet } from '../../../components/list-browser/list-browser.types'
import type { StandardCategory } from '../../../types/api'

export interface CategoriesFilterPanelProps {
  effectiveTaxonomy: TaxonomyAxis
  categories: StandardCategory[]
  selectedCategory: string
  onSelectCategory: (code: string) => void
  activeFilterTab: string
  categoryCountItems: unknown[]
  hideEmptyCategories: boolean
  showOfferCounts: boolean
  gammaTagFacets: GammaTagFacet[]
  selectedGammaTags: string[]
  onSelectGammaTags: (tags: string[]) => void
}

export function CategoriesFilterPanel({
  effectiveTaxonomy,
  categories,
  selectedCategory,
  onSelectCategory,
  activeFilterTab,
  categoryCountItems,
  hideEmptyCategories,
  showOfferCounts,
  gammaTagFacets,
  selectedGammaTags,
  onSelectGammaTags,
}: CategoriesFilterPanelProps) {
  const isGamma = effectiveTaxonomy === 'gamma'
  return (
    <div className="shrink-0 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 px-0.5 mb-1">
        {isGamma ? <Hash size={10} style={{ color: 'var(--theme-text-muted)' }} /> : <LayoutGrid size={10} style={{ color: 'var(--theme-text-muted)' }} />}
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)' }}>
          {isGamma ? 'Gamma Tags' : 'Categories'}
        </span>
      </div>
      {isGamma
        ? <GammaTagPanel facets={gammaTagFacets} selectedTags={selectedGammaTags} onSelectTags={onSelectGammaTags} showOfferCounts={showOfferCounts} showSearch />
        : <CategorySidebar
            categories={categories}
            selectedCategory={selectedCategory}
            onSelectCategory={onSelectCategory}
            filterTab={activeFilterTab}
            offers={categoryCountItems as Array<{ categoryCode?: string | null }>}
            hideEmptyCategories={hideEmptyCategories}
            showOfferCounts={showOfferCounts}
          />
      }
    </div>
  )
}
