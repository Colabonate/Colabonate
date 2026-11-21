import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Checkbox, Divider, IconButton, Menu, MenuItem, Tooltip,
} from '@mui/material'
import {
  Package, Briefcase, Trash2, Zap, EyeOff, Eye, Check,
  Repeat, ImageIcon, Coins, Link2, Boxes, ToggleLeft, Tag,
  MoreVertical, Pencil, ArrowRightLeft,
} from 'lucide-react'
import type { KPIItem } from '@ds/ui'
import { ListBrowser } from '../../../components/list-browser'
import type { TaxonomyAxis, GammaTagFacet } from '../../../components/list-browser'
import { apiCall } from '../../../lib/api'
import { formatSatsNumber } from '../../../lib/currency'
import { FiatHint } from '../../../components/currency/FiatHint'
import { SearchInput } from '../../../components/ui/SearchInput'
import { useFABActions } from '../../../context/FABContext'
import { useQueryClient } from '@tanstack/react-query'
import { useStandardCategories, useCompanyProducts, useUserCatalogs } from '../../../hooks/useEntityQueries'
import type { ProductWithCatalogName } from '../../../hooks/useEntityQueries'
import { usePageListViewMode } from '../../../hooks/usePageListViewMode'
import type { SellTabProps } from '../sell.types'
import { EmptyStateGuide } from '../../../components/EmptyStateGuide'

type FilterTab = 'all' | 'available' | 'unavailable'
type SortOption = 'newest' | 'price-asc' | 'price-desc' | 'name'
type ProductWithCatalog = ProductWithCatalogName

interface ProductRowCommonProps {
  product: ProductWithCatalog
  onView: () => void
  onDelete: () => void
  productCatalogs: Array<{ id: string; name: string }>
  onMoveTo: (catalogId: string) => void
}

// ADR-395: products may exist without a catalog — they belong to the company.
const NO_CATALOG_SECTION = '__no-catalog__'
const NO_CATALOG_LABEL = 'No catalog'

function catalogLabel(product: ProductWithCatalog): string {
  return product.catalogId ? product.catalogName : NO_CATALOG_LABEL
}

function readImages(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string')
  if (typeof raw === 'string' && raw) {
    try { return (JSON.parse(raw) as unknown[]).filter((x): x is string => typeof x === 'string') } catch { return [] }
  }
  return []
}

function ProductOptionsMenu({
  product, productCatalogs, onMoveTo, onDelete, onClose,
}: {
  product: ProductWithCatalog
  productCatalogs: Array<{ id: string; name: string }>
  onMoveTo: (catalogId: string) => void
  onDelete: () => void
  onClose: () => void
}) {
  return (
    <>
      <MenuItem onClick={() => { onClose(); window.location.assign(`/sell/listings/${product.id}`) }}>
        <Pencil size={14} style={{ marginRight: 8 }} />
        Edit listing
      </MenuItem>
      <MenuItem onClick={() => {
        onClose()
        apiCall(`/api/catalog/products/${product.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isAvailable: !product.isAvailable }),
        }).catch(console.error)
      }}>
        {product.isAvailable
          ? <EyeOff size={14} style={{ marginRight: 8 }} />
          : <Eye size={14} style={{ marginRight: 8 }} />}
        {product.isAvailable ? 'Mark unavailable' : 'Mark available'}
      </MenuItem>
      {productCatalogs.length > 0 && (
        <>
          <Divider sx={{ my: 0.5 }} />
          <Tooltip title={product.catalogId ? 'Move to a different catalog' : 'Assign this product to a catalog'} placement="left">
            <Box sx={{ px: 2, py: 0.5, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--theme-text-muted)' }}>
              {product.catalogId ? 'Move to catalog' : 'Assign to catalog'}
            </Box>
          </Tooltip>
          {productCatalogs.map(c => (
            <MenuItem key={c.id} onClick={() => { onClose(); onMoveTo(c.id) }}>
              <Checkbox
                size="small"
                checked={product.catalogId === c.id}
                sx={{ p: 0, mr: 1 }}
              />
              {c.name}
            </MenuItem>
          ))}
        </>
      )}
      <Divider sx={{ my: 0.5 }} />
      <MenuItem
        onClick={() => { onClose(); onDelete() }}
        sx={{ color: 'var(--color-status-error)' }}
      >
        <Trash2 size={14} style={{ marginRight: 8 }} />
        Delete
      </MenuItem>
    </>
  )
}

function ProductRow({
  product, onView, onDelete, productCatalogs, onMoveTo,
}: ProductRowCommonProps) {
  const isService = product.standardCategory?.offerType === 'SERVICE'
  const images = readImages(product.images)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)

  return (
    <div
      className="flex items-stretch rounded-xl overflow-hidden transition-all duration-200 cursor-pointer hover:-translate-y-0.5 active:scale-[0.99]"
      style={{
        background: 'var(--theme-surface)',
        outline: '1px solid var(--theme-border)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)',
        minHeight: 72,
      }}
      onClick={(e) => {
        if (menuAnchor) { e.preventDefault(); return }
        if ((e.target as HTMLElement).closest('[aria-label="Options"]')) return
        onView()
      }}
    >
      {images.length > 0 ? (
        <div className="self-stretch overflow-hidden shrink-0" style={{ width: 72, background: 'var(--theme-bg-subtle)' }}>
          <img src={images[0]} alt={product.name} className="object-cover w-full h-full" />
        </div>
      ) : (
        <div
          className="flex items-center self-stretch justify-center shrink-0"
          style={{ width: 72, background: isService ? 'rgba(99,179,237,0.12)' : 'rgba(72,187,120,0.12)' }}
        >
          {isService
            ? <Briefcase size={22} style={{ color: 'var(--color-primary-50)' }} />
            : <Package size={22} style={{ color: 'var(--color-status-success)' }} />}
        </div>
      )}

      <div className="flex flex-col justify-center flex-1 min-w-0" style={{ padding: '10px 12px', gap: 2 }}>
        <div
          style={{
            fontSize: 10, fontWeight: 600, color: 'var(--theme-text-muted)',
            textTransform: 'uppercase' as const, letterSpacing: '0.04em',
            whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {catalogLabel(product)}
          {product.standardCategory?.name ? ` · ${product.standardCategory.name}` : ''}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4, color: 'var(--theme-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
          {product.name}
        </div>
        {!product.isAvailable && (
          <span
            className="self-start"
            style={{ padding: '1px 6px', borderRadius: 5, background: 'rgba(113,128,150,0.10)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.04em', color: 'var(--color-neutral-5)' }}
          >
            Unavailable
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0 self-center" style={{ paddingRight: 10 }}>
        {product.priceSats != null && (
          <div
            className="flex items-center gap-1"
            style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(99,179,237,0.10)', fontSize: 11, fontWeight: 700, color: 'var(--color-primary-50)', whiteSpace: 'nowrap' as const }}
          >
            <Zap size={11} /> {formatSatsNumber(product.priceSats, { compact: false })}
            <FiatHint sats={product.priceSats} className="text-[0.9em] ml-[3px]" />
          </div>
        )}
        <IconButton
          size="small"
          onClick={(e) => { e.stopPropagation(); setMenuAnchor(e.currentTarget) }}
          aria-label="Options"
          sx={{ width: 28, height: 28, border: '1px solid var(--theme-border)', bgcolor: 'var(--theme-bg-subtle)' }}
        >
          <MoreVertical size={14} strokeWidth={2.5} />
        </IconButton>
        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
          <ProductOptionsMenu
            product={product}
            productCatalogs={productCatalogs}
            onMoveTo={onMoveTo}
            onDelete={onDelete}
            onClose={() => setMenuAnchor(null)}
          />
        </Menu>
      </div>
    </div>
  )
}

function ProductGalleryCard({
  product, onView, onDelete, productCatalogs, onMoveTo,
}: ProductRowCommonProps) {
  const isService = product.standardCategory?.offerType === 'SERVICE'
  const images = readImages(product.images)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)

  return (
    <div
      className="flex flex-col rounded-xl overflow-hidden cursor-pointer relative transition-all duration-300 ease-out hover:-translate-y-1"
      style={{
        background: 'var(--theme-surface)',
        outline: '1px solid var(--theme-border)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)',
      }}
      onClick={(e) => {
        if (menuAnchor) { e.preventDefault(); return }
        if ((e.target as HTMLElement).closest('[aria-label="Options"]')) return
        onView()
      }}
    >
      <div
        className="relative flex items-center justify-center shrink-0 overflow-hidden"
        style={{ height: 130, background: 'var(--theme-bg-subtle)' }}
      >
        {images.length > 0 ? (
          <img src={images[0]} alt={product.name} className="object-cover w-full h-full" />
        ) : (
          isService
            ? <Briefcase size={48} style={{ color: 'var(--color-primary-50)', opacity: 0.6 }} />
            : <Package size={48} style={{ color: 'var(--color-status-success)', opacity: 0.6 }} />
        )}
        {!product.isAvailable && (
          <span
            className="absolute top-2 left-2 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(113,128,150,0.85)', color: 'white' }}
          >
            Unavailable
          </span>
        )}
      </div>
      <div className="flex flex-col flex-1" style={{ padding: '10px 12px' }}>
        <div
          style={{
            fontSize: 9, fontWeight: 600, color: 'var(--theme-text-muted)',
            textTransform: 'uppercase' as const, letterSpacing: '0.04em',
            whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {catalogLabel(product)}
          {product.standardCategory?.name ? ` · ${product.standardCategory.name}` : ''}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4, color: 'var(--theme-text)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 36 }}>
          {product.name}
        </div>
      </div>
      <div
        className="flex items-center justify-between gap-1 px-2 py-1.5"
        style={{ borderTop: '1px solid var(--theme-border)' }}
      >
        {product.priceSats != null ? (
          <div
            className="flex items-center gap-1"
            style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(99,179,237,0.10)', fontSize: 11, fontWeight: 700, color: 'var(--color-primary-50)', whiteSpace: 'nowrap' as const }}
          >
            <Zap size={11} /> {formatSatsNumber(product.priceSats, { compact: false })}
            <FiatHint sats={product.priceSats} className="text-[0.9em] ml-[3px]" />
          </div>
        ) : <span />}
        <IconButton
          size="small"
          onClick={(e) => { e.stopPropagation(); setMenuAnchor(e.currentTarget) }}
          aria-label="Options"
          sx={{ width: 26, height: 26 }}
        >
          <MoreVertical size={14} strokeWidth={2.5} />
        </IconButton>
        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
          <ProductOptionsMenu
            product={product}
            productCatalogs={productCatalogs}
            onMoveTo={onMoveTo}
            onDelete={onDelete}
            onClose={() => setMenuAnchor(null)}
          />
        </Menu>
      </div>
    </div>
  )
}

export function ProductsTab({ pubkey, onKpiChange, headerPrefix }: SellTabProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: productData, isLoading: loading } = useCompanyProducts(pubkey)
  const products: ProductWithCatalog[] = productData?.products ?? []
  const catalogCount = productData?.catalogCount ?? 0
  const company = useMemo(() => (productData ? { id: 'dummy-company-id' } : null), [productData])

  // ADR-340 D5: Move-to-catalog needs the caller's PRODUCT catalogs. Pulled
  // from useUserCatalogs (now `?mine=1`); filter to PRODUCT types and drop
  // the dummy Company wrapper.
  const { data: catalogData } = useUserCatalogs(pubkey)
  const productCatalogs = useMemo(
    () => (catalogData?.catalogs ?? [])
      .filter((c: { catalogType?: string }) => (c.catalogType ?? 'PRODUCT') === 'PRODUCT')
      .map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })),
    [catalogData],
  )

  const [deleteConfirm, setDeleteConfirm] = useState<ProductWithCatalog | null>(null)
  const [moveTarget, setMoveTarget] = useState<{ product: ProductWithCatalog; newCatalogId: string } | null>(null)

  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [search, setSearch] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  // ADR-368 follow-up: Grid/List is a page-level preference — shared with the
  // other /sell/listings subtabs via the 'sellManage_viewMode' key.
  const [viewMode, setViewMode] = usePageListViewMode({
    storageKey: 'sellManage_viewMode',
    legacyKey: 'sellProducts_viewMode',
    initial: 'gallery',
  })

  const { setActions: setFABActions, clear: clearFAB } = useFABActions()
  const { data: categories = [] } = useStandardCategories()
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState('')
  const [taxonomy, setTaxonomy] = useState<TaxonomyAxis>('standard')
  const [selectedGammaTags, setSelectedGammaTags] = useState<string[]>([])

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['company-products', pubkey] })
    queryClient.invalidateQueries({ queryKey: ['user-catalogs', pubkey] })
  }

  const gammaTagFacets = useMemo<GammaTagFacet[]>(() => {
    const counts = new Map<string, number>()
    for (const p of products) {
      for (const tag of p.gammaTags ?? []) {
        counts.set(tag, (counts.get(tag) || 0) + 1)
      }
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
  }, [products])

  const filteredItems = useMemo(() => {
    let filtered = products
    if (filterTab === 'available') filtered = filtered.filter(p => p.isAvailable)
    else if (filterTab === 'unavailable') filtered = filtered.filter(p => !p.isAvailable)
    if (activeQuery.trim()) {
      const q = activeQuery.trim().toLowerCase()
      filtered = filtered.filter(p => p.name.toLowerCase().includes(q) || catalogLabel(p).toLowerCase().includes(q))
    }
    if (taxonomy === 'gamma') {
      if (selectedGammaTags.length > 0) {
        filtered = filtered.filter(p => p.gammaTags?.some(t => selectedGammaTags.includes(t)))
      }
    } else if (selectedCategory) {
      filtered = filtered.filter(p => p.standardCategory?.slug?.startsWith(selectedCategory))
    }
    const sorted = [...filtered]
    if (sortBy === 'price-asc') sorted.sort((a, b) => (a.priceSats ?? 0) - (b.priceSats ?? 0))
    else if (sortBy === 'price-desc') sorted.sort((a, b) => (b.priceSats ?? 0) - (a.priceSats ?? 0))
    else if (sortBy === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name))
    else sorted.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    // ListBrowser renders a section header whenever the key changes, so each
    // catalog's products must be contiguous (the chosen sort applies within a
    // section). Catalog-less products form a trailing "No catalog" section.
    const catalogOrder = new Map(productCatalogs.map((c, i) => [c.id, i]))
    const rank = (p: ProductWithCatalog) =>
      p.catalogId ? (catalogOrder.get(p.catalogId) ?? productCatalogs.length) : productCatalogs.length + 1
    return sorted
      .map((p, i) => ({ p, i }))
      .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
      .map(({ p }) => p)
  }, [products, productCatalogs, filterTab, activeQuery, selectedCategory, taxonomy, selectedGammaTags, sortBy])

  // ADR-340 D5: catalog sections — same ListBrowser primitive AgentStack uses.
  // ADR-395: catalog-less products get their own "No catalog" section.
  const sectionOf = useMemo(
    () => (p: ProductWithCatalog) => p.catalogId ?? NO_CATALOG_SECTION,
    [],
  )

  const kpiItems = useMemo<KPIItem[]>(() => {
    const total = products.length
    const available = products.filter(p => p.isAvailable).length
    const unavailable = products.filter(p => !p.isAvailable).length
    return [
      { icon: <Tag size={14} />, value: categories.filter(c => c.level === 1).length, label: 'Categories', onClick: () => setCategoryOpen(v => !v), active: categoryOpen, heading: 'Browse' },
      { icon: <Package size={14} />, value: total, label: 'Products', onClick: () => setFilterTab('all'), active: filterTab === 'all' },
      { icon: <Check size={14} />, value: available, label: 'Available', onClick: () => setFilterTab('available'), active: filterTab === 'available' },
      { icon: <EyeOff size={14} />, value: unavailable, label: 'Unavailable', onClick: () => setFilterTab('unavailable'), active: filterTab === 'unavailable', separator: true },
    ]
  }, [products, filterTab, categories, categoryOpen])

  useEffect(() => {
    onKpiChange(kpiItems, loading)
  }, [onKpiChange, kpiItems, loading])

  useEffect(() => {
    setFABActions([{
      id: 'create-product',
      label: 'Product',
      info: 'Add a new product',
      group: 'Create',
      onClick: () => navigate(company ? '/offers/new?type=PRODUCT&context=corporate' : '/sell/company'),
    }])
    return () => clearFAB()
  }, [setFABActions, clearFAB, company, navigate])

  function handleView(product: ProductWithCatalog) {
    navigate(product.catalogId
      ? `/sell/catalog/${product.catalogId}/products/${product.id}`
      : `/sell/products/${product.id}`)
  }
  function handleMoveTo(product: ProductWithCatalog, newCatalogId: string) {
    setMoveTarget({ product, newCatalogId })
  }

  async function confirmMove() {
    if (!moveTarget) return
    try {
      await apiCall(`/api/catalog/${moveTarget.newCatalogId}/products/assign`, {
        method: 'POST',
        body: JSON.stringify({ productId: moveTarget.product.id }),
      })
      setMoveTarget(null)
      invalidate()
    } catch (error) {
      console.error('Failed to move product:', error)
    }
  }

  async function confirmDelete() {
    if (!deleteConfirm) return
    try {
      await apiCall(`/api/catalog/products/${deleteConfirm.id}`, { method: 'DELETE' })
      setDeleteConfirm(null)
      invalidate()
    } catch (error) {
      console.error('Failed to delete product:', error)
    }
  }

  const commonProps = (product: ProductWithCatalog) => ({
    product,
    productCatalogs,
    onView: () => handleView(product),
    onDelete: () => setDeleteConfirm(product),
    onMoveTo: (catalogId: string) => handleMoveTo(product, catalogId),
  })

  return (
    <>
      <ListBrowser
        items={filteredItems}
        loading={loading}
        headerPrefix={headerPrefix}
        controlledViewMode={viewMode}
        onControlledViewModeChange={setViewMode}
        filterTabs={[
          { key: 'all', label: 'All' },
          { key: 'available', label: 'Available' },
          { key: 'unavailable', label: 'Unavailable' },
        ]}
        activeFilterTab={filterTab}
        onFilterTabChange={(key) => setFilterTab(key as FilterTab)}
        categories={categories}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        taxonomy={taxonomy}
        onTaxonomyChange={setTaxonomy}
        gammaTagFacets={gammaTagFacets}
        selectedGammaTags={selectedGammaTags}
        onSelectGammaTags={setSelectedGammaTags}
        searchQuery={activeQuery}
        onSearchQueryChange={(q) => { setSearch(q); setActiveQuery(q) }}
        sortBy={sortBy}
        onSortChange={(s) => setSortBy(s as SortOption)}
        sortOptions={[
          { value: 'newest', label: 'Newest' },
          { value: 'price-asc', label: 'Price ↑' },
          { value: 'price-desc', label: 'Price ↓' },
          { value: 'name', label: 'Name A–Z' },
        ]}
        // ADR-340 D5: products can now be viewed as a gallery too. The
        // ListBrowser's view-mode toggle is enabled by default.
        categoryOpen={categoryOpen}
        onCategoryOpenChange={setCategoryOpen}
        defaultPanelMode="top"
        // Catalog sections — keyed by catalogId; labels come from
        // productCatalogs. Filtered lists (single catalog chip) collapse to
        // one section by definition (mirrors AgentStackTab).
        sectionOf={sectionOf}
        sectionLabels={{
          ...Object.fromEntries(productCatalogs.map(c => [c.id, c.name])),
          [NO_CATALOG_SECTION]: NO_CATALOG_LABEL,
        }}
        headerActions={[
          <SearchInput
            key="search"
            variant="toggle"
            size="md"
            value={search}
            onChange={setSearch}
            onSearch={() => setActiveQuery(search)}
            onClear={() => { setSearch(''); setActiveQuery('') }}
            placeholder="Search products…"
            ariaLabel="Search products"
          />,
        ]}
        renderCard={(product, _size, viewMode) => viewMode === 'gallery'
          ? <ProductGalleryCard {...commonProps(product)} />
          : <ProductRow {...commonProps(product)} />
        }
        cardKey={(product) => product.id}
        emptyState={
          <EmptyStateGuide
            icon={<Boxes size={26} />}
            accent="var(--color-status-success)"
            accentSoft="rgba(72,187,120,0.12)"
            title="No products yet"
            intro={company
              ? 'Products belong to your company. Group them into a catalog if you like — or add them without one and assign a catalog later. Price them in sats, toggle availability, and publish them whenever you’re ready to sell.'
              : 'Products belong to your company. To create products you first need an active company profile — the public identity buyers see and trust.'}
            features={[
              { icon: <Repeat size={16} />, title: 'Optional Catalogs', text: 'A product sits in at most one catalog. Assign or move it any time as your storefront evolves.', color: 'var(--color-status-success)', bg: 'rgba(72,187,120,0.12)' },
              { icon: <Coins size={16} />, title: 'Pricing in Sats', text: 'Set a price in Bitcoin sats. Lightning enables instant, low-fee payments with no traditional banking required.', color: 'var(--color-warning-primary)', bg: 'rgba(255,192,57,0.10)' },
              { icon: <ToggleLeft size={16} />, title: 'Availability Toggle', text: 'Mark a product Available or Unavailable without deleting it — pause sales temporarily while keeping the record intact.', color: 'var(--color-info-primary)', bg: 'rgba(56,189,248,0.12)' },
              { icon: <ImageIcon size={16} />, title: 'Images & Details', text: 'Add photos, a description, and a standard category so buyers can find and evaluate your product at a glance.', color: 'var(--color-secondary-50)', bg: 'rgba(159,122,234,0.12)' },
              { icon: <Link2 size={16} />, title: 'Linked Listings', text: 'Products become sellable once published as listings. Edit a listing directly from its product row via the ⋮ menu.', color: 'var(--color-primary-50)', bg: 'rgba(232,69,65,0.10)' },
              { icon: <Boxes size={16} />, title: 'One Inventory, Many Storefronts', text: 'This tab aggregates every product across all your catalogs into a single searchable, filterable inventory view.', color: 'var(--color-accent-3)', bg: 'rgba(42,232,102,0.10)' },
            ]}
            helpLinks={[
              { label: 'List products & services', to: '/help/selling#sell-4' },
              { label: 'Create catalogs & categories', to: '/help/selling#sell-3' },
              { label: 'Selling guide', to: '/help/selling' },
            ]}
            ctaLabel="Create Product"
            ctaTo={company ? '/offers/new?type=PRODUCT&context=corporate' : undefined}
            onCta={company ? undefined : () => navigate('/sell/company')}
            secondaryCtaLabel={company ? (catalogCount === 0 ? 'Create a catalog' : undefined) : 'Set up company'}
            secondaryCtaTo={company ? (catalogCount === 0 ? '/sell/listings?tab=catalogs&create=catalog' : undefined) : '/sell/company/setup'}
          />
        }
        storageKeyPrefix="sellProducts"
      />

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-sm p-5 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
            <h3 className="text-[16px] font-semibold mb-2" style={{ color: 'var(--theme-text)' }}>Delete Product?</h3>
            <p className="text-[13px] mb-4" style={{ color: 'var(--theme-text-muted)' }}>
              “{deleteConfirm.name}” will be removed and its listing archived. Past bookings remain visible in tickets.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 cursor-pointer hover:opacity-90" style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text)' }}>Cancel</button>
              <button onClick={confirmDelete} className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 cursor-pointer hover:opacity-90" style={{ background: 'var(--color-status-error)', color: 'white' }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {moveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-sm p-5 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
            <h3 className="text-[16px] font-semibold mb-2" style={{ color: 'var(--theme-text)' }}>Move Product?</h3>
            <p className="text-[13px] mb-4" style={{ color: 'var(--theme-text-muted)' }}>
              {moveTarget.product.catalogId
                ? <>“{moveTarget.product.name}” will move from “<strong>{moveTarget.product.catalogName}</strong>” to </>
                : <>“{moveTarget.product.name}” will be assigned to </>}
              “<strong>{productCatalogs.find(c => c.id === moveTarget.newCatalogId)?.name ?? '...'}</strong>”.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setMoveTarget(null)} className="flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 cursor-pointer hover:opacity-90" style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text)' }}>Cancel</button>
              <button onClick={confirmMove} className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 cursor-pointer hover:opacity-90 inline-flex items-center justify-center gap-1.5" style={{ background: 'var(--color-primary-50)', color: 'white' }}>
                <ArrowRightLeft size={13} /> Move
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}