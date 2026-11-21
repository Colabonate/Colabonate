import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Search, Package, Briefcase, ChevronRight, ChevronLeft, Tag, LayoutGrid, X, Store } from 'lucide-react'
import { Popover } from '@mui/material'
import { SearchInput } from '../../components/ui/SearchInput'
import type { StandardCategory } from '../../types/api'
import type { BrowsableCategory } from './CategorySidebar'

interface CategoryTopPanelProps {
  categories: StandardCategory[]
  selectedCategory: string
  onSelectCategory: (slug: string) => void
  /** Root categories are filtered by `offerType` when this equals 'products'/'services'; any other value shows all. */
  filterTab: string
  offers: Array<{ categoryCode?: string | null }>
  hideEmptyCategories?: boolean
  showOfferCounts?: boolean
  sellerFilterInfo?: { label: string; offerCount?: number }
  onClearSellerFilter?: () => void
  isMobile?: boolean
}

// ── CategoryTopPanel ────────────────────────────────────────────────

export function CategoryTopPanel({
  categories,
  selectedCategory,
  onSelectCategory,
  filterTab,
  offers,
  hideEmptyCategories = false,
  showOfferCounts = true,
  sellerFilterInfo,
  onClearSellerFilter,
  isMobile = false,
}: CategoryTopPanelProps) {
  const [search, setSearch] = useState('')
  const [path, setPath] = useState<StandardCategory[]>([])
  const [searchAnchor, setSearchAnchor] = useState<HTMLElement | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const didDrag = useRef(false)
  const dragStartX = useRef(0)
  const scrollStartX = useRef(0)

  // ── Drag-to-scroll for horizontal options list ────────────────────
  const onDragScrollMouseDown = useCallback((e: React.MouseEvent) => {
    const el = scrollRef.current
    if (!el) return
    isDragging.current = true
    didDrag.current = false
    dragStartX.current = e.pageX - el.offsetLeft
    scrollStartX.current = el.scrollLeft
    el.style.cursor = 'grabbing'
    el.style.userSelect = 'none'
  }, [])

  const onDragScrollMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return
    e.preventDefault()
    const el = scrollRef.current
    if (!el) return
    const x = e.pageX - el.offsetLeft
    const walk = (x - dragStartX.current) * 1.5
    el.scrollLeft = scrollStartX.current - walk
    // Mark as real drag once threshold exceeded
    if (Math.abs(walk) > 4) {
      didDrag.current = true
      // Disable pointer-events on children only (not the container itself!)
      for (const child of el.children) {
        (child as HTMLElement).style.pointerEvents = 'none'
      }
    }
  }, [])

  const onDragScrollMouseUp = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    isDragging.current = false
    el.style.cursor = ''
    el.style.userSelect = ''
    // Re-enable pointer-events on children
    for (const child of el.children) {
      (child as HTMLElement).style.pointerEvents = ''
    }
  }, [])

  // ── Build lookup maps ─────────────────────────────────────────────
  const { childrenOf, roots } = useMemo(() => {
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
    return { childrenOf, roots }
  }, [categories])

  // ── Tab sync: reset navigation on tab change ──────────────────────
  useEffect(() => {
    setPath([])
    setSearch('')
  }, [filterTab])

  // ── Sync path from selectedCategory (external changes) ───────────
  useEffect(() => {
    if (!selectedCategory) return
    const parts = selectedCategory.split('/')
    const newPath: StandardCategory[] = []
    let slug = ''
    for (const part of parts) {
      slug = slug ? `${slug}/${part}` : part
      const cat = categories.find(c => c.slug === slug)
      if (cat) newPath.push(cat)
      else break
    }
    setPath(prev => {
      const prevSlugs = prev.map(c => c.slug).join('/')
      const newSlugs = newPath.map(c => c.slug).join('/')
      return prevSlugs === newSlugs ? prev : newPath
    })
  }, [selectedCategory, categories])

  // ── Offer count per category slug prefix ─────────────────────────
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

  // ── Options for current navigation level ──────────────────────────
  const options = useMemo(() => {
    if (path.length === 0) {
      let cats = roots
      if (filterTab === 'products') cats = cats.filter(c => c.offerType === 'PRODUCT')
      else if (filterTab === 'services') cats = cats.filter(c => c.offerType === 'SERVICE')
      if (hideEmptyCategories) cats = cats.filter(c => (offerCountBySlug.get(c.slug) ?? 0) > 0)
      return cats
    }
    const parent = path[path.length - 1]
    let cats = (childrenOf.get(parent.id) || [])
      .slice().sort((a, b) => a.sortOrder - b.sortOrder)
    if (hideEmptyCategories) cats = cats.filter(c => (offerCountBySlug.get(c.slug) ?? 0) > 0)
    return cats
  }, [path, roots, childrenOf, filterTab, hideEmptyCategories, offerCountBySlug])

  // ── Mobile options: always hide empty categories (0 items) ───────
  const mobileOptions = useMemo(() => {
    return options.filter(c => (offerCountBySlug.get(c.slug) ?? 0) > 0)
  }, [options, offerCountBySlug])

  // ── Search across all categories ──────────────────────────────────
  const searchResults = useMemo(() => {
    if (!search.trim()) return []
    const q = search.toLowerCase()
    const results: Array<{ cat: StandardCategory; parentNames: string[] }> = []
    for (const cat of categories) {
      if (!cat.name.toLowerCase().includes(q)) continue
      const parentNames: string[] = []
      let current = cat
      while (current.parentId) {
        const parent = categories.find(c => c.id === current!.parentId)
        if (!parent) break
        parentNames.unshift(parent.name)
        current = parent
      }
      results.push({ cat, parentNames })
    }
    return results
  }, [search, categories])

  // ── Handlers ──────────────────────────────────────────────────────

  /** Click an option chip: always apply filter and navigate into sub-levels */
  function handleOptionClick(cat: StandardCategory) {
    // Ignore click if it was actually a drag-scroll
    if (didDrag.current) { didDrag.current = false; return }
    if (selectedCategory === cat.slug) {
      onSelectCategory('')
      setPath(prev => prev.slice(0, -1))
      return
    }
    onSelectCategory(cat.slug)
    setPath(prev => [...prev, cat])
  }

  /** Click a selected path chip: go back to that level */
  function handlePathClick(index: number) {
    setPath(prev => prev.slice(0, index))
    onSelectCategory('')
  }

  /** Select from search results: build full path + apply filter */
  function handleSearchSelect(slug: string) {
    onSelectCategory(slug)
    setSearch('')
    setSearchAnchor(null)
    // Build path from slug
    const parts = slug.split('/')
    const newPath: StandardCategory[] = []
    let currentSlug = ''
    for (const part of parts) {
      currentSlug = currentSlug ? `${currentSlug}/${part}` : part
      const cat = categories.find(c => c.slug === currentSlug)
      if (cat) newPath.push(cat)
    }
    setPath(newPath)
  }

  // ── Render: Path Chip (selected, clickable to go back) ───────────
  function renderPathChip(cat: BrowsableCategory, index: number) {
    const isProduct = cat.offerType === 'PRODUCT'
    const Icon = cat.accent?.icon ?? (isProduct ? Package : Briefcase)
    return (
      <button
        key={cat.id}
        onClick={() => handlePathClick(index)}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg cursor-pointer shrink-0 transition-all duration-150"
        style={{
          background: cat.accent?.color ?? 'var(--color-primary-50)',
          color: 'white',
          border: 'none',
        }}
        title="Zurück"
      >
        <Icon size={12} />
        <span className="text-[12px] font-medium whitespace-nowrap">{cat.name}</span>
        <X size={10} style={{ opacity: 0.7 }} />
      </button>
    )
  }

  // ── Render: Option Chip (available to select) ─────────────────────
  function renderOptionChip(cat: BrowsableCategory) {
    const accent = cat.accent
    const isProduct = cat.offerType === 'PRODUCT'
    const Icon = accent?.icon ?? (isProduct ? Package : Briefcase)
    const childCount = childrenOf.get(cat.id)?.length ?? 0
    const offerCount = offerCountBySlug.get(cat.slug) ?? 0
    return (
      <button
        key={cat.id}
        onClick={() => handleOptionClick(cat)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg cursor-pointer text-left shrink-0 transition-all duration-150"
        style={{
          background: accent ? accent.bg
            : isProduct ? 'rgba(72,187,120,0.08)' : 'rgba(159,122,234,0.08)',
          border: `1px solid ${accent ? accent.border
            : isProduct ? 'rgba(72,187,120,0.18)' : 'rgba(159,122,234,0.18)'}`,
          color: 'var(--theme-text)',
        }}
      >
        <Icon
          size={13}
          style={{
            color: accent ? accent.color
              : isProduct ? 'var(--color-status-success)' : 'var(--color-secondary-50)',
            flexShrink: 0,
          }}
        />
        <span className="text-[12px] font-medium whitespace-nowrap">{cat.name}</span>
        {showOfferCounts && (
          <span
            className="text-[10px] font-semibold whitespace-nowrap"
            style={{ color: 'var(--theme-text-muted)' }}
          >
            {offerCount}
          </span>
        )}
        {childCount > 0 && (
          <ChevronRight size={12} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        )}
      </button>
    )
  }

  // ── Render: Empty message ─────────────────────────────────────────
  function emptyMessage(msg: string) {
    return (
      <div className="flex items-center justify-center gap-1 py-1 text-center" style={{ minHeight: 22 }}>
        <Tag size={11} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        <span className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>{msg}</span>
      </div>
    )
  }

  // ── Mobile: reset the whole selection ────────────────────────────
  function handleClearAll() {
    onSelectCategory('')
    setPath([])
  }

  // ── Render: Mobile layout (two stacked sections) ─────────────────
  function renderMobileLayout() {
    const levelHint = path.length === 0
      ? 'Choose category'
      : `Sub-categories of ${path[path.length - 1].name}`
    const totalResults = offerCountBySlug.get(selectedCategory) ?? 0

    return (
      <div
        className="flex flex-col gap-2 p-2.5 rounded-xl"
        style={{
          background: 'var(--theme-surface)',
          border: '1px solid var(--theme-border)',
        }}
      >
        {/* ── Section A: Active breadcrumb ──────────────────────── */}
        <div className="flex items-center gap-1.5 min-w-0">
          <div
            ref={scrollRef}
            className="cat-track-mobile flex-1 flex items-center gap-1 min-w-0 overflow-x-auto"
            style={{
              scrollSnapType: 'x proximity',
              WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none',
            }}
            onMouseDown={onDragScrollMouseDown}
            onMouseMove={onDragScrollMouseMove}
            onMouseUp={onDragScrollMouseUp}
            onMouseLeave={onDragScrollMouseUp}
          >
            {/* "All" reset chip */}
            <button
              onClick={() => handleClearAll()}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg cursor-pointer shrink-0 transition-all duration-150"
              style={{
                scrollSnapAlign: 'start',
                background: selectedCategory ? 'var(--theme-bg-subtle)' : 'var(--color-primary-50)',
                color: selectedCategory ? 'var(--theme-text-muted)' : 'white',
                border: selectedCategory ? '1px solid var(--theme-border)' : 'none',
              }}
            >
              <LayoutGrid size={12} />
              <span className="text-[12px] font-medium whitespace-nowrap">All</span>
            </button>

            {path.map((cat, i) => renderPathChip(cat, i))}
          </div>

          {selectedCategory && (
            <button
              onClick={handleClearAll}
              className="flex items-center justify-center rounded-lg cursor-pointer shrink-0 transition-all duration-150"
              style={{
                width: 32, height: 32,
                background: 'var(--theme-bg-subtle)',
                border: '1px solid var(--theme-border)',
                color: 'var(--theme-text-muted)',
              }}
              aria-label="Clear filter"
              title="Filter löschen"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* ── Section B: Available options ──────────────────────── */}
        <div className="flex items-center gap-1.5 px-0.5">
          <span className="text-[9px] font-bold uppercase tracking-widest shrink-0" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
            {levelHint}
          </span>
          {selectedCategory && (
            <span className="text-[9px] font-semibold shrink-0" style={{ color: 'var(--color-primary-50)' }}>
              {totalResults} {totalResults === 1 ? 'result' : 'results'}
            </span>
          )}
          <span className="flex-1" style={{ height: 1, background: 'var(--theme-border)' }} />
          <ChevronLeft size={10} style={{ color: 'var(--theme-text-muted)' }} />
          <span className="text-[9px] shrink-0" style={{ color: 'var(--theme-text-muted)' }}>swipe</span>
          <ChevronRight size={10} style={{ color: 'var(--theme-text-muted)' }} />
        </div>

        {mobileOptions.length === 0 ? (
          emptyMessage('Keine Kategorien')
        ) : (
          <div
            className="cat-track-mobile flex gap-1.5 overflow-x-auto pb-1"
            style={{
              scrollSnapType: 'x proximity',
              WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none',
            }}
          >
            {mobileOptions.map(cat => (
              <div key={cat.id} style={{ scrollSnapAlign: 'start' }}>
                {renderOptionChip(cat)}
              </div>
            ))}
          </div>
        )}

        {/* Seller filter row */}
        {sellerFilterInfo && (
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              onClick={onClearSellerFilter}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer shrink-0 transition-all duration-150"
              style={{
                background: 'rgba(99,179,237,0.12)',
                border: '1px solid rgba(99,179,237,0.30)',
                color: 'var(--color-primary-50)',
              }}
              title="Click to clear seller filter"
            >
              <Store size={13} />
              <span className="text-[12px] font-medium whitespace-nowrap">{sellerFilterInfo.label}</span>
              {sellerFilterInfo.offerCount !== undefined && (
                <span
                  className="text-[10px] font-semibold whitespace-nowrap"
                  style={{ color: 'rgba(99,179,237,0.7)' }}
                >
                  {sellerFilterInfo.offerCount} {sellerFilterInfo.offerCount === 1 ? 'item' : 'items'}
                </span>
              )}
              <X size={10} style={{ opacity: 0.7 }} />
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────
  if (isMobile) return renderMobileLayout()
  return (
    <div
      className="flex flex-col gap-1.5 p-3 rounded-xl"
      style={{
        background: 'var(--theme-surface)',
        border: '1px solid var(--theme-border)',
      }}
    >
      {/* ── Navigation Row ────────────────────────────────────── */}
      <style>{`
        .category-scroll-track { scrollbar-color: transparent transparent; }
        .category-scroll-track:hover { scrollbar-color: var(--theme-border) transparent; }
        .category-scroll-track::-webkit-scrollbar { height: 4px; }
        .category-scroll-track::-webkit-scrollbar-thumb { background: transparent; border-radius: 2px; }
        .category-scroll-track:hover::-webkit-scrollbar-thumb { background: var(--theme-border); }
        .cat-track-mobile::-webkit-scrollbar { display: none; }
      `}</style>
      <div className="flex items-center gap-1.5 min-w-0">

        {/* Search Icon Button → Popover */}
        <button
          onClick={(e) => setSearchAnchor(searchAnchor ? null : e.currentTarget)}
          className="flex items-center justify-center rounded-lg cursor-pointer shrink-0 transition-all duration-150"
          style={{
            width: 32,
            height: 32,
            background: search ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
            color: search ? 'white' : 'var(--theme-text-muted)',
            border: search ? 'none' : '1px solid var(--theme-border)',
          }}
          title="Kategorien durchsuchen"
        >
          <Search size={14} />
        </button>
        <Popover
          open={Boolean(searchAnchor)}
          anchorEl={searchAnchor}
          onClose={() => { setSearchAnchor(null); setSearch('') }}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          slotProps={{ paper: { sx: { p: 1.5, borderRadius: 2, minWidth: 260, maxHeight: 320 } } }}
        >
          <div className="flex flex-col gap-2">
            <SearchInput
              variant="compact"
              size="sm"
              value={search}
              onChange={setSearch}
              onClear={() => setSearch('')}
              placeholder="Kategorie suchen…"
              autoFocus
            />
            {search.trim() && (
              <div
                className="flex flex-col gap-0.5 max-h-56 overflow-y-auto"
                style={{ scrollbarWidth: 'thin' }}
              >
                {searchResults.length === 0
                  ? emptyMessage('Keine Treffer')
                  : searchResults.map(({ cat, parentNames }) => {
                      const isSelected = selectedCategory === cat.slug
                      return (
                        <button
                          key={cat.id}
                          onClick={() => handleSearchSelect(cat.slug)}
                          className="flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer text-left w-full transition-all duration-150"
                          style={{
                            background: isSelected ? 'var(--color-primary-50)' : 'transparent',
                            color: isSelected ? 'white' : 'var(--theme-text)',
                          }}
                        >
                          <LayoutGrid
                            size={13}
                            style={{ flexShrink: 0, opacity: isSelected ? 1 : 0.5 }}
                          />
                          <div className="flex-1 min-w-0">
                            <span className="text-[12px] font-medium truncate block">
                              {cat.name}
                            </span>
                            {parentNames.length > 0 && (
                              <span
                                className="text-[9px] truncate block"
                                style={{
                                  color: isSelected
                                    ? 'rgba(255,255,255,0.65)'
                                    : 'var(--theme-text-muted)',
                                }}
                              >
                                {parentNames.join(' › ')}
                              </span>
                            )}
                          </div>
                        </button>
                      )
                    })}
              </div>
            )}
          </div>
        </Popover>

        {/* Separator */}
        <div
          className="shrink-0"
          style={{ width: 1, height: 20, background: 'var(--theme-border)' }}
        />

        {/* Path Chips — selected categories (sticky left) */}
        {path.length > 0 && (
          <div className="flex items-center gap-1 shrink-0">
            {path.map((cat, i) => renderPathChip(cat, i))}
          </div>
        )}

        {/* Arrow between path and options */}
        {path.length > 0 && (
          <ChevronRight
            size={14}
            className="shrink-0"
            style={{ color: 'var(--theme-text-muted)' }}
          />
        )}

        {/* Options — Horizontal Drag-Scroll (grows from left) */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-x-auto min-w-0 category-scroll-track"
          style={{
            cursor: 'grab',
            scrollbarWidth: 'thin',
            scrollbarColor: 'var(--theme-border) transparent',
          }}
          onMouseDown={onDragScrollMouseDown}
          onMouseMove={onDragScrollMouseMove}
          onMouseUp={onDragScrollMouseUp}
          onMouseLeave={onDragScrollMouseUp}
        >
          {options.length === 0
            ? emptyMessage('Keine Kategorien')
            : (
              <div className="flex gap-1.5">
                {options.map(renderOptionChip)}
              </div>
            )}
        </div>
      </div>

      {/* ── Seller / Company Filter Row ────────────────────────── */}
      {sellerFilterInfo && (
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            onClick={onClearSellerFilter}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer shrink-0 transition-all duration-150"
            style={{
              background: 'rgba(99,179,237,0.12)',
              border: '1px solid rgba(99,179,237,0.30)',
              color: 'var(--color-primary-50)',
            }}
            title="Click to clear seller filter"
          >
            <Store size={13} />
            <span className="text-[12px] font-medium whitespace-nowrap">{sellerFilterInfo.label}</span>
            {sellerFilterInfo.offerCount !== undefined && (
              <span
                className="text-[10px] font-semibold whitespace-nowrap"
                style={{ color: 'rgba(99,179,237,0.7)' }}
              >
                {sellerFilterInfo.offerCount} {sellerFilterInfo.offerCount === 1 ? 'item' : 'items'}
              </span>
            )}
            <X size={10} style={{ opacity: 0.7 }} />
          </button>
        </div>
      )}
    </div>
  )
}
