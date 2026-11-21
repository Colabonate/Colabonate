import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiCall } from '../lib/api'
import type { MapBbox, MapKind, MapMarkersResponse } from '../types/map'

const POLL_INTERVAL = Number(import.meta.env.VITE_POLL_INTERVAL_MS) || 30_000

export interface MapMarkerParams {
  /** Current viewport; the request is skipped until a bbox is known. */
  bbox: MapBbox | null
  kind?: MapKind
  offerType?: string
  categoryCode?: string
  country?: string
  q?: string
}

/**
 * Viewport-driven marker source for the marketplace map (ADR-406 D6 / FU-913).
 * Replaces the old load-everything `useMapOffers`; keeps previous markers while
 * a new extent loads so the map never flashes empty.
 */
export function useMapMarkers(params: MapMarkerParams) {
  const { bbox, kind = 'all', offerType, categoryCode, country, q } = params
  const bboxKey = bbox ? bbox.map((n) => n.toFixed(4)).join(',') : ''

  return useQuery({
    queryKey: ['map-markers', bboxKey, kind, offerType ?? '', categoryCode ?? '', country ?? '', q ?? ''],
    queryFn: async (): Promise<MapMarkersResponse> => {
      const search = new URLSearchParams()
      if (bbox) search.set('bbox', bbox.map((n) => n.toFixed(5)).join(','))
      search.set('kind', kind)
      if (offerType) search.set('offerType', offerType)
      if (categoryCode) search.set('categoryCode', categoryCode)
      if (country) search.set('country', country)
      if (q) search.set('q', q)
      const res = await apiCall(`/api/map/markers?${search.toString()}`)
      const json = await res.json()
      return {
        markers: json.markers ?? [],
        count: json.count ?? 0,
        truncated: Boolean(json.truncated),
      }
    },
    enabled: Boolean(bbox),
    staleTime: POLL_INTERVAL,
    refetchInterval: POLL_INTERVAL,
    placeholderData: keepPreviousData,
  })
}
