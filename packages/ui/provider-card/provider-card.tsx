import FavoriteIcon from '@mui/icons-material/Favorite'
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder'
import StarIcon from '@mui/icons-material/Star'
import BoltIcon from '@mui/icons-material/Bolt'
import { cn } from '@ds/utils'
import type { ProviderCardProps } from './provider-card.types'

export function ProviderCard({
  name, category, avatarUrl, rating, priceRange,
  isFavorite = false, onFavoriteToggle, className, ...props
}: ProviderCardProps) {
  return (
    <div
      className={cn(
        'flex-shrink-0 snap-start w-[156px] rounded-[18px] overflow-hidden cursor-pointer group',
        'bg-white relative',
        'border border-[#E4E8ED]',
        'transition-all duration-300 ease-out',
        'hover:shadow-[0_16px_40px_rgba(0,0,0,0.16)] hover:border-[#DADEE3] hover:-translate-y-1',
        className
      )}
      style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.08)' }}
      {...props}
    >
      {/* ── Bild-Bereich ────────────────────────────────────────────────── */}
      <div className="relative w-full h-[134px] overflow-hidden">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={name}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.07]"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(150deg, #3D4C53 0%, #252D34 60%, #1A1F26 100%)' }}
          >
            {/* Feines Raster */}
            <div
              className="absolute inset-0 opacity-[0.06]"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(0deg,#fff 0,#fff 1px,transparent 1px,transparent 28px),' +
                  'repeating-linear-gradient(90deg,#fff 0,#fff 1px,transparent 1px,transparent 28px)',
              }}
            />
            {/* Großer Initialbuchstabe als Dekor */}
            <span
              className="absolute inset-0 flex items-center justify-center text-[64px] font-black leading-none select-none text-white/10"
              style={{ fontFamily: 'var(--typography-fontfamily-barlow, Barlow, sans-serif)' }}
            >
              {name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}

        {/* Gradient unten – weicher Übergang zum weißen Info-Bereich */}
        <div
          className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.35) 100%)' }}
        />

        {/* Favorit-Button – oben rechts */}
        {onFavoriteToggle && (
          <button
            onClick={(e) => { e.stopPropagation(); onFavoriteToggle() }}
            aria-label={isFavorite ? 'Aus Favoriten entfernen' : 'Favorit hinzufügen'}
            className={cn(
              'absolute top-2.5 right-2.5 w-7 h-7 flex items-center justify-center rounded-full',
              'transition-all duration-200 hover:scale-110 active:scale-95',
              isFavorite
                ? 'bg-[#E84541] shadow-[0_2px_8px_rgba(232,69,65,0.45)]'
                : 'bg-black/45 border border-white/20'
            )}
          >
            {isFavorite
              ? <FavoriteIcon sx={{ fontSize: 13, color: 'white' }} />
              : <FavoriteBorderIcon sx={{ fontSize: 13, color: 'white' }} />
            }
          </button>
        )}

        {/* Rating – unten links im Bild */}
        {rating !== undefined && (
          <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1">
            <StarIcon sx={{ fontSize: 11, color: '#F5A623' }} />
            <span
              className="text-[12px] font-bold text-white leading-none"
              style={{
                fontFamily: 'var(--typography-fontfamily-barlow, Barlow, sans-serif)',
                letterSpacing: '-0.01em',
                textShadow: '0 1px 3px rgba(0,0,0,0.6)',
              }}
            >
              {rating.toFixed(1)}
            </span>
          </div>
        )}
      </div>

      {/* ── Info-Bereich (weißer Bereich) ───────────────────────────────── */}
      <div className="px-3 pt-2.5 pb-3 flex flex-col gap-1.5">

        {/* Kategorie-Tag */}
        <span
          className="self-start inline-flex items-center px-2 py-0.5 rounded-[5px] text-[10px] font-bold uppercase tracking-[0.07em] leading-none"
          style={{
            fontFamily: 'var(--typography-fontfamily-sans)',
            background: '#F0F3F7',
            color: '#5A6672',
            border: '1px solid #E4E8ED',
          }}
        >
          {category}
        </span>

        {/* Name */}
        <p
          className="text-[13px] font-semibold leading-snug text-[#1A2026] truncate"
          style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
        >
          {name}
        </p>

        {/* Preis */}
        {priceRange && (
          <div className="flex items-center gap-1 mt-0.5">
            <BoltIcon sx={{ fontSize: 11, color: '#E84541' }} className="flex-shrink-0" />
            <span
              className="text-[12px] font-bold text-[#E84541] leading-none tabular-nums"
              style={{
                fontFamily: 'var(--typography-fontfamily-barlow, Barlow, sans-serif)',
                letterSpacing: '-0.02em',
              }}
            >
              {priceRange}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
