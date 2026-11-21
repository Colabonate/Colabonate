/**
 * Shared OpenLayers base-layer factory (ADR-406 D2 / FU-919).
 *
 * Lives outside the map components so both the marketplace map and the
 * location picker share one tile seam without pulling in each other.
 *
 * OSM standard tiles are the free, key-less default. Setting
 * `VITE_MAP_TILE_URL` (an XYZ template like `https://host/{z}/{x}/{y}.png`)
 * swaps the provider without touching any component; optional
 * `VITE_MAP_TILE_ATTRIBUTION` and `VITE_MAP_TILE_MAX_ZOOM` accompany it.
 */

import TileLayer from 'ol/layer/Tile.js'
import OSM from 'ol/source/OSM.js'
import XYZ from 'ol/source/XYZ.js'

const TILE_URL = (import.meta.env.VITE_MAP_TILE_URL as string | undefined)?.trim() || ''
const TILE_ATTRIBUTION = (import.meta.env.VITE_MAP_TILE_ATTRIBUTION as string | undefined)?.trim()

export const TILE_MAX_ZOOM = Number(import.meta.env.VITE_MAP_TILE_MAX_ZOOM) || 19

export function tileClassName(isDark: boolean) {
  // `ol-layer` must be preserved: OL uses the `className` option as a
  // replacement for its default layer class.
  return isDark ? 'ol-layer col-map-tiles col-map-tiles--dark' : 'ol-layer col-map-tiles'
}

export function createBaseLayer(isDark: boolean) {
  const source = TILE_URL
    ? new XYZ({
        url: TILE_URL,
        attributions: TILE_ATTRIBUTION || '© OpenStreetMap contributors',
        maxZoom: TILE_MAX_ZOOM,
      })
    : new OSM({ maxZoom: Math.min(TILE_MAX_ZOOM, 19) })
  return new TileLayer({ className: tileClassName(isDark), source })
}
