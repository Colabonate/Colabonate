// ListBrowser – Types (ADR-218 D1)

import type { ReactNode } from 'react'
import type { StandardCategory } from '../../types/api'

export type ListBrowserViewMode = 'gallery' | 'list'
export type CardSize = 'S' | 'M' | 'L'
export type ScrollMode = 'paginated' | 'unlimited'
export type PanelMode = 'sidebar' | 'top'
/** ADR-277 D1: the two independent category axes — standard is curated/hierarchical, gamma is emergent/flat. */
export type TaxonomyAxis = 'standard' | 'gamma'

/** A frequency-sorted Gamma `t` tag with its result count (ADR-277 D7). */
export interface GammaTagFacet {
  tag: string
  count: number
}

export interface ListBrowserFilterTab {
  key: string
  label: string
}

export interface ListBrowserSortOption {
  value: string
  label: string
}

/**
 * A consumer-owned active filter surfaced as a dismissible chip next to the
 * built-in query/category/gamma chips (under the list header) and by the
 * search input. `onRemove` must clear that filter.
 */
export interface ActiveFilterChip {
  id: string
  label: string
  icon?: ReactNode
  onRemove: () => void
}

export interface ListBrowserProps<T> {
  // ── Data ────────────────────────────────────────────────────────────
  /** Already-merged, already-filtered, already-sorted source list. ListBrowser only paginates it. */
  items: T[]
  loading: boolean
  /**
   * Item set used to compute the sidebar/top-panel category counts. Defaults to `items`.
   * Pass a set that ignores the current category selection (e.g. an unfiltered search result)
   * so sibling category counts don't collapse to 0 once one category is selected.
   */
  categoryCountItems?: Array<{ categoryCode?: string | null }>

  // ── Filtering (consumer-driven; ListBrowser renders controls, consumer owns the logic) ──
  filterTabs: ListBrowserFilterTab[]
  activeFilterTab: string
  onFilterTabChange: (key: string) => void
  categories: StandardCategory[]
  selectedCategory: string
  onSelectCategory: (slug: string) => void

  // ── Gamma taxonomy axis (ADR-277 D1/D7) ────────────────────────────
  // All five are optional and MUST be passed together to enable the
  // standard/gamma switch. Omit entirely to keep a consumer single-axis
  // (fully backward compatible — the switch never renders without them).
  /** Which axis currently drives the category sidebar/top-panel/drawer. */
  taxonomy?: TaxonomyAxis
  onTaxonomyChange?: (axis: TaxonomyAxis) => void
  /**
   * Frequency-sorted gamma tags for the CURRENT filtered-minus-gamma result
   * set (i.e. computed before the gamma selection narrows it further — same
   * "sibling counts don't collapse" concern as categoryCountItems above).
   * The switch is hidden whenever this is empty (ADR-277 D7 visibility rule).
   */
  gammaTagFacets?: GammaTagFacet[]
  /** Multi-select, OR-combined — gamma tags are not mutually exclusive (ADR-277 D7). */
  selectedGammaTags?: string[]
  onSelectGammaTags?: (tags: string[]) => void

  searchQuery: string
  onSearchQueryChange: (q: string) => void
  sortBy?: string
  onSortChange?: (s: string) => void
  sortOptions?: ListBrowserSortOption[]
  /**
   * Extra filter dimensions the consumer owns privately (e.g. Buy's company/seller/country
   * filters) that should also reset pagination to page 1 when they change, without ListBrowser
   * needing to know what they are. Pass a stable-length array of primitive values.
   */
  resetDeps?: unknown[]

  /**
   * Consumer-owned active filters (e.g. country, seller) rendered as dismissible
   * chips in the same row as the built-in query/category/gamma chips under the
   * ListHeader. Without this, a silently-applied filter (like the persisted
   * country scope) has no visible, clearable affordance on the list.
   */
  activeFilterChips?: ActiveFilterChip[]

  // ── Sidebar ─────────────────────────────────────────────────────────
  hideEmptyCategories?: boolean
  showOfferCounts?: boolean
  /** Controlled sidebar/top-panel visibility — lifted up so a parent KPI item can toggle it. */
  categoryOpen: boolean
  onCategoryOpenChange: (open: boolean) => void
  /** Rendered ABOVE the CategorySidebar inside the same sticky panel. */
  sidebarExtraTop?: ReactNode
  /** Rendered BELOW the CategorySidebar inside the same sticky panel. */
  sidebarExtraBottom?: ReactNode
  /**
   * ADR-333 D4: opt-out of the built-in sidebar-mode taxonomy panel
   * (Standard category tree / Gamma tag chips). When true, the consumer
   * renders the Categories panel itself via `sidebarExtraTop` (Search.tsx
   * marketplace context's configurable panel stack). Defaults to false —
   * zero behavior change for every other consumer.
   */
  hideBuiltinTaxonomyPanel?: boolean

  // ── ListHeader action buttons (consumer-driven slots) ───────────────
  /**
   * Node rendered LEFT of the ListHeader in the same row on desktop
   * (>=600px) and ABOVE it on mobile (<600px) — e.g. a page-level
   * SubTabPill threaded down from the page shell through the tab props.
   */
  headerPrefix?: ReactNode
  /**
   * ADR-368 follow-up (2026-09-05): optional page-level view mode shared
   * across every subtab of a shell page (CoopManage / SellListings). When
   * provided together with `onControlledViewModeChange`, ListBrowser neither
   * owns nor persists the mode — the consumer owns it (usually through a
   * single page-wide localStorage key) so a Grid/List choice in one subtab
   * applies to all tab contents. `forcedViewMode` still wins over both.
   */
  controlledViewMode?: ListBrowserViewMode
  onControlledViewModeChange?: (mode: ListBrowserViewMode) => void
  /** Extra action buttons rendered right of the built-in view-options menu (e.g. favorites toggle, search-toggle). */
  headerActions?: ReactNode[]
  /** Extra action buttons rendered left of headerActions (e.g. panel toggle overrides, custom sort). */
  headerLeadingActions?: ReactNode[]

  // ── Render ──────────────────────────────────────────────────────────
  /** Called for every visible item; `viewMode` lets the consumer pick a gallery-card vs. list-row component. */
  renderCard: (item: T, size: CardSize, viewMode: ListBrowserViewMode) => ReactNode
  cardKey: (item: T) => string
  emptyState: ReactNode
  listItemClassName?: string

  // ── Pagination ──────────────────────────────────────────────────────
  /**
   * Initial scroll mode when the user has no saved preference.
   * Defaults to `'paginated'`. Pass `'unlimited'` for infinite scroll.
   */
  defaultScrollMode?: ScrollMode

  // ── Panel layout (ADR-339 D6) ───────────────────────────────────────
  /**
   * Fallback panel arrangement (categories on top vs. sidebar) when the user
   * has no persisted `listBrowser_panelMode` preference. Mobile always
   * renders `'top'` regardless. Defaults to `'sidebar'` — sell pages pass
   * `'top'` so "Categories on top" is the sell default without a global flip.
   */
  defaultPanelMode?: PanelMode

  // ── Section headers (ADR-339 D5) ────────────────────────────────────
  /**
   * Optional section key for an item. When provided (list view only), the
   * primitive renders a section header row whenever the key changes between
   * consecutive rendered items — the consumer is responsible for ordering
   * `items` so each section's entries are contiguous. Gallery view stays
   * flat (chip filtering); omitting the prop disables sections entirely.
   */
  sectionOf?: (item: T) => string | undefined
  /** Display labels for section keys; raw keys render when absent. */
  sectionLabels?: Record<string, string>

  // ── Filter FAB (scroll-revealed drawer) ─────────────────────────────
  /**
   * Show a floating filter button once the list header is scrolled out of view.
   * It opens a left slide-in drawer (blurred backdrop) exposing tabs, sort,
   * the vertical category navigation and the sidebar extras.
   */
  filterFab?: boolean
  /**
   * Keep the filter FAB visible from first paint instead of revealing it only
   * after the header sentinel scrolls out of view. Use on surfaces whose
   * mobile header has no built-in filter trigger (e.g. /search).
   */
  filterFabAlwaysVisible?: boolean

  // ── Persistence (storage-key namespacing) ───────────────────────────
  storageKeyPrefix: string
  /** Force a specific view mode (e.g. 'list') and hide the gallery/list toggle */
  forcedViewMode?: ListBrowserViewMode

  // ── Server-side pagination (ADR-335 D4) ─────────────────────────────
  /**
   * When provided (together with `hasMore`), unlimited scroll switches from
   * client-side `visibleCount` slicing to server-driven batch loading: every
   * item already in `items` is rendered (visibleCount tracks `items.length`),
   * and reaching the end of the list calls `onLoadMore()` to fetch the next
   * batch (e.g. `useOfferSearchInfinite`'s `fetchNextPage`) instead of just
   * revealing more of an already-fully-loaded array. Omit for the existing
   * client-side-only consumers (Home sliders etc.) — default behavior is
   * unchanged.
   */
  onLoadMore?: () => void | Promise<void>
  /** Whether the server has more pages beyond what's currently in `items`. Required alongside `onLoadMore`. */
  hasMore?: boolean
}
