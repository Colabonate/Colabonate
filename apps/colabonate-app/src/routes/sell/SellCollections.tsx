// ADR-277 E2: Gamma Product Collection (Kind 30405) management. A collection
// groups Products and unions in Shipping Options (D5 union-merge, ADR-172).
// D10: publishing requires every member product to have a resolvable ACTIVE
// offer — a collection with zero resolvable refs is skipped on the wire, not
// an error (handled server-side in publishAndSyncCollection).
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Boxes, Plus, Pencil, Trash2, AlertCircle, EyeOff, Eye, Package, Truck,
} from 'lucide-react'
import {
  Tooltip, IconButton, TextField, CircularProgress, Box, Typography,
  Paper, Grid, Button, Autocomplete, Chip,
} from '@mui/material'
import { PageContainer } from '@ds/ui'
import { apiCall } from '../../lib/api'
import { PageHeader } from '../../components/PageHeader'
import { useCompanyProducts } from '../../hooks/useEntityQueries'
import type { Company, ProductCollection, ShippingOption } from '../../types/api'

interface CollectionFormData {
  title: string
  summary: string
  image: string
  productIds: string[]
  shippingOptionIds: string[]
}

const DEFAULT_FORM_DATA: CollectionFormData = {
  title: '',
  summary: '',
  image: '',
  productIds: [],
  shippingOptionIds: [],
}

export function SellCollections() {
  const navigate = useNavigate()
  const [collections, setCollections] = useState<ProductCollection[]>([])
  const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>([])
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<CollectionFormData>(DEFAULT_FORM_DATA)

  const userPubkey = localStorage.getItem('pubkey')
  const { data: productData, isLoading: productsLoading } = useCompanyProducts(userPubkey ?? '')
  const products = productData?.products ?? []

  useEffect(() => {
    if (!userPubkey) {
      navigate('/login')
      return
    }
    fetchData()
  }, [userPubkey])

  async function fetchData() {
    setLoading(true)
    try {
      const companyRes = await apiCall(`/api/company/${userPubkey}`)
      const companyData = await companyRes.json()
      const resolvedCompany = Array.isArray(companyData.company) ? companyData.company[0] : companyData.company
      setCompany(resolvedCompany ?? null)

      if (resolvedCompany?.id) {
        const [collRes, shipRes] = await Promise.all([
          apiCall(`/api/collections/company/${resolvedCompany.id}`),
          apiCall(`/api/shipping-options/company/${resolvedCompany.id}`),
        ])
        const collData = await collRes.json()
        const shipData = await shipRes.json()
        setCollections(collData.collections || [])
        setShippingOptions((shipData.shippingOptions || []).filter((o: ShippingOption) => o.isActive))
      } else {
        setCollections([])
        setShippingOptions([])
      }
    } catch (err) {
      console.error('Failed to fetch collections:', err)
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const productOptions = useMemo(
    () => products.map(p => ({ id: p.id, name: p.name })),
    [products],
  )
  const selectedProducts = useMemo(
    () => formData.productIds.map(id => productOptions.find(p => p.id === id)).filter((p): p is { id: string; name: string } => Boolean(p)),
    [formData.productIds, productOptions],
  )
  const selectedShippingOptions = useMemo(
    () => formData.shippingOptionIds.map(id => shippingOptions.find(o => o.id === id)).filter((o): o is ShippingOption => Boolean(o)),
    [formData.shippingOptionIds, shippingOptions],
  )

  function validate(): string | null {
    if (!formData.title.trim()) return 'Title is required'
    if (formData.productIds.length === 0) return 'At least one product is required — Gamma collections cannot be empty (D10)'
    return null
  }

  async function handleSave() {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setSaving(true)
    setError(null)

    const payload = {
      title: formData.title.trim(),
      summary: formData.summary.trim() || undefined,
      image: formData.image.trim() || undefined,
      productIds: formData.productIds,
      shippingOptionIds: formData.shippingOptionIds,
    }

    try {
      if (editingId) {
        await apiCall(`/api/collections/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
      } else if (company?.id) {
        await apiCall('/api/collections', {
          method: 'POST',
          body: JSON.stringify({ ...payload, companyId: company.id, d: crypto.randomUUID() }),
        })
      }

      setShowForm(false)
      setEditingId(null)
      setFormData(DEFAULT_FORM_DATA)
      fetchData()
    } catch (err) {
      console.error('Failed to save collection:', err)
      setError('Failed to save collection')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this collection?')) return
    try {
      await apiCall(`/api/collections/${id}`, { method: 'DELETE' })
      fetchData()
    } catch (err) {
      console.error('Failed to delete collection:', err)
      setError('Failed to delete collection')
    }
  }

  async function handleToggleActive(collection: ProductCollection) {
    try {
      await apiCall(`/api/collections/${collection.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !collection.isActive }),
      })
      fetchData()
    } catch (err) {
      console.error('Failed to toggle collection:', err)
      setError('Failed to update collection')
    }
  }

  function handleEdit(collection: ProductCollection) {
    setFormData({
      title: collection.title,
      summary: collection.summary || '',
      image: collection.image || '',
      productIds: collection.products.map(m => m.productId),
      shippingOptionIds: collection.shippingOptions.map(s => s.shippingOptionId),
    })
    setEditingId(collection.id)
    setShowForm(true)
  }

  function handleCancel() {
    setShowForm(false)
    setEditingId(null)
    setFormData(DEFAULT_FORM_DATA)
    setError(null)
  }

  function handleAddNew() {
    setFormData(DEFAULT_FORM_DATA)
    setEditingId(null)
    setShowForm(true)
    setError(null)
  }

  if (loading) {
    return (
      <PageContainer spacing="lg">
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      </PageContainer>
    )
  }

  if (!company) {
    return (
      <PageContainer spacing="lg">
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <AlertCircle size={48} style={{ color: 'var(--color-status-error)', marginBottom: 16 }} />
          <Typography variant="h6" mb={2}>No Company Found</Typography>
          <Typography variant="body2" color="text.secondary">
            Please set up your company first before managing collections.
          </Typography>
          <Button variant="contained" onClick={() => navigate('/sell/company')} sx={{ mt: 2 }}>
            Create Company
          </Button>
        </Paper>
      </PageContainer>
    )
  }

  return (
    <PageContainer spacing="lg">
      <PageHeader
        icon={<Boxes size={20} />}
        title="Product Collections"
        subtitle="Group products into a Gamma Collection (NIP-99, Kind 30405) and assign shared shipping options. Publishing requires at least one member with a live listing."
        onBack={() => navigate('/sell/listings?tab=catalogs')}
        backLabel="Back to Catalogs"
        actions={
          <Button size="small" startIcon={<Truck size={14} />} onClick={() => navigate('/sell/company/shipping-options')}>
            Manage Shipping Options
          </Button>
        }
        actionsFit="inline"
      />

      {error && (
        <Paper sx={{ p: 2, mb: 2, bgcolor: 'error.light' }}>
          <Typography color="error">{error}</Typography>
        </Paper>
      )}

      {showForm ? (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h6" fontWeight={700} mb={3}>
            {editingId ? 'Edit Collection' : 'New Collection'}
          </Typography>

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g. Summer Collection"
                fullWidth
                required
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Image URL"
                value={formData.image}
                onChange={(e) => setFormData({ ...formData, image: e.target.value })}
                placeholder="Optional"
                fullWidth
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Summary"
                value={formData.summary}
                onChange={(e) => setFormData({ ...formData, summary: e.target.value })}
                placeholder="Optional short description"
                fullWidth
                multiline
                minRows={2}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Autocomplete<{ id: string; name: string }, true>
                multiple
                options={productOptions}
                value={selectedProducts}
                onChange={(_, newValue) => setFormData({ ...formData, productIds: newValue.map(p => p.id) })}
                getOptionLabel={(option) => option.name}
                isOptionEqualToValue={(option, val) => option.id === val.id}
                loading={productsLoading}
                disableCloseOnSelect
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Products"
                    placeholder="Select products"
                    helperText="Required — a collection cannot be empty (Gamma spec, D10)"
                    slotProps={{
                      input: {
                        ...params.InputProps,
                        endAdornment: (
                          <>
                            {productsLoading ? <CircularProgress color="inherit" size={16} /> : null}
                            {params.InputProps.endAdornment}
                          </>
                        ),
                      },
                    }}
                  />
                )}
                renderTags={(tagValue, getTagProps) =>
                  tagValue.map((option, index) => {
                    const { key, ...rest } = getTagProps({ index })
                    return <Chip key={key} icon={<Package size={12} />} label={option.name} size="small" {...rest} />
                  })
                }
                noOptionsText={products.length === 0 ? 'No products created yet' : 'No matching products'}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Autocomplete<ShippingOption, true>
                multiple
                options={shippingOptions}
                value={selectedShippingOptions}
                onChange={(_, newValue) => setFormData({ ...formData, shippingOptionIds: newValue.map(o => o.id) })}
                getOptionLabel={(option) => option.title}
                isOptionEqualToValue={(option, val) => option.id === val.id}
                disableCloseOnSelect
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Shipping Options"
                    placeholder="Optional — union-merged into member listings"
                  />
                )}
                renderTags={(tagValue, getTagProps) =>
                  tagValue.map((option, index) => {
                    const { key, ...rest } = getTagProps({ index })
                    return <Chip key={key} icon={<Truck size={12} />} label={option.title} size="small" {...rest} />
                  })
                }
                noOptionsText={shippingOptions.length === 0 ? 'No shipping options created yet' : 'No matching shipping options'}
              />
            </Grid>
          </Grid>

          <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
            <Button variant="contained" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : (editingId ? 'Update' : 'Create')}
            </Button>
            <Button variant="outlined" onClick={handleCancel} disabled={saving}>
              Cancel
            </Button>
          </Box>
        </Paper>
      ) : (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h6" fontWeight={600}>
              {collections.length} Collection{collections.length !== 1 ? 's' : ''}
            </Typography>
            <Button variant="contained" startIcon={<Plus size={16} />} onClick={handleAddNew}>
              Add Collection
            </Button>
          </Box>

          {collections.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', bgcolor: 'action.hover' }}>
              <Boxes size={48} style={{ color: 'var(--theme-text-muted)', marginBottom: 16 }} />
              <Typography variant="h6" mb={1}>No Collections</Typography>
              <Typography variant="body2" color="text.secondary" mb={3}>
                Group products into a collection to publish as a Gamma Kind 30405 object.
              </Typography>
              <Button variant="contained" startIcon={<Plus size={16} />} onClick={handleAddNew}>
                Create First Collection
              </Button>
            </Paper>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {collections.map((collection) => (
                <Paper
                  key={collection.id}
                  variant="outlined"
                  sx={{
                    p: 2.5,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    opacity: collection.isActive ? 1 : 0.6,
                  }}
                >
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography variant="subtitle1" fontWeight={600}>
                        {collection.title}
                      </Typography>
                      {!collection.nostrEventId && (
                        <Tooltip title="Not yet published — no member has a resolvable live offer (D10)">
                          <Typography variant="caption" sx={{ color: 'var(--color-warning-primary)', fontWeight: 600 }}>
                            unpublished
                          </Typography>
                        </Tooltip>
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', gap: 3, color: 'text.secondary', flexWrap: 'wrap' }}>
                      <Typography variant="body2">
                        <strong>Products:</strong> {collection.products.length}
                      </Typography>
                      <Typography variant="body2">
                        <strong>Shipping:</strong> {collection.shippingOptions.length}
                      </Typography>
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Tooltip title={collection.isActive ? 'Deactivate' : 'Activate'}>
                      <ActionButton
                        icon={collection.isActive ? <Eye size={16} /> : <EyeOff size={16} />}
                        title={collection.isActive ? 'Deactivate' : 'Activate'}
                        onClick={() => handleToggleActive(collection)}
                      />
                    </Tooltip>
                    <Tooltip title="Edit">
                      <ActionButton icon={<Pencil size={16} />} title="Edit" onClick={() => handleEdit(collection)} />
                    </Tooltip>
                    <Tooltip title="Delete">
                      <ActionButton icon={<Trash2 size={16} />} title="Delete" color="error" onClick={() => handleDelete(collection.id)} />
                    </Tooltip>
                  </Box>
                </Paper>
              ))}
            </Box>
          )}
        </>
      )}
    </PageContainer>
  )
}

function ActionButton({
  icon,
  title,
  color,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  color?: string
  onClick: (e: React.MouseEvent) => void
}) {
  return (
    <Tooltip title={title} arrow placement="top">
      <IconButton
        onClick={onClick}
        size="small"
        sx={{
          width: 34,
          height: 34,
          borderRadius: 1.5,
          background: 'var(--theme-bg-subtle)',
          border: '1px solid var(--theme-border)',
          color: color || 'var(--theme-text-muted)',
          transition: 'all 150ms ease',
          '&:hover': {
            background: color ? `${color}14` : 'var(--theme-surface-secondary)',
            borderColor: color ? `${color}40` : 'var(--theme-border)',
            color: color || 'var(--theme-text)',
          },
        }}
      >
        {icon}
      </IconButton>
    </Tooltip>
  )
}
