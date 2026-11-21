import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BookOpen, Bot, FolderTree, Plus, Pencil, Trash2,
  EyeOff, ChevronRight, Check, Zap, Briefcase, Package,
  Layers, Network, Repeat, ToggleLeft, Tag,
} from 'lucide-react'
import type { KPIItem } from '@ds/ui'
import { ListBrowser } from '../../../components/list-browser'
import { apiCall } from '../../../lib/api'
import { formatSatsNumber } from '../../../lib/currency'
import { FiatHint } from '../../../components/currency/FiatHint'
import { useFABActions } from '../../../context/FABContext'
import { useQueryClient } from '@tanstack/react-query'
import { useStandardCategories, useUserCatalogs } from '../../../hooks/useEntityQueries'
import type { CatalogWithProducts } from '../../../hooks/useEntityQueries'
import type { SellTabProps } from '../sell.types'
import { ActionButton } from '../components/ActionButton'
import { ProductPicker } from '../components/ProductPicker'
import { CreateCatalogModal, EditCatalogModal } from '../components/CatalogModals'
import { EmptyStateGuide } from '../../../components/EmptyStateGuide'

// ADR-340 D2: filter axis is the catalog Type (PRODUCT vs AGENT_SETUP).
// Active/Inactive is a sub-axis only meaningful for PRODUCT catalogs
// (AGENT_SETUP catalogs are all active in V1 — see FU-543). The KPI tiles
// for active/inactive stay on the strip as filter chips for PRODUCT.
// ADR-368 D3: Sell catalogs are PRODUCT-only — AGENT_SETUP catalog CRUD moved
// to Cooperate Manage's stack tab (`?view=catalogs` internal mode). Agent
// catalogs are excluded from this pool entirely.
type FilterTab = 'all' | 'product'
type Catalog = CatalogWithProducts & { catalogType?: 'PRODUCT' | 'AGENT_SETUP' }

function memberCount(catalog: Catalog): number {
  if (catalog.catalogType === 'AGENT_SETUP') return catalog.agentMembers?.length ?? 0
  return catalog.products?.length ?? 0
}

function TypeChip({ type }: { type: 'PRODUCT' | 'AGENT_SETUP' }) {
  if (type === 'AGENT_SETUP') {
    return (
      <div className="flex items-center gap-1 shrink-0" style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(159,122,234,0.10)', fontSize: 11, fontWeight: 700, color: 'var(--color-secondary-50)' }}>
        <Bot size={11} /> Agent Setups
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1 shrink-0" style={{ padding: '3px 10px', borderRadius: 6, background: 'rgba(99,179,237,0.10)', fontSize: 11, fontWeight: 700, color: 'var(--color-primary-50)' }}>
      <Package size={11} /> Products
    </div>
  )
}

function CatalogCard({
  catalog,
  onAction,
}: {
  catalog: Catalog
  onAction: (action: 'view' | 'edit' | 'delete' | 'toggle', catalog: Catalog) => void
}) {
  const isAgent = catalog.catalogType === 'AGENT_SETUP'
  const count = memberCount(catalog)
  const masterCategory = (catalog as any).standardCategory?.name
  const isService = (catalog as any).standardCategory?.offerType === 'SERVICE'

  return (
    <div
      className="rounded-xl overflow-hidden transition-all duration-200 cursor-pointer group hover:-translate-y-0.5 active:scale-[0.99]"
      style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)' }}
    >
      <div onClick={() => onAction('view', catalog)} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 16, padding: '18px 20px', alignItems: 'center' }}>
        <div
          className="flex items-center justify-center shrink-0 rounded-xl transition-transform duration-200 group-hover:scale-105"
          style={{
            width: 52, height: 52,
            background: isAgent ? 'rgba(159,122,234,0.12)' : (catalog.isActive ? 'rgba(99,179,237,0.12)' : 'var(--theme-surface-secondary)'),
            border: isAgent ? '1px solid rgba(159,122,234,0.20)' : (catalog.isActive ? '1px solid rgba(99,179,237,0.20)' : '1px solid var(--theme-border)'),
          }}
        >
          {isAgent ? <Bot size={24} style={{ color: 'var(--color-secondary-50)' }} /> : <BookOpen size={24} style={{ color: catalog.isActive ? 'var(--color-primary-50)' : 'var(--theme-text-muted)' }} />}
        </div>
        <div className="flex flex-col gap-2 min-w-0">
          <h4 className="text-[15px] font-semibold truncate" style={{ color: 'var(--theme-text)', lineHeight: 1.4 }}>{catalog.name}</h4>
          {catalog.description && <p className="line-clamp-1" style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--theme-text-muted)' }}>{catalog.description}</p>}
          <div className="flex items-center gap-2 flex-wrap">
            <TypeChip type={catalog.catalogType ?? 'PRODUCT'} />
            <div className="flex items-center gap-1 shrink-0" style={{ padding: '3px 10px', borderRadius: 6, background: isAgent ? 'rgba(159,122,234,0.10)' : 'rgba(99,179,237,0.10)', fontSize: 11, fontWeight: 700, color: isAgent ? 'var(--color-secondary-50)' : 'var(--color-primary-50)' }}>
              <FolderTree size={11} /> {count} {isAgent ? (count === 1 ? 'Agent' : 'Agents') : (count === 1 ? 'Product' : 'Products')}
            </div>
            {!isAgent && (
              <div className="shrink-0" style={{ padding: '3px 10px', borderRadius: 6, background: catalog.isActive ? 'rgba(72,187,120,0.12)' : 'rgba(113,128,150,0.10)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.04em', color: catalog.isActive ? 'var(--color-status-success)' : 'var(--color-neutral-5)' }}>
                {catalog.isActive ? 'Active' : 'Inactive'}
              </div>
            )}
            {!isAgent && masterCategory && (
              <div className="shrink-0" style={{ padding: '3px 10px', borderRadius: 6, background: isService ? 'rgba(159,122,234,0.10)' : 'rgba(72,187,120,0.08)', fontSize: 11, fontWeight: 600, color: isService ? 'var(--color-secondary-50)' : 'var(--color-status-success)' }}>
                {isService ? <Briefcase size={10} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 3, opacity: 0.7 }} /> : <Package size={10} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 3, opacity: 0.7 }} />}
                {masterCategory}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <ActionButton icon={<Pencil size={15} />} title="Edit catalog" onClick={(e) => { e.stopPropagation(); onAction('edit', catalog) }} />
          {!isAgent && (
            <ActionButton icon={<EyeOff size={15} />} title={catalog.isActive ? 'Deactivate catalog' : 'Activate catalog'} color={catalog.isActive ? 'var(--color-warning-primary)' : 'var(--color-status-success)'} onClick={(e) => { e.stopPropagation(); onAction('toggle', catalog) }} />
          )}
          <ActionButton icon={<Trash2 size={15} />} title="Delete catalog" color="var(--color-status-error)" onClick={(e) => { e.stopPropagation(); onAction('delete', catalog) }} />
        </div>
      </div>
    </div>
  )
}

function CatalogRow({
  catalog,
  onAction,
}: {
  catalog: Catalog
  onAction: (action: 'view' | 'edit' | 'delete' | 'toggle', catalog: Catalog) => void
}) {
  const isAgent = catalog.catalogType === 'AGENT_SETUP'
  const count = memberCount(catalog)
  const masterCategory = (catalog as any).standardCategory?.name

  return (
    <div
      className="flex items-center rounded-xl overflow-hidden transition-all duration-200 cursor-pointer group hover:-translate-y-0.5 active:scale-[0.99]"
      style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)', padding: '0 4px 0 0', gap: 12, minHeight: 56 }}
      onClick={() => onAction('view', catalog)}
    >
      <div className="flex items-center self-stretch justify-center shrink-0" style={{ width: 48, background: isAgent ? 'rgba(159,122,234,0.12)' : (catalog.isActive ? 'rgba(99,179,237,0.12)' : 'var(--theme-bg-subtle)') }}>
        {isAgent ? <Bot size={20} style={{ color: 'var(--color-secondary-50)' }} /> : <BookOpen size={20} style={{ color: catalog.isActive ? 'var(--color-primary-50)' : 'var(--theme-text-muted)' }} />}
      </div>
      <div className="flex flex-col justify-center flex-1 min-w-0" style={{ padding: '8px 0' }}>
        <div className="text-[13px] font-semibold truncate" style={{ color: 'var(--theme-text)', lineHeight: 1.4 }}>{catalog.name}</div>
        {catalog.description && <div className="truncate" style={{ fontSize: 11, color: 'var(--theme-text-muted)', lineHeight: 1.4 }}>{catalog.description}</div>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0 self-center">
        <TypeChip type={catalog.catalogType ?? 'PRODUCT'} />
        <div className="flex items-center gap-1" style={{ padding: '2px 8px', borderRadius: 6, background: isAgent ? 'rgba(159,122,234,0.10)' : 'rgba(99,179,237,0.10)', fontSize: 11, fontWeight: 700, color: isAgent ? 'var(--color-secondary-50)' : 'var(--color-primary-50)', whiteSpace: 'nowrap' as const }}>
          <FolderTree size={10} /> {count}
        </div>
        {!isAgent && (
          <div className="shrink-0" style={{ padding: '2px 8px', borderRadius: 6, background: catalog.isActive ? 'rgba(72,187,120,0.12)' : 'rgba(113,128,150,0.10)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.04em', color: catalog.isActive ? 'var(--color-status-success)' : 'var(--color-neutral-5)' }}>
            {catalog.isActive ? 'Active' : 'Inactive'}
          </div>
        )}
        {!isAgent && masterCategory && <div className="hidden sm:block shrink-0" style={{ padding: '2px 8px', borderRadius: 6, background: 'var(--theme-bg-subtle)', fontSize: 10, fontWeight: 600, color: 'var(--theme-text-muted)' }}>{masterCategory}</div>}
      </div>
      <div className="flex items-center gap-1 shrink-0 self-center">
        <ActionButton icon={<Pencil size={14} />} title="Edit" onClick={(e) => { e.stopPropagation(); onAction('edit', catalog) }} />
        {!isAgent && (
          <ActionButton icon={<EyeOff size={14} />} title={catalog.isActive ? 'Deactivate' : 'Activate'} color={catalog.isActive ? 'var(--color-warning-primary)' : 'var(--color-status-success)'} onClick={(e) => { e.stopPropagation(); onAction('toggle', catalog) }} />
        )}
        <ActionButton icon={<Trash2 size={14} />} title="Delete" color="var(--color-status-error)" onClick={(e) => { e.stopPropagation(); onAction('delete', catalog) }} />
      </div>
    </div>
  )
}

function ProductListRow({
  product,
  onDelete,
}: {
  product: any
  onDelete: () => void
}) {
  const navigate = useNavigate()
  const isService = product.standardCategory?.offerType === 'SERVICE'
  const rawImages = product.images
  const images: string[] = Array.isArray(rawImages)
    ? rawImages
    : rawImages ? (() => { try { return JSON.parse(rawImages) } catch { return [] } })() : []
  const linkedOfferId = product.offers?.[0]?.id

  return (
    <div
      className="flex items-stretch rounded-xl overflow-hidden transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.99]"
      style={{
        background: 'var(--theme-surface)',
        outline: '1px solid var(--theme-border)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)',
        minHeight: 72,
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

      <div className="flex flex-col justify-center flex-1 min-w-0" style={{ padding: '10px 12px' }}>
        <div
          style={{
            fontSize: 10, fontWeight: 600, color: 'var(--theme-text-muted)',
            textTransform: 'uppercase' as const, letterSpacing: '0.04em',
            whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis',
            marginBottom: 2,
          }}
        >
          {isService
            ? <Briefcase size={10} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 3, opacity: 0.7 }} />
            : <Package size={10} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 3, opacity: 0.7 }} />}
          {product.standardCategory?.name || 'Product'}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4, color: 'var(--theme-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
          {product.name}
        </div>
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
        {linkedOfferId && (
          <ActionButton
            icon={<Pencil size={14} />}
            title="Edit listing"
            onClick={(e) => { e.stopPropagation(); navigate(`/sell/listings/${linkedOfferId}`) }}
          />
        )}
        <ActionButton
          icon={<Trash2 size={14} />}
          title="Delete product"
          color="var(--color-status-error)"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
        />
      </div>
    </div>
  )
}

export function CatalogsTab({ pubkey, onKpiChange, headerPrefix }: SellTabProps) {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const { data: catalogData, isLoading: loading } = useUserCatalogs(pubkey)
  const catalogs: Catalog[] = catalogData?.catalogs ?? []
  const company = catalogData?.company ?? null
  // ADR-368 D3: PRODUCT-only pool — AGENT_SETUP catalogs are managed from the
  // Cooperate stack tab and are excluded from this surface entirely.
  const productCatalogs = useMemo(
    () => catalogs.filter(c => (c.catalogType ?? 'PRODUCT') === 'PRODUCT'),
    [catalogs],
  )

  const [deleteConfirm, setDeleteConfirm] = useState<Catalog | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editCatalog, setEditCatalog] = useState<Catalog | null>(null)

  const [expandedCatalogs, setExpandedCatalogs] = useState<Set<string>>(new Set())
  const [addingProductFor, setAddingProductFor] = useState<string | null>(null)
  // ADR-368 D3: single (product) axis — agent catalogs moved to the Cooperate
  // Manage stack tab's `?view=catalogs` mode.
  const filterTab: FilterTab = 'product'

  const { setActions: setFABActions, clear: clearFAB } = useFABActions()
  const { data: categories = [] } = useStandardCategories()
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState('')

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['user-catalogs', pubkey] })
    queryClient.invalidateQueries({ queryKey: ['catalogs', 'mine'] })
    queryClient.invalidateQueries({ queryKey: ['agent-catalogs'] })
  }

  useEffect(() => {
    if (searchParams.get('create') === 'catalog') {
      setCreateOpen(true)
      setSearchParams(p => { p.delete('create'); return p }, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredItems = useMemo(() => {
    let filtered = productCatalogs
    if (selectedCategory) {
      filtered = filtered.filter(c => (c as any).standardCategory?.slug?.startsWith(selectedCategory))
    }
    return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [productCatalogs, selectedCategory])

  const kpiItems = useMemo<KPIItem[]>(() => {
    const totalProducts = productCatalogs.reduce((sum, c) => sum + (c.products?.length ?? 0), 0)
    // ADR-368 D3: one axis — product catalogs (agent catalogs moved to the
    // Cooperate Manage stack). Active/Inactive counts product catalogs only.
    return [
      { icon: <Tag size={14} />, value: categories.filter(c => c.level === 1).length, label: 'Categories', onClick: () => setCategoryOpen(v => !v), active: categoryOpen, heading: 'Browse' },
      { icon: <BookOpen size={14} />, value: productCatalogs.length, label: 'Catalogs' },
      { icon: <FolderTree size={14} />, value: totalProducts, label: 'Products' },
      { icon: <Check size={14} />, value: productCatalogs.filter(c => c.isActive).length, label: 'Active', separator: true },
    ]
  }, [productCatalogs, categories, categoryOpen])

  useEffect(() => {
    onKpiChange(kpiItems, loading)
  }, [onKpiChange, kpiItems, loading])

  useEffect(() => {
    setFABActions([{
      id: 'create-catalog',
      label: 'Catalog',
      info: company ? 'New product catalog' : 'Product catalogs require a company profile',
      group: 'Create',
      onClick: () => setCreateOpen(true),
    }])
    return () => clearFAB()
  }, [setFABActions, clearFAB, company])

  function handleAction(action: 'view' | 'edit' | 'delete' | 'toggle', catalog: Catalog) {
    if (action === 'view') { toggleExpanded(catalog.id); return }
    if (action === 'edit') { setEditCatalog(catalog); return }
    if (action === 'delete') { setDeleteConfirm(catalog); return }
    if (action === 'toggle' && catalog.catalogType !== 'AGENT_SETUP') {
      apiCall(`/api/catalog/${catalog.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: catalog.name, description: catalog.description, isActive: !catalog.isActive }),
      }).then(() => invalidate()).catch(console.error)
      return
    }
  }

  async function confirmDelete() {
    if (!deleteConfirm) return
    try {
      await apiCall(`/api/catalog/${deleteConfirm.id}`, { method: 'DELETE' })
      setDeleteConfirm(null)
      invalidate()
    } catch (error) {
      console.error('Failed to delete catalog:', error)
    }
  }

  function handleCreateCatalog() {
    setCreateOpen(false)
    invalidate()
  }

  function handleEditSaved() {
    setEditCatalog(null)
    invalidate()
  }

  function handleAssignProduct(_catalogId: string, _product: { id: string; name: string }) {
    setAddingProductFor(null)
    invalidate()
  }

  async function handleDeleteProduct(_catalogId: string, productId: string) {
    try {
      await apiCall(`/api/catalog/products/${productId}`, { method: 'DELETE' })
      invalidate()
    } catch (error) {
      console.error('Failed to delete product:', error)
    }
  }

  function toggleExpanded(catalogId: string) {
    setExpandedCatalogs(prev => {
      const next = new Set(prev)
      if (next.has(catalogId)) next.delete(catalogId)
      else next.add(catalogId)
      return next
    })
  }

  return (
    <>
      <ListBrowser
        items={filteredItems}
        loading={loading}
        headerPrefix={headerPrefix}
        filterTabs={[
          { key: 'product', label: 'Products' },
        ]}
        activeFilterTab={filterTab}
        onFilterTabChange={() => {}}
        forcedViewMode="list"
        categories={categories}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        searchQuery=""
        onSearchQueryChange={() => {}}
        categoryOpen={categoryOpen}
        onCategoryOpenChange={setCategoryOpen}
        defaultPanelMode="top"
        renderCard={(catalog, size) => {
          const expandCount = catalog.products?.length ?? 0
          return (
            <div key={catalog.id}>
              {size === 'L' ? (
                <CatalogCard catalog={catalog} onAction={handleAction} />
              ) : (
                <CatalogRow catalog={catalog} onAction={handleAction} />
              )}
              <div className="mt-2 ml-14">
                <button
                  onClick={() => toggleExpanded(catalog.id)}
                  className="flex items-center gap-2 px-3 py-1.5 text-[12px] font-medium cursor-pointer transition-all duration-200 hover:opacity-80"
                  style={{ color: 'var(--color-primary-50)' }}
                >
                  <ChevronRight
                    size={12}
                    className="transition-transform duration-200"
                    style={{ transform: expandedCatalogs.has(catalog.id) ? 'rotate(90deg)' : 'rotate(0deg)' }}
                  />
                  {expandCount} {expandCount === 1 ? 'Product' : 'Products'}
                </button>
                {expandedCatalogs.has(catalog.id) && (
                  <div className="flex flex-col gap-1.5 mt-2">
                    <>
                      {company?.id && addingProductFor === catalog.id ? (
                        <ProductPicker
                          companyId={company.id}
                          catalogId={catalog.id}
                          catalogCategorySlug={(catalog as any).standardCategory?.slug}
                          excludeIds={(catalog.products || []).map((p: any) => p.id)}
                          onAssigned={(p) => handleAssignProduct(catalog.id, p)}
                          onCancel={() => setAddingProductFor(null)}
                        />
                      ) : company?.id ? (
                        <button
                          onClick={() => setAddingProductFor(catalog.id)}
                          className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[11px] font-medium cursor-pointer transition-all duration-150 hover:opacity-80"
                          style={{ background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.20)', color: 'var(--color-primary-50)' }}
                        >
                          <Plus size={12} /> Add Product
                        </button>
                      ) : null}
                      {(catalog.products || []).map((product: any) => (
                        <ProductListRow
                          key={product.id}
                          product={product}
                          onDelete={() => handleDeleteProduct(catalog.id, product.id)}
                        />
                      ))}
                      {(catalog.products || []).length === 0 && addingProductFor !== catalog.id && (
                        <p className="text-[12px] text-center py-3" style={{ color: 'var(--theme-text-muted)' }}>No products yet.</p>
                      )}
                    </>
                  </div>
                )}
              </div>
            </div>
          )
        }}
        cardKey={(catalog) => catalog.id}
        emptyState={
          <EmptyStateGuide
            icon={<BookOpen size={26} />}
            accent="var(--color-primary-50)"
            accentSoft="rgba(99,179,237,0.12)"
            title="No catalogs yet"
            intro={company?.isActive
              ? 'Product catalogs organize your offerings into structured groups. Each catalog maps to a master category and lets you keep things tidy as you grow.'
              : company
                ? 'Product catalogs organize your offerings into structured groups — but your company profile is currently inactive. Reactivate it under Sell > Company to create and publish product catalogs.'
                : 'Product catalogs require an active company profile (the public identity buyers see and trust).'}
            features={[
              { icon: <Layers size={16} />, title: 'Product Catalogs', text: 'Company-scoped groups for your goods. Map each catalog to a master category so the marketplace can place and filter it correctly.', color: 'var(--color-primary-50)', bg: 'rgba(232,69,65,0.10)' },
              { icon: <Network size={16} />, title: 'Master Category', text: 'Map each catalog to the standard category taxonomy (root → sub → detail) so the marketplace can place and filter it correctly.', color: 'var(--color-primary-50)', bg: 'rgba(232,69,65,0.10)' },
              { icon: <ToggleLeft size={16} />, title: 'Active / Inactive', text: 'Draft a catalog privately, then flip it Active to publish. Deactivate anytime without deleting — nothing is lost.', color: 'var(--color-status-success)', bg: 'rgba(72,187,120,0.12)' },
              { icon: <Repeat size={16} />, title: 'Reuse Products', text: 'A single product lives in one catalog at a time. Move it as your storefront evolves.', color: 'var(--color-accent-primary)', bg: 'rgba(245,166,35,0.12)' },
              { icon: <FolderTree size={16} />, title: 'Expandable Lists', text: 'Each catalog row expands to show and manage its members inline — assign, rename, or remove them without leaving the page.', color: 'var(--color-info-primary)', bg: 'rgba(56,189,248,0.12)' },
              { icon: <Package size={16} />, title: 'Nostr Sync', text: 'Catalogs publish to Nostr relays, keeping your inventory decentralized, portable, and discoverable without a central server.', color: 'var(--color-secondary-50)', bg: 'rgba(159,122,234,0.08)' },
            ]}
            helpLinks={[
              { label: 'Create catalogs', to: '/help/selling#sell-3' },
              { label: 'List products', to: '/help/selling#sell-4' },
              { label: 'Selling guide', to: '/help/selling' },
            ]}
            ctaLabel="Create Catalog"
            onCta={() => setCreateOpen(true)}
          />
        }
        storageKeyPrefix="sellCatalogs"
      />

      {createOpen && <CreateCatalogModal companyId={company?.id ?? null} defaultType="PRODUCT" onClose={() => setCreateOpen(false)} onCreated={handleCreateCatalog} />}
      {editCatalog && <EditCatalogModal catalog={editCatalog} onClose={() => setEditCatalog(null)} onSaved={handleEditSaved} />}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-sm p-5 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
            <h3 className="text-[16px] font-semibold mb-2" style={{ color: 'var(--theme-text)' }}>Delete Catalog?</h3>
            <p className="text-[13px] mb-4" style={{ color: 'var(--theme-text-muted)' }}>
              This will permanently delete &quot;{deleteConfirm.name}&quot; and all its products. This action cannot be undone.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 cursor-pointer hover:opacity-90" style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text)' }}>Cancel</button>
              <button onClick={confirmDelete} className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 cursor-pointer hover:opacity-90" style={{ background: 'var(--color-status-error)', color: 'white' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
