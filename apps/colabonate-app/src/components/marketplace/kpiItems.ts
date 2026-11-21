// ADR-335 FU-532 (D0, Phase A): shared marketplace-context KPI strip builder.
// BuyDashboard.tsx and Search.tsx's marketplace-context kpiItems were
// byte-for-byte identical in shape (only the tab-state variable names
// differed) — this is that one definition.

import { Tag, TrendingUp, Package, Briefcase, Store, ShoppingBag } from 'lucide-react'
import { createElement } from 'react'
import type { KPIItem } from '@ds/ui'
import type { Offer } from '../../types/api'

export function buildMarketplaceKpi(input: {
  categoriesLevel1Count: number
  onToggleCategoryOpen: () => void
  categoryOpen: boolean
  marketplaceTotal: number
  filteredOffers: Offer[]
  filteredVendorsCount: number
  activeTab: string
  onSetTab: (tab: string) => void
  itemCount: number
  onGoToCart: () => void
}): KPIItem[] {
  const {
    categoriesLevel1Count, onToggleCategoryOpen, categoryOpen,
    marketplaceTotal, filteredOffers, filteredVendorsCount,
    activeTab, onSetTab, itemCount, onGoToCart,
  } = input

  return [
    { icon: createElement(Tag, { size: 14 }), value: categoriesLevel1Count, label: 'Categories', onClick: onToggleCategoryOpen, active: categoryOpen, heading: 'Market' },
    // ADR-334 D6 follow-up: filter-aware total from /api/search, not the
    // capped filteredOffers.length — tooltip shows the loaded/total split
    // so the user understands what they're seeing (ADR-335 D3).
    { icon: createElement(TrendingUp, { size: 14 }), value: marketplaceTotal, label: 'Results', onClick: () => onSetTab('all'), active: activeTab === 'all', tooltip: `${filteredOffers.length} of ${marketplaceTotal} loaded${filteredOffers.length < marketplaceTotal ? ' — load more below' : ''}` },
    { icon: createElement(Package, { size: 14 }), value: filteredOffers.filter(o => o.offerType === 'PRODUCT').length, label: 'Products', onClick: () => onSetTab('products'), active: activeTab === 'products', heading: 'Types' },
    { icon: createElement(Briefcase, { size: 14 }), value: filteredOffers.filter(o => o.offerType === 'SERVICE').length, label: 'Services', onClick: () => onSetTab('services'), active: activeTab === 'services' },
    { icon: createElement(Store, { size: 14 }), value: filteredVendorsCount, label: 'Vendors', onClick: () => onSetTab('vendors'), active: activeTab === 'vendors' },
    { icon: createElement(ShoppingBag, { size: 14 }), value: itemCount, label: 'Basket', onClick: onGoToCart, active: itemCount > 0, separator: true, activeColor: 'var(--color-status-success)', heading: 'Basket' },
  ]
}
