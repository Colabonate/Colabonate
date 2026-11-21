// ESCROW-COPY (ADR-397): payment wording here assumes Direct-Pay. On escrow activation follow docs/plans/ESCROW-COPY-REACTIVATION.md.
import { useState, useMemo, useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { setPref } from '../../utils/userPreferences'
import {
  Alert,
  Box,
  Button,
  Grid,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Switch,
  TextField,
  Tooltip,
  Typography,
  Chip,
  Checkbox,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined'
import PlaceIcon from '@mui/icons-material/Place'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import CategoryOutlinedIcon from '@mui/icons-material/CategoryOutlined'
import WorkOutlineOutlinedIcon from '@mui/icons-material/WorkOutlineOutlined'
import PersonOutline from '@mui/icons-material/PersonOutline'
import BusinessOutlined from '@mui/icons-material/BusinessOutlined'
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined'
import CloudOutlinedIcon from '@mui/icons-material/CloudOutlined'
import HandshakeOutlinedIcon from '@mui/icons-material/HandshakeOutlined'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import PublicIcon from '@mui/icons-material/Public'
import GavelOutlinedIcon from '@mui/icons-material/GavelOutlined'
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined'
import BlockOutlinedIcon from '@mui/icons-material/BlockOutlined'
import AddIcon from '@mui/icons-material/Add'
import { DatePicker } from '@mui/x-date-pickers/DatePicker'
import { TimePicker } from '@mui/x-date-pickers/TimePicker'
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { de } from 'date-fns/locale/de'
import { useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom'
import { PageContainer, FormStepper } from '@ds/ui'
import { useTheme } from '@ds/utils'
import { PageHeader } from '../../components/PageHeader'
import { apiCall, ApiError } from '../../lib/api'
import { MultiImageUploadInput } from '../../components/offers/MultiImageUploadInput'
import { RichDescriptionEditor, richTextToPlainText } from '../../components/offers'
import { SatsAmountInput } from '../../components/currency/SatsAmountInput'
import { SatsAmount } from '../../components/currency/SatsAmount'
import { PrivateReputationNotice } from '../../components/offers/PrivateReputationNotice'
import { GammaTagInput } from '../../components/offers/GammaTagInput'
import { DEFAULT_MILESTONES, type MilestoneFormItem, COUNTRY_OPTIONS, LANGUAGE_OPTIONS, getBrowserLanguage } from '../../components/offers/offerFormConstants'
import type { StandardCategory, VariantAxis, VariationItem } from '../../types/api'
import { formatVariantLabel, isValidTimezone, zonedDateToUtc } from '@col/nostr-schema'
import { TypeIntroPage } from '../../components/offers/TypeIntro'
import { SERVICE_OFFER_CONTENT } from '../../components/offers/serviceOfferContent'
import { useOfferForm, type OfferType, type OfferFormValues } from '../../hooks/useOfferForm'
import { useBookableResourcesMine } from '../../hooks/useBookingQueries'
import { publishAvailabilityOccurrences, publishBookableCalendar, type BookableResourceDTO } from '../../lib/booking'
import { LocationPicker } from '../../components/map/LocationPicker'

// ─── Constants ───────────────────────────────────────────────────────────────

const DEMO_PUBKEYS = ['test-buyer-pubkey']

// ─── Form Steps (ADR-268, ADR-270) ──────────────────────────────────────────

const FORM_STEPS = [
  { id: 0, label: 'Offer Type', description: 'Choose what you offer' },
  { id: 1, label: 'Classification', description: 'Category & Catalog' },
  { id: 2, label: 'Content', description: 'Title, description & photos' },
  { id: 3, label: 'Attributes & Variants', description: 'Attributes & variant matrix' },
  { id: 4, label: 'Logistics & Terms', description: 'Location, delivery & payment structure' },
  { id: 5, label: 'Publishing', description: 'Visibility, scheduling & disputes' },
  { id: 6, label: 'Preview', description: 'Review before you publish' },
]

// ADR-271 D6: the Availability & Booking step appears only when
// bookingMode ≠ NONE. It is inserted at position 5 (before Publishing); the
// following steps shift by one — all index-based logic uses formSteps/lastStepIndex.
const BOOKING_STEP = { id: 5, label: 'Availability & Booking', description: 'Calendar, capacity & confirmation' }

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const PRICE_UNIT_OPTIONS: Array<{ value: string; label: string; modes: Array<'DATE_RANGE' | 'SESSION'> }> = [
  { value: 'per_night', label: 'per night', modes: ['DATE_RANGE'] },
  { value: 'per_day', label: 'per day', modes: ['DATE_RANGE'] },
  { value: 'per_seat', label: 'per seat', modes: ['SESSION'] },
  { value: 'per_hour', label: 'per hour', modes: ['SESSION'] },
  { value: 'flat', label: 'flat (whole booking)', modes: ['DATE_RANGE', 'SESSION'] },
]

/** 'HH:mm' → minutes from midnight. */
function hhmmToMinutes(v: string): number {
  const [h, m] = v.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return NaN
  return h * 60 + m
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function countCombinations(axes: VariantAxis[]): number {
  const validAxes = axes.filter(a => a.name.trim() && a.values.length > 0)
  if (validAxes.length === 0) return 0
  return validAxes.reduce((acc, a) => acc * a.values.length, 1)
}

function generateVariantCombinations(axes: VariantAxis[]): Array<Record<string, string>> {
  const validAxes = axes.filter(a => a.name.trim() && a.values.length > 0)
  if (validAxes.length === 0) return []

  return validAxes.reduce<Array<Record<string, string>>>((acc, axis) => {
    if (acc.length === 0) {
      return axis.values.map(val => ({ [axis.name.trim()]: val }))
    }
    const next: Array<Record<string, string>> = []
    for (const item of acc) {
      for (const val of axis.values) {
        next.push({ ...item, [axis.name.trim()]: val })
      }
    }
    return next
  }, [])
}

interface PrefillState {
  title?: string
  description?: string
  priceSats?: string
  category?: string
  location?: string
  ticketType?: 'SMART_ORDER' | 'MILESTONE'
  imageUrl?: string
  images?: string[]
  isScheduled?: boolean
  scheduledAt?: string | null
  stock?: string
  isAvailable?: boolean
}

interface CreateOfferPageProps {
  mode?: 'listings' | 'default'
}

interface RouterState {
  prefill?: PrefillState
  milestoneItems?: MilestoneFormItem[]
}

function serializeLocation(loc: { street: string; city: string; zip: string; country: string }): string | undefined {
  const parts = [loc.street, loc.city, loc.zip, loc.country].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : undefined
}

// ─── ADR-268 D3/D4/D5: shared checkmark bits ──────────────────────────────
// Small presentational helpers reused by the inline "section complete" rows
// (D4) and the Preview step's per-group card headers (D5). `CheckmarkBadge`
// is the same inline SVG check idiom already used throughout step1()/step2()
// (e.g. the selected-card badge), just extracted since it's now needed
// outside a single selectable-card context.

function CheckmarkBadge({ size = 20 }: { size?: number }) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        bgcolor: 'var(--color-status-success)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <svg width={size * 0.55} height={size * 0.4} viewBox="0 0 12 9" fill="none">
        <path d="M1 4.5L4.5 8L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Box>
  )
}

function SectionCompleteRow({ label }: { label: string }) {
  return (
    <Box className="step-complete-pop" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <CheckmarkBadge size={20} />
      <Typography variant="body2" fontWeight={600} sx={{ color: 'var(--color-status-success)' }}>
        {label}
      </Typography>
    </Box>
  )
}

function PreviewCardHeader({ title, onEdit }: { title: string; onEdit: () => void }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <CheckmarkBadge size={22} />
        <h5 className="!mt-0 !mb-0 !text-[var(--theme-text)]">{title}</h5>
      </Box>
      <Button
        size="small"
        variant="text"
        onClick={onEdit}
        sx={{ textTransform: 'none', fontWeight: 600, minWidth: 0, color: 'var(--theme-text-secondary)' }}
      >
        Edit
      </Button>
    </Box>
  )
}

function PreviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, py: 0.5 }}>
      <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', flexShrink: 0 }}>{label}</Typography>
      <Typography variant="body2" sx={{ color: 'var(--theme-text)', textAlign: 'right', fontWeight: 600 }}>{value}</Typography>
    </Box>
  )
}

// ─── Draft persistence (localStorage) ─────────────────────────────────────────
// Keeps the in-progress creation flow (current step + all field values) alive
// across a page reload, until the offer is actually submitted (see submitOffer).
// Skipped whenever the page was opened with router-state prefill (duplicate /
// edit flows) so a stale local draft can't clobber deliberately passed data.

interface PersistedOfferDraft {
  step: number
  values: Partial<OfferFormValues>
  milestoneItems: MilestoneFormItem[]
  location: { street: string; city: string; zip: string; country: string }
  selectedCountry: string
  isRemote: boolean
  selectedLanguage: string
  primaryImageIndex: number
  offerType: OfferType
  context: 'private' | 'corporate'
}

function draftStorageKey(mode: 'listings' | 'default'): string {
  return `colabonate_offer_draft_${mode}`
}

function readPersistedDraft(mode: 'listings' | 'default'): PersistedOfferDraft | null {
  try {
    const raw = localStorage.getItem(draftStorageKey(mode))
    if (!raw) return null
    const draft = JSON.parse(raw) as PersistedOfferDraft
    // Older drafts may have persisted `context: 'coop'` (a launch marker that
    // leaked in before validation was added) — coerce to a real context value.
    if (draft.context !== 'private' && draft.context !== 'corporate') {
      draft.context = 'private'
    }
    return draft
  } catch {
    return null
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CreateOfferPage({ mode = 'default' }: CreateOfferPageProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { state } = useLocation() as { state: RouterState | null }
  const prefill = state?.prefill
  const [searchParams] = useSearchParams()

  const typeParam = searchParams.get('type')?.toUpperCase() as OfferType | null
  // Only the two real context values are valid here. `?context=coop` is a
  // launch marker (see `isCoopContext` below), not a context selection — it must
  // not leak into `useOfferForm` or neither card renders as selected. Unknown
  // values fall through to the `'private'` default below.
  const rawContextParam = searchParams.get('context')
  const contextParam: 'private' | 'corporate' | null =
    rawContextParam === 'private' || rawContextParam === 'corporate' ? rawContextParam : null
  // ADR-368 D8/D5: `?context=coop` marks creation launched from the Cooperate
  // surfaces — after a successful create/draft we land back in the Cooperate
  // Manage "Services" tab instead of /sell/listings. All other contexts
  // (corporate, private, listings) keep the default post-create target.
  const isCoopContext = rawContextParam === 'coop'

  // The Sell entry (`mode="listings"`) is goods-only (ADR-368 D2): services have
  // their own Cooperate entry and never show up in Sell → Listings.
  const allowedOfferTypes: OfferType[] = mode === 'listings' ? ['ITEM', 'PRODUCT'] : ['ITEM', 'PRODUCT', 'SERVICE']
  const urlOfferType = typeParam && allowedOfferTypes.includes(typeParam) ? typeParam : null

  // Persisted draft from a previous, unfinished session — never applied on top
  // of an explicit router-state prefill (e.g. "duplicate offer"), and never
  // when the link asks for a different offer type: an explicit `?type=` is the
  // user's intent for THIS flow, an old draft must not silently switch it
  // (ADR-395 follow-up: a stale SERVICE draft turned a "Product" entry into a
  // service that never appeared in Sell → Listings).
  const [persistedDraft] = useState(() => {
    if (prefill) return null
    const draft = readPersistedDraft(mode)
    if (!draft) return null
    if (urlOfferType && draft.offerType !== urlOfferType) return null
    if (!allowedOfferTypes.includes(draft.offerType)) return null
    return draft
  })

  const initialOfferType: OfferType = persistedDraft?.offerType ?? urlOfferType ?? (mode === 'listings' ? 'PRODUCT' : 'ITEM')

  const [_submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitErrorCode, setSubmitErrorCode] = useState('')
  const [primaryImageIndex, setPrimaryImageIndex] = useState(persistedDraft?.primaryImageIndex ?? 0)
  const [currentFormStep, setCurrentFormStep] = useState(persistedDraft?.step ?? 0)
  const [errors, setErrors] = useState<Record<number, Record<string, string>>>({})
  // ADR-268 D3: steps the caller (this component) considers fully valid —
  // purely additive, mirrors `errors` bookkeeping in handleFormStepperContinue.
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set())

  const form = useOfferForm({
    offerType: initialOfferType,
    context: persistedDraft?.context ?? contextParam ?? 'private',
    initialValues: {
      title: prefill?.title ?? '',
      description: prefill?.description ?? '',
      priceSats: prefill?.priceSats ?? '',
      category: prefill?.category ?? 'Goods',
      ticketType: prefill?.ticketType ?? 'SMART_ORDER',
      imageUrl: prefill?.imageUrl ?? '',
      images: prefill?.images ?? (prefill?.imageUrl ? [prefill.imageUrl] : []),
      location: prefill?.location ?? '',
      isScheduled: prefill?.isScheduled ?? false,
      scheduledAt: prefill?.scheduledAt ?? null,
      stock: prefill?.stock ?? '',
      isAvailable: prefill?.isAvailable ?? true,
      ...persistedDraft?.values,
    },
  })

  // Load milestones from router state, a persisted draft, or defaults
  const [milestoneItems, setMilestoneItems] = useState<MilestoneFormItem[]>(
    state?.milestoneItems ?? persistedDraft?.milestoneItems ?? DEFAULT_MILESTONES
  )

  // Location: separate street/city/zip/country (full-form has more fields than modal)
  const [location, setLocation] = useState({
    street: persistedDraft?.location?.street ?? '',
    city: persistedDraft?.location?.city ?? '',
    zip: persistedDraft?.location?.zip ?? prefill?.location ?? '',
    country: persistedDraft?.location?.country ?? '',
  })

  const [selectedCountry, setSelectedCountry] = useState(persistedDraft?.selectedCountry ?? '')
  const [isRemote, setIsRemote] = useState(persistedDraft?.isRemote ?? false)
  const [selectedLanguage, setSelectedLanguage] = useState(persistedDraft?.selectedLanguage ?? getBrowserLanguage())
  // ADR-406 FU-916: optional exact pin; without it the server geocodes city+country.
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  // ADR-271 D6: conditional step — the wizard grows by one step when the offer
  // is bookable. All step-index logic below uses formSteps / lastStepIndex.
  const bookingActive = form.values.bookingMode !== 'NONE'
  const formSteps = useMemo(
    () => bookingActive
      ? [...FORM_STEPS.slice(0, 5), BOOKING_STEP, ...FORM_STEPS.slice(5).map(s => ({ ...s, id: s.id + 1 }))]
      : FORM_STEPS,
    [bookingActive],
  )
  const lastStepIndex = formSteps.length - 1
  const bookingStepIndex = 5
  const publishingStepIndex = bookingActive ? 6 : 5
  const myPubkey = localStorage.getItem('pubkey') ?? undefined
  const resourcesQuery = useBookableResourcesMine(bookingActive ? myPubkey : undefined)

  // Persist the in-progress flow on every change so a reload restores it —
  // cleared on successful submit (see submitOffer).
  useEffect(() => {
    try {
      const draft: PersistedOfferDraft = {
        step: currentFormStep,
        values: form.values,
        milestoneItems,
        location,
        selectedCountry,
        isRemote,
        selectedLanguage,
        primaryImageIndex,
        offerType: form.selectedOfferType,
        context: form.selectedContext,
      }
      localStorage.setItem(draftStorageKey(mode), JSON.stringify(draft))
    } catch (error) {
      console.error('Failed to persist offer draft:', error)
    }
  }, [
    mode, currentFormStep, form.values, form.selectedOfferType, form.selectedContext,
    milestoneItems, location, selectedCountry, isRemote, selectedLanguage, primaryImageIndex,
  ])

  // Deep-link preselection: "New Product" inside a catalog navigates here with
  // ?catalogId= — once the company catalogs are loaded, select it explicitly.
  // This is a conscious user choice carried through the URL, not the silent
  // auto-selection ADR-085 ruled out. Only applies while nothing is selected.
  const catalogIdParam = searchParams.get('catalogId')
  const { companyCatalogs, loadingCatalogs: catalogsLoading, selectedCatalogId: currentCatalogId, setSelectedCatalogId } = form
  useEffect(() => {
    if (!catalogIdParam || catalogsLoading) return
    if (currentCatalogId) return
    if (companyCatalogs.some(c => c.id === catalogIdParam)) {
      setSelectedCatalogId(catalogIdParam)
    }
  }, [catalogIdParam, catalogsLoading, currentCatalogId, companyCatalogs, setSelectedCatalogId])

  // Load product details as prefill when an existing product is selected
  // (ADR-395: "Listing for an existing product").
  useEffect(() => {
    if (!form.isExistingProductListing || !form.selectedProductId || !form.selectedCatalogId) return
    
    let cancelled = false
    async function fetchProductDetails() {
      try {
        const res = await apiCall(`/api/catalog/${form.selectedCatalogId}`)
        const data = await res.json()
        if (cancelled || !data.catalog?.products) return
        
        const product = data.catalog.products.find((p: any) => p.id === form.selectedProductId)
        if (!product || cancelled) return

        // Parse images from JSON if needed
        let images: string[] = []
        if (product.images) {
          try {
            images = JSON.parse(product.images)
          } catch {
            images = product.images ? [product.images] : []
          }
        }

        // Prefill form with product details
        form.setValues(prev => ({
          ...prev,
          title: product.name || prev.title,
          description: product.description || prev.description,
          priceSats: product.priceSats?.toString() || prev.priceSats,
          images: images.length > 0 ? images : prev.images,
          stock: product.stock?.toString() || prev.stock,
        }))
      } catch (e) {
        console.error('Failed to fetch product details:', e)
      }
    }
    
    fetchProductDetails()
    return () => { cancelled = true }
  }, [form.selectedProductId, form.selectedCatalogId, form.isExistingProductListing])

  // StandardCategories (3-level master taxonomy, same source as BuyDashboard)
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
    const allBySlug = new Map<string, StandardCategory>()
    for (const cat of standardCategories) {
      allBySlug.set(cat.slug, cat)
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
    return { bySlug, allBySlug }
  }, [standardCategories])

  // Fix invalid category values on first load (e.g. 'Goods' → 'goods', 'Cooperation' → 'services')
  const [categoryFixed, setCategoryFixed] = useState(false)
  useEffect(() => {
    if (standardCategories.length === 0 || categoryFixed) return
    const roots = categoryTree.bySlug.get('_root') ?? []
    const l1Slugs = new Set(roots.map(c => c.slug))

    const current = form.values.category
    let mapped = current
    if (!l1Slugs.has(current)) {
      const lowerMatch = roots.find(c => c.name.toLowerCase() === current.toLowerCase())
      if (lowerMatch) {
        mapped = lowerMatch.slug
      } else if (current === 'Cooperation') {
        mapped = 'services'
      } else {
        mapped = roots.length > 0 ? roots[0].slug : 'goods'
      }
    }
    if (mapped !== current) {
      form.setValues({ category: mapped, subcategory: '' })
    }
    setCategoryFixed(true)
  }, [standardCategories.length])

  // Helper: get children of a category by its slug (stable reference)
  const getChildren = useCallback((slug: string): StandardCategory[] => {
    return categoryTree.bySlug.get(slug) ?? []
  }, [categoryTree.bySlug])

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
  }, [form.values.category, form.values.subcategory, standardCategories.length])

  // Derive categoryCode: subcategory already contains the full slug path
  const selectedCategoryCode = useMemo(() => {
    return form.values.subcategory || form.values.category || undefined
  }, [form.values.category, form.values.subcategory])

  const userPubkey = localStorage.getItem('pubkey')

  const milestonePercentageSum = useMemo(
    () => milestoneItems.reduce((s, m) => s + (m.percentage || 0), 0),
    [milestoneItems]
  )
  const milestoneValid = form.values.ticketType !== 'MILESTONE' || milestonePercentageSum === 100

  function updateMilestone(i: number, field: keyof MilestoneFormItem, value: string | number) {
    setMilestoneItems(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: value } : m))
  }

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

  async function submitOffer(status: 'DRAFT' | 'ACTIVE' | 'SCHEDULED' = 'ACTIVE') {
    if (status !== 'DRAFT' && !milestoneValid) return
    if (status !== 'DRAFT' && !validateFormStep(1)) return
    if (status !== 'DRAFT' && !form.isValid) {
      setSubmitError('Please fill in all required fields.')
      return
    }
    if (!userPubkey || DEMO_PUBKEYS.includes(userPubkey)) {
      setSubmitError('Demo mode: Offer creation is disabled. Please log in with a real wallet.')
      return
    }
    // ADR-395: only a listing for an EXISTING product needs a product picked —
    // a new product is created by this very submit (catalog optional).
    if (form.isExistingProductListing && (!form.selectedCatalogId || !form.selectedProductId)) {
      validateFormStep(1)
      setCurrentFormStep(1)
      setSubmitError('Select the existing product for this listing, or switch to "New product".')
      return
    }
    if (form.selectedOfferType === 'PRODUCT' && form.ownCompanyId === null) {
      setCurrentFormStep(0)
      setSubmitError('Products belong to a company. Set up your company profile first.')
      return
    }
    if (!form.values.title) {
      setSubmitError('Title is required.')
      return
    }
    if (status === 'SCHEDULED' && !form.values.scheduledAt) {
      setSubmitError('Please select a date and time for scheduled publishing.')
      return
    }

    setSubmitError('')
    setSubmitErrorCode('')
    setSubmitting(true)
    try {
      const payload = form.buildPayload(userPubkey)
      const body: Record<string, unknown> = { ...payload }

      if (status === 'DRAFT') {
        body.status = 'DRAFT'
      }

      // Override location with full structured location
      body.location = serializeLocation(location)

      // Structured geo fields (ADR-139)
      body.country = selectedCountry || undefined
      body.region = isRemote ? undefined : (location.street ? undefined : undefined)
      body.city = isRemote ? undefined : (location.city || undefined)
      // ADR-406 FU-916: an explicit pin wins over city/country geocoding.
      if (coords && !isRemote) {
        body.lat = coords.lat
        body.lng = coords.lng
      }
      body.isRemote = isRemote
      body.language = selectedLanguage

      // Override images to put primary first
      const orderedImages = primaryImageIndex === 0
        ? form.values.images
        : [form.values.images[primaryImageIndex], ...form.values.images.filter((_, i) => i !== primaryImageIndex)]
      body.images = orderedImages

      // Add milestones if MILESTONE type
      if (form.values.ticketType === 'MILESTONE') {
        body.milestones = milestoneItems.map((m, i) => ({ ...m, sortOrder: i }))
      }

      // ADR-395: products and corporate offers all go through POST /api/offers,
      // which validates ownership and (for new products) creates the Product
      // row in the same transaction — so every wizard field reaches the offer
      // the storefront and listings render (location, tags, specs, delivery…).
      if (form.needsCatalog && form.ownCompanyId) body.companyId = form.ownCompanyId
      if (form.isExistingProductListing) {
        body.productId = form.selectedProductId
      } else if (form.selectedOfferType === 'PRODUCT' || (form.needsCatalog && form.selectedCatalogId)) {
        body.createProduct = true
        if (form.selectedCatalogId) body.catalogId = form.selectedCatalogId
      }

      // ADR-271: when bookable, create the resource FIRST and link the offer
      // to it (many offers → one resource → one calendar).
      let createdResource: BookableResourceDTO | null = null
      if (form.values.bookingMode !== 'NONE') {
        if (status !== 'DRAFT' && !validateBookingStep()) {
          setSubmitting(false)
          setCurrentFormStep(bookingStepIndex)
          return
        }
        if (form.values.resourceId === 'new') {
          const isSpace = form.values.bookingMode === 'DATE_RANGE'
          const isOpenSession = !isSpace && form.values.sessionStyle === 'OPEN'
          const tz = form.values.resourceTimezone
          const rule = isSpace
            ? {
                ruleKind: 'DATE_RANGE' as const,
                validFrom: form.values.resourceOpenFrom ? zonedDateToUtc(form.values.resourceOpenFrom, tz).toISOString() : null,
                validUntil: form.values.resourceOpenUntil ? zonedDateToUtc(form.values.resourceOpenUntil, tz).toISOString() : null,
              }
            : {
                ruleKind: 'WEEKLY_WINDOW' as const,
                weekday: parseInt(form.values.sessionWeekday, 10),
                startMinute: hhmmToMinutes(form.values.sessionStart),
                endMinute: hhmmToMinutes(form.values.sessionEnd),
              }
          const resourceRes = await apiCall('/api/resources', {
            method: 'POST',
            body: JSON.stringify({
              kind: isSpace ? 'SPACE' : 'SESSION',
              title: form.values.resourceTitle.trim() || form.values.title,
              description: form.values.description || undefined,
              timezone: tz,
              // ADR-369: OPEN time-block resources are exclusive (capacity 1).
              capacity: isOpenSession ? 1 : (parseInt(form.values.resourceCapacity, 10) || 1),
              bookingStyle: isSpace ? undefined : (isOpenSession ? 'OPEN' : 'FIXED'),
              slotMinutes: isOpenSession ? 60 : undefined,
              minUnits: isSpace ? (parseInt(form.values.resourceMinUnits, 10) || null) : null,
              leadTimeHours: parseInt(form.values.resourceLeadTimeHours, 10) || 0,
              bufferMinutes: parseInt(form.values.resourceBufferMinutes, 10) || 0,
              country: selectedCountry || undefined,
              city: location.city || undefined,
              rules: [rule],
            }),
          })
          if (!resourceRes.ok) {
            const errData = await resourceRes.json().catch(() => ({}))
            setSubmitError((errData as { message?: string }).message ?? 'Failed to create the bookable resource.')
            return
          }
          createdResource = ((await resourceRes.json()) as { resource: BookableResourceDTO }).resource
        }
        body.resourceId = createdResource?.id ?? form.values.resourceId
      }

      const response = await apiCall('/api/offers', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (response.ok) {
        // Flow completed — the in-progress draft no longer needs to survive a reload.
        try { localStorage.removeItem(draftStorageKey(mode)) } catch { /* ignore */ }
        const result = await response.json()
        void (result.offer?.id || result.id)
        const createdPubkey = userPubkey ?? (result as { offer?: { creatorPubkey?: string }; creatorPubkey?: string }).offer?.creatorPubkey
          ?? (result as { creatorPubkey?: string }).creatorPubkey
        // Sync the user's home location to the offer's location so the new
        // item appears in "Nearby" / "Region" on the Home slider without a
        // separate /settings step. Falls back to body fields if the response
        // doesn't echo city/country (catalog-product + listing endpoints).
        const createdCity = (result as { offer?: { city?: string } }).offer?.city ?? body.city
        const createdCountry = (result as { offer?: { country?: string } }).offer?.country ?? body.country
        if (createdCity) setPref('userCity', createdCity)
        if (createdCountry) setPref('userCountry', createdCountry)
        queryClient.invalidateQueries({ queryKey: ['listings'] })
        queryClient.invalidateQueries({ queryKey: ['map-markers'] })
        queryClient.invalidateQueries({ queryKey: ['category-counts'] })
        if (createdPubkey) {
          queryClient.invalidateQueries({ queryKey: ['offers', createdPubkey] })
          queryClient.invalidateQueries({ queryKey: ['user-product-offers', createdPubkey] })
          queryClient.invalidateQueries({ queryKey: ['user-service-offers', createdPubkey] })
          queryClient.invalidateQueries({ queryKey: ['user-all-offers', createdPubkey] })
          // ADR-395: a new product shows up in Sell → Products and its catalog.
          queryClient.invalidateQueries({ queryKey: ['company-products', createdPubkey] })
          queryClient.invalidateQueries({ queryKey: ['user-catalogs', createdPubkey] })
        }
        queryClient.invalidateQueries({ queryKey: ['bookable-resources'] })

        // ADR-271 D3: publish the NIP-52 calendar + availability occurrences
        // for a NEWLY created resource, signed with the seller's key (never the
        // server's). Best-effort — the offer exists; the calendar can be
        // re-published from the sell area if relays were unreachable.
        if (createdResource && status !== 'DRAFT') {
          void (async () => {
            try {
              await publishBookableCalendar(createdResource!)
              await publishAvailabilityOccurrences(
                createdResource!,
                parseInt(form.values.priceSats, 10) || 0,
                (form.values.priceUnit || (createdResource!.kind === 'SPACE' ? 'per_night' : 'per_seat')) as 'per_night',
                (result as { offer?: { id?: string } }).offer?.id,
              )
            } catch (pubErr) {
              console.warn('[ADR-271] NIP-52 calendar publish failed (offer still created):', pubErr)
            }
          })()
        }
        // Land where the created offer is actually listed: services live in
        // Cooperate → Manage → Services (ADR-368 D2 — Sell → Listings shows
        // goods only), products in Sell → Listings filtered to products.
        const target = isCoopContext || form.selectedOfferType === 'SERVICE'
          ? '/coop/manage?tab=services'
          : form.selectedOfferType === 'PRODUCT' ? '/sell/listings?filter=products' : '/sell/listings'
        if (status === 'DRAFT') {
          setSubmitError('')
          setSubmitting(false)
          navigate(target)
          return
        }
        navigate(target)
      } else {
        // Dead in practice — apiCall() (FU-590) already throws an ApiError
        // for every non-2xx response before returning, so this branch never
        // runs. Kept in sync with the catch block below in case that ever
        // changes.
        const errData = await response.json()
        setSubmitError(errData.message || errData.error || 'Failed to create offer.')
        setSubmitErrorCode(typeof errData.error === 'string' ? errData.error : '')
      }
    } catch (error) {
      console.error('Failed to create offer:', error)
      setSubmitError(error instanceof Error ? error.message : 'Failed to publish offer.')
      // FU-801: apiCall() throws an ApiError whose `.data` carries the raw
      // server error code (`.message` is already the human-readable text,
      // per FU-590) — surface the code so the SELLER_PAYMENT_NOT_CONFIGURED
      // case below can add a direct link to Settings.
      setSubmitErrorCode(error instanceof ApiError && typeof error.data?.error === 'string' ? error.data.error : '')
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Dynamic header content ──────────────────────────────────────────
  const headerContent = useMemo(() => {
    if (form.isExistingProductListing) {
      return {
        title: 'Create Listing',
        subtitle: 'Create a new listing based on an existing product. Set custom price, photos, and publishing options.',
        helpText: 'The listing is linked to your product but can have different pricing, images, and availability. Multiple listings can reference the same product.',
      }
    }
    if (form.selectedOfferType === 'SERVICE') {
      return {
        title: SERVICE_OFFER_CONTENT.introTitle,
        subtitle: SERVICE_OFFER_CONTENT.introSubtitle,
        helpText: SERVICE_OFFER_CONTENT.introHelpText,
      }
    }
    if (form.selectedOfferType === 'PRODUCT') {
      return {
        title: 'Create Product',
        subtitle: 'Full creation for your product – optional catalog assignment, stock management, and scheduling.',
        helpText: 'Products belong to your company — assign a catalog now or later. Buyers pay you directly — no platform in the middle.',
      }
    }
    if (form.selectedContext === 'corporate') {
      return {
        title: 'Create Corporate Offer',
        subtitle: 'Full creation – add items to your company catalog with detailed location, multiple photos, and milestones.',
        helpText: 'Corporate items are linked to a catalog and category. Buyers pay you directly — no platform in the middle.',
      }
    }
    return {
      title: 'Create New Offer',
      subtitle: 'Full creation – more fields, multiple photos, detailed location.',
      helpText: 'Buyers pay you directly — no platform in the middle.',
    }
  }, [form.selectedOfferType, form.selectedContext, form.isExistingProductListing])

  function handleFormStepperContinue(step: number): boolean | void {
    let valid: boolean
    if (step === 2) valid = validateContentStep()
    else if (step === 3) valid = validateVariantsStep()
    else if (step === 4) valid = validateLogisticsStep()
    else if (step === bookingStepIndex) valid = bookingActive ? validateBookingStep() : validatePublishingStep()
    else if (step === 6) valid = bookingActive ? validatePublishingStep() : true
    else valid = validateFormStep(step)

    if (valid) {
      setCompletedSteps(prev => {
        if (prev.has(step)) return prev
        const next = new Set(prev)
        next.add(step)
        return next
      })
    }
    return valid
  }

  // ─── Step validation ─────────────────────────────────────────────────────

  const validRootSlugs = useMemo(() => getChildren('_root').map(c => c.slug), [getChildren])

  function validateFormStep(step: number): boolean {
    if (step === 0) {
      // ADR-395: products belong to a company — stop here, not at publish.
      if (form.selectedOfferType === 'PRODUCT' && form.ownCompanyId === null) {
        setErrors(prev => ({ ...prev, [0]: { company: 'Set up your company profile before creating products.' } }))
        return false
      }
      setErrors(prev => ({ ...prev, [0]: {} }))
      return true
    }
    if (step === 1) {
      // ADR-085: Catalog OR Category must be selected
      const hasCategory = validRootSlugs.includes(form.values.category)
      const hasCatalog = form.selectedCatalogId !== null
      if (!hasCategory && !hasCatalog) {
        setErrors(prev => ({ ...prev, [1]: { ...prev[1], category: 'Please select a category or catalog' } }))
        return false
      }
      // ADR-395: only a listing for an existing product needs catalog + product.
      if (form.isExistingProductListing) {
        if (!form.selectedCatalogId) {
          setErrors(prev => ({ ...prev, [1]: { ...prev[1], catalog: 'Choose the catalog that contains the product' } }))
          return false
        }
        if (!form.selectedProductId) {
          setErrors(prev => ({ ...prev, [1]: { ...prev[1], product: 'Choose the product this listing is for' } }))
          return false
        }
      }
      return true
    }
    return true
  }

  // ADR-268 D1, ADR-270 D3: validation split into group validators, one
  // per FormStepper step. Each pairs a pure `compute*Errors` with a `validate*Step`.

  function computeContentErrors(): Record<string, string> {
    const errs: Record<string, string> = {}
    if (!form.values.title.trim()) errs.title = 'Title is required'
    if (!richTextToPlainText(form.values.description).trim()) errs.description = 'Description is required'
    if (!form.values.priceSats || Number(form.values.priceSats) <= 0) errs.priceSats = 'Price must be greater than 0'
    // ADR-085: Stock required for PRODUCT/corporate (min 1)
    if (form.needsStock && (!form.values.stock || parseInt(form.values.stock) < 1)) {
      errs.stock = 'Stock must be at least 1'
    }
    return errs
  }

  function validateContentStep(): boolean {
    const errs = computeContentErrors()
    setErrors(prev => ({ ...prev, [2]: errs }))
    return Object.keys(errs).length === 0
  }

  function computeVariantsErrors(): Record<string, string> {
    const errs: Record<string, string> = {}
    if (form.values.productType === 'variable') {
      const axes = form.values.variantAxes || []
      if (axes.length === 0) {
        errs.variantAxes = 'Please add at least one variant axis or switch to Simple Product.'
      } else {
        for (let i = 0; i < axes.length; i++) {
          const axis = axes[i]
          if (!axis.name.trim()) errs[`axis_${i}_name`] = `Axis ${i + 1} name is required`
          if (!axis.values || axis.values.length === 0) {
            errs[`axis_${i}_values`] = `Axis "${axis.name || i + 1}" must have at least one value`
          }
        }
        const combCount = countCombinations(axes)
        if (combCount > 100) {
          errs.variantAxes = `Matrix exceeds 100 combinations cap (${combCount} combinations). Please reduce axes or values.`
        } else if (form.values.variations.length === 0) {
          errs.variations = 'Please generate the variant matrix combinations.'
        } else {
          const activeVars = form.values.variations.filter(v => v.listingVisibility !== 'hidden')
          if (activeVars.length === 0) {
            errs.variations = 'At least one variant must be enabled.'
          }
          for (let j = 0; j < activeVars.length; j++) {
            const v = activeVars[j]
            if (v.priceSats == null || v.priceSats <= 0) {
              errs[`var_${j}_price`] = 'Price must be greater than 0'
            }
          }
        }
      }
    }
    return errs
  }

  function validateVariantsStep(): boolean {
    const errs = computeVariantsErrors()
    setErrors(prev => ({ ...prev, [3]: errs }))
    return Object.keys(errs).length === 0
  }

  function computeLogisticsErrors(): Record<string, string> {
    const errs: Record<string, string> = {}
    if (!selectedCountry) errs.country = 'Please select a country'
    if (form.values.ticketType === 'MILESTONE' && milestonePercentageSum !== 100) {
      errs.milestones = `Milestone percentages must sum to 100% (currently ${milestonePercentageSum}%)`
    }
    return errs
  }

  function validateLogisticsStep(): boolean {
    const errs = computeLogisticsErrors()
    setErrors(prev => ({ ...prev, [4]: errs }))
    return Object.keys(errs).length === 0
  }

  function computePublishingErrors(): Record<string, string> {
    const errs: Record<string, string> = {}
    if (form.values.isScheduled && !form.values.scheduledAt) errs.scheduledAt = 'Please select a date and time'
    return errs
  }

  function validatePublishingStep(): boolean {
    const errs = computePublishingErrors()
    setErrors(prev => ({ ...prev, [publishingStepIndex]: errs }))
    return Object.keys(errs).length === 0
  }

  // ADR-271 D6: Availability & Booking validation. When an existing resource
  // is picked only the offer-level fields are checked; when authoring a new
  // one, the resource itself must be complete (timezone, capacity, one rule).
  function computeBookingErrors(): Record<string, string> {
    const errs: Record<string, string> = {}
    if (!form.values.priceUnit) errs.priceUnit = 'Pick a pricing unit'
    // ADR-369: OPEN time blocks are exclusive per-hour bookings.
    if (form.values.bookingMode === 'SESSION') {
      if (form.values.sessionStyle !== 'FIXED' && form.values.sessionStyle !== 'OPEN') errs.sessionStyle = 'Pick a session type'
      if (form.values.sessionStyle === 'OPEN' && form.values.priceUnit && form.values.priceUnit !== 'per_hour') {
        errs.priceUnit = 'Open time blocks are priced per hour'
      }
    }
    const minU = form.values.bookingMinUnits ? parseInt(form.values.bookingMinUnits, 10) : NaN
    const maxU = form.values.bookingMaxUnits ? parseInt(form.values.bookingMaxUnits, 10) : NaN
    if (form.values.bookingMinUnits && (!Number.isInteger(minU) || minU < 1)) errs.bookingMinUnits = 'Min units must be ≥ 1'
    if (form.values.bookingMaxUnits && (!Number.isInteger(maxU) || maxU < 1)) errs.bookingMaxUnits = 'Max units must be ≥ 1'
    if (Number.isInteger(minU) && Number.isInteger(maxU) && minU > maxU) errs.bookingMaxUnits = 'Max units must be ≥ min units'
    const cwh = parseInt(form.values.confirmationWindowHours || '24', 10)
    if (!Number.isInteger(cwh) || cwh < 1 || cwh > 168) errs.confirmationWindowHours = 'Confirmation window: 1–168 hours'

    if (form.values.resourceId === 'new') {
      if (form.values.resourceTitle.trim().length < 2) errs.resourceTitle = 'Resource title is required'
      if (!isValidTimezone(form.values.resourceTimezone)) errs.resourceTimezone = 'Enter a valid IANA timezone (e.g. Europe/Berlin)'
      const cap = parseInt(form.values.resourceCapacity, 10)
      if (!Number.isInteger(cap) || cap < 1) errs.resourceCapacity = 'Capacity must be ≥ 1'
      if (form.values.bookingMode === 'DATE_RANGE') {
        if (!form.values.resourceOpenFrom) errs.resourceOpenFrom = 'Opening start is required'
        if (!form.values.resourceOpenUntil) errs.resourceOpenUntil = 'Opening end is required'
        if (form.values.resourceOpenFrom && form.values.resourceOpenUntil && form.values.resourceOpenFrom >= form.values.resourceOpenUntil) {
          errs.resourceOpenUntil = 'Opening end must be after the start'
        }
      } else {
        const start = hhmmToMinutes(form.values.sessionStart)
        const end = hhmmToMinutes(form.values.sessionEnd)
        if (Number.isNaN(start) || Number.isNaN(end) || end <= start) errs.sessionEnd = 'End must be after the start time'
      }
    } else if (!form.values.resourceId) {
      errs.resourceId = 'Pick a resource or create a new one'
    }
    return errs
  }

  function validateBookingStep(): boolean {
    const errs = computeBookingErrors()
    setErrors(prev => ({ ...prev, [bookingStepIndex]: errs }))
    return Object.keys(errs).length === 0
  }

  // ─── Step Content (plain functions returning JSX – rendered via FormStepper display:none) ──

  function step1() {
    const selectedGreen = {
      accent: 'var(--color-action-secondary-default)',
      bg: 'rgba(33, 225, 104, 0.12)',
      iconBg: 'rgba(33, 225, 104, 0.12)',
    }

    const contextColors = {
      private: selectedGreen,
      corporate: selectedGreen,
    }

    const offerColors = {
      item: selectedGreen,
      product: selectedGreen,
      service: selectedGreen,
    }

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* ── Context Toggle (Private ↔ Corporate) – always visible ── */}
        <Paper
          variant="outlined"
          sx={{
            p: { xs: 2.5, sm: 3 },
            borderRadius: 'var(--radius-lg, 12px)',
            borderColor: 'var(--theme-border)',
            bgcolor: 'var(--theme-surface)',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: '10px',
                bgcolor: 'var(--color-primary-50)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <PersonOutline sx={{ fontSize: 18, color: 'white' }} />
            </Box>
            <h5 className="!mt-0 !mb-0 !text-[var(--theme-text)]">Context</h5>
          </Box>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
              gap: 2,
            }}
          >
            {([
              {
                value: 'private' as const,
                label: 'Private',
                icon: <PersonOutline sx={{ fontSize: 26 }} />,
                description: form.selectedOfferType === 'SERVICE' ? SERVICE_OFFER_CONTENT.contextPrivateDescription : 'Sell directly to buyers — no platform in the middle.',
              },
              {
                value: 'corporate' as const,
                label: 'Corporate',
                icon: <BusinessOutlined sx={{ fontSize: 26 }} />,
                description: form.selectedOfferType === 'SERVICE' ? SERVICE_OFFER_CONTENT.contextCorporateDescription : 'Add items to your company catalog for buyers to discover.',
              },
            ]).map(card => {
              const selected = form.selectedContext === card.value
              const colors = contextColors[card.value]
              return (
                <Box
                  key={card.value}
                  onClick={() => form.setSelectedContext(card.value)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && form.setSelectedContext(card.value)}
                  sx={{
                    position: 'relative',
                    p: 3,
                    borderRadius: 'var(--radius-md, 8px)',
                    border: '2px solid',
                    borderColor: selected ? colors.accent : 'var(--theme-border)',
                    bgcolor: selected ? colors.bg : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                    outline: 'none',
                    '&:hover': {
                      bgcolor: selected ? colors.bg : 'var(--theme-item-hover)',
                      transform: 'translateY(-2px)',
                      boxShadow: 'var(--theme-shadow)',
                    },
                    '&:focus-visible': {
                      boxShadow: `0 0 0 3px ${colors.accent}40`,
                    },
                  }}
                >
                  {selected && (
                    <Box
                      sx={{
                        position: 'absolute',
                        top: 10,
                        right: 10,
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        bgcolor: colors.accent,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <svg width="12" height="9" viewBox="0 0 12 9" fill="none">
                        <path d="M1 4.5L4.5 8L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </Box>
                  )}
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 1.5 }}>
                    <Box
                      sx={{
                        width: 52,
                        height: 52,
                        borderRadius: '14px',
                        bgcolor: selected ? colors.iconBg : 'var(--theme-bg-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: selected ? colors.accent : 'var(--theme-text-muted)',
                        transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                      }}
                    >
                      {card.icon}
                    </Box>
                    <Typography
                      variant="body2"
                      fontWeight={700}
                      sx={{
                        color: selected ? 'var(--theme-text)' : 'var(--theme-text-secondary)',
                        fontSize: '0.9375rem',
                        transition: 'color 200ms',
                      }}
                    >
                      {card.label}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        color: 'var(--theme-text-muted)',
                        lineHeight: 1.5,
                        fontSize: '0.75rem',
                        maxWidth: 200,
                      }}
                    >
                      {card.description}
                    </Typography>
                  </Box>
                </Box>
              )
            })}
          </Box>
        </Paper>

        {/* ── Corporate No Catalog Info (non-blocking) ── */}
        {form.selectedContext === 'corporate' && form.companyCatalogs.length === 0 && (
          <Paper
            variant="outlined"
            sx={{
              p: 3,
              borderRadius: 'var(--radius-lg, 12px)',
              borderColor: 'var(--theme-border)',
              bgcolor: 'var(--theme-surface)',
            }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: '10px',
                    bgcolor: 'var(--color-secondary-50)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <BusinessOutlined sx={{ fontSize: 22, color: 'white' }} />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" fontWeight={700} sx={{ color: 'var(--theme-text)', mb: 0.5 }}>
                    No catalog yet
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'var(--theme-text-secondary)', lineHeight: 1.6 }}>
                    Catalogs are optional. You can continue creating this corporate offer without one, or set up a catalog to organize your products and services.
                  </Typography>
                </Box>
              </Box>
              <Button
                variant="outlined"
                onClick={() => navigate('/sell/catalog/new')}
                sx={{
                  alignSelf: 'flex-start',
                  borderColor: 'var(--theme-border)',
                  color: 'var(--theme-text)',
                }}
              >
                Create Catalog
              </Button>
            </Box>
          </Paper>
        )}

        {/* ── Offer Type Selector ── */}
        <Paper
          variant="outlined"
          sx={{
            p: { xs: 2.5, sm: 3 },
            borderRadius: 'var(--radius-lg, 12px)',
            borderColor: 'var(--theme-border)',
            bgcolor: 'var(--theme-surface)',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: '10px',
                bgcolor: 'var(--color-secondary-50)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Inventory2OutlinedIcon sx={{ fontSize: 18, color: 'white' }} />
            </Box>
            <h5 className="!mt-0 !mb-0 !text-[var(--theme-text)]">Offer Type</h5>
          </Box>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: `repeat(${allowedOfferTypes.length}, 1fr)` },
              gap: 2,
            }}
          >
            {([
              {
                value: 'ITEM' as const,
                label: 'Item',
                icon: <Inventory2OutlinedIcon sx={{ fontSize: 26 }} />,
                description: 'Sell a single article – one unit per buyer, paid directly to you.',
              },
              {
                value: 'PRODUCT' as const,
                label: 'Product',
                icon: <CategoryOutlinedIcon sx={{ fontSize: 26 }} />,
                description: 'Unlimited quantity, auto-accepted orders, managed in your company catalog.',
              },
              {
                value: 'SERVICE' as const,
                label: 'Service',
                icon: <WorkOutlineOutlinedIcon sx={{ fontSize: 26 }} />,
                description: 'Offer your expertise. Buyer pays you directly, you accept before work begins.',
              },
            ]).filter(card => allowedOfferTypes.includes(card.value)).map(card => {
              const selected = form.selectedOfferType === card.value
              const colors = offerColors[card.value.toLowerCase() as 'item' | 'product' | 'service']
              return (
                <Box
                  key={card.value}
                  onClick={() => form.setSelectedOfferType(card.value)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && form.setSelectedOfferType(card.value)}
                  sx={{
                    position: 'relative',
                    p: 3,
                    borderRadius: 'var(--radius-md, 8px)',
                    border: '2px solid',
                    borderColor: selected ? colors.accent : 'var(--theme-border)',
                    bgcolor: selected ? colors.bg : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                    outline: 'none',
                    '&:hover': {
                      bgcolor: selected ? colors.bg : 'var(--theme-item-hover)',
                      transform: 'translateY(-2px)',
                      boxShadow: 'var(--theme-shadow)',
                    },
                    '&:focus-visible': {
                      boxShadow: `0 0 0 3px ${colors.accent}40`,
                    },
                    ...(selected && {
                      boxShadow: `0 4px 16px ${colors.accent}20`,
                    }),
                  }}
                >
                  {selected && (
                    <Box
                      sx={{
                        position: 'absolute',
                        top: 10,
                        right: 10,
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        bgcolor: colors.accent,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <svg width="12" height="9" viewBox="0 0 12 9" fill="none">
                        <path d="M1 4.5L4.5 8L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </Box>
                  )}
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 1.5 }}>
                    <Box
                      sx={{
                        width: 52,
                        height: 52,
                        borderRadius: '14px',
                        bgcolor: selected ? colors.iconBg : 'var(--theme-bg-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: selected ? colors.accent : 'var(--theme-text-muted)',
                        transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                      }}
                    >
                      {card.icon}
                    </Box>
                    <Typography
                      variant="body2"
                      fontWeight={700}
                      sx={{
                        color: selected ? 'var(--theme-text)' : 'var(--theme-text-secondary)',
                        fontSize: '0.9375rem',
                        transition: 'color 200ms',
                      }}
                    >
                      {card.label}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        color: 'var(--theme-text-muted)',
                        lineHeight: 1.5,
                        fontSize: '0.75rem',
                        maxWidth: 180,
                      }}
                    >
                      {card.description}
                    </Typography>
                  </Box>
                </Box>
              )
            })}
          </Box>
        </Paper>

        {/* ADR-395: products belong to a company — say so before any work is done. */}
        {form.selectedOfferType === 'PRODUCT' && form.ownCompanyId === null && (
          <Alert
            severity={errors[0]?.company ? 'error' : 'warning'}
            action={
              <Button component={Link} to="/sell/company" size="small" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                Set up company
              </Button>
            }
          >
            Products belong to your company profile. Set up your company first — then you can create products with or without a catalog.
          </Alert>
        )}

        {/* Section: Order Type Introduction */}
        {form.showsTicketType && (
          <TypeIntroPage
            selectedType={form.values.ticketType}
            onSelect={(t) => form.setValues({ ticketType: t })}
            variant={form.selectedOfferType === 'SERVICE' ? 'service' : 'offer'}
          />
        )}
      </Box>
    )
  }

  function step2() {
    const stepErrs = errors[1] ?? {}

    const categoryIcons: Record<string, React.ReactNode> = {
      goods: <Inventory2OutlinedIcon sx={{ fontSize: 28 }} />,
      digital: <CloudOutlinedIcon sx={{ fontSize: 28 }} />,
      services: <HandshakeOutlinedIcon sx={{ fontSize: 28 }} />,
    }

    const categoryDescriptions: Record<string, string> = {
      goods: 'Physical products like electronics, clothing, food, or handmade items. Shipped or delivered to buyers.',
      digital: 'Downloadable or accessible content like software, templates, courses, or digital media.',
      services: 'Work performed for clients like consulting, development, design, or tutoring.',
    }

    const selectedGreen = {
      accent: 'var(--color-action-secondary-default)',
      bg: 'rgba(33, 225, 104, 0.12)',
      iconBg: 'rgba(33, 225, 104, 0.12)',
    }

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* Section: Category Classification (Master – 3 levels for ALL types) */}
        {standardCategories.length > 0 && categoryFixed && (
          <Paper
            variant="outlined"
            sx={{
              p: { xs: 2.5, sm: 3 },
              borderRadius: 'var(--radius-lg, 12px)',
              borderColor: 'var(--theme-border)',
              bgcolor: 'var(--theme-surface)',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: '10px',
                  bgcolor: 'var(--color-accent-4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <CategoryOutlinedIcon sx={{ fontSize: 18, color: 'white' }} />
              </Box>
              <h5 className="!mt-0 !mb-0 !text-[var(--theme-text)]">Category Classification</h5>
            </Box>

            <Typography variant="body2" sx={{ mb: 3, lineHeight: 1.6, color: 'var(--theme-text-secondary)' }}>
              Choose the main category for your {form.selectedOfferType === 'SERVICE' ? 'service' : form.selectedOfferType === 'PRODUCT' ? 'product' : 'item'}. You can refine it further with subcategories.
            </Typography>

            {/* ADR-085: locked when the selected catalog carries its own category */}
            {form.catalogCategoryLocked && (
              <Alert severity="info" sx={{ mb: 3 }}>
                Category is set by the selected catalog
              </Alert>
            )}

            {/* Level 1: Root Categories as large cards */}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
                gap: 2,
                mb: 3,
              }}
            >
              {getChildren('_root').map(cat => {
                const catKey = cat.slug.split('/')[0]
                const selected = form.values.category === cat.slug
                const isDisabled = form.catalogCategoryLocked

                return (
                  <Box
                    key={cat.slug}
                    onClick={() => {
                      if (isDisabled) return
                      form.setValues({ category: cat.slug, subcategory: '' })
                      if (stepErrs.category) setErrors(prev => ({ ...prev, [1]: { ...prev[1], category: '' } }))
                    }}
                    role="button"
                    tabIndex={isDisabled ? -1 : 0}
                    onKeyDown={(e) => {
                      if (isDisabled) return
                      if (e.key === 'Enter') {
                        form.setValues({ category: cat.slug, subcategory: '' })
                        if (stepErrs.category) setErrors(prev => ({ ...prev, [1]: { ...prev[1], category: '' } }))
                      }
                    }}
                    sx={{
                      position: 'relative',
                      p: 3,
                      borderRadius: 'var(--radius-md, 8px)',
                      border: '2px solid',
                      borderColor: selected ? selectedGreen.accent : 'var(--theme-border)',
                      bgcolor: selected ? selectedGreen.bg : 'transparent',
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                      opacity: isDisabled ? 0.5 : 1,
                      transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                      outline: 'none',
                      ...(isDisabled ? {} : {
                        '&:hover': {
                          bgcolor: selected ? selectedGreen.bg : 'var(--theme-item-hover)',
                          transform: 'translateY(-2px)',
                          boxShadow: 'var(--theme-shadow)',
                        },
                        '&:focus-visible': {
                          boxShadow: `0 0 0 3px ${selectedGreen.accent}40`,
                        },
                      }),
                    }}
                  >
                    {selected && (
                      <Box
                        sx={{
                          position: 'absolute',
                          top: 10,
                          right: 10,
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          bgcolor: selectedGreen.accent,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <svg width="12" height="9" viewBox="0 0 12 9" fill="none">
                          <path d="M1 4.5L4.5 8L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </Box>
                    )}
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 1.5 }}>
                      <Box
                        sx={{
                          width: 56,
                          height: 56,
                          borderRadius: '14px',
                          bgcolor: selected ? selectedGreen.iconBg : 'var(--theme-bg-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: selected ? selectedGreen.accent : 'var(--theme-text-muted)',
                          transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                        }}
                      >
                        {categoryIcons[catKey] || <CategoryOutlinedIcon sx={{ fontSize: 28 }} />}
                      </Box>
                      <Typography
                        variant="body2"
                        fontWeight={700}
                        sx={{
                          color: selected ? 'var(--theme-text)' : 'var(--theme-text-secondary)',
                          fontSize: '0.9375rem',
                          transition: 'color 200ms',
                        }}
                      >
                        {cat.name}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          color: 'var(--theme-text-muted)',
                          lineHeight: 1.5,
                          fontSize: '0.75rem',
                          maxWidth: 180,
                        }}
                      >
                        {categoryDescriptions[catKey] || `Products or services in the ${cat.name} category`}
                      </Typography>
                    </Box>
                  </Box>
                )
              })}
            </Box>

            {stepErrs.category && (
              <Typography variant="caption" color="error" sx={{ mt: 0.5, display: 'block', mb: 2 }}>
                {stepErrs.category}
              </Typography>
            )}

            {/* Level 2: Subcategories */}
            {getChildren(form.values.category).length > 0 && (
              <Box>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1.5, color: 'var(--theme-text-secondary)' }}>
                  Subcategory
                </Typography>
                <TextField
                  select
                  label="Select subcategory"
                  value={activeL2Slug}
                  onChange={(e) => form.setValues({ subcategory: e.target.value })}
                  fullWidth
                  helperText="Refine the category with a more specific subcategory"
                >
                  <MenuItem value="">None</MenuItem>
                  {getChildren(form.values.category).map(cat => (
                    <MenuItem key={cat.id} value={cat.slug}>
                      {'\u00A0\u00A0'}{cat.name}
                      {getChildren(cat.slug).length > 0 && ` (${getChildren(cat.slug).length} sub)`}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>
            )}

            {/* Level 3: Detail categories */}
            {activeL2Slug && getChildren(activeL2Slug).length > 0 && (
              <Box>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1.5, color: 'var(--theme-text-secondary)' }}>
                  Detail Category
                </Typography>
                <TextField
                  select
                  label="Select detail category"
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
              </Box>
            )}

            {/* Preview of derived categoryCode */}
            {selectedCategoryCode && (
              <Typography variant="caption" sx={{ mt: 1, color: 'var(--theme-text-muted)' }}>
                Category code: <code style={{ color: 'var(--color-action-secondary-default)' }}>{selectedCategoryCode}</code>
              </Typography>
            )}
          </Paper>
        )}

        {/* Section: Gamma tags (ADR-277 E1) — the flat, emergent second axis, independent of the
            standard category above. */}
        <Paper
          variant="outlined"
          sx={{
            p: { xs: 2.5, sm: 3 },
            borderRadius: 'var(--radius-lg, 12px)',
            borderColor: 'var(--theme-border)',
            bgcolor: 'var(--theme-surface)',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: '10px',
                bgcolor: 'var(--color-accent-4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CategoryOutlinedIcon sx={{ fontSize: 18, color: 'white' }} />
            </Box>
            <h5 className="!mt-0 !mb-0 !text-[var(--theme-text)]">Gamma Tags</h5>
          </Box>
          <Typography variant="body2" sx={{ mb: 2, lineHeight: 1.6, color: 'var(--theme-text-secondary)' }}>
            Optional. Helps buyers on other Nostr marketplaces find this listing — independent
            of the category above.
          </Typography>
          <GammaTagInput
            value={form.values.gammaTags}
            onChange={(tags) => form.setValues({ gammaTags: tags })}
            categoryCode={selectedCategoryCode || undefined}
          />
        </Paper>

        {/* Section: Product & Catalog (ADR-395). PRODUCT offers are either a
            NEW product (catalog optional — without one it lives under the
            company) or another listing for an EXISTING product (catalog +
            product required, validated on Continue — never first at publish). */}
        {form.needsCatalog && (() => {
          const isProduct = form.selectedOfferType === 'PRODUCT'
          const existing = form.isExistingProductListing
          const catalogsWithProducts = form.companyCatalogs.filter(c => (c.products?.length ?? 0) > 0)
          const catalogOptions = existing ? catalogsWithProducts : form.companyCatalogs
          const sourceCards = [
            {
              value: 'new' as const,
              label: 'New product',
              icon: <AddIcon sx={{ fontSize: 24 }} />,
              description: 'Create a product under your company. Adding it to a catalog is optional.',
              disabled: false,
            },
            {
              value: 'existing' as const,
              label: 'Listing for an existing product',
              icon: <Inventory2OutlinedIcon sx={{ fontSize: 24 }} />,
              description: catalogsWithProducts.length > 0
                ? 'Another listing (own price, photos, availability) for a product you already have.'
                : 'Available once one of your catalogs contains a product.',
              disabled: catalogsWithProducts.length === 0,
            },
          ]
          return (
            <Paper
              variant="outlined"
              sx={{
                p: { xs: 2.5, sm: 3 },
                borderRadius: 'var(--radius-lg, 12px)',
                borderColor: 'var(--theme-border)',
                bgcolor: 'var(--theme-surface)',
              }}
            >
              {isProduct && (
                <Box sx={{ mb: 4 }}>
                  <h5 className="!mt-0 !mb-0 !text-[var(--theme-text)]">What are you creating?</h5>
                  <Typography variant="body2" sx={{ mt: 1.5, mb: 2.5, lineHeight: 1.6, color: 'var(--theme-text-secondary)' }}>
                    Create a brand-new product, or publish another listing for a product that already exists in one of your catalogs.
                  </Typography>
                  <Box role="radiogroup" aria-label="Product source" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 2 }}>
                    {sourceCards.map(card => {
                      const selected = form.productSource === card.value
                      const choose = () => {
                        if (card.disabled) return
                        form.setProductSource(card.value)
                        setErrors(prev => ({ ...prev, [1]: { ...prev[1], catalog: '', product: '' } }))
                      }
                      return (
                        <Box
                          key={card.value}
                          onClick={choose}
                          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && choose()}
                          role="radio"
                          aria-checked={selected}
                          aria-disabled={card.disabled}
                          tabIndex={card.disabled ? -1 : 0}
                          sx={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 2,
                            p: 2.5,
                            borderRadius: 'var(--radius-md, 8px)',
                            border: '2px solid',
                            borderColor: selected ? 'var(--color-action-secondary-default)' : 'var(--theme-border)',
                            bgcolor: selected ? 'rgba(33, 225, 104, 0.12)' : 'transparent',
                            cursor: card.disabled ? 'not-allowed' : 'pointer',
                            opacity: card.disabled ? 0.55 : 1,
                            outline: 'none',
                            transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                            ...(card.disabled ? {} : {
                              '&:hover': { bgcolor: selected ? 'rgba(33, 225, 104, 0.12)' : 'var(--theme-item-hover)' },
                              '&:focus-visible': { boxShadow: '0 0 0 3px rgba(33, 225, 104, 0.4)' },
                            }),
                          }}
                        >
                          <Box
                            sx={{
                              width: 40,
                              height: 40,
                              flexShrink: 0,
                              borderRadius: '10px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              bgcolor: selected ? 'rgba(33, 225, 104, 0.12)' : 'var(--theme-bg-subtle)',
                              color: selected ? 'var(--color-action-secondary-default)' : 'var(--theme-text-muted)',
                            }}
                          >
                            {card.icon}
                          </Box>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" fontWeight={700} sx={{ color: 'var(--theme-text)' }}>
                              {card.label}
                            </Typography>
                            <Typography variant="body2" sx={{ mt: 0.75, lineHeight: 1.5, color: 'var(--theme-text-secondary)' }}>
                              {card.description}
                            </Typography>
                          </Box>
                        </Box>
                      )
                    })}
                  </Box>
                </Box>
              )}

              <h5 className="!mt-0 !mb-0 !text-[var(--theme-text)]">
                {/* FU-497: selects a Catalog, never a Company directly. */}
                {existing ? 'Catalog & product' : 'Catalog (optional)'}
              </h5>
              <Typography variant="body2" sx={{ mt: 1.5, mb: 2.5, lineHeight: 1.6, color: 'var(--theme-text-secondary)' }}>
                {existing
                  ? 'Choose the catalog and the product this listing belongs to. The product details are used as a starting point — you can adjust price, photos, and availability.'
                  : 'Group it in one of your catalogs, or leave it without one — it is then listed under your company. You can assign a catalog later in Sell → Products.'}
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {form.loadingCatalogs ? (
                  <Typography variant="body2" sx={{ color: 'var(--theme-text-secondary)' }}>Loading catalogs…</Typography>
                ) : form.companyCatalogs.length === 0 ? (
                  <Alert
                    severity="info"
                    action={
                      <Button component={Link} to="/sell/listings?tab=catalogs&create=catalog" size="small" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                        Create catalog
                      </Button>
                    }
                  >
                    You don’t have a catalog yet — no problem. Continue without one; you can assign a catalog later.
                  </Alert>
                ) : (
                  <>
                    <TextField
                      select
                      label="Catalog"
                      value={form.selectedCatalogId || ''}
                      onChange={(e) => {
                        form.setSelectedCatalogId(e.target.value || null)
                        form.setSelectedProductId(null)
                        if (stepErrs.catalog || stepErrs.product) setErrors(prev => ({ ...prev, [1]: { ...prev[1], catalog: '', product: '' } }))
                      }}
                      fullWidth
                      required={existing}
                      error={!!stepErrs.catalog}
                      helperText={stepErrs.catalog || (existing
                        ? 'Only catalogs that contain products are listed'
                        : 'A catalog with its own category also sets this product’s category')}
                      slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
                    >
                      <MenuItem value="" disabled={existing}>
                        {existing ? 'Select a catalog' : 'No catalog — list under my company'}
                      </MenuItem>
                      {catalogOptions.map(catalog => (
                        <MenuItem key={catalog.id} value={catalog.id}>{catalog.name}</MenuItem>
                      ))}
                    </TextField>

                    {existing && form.selectedCatalogId && (
                      <TextField
                        select
                        label="Product"
                        value={form.selectedProductId || ''}
                        onChange={(e) => {
                          form.setSelectedProductId(e.target.value || null)
                          if (stepErrs.product) setErrors(prev => ({ ...prev, [1]: { ...prev[1], product: '' } }))
                        }}
                        fullWidth
                        required
                        error={!!stepErrs.product}
                        helperText={stepErrs.product || 'The existing product this listing is for'}
                      >
                        {form.catalogProducts.length === 0 ? (
                          <MenuItem value="" disabled>No products in this catalog</MenuItem>
                        ) : (
                          form.catalogProducts.map(p => (
                            <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
                          ))
                        )}
                      </TextField>
                    )}
                  </>
                )}
              </Box>
            </Paper>
          )
        })()}
      </Box>
    )
  }

  function stepContent() {
    const stepErrs = errors[2] ?? {}
    const contentComplete = Object.keys(computeContentErrors()).length === 0
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {/* Basic Information + Photos pair up side by side from lg */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '3fr 2fr' }, gap: 5 }}>
          {/* Section: Basic Information */}
          <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
            <h5 className="!mt-0 !mb-0 !text-[var(--theme-text)]">Basic Information</h5>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 2.5 }}>
              <TextField
                label={form.selectedOfferType === 'SERVICE' ? SERVICE_OFFER_CONTENT.titleLabel : form.selectedOfferType === 'PRODUCT' ? 'Product Name' : 'Title'}
                value={form.values.title}
                onChange={(e) => {
                  form.setValues({ title: e.target.value })
                  if (stepErrs.title) setErrors(prev => ({ ...prev, [2]: { ...prev[2], title: '' } }))
                }}
                placeholder={form.selectedOfferType === 'SERVICE' ? SERVICE_OFFER_CONTENT.titlePlaceholder : form.selectedOfferType === 'PRODUCT' ? 'e.g. Organic Apple Juice 500ml' : 'e.g. Organic Apple Juice from Miller Farm'}
                required
                fullWidth
                error={!!stepErrs.title}
                helperText={stepErrs.title || ' '}
              />
              {/* ADR-295: WYSIWYG description editor with AI assist */}
              <RichDescriptionEditor
                value={form.values.description}
                onChange={(html) => {
                  form.setValues({ description: html })
                  if (stepErrs.description) setErrors(prev => ({ ...prev, [2]: { ...prev[2], description: '' } }))
                }}
                required
                error={!!stepErrs.description}
                helperText={stepErrs.description || (form.selectedOfferType === 'SERVICE' ? SERVICE_OFFER_CONTENT.descriptionHelper : 'Describe your product or service…')}
                aiContext={{
                  title: form.values.title,
                  offerType: form.selectedOfferType,
                  category: selectedCategoryCode,
                }}
              />
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <SatsAmountInput
                    label={form.selectedOfferType === 'SERVICE' ? SERVICE_OFFER_CONTENT.priceLabel : 'Price'}
                    valueSats={form.values.priceSats === '' ? '' : Number(form.values.priceSats)}
                    onChangeSats={(sats) => {
                      form.setValues({ priceSats: sats === '' ? '' : String(sats) })
                      if (stepErrs.priceSats) setErrors(prev => ({ ...prev, [2]: { ...prev[2], priceSats: '' } }))
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
                        if (stepErrs.stock) setErrors(prev => ({ ...prev, [2]: { ...prev[2], stock: '' } }))
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
            </Box>
          </Paper>

          {/* Section: Photos */}
          <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
            <h5 className="!mt-0 !mb-1.5 !text-[var(--theme-text)]">Photos</h5>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3, lineHeight: 1.5 }}>
              Up to 5 photos. The marked cover photo is shown in listings, sliders, and previews.
            </Typography>
            <MultiImageUploadInput
              values={form.values.images}
              onChange={(urls) => form.setValues({ images: urls })}
              maxImages={5}
              primaryIndex={primaryImageIndex}
              onPrimaryChange={setPrimaryImageIndex}
            />
          </Paper>
        </Box>

        {contentComplete && <SectionCompleteRow label="Content complete" />}
      </Box>
    )
  }

  function stepVariants() {
    const stepErrs = errors[3] ?? {}
    const variantsComplete = Object.keys(computeVariantsErrors()).length === 0
    const isVariable = form.values.productType === 'variable'
    const totalCombinations = countCombinations(form.values.variantAxes)
    const isOverCap = totalCombinations > 100

    // Attribute management
    const addAttribute = (key: string, value: string) => {
      if (!key.trim()) return
      const nextSpecs = [...form.values.specs, { key: key.trim(), value: value.trim() }]
      form.setValues({ specs: nextSpecs })
    }

    const removeAttribute = (index: number) => {
      const nextSpecs = form.values.specs.filter((_, i) => i !== index)
      form.setValues({ specs: nextSpecs })
    }

    const updateAttribute = (index: number, field: 'key' | 'value', text: string) => {
      const nextSpecs = form.values.specs.map((s, i) => (i === index ? { ...s, [field]: text } : s))
      form.setValues({ specs: nextSpecs })
    }

    // Axis management
    const addAxis = () => {
      if (form.values.variantAxes.length >= 3) return
      const defaultNames = ['Size', 'Colour', 'Material']
      const name = defaultNames[form.values.variantAxes.length] || `Axis ${form.values.variantAxes.length + 1}`
      form.setValues({
        variantAxes: [...form.values.variantAxes, { name, values: [] }],
      })
    }

    const removeAxis = (axisIndex: number) => {
      const nextAxes = form.values.variantAxes.filter((_, i) => i !== axisIndex)
      form.setValues({ variantAxes: nextAxes })
    }

    const updateAxisName = (axisIndex: number, name: string) => {
      const nextAxes = form.values.variantAxes.map((a, i) => (i === axisIndex ? { ...a, name } : a))
      form.setValues({ variantAxes: nextAxes })
    }

    const addAxisValue = (axisIndex: number, val: string) => {
      const trimmed = val.trim()
      if (!trimmed) return
      const axis = form.values.variantAxes[axisIndex]
      if (!axis || axis.values.length >= 12 || axis.values.includes(trimmed)) return
      const nextAxes = form.values.variantAxes.map((a, i) =>
        i === axisIndex ? { ...a, values: [...a.values, trimmed] } : a
      )
      form.setValues({ variantAxes: nextAxes })
    }

    const removeAxisValue = (axisIndex: number, valIndex: number) => {
      const nextAxes = form.values.variantAxes.map((a, i) =>
        i === axisIndex ? { ...a, values: a.values.filter((_, vi) => vi !== valIndex) } : a
      )
      form.setValues({ variantAxes: nextAxes })
    }

    // Matrix Generation & Reconcile
    const handleGenerateMatrix = () => {
      const combinations = generateVariantCombinations(form.values.variantAxes)
      if (combinations.length === 0 || combinations.length > 100) return
      const basePrice = form.values.priceSats ? parseInt(form.values.priceSats) : 0
      const baseStock = form.values.stock ? parseInt(form.values.stock) : 1

      const newVariations: VariationItem[] = combinations.map(comb => {
        // Try matching existing variation
        const existing = form.values.variations.find(v =>
          Object.entries(comb).every(([k, val]) => v.variantValues[k] === val)
        )
        if (existing) {
          return existing
        }
        return {
          priceSats: basePrice,
          stock: baseStock,
          sku: '',
          images: [],
          variantValues: comb,
          listingVisibility: 'on-sale',
        }
      })
      form.setValues({ variations: newVariations })
      if (stepErrs.variations) setErrors(prev => ({ ...prev, [3]: { ...prev[3], variations: '' } }))
    }

    const updateVariation = (index: number, updates: Partial<VariationItem>) => {
      const next = form.values.variations.map((v, i) => (i === index ? { ...v, ...updates } : v))
      form.setValues({ variations: next })
    }

    // Bulk actions
    const applyBasePriceToAll = () => {
      const basePrice = form.values.priceSats ? parseInt(form.values.priceSats) : 0
      const next = form.values.variations.map(v => ({ ...v, priceSats: basePrice }))
      form.setValues({ variations: next })
    }

    const applyBaseStockToAll = () => {
      const baseStock = form.values.stock ? parseInt(form.values.stock) : 1
      const next = form.values.variations.map(v => ({ ...v, stock: baseStock }))
      form.setValues({ variations: next })
    }

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {/* Attributes Section */}
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <h5 className="!mt-0 !mb-0 !text-[var(--theme-text)]">Product Attributes (Specs)</h5>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Descriptive properties like Material, Weight, Dimensions, Brand, etc. Published as repeatable specs.
          </Typography>

          {/* Existing specs */}
          {form.values.specs.length > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 3 }}>
              {form.values.specs.map((spec, i) => (
                <Box key={i} sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                  <TextField
                    size="small"
                    label="Attribute Name"
                    value={spec.key}
                    onChange={(e) => updateAttribute(i, 'key', e.target.value)}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    size="small"
                    label="Value"
                    value={spec.value}
                    onChange={(e) => updateAttribute(i, 'value', e.target.value)}
                    sx={{ flex: 2 }}
                  />
                  <IconButton size="small" onClick={() => removeAttribute(i)} color="error">
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Box>
          )}

          {/* Add spec inline form */}
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => addAttribute('Material', 'Cotton')}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              + Add Attribute
            </Button>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {['Material', 'Dimensions', 'Weight', 'Color', 'Brand'].map(tag => (
                <Chip
                  key={tag}
                  label={`+ ${tag}`}
                  size="small"
                  variant="outlined"
                  onClick={() => addAttribute(tag, '')}
                  sx={{ cursor: 'pointer' }}
                />
              ))}
            </Box>
          </Box>
        </Paper>

        {/* Variants Section */}
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <Box>
              <h5 className="!mt-0 !mb-0.5 !text-[var(--theme-text)]">Product Variants</h5>
              <Typography variant="body2" color="text.secondary">
                Sell this article in multiple sizes, colours, or configurations with individual prices and stock.
              </Typography>
            </Box>
            <Switch
              checked={isVariable}
              onChange={(e) => {
                const nextType = e.target.checked ? 'variable' : 'simple'
                form.setValues({ productType: nextType })
                if (nextType === 'variable' && form.values.variantAxes.length === 0) {
                  form.setValues({
                    variantAxes: [{ name: 'Size', values: ['S', 'M', 'L'] }],
                  })
                }
              }}
              color="primary"
            />
          </Box>

          {isVariable && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 3 }}>
              {/* Axes Builder */}
              <Box sx={{ p: 2.5, borderRadius: 'var(--radius-md, 8px)', bgcolor: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ color: 'var(--theme-text)' }}>
                    Variant Axes (max 3)
                  </Typography>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<AddIcon />}
                    onClick={addAxis}
                    disabled={form.values.variantAxes.length >= 3}
                    sx={{ textTransform: 'none', fontWeight: 600 }}
                  >
                    Add Axis
                  </Button>
                </Box>

                {form.values.variantAxes.map((axis, axisIndex) => (
                  <Paper key={axisIndex} variant="outlined" sx={{ p: 2, mb: 2, bgcolor: 'var(--theme-card-bg)' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                      <TextField
                        size="small"
                        label={`Axis ${axisIndex + 1} Name`}
                        value={axis.name}
                        onChange={(e) => updateAxisName(axisIndex, e.target.value)}
                        placeholder="e.g. Size or Colour"
                        sx={{ maxWidth: 220 }}
                      />
                      <IconButton size="small" onClick={() => removeAxis(axisIndex)} color="error">
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>

                    {/* Values tags */}
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}>
                      {axis.values.map((val, valIndex) => (
                        <Chip
                          key={valIndex}
                          label={val}
                          size="small"
                          onDelete={() => removeAxisValue(axisIndex, valIndex)}
                          color="primary"
                          variant="outlined"
                        />
                      ))}
                    </Box>

                    {/* Value Input */}
                    {axis.values.length < 12 ? (
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        <TextField
                          size="small"
                          placeholder="Type value and press Enter (e.g. M, Red)"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              addAxisValue(axisIndex, (e.target as HTMLInputElement).value)
                              ;(e.target as HTMLInputElement).value = ''
                            }
                          }}
                          sx={{ maxWidth: 300 }}
                        />
                        <Typography variant="caption" color="text.secondary">
                          {axis.values.length}/12 values
                        </Typography>
                      </Box>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        Maximum 12 values reached.
                      </Typography>
                    )}
                  </Paper>
                ))}

                {/* Combinations Info Banner */}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, mt: 2 }}>
                  <Typography variant="body2" sx={{ color: isOverCap ? 'var(--color-status-error)' : 'var(--theme-text-secondary)', fontWeight: 600 }}>
                    {totalCombinations} combinations calculated {isOverCap ? '(Exceeds cap of 100!)' : '(max 100)'}
                  </Typography>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={handleGenerateMatrix}
                    disabled={isOverCap || totalCombinations === 0}
                    sx={{ textTransform: 'none', fontWeight: 600 }}
                  >
                    Generate / Update Matrix ({totalCombinations})
                  </Button>
                </Box>
                {stepErrs.variantAxes && (
                  <Alert severity="error" sx={{ mt: 2 }}>{stepErrs.variantAxes}</Alert>
                )}
              </Box>

              {/* Variations Matrix Table */}
              {form.values.variations.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1.5 }}>
                    <Typography variant="subtitle2" fontWeight={700} sx={{ color: 'var(--theme-text)' }}>
                      Variant Matrix ({form.values.variations.filter(v => v.listingVisibility !== 'hidden').length} active)
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      <Button size="small" variant="outlined" onClick={applyBasePriceToAll} sx={{ textTransform: 'none' }}>
                        Set all prices to base ({form.values.priceSats || 0} sats)
                      </Button>
                      <Button size="small" variant="outlined" onClick={applyBaseStockToAll} sx={{ textTransform: 'none' }}>
                        Set all stock to {form.values.stock || 1}
                      </Button>
                    </Box>
                  </Box>

                  {stepErrs.variations && (
                    <Alert severity="error" sx={{ mb: 2 }}>{stepErrs.variations}</Alert>
                  )}

                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, maxHeight: 500, overflowY: 'auto', pr: 0.5 }}>
                    {form.values.variations.map((v, i) => {
                      const isHidden = v.listingVisibility === 'hidden'
                      const label = formatVariantLabel(v.variantValues)
                      return (
                        <Paper
                          key={i}
                          variant="outlined"
                          sx={{
                            p: 2,
                            opacity: isHidden ? 0.5 : 1,
                            bgcolor: isHidden ? 'var(--theme-bg-subtle)' : 'var(--theme-card-bg)',
                            borderColor: isHidden ? 'var(--theme-border)' : 'var(--theme-border-subtle)',
                          }}
                        >
                          <Grid container spacing={2} alignItems="center">
                            <Grid size={{ xs: 12, sm: 4 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Checkbox
                                  checked={!isHidden}
                                  onChange={(e) => updateVariation(i, { listingVisibility: e.target.checked ? 'on-sale' : 'hidden' })}
                                  size="small"
                                />
                                <Typography variant="body2" fontWeight={700} sx={{ color: 'var(--theme-text)' }}>
                                  {label}
                                </Typography>
                              </Box>
                            </Grid>
                            <Grid size={{ xs: 6, sm: 3 }}>
                              <TextField
                                size="small"
                                label="Price (sats)"
                                type="number"
                                value={v.priceSats ?? ''}
                                onChange={(e) => updateVariation(i, { priceSats: parseInt(e.target.value) || 0 })}
                                disabled={isHidden}
                                required
                                fullWidth
                              />
                            </Grid>
                            <Grid size={{ xs: 6, sm: 2 }}>
                              <TextField
                                size="small"
                                label="Stock"
                                type="number"
                                value={v.stock ?? ''}
                                onChange={(e) => updateVariation(i, { stock: parseInt(e.target.value) || 0 })}
                                disabled={isHidden}
                                fullWidth
                              />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 3 }}>
                              <TextField
                                size="small"
                                label="SKU (optional)"
                                value={v.sku ?? ''}
                                onChange={(e) => updateVariation(i, { sku: e.target.value })}
                                disabled={isHidden}
                                fullWidth
                              />
                            </Grid>
                          </Grid>
                        </Paper>
                      )
                    })}
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </Paper>

        {variantsComplete && <SectionCompleteRow label="Attributes & variants complete" />}
      </Box>
    )
  }

  function stepLogistics() {
    const stepErrs = errors[4] ?? {}
    const logisticsComplete = Object.keys(computeLogisticsErrors()).length === 0
    const showsDelivery = form.showsTicketType && form.values.ticketType === 'SMART_ORDER'

    const locationSection = (
      <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
        <h5 className="!mt-0 !mb-1.5 !text-[var(--theme-text)]">Location</h5>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3, lineHeight: 1.5 }}>
          Country helps buyers find offers in their region. Required for all offers.
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            select
            label="Country"
            value={selectedCountry}
            onChange={(e) => {
              setSelectedCountry(e.target.value)
              if (stepErrs.country) setErrors(prev => ({ ...prev, [4]: { ...prev[4], country: '' } }))
            }}
            fullWidth
            required
            error={!!stepErrs.country}
            helperText={stepErrs.country || 'Required for all offer types'}
          >
            <MenuItem value="">Select country…</MenuItem>
            {COUNTRY_OPTIONS.map(c => (
              <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>
            ))}
          </TextField>

          {form.selectedOfferType === 'SERVICE' && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Switch
                checked={isRemote}
                onChange={(e) => setIsRemote(e.target.checked)}
                color="primary"
                size="small"
              />
              <Box>
                <Typography variant="body2" fontWeight={600}>
                  {SERVICE_OFFER_CONTENT.remoteToggleLabel}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {SERVICE_OFFER_CONTENT.remoteToggleHelper}
                </Typography>
              </Box>
            </Box>
          )}

          {!isRemote && form.selectedOfferType === 'ITEM' && form.selectedContext === 'private' && (
            <>
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
            </>
          )}

          {!isRemote && (
            <Box>
              <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                Pin exact location (optional)
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                Optional — improves map accuracy. Without a pin, the location is derived from city and country.
              </Typography>
              <LocationPicker
                lat={coords?.lat ?? null}
                lng={coords?.lng ?? null}
                onChange={setCoords}
                isDark={isDark}
              />
            </Box>
          )}

          <TextField
            select
            label="Language"
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
            fullWidth
            helperText="Language of your offer description"
          >
            {LANGUAGE_OPTIONS.map(l => (
              <MenuItem key={l.value} value={l.value}>{l.label}</MenuItem>
            ))}
          </TextField>
        </Box>
      </Paper>
    )

    const deliverySection = showsDelivery ? (
      <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
        <h5 className="!mt-0 !mb-1.5 !text-[var(--theme-text)]">Delivery Conditions</h5>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3, lineHeight: 1.5 }}>
          Define shipping or delivery terms for this offer.
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
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
                helperText="Estimated delivery time in days"
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
              <SatsAmountInput
                label="Delivery Cost"
                valueSats={form.values.deliveryCostSats === '' ? '' : Number(form.values.deliveryCostSats)}
                onChangeSats={sats => form.setValues({ deliveryCostSats: sats === '' ? '' : String(sats) })}
              />
            </Grid>
          </Grid>
          <TextField
            label="Additional Delivery Information (optional)"
            value={form.values.deliveryNotes}
            onChange={(e) => form.setValues({ deliveryNotes: e.target.value })}
            placeholder="e.g. Local pickup only, Express shipping available, Handle with care..."
            multiline
            rows={2}
            fullWidth
            helperText="Any additional notes or instructions for the buyer"
          />
        </Box>
      </Paper>
    ) : null

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: deliverySection ? { xs: '1fr', lg: 'repeat(2, 1fr)' } : '1fr', gap: 5 }}>
          {locationSection}
          {deliverySection}
        </Box>

        {/* Section: Three-Phase Escrow (SMART_ORDER only) */}
        {showsDelivery && (
          <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mb: 1.5 }}>
              <HandshakeOutlinedIcon sx={{ fontSize: 20, color: 'var(--theme-text-secondary)' }} />
              <h5 className="!mt-0 !mb-0 !text-[var(--theme-text)]">Three-Phase Escrow</h5>
              <Button
                component={Link}
                to="/help/buying#buy-4"
                size="small"
                variant="text"
                startIcon={<GavelOutlinedIcon sx={{ fontSize: 15 }} />}
                sx={{
                  ml: 'auto',
                  textTransform: 'none',
                  fontSize: 12,
                  fontWeight: 600,
                  py: 0.25,
                  px: 1,
                  minWidth: 0,
                  color: 'var(--theme-text-secondary)',
                  '&:hover': { color: 'var(--color-primary-50)', background: 'transparent' },
                }}
              >
                Disputes &amp; arbitration
              </Button>
            </Box>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 3, lineHeight: 1.6 }}>
              Hold-invoice escrow splits payment into 25% / 50% / 25% phases. Recommended for high-value or first-time trades.
            </Typography>

            {/* Desktop: phase breakdown on the left, escrow controls on the right — top-aligned so
                "Enable three-phase escrow" sits level with the phase cards next to it. */}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' },
                gap: { xs: 2.5, md: 3 },
                alignItems: 'start',
              }}
            >
              {/* Left column: compact phase breakdown */}
              <Box>
                {/* What happens (and what you get) at each step */}
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
                    gap: 1.25,
                  }}
                >
                  {[
                    { pct: 25, label: 'On acceptance', detail: 'Buyer pays a deposit to reserve the order — you know it’s real before you lift a finger.' },
                    { pct: 50, label: 'On delivery start', detail: 'Released once you mark delivery as started — the bulk of your payment, secured up front.' },
                    { pct: 25, label: 'On confirmed delivery', detail: 'Final payment once the buyer confirms receipt — closes the deal, no chargebacks.' },
                  ].map((phase, i) => (
                    <Box
                      key={phase.label}
                      sx={{
                        position: 'relative',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.5,
                        p: 1.5,
                        borderRadius: 1.5,
                        border: '1px solid var(--theme-border)',
                        bgcolor: 'var(--theme-bg-subtle)',
                      }}
                    >
                      {/* Step marker */}
                      <Box
                        sx={{
                          position: 'absolute',
                          top: 10,
                          right: 10,
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10,
                          fontWeight: 700,
                          color: 'var(--theme-text-muted)',
                          border: '1px solid var(--theme-border)',
                          flexShrink: 0,
                        }}
                      >
                        {i + 1}
                      </Box>

                      <Typography
                        sx={{
                          fontSize: 26,
                          fontWeight: 800,
                          lineHeight: 1,
                          letterSpacing: '-0.02em',
                          color: 'var(--color-primary-50)',
                        }}
                      >
                        {phase.pct}%
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          color: 'var(--theme-text)',
                        }}
                      >
                        {phase.label}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                        {phase.detail}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>

              {/* Right column: escrow controls */}
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  p: 1.75,
                  borderRadius: 1.5,
                  border: '1px solid var(--theme-border)',
                  bgcolor: 'var(--theme-bg-subtle)',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography variant="body2" fontWeight={700} sx={{ color: 'var(--theme-text)' }}>
                      Three-phase escrow
                    </Typography>
                    {/* ADR-253 FU-253-I: escrow is not available yet (Stufe 2/3 —
                        the ICP canister — has no committed ship date, FU-253-G/H
                        are still open). Disabled rather than removed, so it's
                        clear this is coming, not gone; no phase/date promised. */}
                    <Typography variant="caption" color="text.secondary">
                      Not available yet — this listing pays the buyer's full amount directly to you when they order.
                    </Typography>
                  </Box>
                  <Tooltip title="Escrow isn't available yet — coming in a later phase (ADR-253).">
                    <span>
                      <Switch checked={form.values.useEscrow} disabled color="primary" />
                    </span>
                  </Tooltip>
                </Box>
                {form.values.useEscrow && (
                  <TextField
                    label="Phase 2 Payment Window (Hours)"
                    type="number"
                    value={form.values.phase2WindowHours}
                    onChange={(e) => form.setValues({ phase2WindowHours: e.target.value })}
                    placeholder="24"
                    inputProps={{ min: 1, max: 168 }}
                    fullWidth
                    helperText="Hours the buyer has to pay the second phase after work starts."
                  />
                )}
              </Box>
            </Box>
          </Paper>
        )}

        {/* Section: Available Toggle (Corporate PRODUCT only) */}
        {form.selectedOfferType === 'PRODUCT' && (
          <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box>
                <h5 className="!mt-0 !mb-0.5 !text-[var(--theme-text)]">Available</h5>
                <Typography variant="body2" color="text.secondary">
                  {form.values.isAvailable ? 'Visible to buyers in catalog' : 'Hidden from catalog'}
                </Typography>
              </Box>
              <Switch
                checked={form.values.isAvailable}
                onChange={(e) => form.setValues({ isAvailable: e.target.checked })}
                color="success"
              />
            </Box>
          </Paper>
        )}

        {/* Section: Milestones (only when MILESTONE selected) */}
        {form.showsTicketType && form.values.ticketType === 'MILESTONE' && (
          <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
            <h5 className="!mt-0 !mb-0 !text-[var(--theme-text)]">Milestones</h5>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 2.5 }}>
              {milestoneItems.map((m, i) => (
                <Paper key={i} variant="outlined" sx={{ p: 2 }}>
                  <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                    <Typography variant="body2" fontWeight={700} color="primary.main" sx={{ pt: 0.5, minWidth: 20 }}>
                      {i + 1}.
                    </Typography>
                    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                      <TextField
                        label="Title"
                        value={m.title}
                        onChange={e => updateMilestone(i, 'title', e.target.value)}
                        size="small"
                        required
                        fullWidth
                      />
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <TextField
                          label="Description (optional)"
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
              sx={{ mt: 2, cursor: 'pointer', border: 'none', bgcolor: 'transparent', color: 'primary.main', fontSize: '0.875rem', p: 0 }}
            >
              + Add milestone
            </Box>
            <Alert severity={milestonePercentageSum === 100 ? 'success' : 'warning'} sx={{ mt: 2 }}>
              Total: {milestonePercentageSum}% {milestonePercentageSum === 100 ? '✓' : `– ${100 - milestonePercentageSum}% remaining`}
            </Alert>
          </Paper>
        )}

        {/* ADR-271 D6: bookable-offer entry point — enabling it adds the
            "Availability & Booking" step to this wizard. */}
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <ScheduleOutlinedIcon fontSize="small" color={bookingActive ? 'primary' : 'action'} />
              <Box>
                <h5 className="!mt-0 !mb-0.5 !text-[var(--theme-text)]">Bookable — sell time, not stock</h5>
                <Typography variant="body2" color="text.secondary">
                  Rent out a space over a date range or offer sessions at fixed times (NIP-52 calendar).
                </Typography>
              </Box>
            </Box>
            <Switch
              checked={bookingActive}
              onChange={(e) => {
                form.setValues({ bookingMode: e.target.checked ? 'DATE_RANGE' : 'NONE' })
                setCurrentFormStep(4)
              }}
              color="primary"
              size="small"
            />
          </Box>
          {bookingActive && (
            <Box sx={{ mt: 2 }}>
              <TextField
                select
                label="Booking mode"
                value={form.values.bookingMode}
                onChange={(e) => {
                  const mode = e.target.value as 'DATE_RANGE' | 'SESSION'
                  form.setValues({
                    bookingMode: mode,
                    priceUnit: mode === 'DATE_RANGE' ? 'per_night' : 'per_seat',
                  })
                }}
                fullWidth
                helperText="DATE_RANGE: a space booked by the night/day. SESSION: fixed occurrences with seats."
              >
                <MenuItem value="DATE_RANGE">Date range — space (house, room, studio)</MenuItem>
                <MenuItem value="SESSION">Session — fixed time (workshop, consultation)</MenuItem>
              </TextField>
            </Box>
          )}
        </Paper>

        {logisticsComplete && <SectionCompleteRow label="Logistics & Terms complete" />}
      </Box>
    )
  }

  // ADR-271 D6: Availability & Booking — pick or create the bookable resource,
  // set pricing units and the confirmation mode (D5). Rendered only when
  // bookingMode ≠ NONE (see formSteps).
  function stepBooking() {
    const stepErrs = errors[bookingStepIndex] ?? {}
    const bookingComplete = Object.keys(computeBookingErrors()).length === 0
    const isSession = form.values.bookingMode === 'SESSION'
    // ADR-369: session style — FIXED = fixed occurrence with seats; OPEN =
    // recurring window the buyer books a start + whole-hour duration in.
    const isOpenSession = isSession && form.values.sessionStyle === 'OPEN'
    // Kind-consistent choices only (D6): DATE_RANGE offers link SPACE
    // resources, SESSION offers link SESSION resources — the server enforces
    // this at submit; filter here so the mismatch is unselectable. OPEN
    // sessions pair with OPEN (dedicated, capacity-1) resources only.
    const myResources = (resourcesQuery.data?.resources ?? [])
      .filter(r => (isSession ? r.kind === 'SESSION' : r.kind === 'SPACE'))
      .filter(r => isSession ? (r.bookingStyle ?? 'FIXED') === (form.values.sessionStyle === 'OPEN' ? 'OPEN' : 'FIXED') : true)
    const unitOptions = PRICE_UNIT_OPTIONS
      .filter(o => o.modes.includes(form.values.bookingMode as 'DATE_RANGE' | 'SESSION'))
      .filter(o => !(isOpenSession && o.value !== 'per_hour'))
    const creatingOpen = isSession && form.values.resourceId === 'new' && isOpenSession
    const setV = form.setValues

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
          <h5 className="!mt-0 !mb-1.5 !text-[var(--theme-text)]">Bookable Resource</h5>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3, lineHeight: 1.5 }}>
            A resource is the thing being booked — one calendar that can back several offers
            (weekend rate, weekly rate). Many offers → one resource → no double-booking.
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {isSession && (
              <TextField
                select
                label="Session type"
                value={form.values.sessionStyle}
                onChange={(e) => {
                  const style = e.target.value as 'FIXED' | 'OPEN'
                  const wasOpen = form.values.sessionStyle === 'OPEN'
                  setV({
                    sessionStyle: style,
                    // OPEN resources are dedicated exclusive time blocks — an
                    // existing FIXED resource cannot back them, so reset to new.
                    resourceId: style === 'OPEN' ? 'new' : form.values.resourceId,
                    resourceCapacity: style === 'OPEN' ? '1' : form.values.resourceCapacity,
                    priceUnit: style === 'OPEN'
                      ? 'per_hour'
                      : (wasOpen && form.values.priceUnit === 'per_hour' ? 'per_seat' : form.values.priceUnit),
                    bookingMaxUnits: style === 'OPEN'
                      ? (form.values.bookingMaxUnits || '8')
                      : (wasOpen && form.values.bookingMaxUnits === '8' ? '' : form.values.bookingMaxUnits),
                  })
                }}
                fullWidth
                helperText="FIXED = exact session with seats. OPEN = buyers pick a start time and whole-hour duration inside your windows."
              >
                <MenuItem value="FIXED">Fixed event — seats at an exact time (workshop, class)</MenuItem>
                <MenuItem value="OPEN">Open time block — buyers pick start time + duration (consultation, session)</MenuItem>
              </TextField>
            )}
            <TextField
              select
              label="Resource"
              value={form.values.resourceId}
              onChange={(e) => setV({ resourceId: e.target.value })}
              fullWidth
              error={!!stepErrs.resourceId}
              helperText={stepErrs.resourceId || 'Pick one of your resources or create a new one'}
            >
              <MenuItem value="new">+ Create new resource</MenuItem>
              {myResources.map(r => (
                <MenuItem key={r.id} value={r.id}>
                  {r.title} ({r.kind === 'SPACE' ? 'space' : 'session'}, {r.bookingStyle === 'OPEN' ? 'open window' : 'fixed'}, {r.timezone})
                </MenuItem>
              ))}
            </TextField>

            {form.values.resourceId === 'new' && (
              <>
                <TextField
                  label="Resource title"
                  value={form.values.resourceTitle}
                  onChange={(e) => setV({ resourceTitle: e.target.value })}
                  placeholder={isSession ? 'e.g. Yoga workshop in the studio' : 'e.g. Lake house'}
                  fullWidth
                  required
                  error={!!stepErrs.resourceTitle}
                  helperText={stepErrs.resourceTitle}
                />
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="Timezone (IANA)"
                      value={form.values.resourceTimezone}
                      onChange={(e) => setV({ resourceTimezone: e.target.value })}
                      placeholder="Europe/Berlin"
                      fullWidth
                      required
                      error={!!stepErrs.resourceTimezone}
                      helperText={stepErrs.resourceTimezone || 'All times are shown in this timezone'}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    {creatingOpen ? (
                      <Box sx={{ p: 1.5, borderRadius: 'var(--radius-sm, 6px)', border: '1px dashed var(--theme-border)', background: 'var(--theme-bg-subtle)' }}>
                        <Typography variant="body2" fontWeight={600}>Exclusive time blocks</Typography>
                        <Typography variant="caption" color="text.secondary">
                          Buyers book a start time + whole-hour duration. Capacity is 1 — one booking at a time.
                        </Typography>
                      </Box>
                    ) : (
                      <TextField
                        label={isSession ? 'Seats (capacity)' : 'Identical units (usually 1)'}
                        type="number"
                        value={form.values.resourceCapacity}
                        onChange={(e) => setV({ resourceCapacity: e.target.value })}
                        fullWidth
                        required
                        error={!!stepErrs.resourceCapacity}
                        helperText={stepErrs.resourceCapacity}
                      />
                    )}
                  </Grid>
                </Grid>

                {isSession ? (
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        select
                        label="Weekday"
                        value={form.values.sessionWeekday}
                        onChange={(e) => setV({ sessionWeekday: e.target.value })}
                        fullWidth
                      >
                        {WEEKDAYS.map((d, i) => (
                          <MenuItem key={d} value={String(i)}>{d}</MenuItem>
                        ))}
                      </TextField>
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4 }}>
                      <TextField
                        label="Starts"
                        type="time"
                        value={form.values.sessionStart}
                        onChange={(e) => setV({ sessionStart: e.target.value })}
                        fullWidth
                        required
                      />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 4 }}>
                      <TextField
                        label="Ends"
                        type="time"
                        value={form.values.sessionEnd}
                        onChange={(e) => setV({ sessionEnd: e.target.value })}
                        fullWidth
                        required
                        error={!!stepErrs.sessionEnd}
                        helperText={stepErrs.sessionEnd}
                      />
                    </Grid>
                  </Grid>
                ) : (
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        label="Open from"
                        type="date"
                        value={form.values.resourceOpenFrom}
                        onChange={(e) => setV({ resourceOpenFrom: e.target.value })}
                        fullWidth
                        required
                        error={!!stepErrs.resourceOpenFrom}
                        helperText={stepErrs.resourceOpenFrom}
                        slotProps={{ inputLabel: { shrink: true } }}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        label="Open until"
                        type="date"
                        value={form.values.resourceOpenUntil}
                        onChange={(e) => setV({ resourceOpenUntil: e.target.value })}
                        fullWidth
                        required
                        error={!!stepErrs.resourceOpenUntil}
                        helperText={stepErrs.resourceOpenUntil}
                        slotProps={{ inputLabel: { shrink: true } }}
                      />
                    </Grid>
                  </Grid>
                )}

                <Grid container spacing={2}>
                  {!isSession && (
                    <Grid size={{ xs: 12, sm: 4 }}>
                      <TextField
                        label="Min nights"
                        type="number"
                        value={form.values.resourceMinUnits}
                        onChange={(e) => setV({ resourceMinUnits: e.target.value })}
                        fullWidth
                      />
                    </Grid>
                  )}
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField
                      label="Lead time (hours)"
                      type="number"
                      value={form.values.resourceLeadTimeHours}
                      onChange={(e) => setV({ resourceLeadTimeHours: e.target.value })}
                      fullWidth
                      helperText="No bookings starting sooner"
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField
                      label="Buffer (minutes)"
                      type="number"
                      value={form.values.resourceBufferMinutes}
                      onChange={(e) => setV({ resourceBufferMinutes: e.target.value })}
                      fullWidth
                      helperText="Gap between bookings — never charged"
                    />
                  </Grid>
                </Grid>
              </>
            )}
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
          <h5 className="!mt-0 !mb-1.5 !text-[var(--theme-text)]">Pricing & Confirmation</h5>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3, lineHeight: 1.5 }}>
            Total = price × units, shown to the buyer before the request is sent.
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              select
              label="Price unit"
              value={form.values.priceUnit}
              onChange={(e) => setV({ priceUnit: e.target.value as OfferFormValues['priceUnit'] })}
              fullWidth
              required
              error={!!stepErrs.priceUnit}
              helperText={stepErrs.priceUnit}
            >
              {unitOptions.map(o => (
                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
              ))}
            </TextField>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  label="Min units"
                  type="number"
                  value={form.values.bookingMinUnits}
                  onChange={(e) => setV({ bookingMinUnits: e.target.value })}
                  placeholder={isSession ? '1' : '1'}
                  fullWidth
                  error={!!stepErrs.bookingMinUnits}
                  helperText={stepErrs.bookingMinUnits || (isOpenSession ? 'Hours (whole)' : isSession ? 'Seats' : 'Nights')}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  label="Max units"
                  type="number"
                  value={form.values.bookingMaxUnits}
                  onChange={(e) => setV({ bookingMaxUnits: e.target.value })}
                  fullWidth
                  error={!!stepErrs.bookingMaxUnits}
                  helperText={stepErrs.bookingMaxUnits || 'Blank = resource default'}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  label="Confirmation window (h)"
                  type="number"
                  value={form.values.confirmationWindowHours}
                  onChange={(e) => setV({ confirmationWindowHours: e.target.value })}
                  fullWidth
                  error={!!stepErrs.confirmationWindowHours}
                  helperText={stepErrs.confirmationWindowHours}
                />
              </Grid>
            </Grid>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Switch
                checked={form.values.autoConfirm}
                onChange={(e) => setV({ autoConfirm: e.target.checked })}
                color="primary"
                size="small"
              />
              <Box>
                <Typography variant="body2" fontWeight={600}>Instant confirmation</Typography>
                <Typography variant="caption" color="text.secondary">
                  Requires a connected NIP-46 delegate that countersigns matching requests. Leave off
                  unless you have one — a listing must never promise instant confirmation while a
                  human is actually in the loop.
                </Typography>
              </Box>
            </Box>
          </Box>
        </Paper>

        {bookingComplete && <SectionCompleteRow label="Availability & Booking complete" />}
      </Box>
    )
  }

  function stepPublishing() {
    // ADR-271: bucket shifts with the conditional booking step
    const stepErrs = errors[publishingStepIndex] ?? {}
    const publishingComplete = Object.keys(computePublishingErrors()).length === 0

    const scheduledPublishingSection = (
      <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <ScheduleOutlinedIcon fontSize="small" color={form.values.isScheduled ? 'primary' : 'action'} />
            <Box>
              <h5 className="!mt-0 !mb-0.5 !text-[var(--theme-text)]">Scheduled Publishing</h5>
              <Typography variant="body2" color="text.secondary">
                {form.values.isScheduled
                  ? 'Choose a date and time to publish automatically.'
                  : 'Enable schedule to publish later.'}
              </Typography>
            </Box>
          </Box>
          <Switch
            checked={form.values.isScheduled}
            onChange={(e) => {
              form.setValues({ isScheduled: e.target.checked, scheduledAt: e.target.checked ? new Date().toISOString() : null })
              if (stepErrs.scheduledAt) setErrors(prev => ({ ...prev, [publishingStepIndex]: { ...prev[publishingStepIndex], scheduledAt: '' } }))
            }}
            color="primary"
          />
        </Box>

        {form.values.isScheduled && (
          <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={de}>
            <Grid container spacing={2} sx={{ mt: 2 }}>
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
        {stepErrs.scheduledAt && (
          <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>
            {stepErrs.scheduledAt}
          </Typography>
        )}
      </Paper>
    )

    const privacyVisibilitySection = (
      <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 }, borderRadius: 'var(--radius-lg, 12px)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: '10px',
              bgcolor: 'var(--color-primary-50)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <LockOutlinedIcon sx={{ fontSize: 18, color: 'white' }} />
          </Box>
          <h5 className="!mt-0 !mb-0 !text-[var(--theme-text)]">Privacy & Visibility</h5>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 3, lineHeight: 1.6 }}>
          Choose how this offer is shared with buyers. <strong>Public</strong> offers are listed in the global search index and build reputation. <strong>Private</strong> offers are sent via NIP-17 encrypted DMs only — no public discovery, no reputation, opt-in arbiter dispute resolution.
        </Typography>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
            gap: 2,
          }}
        >
          {([
            {
              value: 'PUBLIC' as const,
              label: 'Public',
              icon: <PublicIcon sx={{ fontSize: 22 }} />,
              description: 'Listed in global search. Buyers can request orders. Reputation builds. DAO dispute resolution.',
            },
            {
              value: 'PRIVATE' as const,
              label: 'Private',
              icon: <LockOutlinedIcon sx={{ fontSize: 22 }} />,
              description: 'Sent via NIP-17 encrypted DM to specific recipients. No public discovery. No reputation. Paid directly to your own wallet.',
            },
          ]).map(card => {
            const selected = form.values.visibility === card.value
            const accent = card.value === 'PRIVATE'
              ? 'var(--color-primary-50)'
              : 'var(--color-action-secondary-default)'
            return (
              <Box
                key={card.value}
                onClick={() => {
                  form.setValues({
                    visibility: card.value,
                    // ADR-152: disputeMode follows visibility (PRIVATE ↔ PRIVATE, PUBLIC ↔ PUBLIC)
                    disputeMode: card.value === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
                  })
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    form.setValues({
                      visibility: card.value,
                      disputeMode: card.value === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
                    })
                  }
                }}
                sx={{
                  position: 'relative',
                  p: 2.5,
                  borderRadius: 'var(--radius-md, 8px)',
                  border: '2px solid',
                  borderColor: selected ? accent : 'var(--theme-border)',
                  bgcolor: selected ? `${accent}` : 'transparent',
                  cursor: 'pointer',
                  transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                  outline: 'none',
                  ...(selected && {
                    boxShadow: `0 4px 16px ${accent}1A`,
                  }),
                  '&:hover': {
                    borderColor: accent,
                    transform: 'translateY(-1px)',
                  },
                  '&:focus-visible': {
                    boxShadow: `0 0 0 3px ${accent}40`,
                  },
                }}
                style={selected ? { background: `${accent}1F` } : {}}
              >
                {selected && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      bgcolor: accent,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <svg width="11" height="8" viewBox="0 0 12 9" fill="none">
                      <path d="M1 4.5L4.5 8L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </Box>
                )}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                  <Box
                    sx={{
                      width: 36,
                      height: 36,
                      borderRadius: '10px',
                      bgcolor: selected ? `${accent}26` : 'var(--theme-bg-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: selected ? accent : 'var(--theme-text-muted)',
                      transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
                    }}
                  >
                    {card.icon}
                  </Box>
                  <Typography
                    variant="body2"
                    fontWeight={700}
                    sx={{
                      color: selected ? 'var(--theme-text)' : 'var(--theme-text-secondary)',
                      fontSize: '0.9375rem',
                    }}
                  >
                    {card.label}
                  </Typography>
                </Box>
                <Typography
                  variant="caption"
                  sx={{
                    color: 'var(--theme-text-muted)',
                    lineHeight: 1.5,
                    fontSize: '0.75rem',
                    display: 'block',
                  }}
                >
                  {card.description}
                </Typography>
              </Box>
            )
          })}
        </Box>

        {/* ── Private trade: reputation notice (Phase 4.5) ── */}
        {form.values.visibility === 'PRIVATE' && (
          <Box sx={{ mt: 3 }}>
            <PrivateReputationNotice />
          </Box>
        )}
      </Paper>
    )

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, 1fr)' }, gap: 5 }}>
          {scheduledPublishingSection}
          {privacyVisibilitySection}
        </Box>

        {/* Section: Dispute Mode (only when PRIVATE) — full-width below the pair */}
        {form.values.visibility === 'PRIVATE' && (
          <Box
            sx={{
              p: 3,
              borderRadius: 'var(--radius-md, 8px)',
              border: '1px solid',
              borderColor: 'var(--theme-border)',
              bgcolor: 'var(--theme-bg-subtle)',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
              <GavelOutlinedIcon sx={{ fontSize: 18, color: 'var(--theme-text-secondary)' }} />
              <Typography variant="body2" fontWeight={700} sx={{ color: 'var(--theme-text)' }}>
                Dispute Mode
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block', lineHeight: 1.6 }}>
              Choose how disputes are handled for this private offer.
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
                gap: 1.5,
              }}
            >
              {([
                {
                  value: 'PRIVATE' as const,
                  label: 'Mutual Arbiter',
                  icon: <GroupsOutlinedIcon sx={{ fontSize: 18 }} />,
                  description: 'Both parties nominate and accept a third-party arbiter via DM. The arbiter signs the verdict.',
                },
                {
                  value: 'NONE' as const,
                  label: 'No Dispute Protection',
                  icon: <BlockOutlinedIcon sx={{ fontSize: 18 }} />,
                  description: 'No structured dispute path — recommended only for trusted counterparties.',
                },
              ]).map(opt => {
                const selected = form.values.disputeMode === opt.value
                return (
                  <Box
                    key={opt.value}
                    onClick={() => form.setValues({ disputeMode: opt.value })}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') form.setValues({ disputeMode: opt.value })
                    }}
                    sx={{
                      display: 'flex',
                      gap: 1.5,
                      p: 1.5,
                      borderRadius: 'var(--radius-sm, 6px)',
                      border: '1.5px solid',
                      borderColor: selected ? 'var(--color-primary-50)' : 'var(--theme-border)',
                      bgcolor: selected ? 'var(--theme-surface)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'all 150ms',
                      outline: 'none',
                      '&:hover': { borderColor: 'var(--color-primary-50)' },
                      '&:focus-visible': {
                        boxShadow: '0 0 0 3px rgba(99,179,237,0.25)',
                      },
                    }}
                  >
                    <Box
                      sx={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        border: '2px solid',
                        borderColor: selected ? 'var(--color-primary-50)' : 'var(--theme-text-muted)',
                        bgcolor: selected ? 'var(--color-primary-50)' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        mt: 0.25,
                        transition: 'all 150ms',
                      }}
                    >
                      {selected && (
                        <Box
                          sx={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            bgcolor: 'white',
                          }}
                        />
                      )}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                        <Box sx={{ color: selected ? 'var(--color-primary-50)' : 'var(--theme-text-muted)', display: 'flex' }}>
                          {opt.icon}
                        </Box>
                        <Typography variant="body2" fontWeight={600} sx={{ color: 'var(--theme-text)' }}>
                          {opt.label}
                        </Typography>
                      </Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block', lineHeight: 1.5 }}
                      >
                        {opt.description}
                      </Typography>
                    </Box>
                  </Box>
                )
              })}
            </Box>
          </Box>
        )}

        {publishingComplete && <SectionCompleteRow label="Publishing complete" />}
      </Box>
    )
  }

  function stepPreview() {
    const countryLabel = COUNTRY_OPTIONS.find(c => c.value === selectedCountry)?.label ?? selectedCountry
    const locationParts = [location.street, location.zip, location.city, countryLabel].filter(Boolean)
    const priceLabel = form.selectedOfferType === 'SERVICE' ? SERVICE_OFFER_CONTENT.priceLabel : 'Price'
    const disputeModeLabel = form.values.visibility === 'PRIVATE'
      ? (form.values.disputeMode === 'NONE' ? 'No dispute protection' : 'Mutual Arbiter')
      : 'DAO arbitration'

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
            gap: 5,
          }}
        >
          {/* Content card */}
          <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
            <PreviewCardHeader title="Content" onEdit={() => setCurrentFormStep(2)} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <PreviewRow label="Title" value={form.values.title || '—'} />
              {form.needsCatalog && (
                <PreviewRow
                  label={form.isExistingProductListing ? 'Listing for' : 'Catalog'}
                  value={form.isExistingProductListing
                    ? (form.catalogProducts.find(p => p.id === form.selectedProductId)?.name ?? '—')
                    : (form.companyCatalogs.find(c => c.id === form.selectedCatalogId)?.name ?? 'No catalog (company)')}
                />
              )}
              <PreviewRow
                label="Description"
                value={
                  // ADR-295: descriptions may carry restricted HTML — preview
                  // shows the visible text, never the markup.
                  (() => {
                    const plain = richTextToPlainText(form.values.description).trim()
                    if (!plain) return '—'
                    return plain.length > 80 ? `${plain.slice(0, 80)}…` : plain
                  })()
                }
              />
              <PreviewRow
                label={priceLabel}
                value={form.values.priceSats ? <SatsAmount sats={Number(form.values.priceSats)} size="sm" /> : '—'}
              />
              {form.needsStock && <PreviewRow label="Stock" value={form.values.stock || '—'} />}
              <PreviewRow label="Photos" value={`${form.values.images.length} photo${form.values.images.length === 1 ? '' : 's'}`} />
            </Box>
            {form.values.images.length > 0 && (
              <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap' }}>
                {form.values.images.slice(0, 5).map((src, i) => (
                  <Box
                    key={src + i}
                    component="img"
                    src={src}
                    alt=""
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: 'var(--radius-sm, 6px)',
                      objectFit: 'cover',
                      border: i === primaryImageIndex ? '2px solid var(--color-status-success)' : '1px solid var(--theme-border)',
                    }}
                  />
                ))}
              </Box>
            )}
          </Paper>

          {/* Attributes & Variants card */}
          <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
            <PreviewCardHeader title="Attributes & Variants" onEdit={() => setCurrentFormStep(3)} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <PreviewRow
                label="Product Type"
                value={form.values.productType === 'variable' ? 'Variable (with variants)' : 'Simple'}
              />
              {form.values.specs.length > 0 && (
                <PreviewRow
                  label="Attributes"
                  value={form.values.specs.map(s => `${s.key}: ${s.value}`).slice(0, 3).join(' · ') + (form.values.specs.length > 3 ? ` (+${form.values.specs.length - 3} more)` : '')}
                />
              )}
              {form.values.productType === 'variable' && (
                <>
                  <PreviewRow
                    label="Axes"
                    value={form.values.variantAxes.map(a => `${a.name} (${a.values.join(', ')})`).join(' · ') || '—'}
                  />
                  <PreviewRow
                    label="Variations"
                    value={`${form.values.variations.filter(v => v.listingVisibility !== 'hidden').length} configured`}
                  />
                </>
              )}
            </Box>
          </Paper>

          {/* Logistics & Terms card */}
          <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
            <PreviewCardHeader title="Logistics & Terms" onEdit={() => setCurrentFormStep(4)} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <PreviewRow
                label="Location"
                value={locationParts.length > 0 ? locationParts.join(', ') : (isRemote ? 'Remote / Digital' : '—')}
              />
              {form.showsTicketType && form.values.ticketType === 'SMART_ORDER' && (
                <>
                  <PreviewRow label="Delivery time" value={form.values.deliveryTimeDays ? `${form.values.deliveryTimeDays} days` : '—'} />
                  <PreviewRow
                    label="Delivery cost"
                    value={form.values.deliveryCostSats ? <SatsAmount sats={Number(form.values.deliveryCostSats)} size="sm" /> : 'Free'}
                  />
                  <PreviewRow label="Escrow" value={form.values.useEscrow ? '25% / 50% / 25%' : 'Direct payment'} />
                </>
              )}
              {form.showsTicketType && form.values.ticketType === 'MILESTONE' && (
                <PreviewRow label="Milestones" value={`${milestoneItems.length} (${milestonePercentageSum}%)`} />
              )}
            </Box>
            {form.showsTicketType && form.values.ticketType === 'MILESTONE' && milestoneItems.length > 0 && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mt: 2 }}>
                {milestoneItems.map((m, i) => (
                  <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="caption" sx={{ color: 'var(--theme-text-secondary)' }}>{i + 1}. {m.title || 'Untitled'}</Typography>
                    <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)' }}>{m.percentage}%</Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Paper>

          {/* Publishing card */}
          <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
            <PreviewCardHeader title="Publishing" onEdit={() => setCurrentFormStep(5)} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <PreviewRow
                label="Publish"
                value={form.values.isScheduled && scheduleDate ? scheduleDate.toLocaleString() : 'Immediately'}
              />
              <PreviewRow label="Visibility" value={form.values.visibility === 'PRIVATE' ? 'Private' : 'Public'} />
              <PreviewRow label="Dispute Mode" value={disputeModeLabel} />
            </Box>
          </Paper>
        </Box>

        {/* Error & Actions */}
        {submitError && (
          <Alert severity="error">
            {submitError}
            {submitErrorCode === 'SELLER_PAYMENT_NOT_CONFIGURED' && (
              <>
                {' '}
                <Link to="/settings#wallet" style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline' }}>
                  Open Wallet settings
                </Link>
              </>
            )}
          </Alert>
        )}
      </Box>
    )
  }

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <PageContainer size="narrow" spacing="lg" className="pt-0!">
      <PageHeader
        title={headerContent.title}
        subtitle={
          <>
            {headerContent.subtitle}
            <br />
            {headerContent.helpText}
          </>
        }
        onBack={() => navigate('/')}
        backLabel="Go back"
      />

      <FormStepper
        steps={formSteps}
        currentStep={currentFormStep}
        onStepChange={setCurrentFormStep}
        onContinue={handleFormStepperContinue}
        onLastStepComplete={() => submitOffer(form.values.isScheduled ? 'SCHEDULED' : 'ACTIVE')}
        continueLabel={currentFormStep === lastStepIndex ? (form.values.isScheduled ? 'Schedule Offer' : 'Publish Offer') : 'Next'}
        backLabel="Back"
        completedSteps={Array.from(completedSteps)}
        secondaryAction={{
          label: 'Save Draft',
          icon: <SaveOutlinedIcon />,
          onClick: () => submitOffer('DRAFT'),
          disabled: _submitting || !form.values.title,
        }}
      >
        {[
          step1(),
          step2(),
          stepContent(),
          stepVariants(),
          stepLogistics(),
          ...(bookingActive ? [stepBooking()] : []),
          stepPublishing(),
          stepPreview(),
        ]}
      </FormStepper>
    </PageContainer>
  )
}
