// ESCROW-COPY (ADR-397): payment wording here assumes Direct-Pay. On escrow activation follow docs/plans/ESCROW-COPY-REACTIVATION.md.
import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useOffer, useIdentity, useCompany, useVendorOffers, useAllOffers } from '../../hooks/useEntityQueries'
import { RichText } from '../../components/offers'
import { useDetailSliderItems } from '../../hooks/useDetailSliderItems'
import { useDetailSwipeNav } from '../../hooks/useDetailSwipeNav'
import { NotFoundState } from '../../components/NotFoundState'
import { BookingRequestWidget } from '../../components/booking/BookingRequestWidget'
import { gsap } from 'gsap'
import { useTranslation, formatLocaleDate } from '../../contexts/LocaleContext'
import { useCurrency } from '../../contexts/CurrencyContext'
import { FiatHint } from '../../components/currency/FiatHint'
import { DetailPriceHero, type DetailPriceHeroProps } from '../../components/currency/DetailPriceHero'
import { useRemotePayee } from '../../hooks/useRemoteOrders'
import { formatVariantLabel } from '@col/nostr-schema'
import {
  Box, Typography, Grid, Stack,
  Button, CircularProgress, Divider,
  Tooltip, Chip, useMediaQuery, useTheme,
  Menu, MenuItem, ListItemIcon, ListItemText,
} from '@mui/material'
import {
  ShoppingCart as ShoppingCartIcon,
  Bolt as BoltIcon,
  Inventory2 as Inventory2Icon,
  Work as WorkIcon,
  Check as CheckIcon,
  Lock as LockIcon,
  Shield as ShieldIcon,
  VerifiedUser as VerifiedUserIcon,
  InfoOutlined as InfoOutlinedIcon,
  CheckCircle as CheckCircleIcon,
  AccessTime as AccessTimeIcon,
  Place as PlaceIcon,
  LocalOffer as LocalOfferIcon,
  Storefront as StorefrontIcon,
  Favorite as FavoriteIcon,
} from '@mui/icons-material'
import {
  Bot, Flag, TrendingUp, MoreVertical, Pencil, Play, Archive, Trash2, Power, Frame, Zap,
} from 'lucide-react'
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import ArrowRightIcon from '@mui/icons-material/ArrowRight'
import PersonIcon from '@mui/icons-material/Person'
import { PageContainer } from '@ds/ui'
import type { SliderListItem } from '@ds/ui'
import { PageHeader } from '../../components/PageHeader'
import { CartFAB } from '../../components/ui'
import { DetailSliderNav } from '../../components/DetailSliderNav'
import type { DetailSliderContextFilters, DetailSliderSegment } from '../../components/DetailSliderNav'
import { SwipeHint, notifySwipeHintDismissed } from '../../components/SwipeHint'
import { useCart } from '../../context/CartContext'
import { useNotification } from '../../context/NotificationContext'
import { useFavoritesWithUndo } from '../../hooks/useFavorites'
import { useOfferListActions } from '../../hooks/useOfferListActions'
import { IdentityLevelBadge } from '../../components/identity/IdentityLevelBadge'
import { UserLink } from '../../components/user/UserLink'
import { VisitorChat, BuyerChatWidget } from '../../components/visitor-chat/visitor-chat'
import { DetailImageGallery } from '../../components/media/DetailImageGallery'
import { apiCall } from '../../lib/api'
import { canvasCartFields, HOSTED_CANVAS_FEE_SATS } from '../../lib/agentConfig'
import { AgentSetupFacts } from '../../components/offers/AgentSetupFacts'
import { RemoteOfferPanel } from '../../components/offers/RemoteOfferPanel'
import { estimateSatsFromForeignPrice, formatEstimateLabel } from '../../lib/remote-price'
import { foreignPriceText } from '../../lib/offer-price-text'
import type { Offer, Company, UserProfileResponse } from '../../types/api'
import { COUNTRIES } from '../../components/offers/offerFormConstants'
import type { IdentityLevel } from '../../types/identity'

const toProductDetailRoute = (id: string) => `/buy/product/${id}`

// ── Image Gallery ───────────────────────────────────────────────────
// Shared hero gallery (crossfade auto-carousel + lightbox) lives in
// components/media/DetailImageGallery.

// ── Trust Badge ─────────────────────────────────────────────────────

function TrustBadge({ icon, text, tooltip }: { icon: React.ReactNode; text: string; tooltip?: string }) {
  const badge = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', color: 'success.main', flexShrink: 0 }}>{icon}</Box>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>{text}</Typography>
    </Box>
  )

  if (tooltip) {
    return <Tooltip title={tooltip} arrow placement="top">{badge}</Tooltip>
  }
  return badge
}

// ── Milestone Step ──────────────────────────────────────────────────

function MilestoneStep({
  index,
  title,
  description,
  percentage,
  amountSats,
  isLast,
}: {
  index: number
  title: string
  description?: string
  percentage: number
  amountSats: number
  isLast: boolean
}) {
  const { formatNumber } = useTranslation()

  return (
    <Box sx={{ display: 'flex', gap: 2, position: 'relative' }}>
      {/* Timeline connector */}
      {!isLast && (
        <Box sx={{
          position: 'absolute',
          left: 15,
          top: 36,
          bottom: -8,
          width: 2,
          background: 'linear-gradient(to bottom, var(--theme-border) 0%, transparent 100%)',
        }} />
      )}

      {/* Step number circle */}
      <Box sx={{
        width: 32, height: 32,
        borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        background: 'rgba(99,179,237,0.10)',
        border: '2px solid rgba(99,179,237,0.30)',
        zIndex: 1,
      }}>
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--color-primary-50)' }}>
          {index + 1}
        </Typography>
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, pb: isLast ? 0 : 2.5, minWidth: 0 }}>
        {/* minHeight 32 = number-circle height; center aligns the title
            vertically with the digit inside the circle */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 32, gap: 1 }}>
          <Typography variant="body2" fontWeight={700} sx={{ color: 'var(--theme-text)' }}>
            {title}
          </Typography>
          {/* Percentage, sats and fiat conversion share ONE line, sized up
              to body2 so they read at the same level as the milestone title. */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }}>
            <Chip
              label={`${percentage}%`}
              sx={{
                fontSize: '0.75rem', height: 24, fontWeight: 700,
                background: 'rgba(99,179,237,0.10)',
                border: '1px solid rgba(99,179,237,0.20)',
                color: 'var(--color-primary-50)',
              }}
            />
            <Typography variant="body2" fontWeight={700} sx={{ color: 'var(--color-primary-50)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {formatNumber(amountSats)} sats
            </Typography>
            <FiatHint sats={amountSats} className="text-[13px]" style={{ color: 'var(--theme-text-muted)' }} />
          </Box>
        </Box>
        {description && (
          <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', display: 'block', mt: 0.5, lineHeight: 1.6 }}>
            {description}
          </Typography>
        )}
      </Box>
    </Box>
  )
}

// ── Seller Card helpers ─────────────────────────────────────────────
// `KeyValueCell` renders a single labeled datum (key label + value). The
// icon lives with the column heading, not per-cell — keeps the meaning
// at the top and the cells purely textual.
// `KeyValueColumn` wraps a stack of cells under an uppercase heading
// accompanied by the column's representative icon. Together they form
// the responsive 3-column key-value grid (REPUTATION / EARNINGS /
// ACTIVITY) that sits below the user info header.

function KeyValueCell({ label, value, valueColor }: {
  label: string
  value: React.ReactNode
  valueColor?: string
}) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        sx={{
          color: 'var(--theme-text-muted)',
          lineHeight: 1.1,
          fontSize: { xs: '0.65rem', md: '0.7rem', lg: '0.75rem' },
          textTransform: 'uppercase',
          letterSpacing: 0.3,
          fontWeight: 600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </Typography>
      <Typography
        fontWeight={700}
        sx={{
          color: valueColor ?? 'var(--theme-text)',
          lineHeight: 1.15,
          fontSize: { xs: '0.85rem', md: '0.9rem', lg: '1.05rem' },
          mt: 0.25,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </Typography>
    </Box>
  )
}

function KeyValueColumn({ heading, icon, children }: {
  heading: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: { xs: 1, lg: 1.25 } }}>
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        pb: 0.5,
        borderBottom: '1px solid var(--theme-border)',
      }}>
        {icon && (
          <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, color: 'var(--theme-text-muted)' }}>
            {icon}
          </Box>
        )}
        <Typography
          sx={{
            color: 'var(--theme-text-muted)',
            fontSize: { xs: '0.6rem', md: '0.65rem', lg: '0.7rem' },
            textTransform: 'uppercase',
            letterSpacing: 0.75,
            fontWeight: 700,
          }}
        >
          {heading}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 0.75, lg: 1 } }}>
        {children}
      </Box>
    </Box>
  )
}

// ── BuyProductDetail Component ────────────────────────────────────────

/**
 * Price hero for the sidebar. For a remote listing whose seller can be paid over Lightning
 * (ADR-417) the estimate note says the amount is fixed at checkout instead of "the merchant sets
 * the final price" (FU-1006). The payee lookup is shared with RemoteOfferPanel via the query cache.
 */
function OfferPriceHero({
  offerId,
  remote,
  ...heroProps
}: DetailPriceHeroProps & { offerId: string; remote: boolean }) {
  const payee = useRemotePayee(offerId, 1, remote)
  const payable = remote && payee.data?.orderable === true
  return (
    <DetailPriceHero
      {...heroProps}
      estimateNote={
        payable ? 'Estimate only. The amount you pay is fixed and shown before you pay.' : undefined
      }
    />
  )
}

export function BuyProductDetail() {
  const { formatNumber } = useTranslation()
  const { rates } = useCurrency()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('lg'))
  const { productId } = useParams<{ productId: string }>()
  const navigate = useNavigate()
  // ADR-188: useOffer uses placeholderData: keepPreviousData so the page
  // (including the slider above) stays mounted while the next offer resolves —
  // avoids flicker on sibling click.
  const { data: offer, error: queryError } = useOffer(productId!)

  const { data: sellerIdentity } = useIdentity(offer?.creatorPubkey ?? '')
  const { data: resolvedCompanyData } = useCompany(offer?.companyId ?? '')
  const sellerIdentityLevel = sellerIdentity?.identityLevel ?? 0
  const resolvedCompany = resolvedCompanyData as Company | null

  // Full seller profile — same fields UserProfile renders (banner, picture,
  // about, nip05, colPoints, reputation, stats, company). Mirrors the
  // /api/user/:pubkey/profile fetch in UserProfile.tsx so the offer-detail
  // Seller card can display the exact same metadata.
  const [sellerProfile, setSellerProfile] = useState<UserProfileResponse | null>(null)
  useEffect(() => {
    const pk = offer?.creatorPubkey
    if (!pk) { setSellerProfile(null); return }
    let cancelled = false
    apiCall(`/api/user/${pk}/profile`)
      .then(r => r.json())
      .then((data: UserProfileResponse & { error?: string }) => {
        if (!cancelled && data && !data.error && data.pubkey) setSellerProfile(data)
      })
      .catch(() => {/* silent — fallback stays at useIdentity-only data */})
    return () => { cancelled = true }
  }, [offer?.creatorPubkey])

  // Live Nostr Kind 0 fallback (same as UserProfile.tsx): when the DB has no
  // Nostr display metadata yet, fetch it live from relays so we still show
  // the user's real banner / picture / name / about. Skipped for non-PUBLIC
  // visibility and non-hex pubkeys. Display-only merge, never persisted.
  useEffect(() => {
    const pk = offer?.creatorPubkey
    if (!pk || !sellerProfile) return
    if (sellerProfile.visibility && sellerProfile.visibility !== 'PUBLIC') return
    if (sellerProfile.picture || sellerProfile.name || sellerProfile.banner) return
    if (!/^[0-9a-f]{64}$/i.test(pk)) return
    let cancelled = false
    apiCall(`/api/nostr/profile/${pk}`)
      .then(r => (r.ok ? r.json() : null))
      .then((k0: { name?: string; picture?: string; about?: string; banner?: string; nip05?: string } | null) => {
        if (cancelled || !k0) return
        if (!k0.picture && !k0.name && !k0.banner) return
        setSellerProfile(p => p
          ? {
              ...p,
              picture: p.picture ?? (k0.picture || null),
              name: p.name ?? (k0.name || null),
              about: p.about ?? (k0.about || null),
              banner: p.banner ?? (k0.banner || null),
              nip05: p.nip05 ?? (k0.nip05 || null),
            }
          : p)
      })
      .catch(() => {/* silent — fallback stays */})
    return () => { cancelled = true }
  }, [offer?.creatorPubkey, sellerProfile])

  // ADR-188: detail↔slider binding — fetch sibling offers from the same vendor
  // and the marketplace list so the user can browse without leaving the page.
  // Both hooks are TanStack-Query cached and share state with CompanyProfile
  // (vendor) and the marketplace browse (all).
  const { data: vendorOffers, isLoading: vendorOffersLoading } = useVendorOffers(offer?.creatorPubkey ?? '')
  const { data: allOffers } = useAllOffers()

  const offerToSliderItem = (o: Offer): SliderListItem => ({
    id: o.id,
    title: o.title,
    category: o.category,
    avatarUrl: o.images?.[0],
    priceSats: o.priceSats,
    priceLabel: foreignPriceText(o) ?? undefined,
    entityType: 'offer',
    categoryCode: o.categoryCode,
    offerType: o.offerType,
    country: o.country ?? null,
    companyId: o.companyId ?? null,
  } as SliderListItem)

  const { vendorItems, allItems } = useDetailSliderItems({
    vendorList: vendorOffers,
    allList: allOffers,
    anchor: offer,
    mapItem: offerToSliderItem,
  })

  // Derive sibling-browse filter from the currently-viewed offer itself so the
  // 'All' slider segment only shows items in the same browsing context
  // (same main category + same offerType + same country). The vendor segment
  // is unaffected. Resets naturally on navigation because it depends on `offer`.
  const contextFilters: DetailSliderContextFilters | undefined = useMemo(() => {
    if (!offer) return undefined
    const mainCategory = offer.categoryCode?.split('/')[0] || undefined
    const offerType = offer.offerType && offer.offerType !== 'COOP'
      ? offer.offerType
      : undefined
    return {
      categoryPrefix: mainCategory,
      offerType,
      country: offer.country ?? null,
    }
  }, [offer])

  const loginPubkey = localStorage.getItem('pubkey') ?? ''
  const { addItem, isInCart, lastAddedItem, undoLastAdd } = useCart()
  const { showSnackbar, showSnackbarWithUndo } = useNotification()
  const { isFavorite, toggleFavorite } = useFavoritesWithUndo({ entityType: 'offer', showSnackbarWithUndo })
  // ADR-366 follow-on: owner-management menu on the detail page — the same
  // actions the Sell Listings card menu exposes (View is redundant here,
  // we're already on the detail page). Only rendered for the offer's own
  // creator; buyers never see this.
  const isOwnOffer = Boolean(loginPubkey) && offer?.creatorPubkey === loginPubkey
  const { setStatus, toggleActive, deleteOffer } = useOfferListActions(loginPubkey)
  const [headerMenuAnchor, setHeaderMenuAnchor] = useState<HTMLElement | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const variantIdParam = searchParams.get('v')

  // ADR-270 D5: Variant selection state and resolution
  const isVariable = Boolean(offer?.productType === 'variable' && offer?.variantAxes && offer.variantAxes.length > 0)
  const variations = useMemo(() => offer?.variations || [], [offer?.variations])

  const [selectedAxes, setSelectedAxes] = useState<Record<string, string>>({})

  // Initialize from deep link ?v=<childOfferId> or default
  useEffect(() => {
    if (!isVariable || variations.length === 0) return
    if (variantIdParam) {
      const match = variations.find(v => v.id === variantIdParam)
      if (match?.variantValues) {
        setSelectedAxes(match.variantValues)
        return
      }
    }
  }, [isVariable, variantIdParam, variations])

  // Resolve matching child offer
  const selectedChildOffer = useMemo(() => {
    if (!isVariable || !offer?.variantAxes || offer.variantAxes.length === 0) return null
    const allAxesSelected = offer.variantAxes.every(a => Boolean(selectedAxes[a.name]))
    if (!allAxesSelected) return null
    return variations.find(v =>
      offer.variantAxes!.every(a => v.variantValues?.[a.name] === selectedAxes[a.name])
    ) || null
  }, [isVariable, offer?.variantAxes, selectedAxes, variations])

  // When selection resolves a child, sync deep link param ?v=
  const handleSelectAxisValue = (axisName: string, val: string) => {
    const nextAxes = { ...selectedAxes, [axisName]: val }
    setSelectedAxes(nextAxes)
    if (offer?.variantAxes?.every(a => Boolean(nextAxes[a.name]))) {
      const match = variations.find(v =>
        offer.variantAxes!.every(a => v.variantValues?.[a.name] === nextAxes[a.name])
      )
      if (match?.id) {
        setSearchParams(prev => {
          const next = new URLSearchParams(prev)
          next.set('v', match.id)
          return next
        }, { replace: true })
      }
    }
  }

  // Check if an axis value is available given current selections (rendered disabled not hidden per D5)
  const isCombinationPossible = (axisName: string, val: string) => {
    if (!isVariable || variations.length === 0) return true
    return variations.some(v => {
      if (v.variantValues?.[axisName] !== val) return false
      if (v.listingVisibility === 'hidden') return false
      for (const otherAxis of offer?.variantAxes || []) {
        if (otherAxis.name !== axisName && selectedAxes[otherAxis.name]) {
          if (v.variantValues?.[otherAxis.name] !== selectedAxes[otherAxis.name]) {
            return false
          }
        }
      }
      return true
    })
  }

  // Price range calculation
  const { minPrice, hasPriceRange } = useMemo(() => {
    if (!isVariable || variations.length === 0) {
      return { minPrice: offer?.priceSats ?? 0, hasPriceRange: false }
    }
    const prices = variations.map(v => v.priceSats).filter(p => typeof p === 'number')
    if (prices.length === 0) return { minPrice: offer?.priceSats ?? 0, hasPriceRange: false }
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    return { minPrice: min, hasPriceRange: min !== max }
  }, [isVariable, variations, offer?.priceSats])

  const activePriceSats = selectedChildOffer ? selectedChildOffer.priceSats : (isVariable ? minPrice : (offer?.priceSats ?? 0))
  const activeImages = useMemo(() => {
    if (selectedChildOffer?.images && selectedChildOffer.images.length > 0) {
      return selectedChildOffer.images
    }
    return offer?.images ?? []
  }, [selectedChildOffer?.images, offer?.images])
  const activeStock = selectedChildOffer ? selectedChildOffer.stock : (offer?.product?.stock ?? offer?.stock)
  const targetOfferId = selectedChildOffer ? selectedChildOffer.id : (offer?.id ?? '')
  const targetTitle = selectedChildOffer ? selectedChildOffer.title : (offer?.title ?? '')
  const targetVariantLabel = selectedChildOffer?.variantValues ? formatVariantLabel(selectedChildOffer.variantValues) : undefined

  const pageRef = useRef<HTMLDivElement>(null)
  const detailsRef = useRef<HTMLDivElement>(null)
  const swipeRef = useRef<HTMLDivElement>(null)

  // Active slider segment, owned by the page so the mobile swipe nav browses
  // the same list (Vendor ↔ Marketplace) the user selected in the slider.
  const [sliderSegment, setSliderSegment] = useState<DetailSliderSegment>('vendor')
  const swipeHandlers = useDetailSwipeNav({
    containerRef: swipeRef,
    segment: sliderSegment,
    vendorItems,
    allItems,
    contextFilters,
    activeId: offer?.id,
    toRoute: toProductDetailRoute,
    onSwipeNavigate: notifySwipeHintDismissed,
  })

  // Has at least one sibling to swipe to in the active segment (vendor or
  // context-filtered marketplace). Drives the one-time `SwipeHint` so we never
  // tease a gesture the user can't perform.
  const hasSiblings = useMemo(() => {
    const list = sliderSegment === 'vendor' ? vendorItems : allItems
    return list.length > 1
  }, [sliderSegment, vendorItems, allItems])
  const sidebarRef = useRef<HTMLDivElement>(null)
  const sidebarTimelineRef = useRef<gsap.core.Timeline | null>(null)

  const gsapTimelineRef = useRef<gsap.core.Timeline | null>(null)
  const snackbarTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingItemRef = useRef<{ offerId: string; title: string } | null>(null)


  useEffect(() => {
    if (!lastAddedItem) return
    pendingItemRef.current = { offerId: lastAddedItem.offerId, title: lastAddedItem.title }
    if (snackbarTimeoutRef.current) clearTimeout(snackbarTimeoutRef.current)
    snackbarTimeoutRef.current = setTimeout(() => {
      if (pendingItemRef.current) {
        showSnackbarWithUndo({
          message: `"${pendingItemRef.current.title.slice(0, 20)}${pendingItemRef.current.title.length > 20 ? '…' : ''}" added to basket`,
          severity: 'success',
          undoLabel: 'Undo',
          onUndo: undoLastAdd,
        })
        pendingItemRef.current = null
      }
    }, 350)
    return () => { if (snackbarTimeoutRef.current) clearTimeout(snackbarTimeoutRef.current) }
  }, [lastAddedItem])

  useEffect(() => {
    if (!lastAddedItem) return
    if (gsapTimelineRef.current) gsapTimelineRef.current.kill()
    const fab = document.querySelector('.cart-fab-btn') as HTMLElement | null
    if (!fab) return
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) return
    gsapTimelineRef.current = gsap.timeline()
    gsapTimelineRef.current.to(fab, {
      scale: 1.2,
      boxShadow: '0 0 24px rgba(72,187,120,0.55), 0 0 48px rgba(72,187,120,0.30)',
      duration: 0.25,
      ease: 'power2.out',
    })
    gsapTimelineRef.current.to(fab, {
      scale: 1,
      boxShadow: '',
      duration: 0.4,
      ease: 'power2.inOut',
    })
  }, [lastAddedItem])

  useEffect(() => {
    if (!lastAddedItem) return
    if (sidebarTimelineRef.current) sidebarTimelineRef.current.kill()
    const sidebar = sidebarRef.current
    if (!sidebar) return
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) return
    sidebarTimelineRef.current = gsap.timeline()
    sidebarTimelineRef.current.to(sidebar, {
      scale: 1.02,
      boxShadow: '0 8px 30px rgba(72,187,120,0.35), 0 2px 8px rgba(0,0,0,0.10)',
      borderColor: 'rgba(72,187,120,0.50)',
      duration: 0.25,
      ease: 'power2.out',
    })
    sidebarTimelineRef.current.to(sidebar, {
      scale: 1,
      boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)',
      borderColor: 'var(--theme-border)',
      duration: 0.4,
      ease: 'power2.inOut',
    })
  }, [lastAddedItem])



  function formatDate(dateString: string): string {
    return formatLocaleDate(new Date(dateString), {
      year: 'numeric', month: 'short', day: 'numeric',
    })
  }

  function formatCategoryCode(code: string): string {
    return code
      .split('/')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' '))
      .join(' › ')
  }

  if (queryError && !offer) {
    return (
      <NotFoundState
        icon={<Inventory2Icon sx={{ fontSize: { xs: 44, sm: 52 } }} />}
        title="Offer not found"
        message="This offer may have been removed, or the link is incorrect."
        detail={productId ? `Offer ${productId}` : undefined}
        primary={{ label: 'Back to marketplace', to: '/buy' }}
        secondary={{ label: 'Go back', onClick: () => navigate(-1) }}
      />
    )
  }

  if (!offer) {
    return (
      <PageContainer size="wide" spacing="none">
        <Stack alignItems="center" justifyContent="center" sx={{ minHeight: '60vh' }}>
          <Stack alignItems="center" spacing={1}>
            <CircularProgress size={32} />
            <Typography variant="body2" color="text.secondary">Loading offer...</Typography>
          </Stack>
        </Stack>
      </PageContainer>
    )
  }

  const isService = offer.offerType === 'SERVICE'
  const isItem = offer.offerType === 'ITEM'
  const isAgent = offer.offerType === 'AGENT_SETUP'
  // ADR-370 D6 (Phase 2): the offer's canvas declaration for pre-purchase
  // disclosure (G1). AgentCanvasConfig is the client mirror of the server
  // contract — absent for offers without a canvas.
  const offerCanvas = isAgent ? offer.agentConfigMeta?.canvas ?? null : null
  const effectiveCompany = offer.company || resolvedCompany
  const isCorporate = !!(offer.companyId || effectiveCompany)
  const isMilestone = offer.ticketType === 'MILESTONE'
  const milestones = offer.offerMilestones ?? []
  // Same source as the Details section: categoryCode formatted, legacy string as fallback
  const categoryLabel = offer.categoryCode
    ? formatCategoryCode(offer.categoryCode)
    : offer.category || undefined
  const locationDisplay = (() => {
    const parts: string[] = []
    if (offer.city) parts.push(offer.city)
    if (offer.country) parts.push(COUNTRIES.find(c => c.code === offer.country)?.name ?? offer.country)
    if (parts.length) return parts.join(', ') + (offer.isRemote ? ' · Remote' : '')
    if (offer.isRemote) return 'Remote'
    return offer.location ?? null
  })()
  const hasSellerStats = offer.sellerStats && (
    offer.sellerStats.rating !== undefined || offer.sellerStats.completionRate !== undefined
  )

  // Key-value grid data — resolved once so the JSX stays readable and so the
  // grid only renders when at least one column has something to show.
  const ratingValue: string | null = sellerProfile?.reputationScore !== undefined
    ? sellerProfile.reputationScore.toFixed(2)
    : (hasSellerStats && offer.sellerStats?.rating !== undefined
        ? offer.sellerStats.rating.toFixed(2)
        : null)
  const ratingCount: number | null = sellerProfile?.reputationScore !== undefined
    ? (sellerProfile.reviewCount ?? null)
    : (hasSellerStats && offer.sellerStats?.rating !== undefined
        ? (offer.sellerStats?.reviewCount ?? null)
        : null)
  const completionValue: number | null = hasSellerStats && offer.sellerStats?.completionRate !== undefined
    ? offer.sellerStats.completionRate
    : null
  const hasReputationData = ratingValue !== null || completionValue !== null
  const hasKeyValueData = hasReputationData
    || sellerProfile?.colPoints !== undefined
    || Boolean(sellerProfile?.stats)

  const sellerDashboardUrl = (offer.companyId || effectiveCompany?.id)
    ? `/buy?companyId=${offer.companyId || effectiveCompany?.id}`
    : `/buy?sellerPubkey=${offer.creatorPubkey}`

  // Display-only sat estimate for foreign-priced remote listings (never used for settlement).
  const remoteEstimate = offer.priceCurrency
    ? estimateSatsFromForeignPrice(offer.priceAmount, offer.priceCurrency, rates)
    : null
  const isRemoteOffer = offer.source === 'REMOTE'

  return (
    <PageContainer size="wide" spacing="none" className="page-animate" ref={pageRef}>
      <PageHeader
        icon={isService ? <WorkIcon /> : <Inventory2Icon />}
        title={offer.title}
        subtitle={offer.categoryCode ? formatCategoryCode(offer.categoryCode) : undefined}
        onBack={() => window.history.back()}
        actions={isOwnOffer ? (() => {
          const isAgent = offer.offerType === 'AGENT_SETUP'
          const menuItems: Array<{ key: string; label: string; icon: React.ReactNode; color?: string; divider?: boolean }> = []
          // FU-472: SellListingDetail doesn't support AGENT_SETUP offers (it
          // coerces offerType to ITEM on save) — no Edit entry for agents,
          // mirrors the same guard in ListingsTab's card menu.
          if (!isAgent) menuItems.push({ key: 'edit', label: 'Edit', icon: <Pencil size={16} /> })
          if (isAgent) {
            menuItems.push({
              key: 'toggle-active',
              label: offer.status === 'ACTIVE' ? 'Deactivate' : 'Activate',
              icon: <Power size={16} />,
              color: offer.status === 'ACTIVE' ? 'text.secondary' : 'success.main',
            })
          } else if (offer.status === 'DRAFT' || offer.status === 'ARCHIVED') {
            // ADR-366 follow-on: ARCHIVED can republish too — was a dead end
            // before (Edit + Delete only), no way back to ACTIVE.
            menuItems.push({ key: 'publish', label: 'Publish', icon: <Play size={16} />, color: 'success.main' })
          } else if (offer.status === 'ACTIVE') {
            menuItems.push({ key: 'archive', label: 'Archive', icon: <Archive size={16} />, color: 'text.secondary' })
          }
          menuItems.push({ key: 'delete', label: 'Delete', icon: <Trash2 size={16} />, color: 'error.main', divider: true })

          return (
            <div className="flex items-center justify-end gap-2 min-w-0" style={{ marginLeft: 'auto' }}>
              <button
                onClick={(e) => { e.stopPropagation(); setHeaderMenuAnchor(e.currentTarget) }}
                className="flex items-center justify-center transition-colors duration-150 rounded-lg cursor-pointer"
                style={{
                  width: 36, height: 36,
                  background: 'var(--theme-bg-subtle)',
                  border: '1px solid var(--theme-border)',
                  color: 'var(--theme-text-muted)',
                }}
                aria-label="Manage this offer"
              >
                <MoreVertical size={16} strokeWidth={2.5} />
              </button>
              <Menu
                anchorEl={headerMenuAnchor}
                open={Boolean(headerMenuAnchor)}
                onClose={() => setHeaderMenuAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                slotProps={{ paper: { sx: { borderRadius: 2, minWidth: 160 } } }}
              >
                {menuItems.flatMap((a, idx) => [
                  ...(a.divider && idx > 0 ? [<Divider key={`d-${a.key}`} />] : []),
                  <MenuItem
                    key={a.key}
                    onClick={() => {
                      setHeaderMenuAnchor(null)
                      if (a.key === 'edit') navigate(`/sell/listings/${offer.id}`)
                      else if (a.key === 'toggle-active') {
                        const willBeActive = offer.status !== 'ACTIVE'
                        toggleActive(offer)
                          .then(() => showSnackbar(willBeActive ? 'Agent activated' : 'Agent deactivated', 'success'))
                          .catch((err) => showSnackbar(err instanceof Error ? err.message : 'Failed to update agent listing', 'error'))
                      }
                      else if (a.key === 'publish') {
                        setStatus(offer, 'ACTIVE')
                          .then(() => showSnackbar('Listing published', 'success'))
                          .catch((err) => showSnackbar(err instanceof Error ? err.message : 'Failed to publish listing', 'error'))
                      }
                      else if (a.key === 'archive') {
                        setStatus(offer, 'ARCHIVED')
                          .then(() => showSnackbar('Listing archived', 'success'))
                          .catch((err) => showSnackbar(err instanceof Error ? err.message : 'Failed to archive listing', 'error'))
                      }
                      else if (a.key === 'delete') setDeleteConfirmOpen(true)
                    }}
                    sx={a.color ? { color: a.color } : undefined}
                  >
                    <ListItemIcon sx={a.color ? { color: a.color } : undefined}>{a.icon}</ListItemIcon>
                    <ListItemText>{a.label}</ListItemText>
                  </MenuItem>,
                ])}
              </Menu>
            </div>
          )
        })() : undefined}
        actionsFit="inline"
      />

      {isOwnOffer && deleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-sm p-5 rounded-xl" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
            <h3 className="text-[16px] font-semibold mb-2" style={{ color: 'var(--theme-text)' }}>Delete this offer?</h3>
            <p className="text-[13px] mb-4" style={{ color: 'var(--theme-text-muted)' }}>This action cannot be undone. &quot;{offer.title}&quot; will be permanently removed.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteConfirmOpen(false)} className="flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 cursor-pointer hover:opacity-90" style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text)' }}>
                Cancel
              </button>
              <button
                onClick={() => {
                  deleteOffer(offer)
                    .then(() => { setDeleteConfirmOpen(false); navigate('/sell/listings') })
                    .catch((err) => showSnackbar(err instanceof Error ? err.message : 'Failed to delete offer', 'error'))
                }}
                className="flex-1 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 cursor-pointer hover:opacity-90"
                style={{ background: 'var(--color-status-error, #E84541)', color: 'white' }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile swipe-to-next wrapper — horizontal swipe navigates to the
          next/previous offer (see useDetailSwipeNav). Wraps gallery + content
          so the whole detail body slides; the PageHeader stays put. */}
      <div ref={swipeRef} {...swipeHandlers}>
      {/* ── Image Gallery ──────────────────────────────────────────────── */}
      <Box sx={{ position: 'relative', mb: { xs: 3, md: 4 } }} className="hero-animate">
        <Tooltip title={isFavorite(offer.id) ? 'Remove from favorites' : 'Add to favorites'} arrow>
          <Box
            component="button"
            onClick={() => toggleFavorite(offer.id)}
            sx={{
              position: 'absolute',
              top: 12,
              right: 12,
              zIndex: 2,
              width: 36, height: 36,
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: isFavorite(offer.id) ? '#E84541' : 'rgba(0,0,0,0.45)',
              color: 'white',
              backdropFilter: 'blur(4px)',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              '&:hover': {
                backgroundColor: isFavorite(offer.id) ? '#d63031' : 'rgba(0,0,0,0.6)',
                transform: 'scale(1.1)',
              },
            }}
          >
            <FavoriteIcon sx={{ fontSize: 18 }} />
          </Box>
        </Tooltip>

        {activeImages.length > 0 ? (
          <DetailImageGallery images={activeImages} title={targetTitle} />
        ) : (
          <Box sx={{
            width: '100%', height: { xs: 280, sm: 360 }, borderRadius: 'var(--radius-lg, 12px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            bgcolor: 'var(--theme-bg-subtle)', border: '1px solid', borderColor: 'divider',
          }}>
            {isService
              ? <WorkIcon sx={{ fontSize: 48, color: 'text.secondary' }} />
              : <Inventory2Icon sx={{ fontSize: 48, color: 'text.secondary' }} />}
          </Box>
        )}
      </Box>

      <Grid container spacing={{ xs: 3, lg: 4 }}>

        {/* ── Left Column ─────────────────────────────────────────────────── */}
        <Grid size={{ xs: 12, lg: 8 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }} ref={detailsRef}>

            {/* Title + Category breadcrumb */}
            <Box className="section-animate">
              <Typography variant="h5" fontWeight={300} sx={{ lineHeight: 1.25, mb: 2, fontSize: { xs: '1.6rem', md: '2.15rem' } }}>
                {offer.title}
              </Typography>
              {offer.categoryCode && (
                <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
                  {offer.categoryCode.split('/').map((segment, i, arr) => {
                    const prefix = arr.slice(0, i + 1).join('/')
                    return (
                      <Fragment key={prefix}>
                        {i > 0 && <ArrowRightIcon sx={{ fontSize: 15, color: 'text.disabled' }} />}
                        <Chip
                          component={Link}
                          to={`/search?context=marketplace&categoryCode=${encodeURIComponent(prefix)}&q=&proximity=world`}
                          label={formatCategoryCode(segment)}
                          size="small"
                          variant="outlined"
                          clickable
                          sx={{
                            height: 27, fontSize: '0.78rem', fontWeight: 600,
                            color: 'text.secondary',
                            borderColor: 'var(--theme-border)',
                            bgcolor: 'var(--theme-bg-subtle)',
                            transition: 'border-color 0.15s ease, color 0.15s ease, background-color 0.15s ease',
                            '&:hover': {
                              color: 'var(--color-primary-50)',
                              borderColor: 'rgba(232,69,65,0.5)',
                              bgcolor: 'rgba(232,69,65,0.06)',
                            },
                          }}
                        />
                      </Fragment>
                    )
                  })}
                </Box>
              )}
            </Box>

            {/* Meta */}
            <Box className="section-animate">
              <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                {isAgent && (
                  <Chip
                    label="Agent"
                    size="small"
                    variant="outlined"
                    icon={<Bot size={13} />}
                    sx={{
                      fontWeight: 700, height: 22, fontSize: '0.65rem',
                      borderColor: 'rgba(159,122,234,0.5)',
                      color: '#9F7AEA',
                      '& .MuiChip-icon': { color: '#9F7AEA' },
                      '@keyframes agentChipGlow': {
                        '0%, 100%': { boxShadow: '0 0 3px 0 rgba(159,122,234,0.2)' },
                        '50%': { boxShadow: '0 0 11px 2px rgba(159,122,234,0.55)' },
                      },
                      animation: 'agentChipGlow 2.4s ease-in-out infinite',
                      '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                    }}
                  />
                )}
                {/* ADR-370 D6 (Phase 2): pre-purchase canvas disclosure (G1). */}
                {isAgent && offerCanvas && offerCanvas.provider !== 'none' && (
                  <Chip
                    label={offerCanvas.provider === 'doop-hosted'
                      ? (offerCanvas.agentInCanvas ? 'Canvas · Agent works on it' : 'Canvas')
                      : 'Canvas (seller-hosted)'}
                    size="small"
                    variant="outlined"
                    icon={<Frame size={12} />}
                    title={offerCanvas.provider === 'doop-hosted'
                      ? 'Colabonate-hosted collaboration canvas — opened from your ticket after purchase'
                      : 'Collaboration canvas on the seller\'s own doop instance'}
                    sx={{
                      fontWeight: 600, height: 22, fontSize: '0.65rem',
                      borderColor: 'rgba(159,122,234,0.35)',
                      color: '#9F7AEA',
                      '& .MuiChip-icon': { color: '#9F7AEA' },
                    }}
                  />
                )}
                {/* ADR-372 D2: transparent pre-purchase fee disclosure (hosted
                    canvas only — doop-local + agentInCanvas stay free, D6). */}
                {isAgent && offerCanvas?.provider === 'doop-hosted' && (
                  <Chip
                    label={`Fee ${HOSTED_CANVAS_FEE_SATS} sats`}
                    size="small"
                    variant="outlined"
                    icon={<Zap size={12} />}
                    title={`Colabonate service fee ${HOSTED_CANVAS_FEE_SATS} sats, paid at purchase — not refundable`}
                    sx={{
                      fontWeight: 600, height: 22, fontSize: '0.65rem',
                      borderColor: 'rgba(99,179,237,0.35)',
                      color: 'var(--color-primary-50)',
                      '& .MuiChip-icon': { color: 'var(--color-primary-50)' },
                    }}
                  />
                )}
                {categoryLabel && (
                  <Chip
                    label={categoryLabel}
                    size="small"
                    color="primary"
                    variant="outlined"
                    sx={{ fontWeight: 600, height: 22, fontSize: '0.7rem' }}
                  />
                )}
                <Chip
                  label={isAgent ? 'Agent' : isItem ? 'Item' : isService ? 'Service' : 'Product'}
                  size="small"
                  variant="outlined"
                  sx={{
                    fontWeight: 700, height: 22, fontSize: '0.65rem',
                    borderColor: isService ? 'rgba(99,179,237,0.5)' : 'rgba(72,187,120,0.5)',
                    color: isService ? '#63B3ED' : '#48B978',
                  }}
                />
                {!isRemoteOffer && (
                <Tooltip title={isMilestone ? `Payment split into ${milestones.length} phases` : (offer?.useEscrow ? 'Funds held in escrow, released in 3 phases' : 'Paid directly to the seller over Lightning — Colabonate never holds the funds')} arrow>
                  <Chip
                    label={isMilestone ? `Milestone (${milestones.length} phases)` : 'Smart Order'}
                    size="small"
                    variant="outlined"
                    icon={isMilestone
                      ? <Flag size={13} style={{ color: 'var(--color-primary-50)' }} />
                      : <BoltIcon sx={{ fontSize: 13, color: 'var(--color-primary-50)' }} />}
                    sx={{
                      fontWeight: 700, height: 22, fontSize: '0.65rem',
                      borderColor: 'rgba(99,179,237,0.35)',
                      color: 'var(--color-primary-50)',
                      '& .MuiChip-icon': { color: 'var(--color-primary-50)' },
                    }}
                  />
                </Tooltip>
                )}
                {isCorporate ? (
                  <Tooltip title="Offered by a verified business" arrow>
                    <Chip label="Business" size="small" variant="outlined"
                      icon={<StorefrontIcon sx={{ fontSize: '0.85rem !important' }} />}
                      sx={{ fontWeight: 700, height: 22, fontSize: '0.65rem', borderColor: 'rgba(99,179,237,0.5)', color: 'var(--color-primary-50)' }} />
                  </Tooltip>
                ) : null}
                <Tooltip title="Publication date" arrow>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'default' }}>
                    <AccessTimeIcon sx={{ fontSize: 13, color: 'text.disabled' }} />
                    <Typography variant="caption" color="text.secondary">{formatDate(offer.createdAt)}</Typography>
                  </Box>
                </Tooltip>
                {locationDisplay && (
                  <Tooltip title={offer.isRemote ? 'Remote / Online' : 'Location'} arrow>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'default' }}>
                      <PlaceIcon sx={{ fontSize: 13, color: 'text.disabled' }} />
                      <Typography variant="caption" color="text.secondary">{locationDisplay}</Typography>
                    </Box>
                  </Tooltip>
                )}
              </Stack>
            </Box>

            {/* Seller Card — compact full-profile mirror of /user/:pubkey.
                Banner (Nostr Kind 0) fills the whole card as background with a
                downward fade into the surface. Avatar (Nostr Kind 0 picture) +
                name + NIP-05 + lightning address inline in a slim header.
                Activity stats in a single horizontal strip. Footer keeps the
                company storefront link and the "View Profile" CTA side by side.
                Visibility rules mirror UserProfile.tsx so PRIVATE sellers
                don't leak personal metadata they chose to hide. */}
            <Box
              className="section-animate"
              sx={{
                position: 'relative',
                borderRadius: 'var(--radius-lg, 12px)',
                background: 'var(--theme-surface)',
                border: '2px solid',
                borderColor: sellerIdentityLevel === 0 ? 'rgba(158,158,158,0.3)' : sellerIdentityLevel === 1 ? 'rgba(25,118,210,0.3)' : sellerIdentityLevel === 2 ? 'rgba(123,31,162,0.3)' : 'rgba(245,127,23,0.3)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)',
                transition: 'box-shadow 0.2s ease, border-color 0.3s ease',
                overflow: 'hidden',
                '&:hover': { boxShadow: '0 2px 8px rgba(0,0,0,0.08), 0 6px 16px rgba(0,0,0,0.06)' },
              }}
            >
              {/* Banner background layer — covers the whole card. The image
                  itself is softened (blur + reduced opacity) so it reads as a
                  subtle decorative texture rather than competing with the
                  header text, and a stacked scrim — dark at the top to keep
                  the SELLER label / badge legible on dark banners, plus a
                  surface-tinted wash for the whole card so bright / pale
                  banners can't blow out the contrast — fades into the surface
                  color at the bottom to keep the lower content on-theme. Only
                  renders when the seller actually has a banner (Nostr Kind 0
                  metadata). */}
              {sellerProfile?.banner && sellerProfile?.visibility !== 'PRIVATE' && (
                <Box
                  aria-hidden
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    backgroundImage: `url(${sellerProfile.banner})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    backgroundColor: 'var(--theme-bg-subtle)',
                    filter: 'blur(6px)',
                    transform: 'scale(1.06)',
                    opacity: 0.7,
                    '&::before': {
                      content: '""',
                      position: 'absolute',
                      inset: 0,
                      background: 'var(--theme-surface)',
                      opacity: 0.55,
                    },
                    '&::after': {
                      content: '""',
                      position: 'absolute',
                      inset: 0,
                      background: 'linear-gradient(to bottom, rgba(0,0,0,0.22) 0%, rgba(0,0,0,0) 22%, transparent 45%, var(--theme-surface) 100%)',
                    },
                  }}
                />
              )}

              {/* Content layer — sits on top of the banner background */}
              <Box sx={{ position: 'relative', zIndex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: { xs: 2.5, sm: 3 }, pt: { xs: 2.5, sm: 3 }, pb: 1.5 }}>
                  <StorefrontIcon fontSize="small" sx={{ color: sellerIdentityLevel === 0 ? '#9e9e9e' : sellerIdentityLevel === 1 ? '#1976d2' : sellerIdentityLevel === 2 ? '#7b1fa2' : '#f57f17' }} />
                  <Typography variant="subtitle2" fontWeight={700} color="text.secondary"
                    sx={{ textTransform: 'uppercase', letterSpacing: 0.75, fontSize: '0.7rem' }}>
                    {isRemoteOffer ? 'Publisher' : 'Seller'}
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  {!isRemoteOffer && (
                  <IdentityLevelBadge level={sellerIdentityLevel as IdentityLevel} size="small" />
                  )}
                </Box>

                {/* Private profile notice — same policy as UserProfile.tsx */}
                {sellerProfile?.visibility === 'PRIVATE' ? (
                  <Box sx={{ px: { xs: 2.5, sm: 3 }, pb: { xs: 2.5, sm: 3 }, display: 'flex', alignItems: 'center', gap: 2 }}>
                    <LockIcon sx={{ fontSize: 22, color: 'var(--theme-text-muted)' }} />
                    <Box>
                      <Typography variant="body2" fontWeight={600} color="text.primary">Private Profile</Typography>
                      <Typography variant="caption" color="text.secondary">Only the identity level is visible.</Typography>
                    </Box>
                  </Box>
                ) : (
                  <Box sx={{ px: { xs: 2.5, sm: 3 }, pb: { xs: 2.5, sm: 3 } }}>
                    {/* Slim header — Nostr avatar + name + NIP-05 + lightning on one row.
                        Avatar and name scale up at lg/xl to match the larger info grid. */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{
                        position: 'relative',
                        width: { xs: 40, sm: 44, md: 48, lg: 56, xl: 64 },
                        height: { xs: 40, sm: 44, md: 48, lg: 56, xl: 64 },
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        overflow: 'hidden',
                        background: 'var(--color-primary-10)',
                        color: 'var(--color-primary-50)',
                        border: '2px solid var(--theme-surface)',
                        fontSize: { xs: '1rem', lg: '1.2rem' },
                        fontWeight: 800,
                      }}>
                        {(
                          sellerProfile?.picture
                            ? <Box component="img" src={sellerProfile.picture} alt={sellerProfile.name || ''}
                                sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                                onError={(e: React.SyntheticEvent<HTMLImageElement>) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                            : null
                        )}
                        {(sellerProfile?.name || sellerProfile?.lnAddress || offer.creator?.lnAddress || offer.creatorPubkey).charAt(0).toUpperCase() || <PersonIcon sx={{ fontSize: { xs: 22, lg: 28 } }} />}
                      </Box>

                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body1" fontWeight={700} sx={{
                          color: 'var(--theme-text)',
                          fontSize: { xs: 15, sm: 16, md: 17, lg: 18 },
                          lineHeight: 1.2,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
                        }}>
                          {sellerProfile?.name
                            || sellerProfile?.lnAddress
                            || effectiveCompany?.name
                            || offer.creator?.lnAddress
                            || (offer.creatorPubkey.slice(0, 12) + '…')}
                        </Typography>

                        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, lg: 1.5 }, mt: 0.25, flexWrap: 'wrap' }}>
                          {sellerProfile?.nip05 && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                              <CheckCircleOutlineIcon sx={{ fontSize: { xs: 13, lg: 16 }, color: 'var(--color-status-success)', flexShrink: 0 }} />
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: { xs: '0.75rem', lg: '0.85rem' }, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {sellerProfile.nip05}
                              </Typography>
                            </Box>
                          )}
                          {(sellerProfile?.lnAddress || offer.creator?.lnAddress) && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                              <BoltIcon sx={{ fontSize: { xs: 13, lg: 16 }, color: 'var(--color-primary-50)', flexShrink: 0 }} />
                              <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'var(--theme-text-muted)', fontSize: { xs: '0.75rem', lg: '0.85rem' }, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {sellerProfile?.lnAddress || offer.creator?.lnAddress}
                              </Typography>
                            </Box>
                          )}
                          {!sellerProfile?.nip05 && !(sellerProfile?.lnAddress || offer.creator?.lnAddress) && (
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: { xs: '0.75rem', lg: '0.85rem' } }}>{isRemoteOffer ? 'Publisher on another marketplace' : 'New seller'}</Typography>
                          )}
                        </Box>
                      </Box>
                    </Box>

                    {/* Key-value grid — 3 logical columns (REPUTATION / EARNINGS /
                        ACTIVITY) arranged side-by-side in the same row at lg/xl,
                        stacked at xs/sm/md. Each column has a small uppercase
                        heading and a stack of labeled cells (icon + key + value)
                        so the meaning of every datum is unambiguous. Renders
                        only when at least one cell has data. */}
                    {hasKeyValueData && !isRemoteOffer && (
                      <Box sx={{
                        display: 'grid',
                        gridTemplateColumns: {
                          xs: '1fr',
                          md: 'repeat(2, 1fr)',
                          lg: 'repeat(3, 1fr)',
                        },
                        gap: { xs: 2, md: 2.5, lg: 3 },
                        rowGap: { xs: 2.5, md: 2.5, lg: 2.5 },
                        mt: { xs: 2, lg: 2.5 },
                        pt: { xs: 2, lg: 2.5 },
                        borderTop: '1px solid var(--theme-border)',
                      }}>
                        {/* REPUTATION — trust signals: average rating + completion rate.
                            Column icon sits with the heading, not per-cell. */}
                        {hasReputationData && (
                          <KeyValueColumn
                            heading="Reputation"
                            icon={<ShieldIcon sx={{ fontSize: { xs: 14, md: 15, lg: 18 }, color: 'var(--color-primary-50)' }} />}
                          >
                            {ratingValue && (
                              <KeyValueCell
                                label="Rating"
                                value={
                                  <>
                                    {ratingValue}
                                    {ratingCount !== null && (
                                      <Box component="span" sx={{ color: 'var(--theme-text-muted)', fontWeight: 500, ml: 0.5, fontSize: '0.85em' }}>
                                        ({ratingCount} {ratingCount === 1 ? 'review' : 'reviews'})
                                      </Box>
                                    )}
                                  </>
                                }
                              />
                            )}
                            {completionValue !== null && (
                              <KeyValueCell
                                label="Completion"
                                value={
                                  <Box component="span" sx={{ color: 'success.main' }}>
                                    {completionValue}%
                                  </Box>
                                }
                              />
                            )}
                          </KeyValueColumn>
                        )}

                        {/* EARNINGS — loyalty / reputation points in the Colabonate system */}
                        {sellerProfile?.colPoints !== undefined && (
                          <KeyValueColumn
                            heading="Earnings"
                            icon={<EmojiEventsIcon sx={{ fontSize: { xs: 14, md: 15, lg: 18 }, color: 'var(--color-primary-50)' }} />}
                          >
                            <KeyValueCell
                              label="COL-Points"
                              value={
                                <>
                                  {formatNumber(sellerProfile.colPoints)}
                                  <Box component="span" sx={{ color: 'var(--theme-text-muted)', fontWeight: 500, ml: 0.5, fontSize: '0.85em' }}>
                                    pts
                                  </Box>
                                </>
                              }
                            />
                          </KeyValueColumn>
                        )}

                        {/* ACTIVITY — marketplace activity: offers / completed / buyer / seller.
                            Cells arranged in a single-row 4-column sub-grid so
                            all four stats read on one line. Column icon sits
                            with the heading, not per-cell. */}
                        {sellerProfile?.stats && (
                          <KeyValueColumn
                            heading="Activity"
                            icon={<TrendingUp size={14} style={{ width: '100%', height: '100%', maxWidth: 18, maxHeight: 18, color: 'var(--color-primary-50)' }} />}
                          >
                            <Box sx={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                              columnGap: { xs: 1, md: 1.5, lg: 2 },
                              rowGap: { xs: 1, lg: 1.25 },
                            }}>
                              <KeyValueCell
                                label="Offers"
                                value={sellerProfile.stats.offersCreated}
                              />
                              <KeyValueCell
                                label="Completed"
                                value={sellerProfile.stats.completedTickets}
                              />
                              <KeyValueCell
                                label="As Buyer"
                                value={sellerProfile.stats.completedAsBuyer}
                              />
                              <KeyValueCell
                                label="As Seller"
                                value={sellerProfile.stats.completedAsSeller}
                              />
                            </Box>
                          </KeyValueColumn>
                        )}
                      </Box>
                    )}

                    {/* About (Nostr Kind 0 bio) — clamped to 2 lines so it doesn't
                        bloat the card. Font scales up at lg/xl. */}
                    {sellerProfile?.about && (
                      <Typography
                        color="text.secondary"
                        sx={{
                          display: '-webkit-box',
                          mt: { xs: 1.5, lg: 2 },
                          lineHeight: 1.5,
                          fontSize: '15px',
                          letterSpacing: '0.01em',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {sellerProfile.about}
                      </Typography>
                    )}

                    {/* Footer — company storefront link (left) + View Profile CTA (right) */}
                    <Box sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1.5,
                      mt: 1.5,
                      pt: 1.5,
                      borderTop: '1px solid var(--theme-border)',
                      flexWrap: 'wrap',
                    }}>
                      {/* Company / vendor storefront link — picks whichever is available */}
                      {sellerProfile?.company ? (
                        <Link to={`/buy/vendors/${offer.creatorPubkey}`} style={{ textDecoration: 'none', flex: 1, minWidth: 0 }}>
                          <Box sx={{
                            display: 'flex', alignItems: 'center', gap: 1,
                            py: 0.5, minWidth: 0,
                          }}>
                            <Box sx={{
                              width: 24, height: 24, borderRadius: 'var(--radius-sm, 6px)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: 'var(--color-primary-10)', color: 'var(--color-primary-50)',
                              flexShrink: 0, overflow: 'hidden',
                            }}>
                              {sellerProfile.company.logoUrl
                                ? <Box component="img" src={sellerProfile.company.logoUrl} alt={sellerProfile.company.name} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                : <StorefrontIcon sx={{ fontSize: 14 }} />}
                            </Box>
                            <Typography variant="caption" fontWeight={600} sx={{ color: 'var(--theme-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {sellerProfile.company.name}
                            </Typography>
                            <ArrowRightIcon sx={{ fontSize: 14, color: 'var(--theme-text-muted)', flexShrink: 0 }} />
                          </Box>
                        </Link>
                      ) : sellerDashboardUrl && (
                        <Link to={sellerDashboardUrl} style={{ textDecoration: 'none', flex: 1, minWidth: 0 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, minWidth: 0 }}>
                            <Box sx={{
                              width: 24, height: 24, borderRadius: 'var(--radius-sm, 6px)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: 'var(--color-primary-10)', color: 'var(--color-primary-50)',
                              flexShrink: 0, overflow: 'hidden',
                            }}>
                              {effectiveCompany?.logoUrl
                                ? <Box component="img" src={effectiveCompany.logoUrl} alt={effectiveCompany.name} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                : <StorefrontIcon sx={{ fontSize: 14 }} />}
                            </Box>
                            <Typography variant="caption" fontWeight={600} sx={{ color: 'var(--theme-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {effectiveCompany?.name || 'Storefront'}
                            </Typography>
                            <ArrowRightIcon sx={{ fontSize: 14, color: 'var(--theme-text-muted)', flexShrink: 0 }} />
                          </Box>
                        </Link>
                      )}

                      <UserLink
                        pubkey={offer.creatorPubkey}
                        name="View Profile"
                        identityLevel={sellerIdentityLevel as IdentityLevel}
                        showBadge
                        size="small"
                      />
                    </Box>
                  </Box>
                )}
              </Box>
            </Box>

            {/* Details */}
            <Box
              className="section-animate"
              sx={{
                p: { xs: 2.5, sm: 3 },
                borderRadius: 'var(--radius-lg, 12px)',
                background: 'var(--theme-surface)',
                border: '1px solid var(--theme-border)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <LocalOfferIcon sx={{ fontSize: 16, color: 'var(--theme-text-muted)' }} />
                <Typography variant="subtitle2" fontWeight={700} color="text.secondary"
                  sx={{ textTransform: 'uppercase', letterSpacing: 0.75, fontSize: '0.7rem' }}>
                  Details
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                {/* Category Path */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                    <LocalOfferIcon sx={{ fontSize: 17, color: 'text.disabled' }} />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>Category</Typography>
                  <Typography variant="body2" fontWeight={600} sx={{ color: 'var(--theme-text)' }}>
                    {offer.categoryCode ? formatCategoryCode(offer.categoryCode) : offer.category || 'Uncategorized'}
                  </Typography>
                </Box>

                {/* Offer Type */}
                <Divider sx={{ my: 1.25 }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                    {isService
                      ? <WorkIcon sx={{ fontSize: 17, color: 'text.disabled' }} />
                      : <Inventory2Icon sx={{ fontSize: 17, color: 'text.disabled' }} />}
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>Type</Typography>
                  <Chip
                    label={isAgent ? 'Agent' : isItem ? 'Item' : isService ? 'Service' : 'Product'}
                    size="small"
                    sx={{
                      fontWeight: 600, height: 22, fontSize: '0.75rem',
                      borderColor: isService ? 'rgba(99,179,237,0.5)' : 'rgba(72,187,120,0.5)',
                      color: isService ? '#63B3ED' : '#48B978',
                      bgcolor: isService ? 'rgba(99,179,237,0.08)' : 'rgba(72,187,120,0.08)',
                    }}
                  />
                </Box>

                {!isRemoteOffer && (<>
                {/* Seller Type */}
                <Divider sx={{ my: 1.25 }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                    <StorefrontIcon sx={{ fontSize: 17, color: 'text.disabled' }} />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>Seller Type</Typography>
                  <Typography variant="body2" fontWeight={600} sx={{ color: 'var(--theme-text)' }}>
                    {isCorporate ? `Business${effectiveCompany ? ` — ${effectiveCompany.name}` : ''}` : 'Private Seller'}
                  </Typography>
                </Box>
                </>
                )}

                {!isRemoteOffer && (<>
                {/* Payment */}
                <Divider sx={{ my: 1.25 }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                    <BoltIcon sx={{ fontSize: 17, color: 'text.disabled' }} />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>Payment</Typography>
                  <Typography variant="body2" fontWeight={600} sx={{ color: 'var(--theme-text)' }}>
                    {isMilestone ? `Milestone (${milestones.length} phases)` : offer?.useEscrow ? 'Smart Order (Escrow)' : 'Smart Order (direct payment)'}
                  </Typography>
                </Box>
                </>
                )}

                {/* Location */}
                {locationDisplay && (
                  <>
                    <Divider sx={{ my: 1.25 }} />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                        <PlaceIcon sx={{ fontSize: 17, color: 'text.disabled' }} />
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>Location</Typography>
                      <Typography variant="body2" fontWeight={600}>{locationDisplay}</Typography>
                    </Box>
                  </>
                )}

                {/* Delivery Time */}
                {offer.deliveryTimeDays && (
                  <>
                    <Divider sx={{ my: 1.25 }} />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                        <AccessTimeIcon sx={{ fontSize: 17, color: 'text.disabled' }} />
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>Delivery</Typography>
                      <Typography variant="body2" fontWeight={600}>{offer.deliveryTimeDays} {offer.deliveryTimeDays === 1 ? 'Day' : 'Days'}</Typography>
                    </Box>
                  </>
                )}

                {/* Delivery Cost */}
                {offer.deliveryCostSats != null && offer.deliveryCostSats > 0 && (
                  <>
                    <Divider sx={{ my: 1.25 }} />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                        <BoltIcon sx={{ fontSize: 17, color: 'text.disabled' }} />
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>Shipping</Typography>
                      <Typography variant="body2" fontWeight={600}>
                        {formatNumber(offer.deliveryCostSats)} sats{' '}
                        <FiatHint sats={offer.deliveryCostSats} className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }} />
                      </Typography>
                    </Box>
                  </>
                )}

                {/* Published */}
                <Divider sx={{ my: 1.25 }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                    <AccessTimeIcon sx={{ fontSize: 17, color: 'text.disabled' }} />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0 }}>Published</Typography>
                  <Typography variant="body2" fontWeight={600}>{formatDate(offer.createdAt)}</Typography>
                </Box>

                {/* Delivery Notes */}
                {offer.deliveryNotes && (
                  <>
                    <Divider sx={{ my: 1.25 }} />
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                      <Box sx={{ width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0, mt: 0.25 }}>
                        <InfoOutlinedIcon sx={{ fontSize: 17, color: 'text.disabled' }} />
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 72, flexShrink: 0, display: 'block', mb: 0.25 }}>Notes</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>{offer.deliveryNotes}</Typography>
                      </Box>
                    </Box>
                  </>
                )}
              </Box>
            </Box>

            {/* ADR-396 D2 (FU-849): what the buyer is actually booking. */}
            {isAgent && (
              <AgentSetupFacts
                profile={offer.agentProfile}
                capabilities={offer.agentConfigMeta?.capabilities}
                runtime={offer.agentConfigMeta?.runtime}
                billingModel={offer.agentBillingModel}
                estimatedWorkspaceHours={offer.estimatedWorkspaceHours}
                workspaceTTLSeconds={offer.agentWorkspaceTTL}
              />
            )}

            {/* Description */}
            <Box
              className="section-animate"
              sx={{
                p: { xs: 2.5, sm: 3 },
                borderRadius: 'var(--radius-lg, 12px)',
                background: 'var(--theme-surface)',
                border: '1px solid var(--theme-border)',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <InfoOutlinedIcon sx={{ fontSize: 16, color: 'var(--theme-text-muted)' }} />
                <Typography variant="subtitle2" fontWeight={700} color="text.secondary"
                  sx={{ textTransform: 'uppercase', letterSpacing: 0.75, fontSize: '0.7rem' }}>
                  Description
                </Typography>
              </Box>
              {/* ADR-295: sanitized rich text render (legacy plain-text fallback inside) */}
              <Box className="text-[15px]" sx={{
                lineHeight: 1.8, mt: 0.5,
                color: 'var(--theme-text)',
              }}>
                <RichText value={offer.description || 'No description provided.'} />
              </Box>
            </Box>

            {/* ADR-270 D1: Descriptive Attributes (Specs) */}
            {offer.specs && offer.specs.length > 0 && (
              <Box
                className="section-animate"
                sx={{
                  p: { xs: 2.5, sm: 3 },
                  borderRadius: 'var(--radius-lg, 12px)',
                  background: 'var(--theme-surface)',
                  border: '1px solid var(--theme-border)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <LocalOfferIcon sx={{ fontSize: 16, color: 'var(--theme-text-muted)' }} />
                  <Typography variant="subtitle2" fontWeight={700} color="text.secondary"
                    sx={{ textTransform: 'uppercase', letterSpacing: 0.75, fontSize: '0.7rem' }}>
                    Specifications & Attributes
                  </Typography>
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                  {offer.specs.map((spec, idx) => (
                    <Box
                      key={idx}
                      sx={{
                        p: 1.5,
                        borderRadius: 'var(--radius-md, 8px)',
                        bgcolor: 'var(--theme-bg-subtle)',
                        border: '1px solid var(--theme-border)',
                      }}
                    >
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
                        {spec.key}
                      </Typography>
                      <Typography variant="body2" fontWeight={600} sx={{ color: 'var(--theme-text)' }}>
                        {spec.value}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}

            {/* Milestones (Service / MILESTONE) */}
            {isMilestone && milestones.length > 0 && (
              <Box
                className="section-animate"
                sx={{
                  p: { xs: 2.5, sm: 3 },
                  borderRadius: 'var(--radius-lg, 12px)',
                  background: 'var(--theme-surface)',
                  border: '1px solid var(--theme-border)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Flag size={16} style={{ color: 'var(--color-primary-50)', flexShrink: 0 }} />
                  <Typography variant="subtitle2" fontWeight={700} color="text.secondary"
                    sx={{ textTransform: 'uppercase', letterSpacing: 0.75, fontSize: '0.7rem' }}>
                    Milestones
                  </Typography>
                  <Chip label={`${milestones.length} phases`} size="small"
                    sx={{ fontSize: '0.6rem', height: 18, fontWeight: 700, background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.15)', color: 'var(--color-primary-50)' }} />
                </Box>

                <Typography variant="body2" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.7, mb: 2.5 }}>
                  This project is split into {milestones.length} milestone{milestones.length > 1 ? 's' : ''}.
                  Payment is distributed per phase — each milestone is released individually after the buyer confirms completion.
                  This reduces risk for both parties and ensures transparent progress tracking.
                </Typography>

                {/* Progress summary bar */}
                <Box sx={{
                  display: 'flex', gap: 1, mb: 2.5,
                  p: 1.5, borderRadius: 'var(--radius-md, 8px)',
                  background: 'var(--theme-bg-elevated)',
                  border: '1px solid var(--theme-border)',
                }}>
                  {milestones.map((m, i) => {
                    const amtSats = Math.round(offer.priceSats * m.percentage / 100)
                    return (
                      <Tooltip key={m.id} title={`#${i + 1} ${m.title}: ${formatNumber(amtSats)} sats`} arrow>
                        <Box sx={{
                          flex: m.percentage / 100,
                          height: 8,
                          borderRadius: '4px',
                          background: 'rgba(99,179,237,0.25)',
                          border: '1px solid rgba(99,179,237,0.15)',
                          cursor: 'default',
                          position: 'relative',
                          overflow: 'hidden',
                        }}>
                          <Box sx={{
                            position: 'absolute', inset: 0,
                            borderRadius: '4px',
                            background: `linear-gradient(135deg, rgba(99,179,237,0.4) 0%, rgba(99,179,237,0.6) 100%)`,
                          }} />
                        </Box>
                      </Tooltip>
                    )
                  })}
                </Box>

                {/* Milestone Steps */}
                {milestones.map((m, i) => (
                  <MilestoneStep
                    key={m.id}
                    index={i}
                    title={m.title}
                    description={m.description}
                    percentage={m.percentage}
                    amountSats={Math.round(offer.priceSats * m.percentage / 100)}
                    isLast={i === milestones.length - 1}
                  />
                ))}

                <Box sx={{
                  mt: 2, pt: 2,
                  borderTop: '1px solid var(--theme-border)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <Typography variant="caption" fontWeight={600} color="text.secondary">
                    Total project value
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                    <BoltIcon sx={{ fontSize: 14, color: 'var(--color-primary-50)', alignSelf: 'center' }} />
                    <Typography variant="body2" fontWeight={800} sx={{ color: 'var(--color-primary-50)', fontVariantNumeric: 'tabular-nums' }}>
                      {formatNumber(offer.priceSats)} sats
                    </Typography>
                    <FiatHint sats={offer.priceSats} className="text-[12px]" style={{ color: 'var(--theme-text-muted)' }} />
                  </Box>
                </Box>
              </Box>
            )}

            {/* Chat (seller: visitor list / buyer: chat with seller) */}
            {!isMobile && !isRemoteOffer && (
              loginPubkey === offer.creatorPubkey ? (
                <Box className="section-animate">
                  <VisitorChat
                    offerId={offer.id}
                    sellerPubkey={offer.creatorPubkey}
                    onVisitorNotification={(visitor) => {
                      showSnackbarWithUndo({ message: `New message from visitor ${visitor.pubkey.slice(0, 8)}...`, severity: 'info' })
                    }}
                  />
                </Box>
              ) : (
                <Box className="section-animate">
                  <BuyerChatWidget offerId={offer.id} sellerPubkey={offer.creatorPubkey} />
                </Box>
              )
            )}

          </Box>
        </Grid>

        {/* ── Right Column: Sticky CTA Panel ────────────────────────────────── */}
        <Grid size={{ xs: 12, lg: 4 }}>
          <Box
            ref={sidebarRef}
            className="section-animate"
            sx={{
              bgcolor: 'var(--theme-surface)',
              border: '1px solid var(--theme-border)',
              borderRadius: 'var(--radius-lg, 12px)',
              position: { lg: 'sticky' },
              top: { lg: 24 },
              overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)',
            }}
          >
            {/* Price hero */}
            <OfferPriceHero
              offerId={offer.id}
              remote={isRemoteOffer}
              sats={activePriceSats}
              label={offer.priceUnit === 'per_hour'
                ? 'Per hour'
                : offer.priceUnit === 'per_night'
                  ? 'Per night'
                  : offer.priceUnit === 'per_day'
                    ? 'Per day'
                    : offer.priceUnit === 'per_seat'
                      ? 'Per seat'
                      : 'Price'}
              fromPrefix={isVariable && !selectedChildOffer && hasPriceRange}
              foreignPrice={offer.priceCurrency ? { amount: offer.priceAmount ?? '?', currency: offer.priceCurrency } : null}
              estimateLabel={remoteEstimate ? formatEstimateLabel(remoteEstimate, formatNumber) : null}
              priceOnRequest={offer.source === 'REMOTE' && !offer.priceCurrency && !(offer.priceSats > 0)}
            />

            <Box sx={{ p: { xs: 2.5, sm: 3 } }}>

              {/* ADR-270 D5: Variant axis selection */}
              {isVariable && offer.variantAxes && offer.variantAxes.length > 0 && (
                <Box sx={{ mb: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {offer.variantAxes.map((axis) => (
                    <Box key={axis.name}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
                        <Typography variant="caption" fontWeight={700} sx={{ textTransform: 'uppercase', color: 'var(--theme-text-secondary)', fontSize: '0.7rem' }}>
                          {axis.name}
                        </Typography>
                        {selectedAxes[axis.name] && (
                          <Typography variant="caption" fontWeight={600} sx={{ color: 'var(--color-primary-50)' }}>
                            {selectedAxes[axis.name]}
                          </Typography>
                        )}
                      </Box>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        {axis.values.map((val) => {
                          const isSelected = selectedAxes[axis.name] === val
                          const isPossible = isCombinationPossible(axis.name, val)
                          return (
                            <Chip
                              key={val}
                              label={val}
                              onClick={() => isPossible && handleSelectAxisValue(axis.name, val)}
                              disabled={!isPossible}
                              variant={isSelected ? 'filled' : 'outlined'}
                              color={isSelected ? 'primary' : 'default'}
                              sx={{
                                fontWeight: isSelected ? 700 : 500,
                                cursor: isPossible ? 'pointer' : 'not-allowed',
                                opacity: !isPossible ? 0.35 : 1,
                                borderRadius: 'var(--radius-sm, 6px)',
                              }}
                            />
                          )
                        })}
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}

              {/* Escrow / Milestone info */}
              <Box sx={{ mb: 2.5 }}>
                {!isRemoteOffer && (
                isMilestone ? (
                  <Box sx={{
                    p: 2, borderRadius: 'var(--radius-md, 8px)',
                    background: 'rgba(99,179,237,0.06)',
                    border: '1px solid rgba(99,179,237,0.15)',
                  }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Flag size={16} style={{ color: 'var(--color-primary-50)', flexShrink: 0 }} />
                      <Typography variant="caption" fontWeight={700} sx={{ color: 'var(--color-primary-50)' }}>
                        Milestone Project
                      </Typography>
                    </Box>
                    <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.7 }}>
                      Payment split into {milestones.length} phases. Each milestone is paid individually upon buyer confirmation.
                    </Typography>
                  </Box>
                ) : offer?.useEscrow ? (
                  <Tooltip title="Smart Order: Funds are held in escrow and released in three phases" arrow>
                    <Box sx={{
                      borderRadius: 'var(--radius-md, 8px)',
                      border: '1px solid var(--theme-border)',
                      overflow: 'hidden',
                      background: 'var(--theme-bg-elevated)',
                    }}>
                      {([
                        { label: 'Start', pct: 25, icon: <BoltIcon sx={{ fontSize: 12, color: 'var(--color-primary-50)' }} /> },
                        { label: 'Progress', pct: 50, icon: <TrendingUp size={12} style={{ color: 'var(--color-primary-50)' }} /> },
                        { label: 'Completion', pct: 25, icon: <CheckCircleIcon sx={{ fontSize: 12 }} /> },
                      ]).map((p, i, arr) => (
                        <Box key={p.label} sx={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          px: 1.5, py: 1,
                          borderBottom: i < arr.length - 1 ? '1px solid' : 'none',
                          borderColor: 'var(--theme-border)',
                        }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <Box sx={{ color: 'var(--color-primary-50)', display: 'flex', alignItems: 'center' }}>{p.icon}</Box>
                            <Typography variant="caption" color="text.secondary" fontWeight={500}>{p.label}</Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                            <Typography variant="caption" fontWeight={700} sx={{ color: 'var(--color-primary-50)', fontVariantNumeric: 'tabular-nums' }}>
                              {formatNumber(Math.round(activePriceSats * p.pct / 100))} sats
                            </Typography>
                            <FiatHint sats={Math.round(activePriceSats * p.pct / 100)} className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }} />
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  </Tooltip>
                ) : (
                  <Box sx={{ p: 2, borderRadius: 'var(--radius-md, 8px)', background: 'var(--theme-bg-elevated)', border: '1px solid var(--theme-border)' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <BoltIcon sx={{ fontSize: 16, color: 'var(--color-primary-50)' }} />
                      <Typography variant="caption" fontWeight={700} sx={{ color: 'var(--theme-text)' }}>
                        Direct payment
                      </Typography>
                    </Box>
                    <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.7 }}>
                      You pay the seller directly over Lightning when you order. Colabonate never holds the funds.
                    </Typography>
                  </Box>
                )
                )}

                {/* Stock info for Products/Items */}
                {!isService && !isRemoteOffer && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1.5 }}>
                    <Inventory2Icon sx={{
                      fontSize: 14,
                      color: activeStock != null && activeStock <= 0 ? 'error.main' : 'success.main',
                    }} />
                    <Typography variant="body2" sx={{
                      fontSize: 12,
                      color: activeStock != null && activeStock <= 0 ? 'error.main' : 'success.main',
                      fontWeight: 600,
                    }}>
                      {activeStock != null
                        ? (activeStock > 0 ? `${activeStock} in stock` : 'Out of stock')
                        : 'Available'}
                    </Typography>
                  </Box>
                )}
              </Box>

              {/* Offer type info */}
              {!isRemoteOffer && (
              <Box sx={{
                mb: 2.5,
                p: 2,
                borderRadius: 'var(--radius-md, 8px)',
                background: isAgent
                  ? 'rgba(159,122,234,0.06)'
                  : isService ? 'rgba(255,183,77,0.06)' : 'rgba(72,187,120,0.06)',
                border: `1px solid ${isAgent ? 'rgba(159,122,234,0.15)' : isService ? 'rgba(255,183,77,0.15)' : 'rgba(72,187,120,0.15)'}`,
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                  {isAgent
                    ? <Bot size={16} style={{ color: '#9F7AEA' }} />
                    : isService
                      ? <InfoOutlinedIcon sx={{ fontSize: 16, color: '#FFB74D' }} />
                      : <CheckCircleIcon sx={{ fontSize: 16, color: '#48B978' }} />}
                  <Typography variant="caption" fontWeight={700}
                    sx={{ color: isAgent ? '#9F7AEA' : isService ? '#FFB74D' : '#48B978' }}>
                    {isAgent
                      ? (offerCanvas && offerCanvas.provider !== 'none'
                        ? 'Agent — AI work on a live collaboration canvas'
                        : 'Agent — AI work in a private workspace')
                      : isService
                        ? 'Service — Seller confirmation required'
                        : isItem
                          ? 'Item — Single article, auto-accept'
                          : 'Product — Instantly available'}
                  </Typography>
                </Box>
                <Typography variant="caption" sx={{ color: 'var(--theme-text-muted)', lineHeight: 1.6 }}>
                  {isAgent
                    ? offerCanvas && offerCanvas.provider !== 'none'
                      ? offerCanvas.provider === 'doop-hosted'
                        ? offerCanvas.agentInCanvas
                          ? 'After purchase the agent works on a shared canvas you can open and steer from the ticket. Buyer collaboration and agent presence included.'
                          : 'After purchase a shared collaboration canvas opens from your ticket — you work there alongside the agent setup.'
                        : "A shared canvas on the seller's own doop instance opens from your ticket after purchase (you need an account on that instance)."
                      : 'After purchase the agent works in a private workspace you can direct from the ticket.'
                    : isService
                      ? 'The seller must confirm your request before the payment is initiated.'
                      : isItem
                        ? 'Single article available — payment starts immediately after purchase.'
                        : 'Unlimited availability — payment starts immediately after purchase.'}
                </Typography>
              </Box>
              )}

              {/* Primary CTA — bookable offers (ADR-271) get the booking
                  request widget instead of the cart: a booking is a request →
                  countersignature → payment flow, never an instant cart item. */}
              {offer.source === 'REMOTE' ? (
                <RemoteOfferPanel offer={offer} rates={rates} formatNumber={formatNumber} />
              ) : offer.bookingMode && offer.resourceId ? (
                <BookingRequestWidget offer={offer} />
              ) : (
              <Tooltip
                title={
                  offer.priceCurrency
                    ? `Priced in ${offer.priceCurrency.toUpperCase()}, not sats — not yet purchasable on Colabonate`
                    : isVariable && !selectedChildOffer
                      ? 'Please select all variant options'
                      : isInCart(targetOfferId)
                        ? 'Already in your basket'
                        : 'Add to basket'
                }
                arrow
              >
                <span>
                  <Button
                    fullWidth
                    variant="contained"
                    size="large"
                    disabled={Boolean(offer.priceCurrency) || isInCart(targetOfferId) || (isVariable && !selectedChildOffer) || (activeStock != null && activeStock <= 0)}
                    startIcon={isInCart(targetOfferId) ? <CheckIcon sx={{ fontSize: 16 }} /> : <ShoppingCartIcon sx={{ fontSize: 16 }} />}
                    onClick={() => {
                      addItem({
                        offerId: targetOfferId,
                        title: targetTitle,
                        priceSats: activePriceSats,
                        offerType: offer.offerType ?? 'PRODUCT',
                        category: offer.category,
                        image: activeImages?.[0],
                        company: offer.company ?? null,
                        sellerPubkey: offer.creatorPubkey,
                        source: offer.source,
                        stock: activeStock,
                        // ADR-394 FU-842: shipping is part of the charged total
                        // (physical goods only) — the cart shows it in the sum.
                        deliveryCostSats: offer.physicalType === 'digital' ? undefined : offer.deliveryCostSats ?? undefined,
                        deliveryTimeDays: offer.deliveryTimeDays ?? undefined,
                        // ADR-183 Phase 2: forward offer.allowedVisibility so
                        // BuyCartFlow can render a per-item tier selector.
                        allowedVisibility: Array.isArray(offer.allowedVisibility) ? offer.allowedVisibility : null,
                        variantLabel: targetVariantLabel,
                        variantValues: selectedChildOffer?.variantValues,
                        // ADR-370 D6 (Phase 2): canvas declaration into the cart
                        // for the review-step disclosure (G1). Shared helper —
                        // identical derivation to makeBasketItem (ADR-237).
                        ...canvasCartFields(offer),
                      })
                    }}
                    sx={{
                      mb: 2.5, py: 1.5,
                      fontSize: '1rem', fontWeight: 700,
                      transition: 'filter 150ms, transform 150ms',
                      '&:hover': !isInCart(targetOfferId) ? { filter: 'brightness(1.08)', transform: 'translateY(-1px)' } : {},
                      '&:active': !isInCart(targetOfferId) ? { transform: 'translateY(0)' } : {},
                      '&.Mui-disabled': {
                        background: isInCart(targetOfferId) ? 'var(--color-status-success)' : undefined,
                        color: isInCart(targetOfferId) ? 'white' : undefined,
                        opacity: isInCart(targetOfferId) ? 1 : 0.6,
                      },
                    }}
                  >
                    {offer.priceCurrency
                      ? 'Not Purchasable Yet'
                      : isInCart(targetOfferId)
                        ? 'In Cart'
                        : isVariable && !selectedChildOffer
                          ? 'Select Options'
                          : activeStock != null && activeStock <= 0
                            ? 'Out of Stock'
                            : 'Add to Cart'}
                  </Button>
                </span>
              </Tooltip>
              )}

              <Divider sx={{ mb: 2 }} />

              {/* Trust Badges */}
              {!isRemoteOffer && (
              <>
              <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" gutterBottom
                sx={{ textTransform: 'uppercase', letterSpacing: 0.75, fontSize: '0.65rem' }}>
                Secure Transaction
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                <TrustBadge
                  icon={<LockIcon sx={{ fontSize: 16 }} />}
                  text="Lightning Payment"
                  tooltip="Pay instantly via Bitcoin Lightning Network"
                />
                {offer?.useEscrow && (
                  <TrustBadge
                    icon={<ShieldIcon sx={{ fontSize: 16 }} />}
                    text="Escrow Protected"
                    tooltip="Funds are held securely until both parties confirm"
                  />
                )}
                {/* ESCROW-COPY: a refund guarantee only exists with escrow — on
                    Direct-Pay a dispute ruling cannot move funds already paid. */}
                {offer?.useEscrow && (
                  <TrustBadge
                    icon={<VerifiedUserIcon sx={{ fontSize: 16 }} />}
                    text="Buyer Protection Included"
                    tooltip="Full refund protection for verified disputes"
                  />
                )}
              </Box>
              </>
              )}

            </Box>
          </Box>
        </Grid>

        {/* Chat at last position on mobile (after the price section) */}
        {isMobile && !isRemoteOffer && (
          <Grid size={{ xs: 12 }}>
            {loginPubkey === offer.creatorPubkey ? (
              <Box className="section-animate">
                <VisitorChat
                  offerId={offer.id}
                  sellerPubkey={offer.creatorPubkey}
                  onVisitorNotification={(visitor) => {
                    showSnackbarWithUndo({ message: `New message from visitor ${visitor.pubkey.slice(0, 8)}...`, severity: 'info' })
                  }}
                />
              </Box>
            ) : (
              <Box className="section-animate">
                <BuyerChatWidget offerId={offer.id} sellerPubkey={offer.creatorPubkey} />
              </Box>
            )}
          </Grid>
        )}

      </Grid>
      </div>

      {/* ADR-188: sibling browsing as the last full-width section below the
          entire detail content — sibling offers from the same vendor + the
          full marketplace list (Vendor ↔ Marketplace segments), with the
          currently-viewed offer visually marked in whichever segment is active. */}
      <Box sx={{ mt: { xs: 3, md: 4 } }}>
        <DetailSliderNav
          activeId={offer.id}
          vendorItems={vendorItems}
          allItems={allItems}
          contextFilters={contextFilters}
          loading={vendorOffersLoading}
          entityType="offer"
          hideWhenSingular
          activeSegment={sliderSegment}
          onSegmentChange={setSliderSegment}
          toDetailRoute={toProductDetailRoute}
          // loading: intentionally only vendorOffersLoading — allOffers from useAllOffers()
          // has a 5min staleTime (usually warm); if cold, the segment self-corrects when
          // filteredAllItems updates after the fetch completes.
        />
      </Box>

      <SwipeHint
        storageKey="offer-detail"
        demoRef={swipeRef}
        hasSiblings={hasSiblings}
      />

      <CartFAB />
    </PageContainer>
  )
}
