# ListBrowser

Shared list/filter/sort/scroll/presentation component (ADR-218). Extracted from
`BuyDashboard.tsx`; consumed by `BuyDashboard` and `CoopExplore`.

## Purpose

Renders the category sidebar/top-panel, `ListHeader` (tabs + view-options menu),
active-filter chips, result grid/list and pagination bar. Purely presentational
and controlled: it does **not** filter or sort `items` itself — the consumer
computes the final `items` array (tab + category + search + sort applied) and
ListBrowser only paginates/slices it for display.

## Internal state (owned by ListBrowser, namespaced by `storageKeyPrefix`)

- `viewMode` (gallery/list) — `${prefix}_viewMode` localStorage
- `cardSize` (S/M/L) — `${prefix}_cardSize` localStorage
- `panelMode` (sidebar/top) — `listBrowser_panelMode` localStorage, deliberately **global** (not prefix-namespaced) so the layout preference is shared across all consumers (Buy, Coop Explore, …); forced to `top` on mobile
- `scrollMode` (paginated/unlimited) — `${prefix}_scrollMode` localStorage
- `pageSize` — `${prefix}_pageSize` localStorage (ADR-218 D12)
- `page`, `visibleCount`, `isLoadingMore` — in-memory

## Props

See `list-browser.types.ts`. Key seams:

- `categoryCountItems` — optional, defaults to `items`. Pass an item set that
  ignores the current category selection if sibling category counts should
  stay stable once a category is picked (this is what `BuyDashboard` does via
  its `useCategoryCounts()` hook; `CoopExplore` omits it and accepts counts
  that narrow with the active category, matching its pre-refactor behaviour).
- `sortOptions`/`onSortChange` are optional. When omitted, the built-in
  view-options menu simply doesn't render a sort section — the consumer can
  render its own sort control via `headerActions` instead (this is what
  `CoopExplore` does, since it only has 2 sort options vs. Buy's 4).
- `resetDeps` — pagination (`page`/`visibleCount`) resets to page 1 whenever
  `activeFilterTab`/`searchQuery`/`sortBy`/`selectedCategory`/`pageSize` change,
  since those are the dimensions ListBrowser knows about. If a consumer owns
  additional filter dimensions privately (Buy's `companyIdFilter`,
  `sellerPubkeyFilter`, `countryFilter` — none of which ListBrowser has props
  for), pass their current values as `resetDeps` so pagination resets for
  those too, instead of only clamping down once the current page happens to
  exceed the new result count.
- `sidebarExtraTop` / `sidebarExtraBottom` — render consumer-owned sidebar
  blocks (saved filters, country filter, seller-filter badge for Buy;
  Cooperation-Type filter for Coop) above/below the shared `CategorySidebar`.
- `headerPrefix` — node rendered LEFT of the `ListHeader` in one row on
  desktop (>=600px) and ABOVE it on mobile (<600px). Sell pages thread the
  page-level sub-tab pill (`components/SubTabPill.tsx`) from the page shell
  through their tab props into this slot (see LIST-PAGE-PATTERN.md §0a).
- `headerActions` / `headerLeadingActions` — arbitrary consumer-owned controls
  (search input, favorites toggle) rendered in the `ListHeader` action row,
  left of the built-in view-options menu button.

## Filter FAB + drawer (`filterFab`)

Opt-in via the `filterFab` prop (enabled by `BuyDashboard`). A 1px sentinel sits
above the header; on mobile/tablet, once it scrolls out of view (IntersectionObserver, −80px top
margin) a floating filter button fades in on the right-aligned vertical FAB
stack (Home's Add/AI/Cart tier system; tier 2 — mobile bottom `+72px`, desktop
`top: 190` — directly above the CartFAB's tier-1 slot; badge = active filter
count). On desktop (`lg`+, i.e. `isDesktop`) the FAB is visible from first paint
instead of being scroll-revealed — the sidebar is collapsible, so the FAB keeps
filters reachable without scrolling first. It opens `FilterDrawer` (`filter-drawer.tsx`): a left
slide-in panel (GSAP, reduced-motion aware) over a blurred backdrop
(`backdrop-filter: blur`) so the app stays subtly visible. The FAB and the
drawer chrome (panel, header, footer, animations) live in the shared
`components/ui/FilterDrawerShell.tsx` — `DaoDiscovery` reuses them with its
own `DaoSidebar` content on mobile/tablet. The drawer re-exposes
every header filter vertically: filter tabs (2-col grid), sort options (check
list), `sidebarExtraTop`/`sidebarExtraBottom` (Buy's saved filters, location,
seller badge) and the full 3-level category navigation via `CategorySidebar`
(`panelWidth={272}`). Filters apply immediately; the footer "Show N results"
button just closes the drawer. Escape/backdrop click close it; body scroll is
locked while open.

## Desktop sidebar card — viewport-bounded height + Lenis wheel containment (ADR-278)

The sticky sidebar card is `calc(100vh - 128px)` tall: 100px sticky offset
(`top-25`) + 28px safety, so it is **fully visible while pinned**. The
tag/category flex-fill region (`flex-1 min-h-0`) therefore derives from
*viewport minus the sidebar extras* (`sidebarExtraTop`/`sidebarExtraBottom`),
never from the height of the item list beside it — under unlimited scroll the
list grows indefinitely, the sidebar must not.

**Wheel rule:** the app runs Lenis smooth scroll app-wide
(`src/lib/lenis-setup.ts`). Since ADR-278's FU-278-A amendment, Lenis runs with
`allowNestedScroll: true`, so inner scroll containers wheel-scroll natively
everywhere; the `data-lenis-prevent` attributes below (sidebar card,
`GammaTagPanel` chip area, country list) are deliberate **hardening**: they
exempt the whole subtree so the sidebar never hands wheel events back to the
window until the card itself reaches its scroll end. New structural regions
with the same "never chain" requirement should carry the attribute too; plain
scrollable content needs nothing. Keep inner caps (e.g. the country list's
4-row `maxHeight: 134px`) paired with `overscroll-behavior: contain` so the
wheel does not chain into the card once the inner list ends.

## What stays outside ListBrowser

Per ADR-218 D7: saved filters (`useFilterFavorites`), country filter, the
favorites-only toggle, the vendor directory view, and the save-filter dialog
are Buy-specific concerns with no coop-entity equivalent today. They live in
`BuyDashboard` as overlay logic around `<ListBrowser>`, wired through the
`sidebarExtraTop`/`sidebarExtraBottom`/`headerActions` slots.
