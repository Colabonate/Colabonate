import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from '../../contexts/LocaleContext'
import { Package, Briefcase, Bot, MoreVertical, Edit, Archive, Trash2, Eye, Heart, Star, Zap, Lock } from 'lucide-react'
import { CARD_THEME, CardImage } from '@ds/ui'
import { cn } from '@ds/utils'
import { richTextToPlainText } from './RichText'
import type { Offer } from '../../types/api'

const STATUS_BADGE_CLASS: Record<string, string> = {
  DRAFT:    'bg-[rgba(159,122,234,0.12)] text-[#9F7AEA] border-[rgba(159,122,234,0.28)]',
  ACTIVE:   'bg-[rgba(72,187,120,0.12)] text-[#276749] border-[rgba(72,187,120,0.28)]',
  CLOSED:   'bg-[rgba(245,166,35,0.12)] text-[#92600A] border-[rgba(245,166,35,0.28)]',
  ARCHIVED: 'bg-[rgba(113,128,150,0.12)] text-[#718096] border-[rgba(113,128,150,0.28)]',
}

// ADR-277 D9.1/R5: foreign non-sats listings store priceSats=0 as a sentinel (not a real free
// price) — priceCurrency being set is the discriminator. Never render `formatNumber(priceSats)
// sats` unguarded, or a 0 sentinel reads as "free".
function offerPriceLabel(offer: Offer, formatNumber: (n: number) => string): string {
  if (offer.priceCurrency) {
    return `${offer.priceAmount ?? '?'} ${offer.priceCurrency.toUpperCase()}`
  }
  return `${formatNumber(offer.priceSats)} sats`
}

const CATEGORY_BADGE_CLASS: Record<string, string> = {
  all:          'bg-(--color-neutral-8) text-(--color-neutral-3) border-(--color-neutral-7)',
  Service:      'bg-[rgba(99,179,237,0.12)] text-(--color-primary-60) border-[rgba(99,179,237,0.28)]',
  Product:      'bg-[rgba(72,187,120,0.12)] text-[#276749] border-[rgba(72,187,120,0.28)]',
  Cooperation:  'bg-[rgba(245,166,35,0.12)] text-[#92600A] border-[rgba(245,166,35,0.28)]',
}

export interface BaseOfferCardProps {
  offer: Offer
  variant: 'listing' | 'marketplace'
  view?: 'grid' | 'list'
  theme: 'light' | 'dark'
  index?: number
  onClick?: () => void
  onAction?: (action: 'view' | 'edit' | 'archive' | 'delete' | 'publish', offer: Offer) => void
  onFavoriteChange?: (offerId: string, isFavorite: boolean) => void
}

export function BaseOfferCard({
  offer,
  variant,
  view = 'grid',
  theme,
  index = 0,
  onClick,
  onAction,
  onFavoriteChange,
}: BaseOfferCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [fav, setFav] = useState(false)
  const C = CARD_THEME.colors(theme)
  const thumbUrl = offer.images?.[0]
  const isService = offer.offerType === 'SERVICE'
  const isItem = offer.offerType === 'ITEM'
  const isAgent = offer.offerType === 'AGENT_SETUP'

  const handleClick = () => {
    if (onClick) onClick()
  }

  const handleFavorite = () => {
    const newFav = !fav
    setFav(newFav)
    if (onFavoriteChange) onFavoriteChange(offer.id, newFav)
  }

  const typeLabel = isAgent ? 'Agent' : isService ? 'Service' : isItem ? 'Item' : variant === 'marketplace' ? 'Offer' : offer.offerType === 'PRODUCT' ? 'Product' : 'Listing'
  const TypeIcon = isAgent ? Bot : isService ? Briefcase : Package

  const content = view === 'grid' ? (
    <div
      className="relative z-0 py-1 hover:z-10"
      style={{ animation: `card-enter 0.38s cubic-bezier(0.22,1,0.36,1) ${index * 60}ms both` }}
    >
      {variant === 'marketplace' ? (
        <Link to={`/offers/${offer.id}`} className="no-underline block">
          <GridCardInner
            offer={offer}
            thumbUrl={thumbUrl}
            C={C}
            fav={fav}
            onFavorite={handleFavorite}
            typeLabel={typeLabel}
            TypeIcon={TypeIcon}
          />
        </Link>
      ) : (
        <>
          <article
            className="relative rounded-xl overflow-hidden transition-all duration-300 ease-out hover:-translate-y-1.5 cursor-pointer"
            style={{ background: CARD_THEME.bg(theme), boxShadow: CARD_THEME.shadow }}
            onMouseEnter={e => (e.currentTarget.style.boxShadow = CARD_THEME.shadowHover)}
            onMouseLeave={e => (e.currentTarget.style.boxShadow = CARD_THEME.shadow)}
            onClick={handleClick}
          >
            <div className="absolute inset-0 pointer-events-none rounded-xl" style={{ background: CARD_THEME.overlay(theme) }} />
            <GridCardInner
              offer={offer}
              thumbUrl={thumbUrl}
              C={C}
              fav={fav}
              onFavorite={handleFavorite}
              typeLabel={typeLabel}
              TypeIcon={TypeIcon}
              showStatusBadge
            />
          </article>
          {onAction && (
            <div className="absolute bottom-3 right-3">
              <ActionMenu
                offer={offer}
                menuOpen={menuOpen}
                onToggle={() => setMenuOpen(v => !v)}
                onAction={onAction}
                onClose={() => setMenuOpen(false)}
              />
            </div>
          )}
        </>
      )}
    </div>
  ) : (
    <div
      className={cn(
        'flex items-center gap-4 px-4 py-3.5 rounded-xl cursor-pointer transition-all duration-200 hover:-translate-y-px hover:shadow-[0_4px_20px_rgba(0,0,0,0.10)]',
        variant === 'marketplace' && 'no-underline',
      )}
      style={{
        background: 'var(--theme-surface)',
        border: '1px solid var(--theme-border)',
        animation: `card-enter 0.38s cubic-bezier(0.22,1,0.36,1) ${index * 50}ms both`,
      }}
      onClick={variant === 'marketplace' ? handleClick : undefined}
    >
      {variant === 'marketplace' ? (
        <Link to={`/offers/${offer.id}`} className="no-underline flex items-center gap-4 flex-1 min-w-0">
          <ListCardInner offer={offer} thumbUrl={thumbUrl} variant={variant} />
        </Link>
      ) : (
        <ListCardInner offer={offer} thumbUrl={thumbUrl} variant={variant} />
      )}
      {variant === 'listing' && onAction && (
        <button
          onClick={e => { e.stopPropagation(); onAction('edit', offer) }}
          className="w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer transition-all duration-200 hover:bg-(--theme-bg-subtle)"
          style={{ color: 'var(--theme-text-muted)' }}
        >
          <Edit size={14} />
        </button>
      )}
    </div>
  )

  return content
}

// ─── Grid Card Inner ─────────────────────────────────────────────────────────

function GridCardInner({
  offer,
  thumbUrl,
  C,
  fav,
  onFavorite,
  typeLabel,
  TypeIcon,
  showStatusBadge,
}: {
  offer: Offer
  thumbUrl: string | undefined
  C: ReturnType<typeof CARD_THEME.colors>
  fav: boolean
  onFavorite: () => void
  typeLabel: string
  TypeIcon: typeof Package
  showStatusBadge?: boolean
}) {
  const { formatNumber } = useTranslation()
  const isAgent = offer.offerType === 'AGENT_SETUP'
  return (
    <>
      <div className="relative w-full overflow-hidden" style={{ height: '120px' }}>
        <CardImage
          className="w-full h-full"
          src={thumbUrl}
          alt={offer.title}
          fallback={
            <span
              className="absolute inset-0 flex items-center justify-center select-none leading-none"
              style={{ fontSize: CARD_THEME.text.placeholderSize, fontWeight: CARD_THEME.text.placeholderWeight, color: C.placeholder }}
            >
              {offer.title.charAt(0).toUpperCase()}
            </span>
          }
        />
        <div className="absolute bottom-0 left-0 right-0 pointer-events-none h-14" style={{ background: CARD_THEME.bottomScrim }} />

        {showStatusBadge && offer.status && (
          <div className="absolute top-2 right-2">
            <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-sm uppercase leading-none border text-[9px] font-bold tracking-widest', STATUS_BADGE_CLASS[offer.status] ?? STATUS_BADGE_CLASS.DRAFT)}>
              {offer.status}
            </span>
          </div>
        )}

        {!showStatusBadge && (
          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); onFavorite() }}
            aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
            className={cn(
              'absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full',
              'transition-all duration-200 hover:scale-110 active:scale-95',
              fav ? 'bg-[#E84541] shadow-[0_2px_8px_rgba(232,69,65,0.5)]' : 'bg-black/45 border border-white/20',
            )}
          >
            <Heart size={12} className={fav ? 'fill-white text-white' : 'text-white'} />
          </button>
        )}

        <div className="absolute top-2 left-2 flex items-center gap-1">
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm uppercase leading-none" style={{ fontSize: CARD_THEME.text.badgeSize, fontWeight: CARD_THEME.text.badgeWeight, letterSpacing: CARD_THEME.text.badgeTracking, backgroundColor: C.entityOfferBg, color: C.entityOfferColor, border: `1px solid ${C.entityOfferBorder}` }}>
            <TypeIcon size={8} strokeWidth={2.5} /> {typeLabel}
          </span>
          {offer.companyId && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm uppercase leading-none" style={{ fontSize: CARD_THEME.text.badgeSize, fontWeight: CARD_THEME.text.badgeWeight, letterSpacing: CARD_THEME.text.badgeTracking, backgroundColor: 'rgba(99,179,237,0.38)', color: '#63B3ED', border: '1px solid rgba(99,179,237,0.45)' }}>
              Corporate
            </span>
          )}
          {!offer.companyId && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm uppercase leading-none" style={{ fontSize: CARD_THEME.text.badgeSize, fontWeight: CARD_THEME.text.badgeWeight, letterSpacing: CARD_THEME.text.badgeTracking, backgroundColor: 'rgba(113,128,150,0.38)', color: 'var(--color-neutral-5)', border: '1px solid rgba(113,128,150,0.45)' }}>
              Private
            </span>
          )}
          {offer.visibility === 'PRIVATE' && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm uppercase leading-none" style={{ fontSize: CARD_THEME.text.badgeSize, fontWeight: CARD_THEME.text.badgeWeight, letterSpacing: CARD_THEME.text.badgeTracking, backgroundColor: 'rgba(159,122,234,0.38)', color: '#B794F4', border: '1px solid rgba(159,122,234,0.45)' }}>
              <Lock size={8} strokeWidth={2.5} /> Encrypted
            </span>
          )}
        </div>

        {offer.agentProfile?.reputationScore != null ? (
          <div className="absolute flex items-center gap-1 bottom-2 left-2">
            <Star size={10} style={{ fill: CARD_THEME.ratingColor, color: CARD_THEME.ratingColor }} />
            <span style={{ fontSize: CARD_THEME.text.ratingSize, fontWeight: CARD_THEME.text.ratingWeight, color: 'white', textShadow: CARD_THEME.textShadow }} className="leading-none tabular-nums">
              {offer.agentProfile.reputationScore.toFixed(1)}
            </span>
          </div>
        ) : offer.sellerStats?.rating !== undefined && (
          <div className="absolute flex items-center gap-1 bottom-2 left-2">
            <Star size={10} style={{ fill: CARD_THEME.ratingColor, color: CARD_THEME.ratingColor }} />
            <span style={{ fontSize: CARD_THEME.text.ratingSize, fontWeight: CARD_THEME.text.ratingWeight, color: 'white', textShadow: CARD_THEME.textShadow }} className="leading-none tabular-nums">
              {offer.sellerStats.rating.toFixed(1)}
            </span>
            {offer.sellerStats.reviewCount !== undefined && (
              <span className="text-[10px] text-white/70 leading-none" style={{ textShadow: CARD_THEME.textShadow }}>
                ({offer.sellerStats.reviewCount})
              </span>
            )}
          </div>
        )}
      </div>

      <div className="relative px-3 pt-2.5 pb-3 flex flex-col gap-1">
        {isAgent && offer.agentProfile && offer.agentProfile.capabilities.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {offer.agentProfile.capabilities.slice(0, 3).map(cap => (
              <span
                key={cap}
                className="inline-flex items-center px-1.5 py-0.5 rounded-sm leading-none truncate max-w-27.5"
                style={{ fontSize: CARD_THEME.text.categorySize, backgroundColor: C.categoryBg, color: C.categoryColor, border: `1px solid ${C.categoryBorder}` }}
              >
                {cap}
              </span>
            ))}
            {offer.agentProfile.capabilities.length > 3 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm leading-none" style={{ fontSize: CARD_THEME.text.categorySize, color: C.textSecondary }}>
                +{offer.agentProfile.capabilities.length - 3}
              </span>
            )}
          </div>
        )}
        {offer.category && (
          <span className="self-start inline-flex items-center px-1.5 py-0.5 rounded-sm shrink-0 uppercase leading-none truncate max-w-full" style={{ fontSize: CARD_THEME.text.categorySize, fontWeight: CARD_THEME.text.categoryWeight, letterSpacing: CARD_THEME.text.categoryTracking, backgroundColor: C.categoryBg, color: C.categoryColor, border: `1px solid ${C.categoryBorder}` }}>
            {offer.category}
          </span>
        )}
        <p className="line-clamp-2 shrink-0" style={{ fontFamily: CARD_THEME.font.sans, fontSize: CARD_THEME.text.titleSize, fontWeight: CARD_THEME.text.titleWeight, lineHeight: CARD_THEME.text.titleLineHeight, color: C.textPrimary, minHeight: '34px' }}>
          {offer.title}
        </p>
        {offer.creator?.lnAddress && (
          <p className="leading-none truncate shrink-0" style={{ fontFamily: CARD_THEME.font.sans, fontSize: CARD_THEME.text.providerSize, color: C.textSecondary }}>
            {offer.creator.lnAddress}
          </p>
        )}
        <div className="flex items-center gap-1 mt-auto pt-1">
          <Zap size={10} style={{ fill: CARD_THEME.accent, color: CARD_THEME.accent }} className="shrink-0" />
          <span className="leading-none tabular-nums" style={{ fontFamily: CARD_THEME.font.sans, fontSize: CARD_THEME.text.priceInlineSize, fontWeight: CARD_THEME.text.priceInlineWeight, letterSpacing: CARD_THEME.text.priceInlineTracking, color: CARD_THEME.accent }}>
            {offerPriceLabel(offer, formatNumber)}
          </span>
        </div>
      </div>
    </>
  )
}

// ─── List Card Inner ─────────────────────────────────────────────────────────

function ListCardInner({
  offer,
  thumbUrl,
  variant,
}: {
  offer: Offer
  thumbUrl: string | undefined
  variant: 'listing' | 'marketplace'
}) {
  const { formatNumber } = useTranslation()
  const isService = offer.offerType === 'SERVICE'
  const isItem = offer.offerType === 'ITEM'
  const isAgent = offer.offerType === 'AGENT_SETUP'

  return (
    <>
      <div className="relative w-12 h-12 rounded-lg shrink-0 overflow-hidden" style={{ background: 'var(--color-neutral-8)' }}>
        <CardImage
          className="w-full h-full"
          src={thumbUrl}
          alt={offer.title}
          fallback={
            <span
              className="absolute inset-0 flex items-center justify-center text-xl font-black leading-none"
              style={{ color: 'var(--color-neutral-5)' }}
            >
              {offer.title.charAt(0).toUpperCase()}
            </span>
          }
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          {variant === 'listing' && offer.status && (
            <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-widest border leading-none', STATUS_BADGE_CLASS[offer.status] ?? STATUS_BADGE_CLASS.DRAFT)}>
              {offer.status}
            </span>
          )}
          {variant === 'marketplace' && (
            <>
              <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-widest border leading-none', CATEGORY_BADGE_CLASS[offer.category] ?? CATEGORY_BADGE_CLASS.all)}>
                {offer.category}
              </span>
              {offer.companyId && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-widest border leading-none" style={{ background: 'rgba(99,179,237,0.12)', color: 'var(--color-primary-50)', borderColor: 'rgba(99,179,237,0.28)' }}>
                  Corporate
                </span>
              )}
              {!offer.companyId && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-widest border leading-none" style={{ background: 'rgba(113,128,150,0.1)', color: 'var(--color-neutral-5)', borderColor: 'rgba(113,128,150,0.28)' }}>
                  Private
                </span>
              )}
              {offer.visibility === 'PRIVATE' && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-widest border leading-none" style={{ background: 'rgba(159,122,234,0.12)', color: '#B794F4', borderColor: 'rgba(159,122,234,0.28)' }}>
                  <Lock size={9} strokeWidth={2.5} /> Encrypted
                </span>
              )}
            </>
          )}
          <span className="text-[15px] font-semibold truncate leading-none" style={{ color: 'var(--theme-text)' }}>
            {offer.title}
          </span>
          {isAgent && offer.agentProfile?.reputationScore != null && (
            <span className="inline-flex items-center gap-0.5 shrink-0" style={{ color: 'var(--color-neutral-5)' }}>
              <Star size={10} style={{ fill: 'currentColor' }} />
              <span className="text-[11px] font-semibold tabular-nums">{offer.agentProfile.reputationScore.toFixed(1)}</span>
            </span>
          )}
        </div>
        <p className="text-[12px] truncate" style={{ color: 'var(--theme-text-muted)' }}>
          {variant === 'listing'
            ? `${isAgent ? 'Agent' : isItem ? 'Item' : isService ? 'Service' : 'Product'} \u00B7 ${offer.category}`
            : isAgent && offer.agentProfile
              ? offer.agentProfile.capabilities.slice(0, 3).join(' \u00B7 ')
              : richTextToPlainText(offer.description)}
        </p>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Zap size={12} style={{ fill: 'var(--color-primary-50)', color: 'var(--color-primary-50)' }} />
        <span className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--color-primary-50)' }}>
          {offerPriceLabel(offer, formatNumber)}
        </span>
      </div>
    </>
  )
}

// ─── Action Menu ─────────────────────────────────────────────────────────────

function ActionMenu({
  offer,
  menuOpen,
  onToggle,
  onAction,
  onClose,
}: {
  offer: Offer
  menuOpen: boolean
  onToggle: () => void
  onAction: (action: 'view' | 'edit' | 'archive' | 'delete' | 'publish', offer: Offer) => void
  onClose: () => void
}) {
  return (
    <div className="relative">
      <button
        onClick={e => { e.stopPropagation(); onToggle() }}
        className="w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer transition-all duration-200 hover:bg-white/10"
        style={{ background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.15)' }}
      >
        <MoreVertical size={14} className="text-white" />
      </button>
      {menuOpen && (
        <div className="absolute bottom-full right-0 mb-1 w-36 py-1 rounded-lg shadow-lg z-50" style={{ background: 'var(--theme-surface)', border: '1px solid var(--theme-border)' }}>
          <button onClick={() => { onClose(); onAction('view', offer) }} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] cursor-pointer hover:bg-(--theme-bg-subtle) transition-colors" style={{ color: 'var(--theme-text)' }}>
            <Eye size={14} /> View
          </button>
          <button onClick={() => { onClose(); onAction('edit', offer) }} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] cursor-pointer hover:bg-(--theme-bg-subtle) transition-colors" style={{ color: 'var(--theme-text)' }}>
            <Edit size={14} /> Edit
          </button>
          {offer.status === 'DRAFT' && (
            <button onClick={() => { onClose(); onAction('publish', offer) }} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] cursor-pointer hover:bg-(--theme-bg-subtle) transition-colors" style={{ color: 'var(--color-status-success)' }}>
              <Eye size={14} /> Publish
            </button>
          )}
          {offer.status === 'ACTIVE' && (
            <button onClick={() => { onClose(); onAction('archive', offer) }} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] cursor-pointer hover:bg-(--theme-bg-subtle) transition-colors" style={{ color: 'var(--theme-text-muted)' }}>
              <Archive size={14} /> Archive
            </button>
          )}
          <button onClick={() => { onClose(); onAction('delete', offer) }} className="w-full flex items-center gap-2 px-3 py-2 text-[12px] cursor-pointer hover:bg-(--theme-bg-subtle) transition-colors" style={{ color: 'var(--color-status-error)' }}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}
    </div>
  )
}
