import { useRef, useState, useCallback, useEffect, useMemo, isValidElement, cloneElement } from 'react'
import { gsap } from 'gsap'
import { Button, IconButton, Tooltip, Menu, MenuItem, ListItemIcon, ListItemText, Popover, Badge } from '@mui/material'
import { cn, useTheme, useIsMobile, getOfferTypeLabel, formatCompactDate, truncateHandle } from '@ds/utils'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import FavoriteIcon from '@mui/icons-material/Favorite'
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder'
import StarIcon from '@mui/icons-material/Star'
import BoltIcon from '@mui/icons-material/Bolt'
import PublicIcon from '@mui/icons-material/Public'
import OpenInFullIcon from '@mui/icons-material/OpenInFull'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import LabelIcon from '@mui/icons-material/Label'
import ShoppingBagIcon from '@mui/icons-material/ShoppingBag'
import LayersIcon from '@mui/icons-material/Layers'
import ReceiptIcon from '@mui/icons-material/Receipt'
import Inventory2Icon from '@mui/icons-material/Inventory2'
import PersonIcon from '@mui/icons-material/Person'
import BusinessIcon from '@mui/icons-material/Business'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import CheckIcon from '@mui/icons-material/Check'
import FilterListIcon from '@mui/icons-material/FilterList'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { CardImage } from '../card-image/card-image'
import { AgentCardBackground, AgentCenterBadge } from '../agent-card-theme/agent-card-theme'
import type { SliderListProps, SliderListItem, FilterChipDef } from './slider-list.types'

// ─── Theme Types ──────────────────────────────────────────────────────────────
type ThemeType = 'light' | 'dark';

// ─── Theme Cache for Performance Optimization ─────────────────────────────────
interface ThemeCache {
  bg: Map<ThemeType, string>;
  overlay: Map<ThemeType, string>;
  colors: Map<ThemeType, Record<string, string>>;
}

const THEME_CACHE: ThemeCache = {
  bg: new Map(),
  overlay: new Map(),
  colors: new Map(),
};

// ─── Theme Validation Helper ──────────────────────────────────────────────────
const validateTheme = (theme: unknown): ThemeType => {
  if (typeof theme === 'string' && ['light', 'dark'].includes(theme)) {
    return theme as ThemeType;
  }
  console.warn(`Invalid theme: ${theme}. Falling back to 'light'.`);
  return 'light';
};

// ─── Safe Gradient Generator ──────────────────────────────────────────────────
const createSafeGradient = (gradientString: string): string => {
  try {
    // Basic validation to ensure the gradient string looks valid
    if (!gradientString.includes('linear-gradient')) {
      console.warn(`Expected linear-gradient, got: ${gradientString}`);
    }
    return gradientString;
  } catch (error) {
    console.error(`Invalid gradient: ${gradientString}`, error);
    return 'linear-gradient(0deg, #F0F0F0 0%, #FFFFFF 100%)'; // Safe fallback
  }
};

// ─── Clear Theme Cache ────────────────────────────────────────────────────────
const clearThemeCache = () => {
  THEME_CACHE.bg.clear();
  THEME_CACHE.overlay.clear();
  THEME_CACHE.colors.clear();
};

// ─── Zentrale Card-Theme-Konfiguration ────────────────────────────────────────
// All card variants (Provider, Ticket, Offer) use these values.
// Exported so other pages (e.g. Offers.tsx marketplace grid) can apply identical tokens.
export const CARD_THEME = {
  // ── Hintergründe (theme-abhängig) ──────────────────────────────────────────
  bg: (theme: ThemeType) => {
    const validatedTheme = validateTheme(theme);
    
    if (THEME_CACHE.bg.has(validatedTheme)) {
      return THEME_CACHE.bg.get(validatedTheme)!;
    }
    
    const result = validatedTheme === 'dark' 
      ? createSafeGradient(`linear-gradient(105deg, var(--color-secondary-90) 0%, var(--color-secondary-80) 35%, var(--color-secondary-90) 100%)`)
      : createSafeGradient(`linear-gradient(105deg, var(--color-neutral-9) 0%, var(--color-neutral-8) 45%, var(--color-neutral-7) 100%)`);
      
    THEME_CACHE.bg.set(validatedTheme, result);
    return result;
  },
  
  overlay: (theme: ThemeType) => {
    const validatedTheme = validateTheme(theme);
    
    if (THEME_CACHE.overlay.has(validatedTheme)) {
      return THEME_CACHE.overlay.get(validatedTheme)!;
    }
    
    const result = validatedTheme === 'dark'
      ? createSafeGradient(`linear-gradient(135deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.02) 45%, transparent 100%)`)
      : createSafeGradient(`linear-gradient(135deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.1) 45%, transparent 100%)`);
      
    THEME_CACHE.overlay.set(validatedTheme, result);
    return result;
  },
  
  bottomScrim: createSafeGradient(`linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.45) 100%)`),

  // ── Elevation / Shadow ────────────────────────────────────────────────────
  cardWidth:       '196px',
  cardHeight:      '256px',
  imageHeight:     '120px',
  // Mobile variant (< sm / 360px): smaller footprint so more card content
  // is visible without scrolling. Applied automatically via useIsMobile().
  mobileWidth:     '160px',
  mobileHeight:    '210px',
  mobileImageHeight: '100px',
  // Compact variant (detail-view sliders): height fits content tightly
  // (60px thumbnail + 2-line title + price + padding ≈ 140px) so we don't
  // waste vertical space the way the full 168px card did.
  compactWidth:    '156px',
  compactHeight:   '140px',
  compactImageHeight: '60px',
  shadow:          '0 1px 2px rgba(0,0,0,0.08)',
  shadowHover:     '0 16px 24px rgba(0,0,0,0.28), 0 4px 16px rgba(61,76,83,0.45)',
  // Selected/active: crisp primary frame rendered as box-shadow so it hugs
  // the rounded corners with no ring-offset gap, plus a subtle elevation shadow.
  // Elevation is intentionally kept low so the selected card does not visually
  // detach too far from the slider list on detail pages.
  shadowSelected:  '0 0 0 4px color-mix(in srgb, var(--color-primary-50) 60%, transparent), 0 3px 8px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.08)',

  // ── Typography ────────────────────────────────────────────────────────────
  font: {
    sans:   'var(--typography-fontfamily-sans)',
    barlow: 'var(--typography-fontfamily-barlow, Barlow, sans-serif)',
  },
  text: {
    titleSize:            '14px',
    titleWeight:          '600',
    titleLineHeight:      '1.35',
    providerSize:         '11px',
    categorySize:         '9px',
    categoryWeight:       '700',
    categoryTracking:     '0.07em',
    badgeSize:            '11px',
    badgeWeight:          '700',
    badgeTracking:        '0.07em',
    ratingSize:           '12px',
    ratingWeight:         '700',
    priceSize:            '22px',
    priceWeight:          '700',
    priceTracking:        '-0.04em',
    priceSatsSize:        '10px',
    priceSatsWeight:      '600',
    priceSatsTracking:    '0.06em',
    priceInlineSize:      '12px',
    priceInlineWeight:    '700',
    priceInlineTracking:  '-0.02em',
    placeholderSize:      '48px',
    placeholderWeight:    '900',
  },
  // Mobile typography overrides (< sm / 360px)
  mobileText: {
    titleSize:            '12px',
    providerSize:         '10px',
    categorySize:         '8px',
    badgeSize:            '9px',
    ratingSize:           '10px',
    priceSize:            '18px',
    priceSatsSize:        '9px',
    priceInlineSize:      '11px',
  },

  // ── Farben (theme-unabhängig) ──────────────────────────────────────────────
  accent:      'var(--color-primary-50)',
  ratingColor: '#F5A623',
  textShadow:  '0 1px 3px rgba(0,0,0,0.7)',

  // ── Farben (theme-abhängig) ────────────────────────────────────────────────
  colors: (theme: ThemeType) => {
    const validatedTheme = validateTheme(theme);
    
    if (THEME_CACHE.colors.has(validatedTheme)) {
      return THEME_CACHE.colors.get(validatedTheme)!;
    }
    
    const result = {
      textPrimary:       validatedTheme === 'dark' ? 'var(--color-neutral-white)' : 'var(--color-secondary-80)',
      textSecondary:     validatedTheme === 'dark' ? 'var(--color-neutral-6)' : 'var(--color-secondary-60)',
      categoryBg:        validatedTheme === 'dark' ? 'var(--color-neutral-1)' : 'var(--color-neutral-8)',
      categoryColor:     validatedTheme === 'dark' ? 'var(--color-neutral-6)' : 'var(--color-secondary-50)',
      categoryBorder:    validatedTheme === 'dark' ? 'var(--color-neutral-2)' : 'var(--color-neutral-7)',
      priceColor:        validatedTheme === 'dark' ? 'var(--color-neutral-white)' : 'var(--color-secondary-90)',
      satsColor:         validatedTheme === 'dark' ? 'var(--color-secondary-50)' : 'var(--color-secondary-60)',
      placeholder:       validatedTheme === 'dark' ? 'var(--color-neutral-1)' : 'var(--color-neutral-8)',
      border:            validatedTheme === 'dark' ? 'var(--color-neutral-2)' : 'var(--color-neutral-7)',
      entityTicketBg:    validatedTheme === 'dark' ? 'var(--color-neutral-2)' : 'var(--color-neutral-7)', // Using accent-1 color (#6BB1FF) with alpha
      entityTicketColor: 'var(--color-primary-50)',
      entityTicketBorder: validatedTheme === 'dark' ? 'rgba(107,177,255,0.3)' : 'rgba(107,177,255,0.25)', // Using accent-1 color (#6BB1FF) with alpha
      entityOfferBg:     validatedTheme === 'dark' ? 'var(--color-neutral-2)' : 'var(--color-neutral-8)',
      entityOfferColor:  validatedTheme === 'dark' ? 'var(--color-neutral-6)' : 'var(--color-secondary-60)',
      entityOfferBorder: validatedTheme === 'dark' ? 'var(--color-neutral-3)' : 'var(--color-neutral-7)',
    };
    
    THEME_CACHE.colors.set(validatedTheme, result);
    return result;
  },
  
  // ── Public API for Cache Management ────────────────────────────────────────
  clearCache: clearThemeCache,
};

// Subtle colabonate-red radial glow anchored to the bottom-right of every card
// on hover. Used by all theme-aware card variants (Provider, Ticket, Offer,
// PartnerCard, InfoCard). The layer is `opacity-0` by default and fades in via
// `group-hover/card` over 500ms — pure CSS, no GSAP, GPU-friendly (radial
// gradient with mostly-transparent tail, painted once per hover).
const HOVER_GLOW_BG = 'radial-gradient(circle at 85% 90%, rgba(232,69,65,0.22) 0%, rgba(232,69,65,0.07) 40%, transparent 70%)'

// ─── Snap Helper ─────────────────────────────────────────────────────────────
function snapToNearest(el: HTMLDivElement, overshoot = 0, duration = 260, onComplete?: () => void) {
  const row = el.firstElementChild as HTMLElement | null
  if (!row) { onComplete?.(); return }
  const children = Array.from(row.children) as HTMLElement[]
  const containerLeft = el.getBoundingClientRect().left
  const target = el.scrollLeft + overshoot

  let best: HTMLElement | null = null
  let bestDist = Infinity
  for (const child of children) {
    const childLeft = child.getBoundingClientRect().left - containerLeft + el.scrollLeft
    const dist = Math.abs(childLeft - target)
    if (dist < bestDist) { bestDist = dist; best = child }
  }
  if (!best) { onComplete?.(); return }

  const snapTo = best.getBoundingClientRect().left - containerLeft + el.scrollLeft
  const bounceAmount = overshoot !== 0 ? overshoot * 0.12 : 0
  const start = el.scrollLeft
  const end = snapTo
  const startTime = performance.now()

  const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

  const animate = (now: number) => {
    const elapsed = now - startTime
    const t = Math.min(elapsed / duration, 1)
    el.scrollLeft = start + (end - start + bounceAmount * (1 - t)) * easeOutCubic(t)
    if (t < 1) requestAnimationFrame(animate)
    else { el.scrollLeft = end; onComplete?.() }
  }
  requestAnimationFrame(animate)
}

// ─── Custom Smooth Scroll (cancelable) ────────────────────────────────────────
// Replaces `el.scrollTo({ behavior: 'smooth' })` for the arrow buttons. Two
// reasons: (1) the native smooth scroll is not cancelable mid-flight, so a
// touch start during a button-triggered animation produces a janky fight
// between the OS smooth-scroll and the drag's direct `scrollLeft` writes;
// (2) it doesn't respect `scroll-snap-type: x mandatory`, so the final
// position can land off-snap. The rAF loop writes `scrollLeft` directly
// and exposes a `cancel` function the drag handler invokes on `mousedown`
// to hand off cleanly.
function smoothScrollTo(
  el: HTMLDivElement,
  target: number,
  duration = 280,
  onComplete?: () => void,
): () => void {
  const start = el.scrollLeft
  const end = Math.max(0, Math.min(target, el.scrollWidth - el.clientWidth))
  if (Math.abs(start - end) < 1) {
    onComplete?.()
    return () => {}
  }
  const startTime = performance.now()
  const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
  let cancelled = false
  let rafId = 0

  const animate = (now: number) => {
    if (cancelled) return
    const elapsed = now - startTime
    const t = Math.min(elapsed / duration, 1)
    el.scrollLeft = start + (end - start) * easeOutCubic(t)
    if (t < 1) {
      rafId = requestAnimationFrame(animate)
    } else {
      el.scrollLeft = end
      onComplete?.()
    }
  }
  rafId = requestAnimationFrame(animate)

  return () => {
    cancelled = true
    if (rafId) cancelAnimationFrame(rafId)
  }
}

// ─── Drag-Scroll Hook ─────────────────────────────────────────────────────────
function useDragScroll(onDragStart?: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const startX = useRef(0)
  const scrollLeft = useRef(0)
  const velocity = useRef(0)
  const lastX = useRef(0)
  const rafId = useRef<number | null>(null)
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Keep the latest `onDragStart` in a ref so the `onMouseDown` callback
  // identity stays stable across renders (avoids re-binding the listener
  // every time the parent re-renders).
  const onDragStartRef = useRef(onDragStart)
  onDragStartRef.current = onDragStart

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!ref.current) return
    // Cancel any in-flight smooth scroll (e.g. from an arrow button) so
    // the drag takes over from the current visual position rather than
    // fighting the still-running rAF writer.
    onDragStartRef.current?.()
    isDragging.current = true
    startX.current = e.pageX - ref.current.offsetLeft
    scrollLeft.current = ref.current.scrollLeft
    lastX.current = e.pageX
    velocity.current = 0
    if (rafId.current) cancelAnimationFrame(rafId.current)
    ref.current.style.cursor = 'grabbing'
    ref.current.style.userSelect = 'none'
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current || !ref.current) return
    e.preventDefault()
    const x = e.pageX - ref.current.offsetLeft
    ref.current.scrollLeft = scrollLeft.current - (x - startX.current) * 1.2
    velocity.current = e.pageX - lastX.current
    lastX.current = e.pageX
  }, [])

  const onMouseUp = useCallback(() => {
    if (!ref.current) return
    isDragging.current = false
    ref.current.style.cursor = 'grab'
    ref.current.style.removeProperty('user-select')
    const v = velocity.current
    velocity.current = 0
    snapToNearest(ref.current, -v * 8)
  }, [])

  const onMouseLeave = useCallback(() => {
    if (isDragging.current) onMouseUp()
  }, [onMouseUp])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const handleWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) < Math.abs(e.deltaY) && !e.shiftKey) return
      e.preventDefault()
      el.scrollLeft += (e.deltaX || e.deltaY) * 1.2
      if (wheelTimer.current) clearTimeout(wheelTimer.current)
      wheelTimer.current = setTimeout(() => snapToNearest(el, 0), 120)
    }

    el.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      el.removeEventListener('wheel', handleWheel)
      if (rafId.current) cancelAnimationFrame(rafId.current)
      if (wheelTimer.current) clearTimeout(wheelTimer.current)
    }
  }, [])

  return { ref, onMouseDown, onMouseMove, onMouseUp, onMouseLeave }
}

// ─── ScrollArrow Component ────────────────────────────────────────────────────
function ScrollArrow({ direction, onClick, visible }: {
  direction: 'left' | 'right'
  onClick: () => void
  visible: boolean
}) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <Button
      onClick={onClick}
      aria-label={direction === 'left' ? 'Back' : 'Forward'}
      size="small"
      variant="outlined"
      sx={{
        position: 'absolute',
        top: '50%',
        transform: 'translateY(-50%)',
        left: direction === 'left' ? '8px' : 'auto',
        right: direction === 'left' ? 'auto' : '8px',
        minWidth: '36px',
        height: '36px',
        borderRadius: '4px',
        opacity: visible ? 1 : 0.2,
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        backgroundColor: isDark ? 'var(--color-neutral-1)' : 'var(--color-neutral-white)',
        borderColor: isDark ? 'var(--color-secondary-10' : 'var(--color-secondary-10)',
        color: isDark ? 'white' : 'var(--color-secondary-50)',
        '&:hover': {
          backgroundColor: isDark ? 'var(--color-neutral-6)' : 'var(--color-neutral-9)',
          boxShadow: '0 3px 6px rgba(0,0,0,0.16), 0 3px 6px rgba(0,0,0,0.23)',
        },
      }}
    >
      {direction === 'left'
        ? <ChevronLeftIcon sx={{ fontSize: 16 }} />
        : <ChevronRightIcon sx={{ fontSize: 16 }} />}
    </Button>
  )
}

// ─── Skeleton Card ────────────────────────────────────────────────────────────
// Theme-aware (uses --theme-* tokens, not raw --color-neutral-white, so it no
// longer stays stark white in dark mode) and deliberately subtle rather than
// blank: a faint accent tint (Colabonate's --color-primary-50) on the border
// and placeholder blocks nods to the brand without being loud.
function SkeletonCard({ mobile = false }: { mobile?: boolean }) {
  const w = mobile ? CARD_THEME.mobileWidth : '156px'
  const h = mobile ? CARD_THEME.mobileHeight : CARD_THEME.cardHeight
  const imgH = mobile ? CARD_THEME.mobileImageHeight : '120px'
  const placeholderBg = 'color-mix(in srgb, var(--color-primary-50) 6%, var(--theme-bg-elevated, #F4F6F9))'
  return (
    <div
      className="shrink-0 rounded-xl overflow-hidden animate-pulse"
      style={{
        width: w,
        height: h,
        background: 'var(--theme-bg-subtle, #EBEEF2)',
        border: '1px solid color-mix(in srgb, var(--color-primary-50) 16%, var(--theme-border, rgba(0,0,0,0.08)))',
      }}
      aria-hidden="true"
    >
      <div className="w-full" style={{ height: imgH, background: placeholderBg }} />
      <div className="px-3 pt-2.5 pb-3 flex flex-col gap-2">
        <div className="h-3 w-14 rounded" style={{ background: placeholderBg }} />
        <div className="h-3.5 w-full rounded" style={{ background: placeholderBg }} />
        <div className="h-3 w-20 rounded" style={{ background: placeholderBg }} />
      </div>
    </div>
  )
}

// ─── Price Fiat Hint (ADR-235) ────────────────────────────────────────────────
// The pre-formatted fiat equivalent of the sats price rendered behind the sats
// in the app-wide FiatHint look: plain value (no ≈/= prefix), semibold — no chip
// frame. Theme-aware via the `color` prop (caller passes the card's resolved
// price color so it stays readable in both light and dark themes). Renders
// nothing when the consumer supplied no `priceFiat` (fail-open: sats-only).
function PriceFiatHint({ value, small = false, color = 'var(--color-neutral-white)' }: { value?: string; small?: boolean; color?: string }) {
  if (!value) return null
  return (
    <span
      className="font-semibold leading-none shrink-0 tabular-nums"
      style={{
        fontSize: small ? '10px' : '11px',
        color,
        marginLeft: 4,
      }}
    >
      {value}
    </span>
  )
}

// ─── Provider Card (für variant="provider") ──────────────────────────────────
function ProviderCard({ item, onFavoriteToggle, onClick, cardTheme, index = 0, isActive = false, mobile = false }: {
  item: SliderListItem
  onFavoriteToggle?: (id: string) => void
  onClick?: () => void
  cardTheme?: 'light' | 'dark'
  index?: number
  isActive?: boolean
  mobile?: boolean
}) {
  const { theme: globalTheme } = useTheme()
  const theme = cardTheme ?? globalTheme
  const [fav, setFav] = useState(item.isFavorite ?? false)
  const C = CARD_THEME.colors(theme)
  const T = mobile ? CARD_THEME.mobileText : CARD_THEME.text
  const imgH = mobile ? CARD_THEME.mobileImageHeight : CARD_THEME.imageHeight
  const phSize = CARD_THEME.text.placeholderSize
  const phWeight = CARD_THEME.text.placeholderWeight
  // ADR-385: seller/provider handle + compact creation date on one line.
  const metaLine = [item.providerName ? truncateHandle(item.providerName) : '', formatCompactDate(item.createdAt)].filter(Boolean).join(' · ')

  const handleFav = (e: React.MouseEvent) => {
    e.stopPropagation()
    setFav(v => !v)
    onFavoriteToggle?.(item.id)
  }

  return (
    <article
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      aria-current={isActive ? 'true' : undefined}
      data-slider-card-id={item.id}
      className={cn(
        'shrink-0 snap-start flex flex-col items-stretch rounded-xl cursor-pointer group/card',
        'relative overflow-hidden',
        'transition-all duration-300 ease-out hover:z-10',
        isActive
          ? 'z-30 -translate-y-0.5'
          : 'hover:-translate-y-1 hover:scale-[1.01]',
      )}
      style={{
        background: CARD_THEME.bg(theme),
        boxShadow: isActive
          ? CARD_THEME.shadowSelected
          : CARD_THEME.shadow,
        width: '100%',
        height: '100%',
        animation: 'card-enter 0.38s cubic-bezier(0.22, 1, 0.36, 1) backwards',
        animationDelay: `${index * 60}ms`,
      }}
      onMouseEnter={e => {
        if (isActive) return
        e.currentTarget.style.boxShadow = CARD_THEME.shadowHover
      }}
      onMouseLeave={e => {
        if (isActive) return
        e.currentTarget.style.boxShadow = CARD_THEME.shadow
      }}
    >
      <div className="absolute inset-0 pointer-events-none rounded-xl" style={{ background: CARD_THEME.overlay(theme) }} />
      {item.isAgent && <AgentCardBackground />}
      {item.isAgent && <AgentCenterBadge position="slider" />}

      <div
        className="absolute inset-0 pointer-events-none rounded-xl opacity-0 transition-opacity duration-500 ease-out group-hover/card:opacity-100"
        style={{ background: HOVER_GLOW_BG }}
      />

      <div className="relative w-full overflow-hidden rounded-t-xl shrink-0" style={{ height: imgH }}>
        <CardImage
          className="w-full h-full"
          src={item.avatarUrl}
          alt={item.title}
          imgClassName="group-hover:scale-[1.06]"
          fallback={
            <span
              className="absolute inset-0 flex items-center justify-center leading-none select-none"
              style={{ fontSize: phSize, fontWeight: phWeight, color: C.placeholder }}
            >
              {item.title.charAt(0).toUpperCase()}
            </span>
          }
        />

        <div className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none" style={{ background: CARD_THEME.bottomScrim }} />
        <div className="absolute top-0 left-0 right-0 h-[2.5px]" style={{ backgroundColor: CARD_THEME.accent }} />

        {/* Fav-Button oben rechts */}
        <button
          onClick={handleFav}
          aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
          className={cn(
            'absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full',
            'transition-all duration-200 hover:scale-110 active:scale-95',
            fav
              ? 'bg-[#E84541] shadow-[0_2px_8px_rgba(232,69,65,0.5)]'
              : 'bg-black/45 border border-white/20',
          )}
        >
          {fav ? <FavoriteIcon sx={{ fontSize: 12, color: 'white' }} /> : <FavoriteBorderIcon sx={{ fontSize: 12, color: 'white' }} />}
        </button>

        {/* Entity-Type-Badge oben links */}
        {item.entityType && (
          <div className="absolute top-2 left-2">
            <span
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm uppercase leading-none"
              style={{
                fontSize: T.badgeSize, fontWeight: CARD_THEME.text.badgeWeight, letterSpacing: CARD_THEME.text.badgeTracking,
                backgroundColor: item.entityType === 'ticket' ? C.entityTicketBg    : C.entityOfferBg,
                color:           item.entityType === 'ticket' ? C.entityTicketColor : C.entityOfferColor,
                border: `1px solid ${item.entityType === 'ticket'  ? C.entityTicketBorder : C.entityOfferBorder}`,
              }}
            >
              {item.entityType === 'ticket' ? <><ReceiptIcon sx={{ fontSize: 8 }} /> Ticket</> : <><Inventory2Icon sx={{ fontSize: 8 }} /> Offer</>}
            </span>
          </div>
        )}

        {/* Status-Badge oben links (nur wenn kein entityType) */}
        {!item.entityType && (item.statusLabel || item.rating === undefined) && (
          <div className="absolute top-2 left-2">
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-sm uppercase leading-none"
              style={{
                fontSize: T.badgeSize, fontWeight: CARD_THEME.text.badgeWeight, letterSpacing: CARD_THEME.text.badgeTracking,
                ...(item.statusLabel
                  ? { backgroundColor: (TICKET_STATUS_CONFIG[item.status ?? ''] ?? TICKET_STATUS_FALLBACK).bg, color: (TICKET_STATUS_CONFIG[item.status ?? ''] ?? TICKET_STATUS_FALLBACK).text }
                  : { backgroundColor: C.entityTicketBg, color: C.entityTicketColor }),
              }}
            >
              {item.statusLabel ?? 'Neu'}
            </span>
          </div>
        )}

        {/* Rating unten links */}
        {item.rating !== undefined && (
          <div className="absolute flex items-center gap-1 bottom-2 left-2">
            <StarIcon sx={{ fontSize: 10, color: CARD_THEME.ratingColor }} />
            <span
              style={{ fontSize: T.ratingSize, fontWeight: CARD_THEME.text.ratingWeight, color: 'white', textShadow: CARD_THEME.textShadow }}
              className="leading-none tabular-nums"
            >
              {item.rating.toFixed(1)}
            </span>
            {item.reviewCount !== undefined && (
              <span className="text-[10px] text-white/70 leading-none" style={{ textShadow: CARD_THEME.textShadow }}>
                ({item.reviewCount})
              </span>
            )}
          </div>
        )}
      </div>

      <div className={cn('relative flex flex-col items-start flex-1 min-h-0 gap-1', mobile ? 'px-2.5 pt-2 pb-2' : 'px-3 pt-2.5 pb-3')}>
        {item.category === 'Bounty' && (
          // Light "bounty hunter" chip pulse for home Collaborations slider
          // bounty cards (ADR-368 follow-up): a soft amber glow that swells in
          // and settles, disabled for prefers-reduced-motion.
          <style>{`@keyframes bountyHunterPulse{0%,100%{box-shadow:0 0 0 0 rgba(245,166,35,0.00);transform:translateY(0)}50%{box-shadow:0 0 10px 2px rgba(245,166,35,0.30);transform:translateY(-1px)}}@media (prefers-reduced-motion: reduce){.bounty-chip-anim{animation:none!important}}`}</style>
        )}
        <span
          className={cn('self-start inline-flex items-center px-1.5 py-0.5 rounded-sm shrink-0 uppercase leading-none truncate max-w-full', item.category === 'Bounty' && 'bounty-chip-anim')}
          style={{ fontSize: T.categorySize, fontWeight: CARD_THEME.text.categoryWeight, letterSpacing: CARD_THEME.text.categoryTracking, backgroundColor: C.categoryBg, color: C.categoryColor, border: `1px solid ${C.categoryBorder}`, ...(item.category === 'Bounty' ? { backgroundColor: 'rgba(245,166,35,0.14)', color: 'var(--color-warning-primary)', borderColor: 'rgba(245,166,35,0.45)', animation: 'bountyHunterPulse 1.8s ease-in-out infinite' } : {}) }}
        >
          {item.category}
        </span>

        <p
          className="line-clamp-2"
          style={{ fontFamily: CARD_THEME.font.sans, fontSize: T.titleSize, fontWeight: CARD_THEME.text.titleWeight, lineHeight: CARD_THEME.text.titleLineHeight, color: C.textPrimary }}
        >
          {item.title}
        </p>

        {metaLine && (
          <p
            className="leading-none truncate shrink-0"
            style={{ fontFamily: CARD_THEME.font.sans, fontSize: T.providerSize, color: C.textSecondary }}
          >
            {metaLine}
          </p>
        )}

        <div className={cn('flex items-center gap-1', mobile ? 'mt-1' : 'mt-auto')}>
          {!item.priceLabel && <BoltIcon sx={{ fontSize: 10, color: CARD_THEME.accent }} className="shrink-0" />}
          <span
            className="leading-none tabular-nums"
            style={{ fontFamily: CARD_THEME.font.sans, fontSize: T.priceInlineSize, fontWeight: CARD_THEME.text.priceInlineWeight, letterSpacing: CARD_THEME.text.priceInlineTracking, color: CARD_THEME.accent }}
          >
            {item.priceLabel ?? item.priceRange ?? item.priceSats?.toLocaleString('de-DE') ?? '–'}
          </span>
          <PriceFiatHint value={item.priceFiat} small color={C.priceColor} />
        </div>
      </div>
    </article>
  )
}

// ─── Status Badge config (TicketCard) ────────────────────────────────────────
const TICKET_STATUS_CONFIG: Record<string, { bar: string; bg: string; text: string; label: string }> = {
  PENDING:     { bar: 'var(--color-status-warning)',  bg: 'rgba(245,166,35,0.15)',  text: '#B87A00', label: 'Ausstehend'     },
  ACCEPTED:    { bar: 'var(--color-primary-50)',      bg: 'rgba(99,179,237,0.15)',  text: 'var(--color-primary-50)', label: 'Angenommen'    },
  PAID:        { bar: '#10B981',                       bg: 'rgba(16,185,129,0.15)', text: '#059669', label: 'Bezahlt'        },
  IN_PROGRESS: { bar: 'var(--color-primary-50)',      bg: 'rgba(99,179,237,0.15)', text: 'var(--color-primary-50)', label: 'In Bearbeitung' },
  COMPLETED:   { bar: 'var(--color-status-success)',  bg: 'rgba(72,187,120,0.15)', text: '#276749', label: 'Abgeschlossen'  },
  DISPUTED:    { bar: 'var(--color-status-error)',    bg: 'rgba(245,101,101,0.15)',text: '#C53030', label: 'Streitfall'     },
  CANCELLED:   { bar: 'var(--color-neutral-6)',       bg: 'rgba(113,128,150,0.12)',text: 'var(--color-neutral-5)', label: 'Abgebrochen'   },
}
const TICKET_STATUS_FALLBACK = { bar: 'var(--color-neutral-6)', bg: 'rgba(113,128,150,0.12)', text: 'var(--color-neutral-5)', label: '–' }

// ─── Ticket Card (für variant="ticket") ──────────────────────────────────────
function TicketCard({ item, onClick, cardTheme, index = 0, isActive = false, mobile = false }: {
  item: SliderListItem
  onClick?: () => void
  cardTheme?: 'light' | 'dark'
  index?: number
  isActive?: boolean
  mobile?: boolean
}) {
  const { theme: globalTheme } = useTheme()
  const theme = cardTheme ?? globalTheme
  const C = CARD_THEME.colors(theme)
  const T = mobile ? CARD_THEME.mobileText : CARD_THEME.text
  const imgH = mobile ? CARD_THEME.mobileImageHeight : CARD_THEME.imageHeight
  const phSize = CARD_THEME.text.placeholderSize
  const phWeight = CARD_THEME.text.placeholderWeight
  const statusCfg = TICKET_STATUS_CONFIG[item.status ?? ''] ?? TICKET_STATUS_FALLBACK
  // ADR-385: seller handle + compact creation date on one line.
  const metaLine = [item.providerName ? truncateHandle(item.providerName) : '', formatCompactDate(item.createdAt)].filter(Boolean).join(' · ')

  const CATEGORY_ICON: Record<string, React.ReactNode> = {
    SERVICE: <LayersIcon sx={{ fontSize: 16 }} />,
    PRODUCT: <ShoppingBagIcon sx={{ fontSize: 16 }} />,
  }
  const categoryKey = item.category?.toUpperCase()
  // ADR-366 D6: was a local CATEGORY_LABEL map that had drifted to German
  // ('Produkt') while SERVICE stayed English — unified via the shared label.
  const categoryLabel = (categoryKey === 'SERVICE' || categoryKey === 'PRODUCT')
    ? getOfferTypeLabel(categoryKey)
    : item.category
  const categoryIcon = CATEGORY_ICON[categoryKey] ?? <LabelIcon sx={{ fontSize: 11 }} />

  return (
<article
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      aria-current={isActive ? 'true' : undefined}
      data-slider-card-id={item.id}
      className={cn(
        'shrink-0 snap-start flex flex-col items-stretch rounded-xl cursor-pointer group/card',
        'relative overflow-hidden',
        'transition-all duration-300 ease-out hover:z-10',
        isActive
          ? 'z-30 -translate-y-0.5'
          : 'hover:-translate-y-1 hover:scale-[1.01]',
      )}
      style={{
        background: CARD_THEME.bg(theme),
        boxShadow: isActive
          ? CARD_THEME.shadowSelected
          : CARD_THEME.shadow,
        width: '100%',
        height: '100%',
        animation: 'card-enter 0.38s cubic-bezier(0.22, 1, 0.36, 1) backwards',
        animationDelay: `${index * 60}ms`,
      }}
      onMouseEnter={e => {
        if (isActive) return
        e.currentTarget.style.boxShadow = CARD_THEME.shadowHover
      }}
      onMouseLeave={e => {
        if (isActive) return
        e.currentTarget.style.boxShadow = CARD_THEME.shadow
      }}
    >
      <div className="absolute inset-0 pointer-events-none rounded-xl" style={{ background: CARD_THEME.overlay(theme) }} />
      {item.isAgent && <AgentCardBackground />}
      {item.isAgent && <AgentCenterBadge position="slider" />}

      <div
        className="absolute inset-0 pointer-events-none rounded-xl opacity-0 transition-opacity duration-500 ease-out group-hover/card:opacity-100"
        style={{ background: HOVER_GLOW_BG }}
      />

      <div className="relative w-full overflow-hidden rounded-t-xl shrink-0" style={{ height: imgH }}>
        <CardImage
          className="w-full h-full"
          src={item.avatarUrl}
          alt={item.title}
          imgClassName="group-hover:scale-[1.06]"
          fallback={
            <span
              className="absolute inset-0 flex items-center justify-center leading-none select-none"
              style={{ fontSize: phSize, fontWeight: phWeight, color: C.placeholder }}
            >
              {item.title.charAt(0).toUpperCase()}
            </span>
          }
        />

        <div className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none" style={{ background: CARD_THEME.bottomScrim }} />
        <div className="absolute top-0 left-0 right-0 h-[2.5px]" style={{ backgroundColor: statusCfg.bar }} />
      </div>

      <div className={cn('relative flex flex-col items-start flex-1 min-h-0 w-full', mobile ? 'px-2 pt-1.5 pb-2' : 'px-2.5 pt-2 pb-3')}>

        <span
          className="flex items-center gap-1 uppercase shrink-0 mb-0.5"
          style={{ fontFamily: CARD_THEME.font.sans, fontSize: T.categorySize, fontWeight: CARD_THEME.text.categoryWeight, letterSpacing: CARD_THEME.text.categoryTracking, color: C.categoryColor }}
        >
          {categoryIcon}
          {categoryLabel}
        </span>

        <span
          className="inline-flex items-center px-1 py-0.5 rounded-sm uppercase leading-none shrink-0 mb-1"
          style={{ fontSize: T.badgeSize, fontWeight: CARD_THEME.text.badgeWeight, letterSpacing: CARD_THEME.text.badgeTracking, backgroundColor: statusCfg.bg, color: statusCfg.text }}
        >
          {item.statusLabel ?? statusCfg.label}
        </span>

        <p
          className="line-clamp-2"
          style={{ fontFamily: CARD_THEME.font.sans, fontSize: T.titleSize, fontWeight: CARD_THEME.text.titleWeight, lineHeight: CARD_THEME.text.titleLineHeight, color: C.textPrimary }}
        >
          {item.title}
        </p>

        {metaLine && (
          <p
            className="leading-none truncate shrink-0 mt-0.5"
            style={{ fontFamily: CARD_THEME.font.sans, fontSize: T.providerSize, color: C.textSecondary }}
          >
            {metaLine}
          </p>
        )}

        <div className={cn('flex items-center gap-1', mobile ? 'mt-1' : 'pt-2 mt-auto')}>
          {!item.priceLabel && <BoltIcon sx={{ fontSize: 10, color: CARD_THEME.accent }} className="shrink-0" />}
          <span
            className="leading-none tabular-nums"
            style={{ fontFamily: CARD_THEME.font.sans, fontSize: T.priceInlineSize, fontWeight: CARD_THEME.text.priceInlineWeight, letterSpacing: CARD_THEME.text.priceInlineTracking, color: CARD_THEME.accent }}
          >
            {item.priceLabel ?? item.priceRange ?? item.priceSats?.toLocaleString('de-DE') ?? '–'}
          </span>
          <PriceFiatHint value={item.priceFiat} small color={C.priceColor} />
        </div>
      </div>
    </article>
  )
}

// ─── Offer Card (für variant="offer") ────────────────────────────────────────
function OfferCard({ item, onClick, cardTheme, index = 0, isActive = false, compact = false, hideBadges = false, mobile = false }: {
  item: SliderListItem
  onClick?: () => void
  cardTheme?: 'light' | 'dark'
  index?: number
  isActive?: boolean
  compact?: boolean
  hideBadges?: boolean
  mobile?: boolean
}) {
  const { theme: globalTheme } = useTheme()
  const theme = cardTheme ?? globalTheme

  const CATEGORY_ICON: Record<string, React.ReactNode> = {
    SERVICE: <LayersIcon sx={{ fontSize: 16 }} />,
    PRODUCT: <ShoppingBagIcon sx={{ fontSize: 16 }} />,
  }
  const categoryKey = item.category?.toUpperCase()
  // ADR-366 D6: was a local CATEGORY_LABEL map that had drifted to German
  // ('Produkt') while SERVICE stayed English — unified via the shared label.
  const categoryLabel = (categoryKey === 'SERVICE' || categoryKey === 'PRODUCT')
    ? getOfferTypeLabel(categoryKey)
    : item.category
  const categoryIcon = CATEGORY_ICON[categoryKey] ?? <LabelIcon sx={{ fontSize: 11 }} />

  const C = CARD_THEME.colors(theme)
  const useMobile = mobile && !compact
  const T = useMobile ? CARD_THEME.mobileText : CARD_THEME.text
  const cardWidth = compact ? CARD_THEME.compactWidth : (useMobile ? CARD_THEME.mobileWidth : CARD_THEME.cardWidth)
  const cardHeight = compact ? CARD_THEME.compactHeight : (useMobile ? CARD_THEME.mobileHeight : CARD_THEME.cardHeight)
  const imgH = compact ? CARD_THEME.compactImageHeight : (useMobile ? CARD_THEME.mobileImageHeight : CARD_THEME.imageHeight)
  const phSize = CARD_THEME.text.placeholderSize
  const phWeight = CARD_THEME.text.placeholderWeight
  // ADR-385: the OfferCard variant has no provider line — render the compact
  // creation date alone in the same muted provider style.
  const createdLabel = formatCompactDate(item.createdAt)

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-current={isActive ? 'true' : undefined}
      data-slider-card-id={item.id}
      className={cn(
        'shrink-0 snap-start flex flex-col items-stretch rounded-xl cursor-pointer group/card',
        'relative overflow-hidden',
        'transition-all duration-300 ease-out',
        isActive
          ? 'z-30 -translate-y-px'
          : 'hover:scale-[1.02] hover:-translate-y-0.5',
      )}
      style={{
        background: CARD_THEME.bg(theme),
        boxShadow: isActive
          ? CARD_THEME.shadowSelected
          : CARD_THEME.shadow,
        border: `1px solid ${C.border}`,
        width: cardWidth,
        height: cardHeight,
        animation: 'card-enter 0.38s cubic-bezier(0.22, 1, 0.36, 1) backwards',
        animationDelay: `${index * 60}ms`,
      }}
      onMouseEnter={e => {
        if (isActive) return
        e.currentTarget.style.boxShadow = CARD_THEME.shadowHover
      }}
      onMouseLeave={e => {
        if (isActive) return
        e.currentTarget.style.boxShadow = CARD_THEME.shadow
      }}
    >
      <div className="absolute inset-0 pointer-events-none rounded-xl" style={{ background: CARD_THEME.overlay(theme) }} />
      {item.isAgent && <AgentCardBackground />}
      {item.isAgent && <AgentCenterBadge position="slider" />}

      <div
        className="absolute inset-0 pointer-events-none rounded-xl opacity-0 transition-opacity duration-500 ease-out group-hover/card:opacity-100"
        style={{ background: HOVER_GLOW_BG }}
      />

      {/* Thumbnail / Placeholder */}
      <div className="relative w-full overflow-hidden rounded-t-xl shrink-0" style={{ height: imgH }}>
        <CardImage
          className="w-full h-full"
          src={item.avatarUrl}
          alt={item.title}
          imgClassName="group-hover:scale-[1.06]"
          fallback={
            <span
              className="absolute inset-0 flex items-center justify-center leading-none select-none"
              style={{ fontSize: phSize, fontWeight: phWeight, color: C.placeholder }}
            >
              {item.title.charAt(0).toUpperCase()}
            </span>
          }
        />
        <div className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none" style={{ background: CARD_THEME.bottomScrim }} />
        <div className="absolute top-0 left-0 right-0 h-[2.5px]" style={{ backgroundColor: CARD_THEME.accent }} />
      </div>

      <div className={cn('relative flex flex-col items-start flex-1 min-w-0 min-h-0 w-full overflow-hidden', useMobile ? 'px-2.5 pt-2 pb-2' : 'px-3 pt-2.5 pb-3')}>

        {!hideBadges && (
          <div className="relative flex flex-wrap items-center justify-between w-full mb-1 gap-x-1 gap-y-0.5">
            <span
              className="flex items-center gap-1 uppercase shrink-0"
              style={{ fontFamily: CARD_THEME.font.sans, fontSize: T.categorySize, fontWeight: CARD_THEME.text.categoryWeight, letterSpacing: CARD_THEME.text.categoryTracking, color: C.categoryColor }}
            >
              {categoryIcon}
              {categoryLabel}
            </span>

            {item.entityType && (
              <span
                className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-sm uppercase leading-none shrink-0"
                style={{
                  fontSize: T.badgeSize, fontWeight: CARD_THEME.text.badgeWeight, letterSpacing: CARD_THEME.text.badgeTracking,
                  backgroundColor: item.entityType === 'offer' ? C.entityOfferBg    : C.entityTicketBg,
                  color:           item.entityType === 'offer' ? C.entityOfferColor : C.entityTicketColor,
                  border: `1px solid ${item.entityType === 'offer' ? C.entityOfferBorder : C.entityTicketBorder}`,
                }}
              >
                {item.entityType === 'offer' ? <><Inventory2Icon sx={{ fontSize: 7 }} /> Offer</> : <><ReceiptIcon sx={{ fontSize: 7 }} /> Ticket</>}
              </span>
            )}
          </div>
        )}

        <span
          className="relative w-full line-clamp-2"
          style={{
            fontFamily: CARD_THEME.font.sans,
            fontSize: compact ? '13px' : T.titleSize,
            fontWeight: 600,
            lineHeight: compact ? 1.3 : CARD_THEME.text.titleLineHeight,
            color: compact ? (theme === 'dark' ? C.textPrimary : 'var(--color-secondary-70)') : C.textPrimary,
          }}
        >
          {item.title}
        </span>

        {createdLabel && (
          <p
            className="relative leading-none truncate shrink-0"
            style={{ fontFamily: CARD_THEME.font.sans, fontSize: T.providerSize, color: C.textSecondary }}
          >
            {createdLabel}
          </p>
        )}

        <div className="relative mt-auto pt-1 flex items-baseline gap-1">
          {!item.priceLabel && <BoltIcon sx={{ fontSize: compact ? 9 : 10, color: CARD_THEME.accent }} className="shrink-0 self-center" />}
          <span
            className="leading-none tabular-nums"
            style={{
              fontFamily: CARD_THEME.font.barlow,
              fontSize: compact ? '15px' : T.priceSize,
              fontWeight: CARD_THEME.text.priceWeight,
              letterSpacing: CARD_THEME.text.priceTracking,
              color: C.priceColor,
            }}
          >
            {item.priceLabel ?? (item.priceSats ?? 0).toLocaleString('de-DE')}
          </span>
          {!item.priceLabel && <span
            className="uppercase leading-none tabular-nums"
            style={{
              fontFamily: CARD_THEME.font.sans,
              fontSize: compact ? '9px' : T.priceSatsSize,
              fontWeight: CARD_THEME.text.priceSatsWeight,
              letterSpacing: CARD_THEME.text.priceSatsTracking,
              color: C.satsColor,
            }}
          >
            sats
          </span>}
          <PriceFiatHint value={item.priceFiat} small={compact} color={C.priceColor} />
        </div>
      </div>
    </div>
  )
}

// ─── Partner Card (für variant="partner") ────────────────────────────────────
// Tiny circular avatar variant — kept for the legacy 'partner' variant.
// New code should use the full-card variant below ('partner-card').
function PartnerCircleCard({ item, onClick, index = 0, isActive = false }: {
  item: SliderListItem
  onClick?: () => void
  index?: number
  isActive?: boolean
}) {
  return (
    <div
      onClick={onClick}
      aria-current={isActive ? 'true' : undefined}
      data-slider-card-id={item.id}
      className={cn(
        'shrink-0 snap-start w-20 h-20 rounded-full cursor-pointer',
        'flex flex-col items-center justify-center gap-1',
        'transition-all duration-250 ease-out',
        isActive
          ? 'z-30 scale-105'
          : 'hover:scale-[1.15]',
      )}
      style={{
        animation: 'card-enter 0.38s cubic-bezier(0.22, 1, 0.36, 1) backwards',
        animationDelay: `${index * 60}ms`,
        ...(isActive ? { boxShadow: CARD_THEME.shadowSelected } : {}),
      }}
    >
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center text-[18px] font-bold text-white"
        style={{
          background: `linear-gradient(135deg, var(--color-primary-50) 0%, var(--color-secondary-50) 100%)`,
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        }}
      >
        {item.providerName?.charAt(0).toUpperCase() ?? '?'}
      </div>
      <span
        className="text-[9px] font-medium text-center text-[var(--color-neutral-6)] line-clamp-1 max-w-full"
        style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
      >
        {item.providerName}
      </span>
    </div>
  )
}

// ─── Partner Card (für variant="partner-card") ───────────────────────────────
// Full UI-card variant matching ProviderCard / OfferCard / TicketCard visual
// language (CARD_THEME: 196×256, 120px image area). Renders a "Person" or
// "Company" badge in the top-left based on item.entityType so the same card
// adapts to both segments of the "New Local Partners" slider.
const PARTNER_ENTITY_META: Record<string, { icon: React.ReactNode; label: string; barColor: string }> = {
  person:  { icon: <PersonIcon sx={{ fontSize: 8 }} />,    label: 'Person',  barColor: 'var(--color-accent-1)' },
  company: { icon: <BusinessIcon sx={{ fontSize: 8 }} />,  label: 'Company', barColor: 'var(--color-accent-2)' },
}
const PARTNER_ENTITY_FALLBACK = { icon: <PublicIcon sx={{ fontSize: 8 }} />, label: 'Partner', barColor: CARD_THEME.accent }

function PartnerCard({ item, onClick, cardTheme, index = 0, isActive = false, mobile = false }: {
  item: SliderListItem
  onClick?: () => void
  cardTheme?: 'light' | 'dark'
  index?: number
  isActive?: boolean
  mobile?: boolean
}) {
  const { theme: globalTheme } = useTheme()
  const theme = cardTheme ?? globalTheme
  const C = CARD_THEME.colors(theme)
  const T = mobile ? CARD_THEME.mobileText : CARD_THEME.text
  const imgH = mobile ? CARD_THEME.mobileImageHeight : CARD_THEME.imageHeight
  const phSize = CARD_THEME.text.placeholderSize
  const phWeight = CARD_THEME.text.placeholderWeight

  const entityKey = item.entityType === 'person' || item.entityType === 'company' ? item.entityType : null
  const meta = entityKey ? PARTNER_ENTITY_META[entityKey] : PARTNER_ENTITY_FALLBACK
  // ADR-385: seller handle + compact creation date on one line (the handle is
  // suppressed when it duplicates the title, e.g. legacy partner items).
  const metaLine = [
    item.providerName && item.providerName !== item.title ? truncateHandle(item.providerName) : '',
    formatCompactDate(item.createdAt),
  ].filter(Boolean).join(' · ')

  return (
    <article
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      aria-current={isActive ? 'true' : undefined}
      data-slider-card-id={item.id}
      className={cn(
        'shrink-0 snap-start flex flex-col items-stretch rounded-xl cursor-pointer group/card',
        'relative overflow-hidden',
        'transition-all duration-300 ease-out hover:z-10',
        isActive
          ? 'z-30 -translate-y-0.5'
          : 'hover:-translate-y-1 hover:scale-[1.01]',
      )}
      style={{
        background: CARD_THEME.bg(theme),
        boxShadow: isActive
          ? CARD_THEME.shadowSelected
          : CARD_THEME.shadow,
        width: '100%',
        height: '100%',
        animation: 'card-enter 0.38s cubic-bezier(0.22, 1, 0.36, 1) backwards',
        animationDelay: `${index * 60}ms`,
      }}
      onMouseEnter={e => {
        if (isActive) return
        e.currentTarget.style.boxShadow = CARD_THEME.shadowHover
      }}
      onMouseLeave={e => {
        if (isActive) return
        e.currentTarget.style.boxShadow = CARD_THEME.shadow
      }}
    >
      <div className="absolute inset-0 pointer-events-none rounded-xl" style={{ background: CARD_THEME.overlay(theme) }} />
      {item.isAgent && <AgentCardBackground />}
      {item.isAgent && <AgentCenterBadge position="slider" />}

      <div
        className="absolute inset-0 pointer-events-none rounded-xl opacity-0 transition-opacity duration-500 ease-out group-hover/card:opacity-100"
        style={{ background: HOVER_GLOW_BG }}
      />

      {/* Thumbnail / Placeholder — logo for companies, avatar for people */}
      <div className="relative w-full overflow-hidden rounded-t-xl shrink-0" style={{ height: imgH }}>
        <CardImage
          className="w-full h-full"
          src={item.avatarUrl}
          alt={item.title}
          imgClassName="group-hover:scale-[1.06]"
          fallback={
            <span
              className="absolute inset-0 flex items-center justify-center leading-none select-none"
              style={{ fontSize: phSize, fontWeight: phWeight, color: C.placeholder }}
            >
              {item.title.charAt(0).toUpperCase()}
            </span>
          }
        />
        <div className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none" style={{ background: CARD_THEME.bottomScrim }} />
        <div className="absolute top-0 left-0 right-0 h-[2.5px]" style={{ backgroundColor: meta.barColor }} />

        {/* Entity-Type-Badge oben links */}
        <div className="absolute top-2 left-2">
          <span
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm uppercase leading-none"
            style={{
              fontSize: T.badgeSize, fontWeight: CARD_THEME.text.badgeWeight, letterSpacing: CARD_THEME.text.badgeTracking,
              backgroundColor: C.entityTicketBg, color: C.entityTicketColor, border: `1px solid ${C.entityTicketBorder}`,
            }}
          >
            {meta.icon}
            {meta.label}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className={cn('relative flex flex-col items-start flex-1 min-h-0 w-full gap-1', mobile ? 'px-2.5 pt-2 pb-2' : 'px-3 pt-2.5 pb-3')}>
        <span
          className="self-start inline-flex items-center px-1.5 py-0.5 rounded-sm shrink-0 uppercase leading-none truncate max-w-full"
          style={{ fontSize: T.categorySize, fontWeight: CARD_THEME.text.categoryWeight, letterSpacing: CARD_THEME.text.categoryTracking, backgroundColor: C.categoryBg, color: C.categoryColor, border: `1px solid ${C.categoryBorder}` }}
        >
          {item.category}
        </span>

        <p
          className="line-clamp-2"
          style={{ fontFamily: CARD_THEME.font.sans, fontSize: T.titleSize, fontWeight: CARD_THEME.text.titleWeight, lineHeight: CARD_THEME.text.titleLineHeight, color: C.textPrimary }}
        >
          {item.title}
        </p>

        {metaLine && (
          <p
            className="leading-none truncate shrink-0 mt-auto"
            style={{ fontFamily: CARD_THEME.font.sans, fontSize: T.providerSize, color: C.textSecondary }}
          >
            {metaLine}
          </p>
        )}
      </div>
    </article>
  )
}

// ─── Default Card (für variant="default") ────────────────────────────────────
function DefaultCard({ item, onClick, index = 0, isActive = false }: {
  item: SliderListItem
  onClick?: () => void
  index?: number
  isActive?: boolean
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-current={isActive ? 'true' : undefined}
      data-slider-card-id={item.id}
      className={cn(
        'shrink-0 snap-start w-48 rounded-xl cursor-pointer',
        'bg-[var(--color-neutral-white)]',
        isActive
           ? 'border-2 border-[var(--color-primary-50)] -translate-y-0.5 z-30'
          : 'border border-[var(--color-neutral-8)] shadow-[0_2px_8px_rgba(0,0,0,0.07)] hover:shadow-[0_12px_32px_rgba(0,0,0,0.15)] hover:-translate-y-1',
        'transition-all duration-300 ease-out',
      )}
      style={{ animation: 'card-enter 0.38s cubic-bezier(0.22, 1, 0.36, 1) backwards', animationDelay: `${index * 60}ms` }}
    >
      {item.avatarUrl ? (
        <div className="w-full h-32 overflow-hidden rounded-t-xl">
          <img src={item.avatarUrl} alt={item.title} className="object-cover w-full h-full" />
        </div>
      ) : (
        <div
          className="flex items-center justify-center w-full h-32 rounded-t-xl"
          style={{
            background: `linear-gradient(135deg, var(--color-secondary-50) 0%, var(--color-secondary-70) 100%)`,
          }}
        >
          {item.icon}
        </div>
      )}
      <div className="flex flex-col gap-2 p-3">
        <span
          className="text-[9px] font-bold uppercase tracking-[0.07em] text-[var(--color-neutral-6)]"
          style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
        >
          {item.category}
        </span>
        <p
          className="text-[13px] font-semibold text-[var(--color-neutral-black)] line-clamp-2"
          style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
        >
          {item.title}
        </p>
        {item.description && (
          <p
            className="text-[11px] text-[var(--color-neutral-5)] line-clamp-2"
            style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            {item.description}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Info Card ────────────────────────────────────────────────────────────────
function InfoCard({ title, description, ctaLabel, onCta, badges, cardTheme, compact, mobile = false }: {
  title: string
  description: string
  ctaLabel?: string
  onCta?: () => void
  badges?: Array<{ label: string; color: string; bg: string }>
  cardTheme?: 'light' | 'dark'
  compact?: boolean
  mobile?: boolean
}) {
  const { theme: globalTheme } = useTheme()
  const theme = cardTheme ?? globalTheme
  const C = CARD_THEME.colors(theme)
  const width  = compact ? '98px' : (mobile ? CARD_THEME.mobileWidth  : CARD_THEME.cardWidth)
  const height = mobile ? CARD_THEME.mobileHeight : CARD_THEME.cardHeight
  const badgeSize = mobile ? '8px' : '9px'
  const descSize  = compact ? '9px' : (mobile ? '10px' : '12px')
  const descLines = compact ? 12 : (mobile ? 6 : 7)
  const ctaSize   = mobile ? '11px' : '16px'
  return (
    <div
      className="flex flex-col items-stretch overflow-hidden shrink-0 snap-start rounded-xl"
      style={{
        width,
        height,
        background: CARD_THEME.bg(theme),
        boxShadow: CARD_THEME.shadow,
        border: `1px solid ${C.border}`,
      }}
    >
      {/* Accent bar */}
      <div className="w-full h-[2.5px] shrink-0" style={{ backgroundColor: CARD_THEME.accent }} />
      <div className={cn('flex flex-col items-start flex-1 w-full min-h-0 overflow-hidden', mobile ? 'gap-1 p-2' : 'gap-2 p-3')}>
        <span
          className={cn('font-bold uppercase tracking-[0.07em] shrink-0', compact ? 'text-[12px]' : mobile ? 'text-[13px]' : 'text-[16px]')}
          style={{ fontFamily: CARD_THEME.font.sans, color: CARD_THEME.accent }}
        >
          {title}
        </span>
        {badges && badges.length > 0 && !compact && (
          <div className="flex flex-wrap gap-1 shrink-0">
            {badges.map(b => (
              <span
                key={b.label}
                className="inline-flex items-center px-1.5 py-0.5 rounded-full leading-none"
                style={{ fontSize: badgeSize, fontWeight: 700, letterSpacing: '0.06em', color: b.color, backgroundColor: b.bg }}
              >
                {b.label}
              </span>
            ))}
          </div>
        )}
        <p
          className="flex-1 min-h-0 overflow-hidden"
          style={{ fontFamily: CARD_THEME.font.sans, fontSize: descSize, lineHeight: compact ? '1.45' : (mobile ? '1.35' : '1.375'), color: C.textSecondary, display: '-webkit-box', WebkitLineClamp: descLines, WebkitBoxOrient: 'vertical' }}
        >
          {description}
        </p>
        {ctaLabel && onCta && !compact && (
          <button
            onClick={onCta}
            className={cn('mt-auto font-semibold uppercase tracking-widest rounded-full border transition-colors duration-200', mobile ? 'text-[11px] px-2 py-0.5' : 'text-[16px] px-2.5 py-1')}
            style={{
              fontFamily: CARD_THEME.font.sans,
              fontSize: ctaSize,
              color: CARD_THEME.accent,
              borderColor: CARD_THEME.accent,
              background: 'transparent',
            }}
          >
            {ctaLabel}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Empty State Card ─────────────────────────────────────────────────────────
function EmptyCard({ message, cardTheme }: { message: string; cardTheme?: 'light' | 'dark' }) {
  const { theme: globalTheme } = useTheme()
  const theme = cardTheme ?? globalTheme
  const C = CARD_THEME.colors(theme)
  return (
    <div
      className="flex flex-col items-stretch overflow-hidden shrink-0 snap-start rounded-xl"
      style={{
        width: CARD_THEME.cardWidth,
        height: CARD_THEME.cardHeight,
        background: CARD_THEME.bg(theme),
        boxShadow: CARD_THEME.shadow,
        border: `1px solid ${C.border}`,
      }}
    >
      {/* Thumbnail placeholder – matches OfferCard */}
      <div className="relative w-full overflow-hidden rounded-t-xl shrink-0" style={{ height: CARD_THEME.imageHeight }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <span style={{ fontSize: '40px', fontWeight: CARD_THEME.text.placeholderWeight, color: C.placeholder }}>+</span>
        </div>
        <div className="absolute top-0 left-0 right-0 h-[2.5px]" style={{ backgroundColor: CARD_THEME.accent }} />
      </div>
      <div className="flex flex-col items-start flex-1 min-h-0 p-3 w-full gap-1.5 overflow-hidden">
        <span
          className="text-[11px] leading-snug flex-1 min-h-0"
          style={{ fontFamily: CARD_THEME.font.sans, color: C.textSecondary }}
        >
          {message}
        </span>
      </div>
    </div>
  )
}

// ─── Filter Chip (opens MUI Menu submenu) ────────────────────────────────────
function FilterChipMenu({ chip }: { chip: FilterChipDef }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const open = Boolean(anchorEl)

  const activeOption = chip.options.find(o => o.value === chip.value)
  const hasActive = !!activeOption && chip.value !== '' && chip.value !== 'all'
  const displayLabel = activeOption?.label ?? chip.label

  const color = hasActive
    ? (chip.color ?? 'var(--color-primary-50)')
    : 'var(--theme-text-muted)'
  const bg = hasActive
    ? (chip.bg ?? 'color-mix(in srgb, var(--color-primary-50) 10%, transparent)')
    : 'var(--theme-surface-secondary)'

  return (
    <>
      <button
        type="button"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'inline-flex items-center gap-1 py-[1px] rounded-sm outline-none whitespace-nowrap shrink-0',
          'text-[11px] font-semibold transition-all duration-200 cursor-pointer',
        )}
        style={{
          fontFamily: 'var(--typography-fontfamily-sans)',
          color,
          background: bg,
          border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
          paddingLeft: 8,
          paddingRight: 5,
        }}
      >
        {chip.icon}
        <span className="truncate max-w-[120px]">{displayLabel}</span>
        <ArrowDropDownIcon sx={{ fontSize: 14 }} />
      </button>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        slotProps={{
          paper: {
            sx: {
              borderRadius: '10px',
              mt: 0.5,
              maxHeight: 320,
              '& .MuiMenuItem-root': { fontSize: 13 },
            },
          },
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        {chip.options.map((opt) => {
          const selected = opt.value === chip.value
          return (
            <MenuItem
              key={opt.value}
              selected={selected}
              onClick={() => {
                chip.onChange(opt.value)
                setAnchorEl(null)
              }}
              sx={{ minHeight: 36 }}
            >
              <ListItemIcon sx={{ minWidth: 28, color: 'var(--color-primary-50)' }}>
                {selected ? <CheckIcon sx={{ fontSize: 16 }} /> : null}
              </ListItemIcon>
              <ListItemText
                primary={opt.label}
                slotProps={{ primary: { sx: { fontSize: 13 } } }}
              />
              {opt.count !== undefined && opt.count > 0 && (
                <span style={{ fontSize: 11, color: 'var(--theme-text-muted)' }}>
                  {opt.count}
                </span>
              )}
            </MenuItem>
          )
        })}
      </Menu>
    </>
  )
}

// ─── Filter Icon Button (collapses all filter chips behind one icon) ──────────
function FilterIconButton({ chips }: { chips: FilterChipDef[] }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const open = Boolean(anchorEl)
  const activeCount = chips.filter(c => c.value !== '' && c.value !== 'all' && c.options.some(o => o.value === c.value)).length

  return (
    <>
      <Tooltip title="Filter">
        <IconButton
          onClick={(e) => setAnchorEl(e.currentTarget)}
          aria-label="Filter"
          aria-haspopup="dialog"
          aria-expanded={open}
          size="small"
          sx={{
            mt: 0.25,
            border: '1px solid var(--theme-border, rgba(0,0,0,0.12))',
            borderRadius: 1.5,
            color: activeCount > 0 ? 'var(--color-primary-50)' : 'var(--theme-text-muted, #858C94)',
            borderColor: activeCount > 0 ? 'var(--color-primary-50)' : undefined,
            '&:hover': {
              color: 'var(--color-primary-50)',
              borderColor: 'var(--color-primary-50)',
            },
          }}
        >
          <Badge color="primary" variant="dot" invisible={activeCount === 0} sx={{ '& .MuiBadge-badge': { top: 3, right: 3 } }}>
            <FilterListIcon sx={{ fontSize: 14 }} />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              borderRadius: '10px',
              mt: 0.5,
              p: 1.5,
              maxWidth: 300,
            },
          },
        }}
      >
        <div className="flex flex-col gap-2" role="toolbar" aria-label="Filters">
          {chips.map((chip) => (
            <FilterChipMenu key={chip.id} chip={chip} />
          ))}
        </div>
      </Popover>
    </>
  )
}

// ─── Main SliderList Component ───────────────────────────────────────────────
export function SliderList({
  title,
  titleStyle,
  subtitle,
  subtitleCollapsible = false,
  subtitleTag,
  icon,
  iconBg,
  iconColor,
  tabs,
  activeTab,
  onTabChange,
  tabVariant = 'underline',
  segments,
  activeSegment,
  onSegmentChange,
  linkLabel,
  linkHref,
  onLinkClick,
  linkButton,
  children,
  secondSlot,
  headerSlot,
  items,
  renderItem,
  loading = false,
  skeletonCount = 4,
  skeleton,
  emptyMessage,
  emptyState,
  infoCard,
  infoCards,
  infoCardCompact = false,
  variant = 'default',
  enableDragScroll = true,
  showArrows = true,
  onFavoriteToggle,
  onCardClick,
  cardTheme,
  className,
  activeItemId,
  compactCards = false,
  hideCardBadges = false,
  compactHeader = false,
  flushStart = false,
  filterChips,
  collapseFilterChips = false,
  ...props
}: SliderListProps) {
  const isMobile = useIsMobile()
  // Holds the cancel function of the in-flight smooth-scroll (from an arrow
  // button click). The drag hook calls it on `mousedown` so the touch drag
  // takes over from the current visual position instead of fighting the
  // still-running rAF writer.
  const cancelArrowScrollRef = useRef<(() => void) | null>(null)
  const { ref, onMouseDown, onMouseMove, onMouseUp, onMouseLeave } = enableDragScroll
    ? useDragScroll(() => { cancelArrowScrollRef.current?.(); cancelArrowScrollRef.current = null })
    : { ref: useRef<HTMLDivElement>(null), onMouseDown: undefined, onMouseMove: undefined, onMouseUp: undefined, onMouseLeave: undefined }
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(true)

  // ── Subtitle carousel transition ──────────────────────────────────────────
  // Inert for callers with a static `subtitle` (nothing to react to); only
  // fires when a caller rotates the subtitle text at runtime (e.g. Home's
  // Marketplace slider). Text exits downward + blurry, then re-enters from
  // above, sharpening into place — a "threaded" top-to-bottom crossfade.
  const subtitleTextRef = useRef<HTMLSpanElement>(null)
  const [displayedSubtitle, setDisplayedSubtitle] = useState(subtitle)
  const isFirstSubtitleRender = useRef(true)
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // ── Per-section subtitle collapse (subtitleCollapsible) ────────────────────
  // Each section that opts in starts with its subtitle hidden; a small info
  // icon next to the title re-reveals it. When hidden the subtitle element is
  // removed from the flow (not just hidden) so the freed space folds away
  // cleanly — no leftover whitespace, and the header gap tightens accordingly.
  const [subtitleCollapsed, setSubtitleCollapsed] = useState(true)
  const subtitleHidden = !!subtitle && subtitleCollapsible && subtitleCollapsed

  useEffect(() => {
    if (subtitle === displayedSubtitle) return
    const el = subtitleTextRef.current
    if (!el || reducedMotion) { setDisplayedSubtitle(subtitle); return }
    const tween = gsap.to(el, {
      y: 10, autoAlpha: 0, filter: 'blur(6px)', duration: 0.3, ease: 'power2.in',
      onComplete: () => setDisplayedSubtitle(subtitle),
    })
    return () => { tween.kill() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitle])

  useEffect(() => {
    if (isFirstSubtitleRender.current) { isFirstSubtitleRender.current = false; return }
    const el = subtitleTextRef.current
    if (!el || reducedMotion) return
    const tween = gsap.fromTo(
      el,
      { y: -10, autoAlpha: 0, filter: 'blur(6px)' },
      { y: 0, autoAlpha: 1, filter: 'blur(0px)', duration: 0.4, ease: 'power2.out' },
    )
    return () => { tween.kill() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayedSubtitle])

  const mobileCards = isMobile && !compactCards

  const scrollRafRef = useRef(0)
  const applyScrollState = useCallback(() => {
    // Reads `scrollWidth`/`clientWidth` (forces sync layout). Coalesced to
    // ≤ 1 call per animation frame by the caller — see `updateScrollState`.
    scrollRafRef.current = 0
    const el = ref.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 8)
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 8)
  }, [ref])

  const updateScrollState = useCallback(() => {
    // Coalesce scroll/resize-driven layout reads to at most ONE per animation
    // frame. On a page with several SliderLists, uncoalesced reads on every
    // scroll tick caused layout-thrash → scroll freeze (worsened when a
    // poll/refresh re-rendered the cards and fired the ResizeObserver).
    if (scrollRafRef.current) return
    scrollRafRef.current = requestAnimationFrame(applyScrollState)
  }, [ref, applyScrollState])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    updateScrollState()
    el.addEventListener('scroll', updateScrollState, { passive: true })
    const ro = new ResizeObserver(updateScrollState)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', updateScrollState)
      ro.disconnect()
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current)
      // Cancel any in-flight smooth scroll from an arrow click.
      cancelArrowScrollRef.current?.()
      cancelArrowScrollRef.current = null
    }
  }, [updateScrollState, ref])

  // Re-evaluate arrow visibility when the list content changes. ResizeObserver
  // only watches the container's own box, not its scrollWidth, so adding or
  // removing cards would otherwise leave canScrollLeft stuck at false.
  useEffect(() => {
    updateScrollState()
  }, [items?.length, updateScrollState])

  // Back/forward scroll handler.
  const scroll = useCallback((dir: 'left' | 'right') => {
    const el = ref.current
    if (!el) return
    const scrollAmount = dir === 'left' ? -640 : 640
    const targetScroll = Math.max(
      0,
      Math.min(el.scrollLeft + scrollAmount, el.scrollWidth - el.clientWidth),
    )
    const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Cancel any in-flight arrow scroll from a previous click before
    // starting a new one — otherwise two animations would race and the
    // duration easing would be re-anchored mid-flight.
    cancelArrowScrollRef.current?.()
    cancelArrowScrollRef.current = null

    const onDone = () => {
      cancelArrowScrollRef.current = null
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = 0
      }
      applyScrollState()
    }

    if (reducedMotion) {
      el.scrollLeft = targetScroll
      onDone()
      return
    }

    cancelArrowScrollRef.current = smoothScrollTo(el, targetScroll, 280, onDone)
  }, [ref, applyScrollState])

  // Auto-scroll the active card into view when activeItemId (or items) changes.
// Uses `scrollTo({ behavior: 'smooth' })` so the card slides in without
// the user-perceptible "snap" jitter, and skips when the card is already
// fully visible. Skips when activeItemId is omitted.
  useEffect(() => {
    if (!activeItemId) return
    const el = ref.current
    if (!el) return
    const card = el.querySelector<HTMLElement>(`[data-slider-card-id="${CSS.escape(activeItemId)}"]`)
    if (!card) return
    const cardLeft = card.offsetLeft
    const cardRight = cardLeft + card.offsetWidth
    const visibleLeft = el.scrollLeft
    const visibleRight = el.scrollLeft + el.clientWidth
    const isVisible = cardLeft >= visibleLeft && cardRight <= visibleRight
    if (isVisible) return
    const target = Math.max(0, cardLeft - (el.clientWidth - card.offsetWidth) / 2)
    const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ left: target, behavior: reducedMotion ? 'auto' : 'smooth' })
  }, [activeItemId, items, ref])

  const renderCard = useCallback((item: SliderListItem, index: number) => {
    if (renderItem) {
      const custom = renderItem(item)
      // If the caller-provided renderItem returns `null`, fall back to the
      // default variant card. This lets the caller wrap a placeholder
      // (return its own card) while still rendering normal items via the
      // default path.
      if (custom !== null && custom !== undefined) {
        return isValidElement(custom) ? cloneElement(custom, { key: item.id }) : custom
      }
    }

    const handleClick = () => {
      onCardClick?.(item.id)
      item.onClick?.()
    }

    const isActive = Boolean(activeItemId) && item.id === activeItemId

    // Outer wrapper carries the colored Glow halo + Ring. It has
    // `overflow: visible` so the halo is not clipped (the inner card keeps
    // `overflow-hidden` for rounded image corners). Width/height live here
    // so scroll-snap alignment stays correct. The wrapper is `shrink-0` so
    // the flex layout behaves identically to the previous direct-child card.
    const card = (() => {
      switch (variant) {
        case 'provider':
          return <ProviderCard item={item} onFavoriteToggle={onFavoriteToggle} onClick={handleClick} cardTheme={cardTheme} index={index} isActive={isActive} mobile={mobileCards} />
        case 'ticket':
          return <TicketCard item={item} onClick={handleClick} cardTheme={cardTheme} index={index} isActive={isActive} mobile={mobileCards} />
        case 'offer':
          return <OfferCard item={item} onClick={handleClick} cardTheme={cardTheme} index={index} isActive={isActive} compact={compactCards} hideBadges={hideCardBadges} mobile={mobileCards} />
        case 'partner':
          return <PartnerCircleCard item={item} onClick={handleClick} index={index} isActive={isActive} />
        case 'partner-card':
          return <PartnerCard item={item} onClick={handleClick} cardTheme={cardTheme} index={index} isActive={isActive} mobile={mobileCards} />
        default:
          return <DefaultCard item={item} onClick={handleClick} index={index} isActive={isActive} />
      }
    })()

    const effectiveCardWidth = compactCards ? CARD_THEME.compactWidth : (mobileCards ? CARD_THEME.mobileWidth : CARD_THEME.cardWidth)
    const effectiveCardHeight = compactCards ? CARD_THEME.compactHeight : (mobileCards ? CARD_THEME.mobileHeight : CARD_THEME.cardHeight)

    return (
      <div
        key={item.id}
        data-slider-card-id={item.id}
        aria-current={isActive ? 'true' : undefined}
        className={cn(
          'shrink-0 snap-start relative overflow-visible',
          isActive ? 'z-30 -translate-y-0.5' : '',
        )}
        style={{
          boxShadow: 'none',
          borderRadius: 14,
          overflow: 'visible',
          width: variant === 'partner' ? 80 : effectiveCardWidth,
          height: variant === 'partner' ? 80 : effectiveCardHeight,
          animation: 'card-enter 0.38s cubic-bezier(0.22, 1, 0.36, 1) backwards',
          animationDelay: `${index * 60}ms`,
        }}
      >
        {card}
      </div>
    )
  }, [variant, renderItem, onFavoriteToggle, onCardClick, cardTheme, activeItemId, compactCards, hideCardBadges, mobileCards])

  const content = useMemo(() => {
    if (items && items.length > 0) {
      const mapped = items.map(renderCard)
      if (secondSlot) return <>{secondSlot}{mapped}{children}</>
      if (children) return <>{mapped}{children}</>
      return mapped
    }
    if (secondSlot || children) return <>{secondSlot}{children}</>
    if (emptyMessage) {
      return <EmptyCard message={emptyMessage} cardTheme={cardTheme} />
    }
    return null
  }, [items, renderCard, children, secondSlot, emptyMessage, cardTheme])

  const hasHeader = title || subtitle || (tabs && tabs.length > 0) || (segments && segments.length > 0) || (filterChips && filterChips.length > 0) || (linkLabel && linkHref)

  // Resolve effective tabs and infoCard when segments are active
  const activeSegmentDef = segments?.find(s => s.id === activeSegment)
  const effectiveTabs = activeSegmentDef?.subTabs ?? tabs
  const effectiveInfoCard = (segments && activeSegment && infoCards?.[activeSegment]) ?? infoCard

  // Segments act as the header's tab bar — when present, the trailing controls
  // (filter icon + expand/link button) render inline in that same row instead
  // of their own row, so they sit at the same height as the tab bar.
  const hasSegments = Boolean(segments && segments.length > 0)

  const filterIconButtonEl = collapseFilterChips && filterChips && filterChips.length > 0
    ? <FilterIconButton chips={filterChips} />
    : null

  const linkControlEl = linkLabel && (onLinkClick || linkHref) ? (
    linkButton && !isMobile ? (
      <Button
        component={onLinkClick ? 'button' : 'a'}
        href={onLinkClick ? undefined : linkHref}
        onClick={onLinkClick ? (e: React.MouseEvent) => { e.preventDefault(); onLinkClick() } : undefined}
        size="medium"
        variant="outlined"
        endIcon={<ArrowForwardIcon />}
        className="shrink-0"
        sx={{
          textTransform: 'none',
          borderRadius: 1.5,
          borderColor: 'color-mix(in srgb, var(--color-primary-50) 40%, transparent)',
          color: 'var(--color-primary-50)',
          '&:hover': {
            borderColor: 'var(--color-primary-50)',
            backgroundColor: 'color-mix(in srgb, var(--color-primary-50) 10%, transparent)',
          },
        }}
      >
        {linkLabel}
      </Button>
    ) : (
      <Tooltip title={linkLabel}>
        <IconButton
          component={onLinkClick ? 'button' : 'a'}
          href={onLinkClick ? undefined : linkHref}
          onClick={onLinkClick ? (e: React.MouseEvent) => { e.preventDefault(); onLinkClick() } : undefined}
          aria-label={linkLabel}
          size="small"
          className="shrink-0"
          sx={{
            mt: 0.25,
            border: '1px solid var(--theme-border, rgba(0,0,0,0.12))',
            borderRadius: 1.5,
            color: 'var(--theme-text-muted, #858C94)',
            '&:hover': {
              color: 'var(--color-primary-50)',
              borderColor: 'var(--color-primary-50)',
            },
          }}
        >
          <OpenInFullIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
    )
  ) : null

  // Mobile segments: inline in the segment row (next to tab bar).
  // Desktop segments: moved to the header's trailing position (top-right).
  const mobileTrailingControls = isMobile && (filterIconButtonEl || linkControlEl) ? (
    <div className="flex items-center gap-1 shrink-0">
      {filterIconButtonEl}
      {linkControlEl}
    </div>
  ) : null

  // Desktop-only trailing controls for segments (sit in the header's justify-between).
  const desktopSegmentTrailingControls = !isMobile && hasSegments && (filterIconButtonEl || linkControlEl) ? (
    <div className="flex items-center gap-1 shrink-0">
      {filterIconButtonEl}
      {linkControlEl}
    </div>
  ) : null

  // Fallback (no segments): mirrors the pre-existing header layout — on mobile
  // the link control lives in the tabs/nav row instead, to avoid showing twice.
  const fallbackLinkControlEl = !isMobile ? linkControlEl : null
  const fallbackTrailingControls = (filterIconButtonEl || fallbackLinkControlEl) ? (
    <div className="flex items-start gap-1 shrink-0">
      {filterIconButtonEl}
      {fallbackLinkControlEl}
    </div>
  ) : null

  return (
    <section className={cn('w-full relative mb-2 overflow-visible py-2 -my-2', className)} {...props}>
      {hasHeader && (
        <div className={cn('relative flex justify-between gap-4 pt-1 pb-1 ml-0', hasSegments ? 'md:items-end items-start' : 'items-start')}>
          <div className={cn('flex flex-col min-w-0 gap-2', (headerSlot || compactHeader) ? 'mb-0' : (isMobile ? 'mb-2' : (subtitleCollapsible ? 'mb-2' : 'mb-8')))}>
            {title && !isMobile && (
              <div className={cn('flex items-center gap-3')}>
                {icon && (
                  <div
                    className={cn(
                      'hidden md:flex items-center justify-center shrink-0 rounded-xl',
                      'w-10 h-10 md:w-12 md:h-12',
                    )}
                    style={{ background: iconBg ?? 'rgba(232,69,65,0.10)', color: iconColor ?? 'var(--color-primary-50)' }}
                  >
                    {icon}
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="mb-0" style={titleStyle}>{title}</h3>
                    {subtitleTag && (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold leading-none shrink-0"
                        style={{
                          color: subtitleTag.color,
                          background: subtitleTag.bg,
                          border: `1px solid color-mix(in srgb, ${subtitleTag.color} 30%, transparent)`,
                        }}
                      >
                        {subtitleTag.icon}
                        {subtitleTag.label}
                      </span>
                    )}
                    {subtitle && subtitleCollapsible && (
                      <Tooltip title={subtitleHidden ? 'Show info text' : 'Hide info text'}>
                        <IconButton
                          onClick={() => setSubtitleCollapsed(v => !v)}
                          aria-label={subtitleHidden ? 'Show info text' : 'Hide info text'}
                          aria-expanded={!subtitleHidden}
                          size="small"
                          className="shrink-0 self-start"
                          sx={{
                            p: '3px',
                            color: subtitleHidden ? 'var(--theme-text-muted)' : 'var(--color-primary-50)',
                            '&:hover': {
                              color: 'var(--color-primary-50)',
                              backgroundColor: 'var(--theme-bg-subtle)',
                            },
                          }}
                        >
                          <InfoOutlinedIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </div>
                  {subtitle && !subtitleHidden && (
                    <p
                      className="flex items-center gap-1.5 text-[12px] m-0 overflow-hidden"
                      style={{ color: 'var(--theme-text-muted)' }}
                    >
                      <span ref={subtitleTextRef} className="inline-block">{displayedSubtitle}</span>
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ── Segmented Control (zweistufige Filter) ────────────────────── */}
            {hasSegments && (
              <div className="flex items-center justify-between gap-2 max-w-full">
                <div
                  className="inline-flex items-center rounded-full p-[2px] gap-0 self-start max-w-full overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                  style={{ background: 'var(--theme-bg-subtle, rgba(0,0,0,0.04))' }}
                  role="tablist"
                  aria-label="Filter category"
                >
                  {segments!.map((seg) => {
                    const isActive = activeSegment === seg.id
                    return (
                      <button
                        key={seg.id}
                        role="tab"
                        aria-selected={isActive}
                        aria-busy={seg.loading && !seg.count ? true : undefined}
                        onClick={() => onSegmentChange?.(seg.id)}
                        className={cn(
                          'relative inline-flex items-center gap-1 px-1.5 md:px-2.5 py-1 md:py-1.5 rounded-full outline-none whitespace-nowrap shrink-0 border',
                          'text-[10px] md:text-[11px] font-semibold uppercase tracking-wider',
                          'transition-all duration-200 cursor-pointer',
                        )}
                        style={{
                          fontFamily: 'var(--typography-fontfamily-sans)',
                          background: 'transparent',
                          borderColor: isActive ? 'var(--color-primary-50)' : 'transparent',
                          color: isActive ? 'var(--color-primary-50)' : 'var(--theme-text-muted, #858C94)',
                        }}
                      >
                        {seg.label}
                        {seg.count !== undefined && seg.count > 0 ? (
                          <span
                            className="inline-flex items-center justify-center min-w-[14px] h-3.5 px-0.5 rounded-full text-[9px] font-bold leading-none"
                            style={{
                              background: 'color-mix(in srgb, var(--color-primary-50) 55%, transparent)',
                              color: 'var(--color-primary-contrast, #fff)',
                            }}
                          >
                            {seg.count}
                          </span>
                        ) : seg.loading ? (
                          <span
                            className="inline-flex w-[7px] h-[7px] rounded-full animate-pulse"
                            style={{ background: 'var(--color-primary-50)' }}
                            aria-hidden="true"
                          />
                        ) : null}
                      </button>
                    )
                  })}
                </div>

                {/* Trailing controls: mobile inline in segment row, desktop in header top-right */}
                {mobileTrailingControls}
              </div>
            )}

            {!collapseFilterChips && filterChips && filterChips.length > 0 && (
              <div
                className="flex flex-wrap items-center gap-1.5 max-w-full overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                role="toolbar"
                aria-label="Filters"
              >
                {filterChips.map((chip) => (
                  <FilterChipMenu key={chip.id} chip={chip} />
                ))}
              </div>
            )}

            {(effectiveTabs && effectiveTabs.length > 0) || (!hasSegments && isMobile && linkLabel && (onLinkClick || linkHref)) ? (
              <nav className={cn('flex items-center max-w-full overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden', tabVariant === 'outlined' ? 'gap-2' : '')} role="tablist">
                {effectiveTabs?.map((tab) => {
                  const isActive = activeTab === tab.id
                  if (tabVariant === 'outlined') {
                    return (
                      <button
                        key={tab.id}
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => onTabChange?.(tab.id)}
                        className={cn(
                          'px-3 py-1 rounded-full outline-none whitespace-nowrap shrink-0',
                          'text-[11px] font-semibold uppercase tracking-widest',
                          'border transition-all duration-200',
                          isActive
                            ? 'border-[var(--color-primary-50)] text-[var(--color-primary-50)] bg-[var(--color-primary-50)]/8'
                            : 'border-[var(--color-border-subtle,#E2E6EA)] text-[var(--theme-text-muted,#858C94)] hover:border-[var(--color-primary-50)] hover:text-[var(--color-primary-50)]',
                        )}
                        style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
                      >
                        {tab.label}
                      </button>
                    )
                  }
                  return (
                    <button
                      key={tab.id}
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => onTabChange?.(tab.id)}
                      className={cn(
                        'relative px-3 py-1.5 outline-none whitespace-nowrap shrink-0',
                        'text-[11px] font-semibold uppercase tracking-widest',
                        'font-[var(--typography-fontfamily-sans)]',
                        'transition-colors duration-200',
                        isActive
                          ? 'text-[var(--color-primary-50)]'
                          : 'text-[var(--theme-text-muted,#858C94)] hover:text-[#5A6068]',
                      )}
                    >
                      {tab.label}
                      {isActive && (
                        <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-[var(--color-primary-50)] rounded-full" />
                      )}
                    </button>
                  )
                })}
                {!hasSegments && isMobile && linkLabel && (onLinkClick || linkHref) && (
                  <Tooltip title={linkLabel}>
                    <IconButton
                      component={onLinkClick ? 'button' : 'a'}
                      href={onLinkClick ? undefined : linkHref}
                      onClick={onLinkClick ? (e: React.MouseEvent) => { e.preventDefault(); onLinkClick() } : undefined}
                      aria-label={linkLabel}
                      size="small"
                      className="shrink-0 ml-auto"
                      sx={{
                        mt: 0.25,
                        border: '1px solid var(--theme-border, rgba(0,0,0,0.12))',
                        borderRadius: 1.5,
                        color: 'var(--theme-text-muted, #858C94)',
                        '&:hover': {
                          color: 'var(--color-primary-50)',
                          borderColor: 'var(--color-primary-50)',
                        },
                      }}
                    >
                      <OpenInFullIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                )}
              </nav>
            ) : null}
          </div>

          {hasSegments ? desktopSegmentTrailingControls : (!isMobile || (collapseFilterChips && filterChips && filterChips.length > 0)) ? fallbackTrailingControls : null}
        </div>
      )}

      {headerSlot && (
        <div className="mt-2 md:mt-3 mb-4 md:mb-6">{headerSlot}</div>
      )}

       <div className="relative z-0 isolate overflow-visible">
        {/* Scroll-Arrows – müssen über den Cards liegen (z-Index höher als Card hover:z-10) */}
        {showArrows && (
          <>
            <div className="hidden md:block" style={{ position: 'absolute', top: '50%', left: 0, zIndex: 60, transform: 'translateY(-50%)' }}>
              <ScrollArrow direction="left" onClick={() => scroll('left')} visible={canScrollLeft} />
            </div>
            <div className="hidden md:block" style={{ position: 'absolute', top: '50%', right: 0, zIndex: 60, transform: 'translateY(-50%)' }}>
              <ScrollArrow direction="right" onClick={() => scroll('right')} visible={canScrollRight} />
            </div>
          </>
        )}

        <div className="relative">
          {/* Scroll-Container – liegt über FadeOut */}
          <div
            ref={ref}
            role="region"
            aria-label="Slider"
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseLeave}
            className={cn(
              '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
              enableDragScroll && 'cursor-grab active:cursor-grabbing',
            )}
            style={{
              scrollPaddingLeft: '1rem',
              paddingTop: 0,
              paddingBottom: 0,
              overflowX: 'auto',
              overflowY: 'visible',
              overflowAnchor: 'none',
              touchAction: 'auto',
              scrollSnapType: 'x mandatory',
              willChange: 'scroll-position',
            }}
          >
            <div className="flex items-stretch gap-4" style={{ paddingTop: subtitleCollapsible ? (isMobile ? 8 : 16) : (isMobile ? 12 : 36), paddingBottom: isMobile ? 12 : 40 }}>
              {!flushStart && <span className="w-4 shrink-0 snap-start" aria-hidden="true" />}
              {effectiveInfoCard && !loading && (() => {
                const infoCardEl = (
                  <InfoCard
                    title={effectiveInfoCard.title}
                    description={effectiveInfoCard.description}
                    ctaLabel={effectiveInfoCard.ctaLabel}
                    onCta={effectiveInfoCard.onCta}
                    badges={effectiveInfoCard.badges}
                    cardTheme={cardTheme}
                    compact={infoCardCompact}
                    mobile={mobileCards}
                  />
                )
                if (variant === 'ticket' || variant === 'provider') {
                  return (
                    <div className="relative z-0 shrink-0 snap-start">
                      {infoCardEl}
                    </div>
                  )
                }
                return infoCardEl
              })()}
              {loading
                ? (skeleton
                    ? Array.from({ length: skeletonCount }).map((_, i) => <div key={i} className="shrink-0">{skeleton}</div>)
                    : Array.from({ length: skeletonCount }).map((_, i) => <SkeletonCard key={i} mobile={mobileCards} />))
                : content}
              <span className="w-8 shrink-0 snap-start" aria-hidden="true" />
            </div>
          </div>

          {/* FadeOut-Effekte – liegen über dem Scroll-Container, aber unter den Scroll-Arrows */}
          <div
            aria-hidden
            className="absolute top-0 bottom-0 left-0 w-16 transition-opacity duration-300 pointer-events-none"
            style={{
              zIndex: 10,
              background: 'linear-gradient(to right, var(--theme-bg-elevated, #F4F6F9), transparent)',
              // Visible whenever the list overflows (mirrors the right edge at
              // scroll position 0), not only after scrolling left.
              opacity: (canScrollLeft || canScrollRight) ? 1 : 0,
            }}
          />
          <div
            aria-hidden
            className="absolute top-0 bottom-0 right-0 w-16 transition-opacity duration-300 pointer-events-none"
            style={{
              zIndex: 10,
              background: 'linear-gradient(to left, var(--theme-bg-elevated, #F4F6F9), transparent)',
              opacity: canScrollRight ? 1 : 0,
            }}
          />
        </div>
      </div>

      {!loading && !content && (emptyState || emptyMessage) && (
        emptyState
          ? <div className="px-2 py-2">{emptyState}</div>
          : (
            <p
              className={cn(
                'text-center py-10 text-sm',
                'text-[var(--color-neutral-6)]',
                'font-[var(--typography-fontfamily-sans)]',
              )}
            >
              {emptyMessage}
            </p>
          )
      )}
    </section>
  )
}
