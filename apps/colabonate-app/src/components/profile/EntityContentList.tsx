// EntityContentList — the unified owned-content list for /u/:pubkey and
// /c/:companyId (ADR-367 D8). One ListBrowser over EntityContentItem[], with
// filter tabs per content type, reusing the app's established list pattern
// (OfferListRow for offers, CoopListRow for bounties/cooperations, a small
// CatalogRow for catalogs) instead of bespoke offer markup.

import { useMemo, useState } from 'react'
import { Layers } from 'lucide-react'
import { ListBrowser } from '../list-browser'
import { OfferListRow } from '../../routes/buy/marketplace-cards'
import { usesNonSatsPriceLabel } from '../offers/RemotePriceLabel'
import { CoopListRow } from '../../routes/coop/coop-cards'
import type { EntityContentItem } from '../../hooks/useEntityOwnedContent'
import type { Catalog } from '../../types/api'

const FILTER_TABS = [
  { key: 'all', label: 'All' },
  { key: 'product', label: 'Products' },
  { key: 'service', label: 'Services' },
  { key: 'agent', label: 'Agent Setups' },
  { key: 'catalog', label: 'Catalogs' },
  { key: 'bounty', label: 'Bounties' },
  { key: 'cooperation', label: 'Cooperations' },
]

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
]

// Minimal read-only row for a Catalog — no public catalog detail page exists,
// so this is a non-linking display card (unlike offer/bounty/cooperation rows).
function CatalogRow({ catalog }: { catalog: Catalog }) {
  const typeLabel = catalog.catalogType === 'PRODUCT' ? 'Product catalog' : 'Agent setup catalog'
  const count = catalog.products?.length ?? 0
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-4 py-3 min-h-[64px]"
      style={{
        background: 'var(--theme-surface)',
        outline: '1px solid var(--theme-border)',
      }}
    >
      <div
        className="flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0"
        style={{ backgroundColor: 'var(--color-primary-10)', color: 'var(--color-primary-50)' }}
      >
        <Layers size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="block text-[14px] font-semibold text-[var(--theme-text)] truncate">
          {catalog.name}
        </span>
        <span className="block text-[12px] text-[var(--theme-text-muted)]">
          {typeLabel}{count > 0 ? ` · ${count} product${count !== 1 ? 's' : ''}` : ''}
        </span>
      </div>
    </div>
  )
}

export function EntityContentList({ items, loading }: { items: EntityContentItem[]; loading: boolean }) {
  const [activeFilterTab, setActiveFilterTab] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('newest')
  const [categoryOpen, setCategoryOpen] = useState(false)

  const filtered = useMemo(() => {
    let list = items
    if (activeFilterTab !== 'all') list = list.filter(i => i.contentType === activeFilterTab)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter(i =>
        i.title.toLowerCase().includes(q) || (i.description ?? '').toLowerCase().includes(q),
      )
    }
    list = [...list].sort((a, b) => {
      if (sortBy === 'price-asc' || sortBy === 'price-desc') {
        // Foreign/unpriced listings have no sats price: keep them after all priced items.
        const aNonSats = !!a.offer && usesNonSatsPriceLabel(a.offer)
        const bNonSats = !!b.offer && usesNonSatsPriceLabel(b.offer)
        if (aNonSats || bNonSats) return aNonSats && bNonSats ? 0 : aNonSats ? 1 : -1
      }
      const av = a.priceSats ?? a.budgetSats ?? 0
      const bv = b.priceSats ?? b.budgetSats ?? 0
      if (sortBy === 'price-asc') return av - bv
      if (sortBy === 'price-desc') return bv - av
      return b.createdAt.localeCompare(a.createdAt)
    })
    return list
  }, [items, activeFilterTab, searchQuery, sortBy])

  return (
    <ListBrowser<EntityContentItem>
      items={filtered}
      loading={loading}
      filterTabs={FILTER_TABS}
      activeFilterTab={activeFilterTab}
      onFilterTabChange={setActiveFilterTab}
      categories={[]}
      selectedCategory=""
      onSelectCategory={() => {}}
      categoryOpen={categoryOpen}
      onCategoryOpenChange={setCategoryOpen}
      hideBuiltinTaxonomyPanel
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      sortBy={sortBy}
      onSortChange={setSortBy}
      sortOptions={SORT_OPTIONS}
      forcedViewMode="list"
      defaultPanelMode="top"
      storageKeyPrefix="entity-owned-content"
      renderCard={(item, size) => {
        if (item.offer) return <OfferListRow offer={item.offer} size={size} />
        if (item.coopItem) return <CoopListRow item={item.coopItem} size={size} />
        if (item.catalog) return <CatalogRow catalog={item.catalog} />
        return null
      }}
      cardKey={(item) => item.id}
      emptyState={
        <div
          className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg-subtle)] px-6 py-10 text-center text-[13px] text-[var(--theme-text-muted)]"
        >
          No published content yet.
        </div>
      }
    />
  )
}
