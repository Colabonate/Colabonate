// ADR-277 E2: Gamma Shipping Option (Kind 30406) management. Mirrors
// SellDeliveryTemplates.tsx's inline list+form pattern — shipping options are
// a flat, reusable entity assigned to Collections (D5/C2), not a wizard step.
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Ship, Plus, Pencil, Trash2, AlertCircle, EyeOff, Eye,
} from 'lucide-react'
import {
  Tooltip, IconButton, TextField, CircularProgress, Box, Typography,
  Paper, Grid, Button, MenuItem,
} from '@mui/material'
import { PageContainer } from '@ds/ui'
import { apiCall } from '../../lib/api'
import { PageHeader } from '../../components/PageHeader'
import type { Company, ShippingOption, ShippingServiceType } from '../../types/api'

const SERVICE_TYPES: ShippingServiceType[] = ['STANDARD', 'EXPRESS', 'OVERNIGHT', 'PICKUP']

interface ShippingOptionFormData {
  title: string
  baseCost: string
  currency: string
  countries: string // comma-separated ISO-3166-1 alpha-2
  service: ShippingServiceType
  carrier: string
  durationMin: string
  durationMax: string
}

const DEFAULT_FORM_DATA: ShippingOptionFormData = {
  title: '',
  baseCost: '',
  currency: 'EUR',
  countries: '',
  service: 'STANDARD',
  carrier: '',
  durationMin: '',
  durationMax: '',
}

export function SellShippingOptions() {
  const navigate = useNavigate()
  const [options, setOptions] = useState<ShippingOption[]>([])
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<ShippingOptionFormData>(DEFAULT_FORM_DATA)

  const userPubkey = localStorage.getItem('pubkey')

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
        const optsRes = await apiCall(`/api/shipping-options/company/${resolvedCompany.id}`)
        const optsData = await optsRes.json()
        setOptions(optsData.shippingOptions || [])
      } else {
        setOptions([])
      }
    } catch (err) {
      console.error('Failed to fetch shipping options:', err)
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  function validate(): string | null {
    if (!formData.title.trim()) return 'Title is required'
    if (!formData.baseCost.trim() || isNaN(Number(formData.baseCost))) return 'Base cost must be a number'
    if (!formData.currency.trim()) return 'Currency is required'
    if (!formData.countries.trim()) return 'At least one destination country is required'
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

    const countries = formData.countries
      .split(',')
      .map(c => c.trim().toUpperCase())
      .filter(Boolean)
      .join(',')

    const payload = {
      title: formData.title.trim(),
      baseCost: formData.baseCost.trim(),
      currency: formData.currency.trim().toUpperCase(),
      countries,
      service: formData.service,
      carrier: formData.carrier.trim() || undefined,
      durationMin: formData.durationMin ? Number(formData.durationMin) : undefined,
      durationMax: formData.durationMax ? Number(formData.durationMax) : undefined,
      durationUnit: (formData.durationMin || formData.durationMax) ? 'D' : undefined,
    }

    try {
      if (editingId) {
        await apiCall(`/api/shipping-options/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
      } else if (company?.id) {
        await apiCall('/api/shipping-options', {
          method: 'POST',
          body: JSON.stringify({ ...payload, companyId: company.id, d: crypto.randomUUID() }),
        })
      }

      setShowForm(false)
      setEditingId(null)
      setFormData(DEFAULT_FORM_DATA)
      fetchData()
    } catch (err) {
      console.error('Failed to save shipping option:', err)
      setError('Failed to save shipping option')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this shipping option? Collections referencing it will lose the assignment.')) return
    try {
      await apiCall(`/api/shipping-options/${id}`, { method: 'DELETE' })
      fetchData()
    } catch (err) {
      console.error('Failed to delete shipping option:', err)
      setError('Failed to delete shipping option')
    }
  }

  async function handleToggleActive(option: ShippingOption) {
    try {
      await apiCall(`/api/shipping-options/${option.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !option.isActive }),
      })
      fetchData()
    } catch (err) {
      console.error('Failed to toggle shipping option:', err)
      setError('Failed to update shipping option')
    }
  }

  function handleEdit(option: ShippingOption) {
    setFormData({
      title: option.title,
      baseCost: option.baseCost,
      currency: option.currency,
      countries: option.countries,
      service: option.service,
      carrier: option.carrier || '',
      durationMin: option.durationMin != null ? String(option.durationMin) : '',
      durationMax: option.durationMax != null ? String(option.durationMax) : '',
    })
    setEditingId(option.id)
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
            Please set up your company first before managing shipping options.
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
        icon={<Ship size={20} />}
        title="Shipping Options"
        subtitle="Reusable Gamma shipping options (NIP-99). Assign them to Product Collections — recipients inherit them via union-merge."
        onBack={() => navigate('/sell/company/collections')}
        backLabel="Back to Collections"
      />

      {error && (
        <Paper sx={{ p: 2, mb: 2, bgcolor: 'error.light' }}>
          <Typography color="error">{error}</Typography>
        </Paper>
      )}

      {showForm ? (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h6" fontWeight={700} mb={3}>
            {editingId ? 'Edit Shipping Option' : 'New Shipping Option'}
          </Typography>

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g. EU Standard Shipping"
                fullWidth
                required
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                label="Base Cost"
                value={formData.baseCost}
                onChange={(e) => setFormData({ ...formData, baseCost: e.target.value })}
                placeholder="12.99"
                fullWidth
                required
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                label="Currency"
                value={formData.currency}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                placeholder="EUR"
                fullWidth
                required
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Destination Countries"
                value={formData.countries}
                onChange={(e) => setFormData({ ...formData, countries: e.target.value })}
                placeholder="DE, AT, CH"
                helperText="Comma-separated ISO-3166-1 alpha-2 codes"
                fullWidth
                required
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                select
                label="Service"
                value={formData.service}
                onChange={(e) => setFormData({ ...formData, service: e.target.value as ShippingServiceType })}
                fullWidth
              >
                {SERVICE_TYPES.map(s => (
                  <MenuItem key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                label="Carrier"
                value={formData.carrier}
                onChange={(e) => setFormData({ ...formData, carrier: e.target.value })}
                placeholder="Optional, e.g. DHL"
                fullWidth
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                label="Min Days"
                type="number"
                value={formData.durationMin}
                onChange={(e) => setFormData({ ...formData, durationMin: e.target.value })}
                fullWidth
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                label="Max Days"
                type="number"
                value={formData.durationMax}
                onChange={(e) => setFormData({ ...formData, durationMax: e.target.value })}
                fullWidth
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
              {options.length} Shipping Option{options.length !== 1 ? 's' : ''}
            </Typography>
            <Button variant="contained" startIcon={<Plus size={16} />} onClick={handleAddNew}>
              Add Shipping Option
            </Button>
          </Box>

          {options.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', bgcolor: 'action.hover' }}>
              <Ship size={48} style={{ color: 'var(--theme-text-muted)', marginBottom: 16 }} />
              <Typography variant="h6" mb={1}>No Shipping Options</Typography>
              <Typography variant="body2" color="text.secondary" mb={3}>
                Create shipping options to assign to your Product Collections.
              </Typography>
              <Button variant="contained" startIcon={<Plus size={16} />} onClick={handleAddNew}>
                Create First Shipping Option
              </Button>
            </Paper>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {options.map((option) => (
                <Paper
                  key={option.id}
                  variant="outlined"
                  sx={{
                    p: 2.5,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    opacity: option.isActive ? 1 : 0.6,
                  }}
                >
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="subtitle1" fontWeight={600} mb={0.5}>
                      {option.title}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 3, color: 'text.secondary', flexWrap: 'wrap' }}>
                      <Typography variant="body2">
                        <strong>Cost:</strong> {option.baseCost} {option.currency}
                      </Typography>
                      <Typography variant="body2">
                        <strong>To:</strong> {option.countries}
                      </Typography>
                      <Typography variant="body2">
                        <strong>Service:</strong> {option.service.charAt(0) + option.service.slice(1).toLowerCase()}
                      </Typography>
                      {(option.durationMin != null || option.durationMax != null) && (
                        <Typography variant="body2">
                          <strong>Duration:</strong> {option.durationMin ?? '?'}–{option.durationMax ?? '?'} days
                        </Typography>
                      )}
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Tooltip title={option.isActive ? 'Deactivate' : 'Activate'}>
                      <ActionButton
                        icon={option.isActive ? <Eye size={16} /> : <EyeOff size={16} />}
                        title={option.isActive ? 'Deactivate' : 'Activate'}
                        onClick={() => handleToggleActive(option)}
                      />
                    </Tooltip>
                    <Tooltip title="Edit">
                      <ActionButton icon={<Pencil size={16} />} title="Edit" onClick={() => handleEdit(option)} />
                    </Tooltip>
                    <Tooltip title="Delete">
                      <ActionButton icon={<Trash2 size={16} />} title="Delete" color="error" onClick={() => handleDelete(option.id)} />
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
