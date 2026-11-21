import { MapPin } from 'lucide-react'
import { COUNTRIES } from '../../../components/offers/offerFormConstants'
import type { SearchFacets } from '../../../hooks/useOfferSearch'

export interface LocationOption {
  code: string
  /** Server facet count. Absent in the loaded-rows fallback (no counts known). */
  count?: number
}

function countryName(code: string): string {
  return COUNTRIES.find(x => x.code === code)?.name ?? code
}

// ADR-418 D4: options come from the server facet, never from loaded rows.
// - facet present: every facet key, count desc then name asc.
// - stale selection missing from the facet: kept visible with count 0 so it
//   can be deselected (an active selection is never dropped silently).
// - no facet (request failed or not yet asked): the caller's loaded-rows list.
export function buildLocationOptions(
  facet: SearchFacets | undefined,
  allCountries: string[],
  countryFilter: string,
): LocationOption[] {
  if (!facet) return allCountries.map(code => ({ code }))
  const counts = new Map<string, number>(Object.entries(facet.country))
  if (countryFilter && !counts.has(countryFilter)) counts.set(countryFilter, 0)
  return Array.from(counts, ([code, count]) => ({ code, count })).sort(
    (a, b) => (b.count ?? 0) - (a.count ?? 0) || countryName(a.code).localeCompare(countryName(b.code)),
  )
}

const SKELETON_ROWS = 3

export function LocationsFilterPanel({
  countryFilter,
  onCountryChange,
  allCountries,
  facet,
  loading = false,
}: {
  countryFilter: string
  onCountryChange: (country: string) => void
  /** Fallback option list (loaded-rows derivation) used when no facet is available. */
  allCountries: string[]
  /** ADR-418: server-side country facet (disjunctive, country filter excluded). */
  facet?: SearchFacets
  /** True while the first facet response is pending. */
  loading?: boolean
}) {
  const options = buildLocationOptions(facet, allCountries, countryFilter)
  const showSkeleton = !facet && loading

  return (
    <div className="shrink-0">
      <div className="flex items-center gap-1.5 px-0.5 mb-1">
        <MapPin size={10} style={{ color: 'var(--theme-text-muted)' }} />
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)' }}>
          Location
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <button
          onClick={() => onCountryChange('')}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] cursor-pointer transition-all duration-150 text-left"
          style={{
            background: countryFilter === '' ? 'rgba(99,179,237,0.12)' : 'var(--theme-bg-subtle)',
            border: countryFilter === '' ? '1px solid rgba(99,179,237,0.30)' : '1px solid var(--theme-border)',
            color: countryFilter === '' ? 'var(--color-primary-50)' : 'var(--theme-text)',
            fontWeight: countryFilter === '' ? 600 : 400,
          }}
        >
          <span className="text-[12px]">All countries</span>
        </button>
        {/* Max 4 country rows visible; the rest scroll inside this container
            (row = text-[11px] line + py-1 + border ≈ 34px → 4×34 + 3×2 = 142px).
            Mouse wheel is contained here instead of chaining to the page scroll.
            data-lenis-prevent keeps Lenis from hijacking the wheel event. */}
        <div
          className="flex flex-col gap-0.5 overflow-y-auto"
          data-lenis-prevent=""
          aria-busy={showSkeleton || undefined}
          style={{
            maxHeight: 142,
            scrollbarWidth: 'thin',
            scrollbarColor: 'var(--theme-border) transparent',
            overscrollBehavior: 'contain',
          }}
        >
          {showSkeleton
            ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
                // Same box model as an option row: the inner h-4 span is the
                // leading-4 line, so row height matches exactly.
                <div
                  key={`skeleton-${i}`}
                  aria-hidden="true"
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] leading-4 animate-pulse"
                  style={{ background: 'var(--theme-bg-subtle)', border: '1px solid var(--theme-border)' }}
                >
                  <span className="flex items-center h-4 w-3/5">
                    <span className="block h-2 w-full rounded-sm" style={{ background: 'var(--theme-border)' }} />
                  </span>
                </div>
              ))
            : options.map(({ code, count }) => {
                const selected = countryFilter === code
                return (
                  <button
                    key={code}
                    onClick={() => onCountryChange(selected ? '' : code)}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] leading-4 cursor-pointer transition-all duration-150 text-left"
                    style={{
                      background: selected ? 'rgba(99,179,237,0.12)' : 'var(--theme-bg-subtle)',
                      border: selected ? '1px solid rgba(99,179,237,0.30)' : '1px solid var(--theme-border)',
                      color: selected ? 'var(--color-primary-50)' : 'var(--theme-text)',
                      fontWeight: selected ? 600 : 400,
                    }}
                  >
                    <MapPin size={9} style={{ flexShrink: 0, opacity: selected ? 1 : 0.5 }} />
                    <span className="truncate min-w-0 flex-1">{countryName(code)}</span>
                    {count !== undefined && (
                      <span
                        className="shrink-0 text-[10px] tabular-nums"
                        style={{ color: 'var(--theme-text-muted)' }}
                      >
                        {count.toLocaleString()}
                      </span>
                    )}
                  </button>
                )
              })}
        </div>
        {/* ADR-418 D4: non-selectable. Explains the offers that a country filter excludes. */}
        {facet && facet.countryless > 0 && (
          <div className="px-2 pt-1" style={{ color: 'var(--theme-text-muted)' }}>
            <p className="text-[11px] leading-4">No location ({facet.countryless.toLocaleString()})</p>
            <p className="text-[10px] leading-4">Excluded when a country is selected.</p>
          </div>
        )}
      </div>
    </div>
  )
}
