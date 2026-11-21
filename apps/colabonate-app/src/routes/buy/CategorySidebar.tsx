// CategorySidebar + AlphaFilter – extracted from BuyDashboard.tsx (ADR-110)
// Shared by BuyDashboard and CoopDashboard.
// Uses StandardCategory (UNSPSC – the ONLY taxonomy) for 3-level slide navigation.

import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { gsap } from 'gsap'
import {
  Package, Briefcase, LayoutGrid, ChevronRight, ChevronLeft,
  X, Star, Tag, Store, MapPin,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@ds/utils'
import { SearchInput } from '../../components/ui/SearchInput'
import type { StandardCategory } from '../../types/api'

// ── Constants ─────────────────────────────────────────────────────────────────

const SIDEBAR_W = 190

// ── Accent (ADR-220) ──────────────────────────────────────────────────────────
// Consumers may pass categories carrying their own accent colors and icon
// (e.g. Coop's synthetic cooperation-type roots). Without an accent the
// default PRODUCT-green / SERVICE-purple styling with Package/Briefcase applies.

export interface CategoryAccent {
  /** Solid accent color (CSS color or var()) — icon + selected border/title. */
  color: string
  /** Subtle tinted background for the chip/card surface. */
  bg: string
  /** Subtle border color for the unselected state. */
  border: string
  /** Icon replacing the default Package/Briefcase. */
  icon?: LucideIcon
}

export type BrowsableCategory = StandardCategory & { accent?: CategoryAccent }



// ── filterSubcategories ───────────────────────────────────────────────────────

export function filterSubcategories(
  node: StandardCategory | undefined,
  childrenOf: Map<string, StandardCategory[]>,
  search: string,
  hideEmptyCategories: boolean,
  offerCountBySlug: Map<string, number>,
): StandardCategory[] {
  if (!node) return []
  let cats = (childrenOf.get(node.id) || []).slice().sort((a, b) => a.sortOrder - b.sortOrder)
  if (hideEmptyCategories) cats = cats.filter(c => (offerCountBySlug.get(c.slug) ?? 0) > 0)
  if (search.trim()) {
    const q = search.toLowerCase()
    cats = cats.filter(c => c.name.toLowerCase().includes(q))
  }
  return cats
}

// ── OfferBadge ────────────────────────────────────────────────────────────────

function OfferBadge({ count, isSelected }: { count: number; isSelected: boolean }) {
  return (
    <span
      className="rounded-full shrink-0"
      style={{
        padding: '0 5px',
        fontSize: 9, fontWeight: 600, lineHeight: '16px',
        background: isSelected ? 'rgba(255,255,255,0.20)' : 'var(--theme-bg-subtle)',
        color: isSelected ? 'white' : 'var(--theme-text-muted)',
      }}
    >
      {count}
    </span>
  )
}

// ── CategorySidebar Types ─────────────────────────────────────────────────────

export interface CategorySidebarProps {
  categories: StandardCategory[]
  selectedCategory: string
  onSelectCategory: (slug: string) => void
  filterTab: string
  offers: Array<{ categoryCode?: string | null }>
  hideEmptyCategories?: boolean
  showOfferCounts?: boolean
  savedFilters?: Array<{ id: string; name: string; filters: Record<string, unknown> }>
  onApplyFilter?: (id: string) => void
  onDeleteFilter?: (id: string) => void
  currentFilters?: Record<string, unknown>
  onSaveFilter?: () => void
  sellerFilterInfo?: { label: string; offerCount?: number }
  onClearSellerFilter?: () => void
  countryFilter?: string
  onCountryChange?: (country: string) => void
  allCountries?: string[]
  /** Width of each slide panel; the slide animation math depends on it. Defaults to the sidebar's 190px. */
  panelWidth?: number
}

// ── CategorySidebar ───────────────────────────────────────────────────────────

export function CategorySidebar({
  categories,
  selectedCategory,
  onSelectCategory,
  filterTab,
  offers,
  hideEmptyCategories = false,
  showOfferCounts = true,
  savedFilters = [],
  onApplyFilter,
  onDeleteFilter,
  currentFilters,
  onSaveFilter,
  sellerFilterInfo,
  onClearSellerFilter,
  countryFilter = '',
  onCountryChange,
  allCountries = [],
  panelWidth = SIDEBAR_W,
}: CategorySidebarProps) {
  const slideRef = useRef<HTMLDivElement>(null)
  // The clipping viewport for the slide panels. Its width is the real available
  // width — smaller than `panelWidth` when the sidebar/drawer shows a vertical
  // scrollbar. Panels used to be hardcoded to `panelWidth`, so that scrollbar
  // made them overflow and the outer `overflow-hidden` clipped their right edge
  // (the trailing chevron/border looked cut off). Measure instead.
  const clipRef = useRef<HTMLDivElement>(null)
  const [panelW, setPanelW] = useState(panelWidth)
  const [depth, setDepth] = useState(1)
  const [path, setPath] = useState<StandardCategory[]>([])
  const [search, setSearch] = useState('')
  const prefersReducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  // Keep the slide panel width in sync with the real viewport width. The
  // observer also fires when a scrollbar appears/disappears (on the surrounding
  // sidebar) so the panels never overflow their clipping container.
  useLayoutEffect(() => {
    const el = clipRef.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth
      if (w > 0) setPanelW(w)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { childrenOf, roots, byId } = useMemo(() => {
    const byId = new Map<string, StandardCategory>()
    const childrenOf = new Map<string, StandardCategory[]>()
    categories.forEach(c => byId.set(c.id, c))
    categories.forEach(c => {
      if (c.parentId && byId.has(c.parentId)) {
        const list = childrenOf.get(c.parentId) || []
        list.push(c)
        childrenOf.set(c.parentId, list)
      }
    })
    const roots = categories
      .filter(c => c.level === 1)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    return { childrenOf, roots, byId }
  }, [categories])

  useEffect(() => {
    setDepth(1)
    setPath([])
    setSearch('')
  }, [filterTab])  // eslint-disable-line react-hooks/exhaustive-deps

  function navigateTo(category: StandardCategory) {
    setPath(prev => [...prev.slice(0, category.level - 1), category])
    setDepth(category.level + 1)
  }

  function navigateToDepth(targetDepth: number) {
    setPath(prev => prev.slice(0, targetDepth - 1))
    setDepth(targetDepth)
  }

  function navigateBack() {
    if (depth > 1) navigateToDepth(depth - 1)
  }

  function handleSelect(slug: string) {
    onSelectCategory(selectedCategory === slug ? '' : slug)
  }

  const offerCountBySlug = useMemo(() => {
    const counts = new Map<string, number>()
    for (const o of offers) {
      const code = o.categoryCode || ''
      counts.set(code, (counts.get(code) || 0) + 1)
      const parts = code.split('/')
      for (let i = 1; i < parts.length; i++) {
        const prefix = parts.slice(0, i).join('/')
        counts.set(prefix, (counts.get(prefix) || 0) + 1)
      }
    }
    return counts
  }, [offers])

  const cats1 = useMemo(() => {
    let cats = roots
    if (filterTab === 'products') cats = cats.filter(c => c.offerType === 'PRODUCT')
    else if (filterTab === 'services') cats = cats.filter(c => c.offerType === 'SERVICE')
    if (hideEmptyCategories) cats = cats.filter(c => (offerCountBySlug.get(c.slug) ?? 0) > 0)
    if (search.trim()) {
      const q = search.toLowerCase()
      cats = cats.filter(c => c.name.toLowerCase().includes(q))
    }
    return cats
  }, [roots, filterTab, search, hideEmptyCategories, offerCountBySlug])

  const cats2 = useMemo(
    () => filterSubcategories(path[0], childrenOf, search, hideEmptyCategories, offerCountBySlug),
    [path, childrenOf, search, hideEmptyCategories, offerCountBySlug],
  )

  const cats3 = useMemo(
    () => filterSubcategories(path[1], childrenOf, search, hideEmptyCategories, offerCountBySlug),
    [path, childrenOf, search, hideEmptyCategories, offerCountBySlug],
  )

  const isSearching = search.trim().length > 0

  const searchResults = useMemo(() => {
    if (!isSearching) return []
    const q = search.toLowerCase()
    const results: Array<{ cat: StandardCategory; parentNames: string[] }> = []
    for (const cat of categories) {
      if (!cat.name.toLowerCase().includes(q)) continue
      const parentNames: string[] = []
      let current = cat
      while (current.parentId) {
        const parent = byId.get(current.parentId)
        if (!parent) break
        parentNames.unshift(parent.name)
        current = parent
      }
      results.push({ cat, parentNames })
    }
    return results
  }, [isSearching, search, categories, byId])

  useEffect(() => {
    if (!slideRef.current) return
    const anim = gsap.to(slideRef.current, {
      x: isSearching ? 0 : -(depth - 1) * panelW,
      duration: prefersReducedMotion ? 0 : 0.3,
      ease: 'power2.out',
    })
    return () => { anim.kill() }
  }, [depth, prefersReducedMotion, isSearching, panelW])

  function renderRootCard(cat: BrowsableCategory) {
    const accent = cat.accent
    const isProduct = cat.offerType === 'PRODUCT'
    const Icon = accent?.icon ?? (isProduct ? Package : Briefcase)
    const childCount = childrenOf.get(cat.id)?.length ?? 0
    const offerCount = offerCountBySlug.get(cat.slug) ?? 0
    const isSelected = selectedCategory === cat.slug

    return (
      <button
        key={cat.id}
        onClick={() => childCount > 0 ? navigateTo(cat) : handleSelect(cat.slug)}
        className="flex items-center w-full gap-3 text-left transition-all duration-150 rounded-lg cursor-pointer"
        style={{
          padding: '10px 12px',
          background: isSelected
            ? (accent ? accent.bg : 'rgba(99,179,237,0.12)')
            : accent ? accent.bg
            : isProduct ? 'rgba(72,187,120,0.08)' : 'rgba(159,122,234,0.08)',
          border: `1px solid ${isSelected
            ? (accent ? accent.color : 'rgba(99,179,237,0.30)')
            : accent ? accent.border
            : isProduct ? 'rgba(72,187,120,0.18)' : 'rgba(159,122,234,0.18)'}`,
        }}
      >
        <div
          className="flex items-center justify-center rounded-lg shrink-0"
          style={{
            width: 32, height: 32,
            background: accent ? accent.bg
              : isProduct ? 'rgba(72,187,120,0.14)' : 'rgba(159,122,234,0.14)',
          }}
        >
          <Icon
            size={16}
            style={{ color: accent ? accent.color : isProduct ? 'var(--color-status-success)' : 'var(--color-secondary-50)' }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-[13px] font-semibold truncate"
            style={{ color: isSelected ? (accent?.color ?? 'var(--color-primary-50)') : 'var(--theme-text)' }}
          >
            {cat.name}
          </div>
          {showOfferCounts && (
            <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
              <span>{offerCount} {offerCount === 1 ? 'item' : 'items'}</span>
              {childCount > 0 && <span>· {childCount}</span>}
            </div>
          )}
        </div>
        {childCount > 0 && (
          <ChevronRight size={14} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        )}
      </button>
    )
  }

  function renderSearchResultRow({ cat, parentNames }: { cat: StandardCategory; parentNames: string[] }) {
    const isSelected = selectedCategory === cat.slug
    const offerCount = offerCountBySlug.get(cat.slug) ?? 0
    const indent = (cat.level - 1) * 8

    return (
      <button
        key={cat.id}
        onClick={() => handleSelect(cat.slug)}
        className="flex items-center w-full gap-2 px-2.5 py-2 rounded-lg cursor-pointer text-left transition-all duration-150 min-w-0"
        style={{
          paddingLeft: `${10 + indent}px`,
          background: isSelected ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
          border: isSelected ? '1px solid var(--color-primary-50)' : '1px solid var(--theme-border)',
          color: isSelected ? 'white' : 'var(--theme-text)',
        }}
      >
        <LayoutGrid size={13} style={{ flexShrink: 0, opacity: isSelected ? 1 : 0.5 }} />
        <div className="flex-1 min-w-0">
          <span className="text-[13px] font-medium truncate block">{cat.name}</span>
          {parentNames.length > 0 && (
            <span className="text-[10px] truncate block" style={{ color: isSelected ? 'rgba(255,255,255,0.65)' : 'var(--theme-text-muted)' }}>
              {parentNames.join(' › ')}
            </span>
          )}
        </div>
        {showOfferCounts && offerCount > 0 && <OfferBadge count={offerCount} isSelected={isSelected} />}
      </button>
    )
  }

  function renderCatRow(cat: StandardCategory, panelDepth: number) {
    const hasChildren = (childrenOf.get(cat.id)?.length ?? 0) > 0 && panelDepth < 3
    const isSelected = selectedCategory === cat.slug
    const offerCount = offerCountBySlug.get(cat.slug) ?? 0

    return (
      <div
        key={cat.id}
        className="flex items-center transition-all duration-150 rounded-lg"
        style={{ background: isSelected ? 'var(--color-primary-50)' : 'transparent' }}
      >
        <button
          onClick={() => handleSelect(cat.slug)}
          className="flex-1 flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer text-left min-w-0"
          style={{ background: 'none', border: 'none', color: isSelected ? 'white' : 'var(--theme-text)' }}
        >
          <LayoutGrid size={13} style={{ flexShrink: 0, opacity: isSelected ? 1 : 0.5 }} />
          <span className="text-[13px] font-medium truncate flex-1">{cat.name}</span>
          {showOfferCounts && offerCount > 0 && <OfferBadge count={offerCount} isSelected={isSelected} />}
        </button>
        {hasChildren && (
          <button
            onClick={(e) => { e.stopPropagation(); navigateTo(cat) }}
            className="flex items-center justify-center transition-all duration-150 rounded-md cursor-pointer shrink-0 hover:scale-110"
            style={{
              width: 28, height: 28,
              background: isSelected ? 'rgba(255,255,255,0.18)' : 'var(--theme-bg-subtle)',
              border: isSelected ? '1px solid rgba(255,255,255,0.25)' : '1px solid var(--theme-border)',
              color: isSelected ? 'white' : 'var(--theme-text-muted)',
              marginRight: 3,
            }}
            aria-label={`Subcategories of ${cat.name}`}
            title={`${cat.name} – ${childrenOf.get(cat.id)?.length ?? 0} Subkategorien`}
          >
            <ChevronRight size={15} strokeWidth={2.5} />
          </button>
        )}
      </div>
    )
  }

  function emptyPanel(msg: string) {
    return (
      <div className="flex items-center justify-center gap-1 px-2 py-1.5 text-center">
        <Tag size={11} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>{msg}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-w-0 gap-2">
      <div className="shrink-0 flex flex-col gap-1.5">
        <div className="flex items-center gap-0">
          <div className="flex-1 min-w-0">
            <SearchInput
              variant="compact"
              size="sm"
              value={search}
              onChange={setSearch}
              onClear={() => setSearch('')}
              placeholder="Filter…"
            />
          </div>
        </div>

        {savedFilters.length > 0 && (
          <div className="flex flex-col gap-1 shrink-0">
            <div className="flex items-center gap-1.5 px-0.5">
              <Star size={10} style={{ color: 'var(--color-primary-50)' }} />
              <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)' }}>
                Saved Filters
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {savedFilters.map(filter => {
                const isActive = currentFilters && JSON.stringify(currentFilters) === JSON.stringify(filter.filters)
                return (
                  <button
                    key={filter.id}
                    onClick={() => onApplyFilter?.(filter.id)}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium cursor-pointer transition-all duration-150"
                    style={{
                      background: isActive ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
                      color: isActive ? 'white' : 'var(--theme-text)',
                      border: isActive ? 'none' : '1px solid var(--theme-border)',
                    }}
                  >
                    <Star size={8} className={isActive ? 'fill-white' : cn('')} style={{ color: isActive ? 'white' : 'var(--color-primary-50)' }} />
                    {filter.name}
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteFilter?.(filter.id) }}
                      className="ml-0.5 hover:opacity-70"
                      style={{ background: 'none', border: 'none', padding: 0, color: isActive ? 'white' : 'var(--theme-text-muted)' }}
                    >
                      <X size={8} />
                    </button>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {onSaveFilter && (
          <button
            onClick={onSaveFilter}
            className="flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition-all duration-150"
            style={{
              background: 'rgba(99,179,237,0.08)',
              border: '1px solid rgba(99,179,237,0.20)',
              color: 'var(--color-primary-50)',
            }}
          >
            <Star size={10} />
            Save current filter
          </button>
        )}

        {(onCountryChange || countryFilter) && (
          <div className="shrink-0">
            <div className="flex items-center gap-1.5 px-0.5 mb-1">
              <MapPin size={10} style={{ color: 'var(--theme-text-muted)' }} />
              <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)' }}>
                Location
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => onCountryChange?.('')}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] cursor-pointer transition-all duration-150 text-left"
                style={{
                  background: countryFilter === '' ? 'rgba(99,179,237,0.12)' : 'var(--theme-bg-subtle)',
                  border: countryFilter === '' ? '1px solid rgba(99,179,237,0.30)' : '1px solid var(--theme-border)',
                  color: countryFilter === '' ? 'var(--color-primary-50)' : 'var(--theme-text)',
                  fontWeight: countryFilter === '' ? 600 : 400,
                }}
              >
                <span className="text-[12px]">All countries</span>
              </button>
              {allCountries.slice(0, 8).map(c => (
                <button
                  key={c}
                  onClick={() => onCountryChange?.(countryFilter === c ? '' : c)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] cursor-pointer transition-all duration-150 text-left"
                  style={{
                    background: countryFilter === c ? 'rgba(99,179,237,0.12)' : 'var(--theme-bg-subtle)',
                    border: countryFilter === c ? '1px solid rgba(99,179,237,0.30)' : '1px solid var(--theme-border)',
                    color: countryFilter === c ? 'var(--color-primary-50)' : 'var(--theme-text)',
                    fontWeight: countryFilter === c ? 600 : 400,
                  }}
                >
                  <MapPin size={9} style={{ flexShrink: 0, opacity: countryFilter === c ? 1 : 0.5 }} />
                  <span className="truncate">{c}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {depth > 1 && (
          <div className="shrink-0 flex flex-col gap-0.5">
            {path.map((cat, i) => {
              const isCurrent = i === path.length - 1
              const isNavigable = !isCurrent
              return (
                <button
                  key={cat.id}
                  onClick={() => isNavigable ? navigateToDepth(i + 1) : navigateBack()}
                  className="flex items-center gap-1.5 px-2 py-1 text-left truncate rounded-md cursor-pointer"
                  style={{
                    background: isCurrent ? 'rgba(99,179,237,0.10)' : 'var(--theme-bg-subtle)',
                    border: isCurrent ? '1px solid rgba(99,179,237,0.20)' : '1px solid var(--theme-border)',
                    paddingLeft: `${8 + i * 10}px`,
                    fontSize: isCurrent ? 11 : 10,
                    fontWeight: isCurrent ? 700 : 500,
                    color: isCurrent ? 'var(--color-primary-50)' : 'var(--theme-text)',
                    maxWidth: '100%',
                  }}
                >
                  {isCurrent && <ChevronLeft size={12} />}
                  {!isCurrent && <ChevronRight size={12} style={{ opacity: 0.5 }} />}
                  {cat.name}
                </button>
              )
            })}
          </div>
        )}



        {sellerFilterInfo && (
          <div className="mt-1 shrink-0">
            <div
              className="flex items-center w-full gap-3 text-left rounded-lg"
              style={{
                padding: '10px 12px',
                background: 'rgba(99,179,237,0.12)',
                border: '1px solid rgba(99,179,237,0.30)',
              }}
            >
              <div
                className="flex items-center justify-center rounded-lg shrink-0"
                style={{ width: 32, height: 32, background: 'rgba(99,179,237,0.14)' }}
              >
                <Store size={16} style={{ color: 'var(--color-primary-50)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold truncate" style={{ color: 'var(--color-primary-50)' }}>
                  {sellerFilterInfo.label}
                </div>
                {sellerFilterInfo.offerCount !== undefined && (
                  <div className="text-[11px]" style={{ color: 'rgba(99,179,237,0.7)' }}>
                    {sellerFilterInfo.offerCount} {sellerFilterInfo.offerCount === 1 ? 'item' : 'items'}
                  </div>
                )}
              </div>
              {onClearSellerFilter && (
                <button
                  onClick={onClearSellerFilter}
                  className="flex items-center justify-center transition-opacity rounded-full cursor-pointer shrink-0 hover:opacity-70"
                  style={{ width: 18, height: 18, background: 'rgba(99,179,237,0.20)', border: 'none', padding: 0 }}
                  aria-label="Clear seller filter"
                >
                  <X size={10} style={{ color: 'var(--color-primary-50)' }} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div ref={clipRef} className="relative flex-1 overflow-hidden" style={{ minHeight: 0 }}>
        <div
          ref={slideRef}
          className="flex"
          style={{ width: isSearching ? panelW : panelW * 3, height: '100%' }}
        >
          <div
            className="overflow-y-auto shrink-0"
            style={{
              width: isSearching ? '100%' : panelW, height: '100%',
              scrollbarWidth: 'thin', scrollbarColor: 'var(--theme-border) transparent',
            }}
          >
            {isSearching ? (
              searchResults.length === 0
                ? emptyPanel('No results')
                : <div className="flex flex-col gap-0.5 p-0.5">{searchResults.map(renderSearchResultRow)}</div>
            ) : (
              cats1.length === 0
                ? emptyPanel('No categories')
                : <div className="flex flex-col gap-1.5 p-0.5">{cats1.map(renderRootCard)}</div>
            )}
          </div>

          {!isSearching && (
            <div
              className="overflow-y-auto shrink-0"
              style={{
                width: panelW, height: '100%',
                scrollbarWidth: 'thin', scrollbarColor: 'var(--theme-border) transparent',
              }}
            >
              {cats2.length === 0
                ? emptyPanel('No subcategories')
                : <div className="flex flex-col gap-0.5 p-0.5">{cats2.map(c => renderCatRow(c, 2))}</div>
              }
            </div>
          )}

          {!isSearching && (
            <div
              className="overflow-y-auto shrink-0"
              style={{
                width: panelW, height: '100%',
                scrollbarWidth: 'thin', scrollbarColor: 'var(--theme-border) transparent',
              }}
            >
              {cats3.length === 0
                ? emptyPanel('No categories')
                : <div className="flex flex-col gap-0.5 p-0.5">{cats3.map(c => renderCatRow(c, 3))}</div>
              }
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
