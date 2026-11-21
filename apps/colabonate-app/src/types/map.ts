/**
 * Shared map types (ADR-406).
 *
 * Lives outside the lazy MapView module so the viewport hook and the page can
 * import the types without pulling OpenLayers into the initial bundle.
 */

/** Marker discriminator — mirrors the `kind` of GET /api/map/markers. */
export type MapMarkerKind = 'offer' | 'company'

/** Filter selector for the marker source. */
export type MapKind = 'all' | 'offers' | 'vendors'

/** Viewport bounding box: [minLng, minLat, maxLng, maxLat] (EPSG:4326). */
export type MapBbox = [number, number, number, number]

export interface MapMarker {
  id: string
  kind: MapMarkerKind
  lat: number
  lng: number
  title: string
  subtitle?: string
  priceSats?: number
  /** Offer-only: OfferType (PRODUCT / SERVICE / …) for list iconography. */
  offerType?: string
  href: string
}

export interface MapMarkersResponse {
  markers: MapMarker[]
  count: number
  truncated: boolean
}
