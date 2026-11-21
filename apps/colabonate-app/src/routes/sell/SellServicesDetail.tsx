// ESCROW-COPY (ADR-397): payment wording here assumes Direct-Pay. On escrow activation follow docs/plans/ESCROW-COPY-REACTIVATION.md.
import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { setPref } from '../../utils/userPreferences'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Grid,
  IconButton,
  InputAdornment,
  Paper,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import PlaceIcon from '@mui/icons-material/Place'
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined'
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { de } from 'date-fns/locale/de'
import { PageContainer } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { apiCall } from '../../lib/api'
import { SatsAmountInput } from '../../components/currency/SatsAmountInput'
import { MultiImageUploadInput } from '../../components/offers/MultiImageUploadInput'
import { RichDescriptionEditor } from '../../components/offers'
import { CATEGORIES, SUBCATEGORY_MAP, DEFAULT_MILESTONES, type MilestoneFormItem } from '../../components/offers/offerFormConstants'
import { TypeIntroPage } from '../../components/offers/TypeIntro'
import { useOfferForm } from '../../hooks/useOfferForm'
import { useOffer } from '../../hooks/useEntityQueries'

// ─── Constants ───────────────────────────────────────────────────────────────

const DEMO_PUBKEYS = ['test-buyer-pubkey']

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseLocationString(locStr: string | undefined | null): { street: string; city: string; zip: string; country: string } {
  if (!locStr) return { street: '', city: '', zip: '', country: '' }
  const parts = locStr.split(',').map(p => p.trim())
  if (parts.length === 4) return { street: parts[0], city: parts[1], zip: parts[2], country: parts[3] }
  if (parts.length === 3) return { street: '', city: parts[0], zip: parts[1], country: parts[2] }
  if (parts.length === 2) return { street: '', city: parts[0], zip: '', country: parts[1] }
  if (parts.length === 1) return { street: '', city: '', zip: parts[0], country: '' }
  return { street: '', city: '', zip: '', country: '' }
}

function serializeLocation(loc: { street: string; city: string; zip: string; country: string }): string | undefined {
  const parts = [loc.street, loc.city, loc.zip, loc.country].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : undefined
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SellServicesDetail() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { serviceId } = useParams<{ serviceId?: string }>()
  const isEditMode = serviceId && serviceId !== 'new'

  const { data: offer, isLoading: queryLoading, error: queryError } = useOffer(isEditMode ? serviceId! : '')

  const [submitting, setSubmitting] = useState(false)
  const [draftSaving, setDraftSaving] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [primaryImageIndex, setPrimaryImageIndex] = useState(0)

  const form = useOfferForm({
    offerType: 'SERVICE',
    context: 'private',
  })

  // Location: separate street/city/zip/country (full form has more fields than modal)
  const [location, setLocation] = useState({ street: '', city: '', zip: '', country: '' })

  // Milestones (full form manages its own milestone state for edit-mode hydration)
  const [milestoneItems, setMilestoneItems] = useState<MilestoneFormItem[]>(DEFAULT_MILESTONES)

  const userPubkey = localStorage.getItem('pubkey')

  // Hydrate form data when offer is loaded
  useState(() => {
    if (offer) {
      form.setValues({
        title: offer.title,
        description: offer.description || '',
        priceSats: String(offer.priceSats),
        category: offer.category || 'Services',
        ticketType: (offer.ticketType as 'SMART_ORDER' | 'MILESTONE') || 'SMART_ORDER',
        images: offer.images || [],
      })
      setLocation(parseLocationString(offer.location))
      if (offer.offerMilestones && offer.offerMilestones.length > 0) {
        setMilestoneItems(offer.offerMilestones.map(m => ({ title: m.title, description: m.description || '', percentage: m.percentage })))
      }
    }
  })

  const milestonePercentageSum = useMemo(
    () => milestoneItems.reduce((s, m) => s + (m.percentage || 0), 0),
    [milestoneItems]
  )
  const milestoneValid = form.values.ticketType !== 'MILESTONE' || milestonePercentageSum === 100

  function updateMilestone(i: number, field: keyof MilestoneFormItem, value: string | number) {
    setMilestoneItems(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: value } : m))
  }

  // ─── Category options (SERVICE categories from central CATEGORIES) ────
  const categoryOptions = CATEGORIES.map(cat => ({ id: cat, name: cat }))

  // ─── Schedule helpers ──────────────────────────────────────────────────
  const scheduleDate = form.values.scheduledAt ? new Date(form.values.scheduledAt) : null

  function handleScheduleDateChange(date: Date | null) {
    const timePart = scheduleDate
      ? `${String(scheduleDate.getHours()).padStart(2, '0')}:${String(scheduleDate.getMinutes()).padStart(2, '0')}`
      : '12:00'
    if (date) {
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${timePart}:00.000Z`
      form.setValues({ scheduledAt: iso })
    } else {
      form.setValues({ scheduledAt: null })
    }
  }

  function handleScheduleTimeChange(date: Date | null) {
    if (date && scheduleDate) {
      const d = new Date(scheduleDate)
      d.setHours(date.getHours(), date.getMinutes(), 0, 0)
      form.setValues({ scheduledAt: d.toISOString() })
    } else if (date) {
      const now = new Date()
      now.setHours(date.getHours(), date.getMinutes(), 0, 0)
      form.setValues({ scheduledAt: now.toISOString() })
    }
  }

  // ─── Submit ────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!milestoneValid) return
    if (!userPubkey || DEMO_PUBKEYS.includes(userPubkey)) {
      setSubmitError('Demo mode: Offer creation is disabled. Please log in with a real wallet.')
      return
    }
    if (!form.values.title) {
      setSubmitError('Title is required.')
      return
    }
    if (form.values.isScheduled && !form.values.scheduledAt) {
      setSubmitError('Please select a date and time for scheduled publishing.')
      return
    }

    setSubmitError('')
    setSubmitting(true)
    try {
      const payload = form.buildPayload(userPubkey)
      const body: Record<string, unknown> = { ...payload }

      // Override location with full structured location
      body.location = serializeLocation(location)
      body.city = location.city || undefined
      body.country = location.country || undefined

      // Override images to put primary first
      const orderedImages = primaryImageIndex === 0
        ? form.values.images
        : [form.values.images[primaryImageIndex], ...form.values.images.filter((_, i) => i !== primaryImageIndex)]
      body.images = orderedImages

      // Add milestones if MILESTONE type
      if (form.values.ticketType === 'MILESTONE') {
        body.milestones = milestoneItems.map((m, i) => ({ ...m, sortOrder: i }))
      }

      if (isEditMode && serviceId) {
        await apiCall(`/api/offers/${serviceId}`, { method: 'PATCH', body: JSON.stringify(body) })
        queryClient.invalidateQueries({ queryKey: ['listings'] })
        queryClient.invalidateQueries({ queryKey: ['map-offers'] })
        queryClient.invalidateQueries({ queryKey: ['category-counts'] })
        if (userPubkey) {
          queryClient.invalidateQueries({ queryKey: ['offers', userPubkey] })
          queryClient.invalidateQueries({ queryKey: ['user-product-offers', userPubkey] })
          queryClient.invalidateQueries({ queryKey: ['user-service-offers', userPubkey] })
          queryClient.invalidateQueries({ queryKey: ['user-all-offers', userPubkey] })
        }
        navigate('/sell/services')
      } else {
        const response = await apiCall('/api/offers', { method: 'POST', body: JSON.stringify(body) })
        if (response.ok) {
          const created = await response.json()
          // Sync the user's home location to the offer's location so the new
          // service appears in "Nearby" / "Region" on the Home slider without
          // a separate /settings step.
          const createdCity = (created as { offer?: { city?: string } }).offer?.city ?? body.city
          const createdCountry = (created as { offer?: { country?: string } }).offer?.country ?? body.country
          if (createdCity) setPref('userCity', String(createdCity))
          if (createdCountry) setPref('userCountry', String(createdCountry))
          queryClient.invalidateQueries({ queryKey: ['listings'] })
          queryClient.invalidateQueries({ queryKey: ['map-offers'] })
          queryClient.invalidateQueries({ queryKey: ['category-counts'] })
          if (userPubkey) {
            queryClient.invalidateQueries({ queryKey: ['offers', userPubkey] })
            queryClient.invalidateQueries({ queryKey: ['user-product-offers', userPubkey] })
            queryClient.invalidateQueries({ queryKey: ['user-service-offers', userPubkey] })
            queryClient.invalidateQueries({ queryKey: ['user-all-offers', userPubkey] })
          }
          navigate('/sell/services')
        } else {
          const errData = await response.json()
          setSubmitError(errData.error || 'Failed to create service.')
        }
      }
    } catch (error) {
      console.error('Failed to save service:', error)
      setSubmitError(error instanceof Error ? error.message : 'Failed to save service.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSaveDraft() {
    setDraftSaving(true)
    try {
      form.saveDraft()
    } finally {
      setDraftSaving(false)
    }
  }

  // ─── Loading state ────────────────────────────────────────────────────
  if (queryLoading) {
    return (
      <PageContainer size="narrow" spacing="lg">
        <PageHeader title="Edit Service" onBack={() => navigate('/sell/services')} />
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 rounded-full border-4 animate-spin" style={{ borderColor: 'var(--color-primary-50) var(--color-primary-50) var(--color-primary-50) transparent' }} />
        </div>
      </PageContainer>
    )
  }

  if (queryError) {
    return (
      <PageContainer size="narrow" spacing="lg">
        <PageHeader title="Edit Service" onBack={() => navigate('/sell/services')} />
        <Alert severity="error">Failed to load service: {(queryError as Error).message}</Alert>
      </PageContainer>
    )
  }

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <PageContainer size="narrow" spacing="lg">
      <PageHeader
        title={isEditMode ? 'Edit Service' : 'Offer a Service'}
        subtitle={
          <>
            {isEditMode
              ? 'Update your service offering details.'
              : 'Full creation for your service – detailed description, portfolio images, milestones, and scheduling.'}
            <br />
            Clients pay you directly over Lightning. You accept before work begins, so nothing is charged until you are ready.
          </>
        }
        onBack={() => navigate('/sell/services')}
        backLabel="Back to services"
      />

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>

        {/* Section: Order Type Introduction */}
        <TypeIntroPage
          selectedType={form.values.ticketType}
          onSelect={(t) => form.setValues({ ticketType: t })}
          variant="service"
        />

        {/* Section: Basic Information */}
        <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
          <Typography variant="subtitle1" fontWeight={700} gutterBottom>
            Basic Information
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 2 }}>
            <TextField
              label="Service title"
              value={form.values.title}
              onChange={(e) => form.setValues({ title: e.target.value })}
              placeholder="e.g. Logo Design for your Brand"
              required
              fullWidth
            />
            {/* ADR-295: WYSIWYG description editor + AI assist */}
            <RichDescriptionEditor
              value={form.values.description}
              onChange={(html) => form.setValues({ description: html })}
              required
              helperText="Describe what you offer, your process, and what the client receives…"
              aiContext={{
                title: form.values.title,
                offerType: 'SERVICE',
                category: form.values.category,
              }}
            />
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <SatsAmountInput
                  label="Rate"
                  valueSats={form.values.priceSats === '' ? '' : Number(form.values.priceSats)}
                  onChangeSats={sats => form.setValues({ priceSats: sats === '' ? '' : String(sats) })}
                  required
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Autocomplete
                  options={categoryOptions}
                  value={categoryOptions.find(c => c.id === form.values.category) ?? undefined}
                  onChange={(_, newVal) => form.setValues({ category: newVal?.id ?? 'Services', subcategory: '' })}
                  getOptionLabel={(opt) => opt.name}
                  getOptionKey={(opt) => opt.id}
                  disableClearable
                  renderInput={(params) => (
                    <TextField {...params} label="Category" required />
                  )}
                />
              </Grid>
            </Grid>

            {/* Subcategory (when subs exist for selected category) */}
            {SUBCATEGORY_MAP[form.values.category] && SUBCATEGORY_MAP[form.values.category].length > 0 && (
              <Autocomplete
                options={SUBCATEGORY_MAP[form.values.category].map(sub => ({ id: sub.id, name: sub.name }))}
                value={
                  SUBCATEGORY_MAP[form.values.category]
                    ?.map(sub => ({ id: sub.id, name: sub.name }))
                    .find(s => s.name === form.values.subcategory) ?? null
                }
                onChange={(_, newVal) => form.setValues({ subcategory: newVal?.name ?? '' })}
                getOptionLabel={(opt) => opt.name}
                getOptionKey={(opt) => opt.id}
                renderInput={(params) => (
                  <TextField {...params} label="Subcategory" />
                )}
              />
            )}
          </Box>
        </Paper>

        {/* Section: Photos */}
        <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
          <Typography variant="subtitle1" fontWeight={700} gutterBottom>
            Portfolio Images
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Up to 5 photos showcasing your work. The marked cover photo is shown in listings.
          </Typography>
          <MultiImageUploadInput
            values={form.values.images}
            onChange={(urls) => form.setValues({ images: urls })}
            maxImages={5}
            primaryIndex={primaryImageIndex}
            onPrimaryChange={setPrimaryImageIndex}
          />
        </Paper>

        {/* Section: Location */}
        <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
          <Typography variant="subtitle1" fontWeight={700} gutterBottom>
            Location
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Optional – helps clients find local services.
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Street & number (optional)"
              value={location.street}
              onChange={(e) => setLocation({ ...location, street: e.target.value })}
              placeholder="e.g. 123 Main Street"
              fullWidth
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <PlaceIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 5 }}>
                <TextField
                  label="ZIP / Postal code (optional)"
                  value={location.zip}
                  onChange={(e) => setLocation({ ...location, zip: e.target.value })}
                  placeholder="e.g. 10001, SW1A, 80331"
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 7 }}>
                <TextField
                  label="City (optional)"
                  value={location.city}
                  onChange={(e) => setLocation({ ...location, city: e.target.value })}
                  placeholder="e.g. New York"
                  fullWidth
                />
              </Grid>
            </Grid>
            <TextField
              label="Country (optional)"
              value={location.country}
              onChange={(e) => setLocation({ ...location, country: e.target.value })}
              placeholder="e.g. Germany, USA, UK"
              fullWidth
            />
          </Box>
        </Paper>

        {/* Section: Milestones (only when MILESTONE selected) */}
        {form.values.ticketType === 'MILESTONE' && (
          <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              Project Milestones
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Define the phases of your service delivery.
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 2 }}>
              {milestoneItems.map((m, i) => (
                <Paper key={i} variant="outlined" sx={{ p: 1.5 }}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <Typography variant="caption" fontWeight={700} color="secondary.main" sx={{ pt: 1, minWidth: 20 }}>
                      {i + 1}.
                    </Typography>
                    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <TextField
                        label="Phase title"
                        value={m.title}
                        onChange={e => updateMilestone(i, 'title', e.target.value)}
                        size="small"
                        required
                        fullWidth
                        placeholder="e.g. Discovery, Design, Development"
                      />
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <TextField
                          label="Deliverable (optional)"
                          value={m.description}
                          onChange={e => updateMilestone(i, 'description', e.target.value)}
                          size="small"
                          fullWidth
                        />
                        <TextField
                          label="%"
                          type="number"
                          value={m.percentage}
                          onChange={e => updateMilestone(i, 'percentage', parseInt(e.target.value) || 0)}
                          size="small"
                          inputProps={{ min: 1, max: 100 }}
                          sx={{ width: 80 }}
                          required
                        />
                      </Box>
                    </Box>
                    {milestoneItems.length > 1 && (
                      <IconButton
                        size="small"
                        onClick={() => setMilestoneItems(prev => prev.filter((_, idx) => idx !== i))}
                        sx={{ mt: 0.5, color: 'text.disabled' }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Box>
                </Paper>
              ))}
            </Box>
            <Box
              component="button"
              onClick={() => setMilestoneItems(prev => [...prev, { title: '', description: '', percentage: 0 }])}
              sx={{ mt: 1, cursor: 'pointer', border: 'none', bgcolor: 'transparent', color: 'secondary.main', fontSize: '0.875rem', p: 0 }}
            >
              + Add phase
            </Box>
            <Alert severity={milestonePercentageSum === 100 ? 'success' : 'warning'} sx={{ mt: 1 }}>
              Total: {milestonePercentageSum}% {milestonePercentageSum === 100 ? '✓' : `– ${100 - milestonePercentageSum}% remaining`}
            </Alert>
          </Paper>
        )}

        {/* Section: Schedule Publishing */}
        <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <ScheduleOutlinedIcon fontSize="small" color={form.values.isScheduled ? 'primary' : 'action'} />
              <Box>
                <Typography variant="subtitle1" fontWeight={700}>
                  {form.values.isScheduled ? 'Scheduled Publishing' : 'Publishing'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {form.values.isScheduled
                    ? 'Choose a date and time to publish automatically.'
                    : 'Publish immediately after confirmation.'}
                </Typography>
              </Box>
            </Box>
            <Switch
              checked={form.values.isScheduled}
              onChange={(e) => {
                form.setValues({ isScheduled: e.target.checked, scheduledAt: e.target.checked ? new Date().toISOString() : null })
              }}
              color="primary"
            />
          </Box>

          {form.values.isScheduled && (
            <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={de}>
              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <DatePicker
                    label="Date"
                    value={scheduleDate}
                    onChange={handleScheduleDateChange}
                    slotProps={{ textField: { fullWidth: true } }}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TimePicker
                    label="Time"
                    value={scheduleDate}
                    onChange={handleScheduleTimeChange}
                    slotProps={{ textField: { fullWidth: true } }}
                  />
                </Grid>
              </Grid>
            </LocalizationProvider>
          )}
        </Paper>

        {/* Actions */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pb: 4 }}>
          {submitError && <Alert severity="error">{submitError}</Alert>}
          <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'flex-end' }}>
            <Button variant="outlined" onClick={() => navigate('/sell/services')} disabled={submitting} sx={{ minWidth: 100 }}>
              Cancel
            </Button>
            {!isEditMode && (
              <Button
                variant="outlined"
                color="inherit"
                onClick={handleSaveDraft}
                disabled={submitting || draftSaving}
                startIcon={<SaveOutlinedIcon fontSize="small" />}
                sx={{ minWidth: 120 }}
              >
                {draftSaving ? 'Saving…' : 'Save Draft'}
              </Button>
            )}
            <Button
              variant="contained"
              onClick={handleSubmit}
              disabled={submitting || !milestoneValid}
              startIcon={form.values.isScheduled ? <ScheduleOutlinedIcon fontSize="small" /> : undefined}
              sx={{ minWidth: 140 }}
            >
              {submitting ? 'Publishing…' : isEditMode ? 'Save Changes' : form.values.isScheduled ? 'Schedule Service' : 'Publish Service'}
            </Button>
          </Box>
        </Box>

      </Box>
    </PageContainer>
  )
}
