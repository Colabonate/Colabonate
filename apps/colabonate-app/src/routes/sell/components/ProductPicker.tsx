import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, X, Check, Zap, Briefcase, Package } from 'lucide-react'
import { IconButton, Autocomplete, TextField, CircularProgress, Box, Typography } from '@mui/material'
import { apiCall } from '../../../lib/api'
import { formatSats } from '../../../lib/currency'

export function ProductPicker({
  companyId,
  catalogId,
  catalogCategorySlug,
  excludeIds = [],
  onAssigned,
  onCancel,
}: {
  companyId: string
  catalogId: string
  catalogCategorySlug?: string
  excludeIds?: string[]
  onAssigned: (product: { id: string; name: string }) => void
  onCancel: () => void
}) {
  const navigate = useNavigate()
  const [allProducts, setAllProducts] = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)
  const [catalogLabel, setCatalogLabel] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      try {
        const res = await apiCall(`/api/catalog/company/${companyId}/products`)
        const data = await res.json()
        if (!cancelled && data.products) {
          setAllProducts(data.products)
        }
      } catch {
        if (!cancelled) setAllProducts([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetch()
    return () => { cancelled = true }
  }, [companyId])

  const filteredProducts = useMemo(() => {
    const exclude = new Set(excludeIds)
    let products = allProducts.filter(p => !exclude.has(p.id))
    if (catalogCategorySlug) {
      products = products.filter(p =>
        p.standardCategory?.slug?.startsWith(catalogCategorySlug),
      )
    }
    return products
  }, [allProducts, catalogCategorySlug, excludeIds])

  async function handleAssign() {
    if (!selected) return
    setAssigning(true)
    try {
      const res = await apiCall(`/api/catalog/${catalogId}/products/assign`, {
        method: 'POST',
        body: JSON.stringify({ productId: selected.id, catalogLabel: catalogLabel.trim() || undefined }),
      })
      const data = await res.json()
      if (data.product) onAssigned(data.product)
    } catch (error) {
      console.error('Failed to assign product:', error)
    } finally {
      setAssigning(false)
    }
  }

  return (
    <Box
      sx={{
        display: 'flex', flexDirection: 'column', gap: 2.5, p: 2.5, borderRadius: 2,
        background: 'var(--theme-surface)', border: '1px solid var(--theme-border)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Package size={15} style={{ color: 'var(--color-primary-50)' }} />
          <Typography variant="body2" fontWeight={600}>Add Product to Catalog</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <button
              onClick={() => navigate(`/offers/new?type=PRODUCT&context=corporate&catalogId=${encodeURIComponent(catalogId)}`)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-150 cursor-pointer hover:opacity-80"
              style={{ background: 'var(--color-primary-50)', color: 'white' }}
            >
              <Plus size={12} /> New Product
            </button>
            <IconButton onClick={onCancel} size="small" sx={{ width: 28, height: 28, background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)', '&:hover': { opacity: 0.8 } }}>
              <X size={13} />
            </IconButton>
          </Box>
      </Box>

      <Autocomplete<any, false, undefined, true>
        options={filteredProducts}
        getOptionLabel={(option) => option.name}
        getOptionKey={(option) => option.id}
        value={selected}
        onChange={(_, value) => { setSelected(value); setCatalogLabel('') }}
        loading={loading}
        isOptionEqualToValue={(option, value) => option.id === value.id}
        size="small"
        renderInput={(params) => (
          <TextField
            {...params}
            label={catalogCategorySlug ? 'Select product from category' : 'Select product'}
            placeholder="Type to search…"
            slotProps={{
              input: {
                ...params.InputProps,
                endAdornment: (
                  <>
                    {loading ? <CircularProgress color="inherit" size={16} /> : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              },
            }}
          />
        )}
        renderOption={(props, option) => (
          <li {...props} key={option.id}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%', py: 0.5 }}>
              <Box sx={{
                width: 28, height: 28, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                background: option.standardCategory?.offerType === 'SERVICE' ? 'rgba(99,179,237,0.12)' : 'rgba(72,187,120,0.12)',
              }}>
                {option.standardCategory?.offerType === 'SERVICE'
                  ? <Briefcase size={12} style={{ color: 'var(--color-primary-50)' }} />
                  : <Package size={12} style={{ color: 'var(--color-status-success)' }} />}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600} noWrap>{option.name}</Typography>
                <Typography variant="caption" color="text.secondary" component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {option.standardCategory?.name && <span>{option.standardCategory.name}</span>}
                  {option.priceSats != null && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Zap size={9} /> {formatSats(option.priceSats, { compact: false })}
                    </span>
                  )}
                  {option.catalog?.name && (
                    <span style={{ opacity: 0.6 }}>from {option.catalog.name}</span>
                  )}
                </Typography>
              </Box>
            </Box>
          </li>
        )}
        noOptionsText={allProducts.length === 0 ? 'No products created yet' : 'No matching products'}
        sx={{
          '& .MuiOutlinedInput-root': {
            borderRadius: 1.5,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--theme-border)' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--theme-border)' },
          },
        }}
      />

      {selected && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pt: 0.5, borderTop: '1px solid var(--theme-border)' }}>
          <TextField
            size="small"
            value={catalogLabel}
            onChange={(e) => setCatalogLabel(e.target.value)}
            placeholder={`Display name (default: "${selected.name}")`}
            fullWidth
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 1.5,
                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--theme-border)' },
                fontSize: 12,
              },
            }}
          />
          <button
            onClick={handleAssign}
            disabled={assigning}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold transition-all duration-150 cursor-pointer hover:opacity-90 shrink-0"
            style={{ background: 'var(--color-primary-50)', color: 'white' }}
          >
            {assigning ? <span className="inline-block w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" /> : <Check size={13} />}
            {assigning ? 'Assigning…' : 'Assign'}
          </button>
        </Box>
      )}

      {!selected && catalogCategorySlug && (
        <Typography variant="caption" color="text.secondary" sx={{ opacity: 0.7 }}>
          Showing products from category matching this catalog's master category.
        </Typography>
      )}
    </Box>
  )
}
