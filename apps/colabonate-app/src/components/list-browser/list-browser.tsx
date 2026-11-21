// ListBrowser – shared list/filter/sort/scroll/presentation machinery (ADR-218 D1)
// Extracted from BuyDashboard.tsx. Purely presentational + controlled: all filtering logic
// (tab/category/search/sort) stays with the consumer; ListBrowser owns view-mode, card-size,
// panel-mode, scroll-mode and pagination state, and renders the shared category sidebar/top-panel,
// list header, active-filter chips, result grid/list and pagination bar.

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { gsap } from 'gsap'
import {
  ChevronLeft, ChevronRight, ChevronDown, Filter, Search, SlidersHorizontal,
  TrendingUp, Rows3, PanelLeft, X, LayoutGrid, Hash,
} from 'lucide-react'
import { ListHeader } from '@ds/ui'
import type { ListHeaderAction } from '@ds/ui'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { CategorySidebar } from '../../routes/buy/CategorySidebar'
import { CategoryTopPanel } from '../../routes/buy/CategoryTopPanel'
import { GammaTagPanel } from '../../routes/buy/GammaTagPanel'
import { SizeToggle } from '../../routes/buy/marketplace-cards'
import { FilterDrawer, FilterFAB } from './filter-drawer'
import type { CardSize, ListBrowserProps, PanelMode, ScrollMode, ListBrowserViewMode, TaxonomyAxis } from './list-browser.types'

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100, 200, 500]

// ADR-277 D7: the gamma tag top-panel/mobile strip gets its own bounded,
// independently scrollable chip area (owned by GammaTagPanel itself) rather
// than growing unboundedly — capped at ~3 compact chip rows so it can never
// dominate the viewport. The sidebar instead uses GammaTagPanel's `fill`
// mode (see below) to use exactly the height the desktop sidebar has left.
const GAMMA_TAG_STRIP_MAX_HEIGHT = 104

// Mobile bottom-nav (MainMenu) reserves this many pixels from the bottom of
// the viewport — matches CartFAB / CoopFAB / FeedbackWidget / SnackbarManager
// so the sticky pagination footer always sits directly above the nav bar
// instead of overlapping it. Safe-area-inset-bottom accounts for iOS home
// indicator + Android gesture bars.
const MOBILE_BOTTOM_NAV_OFFSET = 'calc(58px + env(safe-area-inset-bottom, 0px))'

// Sticky-footer reserved space at the bottom of the items list — the LAST item
// needs at least this much scroll room to clear the pinned footer when
// scrolled to the page end (otherwise the last 1-2 rows sit permanently
// underneath the floating footer). Mobile keeps it tight (≈ footer height —
// the nav offset is handled by the footer's own `bottom` style, no need to
// bake it into items padding), desktop matches the floating-card height.
const STICKY_FOOTER_MOBILE_PADDING = '52px'   // mobile reduced footer (py-2 + ~26px chip/button)
const STICKY_FOOTER_DESKTOP_PADDING = '64px' // desktop floating card (py-2 + flex content)

// Floating-card shadow stack (Material 3 elevation 3 equivalent — three
// layers blur from soft ambient to tight contact shadow so the footer reads
// as physically lifted off the page rather than just bordered). Desktop-only;
// mobile drops the background entirely and just floats the button + counter
// over the content, so no shadow is needed.
const FOOTER_SHADOW_DESKTOP = '0 12px 32px -8px rgba(0,0,0,0.20), 0 4px 12px -2px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.06)'

// Glass-effect constants for desktop — semi-transparent surface color-mix
// (theme-aware: adapts to light/dark), 18px blur + 180% saturation for the
// frosted-glass look, with the matching -webkit- prefix for older Safari.
// Pattern lifted from AIAssistantPage.tsx's MUI Drawer header.
const FOOTER_GLASS_BG_DESKTOP = 'color-mix(in srgb, var(--theme-surface) 78%, transparent)'
const FOOTER_GLASS_BLUR = 'blur(18px) saturate(180%)'

const STANDARD_AXIS_TOOLTIP = 'Standard: browse by the curated product category tree'
const GAMMA_AXIS_TOOLTIP = 'Gamma: browse by free-form marketplace tags (NIP-99), shared with other Nostr marketplaces'

// Deliberately global (NOT namespaced by storageKeyPrefix): the sidebar/top
// panel arrangement is a user-level layout preference that should stay the
// same across all ListBrowser surfaces (Buy, Coop Explore, future consumers).
const PANEL_MODE_KEY = 'listBrowser_panelMode'

export function ListBrowser<T>({
  items,
  loading,
  categoryCountItems,
  filterTabs,
  activeFilterTab,
  onFilterTabChange,
  categories,
  selectedCategory,
  onSelectCategory,
  taxonomy,
  onTaxonomyChange,
  gammaTagFacets,
  selectedGammaTags,
  onSelectGammaTags,
  searchQuery,
  onSearchQueryChange,
  sortBy,
  onSortChange,
  sortOptions,
  resetDeps = [],
  hideEmptyCategories = false,
  showOfferCounts = true,
  defaultScrollMode = 'paginated',
  defaultPanelMode = 'sidebar',
  sectionOf,
  sectionLabels,
  categoryOpen,
  onCategoryOpenChange,
  sidebarExtraTop,
  sidebarExtraBottom,
  hideBuiltinTaxonomyPanel = false,
  headerPrefix,
  headerActions = [],
  headerLeadingActions = [],
  activeFilterChips = [],
  renderCard,
  cardKey,
  emptyState,
  listItemClassName = 'list-item-animate',
  filterFab = false,
  filterFabAlwaysVisible = false,
  storageKeyPrefix,
  forcedViewMode,
  controlledViewMode,
  onControlledViewModeChange,
  onLoadMore,
  hasMore,
}: ListBrowserProps<T>) {
  // ADR-335 D4: server-driven mode — `items` IS the already-fetched batch set,
  // there's nothing to "reveal" client-side beyond what's already there.
  const serverDriven = onLoadMore !== undefined
  const { isMobile, isDesktop } = useBreakpoint()

  const [viewModeState, setViewModeState] = useState<ListBrowserViewMode>(() => {
    const saved = localStorage.getItem(`${storageKeyPrefix}_viewMode`)
    return (saved === 'list' || saved === 'gallery') ? saved : 'gallery'
  })
  // ADR-368 follow-up: page-level (controlled) mode wins when the consumer
  // shares one Grid/List preference across a shell page's subtabs; forced mode
  // (no toggle at all) still wins over both.
  const viewMode = forcedViewMode ?? (controlledViewMode ?? viewModeState)

  const [cardSize, setCardSize] = useState<CardSize>(() => {
    const saved = localStorage.getItem(`${storageKeyPrefix}_cardSize`)
    return (saved === 'S' || saved === 'M' || saved === 'L') ? saved : 'M'
  })
  const [panelMode, setPanelMode] = useState<PanelMode>(() => {
    // ADR-339 D6: a per-consumer default backs the global (NOT namespaced)
    // preference — sell pages pass 'top', everyone else keeps 'sidebar'.
    const saved = localStorage.getItem(PANEL_MODE_KEY)
    if (saved === 'top' || saved === 'sidebar') return saved
    return defaultPanelMode
  })

  // ADR-277 D1/D7: the switch only exists when the consumer wires all five
  // gamma-axis props together — omitting them keeps a consumer single-axis.
  const axisWired = taxonomy !== undefined && onTaxonomyChange !== undefined
    && gammaTagFacets !== undefined && selectedGammaTags !== undefined && onSelectGammaTags !== undefined
  // D7 visibility rule: an axis with nothing in it is a dead end, not a feature.
  const gammaAxisAvailable = axisWired && gammaTagFacets!.length > 0
  const effectiveTaxonomy: TaxonomyAxis = gammaAxisAvailable ? taxonomy! : 'standard'

  // D5: hydrate the consumer's (controlled) taxonomy state from the persisted
  // choice on mount — mirrors the isMobile -> onCategoryOpenChange(true) hydration below.
  useEffect(() => {
    if (!axisWired) return
    const saved = localStorage.getItem(`${storageKeyPrefix}_taxonomy`)
    if (saved === 'gamma' && taxonomy !== 'gamma') onTaxonomyChange!('gamma')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleTaxonomyChange(next: TaxonomyAxis) {
    localStorage.setItem(`${storageKeyPrefix}_taxonomy`, next)
    onTaxonomyChange?.(next)
  }
  const [pageSize, setPageSize] = useState(() => {
    // Validate against PAGE_SIZE_OPTIONS: a stale value (e.g. "28" left over
    // from a prior option set) would otherwise pass through Number(...) and be
    // used as-is — the <select> wouldn't render a matching <option>, so the
    // visible dropdown wouldn't match the state, and unlimited-scroll would
    // top out at that orphan pageSize forever (regression surfaced 2026-08-24
    // on /search after the ADR-333 option set change).
    const stored = localStorage.getItem(`${storageKeyPrefix}_pageSize`)
    const parsed = stored ? Number(stored) : NaN
    return PAGE_SIZE_OPTIONS.includes(parsed) ? parsed : 10
  })
  const [scrollMode, setScrollMode] = useState<ScrollMode>(() => {
    const saved = localStorage.getItem(`${storageKeyPrefix}_scrollMode`)
    if (saved === 'unlimited' || saved === 'paginated') return saved
    return defaultScrollMode
  })
  const [page, setPage] = useState(1)
  const [visibleCount, setVisibleCount] = useState(() => {
    // Same PAGE_SIZE_OPTIONS validation as pageSize above — the orphan-value
    // regression also broke this: an invalid stored pageSize would seed
    // visibleCount too, so unlimited-scroll topped out at the orphan value
    // forever (this is the field that actually pins the rendered cap).
    const stored = localStorage.getItem(`${storageKeyPrefix}_pageSize`)
    const parsed = stored ? Number(stored) : NaN
    return PAGE_SIZE_OPTIONS.includes(parsed) ? parsed : 10
  })
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)
  const [filterFabVisible, setFilterFabVisible] = useState(false)
  const filterMenuRef = useRef<HTMLDivElement>(null)
  const headerSentinelRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const effectivePanelMode: PanelMode = isMobile ? 'top' : panelMode

  useEffect(() => {
    if (isMobile) onCategoryOpenChange(true)
  }, [isMobile]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showFilterMenu) return
    const fn = (e: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setShowFilterMenu(false)
      }
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [showFilterMenu])

  // ── Filter FAB visibility ─────────────────────────────────────────────
  // Mobile/tablet: appears once the header sentinel scrolls away. Desktop:
  // the FAB is visible from first paint (no scroll reveal) since there is no
  // header the user can keep in view while browsing the list.
  useEffect(() => {
    if (!filterFab || filterFabAlwaysVisible) return
    const sentinel = headerSentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      ([entry]) => setFilterFabVisible(!entry.isIntersecting),
      { rootMargin: '-80px 0px 0px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [filterFab, filterFabAlwaysVisible])

  // ── GSAP stagger ──────────────────────────────────────────────────────
  useEffect(() => {
    if (loading || !listRef.current) return
    const ctx = gsap.from(`.${listItemClassName}`, {
      y: 20, opacity: 0, duration: 0.4, stagger: 0.06, ease: 'power2.out', clearProps: 'all',
    })
    return () => { ctx.revert() }
  }, [loading, activeFilterTab, viewMode, page, listItemClassName])

  // ── Unlimited scroll (IntersectionObserver + explicit Load-more button) ─
  // The button calls the same bumpVisibleCount() as the observer so both
  // paths converge on the same items.length cap. The button fires instantly
  // (no debounce) — the observer's 150ms is purely a UX cushion for scroll.
  // Whether there's anything left to reveal/fetch. Server-driven mode defers
  // entirely to the `hasMore` prop (items.length already tracks visibleCount
  // 1:1 there, see the sync effect below); client-side mode keeps comparing
  // against the not-yet-revealed tail of `items`.
  const canLoadMore = serverDriven ? (hasMore ?? false) : visibleCount < items.length

  function bumpVisibleCount() {
    setVisibleCount(prev => Math.min(prev + pageSize, items.length))
  }
  async function handleLoadMore() {
    if (scrollMode !== 'unlimited' || isLoadingMore || !canLoadMore) return
    setIsLoadingMore(true)
    if (serverDriven) {
      // `items`/`visibleCount` sync via the effect below once the parent's
      // fetchNextPage() resolves and the grown `items` prop re-renders —
      // no manual visibleCount math needed here (D4).
      await onLoadMore!()
      setIsLoadingMore(false)
      return
    }
    // setTimeout(0) so the spinner state paints before the list expands.
    setTimeout(() => { bumpVisibleCount(); setIsLoadingMore(false) }, 0)
  }

  // ADR-335 D4: server-driven mode renders every fetched item — visibleCount
  // tracks items.length (the server batch size governs what becomes visible
  // per load), not the client-side pageSize. Runs on mount and whenever a new
  // batch grows `items`, so newly-fetched rows never sit fetched-but-hidden.
  useEffect(() => {
    if (serverDriven) setVisibleCount(items.length)
  }, [serverDriven, items.length])

  useEffect(() => {
    if (scrollMode !== 'unlimited') return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry.isIntersecting && !isLoadingMore && canLoadMore) {
          setIsLoadingMore(true)
          if (serverDriven) {
            void Promise.resolve(onLoadMore!()).finally(() => setIsLoadingMore(false))
          } else {
            setTimeout(() => {
              bumpVisibleCount()
              setIsLoadingMore(false)
            }, 150)
          }
        }
      },
      { rootMargin: '200px' },
    )
    const target = loadMoreRef.current
    if (target) observer.observe(target)
    return () => { if (target) observer.unobserve(target) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollMode, isLoadingMore, canLoadMore, serverDriven, pageSize, items.length])

  useEffect(() => {
    if (serverDriven) return // D4: visibleCount is synced to items.length instead, see above
    if (scrollMode === 'unlimited') setVisibleCount(pageSize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilterTab, searchQuery, sortBy, selectedCategory, effectiveTaxonomy, selectedGammaTags, pageSize, scrollMode, serverDriven, ...resetDeps])

  useEffect(() => {
    setPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilterTab, searchQuery, sortBy, selectedCategory, effectiveTaxonomy, selectedGammaTags, pageSize, ...resetDeps])

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const paginatedItems = useMemo(
    () => scrollMode === 'unlimited'
      ? items.slice(0, visibleCount)
      : items.slice((page - 1) * pageSize, page * pageSize),
    [items, scrollMode, visibleCount, page, pageSize],
  )

  const categoryNameMap = useMemo(() => {
    const map = new Map<string, string>()
    categories.forEach(c => map.set(c.slug, c.name))
    return map
  }, [categories])

  const galleryCols = cardSize === 'S' ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
    : cardSize === 'L' ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
    : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4'

  // ADR-339 D5: optional section headers in LIST view. The consumer orders
  // `items` so sections are contiguous; the primitive only renders a header
  // row whenever the section key changes between consecutive rendered items
  // (purely presentational — grouping logic stays with the consumer). Gallery
  // view stays flat.
  function renderSectionHeader(section: string): ReactNode {
    return (
      <div className="flex items-center gap-2 pt-2 first:pt-0">
        <span
          className="text-[10px] font-bold uppercase tracking-widest whitespace-nowrap"
          style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
        >
          {sectionLabels?.[section] ?? section}
        </span>
        <div className="flex-1 h-px" style={{ background: 'var(--theme-border)' }} />
      </div>
    )
  }

  const listNodes: ReactNode[] = []
  if (!loading) {
    let lastSection: string | undefined
    for (const item of paginatedItems) {
      const section = sectionOf?.(item)
      if (section !== lastSection) {
        lastSection = section
        if (section !== undefined) listNodes.push(
          <Fragment key={`section-${section}`}>{renderSectionHeader(section)}</Fragment>,
        )
      }
      listNodes.push(
        <div key={cardKey(item)} className={listItemClassName}>
          {renderCard(item, cardSize, viewMode)}
        </div>,
      )
    }
  }

  function handleViewModeChange(mode: ListBrowserViewMode) {
    // ADR-368 follow-up: in controlled (page-level) mode the consumer owns
    // the Grid/List preference — ListBrowser neither stores it nor touches
    // its own per-tab `${prefix}_viewMode` key.
    if (onControlledViewModeChange) {
      onControlledViewModeChange(mode)
      return
    }
    setViewModeState(mode)
    localStorage.setItem(`${storageKeyPrefix}_viewMode`, mode)
  }

  function handleCardSizeChange(size: CardSize) {
    setCardSize(size)
    localStorage.setItem(`${storageKeyPrefix}_cardSize`, size)
  }

  function handlePanelToggle() {
    const next: PanelMode = panelMode === 'sidebar' ? 'top' : 'sidebar'
    setPanelMode(next)
    localStorage.setItem(PANEL_MODE_KEY, next)
    onCategoryOpenChange(true)
  }

  function handleScrollModeToggle() {
    const next: ScrollMode = scrollMode === 'paginated' ? 'unlimited' : 'paginated'
    setScrollMode(next)
    localStorage.setItem(`${storageKeyPrefix}_scrollMode`, next)
    if (next === 'unlimited') setVisibleCount(pageSize)
    else setPage(1)
  }

  function handleTabChange(key: string) {
    onFilterTabChange(key)
    onSelectCategory('')
  }

  const countItems = (categoryCountItems ?? items) as Array<{ categoryCode?: string | null }>

  // Badge on the filter FAB: filters currently narrowing the list (first tab = default).
  // D7: the active-filter count reflects the active axis only.
  const activeFilterCount =
    (effectiveTaxonomy === 'gamma' ? (selectedGammaTags?.length ?? 0) : (selectedCategory ? 1 : 0)) +
    (searchQuery ? 1 : 0) +
    (filterTabs.length > 0 && activeFilterTab !== filterTabs[0].key ? 1 : 0)

  const filterMenuAction: ListHeaderAction = {
    key: 'filter-menu',
    element: (
      <div ref={filterMenuRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setShowFilterMenu(v => !v)}
          className="flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150"
          style={{
            width: 36, height: 36,
            background: showFilterMenu ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
            color: showFilterMenu ? 'white' : 'var(--theme-text-muted)',
            border: showFilterMenu ? 'none' : '1px solid var(--theme-border)',
          }}
          aria-label="View options"
        >
          <SlidersHorizontal size={16} />
        </button>
        {showFilterMenu && (
          <div
            className="flex flex-col gap-1 p-2 rounded-xl"
            style={{
              position: 'absolute', top: 'calc(100% + 8px)', right: 0,
              minWidth: 180, zIndex: 100,
              background: 'var(--theme-surface)',
              border: '1px solid var(--theme-border)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            }}
          >
            {isMobile && (
              <>
                <div className="flex flex-col gap-1 px-1 py-0.5">
                  <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                    View
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleViewModeChange('gallery')}
                      className="flex items-center justify-center gap-1.5 flex-1 text-[11px] px-2 py-1.5 rounded-md cursor-pointer transition-all duration-150"
                      style={{
                        background: viewMode === 'gallery' ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
                        color: viewMode === 'gallery' ? 'white' : 'var(--theme-text)',
                        border: viewMode === 'gallery' ? 'none' : '1px solid var(--theme-border)',
                        fontWeight: 600,
                      }}
                    >
                      <LayoutGrid size={12} />
                      Grid
                    </button>
                    <button
                      onClick={() => handleViewModeChange('list')}
                      className="flex items-center justify-center gap-1.5 flex-1 text-[11px] px-2 py-1.5 rounded-md cursor-pointer transition-all duration-150"
                      style={{
                        background: viewMode === 'list' ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
                        color: viewMode === 'list' ? 'white' : 'var(--theme-text)',
                        border: viewMode === 'list' ? 'none' : '1px solid var(--theme-border)',
                        fontWeight: 600,
                      }}
                    >
                      <Rows3 size={12} />
                      List
                    </button>
                  </div>
                </div>
                {gammaAxisAvailable && (
                  <>
                    <div style={{ height: 1, background: 'var(--theme-border)', margin: '2px 0' }} />
                    <div className="flex flex-col gap-1 px-1 py-0.5">
                      <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                        Category type
                      </span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleTaxonomyChange('standard')}
                          className="flex items-center justify-center gap-1.5 flex-1 text-[11px] px-2 py-1.5 rounded-md cursor-pointer transition-all duration-150"
                          style={{
                            background: effectiveTaxonomy === 'standard' ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
                            color: effectiveTaxonomy === 'standard' ? 'white' : 'var(--theme-text)',
                            border: effectiveTaxonomy === 'standard' ? 'none' : '1px solid var(--theme-border)',
                            fontWeight: 600,
                          }}
                          title={STANDARD_AXIS_TOOLTIP}
                        >
                          <LayoutGrid size={12} />
                          Standard
                        </button>
                        <button
                          onClick={() => handleTaxonomyChange('gamma')}
                          className="flex items-center justify-center gap-1.5 flex-1 text-[11px] px-2 py-1.5 rounded-md cursor-pointer transition-all duration-150"
                          style={{
                            background: effectiveTaxonomy === 'gamma' ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
                            color: effectiveTaxonomy === 'gamma' ? 'white' : 'var(--theme-text)',
                            border: effectiveTaxonomy === 'gamma' ? 'none' : '1px solid var(--theme-border)',
                            fontWeight: 600,
                          }}
                          title={GAMMA_AXIS_TOOLTIP}
                        >
                          <Hash size={12} />
                          Gamma
                        </button>
                      </div>
                    </div>
                  </>
                )}
                {headerLeadingActions.length > 0 && (
                  <>
                    <div style={{ height: 1, background: 'var(--theme-border)', margin: '2px 0' }} />
                    <div className="flex flex-col gap-1 px-1 py-0.5">
                      <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                        Favorites
                      </span>
                      <div className="flex items-center">
                        {headerLeadingActions.map((el, i) => (
                          <div key={`fav-leading-${i}`}>{el}</div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                <div style={{ height: 1, background: 'var(--theme-border)', margin: '2px 0' }} />
              </>
            )}
            {sortOptions && sortOptions.length > 0 && onSortChange && (
              <>
                <div className="flex flex-col gap-1 px-1 py-0.5">
                  <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                    Sort by
                  </span>
                  <select
                    value={sortBy}
                    onChange={e => { onSortChange(e.target.value); setShowFilterMenu(false) }}
                    className="rounded-lg outline-none cursor-pointer"
                    style={{
                      fontSize: 12, height: 36, padding: '0 10px',
                      background: 'var(--theme-bg-subtle)', color: 'var(--theme-text)',
                      border: '1px solid var(--theme-border)', width: '100%',
                    }}
                  >
                    {sortOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>
                <div style={{ height: 1, background: 'var(--theme-border)', margin: '2px 0' }} />
              </>
            )}
            <div className="flex flex-col gap-1 px-1 py-0.5">
              <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                Card size
              </span>
              <SizeToggle value={cardSize} onChange={(s) => { handleCardSizeChange(s); setShowFilterMenu(false) }} />
            </div>
            <div style={{ height: 1, background: 'var(--theme-border)', margin: '2px 0' }} />
            <div className="flex flex-col gap-1 px-1 py-0.5">
              <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}>
                Scroll mode
              </span>
              <button
                onClick={() => { handleScrollModeToggle(); setShowFilterMenu(false) }}
                className="flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded-md cursor-pointer transition-all duration-150"
                style={{
                  background: scrollMode === 'unlimited' ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
                  color: scrollMode === 'unlimited' ? 'white' : 'var(--theme-text)',
                  border: scrollMode === 'unlimited' ? 'none' : '1px solid var(--theme-border)',
                  fontWeight: 600,
                }}
              >
                <TrendingUp size={11} />
                {scrollMode === 'unlimited' ? 'Unlimited' : 'Paginated'}
              </button>
            </div>
            {!isMobile && (
              <>
                <div style={{ height: 1, background: 'var(--theme-border)', margin: '2px 0' }} />
                <button
                  onClick={() => { handlePanelToggle(); setShowFilterMenu(false) }}
                  className="flex items-center gap-1.5 text-[11px] px-2 py-1.5 rounded-md cursor-pointer transition-all duration-150"
                  style={{
                    background: panelMode === 'top' ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
                    color: panelMode === 'top' ? 'white' : 'var(--theme-text)',
                    border: panelMode === 'top' ? 'none' : '1px solid var(--theme-border)',
                    fontWeight: 600,
                  }}
                >
                  {panelMode === 'sidebar' ? <Rows3 size={11} /> : <PanelLeft size={11} />}
                  {panelMode === 'sidebar' ? 'Categories on top' : 'Categories on left'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    ),
  }

  // ADR-277 D2: desktop segmented control ("Standard | Gamma"), hidden on
  // mobile in favor of the "Category type" section inside filterMenuAction above.
  const taxonomySwitchAction: ListHeaderAction | null = (!isMobile && gammaAxisAvailable) ? {
    key: 'taxonomy-switch',
    element: (
      <div
        className="flex items-center rounded-lg p-0.5"
        style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}
      >
        <button
          onClick={() => handleTaxonomyChange('standard')}
          className="flex items-center gap-1 text-[11px] px-2 py-1.5 rounded-md cursor-pointer transition-all duration-150"
          style={{
            background: effectiveTaxonomy === 'standard' ? 'var(--color-primary-50)' : 'transparent',
            color: effectiveTaxonomy === 'standard' ? 'white' : 'var(--theme-text-muted)',
            fontWeight: 600,
          }}
          aria-pressed={effectiveTaxonomy === 'standard'}
          title={STANDARD_AXIS_TOOLTIP}
        >
          <LayoutGrid size={13} />
          Standard
        </button>
        <button
          onClick={() => handleTaxonomyChange('gamma')}
          className="flex items-center gap-1 text-[11px] px-2 py-1.5 rounded-md cursor-pointer transition-all duration-150"
          style={{
            background: effectiveTaxonomy === 'gamma' ? 'var(--color-primary-50)' : 'transparent',
            color: effectiveTaxonomy === 'gamma' ? 'white' : 'var(--theme-text-muted)',
            fontWeight: 600,
          }}
          aria-pressed={effectiveTaxonomy === 'gamma'}
          title={GAMMA_AXIS_TOOLTIP}
        >
          <Hash size={13} />
          Gamma
        </button>
      </div>
    ),
  } : null

  const actions: ListHeaderAction[] = [
    ...(taxonomySwitchAction ? [taxonomySwitchAction] : []),
    ...(isMobile ? [] : headerLeadingActions.map((el, i) => ({ key: `leading-${i}`, element: el }))),
    ...headerActions.map((el, i) => ({ key: `action-${i}`, element: el })),
    filterMenuAction,
  ]

  return (
    // ADR-339 D8: categories panel → ListHeader adjacency tightened from
    // gap-3 to gap-1 (4px) — the same minimal list anatomy everywhere.
    <div className="flex flex-col gap-1">
      {filterFab && <div ref={headerSentinelRef} aria-hidden style={{ height: 1, marginBottom: -13 }} />}
      {effectivePanelMode === 'top' && categoryOpen && (
        effectiveTaxonomy === 'gamma' ? (
          <div className="p-3 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
            <GammaTagPanel
              facets={gammaTagFacets!}
              selectedTags={selectedGammaTags!}
              onSelectTags={onSelectGammaTags!}
              showOfferCounts={showOfferCounts}
              chipsMaxHeight={GAMMA_TAG_STRIP_MAX_HEIGHT}
            />
          </div>
        ) : (
          <CategoryTopPanel
            categories={categories}
            selectedCategory={selectedCategory}
            onSelectCategory={onSelectCategory}
            filterTab={activeFilterTab}
            offers={countItems}
            hideEmptyCategories={hideEmptyCategories}
            showOfferCounts={showOfferCounts}
            isMobile={isMobile}
          />
        )
      )}

      <div className="flex" style={{ gap: effectivePanelMode === 'sidebar' && categoryOpen ? 16 : 0, transition: 'gap 0.3s ease' }}>
        {effectivePanelMode === 'sidebar' && (
          <div
            className="sticky self-start overflow-hidden transition-all duration-300 shrink-0 top-25"
            style={{ width: categoryOpen ? 215 : 0, opacity: categoryOpen ? 1 : 0 }}
          >
            {/* data-lenis-prevent: Lenis (app-wide smoothWheel) hijacks every
                wheel event and scrolls only the window — without this flag the
                sidebar's own scroll areas (category panels, gamma chips,
                country list) can never be mouse-scrolled. With it, native
                scroll chaining applies inside the sidebar. */}
            <div
              className="flex flex-col p-3 overflow-y-auto rounded-xl"
              data-lenis-prevent=""
              style={{
                background: 'var(--theme-surface)',
                border: '1px solid var(--theme-border)',
                // Fully visible while pinned: sticky top is 100px (top-25), so
                // the card gets viewport − 100px header zone − 28px safety.
                // The tag/category flex-fill below then equals viewport minus
                // the sidebar extras (saved filters + capped country list) —
                // never the item list's height (unlimited scroll, ADR-277 D7).
                height: 'calc(100vh - 128px)',
              }}
            >
              {sidebarExtraTop}
              {/* Real flex-fill region (not just max-height) so the category/tag
                  list uses exactly the space left over after extraTop/extraBottom
                  — CategorySidebar's own `h-full` internals and GammaTagPanel's
                  `fill` mode both need a genuine (not just capped) ancestor height
                  to become independently, reliably scrollable (ADR-277 D7).
                  ADR-333 D4: hideBuiltinTaxonomyPanel lets the consumer render
                  the taxonomy panel itself inside sidebarExtraTop instead. */}
              {!hideBuiltinTaxonomyPanel && (
                <div className="flex-1 min-h-0 flex flex-col">
                  {effectiveTaxonomy === 'gamma' ? (
                    <GammaTagPanel
                      facets={gammaTagFacets!}
                      selectedTags={selectedGammaTags!}
                      onSelectTags={onSelectGammaTags!}
                      showOfferCounts={showOfferCounts}
                      showSearch
                      fill
                    />
                  ) : (
                    <CategorySidebar
                      categories={categories}
                      selectedCategory={selectedCategory}
                      onSelectCategory={onSelectCategory}
                      filterTab={activeFilterTab}
                      offers={countItems}
                      hideEmptyCategories={hideEmptyCategories}
                      showOfferCounts={showOfferCounts}
                    />
                  )}
                </div>
              )}
              {sidebarExtraBottom}
            </div>
          </div>
        )}

        <div className="flex flex-col flex-1 min-w-0">
          {/* Sub tabs + ListHeader share one line on desktop (md:flex-row,
              >=600px) and stack on mobile — the page-level pill (e.g.
              SellListings' SubTabPill) rides the headerPrefix slot. */}
          {headerPrefix ? (
            <div className="flex flex-col md:flex-row md:items-center gap-2">
              <div className="shrink-0">{headerPrefix}</div>
              <div className="flex-1 min-w-0">
                <ListHeader
                  tabs={filterTabs}
                  activeTab={activeFilterTab}
                  onTabChange={handleTabChange}
                  actions={actions}
                  viewMode={isMobile || forcedViewMode ? undefined : viewMode}
                  onViewModeChange={isMobile || forcedViewMode ? undefined : handleViewModeChange}
                  mt={0}
                />
              </div>
            </div>
          ) : (
            <ListHeader
              tabs={filterTabs}
              activeTab={activeFilterTab}
              onTabChange={handleTabChange}
              actions={actions}
              viewMode={isMobile || forcedViewMode ? undefined : viewMode}
              onViewModeChange={isMobile || forcedViewMode ? undefined : handleViewModeChange}
              mt={0}
            />
          )}

          {(searchQuery || (effectiveTaxonomy === 'gamma' ? (selectedGammaTags?.length ?? 0) > 0 : selectedCategory) || activeFilterChips.length > 0) && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {searchQuery && (
                <div
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg"
                  style={{ background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.20)' }}
                >
                  <Search size={11} style={{ color: 'var(--color-primary-50)' }} />
                  <span className="text-[11px]" style={{ color: 'var(--color-primary-50)' }}>
                    "{searchQuery}"
                  </span>
                  <button
                    onClick={() => onSearchQueryChange('')}
                    className="cursor-pointer"
                    style={{ background: 'none', border: 'none', padding: 1 }}
                    aria-label="Clear search"
                  >
                    <X size={11} style={{ color: 'var(--color-primary-50)' }} />
                  </button>
                </div>
              )}
              {effectiveTaxonomy === 'gamma' ? (
                (selectedGammaTags ?? []).map(tag => (
                  <div
                    key={tag}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg"
                    style={{ background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.20)' }}
                  >
                    <Hash size={11} style={{ color: 'var(--color-primary-50)' }} />
                    <span className="text-[11px]" style={{ color: 'var(--color-primary-50)' }}>{tag}</span>
                    <button
                      onClick={() => onSelectGammaTags!((selectedGammaTags ?? []).filter(t => t !== tag))}
                      className="cursor-pointer"
                      style={{ background: 'none', border: 'none', padding: 1 }}
                      aria-label={`Clear tag ${tag}`}
                    >
                      <X size={11} style={{ color: 'var(--color-primary-50)' }} />
                    </button>
                  </div>
                ))
              ) : (
                selectedCategory && (
                  <div
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg"
                    style={{ background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.20)' }}
                  >
                    <Filter size={11} style={{ color: 'var(--color-primary-50)' }} />
                    <span className="text-[11px]" style={{ color: 'var(--color-primary-50)' }}>
                      {categoryNameMap.get(selectedCategory) || selectedCategory}
                    </span>
                    <button
                      onClick={() => onSelectCategory('')}
                      className="cursor-pointer"
                      style={{ background: 'none', border: 'none', padding: 1 }}
                      aria-label="Clear category"
                    >
                      <X size={11} style={{ color: 'var(--color-primary-50)' }} />
                    </button>
                  </div>
                )
              )}
              {activeFilterChips.map(chip => (
                <div
                  key={chip.id}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg"
                  style={{ background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.20)' }}
                >
                  {chip.icon}
                  <span className="text-[11px]" style={{ color: 'var(--color-primary-50)' }}>{chip.label}</span>
                  <button
                    onClick={chip.onRemove}
                    className="cursor-pointer"
                    style={{ background: 'none', border: 'none', padding: 1 }}
                    aria-label={`Clear ${chip.label}`}
                  >
                    <X size={11} style={{ color: 'var(--color-primary-50)' }} />
                  </button>
                </div>
              ))}
              <span className="text-[11px] ml-1" style={{ color: 'var(--theme-text-muted)' }}>
                {items.length} result{items.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}

          <div className="mt-3 flex flex-col gap-2">
            <div>
              {loading ? (
                viewMode === 'gallery' ? (
                  <div className={`grid gap-2 ${galleryCols}`}>
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div
                        key={i}
                        className="rounded-xl animate-pulse"
                        style={{
                          height: cardSize === 'S' ? 140 : cardSize === 'L' ? 250 : 190,
                          background: 'var(--theme-surface-secondary)',
                          border: '1px solid var(--theme-border)',
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {Array.from({ length: isMobile ? 4 : 6 }).map((_, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 rounded-xl p-3 animate-pulse"
                        style={{
                          height: cardSize === 'S' ? 44 : cardSize === 'L' ? 76 : 64,
                          background: 'var(--theme-surface)',
                          border: '1px solid var(--theme-border)',
                        }}
                      >
                        {/* icon placeholder */}
                        <div
                          className="shrink-0 rounded-lg"
                          style={{
                            width: cardSize === 'S' ? 28 : 40,
                            height: cardSize === 'S' ? 28 : 40,
                            background: 'var(--theme-bg-subtle)',
                          }}
                        />
                        {/* text column */}
                        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                          <div
                            className="rounded"
                            style={{
                              width: [140, 180, 120, 200, 160, 140][i],
                              height: 12,
                              background: 'var(--theme-bg-subtle)',
                            }}
                          />
                          <div
                            className="rounded"
                            style={{
                              width: [100, 130, 80, 140, 110, 90][i],
                              height: 10,
                              background: 'var(--theme-bg-subtle)',
                            }}
                          />
                        </div>
                        {/* meta column (desktop) */}
                        {!isMobile && (
                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            <div
                              className="rounded"
                              style={{ width: 48, height: 11, background: 'var(--theme-bg-subtle)' }}
                            />
                            <div
                              className="rounded"
                              style={{ width: 36, height: 9, background: 'var(--theme-bg-subtle)' }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              ) : items.length === 0 ? (
                emptyState
              ) : viewMode === 'gallery' ? (
                <div
                  ref={listRef}
                  className={`grid gap-2 ${galleryCols}`}
                  style={{
                    perspective: 800,
                    overflow: 'visible',
                    // Reserve room below the list so the last row can scroll
                    // fully above the FLOATING footer — only needed while the
                    // footer actually overlays content (unlimited scroll). In
                    // paginated mode the footer is inline (CoopOffers parity),
                    // so the list→footer distance stays natural.
                    paddingBottom: scrollMode === 'unlimited'
                      ? (isMobile ? STICKY_FOOTER_MOBILE_PADDING : STICKY_FOOTER_DESKTOP_PADDING)
                      : undefined,
                  }}
                >
                  {paginatedItems.map(item => (
                    <div key={cardKey(item)} className={listItemClassName}>
                      {renderCard(item, cardSize, viewMode)}
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  ref={listRef}
                  className="flex flex-col gap-1.5"
                  style={{
                    paddingBottom: scrollMode === 'unlimited'
                      ? (isMobile ? STICKY_FOOTER_MOBILE_PADDING : STICKY_FOOTER_DESKTOP_PADDING)
                      : undefined,
                  }}
                >
                  {listNodes}
                </div>
              )}
            </div>

            {scrollMode === 'unlimited' && !loading && canLoadMore && (
              <div ref={loadMoreRef} className="flex items-center justify-center py-2">
                {isLoadingMore && (
                  <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>Loading more…</span>
                )}
              </div>
            )}

            {!loading && items.length > 0 && (
              // Pagination footer — CoopOffers-parity behavior (user
              // feedback 2026-08-24): inline in the document flow while
              // paginated (natural list→footer distance, no clearance
              // padding, no overlay), floating-sticky ONLY in unlimited
              // mode. The floating variant stays because of the /search
              // regression (2026-08-24): at document end the
              // IntersectionObserver auto-fired and loaded the next batch
              // before the user could reach the controls. Mobile keeps its
              // reduced variant — the "Show X per page" select + scrollMode
              // toggle are desktop-only controls, an explicit "Load more"
              // button replaces the auto-trigger, and the floating chips
              // center instead of stretching a card.
              <div
                className="shrink-0 flex items-center gap-2 px-3 py-2"
                style={{
                  position: scrollMode === 'unlimited' ? 'sticky' : 'static',
                  // Floating-card offset from screen edges (mobile drops the
                  // card entirely — just the button + counter float over
                  // the content; desktop keeps the elevated glass sheet).
                  ...(scrollMode === 'unlimited' ? {
                    bottom: isMobile ? MOBILE_BOTTOM_NAV_OFFSET : 12,
                    left: isMobile ? 4 : 12,
                    right: isMobile ? 4 : 12,
                    zIndex: 10,
                  } : {}),
                  color: 'var(--theme-text-muted)',
                  // Floating (unlimited + desktop): frosted-glass so rows
                  // scrolling underneath stay readable. Inline (paginated):
                  // plain surface card like CoopOffers' footer.
                  background: scrollMode !== 'unlimited'
                    ? 'var(--theme-surface)'
                    : isMobile ? 'transparent' : FOOTER_GLASS_BG_DESKTOP,
                  backdropFilter: scrollMode === 'unlimited' && !isMobile ? FOOTER_GLASS_BLUR : undefined,
                  WebkitBackdropFilter: scrollMode === 'unlimited' && !isMobile ? FOOTER_GLASS_BLUR : undefined,
                  border: isMobile && scrollMode === 'unlimited' ? 'none' : '1px solid var(--theme-border)',
                  borderRadius: isMobile ? (scrollMode === 'unlimited' ? 0 : 12) : 12,
                  boxShadow: scrollMode === 'unlimited' && !isMobile ? FOOTER_SHADOW_DESKTOP : 'none',
                  // Mobile floating: center the chips+button as a group (no
                  // card to left-align them against). Everything else:
                  // spaces-between for the wider Show-X-per-page / counter /
                  // nav layout.
                  justifyContent: isMobile && scrollMode === 'unlimited' ? 'center' : 'space-between',
                }}
              >
                {isMobile ? (
                  // ── Mobile reduced footer ─────────────────────────────
                  <>
                    <span
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0"
                      style={{
                        background: 'var(--theme-bg-subtle)',
                        color: 'var(--theme-text-muted)',
                        border: '1px solid var(--theme-border)',
                      }}
                    >
                      {scrollMode === 'unlimited'
                        ? `${Math.min(visibleCount, items.length)} of ${items.length}`
                        : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, items.length)} of ${items.length}`
                      }
                    </span>
                    {scrollMode === 'paginated' ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => setPage(p => Math.max(1, p - 1))}
                          disabled={page <= 1}
                          className="flex items-center justify-center rounded-md cursor-pointer disabled:opacity-30 disabled:cursor-default"
                          style={{ width: 32, height: 32, background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
                          aria-label="Previous page"
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <button
                          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                          disabled={page >= totalPages}
                          className="flex items-center justify-center rounded-md cursor-pointer disabled:opacity-30 disabled:cursor-default"
                          style={{ width: 32, height: 32, background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
                          aria-label="Next page"
                        >
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    ) : canLoadMore ? (
                      <button
                        onClick={handleLoadMore}
                        disabled={isLoadingMore}
                        className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full cursor-pointer shrink-0 transition-all duration-150 active:scale-95"
                        style={{
                          background: 'var(--color-primary-50)',
                          color: 'white',
                          fontWeight: 600,
                          border: 'none',
                          opacity: isLoadingMore ? 0.7 : 1,
                        }}
                        aria-label="Load more results"
                      >
                        {isLoadingMore ? 'Loading…' : serverDriven ? 'Show next 100' : 'Load more'}
                        <ChevronDown size={12} />
                      </button>
                    ) : (
                      <span
                        className="text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0"
                        style={{
                          background: 'rgba(var(--color-status-success-rgb, 42 232 102), 0.12)',
                          color: 'var(--color-status-success)',
                          border: '1px solid rgba(var(--color-status-success-rgb, 42 232 102), 0.30)',
                        }}
                      >
                        End
                      </span>
                    )}
                  </>
                ) : (
                  // ── Desktop full footer (unchanged content, just sticks) ──
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px]">Show</span>
                      {scrollMode === 'paginated' ? (
                        <select
                          value={pageSize}
                          onChange={e => {
                            const size = Number(e.target.value)
                            localStorage.setItem(`${storageKeyPrefix}_pageSize`, String(size))
                            setPageSize(size)
                          }}
                          className="text-[11px] rounded-md px-1.5 py-1 cursor-pointer"
                          style={{
                            background: 'var(--theme-bg-subtle)',
                            border: '1px solid var(--theme-border)',
                            color: 'var(--theme-text)',
                          }}
                        >
                          {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      ) : (
                        <span className="text-[11px]" style={{ color: 'var(--color-primary-50)', fontWeight: 600 }}>
                          All ({items.length})
                        </span>
                      )}
                      <span className="text-[11px]">per page</span>
                      <div style={{ width: 1, height: 14, background: 'var(--theme-border)', margin: '0 4px' }} />
                      <button
                        onClick={handleScrollModeToggle}
                        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md cursor-pointer transition-all duration-150"
                        style={{
                          background: scrollMode === 'unlimited' ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
                          color: scrollMode === 'unlimited' ? 'white' : 'var(--theme-text)',
                          border: scrollMode === 'unlimited' ? 'none' : '1px solid var(--theme-border)',
                          fontWeight: 600,
                        }}
                        title={scrollMode === 'unlimited' ? 'Switch to paginated view' : 'Switch to unlimited scroll'}
                      >
                        <TrendingUp size={11} />
                        {scrollMode === 'unlimited' ? 'Unlimited' : 'Infinite'}
                      </button>
                    </div>

                    <span className="text-[11px]">
                      {scrollMode === 'unlimited'
                        ? `${Math.min(visibleCount, items.length)} / ${items.length}`
                        : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, items.length)} of ${items.length}`
                      }
                    </span>

                    {scrollMode === 'paginated' ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setPage(p => Math.max(1, p - 1))}
                          disabled={page <= 1}
                          className="flex items-center justify-center rounded-md cursor-pointer disabled:opacity-30 disabled:cursor-default"
                          style={{ width: 28, height: 28, background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
                          aria-label="Previous page"
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <span className="text-[11px] px-2">Page {page} / {totalPages}</span>
                        <button
                          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                          disabled={page >= totalPages}
                          className="flex items-center justify-center rounded-md cursor-pointer disabled:opacity-30 disabled:cursor-default"
                          style={{ width: 28, height: 28, background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text)' }}
                          aria-label="Next page"
                        >
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    ) : (
                      <span className="text-[11px] px-2">
                        {canLoadMore ? 'Scroll for more…' : 'End of results'}
                      </span>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {filterFab && (
        <>
          <FilterFAB
            visible={(isDesktop || filterFabAlwaysVisible || filterFabVisible) && !filterDrawerOpen}
            activeCount={activeFilterCount}
            onClick={() => setFilterDrawerOpen(true)}
          />
          <FilterDrawer
            open={filterDrawerOpen}
            onClose={() => setFilterDrawerOpen(false)}
            filterTabs={filterTabs}
            activeFilterTab={activeFilterTab}
            onFilterTabChange={handleTabChange}
            sortBy={sortBy}
            onSortChange={onSortChange}
            sortOptions={sortOptions}
            categories={categories}
            selectedCategory={selectedCategory}
            onSelectCategory={onSelectCategory}
            countItems={countItems}
            hideEmptyCategories={hideEmptyCategories}
            showOfferCounts={showOfferCounts}
            resultCount={items.length}
            extraTop={sidebarExtraTop}
            extraBottom={sidebarExtraBottom}
            taxonomy={gammaAxisAvailable ? effectiveTaxonomy : undefined}
            onTaxonomyChange={gammaAxisAvailable ? handleTaxonomyChange : undefined}
            gammaTagFacets={gammaTagFacets}
            selectedGammaTags={selectedGammaTags}
            onSelectGammaTags={onSelectGammaTags}
          />
        </>
      )}
    </div>
  )
}
