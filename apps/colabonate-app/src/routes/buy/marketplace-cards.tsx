import { useRef, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { gsap } from 'gsap'
import {
  ShoppingBag, Package, Briefcase, Bot, Star, Minus, Maximize2,
  ChevronRight, Zap, Heart, Frame,
} from 'lucide-react'
import { CARD_THEME, AgentCardBackground, AgentCenterBadge } from '@ds/ui'
import { useTheme, getOfferTypeLabel, formatCompactDate } from '@ds/utils'
import { resolvePurchasePath } from '@col/nostr-schema'
import { useTranslation } from '../../contexts/LocaleContext'
import { FiatHint } from '../../components/currency/FiatHint'
import { RemotePriceLabel, usesNonSatsPriceLabel } from '../../components/offers/RemotePriceLabel'
import { PurchasePathBadge } from '../../components/offers/PurchasePathBadge'
import { HOSTED_CANVAS_FEE_SATS } from '../../lib/agentConfig'
import { usePrefetchHandlers } from '../../hooks/useEntityQueries'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import type { Offer } from '../../types/api'

// Subtle colabonate-red radial glow anchored to the bottom-right of every card
// on hover. Same hue as the slider-list "add to basket" pulse, but ~70% as
// intense and stays put while hovered (no GSAP required). Pure CSS â€” `opacity-0`
// by default, fades in via `group-hover/card` over 500ms.
const HOVER_GLOW_BG = 'radial-gradient(circle at 85% 90%, rgba(232,69,65,0.22) 0%, rgba(232,69,65,0.07) 40%, transparent 70%)'

// Cards have no FX rate map; foreign-currency listings show their own price, not an estimate.
const NO_RATES: Record<string, { price: number }> = {}

// ADR-370 D6 (Phase 2, FU-671): buyer-side disclosure of the offer's
// collaboration-canvas declaration (G1). Renders one or two small chips when
// the AGENT_SETUP offer declares a canvas — no canvas → nothing.
function CanvasDisclosureChips({ offer, fontPx }: { offer: Offer; fontPx: number }) {
  const canvas = offer.agentConfigMeta?.canvas
  if (!canvas || !canvas.provider || canvas.provider === 'none') return null
  const chipStyle: React.CSSProperties = {
    fontSize: fontPx,
    background: 'var(--theme-bg-subtle)',
    color: 'var(--theme-text-muted)',
    border: '1px solid var(--theme-border)',
  }
  return (
    <div className="flex flex-wrap gap-1">
      {canvas.provider === 'doop-hosted' && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm leading-none truncate" style={chipStyle} title="Colabonate-hosted collaboration canvas — opened from the ticket">
          <Frame size={fontPx + 1} style={{ opacity: 0.7 }} />
          Canvas
        </span>
      )}
      {/* ADR-372 D2: pre-purchase fee disclosure — the buyer pays a separate
          Colabonate service fee on hosted-canvas setups (never a seller
          deduction). */}
      {canvas.provider === 'doop-hosted' && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm leading-none truncate" style={{ ...chipStyle, color: 'var(--color-primary-50)' }} title={`Colabonate service fee ${HOSTED_CANVAS_FEE_SATS} sats, paid at purchase`}>
          <Zap size={fontPx + 1} style={{ opacity: 0.7 }} />
          Fee {HOSTED_CANVAS_FEE_SATS} sats
        </span>
      )}
      {canvas.provider === 'doop-local' && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm leading-none truncate max-w-24" style={chipStyle} title="Collaboration canvas on the seller's own doop instance">
          <Frame size={fontPx + 1} style={{ opacity: 0.7 }} />
          Canvas
        </span>
      )}
      {canvas.provider === 'doop-hosted' && canvas.agentInCanvas && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm leading-none truncate max-w-24" style={{ ...chipStyle, color: 'var(--color-primary-50)' }} title="The agent works live on the canvas after purchase">
          <Bot size={fontPx + 1} style={{ opacity: 0.7 }} />
          Agent works on canvas
        </span>
      )}
    </div>
  )
}

// ── Types ────────────────────────────────────────────────────────────

export type CardSize = 'S' | 'M' | 'L'

// ── Hover-intent prefetch ────────────────────────────────────────────

// usePrefetchHandlers now lives in useEntityQueries.ts (headless-first).

// ── Image With Fallback ───────────────────────────────────────────────

function ImageWithFallback({
  src,
  alt,
  className,
  fallback,
}: {
  src: string
  alt: string
  className: string
  fallback: React.ReactNode
}) {
  const [failed, setFailed] = useState(false)

  if (failed) return <>{fallback}</>

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

// ── Card Size Config ─────────────────────────────────────────────────

export const CARD_SIZE_CONFIG: Record<CardSize, {
  gallery: { imgH: number; titleFs: number; priceFs: number; catFs: number; px: number; py: number; gap: number; badgePx: number; badgePy: number }
  list: { rowH: number; thumbW: number; titleFs: number; priceFs: number; catFs: number; px: number; py: number; gap: number; badgePx: number; badgePy: number }
}> = {
  S: {
    gallery: { imgH: 100, titleFs: 12, priceFs: 11, catFs: 8, px: 10, py: 10, gap: 2, badgePx: 8, badgePy: 4 },
    list:    { rowH: 80, thumbW: 80, titleFs: 13, priceFs: 11, catFs: 10, px: 10, py: 8, gap: 8, badgePx: 6, badgePy: 3 },
  },
  M: {
    gallery: { imgH: 140, titleFs: 15, priceFs: 12, catFs: 9, px: 14, py: 14, gap: 3, badgePx: 10, badgePy: 5 },
    list:    { rowH: 100, thumbW: 100, titleFs: 15, priceFs: 13, catFs: 12, px: 16, py: 12, gap: 12, badgePx: 8, badgePy: 4 },
  },
  L: {
    gallery: { imgH: 180, titleFs: 17, priceFs: 14, catFs: 10, px: 18, py: 18, gap: 4, badgePx: 12, badgePy: 6 },
    list:    { rowH: 120, thumbW: 120, titleFs: 17, priceFs: 15, catFs: 13, px: 20, py: 16, gap: 16, badgePx: 10, badgePy: 5 },
  },
}

// ── Mobile Card Size Config (compact 2-column layout) ────────────────

export const MOBILE_LIST_SIZE_CONFIG: Record<CardSize, {
  rowH: number
  thumbW: number
  titleFs: number
  priceFs: number
  catFs: number
  metaFs: number
  px: number
  py: number
  gap: number
  badgePx: number
  badgePy: number
}> = {
  S: { rowH: 56, thumbW: 52, titleFs: 12, priceFs: 10, catFs: 9,  metaFs: 9,  px: 8,  py: 6,  gap: 6,  badgePx: 6,  badgePy: 2 },
  M: { rowH: 68, thumbW: 64, titleFs: 13, priceFs: 11, catFs: 10, metaFs: 10, px: 10, py: 8,  gap: 8,  badgePx: 7,  badgePy: 3 },
  L: { rowH: 80, thumbW: 76, titleFs: 14, priceFs: 12, catFs: 11, metaFs: 11, px: 12, py: 10, gap: 10, badgePx: 8,  badgePy: 3 },
}

// ── Offer Gallery Card (with size support) ───────────────────────────

export function OfferGalleryCard({
  offer,
  size = 'M',
  onAddToBasket,
  isFavorite,
  onFavoriteToggle,
}: {
  offer: Offer
  size: CardSize
  onAddToBasket?: () => void
  isFavorite?: boolean
  onFavoriteToggle?: () => void
}) {
  const { formatNumber } = useTranslation()
  const { theme } = useTheme()
  const isService = offer.offerType === 'SERVICE'
  const isAgent = offer.offerType === 'AGENT_SETUP'
  const hasImage = offer.images && offer.images.length > 0
  const cfg = CARD_SIZE_CONFIG[size].gallery
  // ADR-385: compact creation date on the browse cards (grid + list).
  const createdLabel = formatCompactDate(offer.createdAt)
  const cardRef = useRef<HTMLAnchorElement>(null)
  const pulseRef = useRef<HTMLDivElement>(null)
  const floatingRef = useRef<HTMLSpanElement>(null)
  const prefersReducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const isRemote = offer.source === 'REMOTE'
  const nonSatsPrice = usesNonSatsPriceLabel(offer)
  const prefetchHandlers = usePrefetchHandlers(offer.id, offer.creatorPubkey)

  function handleAddToBasket(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    onAddToBasket?.()
    const card = cardRef.current
    const pulse = pulseRef.current
    const floating = floatingRef.current
    if (!card) return

    const dur = prefersReducedMotion ? 0 : 0.6
    const tl = gsap.timeline()

    tl.to(card, {
      scale: 1.04,
      boxShadow: '0 8px 30px rgba(72,187,120,0.35), 0 2px 8px rgba(0,0,0,0.10)',
      borderColor: 'rgba(72,187,120,0.50)',
      duration: dur * 0.3,
      ease: 'power2.out',
    })
    if (pulse) {
      tl.fromTo(pulse,
        { opacity: 0.6, scale: 0.95 },
        { opacity: 0, scale: 1.15, duration: dur * 0.5, ease: 'power2.out' },
        '<',
      )
    }
    tl.to(card, {
      scale: 1,
      boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)',
      borderColor: 'var(--theme-border)',
      duration: dur * 0.4,
      ease: 'power2.inOut',
    }, dur * 0.35)

    if (floating) {
      tl.fromTo(floating,
        { opacity: 1, y: 0, scale: 0.8 },
        {
          opacity: 0, y: -40, scale: 1.2,
          duration: dur * 0.6,
          ease: 'power2.out',
        },
        dur * 0.1,
      )
    }
  }

  return (
    <div className="relative h-full" style={{ overflow: 'visible' }}>
    <Link
      ref={cardRef}
      to={`/buy/product/${offer.id}`}
      {...prefetchHandlers}
      className="group/card flex flex-col no-underline cursor-pointer rounded-xl overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all duration-300 ease-out hover:z-10 hover:-translate-y-1 hover:shadow-[0_12px_32px_rgba(0,0,0,0.18)] active:scale-[0.99] h-full relative"
      style={{
        background: CARD_THEME.bg(theme),
        border: '1px solid var(--theme-border)',
      }}
    >
      {/* Static sheen overlay — matches SliderList cards */}
      <div
        className="absolute inset-0 pointer-events-none rounded-xl"
        style={{ background: CARD_THEME.overlay(theme) }}
      />
      {/* Hover glow — subtle colabonate-red radial from bottom-right */}
      <div
        className="absolute inset-0 pointer-events-none rounded-xl opacity-0 transition-opacity duration-500 ease-out group-hover/card:opacity-100"
        style={{ background: HOVER_GLOW_BG }}
      />
      {isAgent && <AgentCardBackground />}
      {isAgent && <AgentCenterBadge position="card" />}
      <div
        ref={pulseRef}
        className="absolute inset-0 pointer-events-none rounded-xl"
        style={{
          background: 'radial-gradient(circle, rgba(72,187,120,0.25) 0%, rgba(72,187,120,0.08) 60%, transparent 100%)',
          opacity: 0,
          zIndex: 5,
        }}
      />

      <div
        className="relative flex items-center justify-center"
        style={{ height: cfg.imgH, background: 'var(--theme-bg-subtle)' }}
      >
        {hasImage
          ? <ImageWithFallback
              src={offer.images![0]}
              alt={offer.title}
              className="object-cover w-full h-full"
              fallback={
                <span style={{ fontSize: cfg.imgH * 0.3, fontWeight: 700, color: 'var(--theme-text-muted)', lineHeight: 1 }}>
                  {offer.title.charAt(0).toUpperCase()}
                </span>
              }
            />
          : (
            <span style={{ fontSize: cfg.imgH * 0.3, fontWeight: 700, color: 'var(--theme-text-muted)', lineHeight: 1 }}>
              {offer.title.charAt(0).toUpperCase()}
            </span>
          )}

        {onFavoriteToggle && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onFavoriteToggle() }}
            aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded-full transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer"
            style={{
              background: isFavorite ? '#E84541' : 'rgba(0,0,0,0.30)',
              backdropFilter: 'blur(4px)',
              boxShadow: isFavorite ? '0 2px 8px rgba(232,69,65,0.5)' : 'none',
            }}
          >
            <Heart size={12} className={isFavorite ? 'fill-white text-white' : 'text-white'} />
          </button>
        )}
      </div>

      <div
        className="flex flex-col flex-1"
        style={{ padding: `${cfg.py}px ${cfg.px}px` }}
      >
        <div
          className="mb-1"
          style={{
            fontSize: cfg.catFs,
            fontWeight: 600,
            color: 'var(--theme-text-muted)',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap' as const,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {isAgent ? <Bot size={cfg.catFs + 1} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4, opacity: 0.7 }} /> : isService ? <Briefcase size={cfg.catFs + 1} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4, opacity: 0.7 }} /> : <Package size={cfg.catFs + 1} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4, opacity: 0.7 }} />}
          {isAgent ? getOfferTypeLabel(offer.offerType) : (offer.categoryCode || getOfferTypeLabel(offer.offerType)).replace(/\//g, ' - ')}
          {isAgent && offer.agentProfile?.reputationScore != null && (
            <span className="ml-2 inline-flex items-center gap-0.5" style={{ color: 'var(--color-warning-primary)' }}>
              <Star size={cfg.catFs} style={{ fill: 'currentColor' }} />
              {offer.agentProfile.reputationScore.toFixed(1)}
            </span>
          )}
        </div>
        <div
          className="mb-2"
          style={{
            fontSize: cfg.titleFs,
            lineHeight: 1.45,
            color: 'var(--theme-text)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {offer.title}
        </div>
        {createdLabel && (
          <div className="mb-1" style={{ fontSize: cfg.catFs, color: 'var(--theme-text-muted)' }}>
            Created {createdLabel}
          </div>
        )}
        {isAgent && offer.agentProfile && offer.agentProfile.capabilities.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {offer.agentProfile.capabilities.slice(0, 3).map(cap => (
              <span
                key={cap}
                className="inline-flex items-center px-1.5 py-0.5 rounded-sm leading-none truncate max-w-24"
                style={{ fontSize: cfg.catFs, background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-muted)', border: '1px solid var(--theme-border)' }}
              >
                {cap}
              </span>
            ))}
          </div>
        )}
        {/* ADR-370 D6 (Phase 2): pre-purchase canvas disclosure (G1). */}
        {isAgent && offer.agentConfigMeta?.canvas && offer.agentConfigMeta.canvas.provider !== 'none' && (
          <div className="mb-2">
            <CanvasDisclosureChips offer={offer} fontPx={cfg.catFs} />
          </div>
        )}
        <div className="flex items-center justify-between gap-1 mt-auto">
          <div
            className="flex items-center gap-1"
            style={{
              fontSize: cfg.priceFs + 3,
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--color-primary-50)',
              whiteSpace: 'nowrap',
            }}
          >
            {nonSatsPrice ? (
              <RemotePriceLabel offer={offer} rates={NO_RATES} formatNumber={formatNumber} showEstimate={false} />
            ) : (
              <>
                <Zap size={cfg.priceFs + 3} />
                {formatNumber(offer.priceSats)}
                <FiatHint sats={offer.priceSats} className="text-[0.9em] ml-[3px]" />
              </>
            )}
          </div>

          {!isRemote && (
          <div className="relative shrink-0">
            <button
              onClick={handleAddToBasket}
              className="flex items-center justify-center transition-colors duration-150 rounded-lg cursor-pointer"
              style={{
                width: 32, height: 32,
                background: 'var(--theme-bg-subtle)',
                border: '1px solid var(--theme-border)',
                color: 'var(--color-status-success)',
              }}
              aria-label="Add to basket"
            >
              <ShoppingBag size={15} strokeWidth={2.5} />
            </button>
            <span
              ref={floatingRef}
              className="absolute pointer-events-none"
              style={{
                top: -4, right: -4,
                fontSize: 13, fontWeight: 800,
                color: 'var(--color-status-success)',
                opacity: 0,
                zIndex: 10,
              }}
            >
              +1
            </span>
          </div>
          )}
        </div>
        {isRemote && (
          <div className="mt-2">
            <PurchasePathBadge path={resolvePurchasePath(offer).path} compact label="Remote listing" title="Open the listing to see how to order." />
          </div>
        )}
      </div>
    </Link>
    </div>
  )
}

// ── Offer List Row (with size support) ───────────────────────────────

export function OfferListRow({
  offer,
  size = 'M',
  onAddToBasket,
  isFavorite,
  onFavoriteToggle,
}: {
  offer: Offer
  size: CardSize
  onAddToBasket?: () => void
  isFavorite?: boolean
  onFavoriteToggle?: () => void
}) {
  const { formatNumber } = useTranslation()
  const { isMobile, isDesktop } = useBreakpoint()
  const { theme } = useTheme()
  const isService = offer.offerType === 'SERVICE'
  const isAgent = offer.offerType === 'AGENT_SETUP'
  const hasImage = offer.images && offer.images.length > 0
  const cfg = isMobile ? MOBILE_LIST_SIZE_CONFIG[size] : CARD_SIZE_CONFIG[size].list
  // ADR-385: compact creation date on the browse cards (grid + list).
  const createdLabel = formatCompactDate(offer.createdAt)
  const cardRef = useRef<HTMLAnchorElement>(null)
  const pulseRef = useRef<HTMLDivElement>(null)
  const floatingRef = useRef<HTMLSpanElement>(null)
  const prefersReducedMotion = useReducedMotion()
  const isRemote = offer.source === 'REMOTE'
  const nonSatsPrice = usesNonSatsPriceLabel(offer)
  const prefetchHandlers = usePrefetchHandlers(offer.id, offer.creatorPubkey)

  function handleAddToBasket(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    onAddToBasket?.()
    const card = cardRef.current
    const pulse = pulseRef.current
    const floating = floatingRef.current
    if (!card) return

    const dur = prefersReducedMotion ? 0 : 0.6
    const tl = gsap.timeline()

    tl.to(card, {
      scale: 1.04,
      boxShadow: '0 8px 30px rgba(72,187,120,0.35), 0 2px 8px rgba(0,0,0,0.10)',
      borderColor: 'rgba(72,187,120,0.50)',
      duration: dur * 0.3,
      ease: 'power2.out',
    })
    if (pulse) {
      tl.fromTo(pulse,
        { opacity: 0.6, scale: 0.95 },
        { opacity: 0, scale: 1.15, duration: dur * 0.5, ease: 'power2.out' },
        '<',
      )
    }
    tl.to(card, {
      scale: 1,
      boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.06)',
      borderColor: 'var(--theme-border)',
      duration: dur * 0.4,
      ease: 'power2.inOut',
    }, dur * 0.35)

    if (floating) {
      tl.fromTo(floating,
        { opacity: 1, y: 0, scale: 0.8 },
        {
          opacity: 0, y: -40, scale: 1.2,
          duration: dur * 0.6,
          ease: 'power2.out',
        },
        dur * 0.1,
      )
    }
  }

  // Price + favorite (+ basket on mobile) as an inline row placed above the
  // Created line. Rendered on tablet too (below lg) so the right-hand values
  // stop squeezing the title; the basket button stays in the right column on
  // tablet, and desktop keeps every value inline at the right.
  const valueActionsRow = (
    <div className="flex items-center justify-between gap-1" style={{ paddingTop: 4 }}>
      <div
        className="flex items-center gap-1"
        style={{
          fontSize: cfg.priceFs + 3,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--color-primary-50)',
          whiteSpace: 'nowrap' as const,
        }}
      >
        {nonSatsPrice ? (
          <RemotePriceLabel offer={offer} rates={NO_RATES} formatNumber={formatNumber} showEstimate={false} />
        ) : (
          <>
            <Zap size={cfg.priceFs + 3} />
            {formatNumber(offer.priceSats)}
            <FiatHint sats={offer.priceSats} className="text-[0.9em] ml-[3px]" />
          </>
        )}
      </div>
      <div className="flex items-center gap-1">
        {onFavoriteToggle && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onFavoriteToggle() }}
            aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            className="flex items-center justify-center transition-all duration-200 rounded-full cursor-pointer hover:scale-110 active:scale-95"
            style={{
              width: 24, height: 24,
              background: isFavorite ? '#E84541' : 'var(--theme-bg-subtle)',
              border: isFavorite ? 'none' : '1px solid var(--theme-border)',
              boxShadow: isFavorite ? '0 2px 8px rgba(232,69,65,0.5)' : 'none',
            }}
          >
            <Heart size={10} className={isFavorite ? 'fill-white text-white' : ''} style={{ color: isFavorite ? 'white' : 'var(--theme-text-muted)' }} />
          </button>
        )}
        {isMobile && !isRemote && (
          <div className="relative shrink-0">
            <button
              onClick={handleAddToBasket}
              className="flex items-center justify-center transition-colors duration-150 rounded-md cursor-pointer"
              style={{
                width: 28, height: 28,
                background: 'var(--theme-bg-subtle)',
                border: '1px solid var(--theme-border)',
                color: 'var(--color-status-success)',
              }}
              aria-label="Add to basket"
            >
              <ShoppingBag size={13} strokeWidth={2.5} />
            </button>
            <span
              ref={floatingRef}
              className="absolute pointer-events-none"
              style={{
                top: -4, right: -4,
                fontSize: 12, fontWeight: 800,
                color: 'var(--color-status-success)',
                opacity: 0,
                zIndex: 10,
              }}
            >
              +1
            </span>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="relative h-full" style={{ overflow: 'visible' }}>
    <Link
      ref={cardRef}
      to={`/buy/product/${offer.id}`}
      {...prefetchHandlers}
      className={`group/card flex ${isMobile ? 'flex-row items-stretch' : 'items-stretch'} no-underline cursor-pointer rounded-xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.06),0_4px_12px_rgba(0,0,0,0.06)] transition-all duration-300 ease-out hover:z-10 hover:-translate-y-1 hover:shadow-[0_8px_24px_rgba(0,0,0,0.18)] active:scale-[0.99] relative`}
      style={{
        background: CARD_THEME.bg(theme),
        outline: '1px solid var(--theme-border)',
        paddingTop: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        paddingRight: isMobile ? 0 : `${cfg.px}px`,
        gap: isMobile ? 0 : `${cfg.gap}px`,
        minHeight: cfg.rowH,
      }}
    >
      {/* Static sheen overlay — matches SliderList cards */}
      <div
        className="absolute inset-0 pointer-events-none rounded-xl"
        style={{ background: CARD_THEME.overlay(theme) }}
      />
      {/* Hover glow — subtle colabonate-red radial from bottom-right */}
      <div
        className="absolute inset-0 pointer-events-none rounded-xl opacity-0 transition-opacity duration-500 ease-out group-hover/card:opacity-100"
        style={{ background: HOVER_GLOW_BG }}
      />
      {isAgent && <AgentCardBackground />}
      <div
        ref={pulseRef}
        className="absolute inset-0 pointer-events-none rounded-xl"
        style={{
          background: 'radial-gradient(circle, rgba(72,187,120,0.25) 0%, rgba(72,187,120,0.08) 60%, transparent 100%)',
          opacity: 0,
          zIndex: 5,
        }}
      />
      {/* Column 1: Image — stretches full column height, content centered */}
      {hasImage ? (
        <div
          className="overflow-hidden shrink-0 self-stretch flex items-center justify-center"
          style={{ width: cfg.thumbW, background: 'var(--theme-bg-subtle)' }}
        >
          <ImageWithFallback
            src={offer.images![0]}
            alt={offer.title}
            className="object-cover w-full h-full"
            fallback={
              <div
                className="flex items-center self-stretch justify-center w-full h-full"
                style={{ background: isAgent ? 'rgba(159,122,234,0.12)' : isService ? 'rgba(99,179,237,0.12)' : 'rgba(72,187,120,0.12)' }}
              >
                {isAgent
                  ? <Bot size={cfg.thumbW * 0.3} style={{ color: '#9F7AEA' }} />
                  : isService
                    ? <Briefcase size={cfg.thumbW * 0.3} style={{ color: 'var(--color-primary-50)' }} />
                    : <Package size={cfg.thumbW * 0.3} style={{ color: 'var(--color-status-success)' }} />
                }
              </div>
            }
          />
        </div>
      ) : (
        <div
          className="flex items-center self-stretch justify-center shrink-0"
          style={{
            width: cfg.thumbW,
            background: isAgent ? 'rgba(159,122,234,0.12)' : isService ? 'rgba(99,179,237,0.12)' : 'rgba(72,187,120,0.12)',
          }}
        >
          {isAgent
            ? <Bot size={cfg.thumbW * 0.3} style={{ color: '#9F7AEA' }} />
            : isService
              ? <Briefcase size={cfg.thumbW * 0.3} style={{ color: 'var(--color-primary-50)' }} />
              : <Package size={cfg.thumbW * 0.3} style={{ color: 'var(--color-status-success)' }} />
          }
        </div>
      )}

      {/* Column 2: All content (category, title, actions) stacked in rows */}
      <div className="flex flex-col flex-1 min-w-0" style={{ padding: isMobile ? `${cfg.py}px ${cfg.px}px` : `${cfg.py}px 0`, justifyContent: 'center' }}>
        {/* Row 1: Category + Title */}
        <div
          className="mb-0.5"
          style={{
            fontSize: cfg.catFs,
            fontWeight: 600,
            color: 'var(--theme-text-muted)',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap' as const,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {isAgent
            ? <AgentCenterBadge position="inline" size={cfg.catFs + 6} />
            : isService
              ? <Briefcase size={cfg.catFs + 1} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 3, opacity: 0.7 }} />
              : <Package size={cfg.catFs + 1} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 3, opacity: 0.7 }} />}
          {isAgent ? getOfferTypeLabel(offer.offerType) : (offer.categoryCode || getOfferTypeLabel(offer.offerType)).replace(/\//g, ' - ')}
          {isAgent && offer.agentProfile?.reputationScore != null && (
            <span className="ml-2 inline-flex items-center gap-0.5" style={{ color: 'var(--color-warning-primary)' }}>
              <Star size={cfg.catFs} style={{ fill: 'currentColor' }} />
              {offer.agentProfile.reputationScore.toFixed(1)}
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: cfg.titleFs,
            fontWeight: 600,
            lineHeight: 1.3,
            display: '-webkit-box',
            WebkitLineClamp: isMobile ? 1 : 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            color: 'var(--theme-text)',
          }}
        >
          {offer.title}
        </div>

        {!isDesktop && valueActionsRow}

        {isRemote && (
          <div className="mt-2">
            <PurchasePathBadge path={resolvePurchasePath(offer).path} compact label="Remote listing" title="Open the listing to see how to order." />
          </div>
        )}

        {createdLabel && (
          <div className="mt-0.5 truncate" style={{ fontSize: cfg.catFs, color: 'var(--theme-text-muted)' }}>
            Created {createdLabel}
          </div>
        )}

        {/* ADR-370 D6 (Phase 2): pre-purchase canvas disclosure (G1) — list row. */}
        {isAgent && offer.agentConfigMeta?.canvas && offer.agentConfigMeta.canvas.provider !== 'none' && (
          <div className="mt-1">
            <CanvasDisclosureChips offer={offer} fontPx={cfg.catFs} />
          </div>
        )}

      </div>

      {!isMobile && (
        <div className="flex items-center gap-1.5 shrink-0 self-center">
          {isDesktop && (
            <>
              {onFavoriteToggle && (
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onFavoriteToggle() }}
                  aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                  className="flex items-center justify-center transition-all duration-200 rounded-full cursor-pointer hover:scale-110 active:scale-95"
                  style={{
                    width: 28, height: 28,
                    background: isFavorite ? '#E84541' : 'var(--theme-bg-subtle)',
                    border: isFavorite ? 'none' : '1px solid var(--theme-border)',
                    boxShadow: isFavorite ? '0 2px 8px rgba(232,69,65,0.5)' : 'none',
                  }}
                >
                  <Heart size={12} className={isFavorite ? 'fill-white text-white' : ''} style={{ color: isFavorite ? 'white' : 'var(--theme-text-muted)' }} />
                </button>
              )}
              <div
                className="flex items-center gap-1"
                style={{
                  fontSize: cfg.priceFs + 3,
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--color-primary-50)',
                  whiteSpace: 'nowrap' as const,
                }}
              >
                {nonSatsPrice ? (
                  <RemotePriceLabel offer={offer} rates={NO_RATES} formatNumber={formatNumber} showEstimate={false} />
                ) : (
                  <>
                    <Zap size={cfg.priceFs + 3} />
                    {formatNumber(offer.priceSats)}
                    <FiatHint sats={offer.priceSats} className="text-[0.9em] ml-[3px]" />
                  </>
                )}
              </div>
            </>
          )}
          {!isRemote && (
          <div className="relative shrink-0">
            <button
              onClick={handleAddToBasket}
              className="flex items-center justify-center transition-colors duration-150 rounded-lg cursor-pointer"
              style={{
                width: 32, height: 32,
                background: 'var(--theme-bg-subtle)',
                border: '1px solid var(--theme-border)',
                color: 'var(--color-status-success)',
              }}
              aria-label="Add to basket"
            >
              <ShoppingBag size={15} strokeWidth={2.5} />
            </button>
            <span
              ref={floatingRef}
              className="absolute pointer-events-none"
              style={{
                top: -4, right: -4,
                fontSize: 13, fontWeight: 800,
                color: 'var(--color-status-success)',
                opacity: 0,
                zIndex: 10,
              }}
            >
              +1
            </span>
          </div>
          )}
          <ChevronRight size={16} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
        </div>
      )}
    </Link>
    </div>
  )
}

// ── Size Toggle Button ───────────────────────────────────────────────

export function SizeToggle({ value, onChange }: { value: CardSize; onChange: (s: CardSize) => void }) {
  const sizes: CardSize[] = ['S', 'M', 'L']
  const icons: Record<CardSize, React.ReactNode> = {
    S: <Minus size={14} />,
    M: <Package size={14} />,
    L: <Maximize2 size={14} />,
  }

  return (
    <div className="flex items-center rounded-lg" style={{ background: 'var(--theme-bg-subtle)', gap: 2, padding: 2 }}>
      {sizes.map(s => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className="flex items-center justify-center transition-all duration-150 rounded-md cursor-pointer"
          style={{
            width: 36,
            height: 36,
            background: value === s ? 'var(--color-primary-50)' : 'transparent',
            color: value === s ? 'white' : 'var(--theme-text-muted)',
            border: 'none',
          }}
          aria-label={`Size ${s}`}
        >
          {icons[s]}
          <span className="ml-1 text-[11px] font-semibold">{s}</span>
        </button>
      ))}
    </div>
  )
}

// ── Empty State ───────────────────────────────────────────────────────

export function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div
      className="flex flex-col items-center py-10 text-center rounded-xl"
      style={{ border: '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
    >
      <div
        className="flex items-center justify-center mb-3 w-14 h-14 rounded-xl"
        style={{ background: 'var(--theme-bg-subtle)' }}
      >
        {icon}
      </div>
      <p className="text-[13px] m-0" style={{ color: 'var(--theme-text-muted)' }}>
        {message}
      </p>
    </div>
  )
}
