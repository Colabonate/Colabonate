import { Link } from 'react-router-dom'
import { Store, MapPin, Layers, ChevronRight } from 'lucide-react'
import { formatCompactDate } from '@ds/utils'
import { useVendorPrefetchHandlers } from '../../../hooks/useEntityQueries'
import { useBreakpoint } from '../../../hooks/useBreakpoint'
import type { Company } from '../../../types/api'

export type VendorCardSize = 'S' | 'M' | 'L'

const VENDOR_ROW_SIZE_CONFIG: Record<VendorCardSize, {
  rowH: number
  thumbW: number
  titleFs: number
  metaFs: number
  px: number
  py: number
  gap: number
}> = {
  S: { rowH: 72, thumbW: 72, titleFs: 13, metaFs: 10, px: 12, py: 10, gap: 10 },
  M: { rowH: 92, thumbW: 92, titleFs: 15, metaFs: 11, px: 16, py: 12, gap: 14 },
  L: { rowH: 112, thumbW: 112, titleFs: 17, metaFs: 12, px: 20, py: 16, gap: 18 },
}

const VENDOR_MOBILE_SIZE_CONFIG: Record<VendorCardSize, {
  rowH: number
  thumbW: number
  titleFs: number
  metaFs: number
  px: number
  py: number
  gap: number
}> = {
  S: { rowH: 52, thumbW: 48, titleFs: 12, metaFs: 9,  px: 8,  py: 6,  gap: 6 },
  M: { rowH: 64, thumbW: 60, titleFs: 13, metaFs: 10, px: 10, py: 8,  gap: 8 },
  L: { rowH: 76, thumbW: 72, titleFs: 14, metaFs: 11, px: 12, py: 10, gap: 10 },
}

export function VendorListRow({
  company,
  size = 'M',
  offerCount,
}: {
  company: Company
  size: VendorCardSize
  offerCount?: number
}) {
  const { isMobile } = useBreakpoint()
  const cfg = isMobile ? VENDOR_MOBILE_SIZE_CONFIG[size] : VENDOR_ROW_SIZE_CONFIG[size]
  // ADR-385: compact creation date on the browse cards (grid + list).
  const createdLabel = formatCompactDate(company.createdAt)
  const prefetchHandlers = useVendorPrefetchHandlers(company.ownerPubkey)

  return (
    <Link
      to={`/buy/vendors/${company.ownerPubkey}`}
      {...prefetchHandlers}
      className={`flex ${isMobile ? 'flex-row items-stretch' : 'items-stretch'} no-underline cursor-pointer rounded-xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.06),0_4px_12px_rgba(0,0,0,0.06)] transition-all duration-300 ease-out hover:z-10 hover:-translate-y-1 hover:shadow-[0_8px_24px_rgba(0,0,0,0.18)] active:scale-[0.99] relative`}
      style={{
        background: 'var(--theme-surface)',
        outline: '1px solid var(--theme-border)',
        paddingTop: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        paddingRight: isMobile ? 0 : `${cfg.px}px`,
        gap: isMobile ? 0 : `${cfg.gap}px`,
        minHeight: cfg.rowH,
      }}
    >
      {/* Column 1: Logo / Thumbnail (left) */}
      <div
        className="flex items-center justify-center overflow-hidden shrink-0 self-stretch"
        style={{ width: cfg.thumbW, background: 'var(--theme-bg-subtle)' }}
      >
        {company.logoUrl ? (
          <img src={company.logoUrl} alt="" className="object-cover w-full h-full" loading="lazy" />
        ) : (
          <Store size={cfg.thumbW * 0.4} style={{ color: 'var(--theme-text-muted)', opacity: 0.6 }} />
        )}
      </div>

      {/* Column 2: Content (right) */}
      <div className="flex flex-col flex-1 min-w-0 justify-center" style={{ padding: isMobile ? `${cfg.py}px ${cfg.px}px` : `${cfg.py}px 0` }}>
        <div
          style={{
            fontSize: cfg.titleFs,
            fontWeight: 700,
            lineHeight: 1.3,
            color: 'var(--theme-text)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {company.name}
        </div>

        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {createdLabel && (
            <span style={{ fontSize: cfg.metaFs, color: 'var(--theme-text-muted)' }}>
              Created {createdLabel}
            </span>
          )}
          {(company.city || company.country) && (
            <span
              className="inline-flex items-center gap-0.5"
              style={{ fontSize: cfg.metaFs, color: 'var(--theme-text-muted)' }}
            >
              <MapPin size={cfg.metaFs + 1} />
              <span className="truncate">
                {company.city}{company.city && company.country ? ', ' : ''}{company.country}
              </span>
            </span>
          )}
          {(company.catalogs?.length ?? 0) > 0 && (
            <span
              className="inline-flex items-center gap-0.5"
              style={{ fontSize: cfg.metaFs, color: 'var(--color-primary-50)' }}
            >
              <Layers size={cfg.metaFs + 1} />
              {company.catalogs!.length} catalog{company.catalogs!.length !== 1 ? 's' : ''}
            </span>
          )}
          {offerCount !== undefined && offerCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5"
              style={{ fontSize: cfg.metaFs, color: 'var(--color-status-success)' }}
            >
              {offerCount} offer{offerCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {company.description && (
          <div
            className="mt-0.5"
            style={{
              fontSize: cfg.metaFs,
              color: 'var(--theme-text-muted)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {company.description}
          </div>
        )}
      </div>

      {!isMobile && <ChevronRight size={16} style={{ color: 'var(--theme-text-muted)', flexShrink: 0, alignSelf: 'center' }} />}
    </Link>
  )
}
