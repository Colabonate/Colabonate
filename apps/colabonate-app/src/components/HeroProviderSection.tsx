import { useRef, useState, useCallback, useEffect } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight, Globe, Heart, Star, Zap } from 'lucide-react'
import { useTranslation } from '../contexts/LocaleContext'
import { cn } from '@ds/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ServiceCard {
  id: string
  /** Angebots-Titel (z.B. offer.title) */
  title: string
  /** Kurzbeschreibung */
  description?: string
  /** Provider-Name (lnAddress oder pubkey-Prefix) */
  providerName: string
  /** Kategorie */
  category: string
  /** Avatar-Bild-URL */
  avatarUrl?: string
  /** Bewertung 0–5 */
  rating?: number
  /** Anzahl Reviews */
  reviewCount?: number
  /** Preis-String */
  priceRange?: string
  /** Preis in Satoshis */
  priceSats?: number
  isFavorite?: boolean
}

export interface HeroProviderSectionProps {
  headline?: string
  subtext?: string
  linkLabel?: string
  linkHref?: string
  cards: ServiceCard[]
  loading?: boolean
  onFavoriteToggle?: (id: string) => void
  onCardClick?: (id: string) => void
  className?: string
}

// ─── Drag-Scroll Hook ─────────────────────────────────────────────────────────

function useDragScroll() {
  const ref = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const startX = useRef(0)
  const scrollLeft = useRef(0)
  const velocity = useRef(0)
  const lastX = useRef(0)
  const rafId = useRef<number | null>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!ref.current) return
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
    const drift = () => {
      if (!ref.current || Math.abs(velocity.current) < 0.5) return
      ref.current.scrollLeft -= velocity.current * 0.92
      velocity.current *= 0.88
      rafId.current = requestAnimationFrame(drift)
    }
    rafId.current = requestAnimationFrame(drift)
  }, [])

  const onMouseLeave = useCallback(() => {
    if (isDragging.current) onMouseUp()
  }, [onMouseUp])

  useEffect(() => () => { if (rafId.current) cancelAnimationFrame(rafId.current) }, [])

  return { ref, onMouseDown, onMouseMove, onMouseUp, onMouseLeave }
}

// ─── ScrollArrow ──────────────────────────────────────────────────────────────

function ScrollArrow({ direction, onClick, visible }: {
  direction: 'left' | 'right'
  onClick: () => void
  visible: boolean
}) {
  return (
    <button
      onClick={onClick}
      aria-label={direction === 'left' ? 'Zurück' : 'Weiter'}
      className={cn(
        'absolute top-1/2 -translate-y-1/2 z-0',
        'w-9 h-9 rounded-full flex items-center justify-center',
        'border transition-all duration-300',
        'bg-white/90 border-black/10 text-[#3D4C53]',
        'shadow-[0_4px_16px_rgba(0,0,0,0.12)]',
        'hover:bg-white hover:shadow-[0_6px_24px_rgba(0,0,0,0.18)] hover:scale-105 active:scale-95',
        '[data-theme="dark"] &:bg-[#2D333B]/90 [data-theme="dark"] &:border-white/10 [data-theme="dark"] &:text-white',
        direction === 'left' ? 'left-2' : 'right-2',
        visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
      )}
    >
      {direction === 'left'
        ? <ChevronLeft size={16} strokeWidth={2.5} />
        : <ChevronRight size={16} strokeWidth={2.5} />}
    </button>
  )
}

// ─── Skeleton Card ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div
      className={cn(
        'shrink-0 snap-start w-40 rounded-xl animate-pulse',
        'bg-(--theme-bg-subtle,#EBEEF2)',
        'border border-(--theme-border,rgba(0,0,0,0.08))',
      )}
    >
      <div className="w-full h-30 rounded-t-xl bg-(--theme-bg-subtle,#DADEE3)" />
      <div className="px-3 pt-2.5 pb-3 flex flex-col gap-2">
        <div className="h-3 w-14 rounded bg-(--theme-bg-subtle,#DADEE3)" />
        <div className="h-3.5 w-full rounded bg-(--theme-bg-subtle,#DADEE3)" />
        <div className="h-3 w-20 rounded bg-(--theme-bg-subtle,#DADEE3)" />
      </div>
    </div>
  )
}

// ─── ServiceCardItem ──────────────────────────────────────────────────────────

function ServiceCardItem({ card, onFavoriteToggle, onClick }: {
  card: ServiceCard
  onFavoriteToggle?: () => void
  onClick?: () => void
}) {
  const { formatNumber } = useTranslation()
  const [fav, setFav] = useState(card.isFavorite ?? false)

  const handleFav = (e: React.MouseEvent) => {
    e.stopPropagation()
    setFav(v => !v)
    onFavoriteToggle?.()
  }

  return (
    <div className="relative z-0 py-3 shrink-0 snap-start hover:z-10">
      <article
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
        className={cn(
          'relative w-39 rounded-xl cursor-pointer group',
          'bg-[var(--color-neutral-white)]',
          'border border-[var(--color-neutral-8)]',
          'shadow-[0_2px_8px_rgba(0,0,0,0.07)]',
          'hover:shadow-[0_12px_32px_rgba(0,0,0,0.15)] hover:-translate-y-1.5',
          'transition-all duration-300 ease-out',
          '[data-theme="dark"] bg-[var(--color-neutral-black)] [data-theme="dark"] border-[var(--color-neutral-6)]',
        )}
      >
        <div className="relative w-full h-30 rounded-t-[11px] overflow-hidden">
          {card.avatarUrl ? (
            <img
              src={card.avatarUrl}
              alt={card.title}
              draggable={false}
              className="absolute inset-0 w-full h-full object-cover select-none transition-transform duration-500 group-hover:scale-[1.06]"
            />
          ) : (
            <div
              className="absolute inset-0"
              style={{ background: 'linear-gradient(150deg, #3D4C53 0%, #252D34 60%, #1A1F26 100%)' }}
            >
              <div
                className="absolute inset-0 opacity-[0.05]"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(0deg,#fff 0,#fff 1px,transparent 1px,transparent 28px),' +
                    'repeating-linear-gradient(90deg,#fff 0,#fff 1px,transparent 1px,transparent 28px)',
                }}
              />
              <span className="absolute inset-0 flex items-center justify-center text-[56px] font-black text-white/10 select-none leading-none">
                {card.title.charAt(0).toUpperCase()}
              </span>
            </div>
          )}

          <div
            className="absolute bottom-0 left-0 right-0 pointer-events-none h-14"
            style={{ background: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.42) 100%)' }}
          />

          <button
            onClick={handleFav}
            aria-label={fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten'}
            className={cn(
              'absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full',
              'transition-all duration-200 hover:scale-110 active:scale-95',
              fav
                ? 'bg-[#E84541] shadow-[0_2px_8px_rgba(232,69,65,0.5)]'
                : 'bg-black/30 backdrop-blur-sm border border-white/20',
            )}
          >
            <Heart size={12} className={fav ? 'fill-white text-white' : 'text-white'} />
          </button>

          {card.rating !== undefined && (
            <div className="absolute flex items-center gap-1 bottom-2 left-2">
              <Star size={10} className="fill-[#F5A623] text-[#F5A623]" />
              <span
                className="text-[11px] font-bold text-white leading-none tabular-nums"
                style={{ textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}
              >
                {card.rating.toFixed(1)}
              </span>
              {card.reviewCount !== undefined && (
                <span
                  className="text-[10px] text-white/70 leading-none"
                  style={{ textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}
                >
                  ({card.reviewCount})
                </span>
              )}
            </div>
          )}
        </div>

        <div className="px-3 pt-2.5 pb-3 h-27 flex flex-col gap-1 overflow-hidden">
          <span
            className={cn(
              'self-start inline-flex items-center px-1.5 py-0.5 rounded-sm shrink-0',
              'text-[9px] font-bold uppercase tracking-[0.07em] leading-none truncate max-w-full',
              'bg-[var(--color-neutral-9)] text-[var(--color-neutral-6)]',
              'border border-[var(--color-neutral-8)]',
              '[data-theme="dark"] bg-[var(--color-neutral-7)] [data-theme="dark"] text-[var(--color-neutral-4)] [data-theme="dark"] border-[var(--color-neutral-6)]',
            )}
          >
            {card.category}
          </span>

          <p
            className="text-[13px] font-semibold leading-[1.3] text-[var(--color-neutral-black)] line-clamp-2 shrink-0"
            style={{ fontFamily: 'var(--typography-fontfamily-sans)', height: '34px' }}
          >
            {card.title}
          </p>

          <p
            className="text-[11px] leading-none text-[var(--color-neutral-5)] truncate shrink-0"
            style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
          >
            {card.providerName}
          </p>

          <div className="flex items-center gap-1 mt-auto">
            <Zap size={10} className="fill-[var(--color-primary-50)] text-[var(--color-primary-50)] shrink-0" />
            <span
              className="text-[12px] font-bold text-[var(--color-primary-50)] leading-none tabular-nums"
              style={{ letterSpacing: '-0.02em' }}
            >
              {card.priceRange ?? card.priceSats ? formatNumber(card.priceSats ?? 0) : '–'}
            </span>
          </div>
        </div>
      </article>
    </div>
  )
}

// ─── HeroProviderSection ──────────────────────────────────────────────────────

export function HeroProviderSection({
  headline = 'Services in your area',
  subtext = 'Discover providers and services in your network',
  linkLabel = 'Show all',
  linkHref = '/buy',
  cards,
  loading = false,
  onFavoriteToggle,
  onCardClick,
  className,
}: HeroProviderSectionProps) {
  const { ref, onMouseDown, onMouseMove, onMouseUp, onMouseLeave } = useDragScroll()
  const [canScrollLeft, setCanScrollLeft]   = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(true)

  const updateScrollState = useCallback(() => {
    const el = ref.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 8)
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 8)
  }, [ref])

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
    }
  }, [updateScrollState, ref])

  const scroll = (dir: 'left' | 'right') => {
    ref.current?.scrollBy({ left: dir === 'left' ? -340 : 340, behavior: 'smooth' })
  }

  const ratedCards = cards.filter(c => c.rating !== undefined)
  const avgRating = ratedCards.length > 0
    ? ratedCards.reduce((sum, c) => sum + c.rating!, 0) / ratedCards.length
    : null

  return (
    <section
      className={cn(
        'w-full relative',
        'bg-(--theme-bg-elevated,#F4F6F9)',
        className,
      )}
    >
      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="relative flex items-start justify-between gap-4 px-4 pt-6 pb-4 md:px-6">
        <div className="flex flex-col min-w-0 gap-2">

          {/**/}
          <div className="flex items-center gap-1.5">
            <Globe size={16} className="text-[var(--color-primary-50)] shrink-0" />
            <span
              className={cn(
                'text-[10px] font-bold uppercase tracking-[0.15em]',
                'text-[var(--color-primary-50)]',
              )}
              style={{ fontFamily: 'var(--typography-fontfamily-barlow)' }}
            >
              In your area
            </span>
          </div>

          {/* Headline – heading-h2-light (Barlow, mobile→tablet) */}
          <h2
            className="text-[22px] font-light leading-7 tracking-[-0.015em]"
            style={{
              fontFamily: 'var(--typography-fontfamily-barlow)',
              fontSize: 'var(--typography-heading-h2-mobile-light-fontsize)',
              fontWeight: 'var(--typography-heading-h2-mobile-light-fontweight)',
              lineHeight: 'var(--typography-heading-h2-mobile-light-lineheight)',
              letterSpacing: 'var(--typography-heading-h2-mobile-light-letterspacing)',
              color: 'var(--theme-text, #1A2026)',
            }}
          >
            {headline}
          </h2>

          {/* Subtext – paragraph-base-regular, Source Sans Pro */}
          <p
            className="text-[13px] leading-normal"
            style={{
              fontFamily: 'var(--typography-fontfamily-sans)',
              fontSize: 'var(--typography-paragraph-base-regular-fontsize)',
              fontWeight: 'var(--typography-paragraph-base-regular-fontweight)',
              lineHeight: 'var(--typography-paragraph-base-regular-lineheight)',
              color: 'var(--theme-text-muted, #858C94)',
            }}
          >
            {subtext}
          </p>
        </div>

        {/* CTA – paragraph-xsmall-heavy, uppercase */}
        {linkHref && linkLabel && (
          <a
            href={linkHref}
            className="shrink-0 inline-flex items-center gap-1 mt-1 whitespace-nowrap transition-colors duration-200 hover:text-[var(--color-primary-50)]"
            style={{
              fontFamily: 'var(--typography-fontfamily-sans)',
              fontSize: 'var(--typography-paragraph-xsmall-heavy-fontsize)',
              fontWeight: 'var(--typography-paragraph-xsmall-heavy-fontweight)',
              lineHeight: 'var(--typography-paragraph-xsmall-heavy-lineheight)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--theme-text-muted, #858C94)',
            }}
          >
            {linkLabel}
            <ArrowRight size={12} strokeWidth={2.5} />
          </a>
        )}
      </div>

      {/* ── Slider ──────────────────────────────────────────────────────────── */}
      <div className="relative">
        {/* Fade links */}
        <div
          aria-hidden
          className="absolute top-0 bottom-0 left-0 z-0 w-8 transition-opacity duration-300 pointer-events-none"
          style={{
            background: 'linear-gradient(to right, var(--theme-bg-elevated, #F4F6F9), transparent)',
            opacity: canScrollLeft ? 1 : 0,
          }}
        />
        {/* Fade rechts */}
        <div
          aria-hidden
          className="absolute top-0 bottom-0 right-0 z-0 w-16 transition-opacity duration-300 pointer-events-none"
          style={{
            background: 'linear-gradient(to left, var(--theme-bg-elevated, #F4F6F9), transparent)',
            opacity: canScrollRight ? 1 : 0,
          }}
        />

        {/* Scroll-Pfeile (ab md) */}
        <div className="hidden md:block">
          <ScrollArrow direction="left"  onClick={() => scroll('left')}  visible={canScrollLeft} />
          <ScrollArrow direction="right" onClick={() => scroll('right')} visible={canScrollRight} />
        </div>

        {/* Track */}
        <div
          ref={ref}
          role="region"
          aria-label="Anbieter-Slider"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
          className={cn(
            'overflow-x-auto snap-x snap-mandatory scroll-smooth',
            '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
            'cursor-grab active:cursor-grabbing',
          )}
          style={{
            WebkitOverflowScrolling: 'touch',
            scrollPaddingLeft: '1rem',
            marginTop: '-16px',
            marginBottom: '-16px',
            paddingTop: '16px',
            paddingBottom: '48px',
          }}
        >
          <div className="flex gap-1">
          <span className="w-4 shrink-0 md:w-6 snap-start" aria-hidden="true" />
          {loading
            ? Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
            : cards.map(card => (
                <ServiceCardItem
                  key={card.id}
                  card={card}
                  onFavoriteToggle={() => onFavoriteToggle?.(card.id)}
                  onClick={onCardClick ? () => onCardClick(card.id) : undefined}
                />
              ))
          }
          <span className="w-16 shrink-0 snap-start" aria-hidden="true" />
          </div>
        </div>
      </div>

      {/* ── Stat-Strip ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1 px-4 pt-1 pb-5 md:px-6">
        <StatPill value={`${new Set(cards.map(c => c.providerName)).size}`} label="Anbieter" />
        <StatDot />
        <StatPill value={`${new Set(cards.map(c => c.category)).size}`} label="Kategorien" />
        {avgRating !== null && (
          <>
            <StatDot />
            <StatPill value={`${avgRating.toFixed(1)} ★`} label="Ø Bewertung" />
          </>
        )}
      </div>
    </section>
  )
}

function StatPill({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span
        className="text-[14px] font-bold tabular-nums text-(--theme-text,#2A2A2A)"
        style={{ fontFamily: 'var(--typography-fontfamily-barlow,Barlow,sans-serif)' }}
      >
        {value}
      </span>
      <span
        className="text-[10px] font-medium uppercase tracking-[0.07em] text-(--theme-text-muted,#858C94)"
        style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
      >
        {label}
      </span>
    </div>
  )
}

function StatDot() {
  return <span className="text-(--theme-border,#E4E8ED) mx-1.5 select-none">·</span>
}
