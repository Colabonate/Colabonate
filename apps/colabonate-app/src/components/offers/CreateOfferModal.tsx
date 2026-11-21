// ESCROW-COPY (ADR-397): payment wording here assumes Direct-Pay. On escrow activation follow docs/plans/ESCROW-COPY-REACTIVATION.md.
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Alert,
  Box,
  Grid,
  InputAdornment,
  MenuItem,
  Paper,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { Modal, ModalHeader, ModalContent, FormStepper } from '@ds/ui'
import BoltIcon from '@mui/icons-material/Bolt'
import PlaceIcon from '@mui/icons-material/Place'
import PersonOutline from '@mui/icons-material/PersonOutline'
import BusinessOutlined from '@mui/icons-material/BusinessOutlined'
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import PublicIcon from '@mui/icons-material/Public'
import GavelOutlinedIcon from '@mui/icons-material/GavelOutlined'
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined'
import BlockOutlinedIcon from '@mui/icons-material/BlockOutlined'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { de } from 'date-fns/locale/de'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { apiCall } from '../../lib/api'
import { MultiImageUploadInput } from './MultiImageUploadInput'
import { SatsAmountInput } from '../currency/SatsAmountInput'
import { PrivateReputationNotice } from './PrivateReputationNotice'
import { TypeIntro } from './TypeIntro'
import { MilestoneEditor } from './MilestoneEditor'
import { QuickCreateBanner } from './QuickCreateBanner'
import { useOfferForm, type OfferType } from '../../hooks/useOfferForm'
import { RichDescriptionEditor, richTextToPlainText } from './'
import type { StandardCategory } from '../../types/api'

// ─── Constants ───────────────────────────────────────────────────────────────

const DRAFT_KEY = 'colabonate_create_offer_draft'
const DEMO_PUBKEYS = ['test-buyer-pubkey']

// ─── Form Steps ──────────────────────────────────────────────────────────────

const MODAL_FORM_STEPS = [
  { id: 0, label: 'Offer Type', description: 'What you offer' },
  { id: 1, label: 'Classification', description: 'Category' },
  { id: 2, label: 'Details', description: 'Describe & publish' },
]

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CreateOfferModalProps {
  open: boolean
  onClose: () => void
  onCreated?: () => void
  companyId?: string
  context?: 'private' | 'corporate'
  initialOfferType?: OfferType
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CreateOfferModal({
  open,
  onClose,
  onCreated,
  companyId,
  context = 'private',
  initialOfferType = 'ITEM',
}: CreateOfferModalProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [_submitting, setSubmitting] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [primaryImageIndex, setPrimaryImageIndex] = useState(0)
  const [currentFormStep, setCurrentFormStep] = useState(0)

  // StandardCategories (3-level master taxonomy, same source as CreateOfferPage)
  const [standardCategories, setStandardCategories] = useState<StandardCategory[]>([])
  useEffect(() => {
    let cancelled = false
    async function fetch() {
      try {
        const res = await apiCall('/api/standard-categories/tree/flat')
        const data = await res.json()
        if (!cancelled && data.standardCategories) {
          setStandardCategories(data.standardCategories)
        }
      } catch (e) {
        console.error('Failed to fetch standard categories:', e)
      }
    }
    fetch()
    return () => { cancelled = true }
  }, [])

  // Build category tree indexed by slug for easy lookup
  const categoryTree = useMemo(() => {
    const bySlug = new Map<string, StandardCategory[]>()
    for (const cat of standardCategories) {
      if (cat.parentId) {
        const parentSlug = cat.slug.substring(0, cat.slug.lastIndexOf('/'))
        if (parentSlug) {
          if (!bySlug.has(parentSlug)) bySlug.set(parentSlug, [])
          bySlug.get(parentSlug)!.push(cat)
        }
      } else {
        if (!bySlug.has('_root')) bySlug.set('_root', [])
        bySlug.get('_root')!.push(cat)
      }
    }
    for (const [, cats] of bySlug) cats.sort((a, b) => a.name.localeCompare(b.name))
    return bySlug
  }, [standardCategories])

  const getChildren = useCallback((slug: string): StandardCategory[] => {
    return categoryTree.get(slug) ?? []
  }, [categoryTree])

  const form = useOfferForm({
    offerType: initialOfferType,
    context,
  })

  // ─── Session storage persistence ──────────────────────────────────────
  const [draftRestored, setDraftRestored] = useState(false)

  useEffect(() => {
    if (!open) return
    if (draftRestored) return
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY)
      if (raw) {
        const saved = JSON.parse(raw)
        if (saved.values) form.setValues(saved.values)
        if (saved.offerType) form.setSelectedOfferType(saved.offerType)
        if (saved.context) form.setSelectedContext(saved.context)
        if (saved.step != null) setCurrentFormStep(saved.step)
        if (saved.primaryImageIndex != null) setPrimaryImageIndex(saved.primaryImageIndex)
      }
    } catch { /* ignore corrupt draft */ }
    setDraftRestored(true)
  }, [open])

  useEffect(() => {
    if (!open) return
    if (!draftRestored) return
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        values: form.values,
        offerType: form.selectedOfferType,
        context: form.selectedContext,
        step: currentFormStep,
        primaryImageIndex,
      }))
    } catch { /* quota exceeded – ignore */ }
  }, [form.values, form.selectedOfferType, form.selectedContext, currentFormStep, primaryImageIndex, open, draftRestored])

  function clearDraft() {
    sessionStorage.removeItem(DRAFT_KEY)
  }

  // ─── Step validation errors ──────────────────────────────────────────
  const [errors, setErrors] = useState<Record<number, Record<string, string>>>({})

  function clearErrorsForStep(step: number) {
    setErrors(prev => ({ ...prev, [step]: {} }))
  }

  // Determine what level form.values.subcategory is at (L2 or L3), and resolve active L2 slug
  const { subcategoryLevel, activeL2Slug } = useMemo(() => {
    if (!form.values.subcategory) return { subcategoryLevel: 0, activeL2Slug: '' }
    const l2Options = getChildren(form.values.category)
    // Is it L2?
    if (l2Options.some(c => c.slug === form.values.subcategory)) {
      return { subcategoryLevel: 2, activeL2Slug: form.values.subcategory }
    }
    // Is it L3? Find parent L2
    for (const l2 of l2Options) {
      if (getChildren(l2.slug).some(c => c.slug === form.values.subcategory)) {
        return { subcategoryLevel: 3, activeL2Slug: l2.slug }
      }
    }
    return { subcategoryLevel: 0, activeL2Slug: '' }
  }, [form.values.category, form.values.subcategory, standardCategories.length, getChildren])

  const userPubkey = localStorage.getItem('pubkey')

  // ─── Dynamic header content ──────────────────────────────────────────
  const headerContent = useMemo(() => {
    if (form.selectedOfferType === 'SERVICE') {
      return {
        title: 'Offer a Service',
        subtitle: 'Offer your expertise and get paid securely through milestones.',
        helpText: 'Clients pay you directly over Lightning. You accept before work begins, so nothing is charged until you are ready.',
      }
    }
    if (form.selectedOfferType === 'PRODUCT') {
      return {
        title: 'Create Product',
        subtitle: 'Add a product to your company catalog.',
        helpText: 'Products are listed in your catalog for buyers to browse and pay you directly — no platform in the middle.',
      }
    }
    if (form.selectedContext === 'corporate') {
      return {
        title: 'Create Corporate Offer',
        subtitle: 'Add items to your company catalog for buyers to discover.',
        helpText: 'Corporate items are linked to a catalog and category. Buyers pay you directly — no platform in the middle.',
      }
    }
    return {
      title: 'Create New Offer',
      subtitle: 'Sell items directly to buyers over Lightning.',
      helpText: 'Buyers pay you directly over Lightning — no platform in the middle.',
    }
  }, [form.selectedOfferType, form.selectedContext])

  // Sync initialOfferType when prop changes (e.g. opened from different FABs)
  useEffect(() => {
    if (open) {
      form.setSelectedOfferType(initialOfferType)
    }
  }, [open, initialOfferType])

  function handleClose() {
    setDialogError(null)
    onClose()
  }

  function handleSwitchToFullForm() {
    const type = form.selectedOfferType.toLowerCase()
    navigate(`/offers/new?type=${type}`, {
      state: {
        prefill: { ...form.values },
        milestoneItems: form.milestones,
      },
    })
    handleClose()
  }

  async function handleConfirm() {
    // ADR-085: Always validate step 1 (catalog/category) on final submit since user can
    // navigate back and forth. Also validate the current step.
    if (!validateFormStep(1)) return
    if (currentFormStep === 2 && !validateFormStep(2)) return
    if (!form.isValid) {
      setDialogError(`Please fill in all required fields. (title=${!!form.values.title}, price=${!!form.values.priceSats}, category="${form.values.category}", catalogId=${form.selectedCatalogId}, stock="${form.values.stock}")`)
      return
    }
    if (!userPubkey || DEMO_PUBKEYS.includes(userPubkey)) {
      setDialogError('Demo mode: Offer creation is disabled. Please log in with a real wallet.')
      return
    }

    setSubmitting(true)
    try {
      const body = form.buildPayload(userPubkey)
      const endpoint = form.needsCatalog && form.selectedCatalogId
        ? `/api/catalog/${form.selectedCatalogId}/products`
        : '/api/offers'

      if (companyId) {
        (body as Record<string, unknown>).companyId = companyId
      }

      const response = await apiCall(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (response.ok) {
        const result = await response.json()
        void (result.offer?.id || result.id)
        // Same invalidations as CreateOfferPage — without these, Home's
        // Marketplace slider (unified ['listings'] feed) shows the new
        // offer only after the next refetch.
        queryClient.invalidateQueries({ queryKey: ['listings'] })
        queryClient.invalidateQueries({ queryKey: ['map-offers'] })
        queryClient.invalidateQueries({ queryKey: ['category-counts'] })
        if (userPubkey) {
          queryClient.invalidateQueries({ queryKey: ['offers', userPubkey] })
          queryClient.invalidateQueries({ queryKey: ['user-product-offers', userPubkey] })
          queryClient.invalidateQueries({ queryKey: ['user-service-offers', userPubkey] })
          queryClient.invalidateQueries({ queryKey: ['user-all-offers', userPubkey] })
        }
        form.reset()
        clearDraft()
        setCurrentFormStep(0)
        onClose()
        onCreated?.()
      } else {
        const errData = await response.json()
        setDialogError(errData.error || 'Failed to create offer.')
      }
    } catch (error) {
      console.error('Failed to create offer:', error)
      setDialogError('Failed to create offer. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Schedule helpers ──────────────────────────────────────────────────

  const scheduleDate = form.values.scheduledAt
    ? new Date(form.values.scheduledAt)
    : null

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

  // ─── Step validation ─────────────────────────────────────────────────────

  const validRootSlugs = useMemo(() => getChildren('_root').map(c => c.slug), [getChildren])

  function validateFormStep(step: number): boolean {
    const stepErrors: Record<string, string> = {}

    if (step === 0) {
    }

    if (step === 1) {
      // ADR-085: Catalog OR Category must be selected
      const hasCategory = validRootSlugs.includes(form.values.category)
      const hasCatalog = form.selectedCatalogId !== null
      if (!hasCategory && !hasCatalog) {
        stepErrors.category = 'Please select a category or catalog'
      }
    }

    if (step === 2) {
      if (!form.values.title.trim()) {
        stepErrors.title = 'Title is required'
      }
      if (!richTextToPlainText(form.values.description).trim()) {
        stepErrors.description = 'Description is required'
      }
      if (!form.values.priceSats || Number(form.values.priceSats) <= 0) {
        stepErrors.priceSats = 'Price must be greater than 0'
      }
      // ADR-085: Stock required for PRODUCT/corporate (min 1)
      if (form.needsStock && (!form.values.stock || parseInt(form.values.stock) < 1)) {
        stepErrors.stock = 'Stock must be at least 1'
      }
      if (form.values.isScheduled && !form.values.scheduledAt) {
        stepErrors.scheduledAt = 'Please select a date and time'
      }
    }

    setErrors(prev => ({ ...prev, [step]: stepErrors }))
    return Object.keys(stepErrors).length === 0
  }

  // ─── Step Content (plain functions returning JSX – rendered via FormStepper display:none) ─

  function modalStep1() {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {/* ── Context Toggle (Private ↔ Corporate) – only for ITEM ── */}
        {/* PRODUCT: context is always 'corporate' (enforced by useOfferForm hook) */}
        {form.selectedOfferType === 'ITEM' && (
          <Box>
            <Typography variant="overline" color="text.disabled" sx={{ fontSize: '0.65rem', letterSpacing: '0.08em', mb: 0.5, display: 'block' }}>
              Context
            </Typography>
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              {([
                { value: 'private' as const, label: 'Private', icon: <PersonOutline sx={{ fontSize: 16 }} />, description: 'Sell directly to buyers — no platform in the middle.' },
                { value: 'corporate' as const, label: 'Corporate', icon: <BusinessOutlined sx={{ fontSize: 16 }} />, description: 'Add items to your company catalog for buyers to discover.' },
              ]).map(card => {
                const selected = form.selectedContext === card.value
                return (
                  <Paper
                    key={card.value}
                    onClick={() => form.setSelectedContext(card.value)}
                    elevation={selected ? 4 : 0}
                    variant={selected ? 'elevation' : 'outlined'}
                    sx={{
                      flex: 1,
                      p: 2,
                      cursor: 'pointer',
                      borderRadius: 'var(--radius-md, 8px)',
                      borderColor: selected ? 'primary.main' : 'divider',
                      borderWidth: selected ? 2 : 1,
                      borderStyle: 'solid',
                      transition: 'box-shadow 150ms, border-color 150ms',
                      '&:hover': { borderColor: 'primary.main' },
                      outline: 'none',
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                      <Box sx={{ color: selected ? 'primary.main' : 'action', display: 'flex' }}>{card.icon}</Box>
                      <Typography variant="body2" fontWeight={700} color={selected ? 'text.primary' : 'text.secondary'}>
                        {card.label}
                      </Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary" display="block" lineHeight={1.5}>
                      {card.description}
                    </Typography>
                  </Paper>
                )
              })}
            </Box>
          </Box>
        )}

        {/* ── Help text (dynamic per context) ── */}
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
          {headerContent.helpText}
        </Typography>

        <QuickCreateBanner
          description="Essential fields only. For multiple photos, full address, and detailed options, switch to the full form."
          onSwitchToFullForm={handleSwitchToFullForm}
        />

        {/* ── Ticket Type Intro (SMART_ORDER / MILESTONE) ── */}
        {form.showsTicketType && (
          <TypeIntro
            selectedType={form.values.ticketType}
            onSelect={(t) => form.setValues({ ticketType: t })}
            variant={form.selectedOfferType === 'SERVICE' ? 'service' : 'offer'}
          />
        )}
      </Box>
    )
  }

  function modalStep2() {
    const stepErrs = errors[1] ?? {}
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {/* ── Standard Category (3-Level Master Taxonomy) ── */}
        {standardCategories.length > 0 && (
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }}>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>
              Category Classification
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
              Assign this {form.selectedOfferType === 'SERVICE' ? 'service' : form.selectedOfferType === 'PRODUCT' ? 'product' : 'item'} to the standard taxonomy. Select each level to narrow down.
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              {/* Level 1: Root Categories */}
              {/* ADR-085: disabled when catalog selected – L1 is inherited from catalog.standardCategoryId */}
              <TextField
                select
                label="Root Category (Level 1)"
                value={form.values.category}
                onChange={(e) => {
                  form.setValues({ category: e.target.value, subcategory: '' })
                  if (stepErrs.category) clearErrorsForStep(1)
                }}
                fullWidth
                required
                disabled={form.selectedCatalogId !== null}
                error={!!stepErrs.category}
                helperText={
                  stepErrs.category ||
                  (form.selectedCatalogId !== null
                    ? 'Master category overridden by selected catalog'
                    : "The top-level classification: Goods, Digital, or Services")
                }
              >
                {getChildren('_root').map(cat => (
                  <MenuItem key={cat.id} value={cat.slug}>{cat.name}</MenuItem>
                ))}
              </TextField>

              {/* Level 2: Subcategories */}
              {getChildren(form.values.category).length > 0 && (
                <TextField
                  select
                  label="Subcategory (Level 2)"
                  value={activeL2Slug}
                  onChange={(e) => form.setValues({ subcategory: e.target.value })}
                  fullWidth
                  helperText="Refine the catalog category with a more specific subcategory"
                >
                  <MenuItem value="">None</MenuItem>
                  {getChildren(form.values.category).map(cat => (
                    <MenuItem key={cat.id} value={cat.slug}>
                      {'\u00A0\u00A0'}{cat.name}
                      {getChildren(cat.slug).length > 0 && ` (${getChildren(cat.slug).length} sub)`}
                    </MenuItem>
                  ))}
                </TextField>
              )}

              {/* Level 3: Detail categories */}
              {activeL2Slug && getChildren(activeL2Slug).length > 0 && (
                <TextField
                  select
                  label="Detail Category (Level 3)"
                  value={subcategoryLevel === 3 ? form.values.subcategory : ''}
                  onChange={(e) => form.setValues({ subcategory: e.target.value })}
                  fullWidth
                  helperText="Most specific classification available"
                >
                  <MenuItem value="">None</MenuItem>
                  {getChildren(activeL2Slug).map(cat => (
                    <MenuItem key={cat.id} value={cat.slug}>
                      {'\u00A0\u00A0\u00A0\u00A0'}{cat.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </Box>
          </Paper>
        )}

        {/* ── Catalog Selector (Corporate only) ── */}
        {form.needsCatalog && (
          <>
            {form.loadingCatalogs ? (
              <Typography variant="body2" color="text.secondary">Loading catalogs…</Typography>
            ) : form.companyCatalogs.length === 0 ? (
              <Alert severity="warning">
                No catalogs found. Create a catalog first in the Sell → Catalog section.
              </Alert>
            ) : (
              <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }}>
                <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                  Company Catalog
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
                  Link this offer to a company catalog for corporate buyers to discover.
                </Typography>
                <TextField
                  label="Catalog"
                  select
                  value={form.selectedCatalogId || ''}
                  onChange={(e) => {
                    form.setSelectedCatalogId(e.target.value || null)
                    form.setSelectedProductId(null)
                    if (stepErrs.catalog) clearErrorsForStep(1)
                  }}
                  fullWidth
                  required={form.needsCatalog}
                  error={!!stepErrs.catalog}
                  helperText={stepErrs.catalog || "Selecting a catalog will override the master category selection"}
                >
                  <MenuItem value="">None</MenuItem>
                  {form.companyCatalogs.map(catalog => (
                    <MenuItem key={catalog.id} value={catalog.id}>{catalog.name}</MenuItem>
                  ))}
                </TextField>
                {form.selectedCatalogId && form.catalogProducts.length > 0 && (
                  <TextField
                    select
                    label="Product"
                    value={form.selectedProductId || ''}
                    onChange={(e) => form.setSelectedProductId(e.target.value || null)}
                    fullWidth
                    sx={{ mt: 2 }}
                    helperText="Optionally link to an existing product in this catalog"
                  >
                    {form.catalogProducts.map(p => (
                      <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                    ))}
                  </TextField>
                )}
              </Paper>
            )}
          </>
        )}
      </Box>
    )
  }

  function modalStep3() {
    const stepErrs = errors[2] ?? {}
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {/* ── Title ── */}
        <TextField
          label={form.selectedOfferType === 'SERVICE' ? 'Service title' : form.selectedOfferType === 'PRODUCT' ? 'Product Name' : 'Title'}
          value={form.values.title}
          onChange={(e) => {
            form.setValues({ title: e.target.value })
            if (stepErrs.title) clearErrorsForStep(2)
          }}
          placeholder={form.selectedOfferType === 'SERVICE' ? 'e.g. Logo Design for your Brand' : form.selectedOfferType === 'PRODUCT' ? 'e.g. Organic Apple Juice 500ml' : 'e.g. Organic Apple Juice from Miller Farm'}
          required
          fullWidth
          error={!!stepErrs.title}
          helperText={stepErrs.title || ' '}
        />

        {/* ── Description (ADR-295: WYSIWYG + AI assist) ── */}
        <RichDescriptionEditor
          value={form.values.description}
          onChange={(html) => {
            form.setValues({ description: html })
            if (stepErrs.description) clearErrorsForStep(2)
          }}
          helperText={stepErrs.description || (form.selectedOfferType === 'SERVICE' ? 'Describe what you offer, your process, and what the client receives…' : 'Describe your product or service…')}
          required
          error={!!stepErrs.description}
          aiContext={{
            title: form.values.title,
            offerType: form.selectedOfferType,
            category: form.values.subcategory || form.values.category || undefined,
          }}
        />

        {/* ── Price + Stock ── */}
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <SatsAmountInput
              label={form.selectedOfferType === 'SERVICE' ? 'Rate' : 'Price'}
              valueSats={form.values.priceSats === '' ? '' : Number(form.values.priceSats)}
              onChangeSats={(sats) => {
                form.setValues({ priceSats: sats === '' ? '' : String(sats) })
                if (stepErrs.priceSats) clearErrorsForStep(2)
              }}
              required
              error={!!stepErrs.priceSats}
              helperText={stepErrs.priceSats || undefined}
            />
          </Grid>
          {form.needsStock && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Stock / Amount"
                type="number"
                value={form.values.stock}
                onChange={(e) => {
                  form.setValues({ stock: e.target.value })
                  if (stepErrs.stock) clearErrorsForStep(2)
                }}
                placeholder="e.g. 100 units"
                inputProps={{ min: 1 }}
                required
                fullWidth
                error={!!stepErrs.stock}
                helperText={stepErrs.stock || ' '}
              />
            </Grid>
          )}
        </Grid>

        {/* ── Location (Private ITEM only) ── */}
        {form.selectedOfferType === 'ITEM' && form.selectedContext === 'private' && (
          <Box>
            <Typography variant="subtitle2" fontWeight={600} color="text.secondary" gutterBottom>
              Location
            </Typography>
            <TextField
              label="ZIP / Postal Code (optional)"
              value={form.values.location}
              onChange={(e) => form.setValues({ location: e.target.value })}
              placeholder="e.g. 80331, SW1A, 10001, 75008"
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
          </Box>
        )}

        {/* ── Images (Multi) ── */}
        <Box>
          <Typography variant="subtitle2" fontWeight={600} color="text.secondary" gutterBottom>
            {form.values.images.length > 1 ? 'Photos' : 'Image'}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
            Up to 5 photos. The marked cover photo is shown in listings.
          </Typography>
          <MultiImageUploadInput
            values={form.values.images}
            onChange={(urls) => form.setValues({ images: urls })}
            maxImages={5}
            primaryIndex={primaryImageIndex}
            onPrimaryChange={setPrimaryImageIndex}
          />
        </Box>

        {/* ── Available Toggle (Corporate PRODUCT only) ── */}
        {form.selectedOfferType === 'PRODUCT' && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              p: 2,
              borderRadius: 2,
              bgcolor: form.values.isAvailable ? 'success.50' : 'action.hover',
              border: '1px solid',
              borderColor: form.values.isAvailable ? 'success.200' : 'divider',
            }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Typography variant="subtitle2" fontWeight={600}>
                Available
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {form.values.isAvailable ? 'Visible to buyers' : 'Hidden from catalog'}
              </Typography>
            </Box>
            <Switch
              checked={form.values.isAvailable}
              onChange={(e) => form.setValues({ isAvailable: e.target.checked })}
              color="success"
            />
          </Box>
        )}

        {/* ── Milestones (only when MILESTONE selected) ── */}
        {form.showsTicketType && (
          <MilestoneEditor
            milestones={form.milestones}
            onMilestonesChange={form.setMilestones}
            color={form.selectedOfferType === 'SERVICE' ? 'secondary' : 'primary'}
            visible={form.values.ticketType === 'MILESTONE'}
          />
        )}

        {/* ── Delivery Conditions (ITEM/SERVICE with SMART_ORDER) ── */}
        {form.showsTicketType && form.values.ticketType === 'SMART_ORDER' && (
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }}>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>
              Delivery Conditions
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Define shipping or delivery terms for this offer.
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Delivery Time (Days)"
                  type="number"
                  value={form.values.deliveryTimeDays}
                  onChange={(e) => form.setValues({ deliveryTimeDays: e.target.value })}
                  placeholder="e.g. 3"
                  inputProps={{ min: 1, max: 90 }}
                  fullWidth
                  size="small"
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <ScheduleOutlinedIcon fontSize="small" color="action" />
                        </InputAdornment>
                      ),
                    },
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Delivery Cost (Sats)"
                  type="number"
                  value={form.values.deliveryCostSats}
                  onChange={(e) => form.setValues({ deliveryCostSats: e.target.value })}
                  placeholder="e.g. 500"
                  inputProps={{ min: 0 }}
                  fullWidth
                  size="small"
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <BoltIcon fontSize="small" color="primary" />
                        </InputAdornment>
                      ),
                    },
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <TextField
                  label="Additional Delivery Information (optional)"
                  value={form.values.deliveryNotes}
                  onChange={(e) => form.setValues({ deliveryNotes: e.target.value })}
                  placeholder="e.g. Local pickup only, Express shipping available..."
                  multiline
                  rows={2}
                  fullWidth
                  size="small"
                />
              </Grid>
            </Grid>
          </Paper>
        )}

        {/* ── Schedule Publishing ── */}
        <Box
          sx={{
            p: 2,
            borderRadius: 2,
            border: '1px solid',
            borderColor: form.values.isScheduled ? 'primary.200' : 'divider',
            bgcolor: form.values.isScheduled ? 'action.hover' : 'transparent',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <ScheduleOutlinedIcon fontSize="small" color={form.values.isScheduled ? 'primary' : 'action'} />
              <Typography variant="subtitle2" fontWeight={600}>
                {form.values.isScheduled ? 'Scheduled Publishing' : 'Publishing'}
              </Typography>
            </Box>
            <Switch
              checked={form.values.isScheduled}
              onChange={(e) => {
                form.setValues({ isScheduled: e.target.checked, scheduledAt: e.target.checked ? new Date().toISOString() : null })
              }}
              size="small"
            />
          </Box>
          <Typography variant="caption" color="text.secondary">
            {form.values.isScheduled
              ? 'Choose a date and time to publish automatically.'
              : 'Publish immediately after confirmation.'}
          </Typography>
          {/* ADR-085: Always show both descriptions */}
          {!form.values.isScheduled && (
            <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 0.25 }}>
              Or enable Schedule to publish later
            </Typography>
          )}
          {form.values.isScheduled && (
            <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 0.25 }}>
              Or disable Schedule to publish immediately
            </Typography>
          )}

          {form.values.isScheduled && (
            <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={de}>
              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <DatePicker
                    label="Date"
                    value={scheduleDate}
                    onChange={handleScheduleDateChange}
                    slotProps={{ textField: { fullWidth: true, size: 'small' } }}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TimePicker
                    label="Time"
                    value={scheduleDate}
                    onChange={handleScheduleTimeChange}
                    slotProps={{ textField: { fullWidth: true, size: 'small' } }}
                  />
                </Grid>
              </Grid>
            </LocalizationProvider>
          )}
        </Box>

        {/* ── Privacy & Visibility (ADR-152) ── */}
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <LockOutlinedIcon fontSize="small" color="action" />
            <Typography variant="subtitle2" fontWeight={700}>
              Privacy & Visibility
            </Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2, lineHeight: 1.5 }}>
            Choose how this offer is shared with buyers. Private mode uses NIP-17 encrypted DMs.
          </Typography>

          <Box sx={{ display: 'flex', gap: 1.5 }}>
            {([
              {
                value: 'PUBLIC' as const,
                label: 'Public',
                icon: <PublicIcon sx={{ fontSize: 18 }} />,
                description: 'Listed in global search index. Reputation builds. DAO dispute resolution.',
              },
              {
                value: 'PRIVATE' as const,
                label: 'Private',
                icon: <LockOutlinedIcon sx={{ fontSize: 18 }} />,
                description: 'NIP-17 DM only. No public discovery. No reputation. Opt-in arbiter.',
              },
            ]).map(card => {
              const selected = form.values.visibility === card.value
              return (
                <Paper
                  key={card.value}
                  onClick={() => {
                    form.setValues({
                      visibility: card.value,
                      // ADR-152: disputeMode follows visibility (PRIVATE ↔ PRIVATE, PUBLIC ↔ PUBLIC)
                      disputeMode: card.value === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
                    })
                  }}
                  elevation={selected ? 4 : 0}
                  variant={selected ? 'elevation' : 'outlined'}
                  sx={{
                    flex: 1,
                    p: 2,
                    cursor: 'pointer',
                    borderRadius: 'var(--radius-md, 8px)',
                    borderColor: selected ? 'primary.main' : 'divider',
                    borderWidth: selected ? 2 : 1,
                    borderStyle: 'solid',
                    transition: 'box-shadow 150ms, border-color 150ms',
                    '&:hover': { borderColor: 'primary.main' },
                    outline: 'none',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                    <Box sx={{ color: selected ? 'primary.main' : 'action', display: 'flex' }}>{card.icon}</Box>
                    <Typography variant="body2" fontWeight={700} color={selected ? 'text.primary' : 'text.secondary'}>
                      {card.label}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" display="block" lineHeight={1.5}>
                    {card.description}
                  </Typography>
                </Paper>
              )
            })}
          </Box>

          {/* ── Private trade: reputation notice (Phase 4.5) ── */}
          {form.values.visibility === 'PRIVATE' && <PrivateReputationNotice />}

          {/* ── Dispute Mode (only when PRIVATE) ── */}
          {form.values.visibility === 'PRIVATE' && (
            <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <GavelOutlinedIcon fontSize="small" color="action" />
                <Typography variant="subtitle2" fontWeight={700}>
                  Dispute Mode
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5, lineHeight: 1.5 }}>
                Choose how disputes are handled for this private offer.
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {([
                  {
                    value: 'PRIVATE' as const,
                    label: 'Mutual Arbiter',
                    icon: <GroupsOutlinedIcon sx={{ fontSize: 16 }} />,
                    description: 'Both parties nominate and accept a third-party arbiter via DM.',
                  },
                  {
                    value: 'NONE' as const,
                    label: 'No Dispute Protection',
                    icon: <BlockOutlinedIcon sx={{ fontSize: 16 }} />,
                    description: 'No structured dispute path — recommended only for trusted counterparties.',
                  },
                ]).map(opt => {
                  const selected = form.values.disputeMode === opt.value
                  return (
                    <Paper
                      key={opt.value}
                      onClick={() => form.setValues({ disputeMode: opt.value })}
                      elevation={0}
                      variant="outlined"
                      sx={{
                        p: 1.5,
                        cursor: 'pointer',
                        borderRadius: 'var(--radius-sm, 6px)',
                        borderColor: selected ? 'primary.main' : 'divider',
                        borderWidth: selected ? 2 : 1,
                        borderStyle: 'solid',
                        bgcolor: selected ? 'action.hover' : 'transparent',
                        transition: 'border-color 150ms, bgcolor 150ms',
                        '&:hover': { borderColor: 'primary.main' },
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                        <Box sx={{ color: selected ? 'primary.main' : 'action', display: 'flex' }}>{opt.icon}</Box>
                        <Typography variant="body2" fontWeight={600} color={selected ? 'text.primary' : 'text.secondary'}>
                          {opt.label}
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary" display="block" lineHeight={1.5} sx={{ pl: 3 }}>
                        {opt.description}
                      </Typography>
                    </Paper>
                  )
                })}
              </Box>
            </Box>
          )}
        </Paper>
      </Box>
    )
  }

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <Modal open={open} onClose={handleClose} size="full">
      <ModalHeader
        title={headerContent.title}
        subtitle={headerContent.subtitle}
        titleVariant="h5"
        onClose={handleClose}
      />
      <ModalContent>
        <FormStepper
          steps={MODAL_FORM_STEPS}
          currentStep={currentFormStep}
          onStepChange={setCurrentFormStep}
          onContinue={validateFormStep}
          onLastStepComplete={handleConfirm}
          continueLabel={currentFormStep === 2 ? (form.values.isScheduled ? 'Schedule Offer' : 'Publish Offer') : 'Next'}
          backLabel="Back"
        >
          {modalStep1()}
          {modalStep2()}
          {modalStep3()}
        </FormStepper>
      </ModalContent>

      {dialogError && (
        <Box sx={{ px: 3, pb: 1 }}>
          <Alert severity="error" onClose={() => setDialogError(null)}>
            {dialogError}
          </Alert>
        </Box>
      )}
    </Modal>
  )
}
