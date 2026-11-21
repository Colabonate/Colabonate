import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Truck, Plus, Pencil, Trash2, Star, AlertCircle,
} from 'lucide-react'
import {
  Tooltip, IconButton, TextField, CircularProgress, Box, Typography,
  Paper, Switch, FormControlLabel, Grid, Button,
} from '@mui/material'
import {
  PageContainer,
} from '@ds/ui'
import { apiCall } from '../../lib/api'
import { formatSats } from '../../lib/currency'
import { FiatHint } from '../../components/currency/FiatHint'
import { SatsAmountInput } from '../../components/currency/SatsAmountInput'
import { PageHeader } from '../../components/PageHeader'
import type { DeliveryTemplate, Company } from '../../types/api'

interface DeliveryTemplateFormData {
  name: string
  deliveryTimeDays: string
  deliveryCostSats: string
  isDefault: boolean
}

const DEFAULT_FORM_DATA: DeliveryTemplateFormData = {
  name: '',
  deliveryTimeDays: '',
  deliveryCostSats: '',
  isDefault: false,
}

export function SellDeliveryTemplates() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<DeliveryTemplate[]>([])
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<DeliveryTemplateFormData>(DEFAULT_FORM_DATA)

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
      const [companyRes, templatesRes] = await Promise.all([
        apiCall(`/api/company/${userPubkey}`),
        userPubkey ? apiCall(`/api/delivery-templates/by-pubkey/${userPubkey}`) : Promise.resolve(null),
      ])
      const companyData = await companyRes.json()
      const templatesData = templatesRes ? await templatesRes.json() : { templates: [] }

      if (companyData.company) {
        setCompany(companyData.company)
      }
      setTemplates(templatesData.templates || [])
    } catch (err) {
      console.error('Failed to fetch data:', err)
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!formData.name || !formData.deliveryTimeDays || !formData.deliveryCostSats) {
      setError('Please fill in all required fields')
      return
    }

    setSaving(true)
    setError(null)

    try {
      if (editingId) {
        await apiCall(`/api/delivery-templates/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: formData.name,
            deliveryTimeDays: parseInt(formData.deliveryTimeDays),
            deliveryCostSats: parseInt(formData.deliveryCostSats),
            isDefault: formData.isDefault,
          }),
        })
      } else if (company?.id) {
        await apiCall('/api/delivery-templates', {
          method: 'POST',
          body: JSON.stringify({
            companyId: company.id,
            name: formData.name,
            deliveryTimeDays: parseInt(formData.deliveryTimeDays),
            deliveryCostSats: parseInt(formData.deliveryCostSats),
            isDefault: formData.isDefault,
          }),
        })
      }

      setShowForm(false)
      setEditingId(null)
      setFormData(DEFAULT_FORM_DATA)
      fetchData()
    } catch (err) {
      console.error('Failed to save template:', err)
      setError('Failed to save template')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this template?')) return

    try {
      await apiCall(`/api/delivery-templates/${id}`, { method: 'DELETE' })
      fetchData()
    } catch (err) {
      console.error('Failed to delete template:', err)
      setError('Failed to delete template')
    }
  }

  async function handleSetDefault(id: string) {
    try {
      await apiCall(`/api/delivery-templates/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isDefault: true }),
      })
      fetchData()
    } catch (err) {
      console.error('Failed to set default template:', err)
      setError('Failed to set default template')
    }
  }

  function handleEdit(template: DeliveryTemplate) {
    setFormData({
      name: template.name,
      deliveryTimeDays: template.deliveryTimeDays.toString(),
      deliveryCostSats: template.deliveryCostSats.toString(),
      isDefault: template.isDefault,
    })
    setEditingId(template.id)
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
            Please set up your company first before managing delivery templates.
          </Typography>
          <Button
            variant="contained"
            onClick={() => navigate('/sell/company/setup')}
            sx={{ mt: 2 }}
          >
            Create Company
          </Button>
        </Paper>
      </PageContainer>
    )
  }

  return (
    <PageContainer spacing="lg">
      <PageHeader
        icon={<Truck size={20} />}
        title="Delivery Templates"
        subtitle="Manage shipping and delivery conditions for your products. Templates can be assigned to product listings."
        onBack={() => navigate('/sell/catalog')}
        backLabel="Back to Catalog"
      />

      {error && (
        <Paper sx={{ p: 2, mb: 2, bgcolor: 'error.light' }}>
          <Typography color="error">{error}</Typography>
        </Paper>
      )}

      {showForm ? (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h6" fontWeight={700} mb={3}>
            {editingId ? 'Edit Template' : 'New Delivery Template'}
          </Typography>

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Template Name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Standard Shipping, Express Delivery"
                fullWidth
                required
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Delivery Time (Days)"
                type="number"
                value={formData.deliveryTimeDays}
                onChange={(e) => setFormData({ ...formData, deliveryTimeDays: e.target.value })}
                placeholder="e.g. 3"
                inputProps={{ min: 1, max: 90 }}
                fullWidth
                required
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <SatsAmountInput
                label="Delivery Cost"
                valueSats={formData.deliveryCostSats === '' ? '' : Number(formData.deliveryCostSats)}
                onChangeSats={sats => setFormData({ ...formData, deliveryCostSats: sats === '' ? '' : String(sats) })}
                required
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={formData.isDefault}
                    onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                  />
                }
                label="Set as default template"
              />
            </Grid>
          </Grid>

          <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : (editingId ? 'Update Template' : 'Create Template')}
            </Button>
            <Button
              variant="outlined"
              onClick={handleCancel}
              disabled={saving}
            >
              Cancel
            </Button>
          </Box>
        </Paper>
      ) : (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Typography variant="h6" fontWeight={600}>
              {templates.length} Template{templates.length !== 1 ? 's' : ''}
            </Typography>
            <Button
              variant="contained"
              startIcon={<Plus size={16} />}
              onClick={handleAddNew}
            >
              Add Template
            </Button>
          </Box>

          {templates.length === 0 ? (
            <Paper
              variant="outlined"
              sx={{ p: 4, textAlign: 'center', bgcolor: 'action.hover' }}
            >
              <Truck size={48} style={{ color: 'var(--theme-text-muted)', marginBottom: 16 }} />
              <Typography variant="h6" mb={1}>No Delivery Templates</Typography>
              <Typography variant="body2" color="text.secondary" mb={3}>
                Create templates to define shipping conditions for your products.
              </Typography>
              <Button
                variant="contained"
                startIcon={<Plus size={16} />}
                onClick={handleAddNew}
              >
                Create First Template
              </Button>
            </Paper>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {templates.map((template) => (
                <Paper
                  key={template.id}
                  variant="outlined"
                  sx={{
                    p: 2.5,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    bgcolor: template.isDefault ? 'action.hover' : undefined,
                    borderColor: template.isDefault ? 'primary.main' : undefined,
                  }}
                >
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography variant="subtitle1" fontWeight={600}>
                        {template.name}
                      </Typography>
                      {template.isDefault && (
                        <Tooltip title="Default template">
                          <Star size={16} fill="var(--color-primary-50)" color="var(--color-primary-50)" />
                        </Tooltip>
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', gap: 3, color: 'text.secondary' }}>
                      <Typography variant="body2">
                        <strong>Time:</strong> {template.deliveryTimeDays} {template.deliveryTimeDays === 1 ? 'Day' : 'Days'}
                      </Typography>
                      <Typography variant="body2">
                        <strong>Cost:</strong> {formatSats(template.deliveryCostSats, { compact: false })}{' '}
                        <FiatHint sats={template.deliveryCostSats} className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }} />
                      </Typography>
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', gap: 1 }}>
                    {!template.isDefault && (
                      <Tooltip title="Set as default">
                        <ActionButton
                          icon={<Star size={16} />}
                          title="Set as default"
                          onClick={() => handleSetDefault(template.id)}
                        />
                      </Tooltip>
                    )}
                    <Tooltip title="Edit">
                      <ActionButton
                        icon={<Pencil size={16} />}
                        title="Edit"
                        onClick={() => handleEdit(template)}
                      />
                    </Tooltip>
                    <Tooltip title="Delete">
                      <ActionButton
                        icon={<Trash2 size={16} />}
                        title="Delete"
                        color="error"
                        onClick={() => handleDelete(template.id)}
                      />
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
