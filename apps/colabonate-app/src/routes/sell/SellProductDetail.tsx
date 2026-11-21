import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Package, Save, Trash2, AlertCircle, Plus, X, Check } from 'lucide-react'
import { Box, Typography, FormControl, InputLabel, MenuItem, Select, TextField } from '@mui/material'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { apiCall } from '../../lib/api'
import { RichDescriptionEditor, richTextToPlainText } from '../../components/offers'
import { SatsAmountInput } from '../../components/currency/SatsAmountInput'
import { usePageAnimation } from '../../hooks/usePageAnimation'
import { useStandardCategoryTree } from './components/useStandardCategoryTree'
import type { Product } from '../../types/api'

export function SellProductDetail() {
  const { catalogId, productId } = useParams<{ catalogId: string; productId: string }>()
  const navigate = useNavigate()
  const pageRef = usePageAnimation([
    { selector: '.detail-animate', from: { duration: 0.5, stagger: 0.1, y: 20 } },
  ])

  const isNew = !productId || productId === 'new'

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [priceSats, setPriceSats] = useState('')
  const [sku, setSku] = useState('')
  const [stock, setStock] = useState('')
  const [isAvailable, setIsAvailable] = useState(true)
  const [images, setImages] = useState<string[]>([])
  const [imageUrl, setImageUrl] = useState('')
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')

  const cat = useStandardCategoryTree()

  // Load existing product in edit mode.
  useEffect(() => {
    if (isNew) return
    let cancelled = false
    async function load() {
      try {
        const res = await apiCall(`/api/catalog/products/${productId}`)
        const data = await res.json()
        if (cancelled || !data.product) return
        const p: Product = data.product
        setName(p.name)
        setDescription(p.description || '')
        setPriceSats(String(p.priceSats ?? ''))
        setSku(p.sku || '')
        setStock(p.stock != null ? String(p.stock) : '')
        setIsAvailable(p.isAvailable)
        const imgs: string[] = Array.isArray(p.images)
          ? p.images
          : p.images ? (() => { try { return JSON.parse(p.images) } catch { return [] } })() : []
        if (!cancelled) setImages(imgs)
      } catch (e) {
        console.error('Failed to load product:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [isNew, productId])

  function addImage() {
    const url = imageUrl.trim()
    if (!url) return
    setImages(prev => prev.includes(url) ? prev : [...prev, url])
    setImageUrl('')
  }
  function removeImage(url: string) {
    setImages(prev => prev.filter(u => u !== url))
  }

  const canSave = name.trim() && priceSats !== '' && cat.selectedCategoryId

  async function handleSave() {
    // Creating needs a target catalog; editing works for catalog-less products (ADR-395).
    if (isNew && !catalogId) return
    if (!name.trim()) { setError('Name is required'); return }
    if (priceSats === '') { setError('Price is required'); return }
    if (!cat.selectedCategoryId) { setError('Master category is required'); return }
    setSaving(true)
    setError('')
    const body = {
      name: name.trim(),
      description: richTextToPlainText(description).trim() ? description.trim() : undefined,
      standardCategoryId: cat.selectedCategoryId,
      priceSats: Number(priceSats),
      sku: sku.trim() || undefined,
      stock: stock !== '' ? Number(stock) : undefined,
      isAvailable,
      images,
    }
    try {
      if (isNew) {
        const res = await apiCall(`/api/catalog/${catalogId}/products`, {
          method: 'POST', body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to create product')
      } else {
        const res = await apiCall(`/api/catalog/products/${productId}`, {
          method: 'PATCH', body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to update product')
      }
      navigate('/sell/listings?tab=products')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await apiCall(`/api/catalog/products/${productId}`, { method: 'DELETE' })
      navigate('/sell/listings?tab=products')
    } catch (e) {
      console.error('Failed to delete product:', e)
      setError('Failed to delete product')
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const fieldStyle = {
    '& .MuiOutlinedInput-root': {
      borderRadius: 1.5,
      '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--theme-border)' },
    },
  }

  if (loading) {
    return (
      <PageContainer size="narrow" spacing="lg">
        <PageHeader icon={<Package size={18} />} title={isNew ? 'New Product' : 'Edit Product'} onBack={() => navigate('/sell/listings?tab=products')} />
        <div className="flex items-center justify-center min-h-[40vh]">
          <div className="w-10 h-10 rounded-full border-4 animate-spin" style={{ borderColor: 'var(--color-primary-50) transparent var(--color-primary-50) transparent' }} />
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer size="narrow" spacing="lg" ref={pageRef}>
      <PageHeader
        icon={<Package size={18} />}
        title={isNew ? 'New Product' : 'Edit Product'}
        subtitle="A reusable offering assigned to this catalog"
        onBack={() => navigate('/sell/listings?tab=products')}
      />

      <div className="detail-animate flex flex-col gap-5">
        {/* Identity */}
        <section className="flex flex-col gap-4 p-5 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: 'var(--theme-text)' }}>Basics</Typography>

          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--theme-text-muted)' }}>Name *</label>
            <TextField
              fullWidth size="small" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Organic Coffee 250g"
              autoFocus sx={fieldStyle}
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--theme-text-muted)' }}>Description</label>
            {/* ADR-295: WYSIWYG description editor + AI assist */}
            <RichDescriptionEditor
              value={description}
              onChange={setDescription}
              aiContext={{
                title: name,
                offerType: 'PRODUCT',
              }}
            />
          </div>

          {/* Master category cascade */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="body2" fontWeight={600} color="text.secondary">Master Category *</Typography>
            <FormControl fullWidth size="small">
              <InputLabel>Root Category (Level 1)</InputLabel>
              <Select value={cat.activeL1Slug} label="Root Category (Level 1)" onChange={e => cat.handleL1Change(e.target.value)}>
                <MenuItem value=""><em>None</em></MenuItem>
                {cat.l1Options.map(c => <MenuItem key={c.id} value={c.slug}>{c.name}</MenuItem>)}
              </Select>
            </FormControl>
            {cat.l2Options.length > 0 && (
              <FormControl fullWidth size="small">
                <InputLabel>Subcategory (Level 2)</InputLabel>
                <Select value={cat.activeL2Slug} label="Subcategory (Level 2)" onChange={e => cat.handleL2Change(e.target.value)}>
                  <MenuItem value=""><em>None</em></MenuItem>
                  {cat.l2Options.map(c => <MenuItem key={c.id} value={c.slug}>{'\u00A0\u00A0'}{c.name}</MenuItem>)}
                </Select>
              </FormControl>
            )}
            {cat.l3Options.length > 0 && (
              <FormControl fullWidth size="small">
                <InputLabel>Detail Category (Level 3)</InputLabel>
                <Select
                  value={cat.l3Options.some(c => c.slug === cat.selectedSlug) ? cat.selectedSlug : ''}
                  label="Detail Category (Level 3)" onChange={e => cat.handleL3Change(e.target.value)}
                >
                  <MenuItem value=""><em>None</em></MenuItem>
                  {cat.l3Options.map(c => <MenuItem key={c.id} value={c.slug}>{'\u00A0\u00A0\u00A0\u00A0'}{c.name}</MenuItem>)}
                </Select>
              </FormControl>
            )}
          </Box>
        </section>

        {/* Pricing & inventory */}
        <section className="flex flex-col gap-4 p-5 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: 'var(--theme-text)' }}>Pricing &amp; Inventory</Typography>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--theme-text-muted)' }}>Price *</label>
              <SatsAmountInput
                label=""
                size="small"
                valueSats={priceSats === '' ? '' : Number(priceSats)}
                onChangeSats={(sats) => setPriceSats(sats === '' ? '' : String(sats))}
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--theme-text-muted)' }}>Stock</label>
              <TextField
                fullWidth size="small" type="number" value={stock} onChange={e => setStock(e.target.value)}
                placeholder="Optional" sx={fieldStyle}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--theme-text-muted)' }}>SKU</label>
              <TextField
                fullWidth size="small" value={sku} onChange={e => setSku(e.target.value)}
                placeholder="Optional internal SKU" sx={fieldStyle}
              />
            </div>
          </div>

          {/* Availability toggle */}
          <label className="flex items-center gap-3 cursor-pointer" style={{ color: 'var(--theme-text)' }}>
            <button
              type="button" onClick={() => setIsAvailable(a => !a)}
              className="relative inline-flex h-6 w-11 cursor-pointer rounded-full transition-colors"
              style={{ background: isAvailable ? 'var(--color-status-success)' : 'var(--theme-border)' }}
              aria-label="Toggle availability"
            >
              <span
                className="inline-block h-5 w-5 transform rounded-full bg-white transition-transform self-center"
                style={{ transform: isAvailable ? 'translateX(22px)' : 'translateX(2px)' }}
              />
            </button>
            <span className="text-[13px] font-medium">Available for sale</span>
            {isAvailable
              ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider" style={{ background: 'rgba(72,187,120,0.12)', color: 'var(--color-status-success)' }}><Check size={10} /> Active</span>
              : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider" style={{ background: 'rgba(113,128,150,0.12)', color: 'var(--color-neutral-5)' }}>Hidden</span>}
          </label>
        </section>

        {/* Images */}
        <section className="flex flex-col gap-3 p-5 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ color: 'var(--theme-text)' }}>Images</Typography>
          <div className="flex gap-2">
            <TextField
              fullWidth size="small" value={imageUrl} onChange={e => setImageUrl(e.target.value)}
              placeholder="Paste an image URL and press Add" sx={fieldStyle}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addImage() } }}
            />
            <button
              type="button" onClick={addImage} disabled={!imageUrl.trim()}
              className="inline-flex items-center gap-1.5 px-3 rounded-lg text-[12px] font-semibold shrink-0 cursor-pointer transition-opacity hover:opacity-90"
              style={{ background: imageUrl.trim() ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)', color: imageUrl.trim() ? 'white' : 'var(--theme-text-muted)', border: '1px solid var(--theme-border)' }}
            >
              <Plus size={13} /> Add
            </button>
          </div>
          {images.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {images.map(url => (
                <div key={url} className="relative group rounded-lg overflow-hidden" style={{ aspectRatio: '1', background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button" onClick={() => removeImage(url)}
                    className="absolute top-1 right-1 flex items-center justify-center w-6 h-6 rounded-full cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none' }}
                    aria-label="Remove image"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg text-[12px]" style={{ background: 'rgba(232,69,65,0.10)', color: 'var(--color-status-error)', border: '1px solid rgba(232,69,65,0.25)' }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleSave} disabled={!canSave || saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold transition-all duration-200 cursor-pointer hover:opacity-90"
            style={{ background: canSave ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)', color: canSave ? 'white' : 'var(--theme-text-muted)', opacity: canSave ? 1 : 0.6 }}
          >
            <Save size={15} /> {saving ? 'Saving…' : isNew ? 'Create Product' : 'Save Changes'}
          </button>
          {!isNew && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 cursor-pointer hover:opacity-90"
              style={{ background: 'var(--theme-bg-subtle)', color: 'var(--color-status-error)', border: '1px solid var(--theme-border)' }}
            >
              <Trash2 size={15} /> Delete
            </button>
          )}
        </div>
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--theme-scrim-bg)', backdropFilter: 'blur(var(--theme-scrim-blur))', WebkitBackdropFilter: 'blur(var(--theme-scrim-blur))' }}>
          <div className="w-full max-w-sm p-5 rounded-xl" style={{ background: 'var(--theme-glass-bg)', backdropFilter: 'blur(var(--theme-glass-blur))', WebkitBackdropFilter: 'blur(var(--theme-glass-blur))', border: '1px solid var(--theme-glass-border)', boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}>
            <h3 className="text-[16px] font-semibold mb-2" style={{ color: 'var(--theme-text)' }}>Delete Product?</h3>
            <p className="text-[13px] mb-4" style={{ color: 'var(--theme-text-muted)' }}>This permanently deletes &quot;{name}&quot; and its linked listing. This cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(false)} className="flex-1 py-2.5 rounded-lg text-[13px] font-medium cursor-pointer hover:opacity-90" style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text)' }}>Cancel</button>
              <button onClick={handleDelete} disabled={deleting} className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold cursor-pointer hover:opacity-90" style={{ background: 'var(--color-status-error)', color: 'white' }}>{deleting ? 'Deleting…' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  )
}
