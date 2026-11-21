import { useState, useEffect, useMemo, useCallback } from 'react'
import { apiCall } from '../lib/api'
import { CATEGORY_DEFS, DEFAULT_MILESTONES, SUBCATEGORY_MAP, type MilestoneFormItem, type OfferType } from '../components/offers/offerFormConstants'
import type { ProductSpec, VariantAxis, VariationItem } from '../types/api'

export type { OfferType }

export type TradeVisibility = 'PUBLIC' | 'PRIVATE'
export type DisputeMode = 'PUBLIC' | 'PRIVATE' | 'NONE'

export interface OfferFormValues {
  title: string
  description: string
  priceSats: string
  category: string
  subcategory: string
  // ADR-277 E1: seller-entered Gamma `t` tags (D1's second, emergent axis)
  gammaTags: string[]
  location: string
  ticketType: 'SMART_ORDER' | 'MILESTONE'
  imageUrl: string
  images: string[]
  stock: string
  isAvailable: boolean
  scheduledAt: string | null
  isScheduled: boolean
  deliveryTimeDays: string
  deliveryCostSats: string
  deliveryTemplateId: string
  deliveryNotes: string
  // ADR-152: Trade visibility + dispute mode. Default PUBLIC (no breaking change).
  visibility: TradeVisibility
  disputeMode: DisputeMode
  // ADR-151: numeric tiers the buyer is allowed to pick. Default [0] (PUBLIC only).
  allowedVisibility: number[]
  // ADR-184: three-phase escrow opt-in per offer.
  useEscrow: boolean
  phase2WindowHours: string
  // ADR-270: Product attributes & variant matrix
  productType: 'simple' | 'variable' | 'variation'
  specs: ProductSpec[]
  variantAxes: VariantAxis[]
  variations: VariationItem[]
  // ADR-271: Availability & Booking (NONE = ordinary offer)
  bookingMode: 'NONE' | 'DATE_RANGE' | 'SESSION'
  resourceId: string // existing resource id or 'new'
  priceUnit: 'per_night' | 'per_day' | 'per_hour' | 'per_seat' | 'flat' | ''
  bookingMinUnits: string
  bookingMaxUnits: string
  confirmationWindowHours: string
  autoConfirm: boolean
  // new-resource authoring fields (used when resourceId === 'new')
  resourceTitle: string
  resourceTimezone: string
  resourceCapacity: string
  resourceMinUnits: string
  resourceLeadTimeHours: string
  resourceBufferMinutes: string
  resourceOpenFrom: string // SPACE: date range start (yyyy-MM-dd)
  resourceOpenUntil: string // SPACE: date range end
  sessionWeekday: string // SESSION: 0–6 (Sunday = 0)
  sessionStart: string // SESSION: HH:mm
  sessionEnd: string // SESSION: HH:mm
  // ADR-369: SESSION authoring style — FIXED = fixed occurrence with seats;
  // OPEN = recurring window the buyer books a start + whole-hour duration in.
  sessionStyle: 'FIXED' | 'OPEN'
}

export interface OfferCreatePayload {
  title?: string
  name?: string
  description?: string
  priceSats?: number
  category?: string
  categoryCode?: string
  standardCategoryId?: string | null
  gammaTags?: string[]
  subcategory?: string
  subcategoryCode?: string
  categoryId?: string
  location?: string
  ticketType?: string
  offerType?: OfferType
  creatorPubkey?: string
  status?: 'ACTIVE' | 'DRAFT' | 'SCHEDULED'
  images?: string[] | null
  milestones?: Array<{ title: string; description: string; percentage: number; sortOrder: number }>
  stock?: number | null
  isAvailable?: boolean
  scheduledAt?: string | null
  deliveryTimeDays?: number | null
  deliveryCostSats?: number | null
  deliveryTemplateId?: string | null
  deliveryNotes?: string | null
  // ADR-152: Trade visibility + dispute mode
  visibility?: TradeVisibility
  disputeMode?: DisputeMode
  // ADR-151: numeric tiers the buyer is allowed to pick.
  allowedVisibility?: number[] | null
  // ADR-184: three-phase escrow opt-in per offer.
  useEscrow?: boolean
  phase2WindowHours?: number | null
  // ADR-270: Product attributes & variant matrix
  productType?: 'simple' | 'variable' | 'variation'
  specs?: ProductSpec[]
  variantAxes?: VariantAxis[]
  variations?: VariationItem[]
  // ADR-271: bookable-resource linking (resourceId is injected by the wizard
  // after the resource API call — not part of buildPayload)
  bookingMode?: 'DATE_RANGE' | 'SESSION'
  priceUnit?: string
  bookingMinUnits?: number | null
  bookingMaxUnits?: number | null
  confirmationWindowHours?: number
  autoConfirm?: boolean
}

interface UseOfferFormOptions {
  offerType?: OfferType
  context: 'private' | 'corporate'
  initialValues?: Partial<OfferFormValues>
  onCatalogNeeded?: () => void
}

type SetValuesArg = Partial<OfferFormValues> | ((prev: OfferFormValues) => Partial<OfferFormValues>)

interface UseOfferFormReturn {
  values: OfferFormValues
  milestones: MilestoneFormItem[]
  setValues: (updates: SetValuesArg) => void
  setMilestones: React.Dispatch<React.SetStateAction<MilestoneFormItem[]>>

  // Dynamic offer type (ITEM | PRODUCT | SERVICE)
  selectedOfferType: OfferType
  setSelectedOfferType: (type: OfferType) => void

  // Context switching (private ↔ corporate)
  selectedContext: 'private' | 'corporate'
  setSelectedContext: (ctx: 'private' | 'corporate') => void

  // Catalog management (for corporate context)
  selectedCatalogId: string | null
  setSelectedCatalogId: (id: string | null) => void
  catalogSelectionMode: 'catalog' | 'category'
  selectedProductId: string | null
  setSelectedProductId: (id: string | null) => void
  companyCatalogs: { id: string; name: string; products?: { id: string; name: string; standardCategoryId?: string | null }[] }[]
  catalogProducts: { id: string; name: string; standardCategoryId?: string | null }[]
  loadingCatalogs: boolean
  /** True when the selected catalog carries its own category (the picker is locked). */
  catalogCategoryLocked: boolean

  // ADR-395: PRODUCT creation — a brand-new product (catalog optional) or a
  // further listing for an existing product (catalog + product required).
  productSource: 'new' | 'existing'
  setProductSource: (source: 'new' | 'existing') => void
  isExistingProductListing: boolean
  /** The caller's own Company id (null = none), undefined while loading. */
  ownCompanyId: string | null | undefined

  // Derived booleans for conditional rendering
  needsCatalog: boolean
  needsStock: boolean
  showsTicketType: boolean

  // Validation
  isValid: boolean
  milestoneValid: boolean
  milestonePercentageSum: number

  // Utilities
  reset: () => void
  buildPayload: (userPubkey: string) => OfferCreatePayload
  saveDraft: () => void
  loadDraft: () => Partial<OfferFormValues> | null
}

const DEFAULT_VALUES: OfferFormValues = {
  title: '',
  description: '',
  priceSats: '',
  category: 'Goods',
  subcategory: '',
  gammaTags: [],
  location: '',
  ticketType: 'SMART_ORDER',
  imageUrl: '',
  images: [],
  stock: '1',
  isAvailable: true,
  scheduledAt: null,
  isScheduled: false,
  deliveryTimeDays: '',
  deliveryCostSats: '',
  deliveryTemplateId: '',
  deliveryNotes: '',
  // ADR-152: defaults = PUBLIC (no breaking change for existing users)
  visibility: 'PUBLIC',
  disputeMode: 'PUBLIC',
  // ADR-151: tier 0 = PUBLIC-only offer (existing behaviour).
  allowedVisibility: [0],
  // ADR-184: escrow off by default until Beta validates the three-phase flow.
  useEscrow: false,
  phase2WindowHours: '24',
  // ADR-270: Default simple product with empty attributes/variants
  productType: 'simple',
  specs: [],
  variantAxes: [],
  variations: [],
  // ADR-271: not bookable by default (D6: step appears only when ≠ NONE)
  bookingMode: 'NONE',
  resourceId: 'new',
  priceUnit: '',
  bookingMinUnits: '',
  bookingMaxUnits: '',
  confirmationWindowHours: '24',
  autoConfirm: false,
  resourceTitle: '',
  resourceTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  resourceCapacity: '1',
  resourceMinUnits: '1',
  resourceLeadTimeHours: '0',
  resourceBufferMinutes: '0',
  resourceOpenFrom: '',
  resourceOpenUntil: '',
  sessionWeekday: '1',
  sessionStart: '09:00',
  sessionEnd: '17:00',
  sessionStyle: 'FIXED',
}

/**
 * Read the user's default trade mode preference from localStorage (D2.1).
 * Falls back to PUBLIC when no preference is set.
 */
function readDefaultTradeMode(): TradeVisibility {
  try {
    const v = localStorage.getItem('colabonate:settings:defaultTradeMode')
    if (v === 'PRIVATE') return 'PRIVATE'
  } catch { /* localStorage may be unavailable in SSR/test envs */ }
  return 'PUBLIC'
}

/** Default category per offer type (ADR-078: 3 roots – Goods, Digital, Services) */
const DEFAULT_CATEGORY: Record<OfferType, string> = {
  ITEM: 'Goods',
  PRODUCT: '',
  SERVICE: 'Services',
}

export function useOfferForm({
  offerType: initialOfferType = 'ITEM',
  context,
  initialValues,
}: UseOfferFormOptions): UseOfferFormReturn {
  const [values, setValues] = useState<OfferFormValues>(() => {
    // ADR-152: read default visibility from Settings (D2.1), then allow override
    const defaultVisibility = readDefaultTradeMode()
    return {
      ...DEFAULT_VALUES,
      category: DEFAULT_CATEGORY[initialOfferType],
      visibility: defaultVisibility,
      // disputeMode follows visibility: PRIVATE visibility → PRIVATE dispute, PUBLIC → PUBLIC
      disputeMode: defaultVisibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
      ...initialValues,
    }
  })
  // ADR-184: when user explicitly opts out, reset phase-2 window to default.
  useEffect(() => {
    if (!values.useEscrow) {
      setValues(prev => ({ ...prev, phase2WindowHours: '24' }))
    }
  }, [values.useEscrow])
  const [milestones, setMilestones] = useState<MilestoneFormItem[]>(DEFAULT_MILESTONES)

  const [selectedOfferType, setSelectedOfferType] = useState<OfferType>(initialOfferType)
  const [selectedContext, setSelectedContext] = useState<'private' | 'corporate'>(context)
  const [catalogSelectionMode, setCatalogSelectionMode] = useState<'catalog' | 'category'>('category')
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(null)
  const [selectedCatalogStandardCategoryId, setSelectedCatalogStandardCategoryId] = useState<string | null>(null)
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [companyCatalogs, setCompanyCatalogs] = useState<{ id: string; name: string; products?: { id: string; name: string; standardCategoryId?: string | null }[] }[]>([])
  const [catalogProducts, setcatalogProducts] = useState<{ id: string; name: string; standardCategoryId?: string | null }[]>([])
  const [loadingCatalogs, setLoadingCatalogs] = useState(false)
  const [productSource, setProductSourceState] = useState<'new' | 'existing'>('new')
  const [ownCompanyId, setOwnCompanyId] = useState<string | null | undefined>(undefined)

  const userPubkey = localStorage.getItem('pubkey')

  // ADR-395: products belong to the caller's Company — resolved once so the
  // wizard can gate PRODUCT creation up front instead of failing at publish.
  useEffect(() => {
    if (!userPubkey) { setOwnCompanyId(null); return }
    let cancelled = false
    apiCall(`/api/company/${userPubkey}`)
      .then(r => r.json())
      .then((data: { company?: { id?: string } | Array<{ id?: string }> | null }) => {
        const company = Array.isArray(data.company) ? data.company[0] : data.company
        if (!cancelled) setOwnCompanyId(company?.id ?? null)
      })
      .catch(() => { if (!cancelled) setOwnCompanyId(null) })
    return () => { cancelled = true }
  }, [userPubkey])

  const setProductSource = useCallback((source: 'new' | 'existing') => {
    setProductSourceState(source)
    // A new product never references an existing one.
    if (source === 'new') setSelectedProductId(null)
  }, [])

  // ─── ADR-085: Session persistence for catalog/category mode ──────────────

  useEffect(() => {
    const saved = sessionStorage.getItem('colabonate_catalog_selection_mode')
    if (saved === 'catalog' || saved === 'category') {
      setCatalogSelectionMode(saved)
    }
  }, [])

  useEffect(() => {
    sessionStorage.setItem('colabonate_catalog_selection_mode', catalogSelectionMode)
  }, [catalogSelectionMode])

  // ─── ADR-085: PRODUCT auto-corporate ────────────────────────────────────

  useEffect(() => {
    if (selectedOfferType === 'PRODUCT') {
      setSelectedContext('corporate')
    }
  }, [selectedOfferType])

  // ─── Derived state ─────────────────────────────────────────────────────

  const milestonePercentageSum = useMemo(
    () => milestones.reduce((s, m) => s + (m.percentage || 0), 0),
    [milestones]
  )

  const milestoneValid = values.ticketType !== 'MILESTONE' || milestonePercentageSum === 100

  const needsCatalog = useMemo(() => {
    return selectedOfferType === 'PRODUCT' || (selectedOfferType === 'ITEM' && selectedContext === 'corporate')
  }, [selectedOfferType, selectedContext])

  // Listing an existing product only applies to PRODUCT offers — the catalog
  // listing endpoint semantics (offerType PRODUCT) never covered ITEM/SERVICE.
  const isExistingProductListing = selectedOfferType === 'PRODUCT' && productSource === 'existing'

  const needsStock = useMemo(() => {
    return selectedOfferType === 'PRODUCT' || (selectedOfferType === 'ITEM' && selectedContext === 'corporate')
  }, [selectedOfferType, selectedContext])

  const showsTicketType = useMemo(() => {
    return selectedOfferType === 'ITEM' || selectedOfferType === 'PRODUCT' || selectedOfferType === 'SERVICE'
  }, [selectedOfferType, selectedContext])

  const isValid = useMemo(() => {
    const titleValid = values.title.trim().length > 0
    const priceValid = !isNaN(parseInt(values.priceSats)) && parseInt(values.priceSats) > 0

    // ADR-085: Catalog OR category is valid — when catalog selected, category is optional
    let categoryValid = true
    if (!selectedCatalogId) {
      categoryValid = values.category.length > 0
    }

    // ADR-085: Stock must be >= 1 when needsStock
    let stockValid = true
    if (needsStock) {
      stockValid = values.stock.length > 0 && !isNaN(parseInt(values.stock)) && parseInt(values.stock) >= 1
    }

    let scheduleValid = true
    if (values.isScheduled) {
      scheduleValid = values.scheduledAt !== null && values.scheduledAt.length > 0
    }

    return titleValid && priceValid && categoryValid && stockValid && milestoneValid && scheduleValid
  }, [values, selectedContext, selectedCatalogId, catalogProducts, selectedOfferType, milestoneValid, needsCatalog, needsStock])

  // ─── Offer type switching ──────────────────────────────────────────────

  const handleSetOfferType = useCallback((type: OfferType) => {
    setSelectedOfferType(type)
    setValues(prev => ({
      ...prev,
      category: DEFAULT_CATEGORY[type],
      subcategory: '',
      stock: type === 'PRODUCT' ? (prev.stock || '1') : prev.stock,
    }))
  }, [])

  // ─── Catalog fetching ──────────────────────────────────────────────────

  useEffect(() => {
    async function fetchCompanyCatalogs() {
      if (userPubkey) {
        setLoadingCatalogs(true)
        try {
          // ?mine=1 (auth-based): PRODUCT catalogs resolve through the caller's
          // Company — the old ?ownerPubkey= filter returns AGENT_SETUP catalogs
          // only (PRODUCT rows have ownerPubkey=null), so company catalogs never
          // showed up in the /offers/new selector.
          const response = await apiCall('/api/catalog?mine=1')
          const data = await response.json()
          const all: Array<{ id: string; name: string; catalogType?: string | null }> = Array.isArray(data.catalogs) ? data.catalogs : []
          // Corporate offer creation assigns PRODUCT catalogs; AGENT_SETUP
          // catalogs belong to the Cooperate agent-stack flows.
          const productCatalogs = all.filter(c => (c.catalogType ?? 'PRODUCT') === 'PRODUCT')
          if (productCatalogs.length > 0) {
            setCompanyCatalogs(productCatalogs)
            // ADR-085: No auto-selection — user consciously chooses catalog
            // (exception: an explicit ?catalogId= deep-link preselects, see
            // CreateOfferPage).
          } else {
            setCompanyCatalogs([])
            setSelectedCatalogId(null)
            setcatalogProducts([])
          }
        } catch (error) {
          console.error('Failed to fetch company catalogs:', error)
          setCompanyCatalogs([])
          setSelectedCatalogId(null)
          setcatalogProducts([])
        } finally {
          setLoadingCatalogs(false)
        }
      }
    }

    fetchCompanyCatalogs()
  }, [userPubkey])

  useEffect(() => {
    async function fetchcatalogProducts() {
      if (needsCatalog && selectedCatalogId) {
        try {
          const response = await apiCall(`/api/catalog/${selectedCatalogId}`)
          const data = await response.json()
          // ADR-083: products include standardCategoryId – expose as selectable items
          if (data.catalog?.products) {
            setcatalogProducts(data.catalog.products.map((p: { id: string; name: string; standardCategoryId?: string | null }) => ({
              id: p.id,
              name: p.name,
              standardCategoryId: p.standardCategoryId ?? null,
            })))
            // ADR-066: User must consciously select a product – no auto-selection
          }
        } catch (error) {
          console.error('Failed to fetch catalog categories:', error)
          setcatalogProducts([])
        }
      }
    }

    fetchcatalogProducts()
  }, [selectedContext, selectedOfferType, selectedCatalogId, needsCatalog])

  // ─── ADR-085: Catalog → Category sync ──────────────────────────────────

  const handleSetSelectedCatalogId = useCallback(async (id: string | null) => {
    if (!id) {
      // "None" catalog → switch back to manual category mode
      setSelectedCatalogId(null)
      setSelectedCatalogStandardCategoryId(null)
      setCatalogSelectionMode('category')
      setcatalogProducts([])
      return
    }

    setSelectedCatalogId(id)
    setCatalogSelectionMode('catalog')

    // Fetch catalog details to extract standardCategoryId for category sync
    try {
      const response = await apiCall(`/api/catalog/${id}`)
      const data = await response.json()

      const catalogStdCatId = data.catalog?.standardCategoryId ?? null
      setSelectedCatalogStandardCategoryId(catalogStdCatId)

      // The wizard's category state holds StandardCategory slugs (L1 root in
      // `category`, deeper slug in `subcategory`) — mirror the catalog's
      // category the same way so categoryCode stays a real slug (ADR-380).
      const slug: string | undefined = data.catalog?.standardCategory?.slug
      if (catalogStdCatId && slug) {
        const root = slug.split('/')[0]
        setValues(prev => ({
          ...prev,
          category: root,
          subcategory: slug === root ? '' : slug,
        }))
      }
    } catch (error) {
      console.error('Failed to fetch catalog for category sync:', error)
    }
  }, [])

  // ─── Value setters ─────────────────────────────────────────────────────

  const handleSetValues = useCallback((updates: SetValuesArg) => {
    setValues(prev => {
      const resolved = typeof updates === 'function' ? updates(prev) : updates
      return { ...prev, ...resolved }
    })
  }, [])

  // ─── Reset ─────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    // ADR-152: re-read default visibility on reset (Settings may have changed meanwhile)
    const defaultVisibility = readDefaultTradeMode()
    setValues({
      ...DEFAULT_VALUES,
      category: DEFAULT_CATEGORY[initialOfferType],
      visibility: defaultVisibility,
      disputeMode: defaultVisibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
      ...initialValues,
    })
    setMilestones(DEFAULT_MILESTONES)
    setSelectedOfferType(initialOfferType)
    setSelectedContext(context)
  }, [context, initialOfferType, initialValues])

  // ─── Build API payload ─────────────────────────────────────────────────

  const buildPayload = useCallback((pubkey: string): OfferCreatePayload => {
    const priceSatsParsed = parseInt(values.priceSats)
    const stockParsed = values.stock ? parseInt(values.stock) : null

    const images = values.images.length > 0
      ? values.images
      : values.imageUrl
        ? [values.imageUrl]
        : []

    const isCorporate = needsCatalog

    const visibility = values.allowedVisibility.length > 0 ? values.allowedVisibility : [0]

    // ADR-271: booking fields apply to every offer class (D6); resourceId is
    // injected by the wizard after the resource API call.
    const bookingPayload = values.bookingMode !== 'NONE'
      ? {
          bookingMode: values.bookingMode,
          priceUnit: values.priceUnit || undefined,
          bookingMinUnits: values.bookingMinUnits ? parseInt(values.bookingMinUnits, 10) : null,
          bookingMaxUnits: values.bookingMaxUnits ? parseInt(values.bookingMaxUnits, 10) : null,
          confirmationWindowHours: parseInt(values.confirmationWindowHours || '24', 10),
          autoConfirm: values.autoConfirm,
        }
      : {}

    // ── Private ITEM ──
    if (selectedOfferType === 'ITEM' && !isCorporate) {
      // ADR-083: values.category = L1 slug, values.subcategory = L2/L3 slug
      const categoryCode = values.subcategory || values.category || undefined
      const payload: OfferCreatePayload = {
        title: values.title,
        description: values.description,
        priceSats: priceSatsParsed,
        category: values.category,
        categoryCode,
        gammaTags: values.gammaTags.length > 0 ? values.gammaTags : undefined,
        subcategory: values.subcategory || undefined,
        subcategoryCode: values.subcategory
          ? SUBCATEGORY_MAP[values.category]?.find(s => s.name === values.subcategory)?.unspscCode
          : undefined,
        location: values.location || undefined,
        ticketType: values.ticketType,
        offerType: 'ITEM',
        creatorPubkey: pubkey,
        status: values.isScheduled ? 'SCHEDULED' : 'ACTIVE',
        images,
        visibility: values.visibility,
        disputeMode: values.disputeMode,
        useEscrow: values.useEscrow,
        phase2WindowHours: values.useEscrow && values.phase2WindowHours ? parseInt(values.phase2WindowHours) : null,
        // ADR-270: Product attributes & variant matrix
        productType: values.productType,
        specs: values.specs.length > 0 ? values.specs : undefined,
        variantAxes: values.productType === 'variable' && values.variantAxes.length > 0 ? values.variantAxes : undefined,
        variations: values.productType === 'variable' && values.variations.length > 0 ? values.variations : undefined,
        // ADR-271: booking fields
        ...bookingPayload,
      }
      if (values.isScheduled && values.scheduledAt) {
        payload.scheduledAt = values.scheduledAt
      }
      if (values.ticketType === 'MILESTONE') {
        payload.milestones = milestones.map((m, i) => ({ ...m, sortOrder: i }))
      }
      if (values.ticketType === 'SMART_ORDER' && values.deliveryTimeDays) {
        payload.deliveryTimeDays = parseInt(values.deliveryTimeDays)
        payload.deliveryCostSats = values.deliveryCostSats ? parseInt(values.deliveryCostSats) : null
        payload.deliveryNotes = values.deliveryNotes || null
      }
      payload.allowedVisibility = visibility
      return payload
    }

    // ── Corporate ITEM or PRODUCT ──
    if (selectedOfferType === 'PRODUCT' || isCorporate) {
      const offerType = selectedOfferType === 'PRODUCT' ? 'PRODUCT' : 'ITEM'

      // ADR-083: StandardCategory is ALWAYS required (Master).
      // values.category = L1 name (e.g. "Goods"), values.subcategory = L2/L3 name
      const selectedProduct = catalogProducts.find(p => p.id === selectedProductId)
      const productStandardCategoryId = selectedProduct?.standardCategoryId ?? null

      // Derive standardCategoryId – priority: catalog > selected product > subcategory > category
      let derivedStandardCategoryId: string | null = selectedCatalogStandardCategoryId ?? productStandardCategoryId
      if (!derivedStandardCategoryId && values.subcategory) {
        const sub = SUBCATEGORY_MAP[values.category]?.find(s => s.name === values.subcategory)
        if (sub) derivedStandardCategoryId = sub.id
      }
      if (!derivedStandardCategoryId && values.category) {
        const cat = CATEGORY_DEFS.find(c => c.name === values.category)
        if (cat) derivedStandardCategoryId = cat.id
      }

      // If product selected, use its standardCategoryId; otherwise derive from category + subcategory
      const categoryCode = values.subcategory
        || values.category
        || undefined

      const payload: OfferCreatePayload = {
        title: values.title,
        name: values.title,
        description: values.description,
        priceSats: priceSatsParsed,
        categoryId: values.category,
        standardCategoryId: derivedStandardCategoryId ?? null,
        categoryCode,
        gammaTags: values.gammaTags.length > 0 ? values.gammaTags : undefined,
        category: values.category,
        subcategory: values.subcategory || undefined,
        subcategoryCode: values.subcategory
          ? SUBCATEGORY_MAP[values.category]?.find(s => s.name === values.subcategory)?.unspscCode
          : undefined,
        offerType,
        creatorPubkey: pubkey,
        status: values.isScheduled ? 'SCHEDULED' : 'ACTIVE',
        stock: stockParsed,
        images: images.length > 0 ? images : null,
        isAvailable: values.isAvailable,
        visibility: values.visibility,
        disputeMode: values.disputeMode,
        useEscrow: values.useEscrow,
        phase2WindowHours: values.useEscrow && values.phase2WindowHours ? parseInt(values.phase2WindowHours) : null,
        // ADR-270: Product attributes & variant matrix
        productType: values.productType,
        specs: values.specs.length > 0 ? values.specs : undefined,
        variantAxes: values.productType === 'variable' && values.variantAxes.length > 0 ? values.variantAxes : undefined,
        variations: values.productType === 'variable' && values.variations.length > 0 ? values.variations : undefined,
        // ADR-271: booking fields
        ...bookingPayload,
      }

      // Delivery conditions for SMART_ORDER
      if (values.ticketType === 'SMART_ORDER' && selectedOfferType === 'ITEM') {
        payload.deliveryTimeDays = values.deliveryTimeDays ? parseInt(values.deliveryTimeDays) : null
        payload.deliveryCostSats = values.deliveryCostSats ? parseInt(values.deliveryCostSats) : null
        payload.deliveryNotes = values.deliveryNotes || null
      }

      // For PRODUCT: use template if selected
      if (selectedOfferType === 'PRODUCT' && values.deliveryTemplateId) {
        payload.deliveryTemplateId = values.deliveryTemplateId || null
        payload.deliveryTimeDays = null
        payload.deliveryCostSats = null
        payload.deliveryNotes = null
      }

      payload.allowedVisibility = visibility
      return payload
    }

    // ── SERVICE ──
    if (selectedOfferType === 'SERVICE') {
      // ADR-083: values.category = L1 slug, values.subcategory = L2/L3 slug
      const categoryCode = values.subcategory || values.category || undefined
      const payload: OfferCreatePayload = {
        title: values.title,
        description: values.description,
        priceSats: priceSatsParsed,
        category: values.category,
        categoryCode,
        gammaTags: values.gammaTags.length > 0 ? values.gammaTags : undefined,
        subcategory: values.subcategory || undefined,
        subcategoryCode: values.subcategory
          ? SUBCATEGORY_MAP[values.category]?.find(s => s.name === values.subcategory)?.unspscCode
          : undefined,
        ticketType: values.ticketType,
        offerType: 'SERVICE',
        creatorPubkey: pubkey,
        status: values.isScheduled ? 'SCHEDULED' : 'ACTIVE',
        images,
        visibility: values.visibility,
        disputeMode: values.disputeMode,
        useEscrow: values.useEscrow,
        phase2WindowHours: values.useEscrow && values.phase2WindowHours ? parseInt(values.phase2WindowHours) : null,
        // ADR-270: Product attributes & variant matrix
        productType: values.productType,
        specs: values.specs.length > 0 ? values.specs : undefined,
        variantAxes: values.productType === 'variable' && values.variantAxes.length > 0 ? values.variantAxes : undefined,
        variations: values.productType === 'variable' && values.variations.length > 0 ? values.variations : undefined,
        // ADR-271: booking fields
        ...bookingPayload,
      }
      if (values.isScheduled && values.scheduledAt) {
        payload.scheduledAt = values.scheduledAt
      }
      if (values.ticketType === 'MILESTONE') {
        payload.milestones = milestones.map((m, i) => ({ ...m, sortOrder: i }))
      }
      if (values.ticketType === 'SMART_ORDER' && values.deliveryTimeDays) {
        payload.deliveryTimeDays = parseInt(values.deliveryTimeDays)
        payload.deliveryCostSats = values.deliveryCostSats ? parseInt(values.deliveryCostSats) : null
        payload.deliveryNotes = values.deliveryNotes || null
      }
      payload.allowedVisibility = visibility
      return payload
    }

    return {}
  }, [selectedOfferType, selectedContext, values, milestones, needsCatalog])

  // ─── Draft management (localStorage) ───────────────────────────────────

  const draftKey = useMemo(
    () => `colabonate_draft_${selectedOfferType}_${selectedContext}`,
    [selectedOfferType, selectedContext]
  )

  const saveDraft = useCallback(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify(values))
    } catch (error) {
      console.error('Failed to save draft:', error)
    }
  }, [draftKey, values])

  const loadDraft = useCallback((): Partial<OfferFormValues> | null => {
    try {
      const raw = localStorage.getItem(draftKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        setValues(prev => ({ ...prev, ...parsed }))
        return parsed
      }
    } catch (error) {
      console.error('Failed to load draft:', error)
    }
    return null
  }, [draftKey])

  return {
    values,
    milestones,
    setValues: handleSetValues,
    setMilestones,

    selectedOfferType,
    setSelectedOfferType: handleSetOfferType,

    selectedContext,
    setSelectedContext,

    selectedCatalogId,
    setSelectedCatalogId: handleSetSelectedCatalogId,
    catalogSelectionMode,
    selectedProductId,
    setSelectedProductId,
    companyCatalogs,
    catalogProducts,
    loadingCatalogs,
    catalogCategoryLocked: selectedCatalogId !== null && selectedCatalogStandardCategoryId !== null,

    productSource,
    setProductSource,
    isExistingProductListing,
    ownCompanyId,

    needsCatalog,
    needsStock,
    showsTicketType,

    isValid,
    milestoneValid,
    milestonePercentageSum,

    reset,
    buildPayload,
    saveDraft,
    loadDraft,
  }
}
