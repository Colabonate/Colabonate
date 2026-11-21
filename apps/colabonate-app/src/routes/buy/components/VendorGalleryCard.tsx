import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { gsap } from 'gsap'
import { Store, MapPin, Layers } from 'lucide-react'
import { formatCompactDate } from '@ds/utils'
import { useVendorPrefetchHandlers } from '../../../hooks/useEntityQueries'
import type { Company } from '../../../types/api'

export type VendorCardSize = 'S' | 'M' | 'L'

const VENDOR_CARD_SIZE_CONFIG: Record<VendorCardSize, {
  imgH: number
  titleFs: number
  metaFs: number
  descFs: number
  px: number
  py: number
  logoSize: number
}> = {
  S: { imgH: 90, titleFs: 12, metaFs: 9, descFs: 10, px: 10, py: 10, logoSize: 40 },
  M: { imgH: 120, titleFs: 15, metaFs: 10, descFs: 11, px: 14, py: 12, logoSize: 52 },
  L: { imgH: 160, titleFs: 17, metaFs: 11, descFs: 12, px: 18, py: 14, logoSize: 64 },
}

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
  return <img src={src} alt={alt} className={className} loading="lazy" onError={() => setFailed(true)} />
}

export function VendorGalleryCard({
  company,
  size = 'M',
  offerCount,
}: {
  company: Company
  size: VendorCardSize
  offerCount?: number
}) {
  const cfg = VENDOR_CARD_SIZE_CONFIG[size]
  // ADR-385: compact creation date on the browse cards (grid + list).
  const createdLabel = formatCompactDate(company.createdAt)
  const bannerSrc = company.bannerUrl || (company.images && company.images.length > 0 ? company.images[0] : null)
  const prefetchHandlers = useVendorPrefetchHandlers(company.ownerPubkey)
  const cardRef = useRef<HTMLAnchorElement>(null)
  const prefersReducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )

  function handlePressStart() {
    if (prefersReducedMotion || !cardRef.current) return
    gsap.to(cardRef.current, {
      scale: 0.98,
      duration: 0.12,
      ease: 'power2.out',
    })
  }

  function handlePressEnd() {
    if (prefersReducedMotion || !cardRef.current) return
    gsap.to(cardRef.current, {
      scale: 1,
      duration: 0.2,
      ease: 'power2.out',
    })
  }

  return (
    <Link
      ref={cardRef}
      to={`/buy/vendors/${company.ownerPubkey}`}
      {...prefetchHandlers}
      onMouseDown={handlePressStart}
      onMouseUp={handlePressEnd}
      onMouseLeave={handlePressEnd}
      onTouchStart={handlePressStart}
      onTouchEnd={handlePressEnd}
      className="flex flex-col no-underline cursor-pointer rounded-xl overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all duration-300 ease-out hover:z-10 hover:-translate-y-1 hover:shadow-[0_12px_32px_rgba(0,0,0,0.18)] active:scale-[0.99] h-full relative"
      style={{
        background: 'var(--theme-surface)',
        border: '1px solid var(--theme-border)',
      }}
    >
      {/* Banner */}
      <div
        className="relative flex items-center justify-center overflow-hidden"
        style={{ height: cfg.imgH, background: 'var(--theme-bg-subtle)' }}
      >
        {bannerSrc ? (
          <ImageWithFallback
            src={bannerSrc}
            alt={company.name}
            className="object-cover w-full h-full"
            fallback={
              <span style={{ fontSize: cfg.imgH * 0.3, fontWeight: 700, color: 'var(--theme-text-muted)', lineHeight: 1 }}>
                {company.name.charAt(0).toUpperCase()}
              </span>
            }
          />
        ) : (
          <Store size={cfg.imgH * 0.35} style={{ color: 'var(--theme-text-muted)', opacity: 0.5 }} />
        )}

        {/* Logo overlay */}
        <div
          className="absolute flex items-center justify-center overflow-hidden rounded-lg border-2 shadow-sm"
          style={{
            width: cfg.logoSize,
            height: cfg.logoSize,
            left: cfg.px,
            bottom: -cfg.logoSize / 2,
            background: 'var(--theme-surface)',
            borderColor: 'var(--theme-border)',
            zIndex: 2,
          }}
        >
          {company.logoUrl ? (
            <img src={company.logoUrl} alt="" className="object-cover w-full h-full" loading="lazy" />
          ) : (
            <Store size={cfg.logoSize * 0.4} style={{ color: 'var(--theme-text-muted)' }} />
          )}
        </div>
      </div>

      {/* Content */}
      <div
        className="flex flex-col flex-1"
        style={{ paddingTop: cfg.logoSize / 2 + 8, paddingBottom: cfg.py, paddingLeft: cfg.px, paddingRight: cfg.px }}
      >
        <div
          className="mb-1"
          style={{
            fontSize: cfg.titleFs,
            fontWeight: 700,
            lineHeight: 1.35,
            color: 'var(--theme-text)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {company.name}
        </div>

        {createdLabel && (
          <div className="mb-1 truncate" style={{ fontSize: cfg.metaFs, color: 'var(--theme-text-muted)' }}>
            Created {createdLabel}
          </div>
        )}

        {(company.city || company.country) && (
          <div
            className="flex items-center gap-1 mb-2"
            style={{ fontSize: cfg.metaFs, color: 'var(--theme-text-muted)' }}
          >
            <MapPin size={cfg.metaFs + 1} />
            <span className="truncate">
              {company.city}{company.city && company.country ? ', ' : ''}{company.country}
            </span>
          </div>
        )}

        {company.description && (
          <div
            className="mb-3"
            style={{
              fontSize: cfg.descFs,
              lineHeight: 1.5,
              color: 'var(--theme-text-muted)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {company.description}
          </div>
        )}

        <div className="flex items-center gap-2 mt-auto flex-wrap">
          {(company.catalogs?.length ?? 0) > 0 && (
            <span
              className="inline-flex items-center gap-1"
              style={{
                padding: '3px 8px',
                borderRadius: 6,
                background: 'rgba(99,179,237,0.10)',
                fontSize: cfg.metaFs,
                fontWeight: 600,
                color: 'var(--color-primary-50)',
              }}
            >
              <Layers size={cfg.metaFs + 1} />
              {company.catalogs!.length} catalog{company.catalogs!.length !== 1 ? 's' : ''}
            </span>
          )}
          {offerCount !== undefined && offerCount > 0 && (
            <span
              className="inline-flex items-center gap-1"
              style={{
                padding: '3px 8px',
                borderRadius: 6,
                background: 'rgba(72,187,120,0.10)',
                fontSize: cfg.metaFs,
                fontWeight: 600,
                color: 'var(--color-status-success)',
              }}
            >
              {offerCount} offer{offerCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
