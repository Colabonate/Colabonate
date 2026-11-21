# SKILL: List/Grid Page Pattern (SellOffers Pattern)

This pattern is used for pages that display a list of items with filtering, view modes (list/gallery), and action menus.

---

## Use Case

When you need a page with:
- Filterable list of items (products, services, offers, etc.)
- Multiple view modes (list view, gallery/grid view)
- View mode persisted to localStorage
- Context tabs (All | Private | Corporate)
- KPI strip as filters
- Row/card actions (View, Edit, Archive, Delete, Publish)
- Floating add button
- Create modals

---

## Pattern Structure

```
MyListPage.tsx
├── State Management
│   ├── viewMode (persisted to localStorage)
│   ├── filterTab (KPI strip filter)
│   ├── contextTab (All | Private | Corporate)
│   ├── items (main data array)
│   ├── tickets (related data for counts)
│   └── deleteConfirm (modal state)
│
├── Data Fetching
│   └── fetchData() - loads items + related tickets
│
├── Filtering
│   └── filteredItems - useMemo combining contextTab + filterTab
│
├── KPI Items (for filter strip)
│   └── kpiItems - useMemo with counts per filter
│
├── Action Handler
│   └── handleAction(action, item) - routes to view/edit/archive/delete/publish
│
├── Components
│   ├── ListRow - single row in list view (clickable for view)
│   ├── GalleryCard - card in grid view with overflow menu
│   └── Skeleton* - loading states
│
└── Modals
    ├── CreateModal - quick create modal
    └── DeleteConfirmDialog - inline delete confirmation
```

---

## Key Features

### 0. Standardized ListHeader Contract (ADR-339 D7)

Every list page renders the **single** `packages/ui` ListHeader — through ListBrowser's built-in header wherever possible (ListingsTab/CatalogsTab/ProductsTab/AgentStackTab) or directly (CoopOffers, BuyOrders, …). The header wiring is standardized; do not invent per-page variants:

- **filterTabs** — the page-level tabs get per-tab labels (e.g. Products: All/Available/Unavailable; Agent Stack: All/Online/Offline).
- **Toggle SearchInput** — `variant="toggle" size="md"` with **deferred commit**: a draft `query` state feeds the input, `onSearch`/`onClear` commit to a separate `activeQuery` that drives filtering. No always-open live search.
- **sortBy/sortOptions** — a sort `<select>` inside ListBrowser's sliders menu (filterMenuAction); the consumer owns the comparison in its filter pipeline.

```typescript
// Canonical wiring (ListingsTab / AgentStackTab / ProductsTab)
searchQuery={activeQuery}
onSearchQueryChange={(q) => { setQuery(q); setActiveQuery(q) }}
sortBy={sortBy}
onSortChange={(s) => setSortBy(s as SortOption)}
sortOptions={[{ value: 'newest', label: 'Newest' }, /* … */]}
headerActions={[
  <SearchInput key="search" variant="toggle" size="md" value={query} onChange={setQuery}
    onSearch={() => setActiveQuery(query)} onClear={() => { setQuery(''); setActiveQuery('') }} />,
]}
```

Related ListBrowser props from the same ADR: `defaultPanelMode="top"` (sell pages default to Categories-on-top when no persisted pref exists) and the presentational `sectionOf`/`sectionLabels` section headers (list view only).

### 0a. Sub-Tab Pill + ListHeader Arrangement

The secondary sub-tab pill is the **shared** `components/SubTabPill.tsx` (single source for the pill styling: `--theme-surface-secondary` track, `--theme-surface` active segment, primary-tinted label) — never re-create the markup per page.

Arrangement rule: the pill sits in **one line with** the ListHeader on desktop (>=600px) and **stacks above** it on mobile (<600px):

- **ListBrowser consumers** (SellListings tabs): the page shell builds the pill once and threads it through the tab props (`SellTabProps.headerPrefix`) into ListBrowser's `headerPrefix` slot, which renders `[pill | ListHeader]` as `flex flex-col md:flex-row md:items-center gap-2`.
- **Direct ListHeader consumers** (BuyOrders, …): wrap pill + ListHeader in the same `flex flex-col md:flex-row md:items-center gap-2` row, with the ListHeader in a `flex-1 min-w-0` wrapper.

```tsx
<SubTabPill
  tabs={[{ key: 'all', label: 'All', icon: <PackageIcon size={14} /> }, /* … */]}
  active={activeTab}
  onChange={handleTabChange}
  ariaLabel="Section"
/>
```

### 1. View Mode Persistence

```typescript
const [viewMode, setViewModeState] = useState<ViewMode>(() => {
  const saved = localStorage.getItem('myPage_viewMode')
  return (saved === 'list' || saved === 'gallery') ? saved : 'gallery'
})

function setViewMode(mode: ViewMode) {
  setViewModeState(mode)
  localStorage.setItem('myPage_viewMode', mode)
}
```

### 2. Two-Level Filtering

```typescript
type FilterTab = 'all' | 'type1' | 'type2' | 'status1' | 'status2'
type ContextTab = 'all' | 'private' | 'corporate'

const filteredItems = useMemo(() => {
  let filtered = items
  // First: context filter
  if (contextTab === 'private') {
    filtered = filtered.filter(o => !o.companyId)
  } else if (contextTab === 'corporate') {
    filtered = filtered.filter(o => !!o.companyId)
  }
  // Second: type/status filter
  if (filterTab === 'type1') {
    filtered = filtered.filter(o => o.type === 'TYPE1')
  } else if (filterTab === 'status1') {
    filtered = filtered.filter(o => o.status === 'STATUS1')
  }
  return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}, [items, filterTab, contextTab])
```

### 3. KPI Strip as Filter

```typescript
const kpiItems = useMemo<KPIItem[]>(() => [
  { filterId: 'all', icon: <ItemIcon />, value: items.length, label: 'All' },
  { filterId: 'products', icon: <ProductIcon />, value: productCount, label: 'Products' },
  { filterId: 'services', icon: <ServiceIcon />, value: serviceCount, label: 'Services' },
  { filterId: 'active', icon: <Eye />, value: activeCount, label: 'Active' },
  { filterId: 'drafts', icon: <EyeOff />, value: draftCount, label: 'Drafts' },
  { filterId: 'pending', icon: <Clock />, value: pendingCount, label: 'Pending', color: 'var(--color-warning-primary)' },
], [items])

// In JSX:
<KPIStrip 
  items={kpiItems}
  loading={loading}
  skeletonCount={6}
  onItemClick={(filterId) => setFilterTab(filterId as FilterTab)}
  selectedFilter={filterTab}
/>
```

### 4. Context Tab Buttons

```typescript
<div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
  <button
    onClick={() => setContextTab('all')}
    className="px-3 h-8 flex items-center justify-center rounded-md text-[12px] font-medium cursor-pointer"
    style={{
      background: contextTab === 'all' ? 'var(--theme-surface)' : 'transparent',
      color: contextTab === 'all' ? 'var(--color-primary-50)' : 'var(--theme-text-muted)',
    }}
  >
    All
  </button>
  {/* ... Private, Corporate buttons ... */}
</div>
```

### 5. Gallery Card with Overflow Menu (Outside Article)

```typescript
function OfferCard({ offer, onAction }) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="relative z-0 py-1 hover:z-10">
      <article
        className="relative rounded-xl overflow-hidden ..."
        onClick={() => onAction('view', offer)}
      >
        {/* Card content: image, badges, title, price */}
      </article>

      {/* Menu is OUTSIDE article to avoid overflow clipping */}
      <button onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}>...</button>
      {menuOpen && (
        <div className="absolute top-full right-2 mt-1 w-36 py-1 rounded-lg shadow-lg z-50">
          <Link to={`/items/${offer.id}`}>View</Link>
          <button onClick={() => onAction('edit', offer)}>Edit</button>
          {/* ... more actions ... */}
        </div>
      )}
    </div>
  )
}
```

### 6. List Row with View on Click, Edit Button

```typescript
function OfferRow({ offer, onAction, onView }) {
  return (
    <div 
      onClick={() => onView(offer)}
      className="flex items-center gap-4 px-4 py-3.5 rounded-xl cursor-pointer ..."
    >
      {/* Icon, title, status badges */}
      <div className="flex-1 min-w-0">
        <span>{offer.title}</span>
        <p>{offer.category}</p>
      </div>
      {/* Price */}
      <span>{offer.priceSats}</span>
      {/* Actions */}
      <button onClick={(e) => { e.stopPropagation(); onAction('edit', offer) }}>
        <Edit />
      </button>
      <MoreMenu with archive/delete/publish options />
    </div>
  )
}
```

### 7. View Mode Toggle (Persisted)

```typescript
<div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: 'var(--theme-bg-subtle)' }}>
  <button
    onClick={() => setViewMode('list')}
    style={{ background: viewMode === 'list' ? 'var(--theme-surface)' : 'transparent' }}
  >
    <List />
  </button>
  <button
    onClick={() => setViewMode('gallery')}
    style={{ background: viewMode === 'gallery' ? 'var(--theme-surface)' : 'transparent' }}
  >
    <LayoutGrid />
  </button>
</div>
```

### 8. Empty State with Context-Aware CTA

```typescript
{filt
eredItems.length === 0 ? (
  <div className="flex flex-col items-center py-16 gap-4">
    <EmptyIcon />
    <span>No items found</span>
    <p>{filterTab === 'services' ? 'Create your first service...' : 
        filterTab === 'products' ? 'Create your first product...' :
        'Create your first item...'}</p>
    <div className="flex gap-3">
      {(filterTab === 'all' || filterTab === 'services') && (
        <button onClick={() => setCreateServiceOpen(true)}>Create Service</button>
      )}
      {(filterTab === 'all' || filterTab === 'products') && (
        <button onClick={() => setCreateOfferOpen(true)}>Create Product</button>
      )}
    </div>
  </div>
) : viewMode === 'gallery' ? (
  <Gallery items />
) : (
  <List items />
)}
```

### 9. Action Handler Pattern

```typescript
function handleAction(action: 'view' | 'edit' | 'archive' | 'delete' | 'publish', item: Item) {
  if (action === 'view') {
    navigate(`/items/${item.id}`)
    return
  }
  if (action === 'delete') { 
    setDeleteConfirm(item); 
    return 
  }
  if (action === 'edit') {
    navigate('/items/new', {
      state: {
        itemId: item.id,
        editingItem: item,
        prefill: { /* form fields */ },
      },
    })
    return
  }
  if (action === 'archive') {
    apiCall(`/api/items/${item.id}`, { 
      method: 'PATCH', 
      body: JSON.stringify({ status: 'ARCHIVED', creatorPubkey: pubkey }) 
    }).then(() => fetchData())
    return
  }
  if (action === 'publish') {
    apiCall(`/api/items/${item.id}`, { 
      method: 'PATCH', 
      body: JSON.stringify({ status: 'ACTIVE', creatorPubkey: pubkey }) 
    }).then(() => fetchData())
    return
  }
}
```

### 10. Delete Confirmation Dialog

```typescript
{deleteConfirm && (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4" 
       style={{ background: 'rgba(0,0,0,0.5)' }}>
    <div className="w-full max-w-sm p-5 rounded-xl" 
         style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
      <h3>Delete Item?</h3>
      <p>"{deleteConfirm.title}" will be permanently removed.</p>
      <div className="flex gap-2">
        <button onClick={() => setDeleteConfirm(null)}>Cancel</button>
        <button onClick={confirmDelete} style={{ background: 'var(--color-status-error)' }}>
          Delete
        </button>
      </div>
    </div>
  </div>
)}

async function confirmDelete() {
  if (!deleteConfirm || !pubkey) return
  await apiCall(`/api/items/${deleteConfirm.id}`, { 
    method: 'DELETE', 
    body: JSON.stringify({ creatorPubkey: pubkey }) 
  })
  setDeleteConfirm(null)
  fetchData()
}
```

---

## Example: Creating a New List Page

1. Copy `SellOffers.tsx` as template
2. Replace `Offer` type with your item type
3. Update API endpoint in `fetchData()`
4. Update filter types (`FilterTab`, `ContextTab`)
5. Update KPI items with relevant counts
6. Update action handler for your item's specific actions
7. Update card/row components for your item's display fields
8. Update modals if using different create modals

---

## Related Files

- `apps/colabonate-app/src/routes/sell/SellOffers.tsx` - Main example
- `packages/ui/kpi-strip/kpi-strip.tsx` - KPIStrip component
- `packages/ui/floating-add-button/floating-add-button.tsx` - FAB component
