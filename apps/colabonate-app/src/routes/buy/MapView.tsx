/**
 * MapView — OpenLayers map for the marketplace map page (ADR-406).
 *
 * - Renderer: OpenLayers (`ol`) with OSM standard raster tiles (free service,
 *   attribution required). The tile host is a one-line seam: set
 *   `VITE_MAP_TILE_URL` (+ optional `VITE_MAP_TILE_ATTRIBUTION` /
 *   `VITE_MAP_TILE_MAX_ZOOM`) to swap the provider without touching this
 *   component (D2 / FU-919).
 * - Markers are viewport-driven (`markers` prop) and clustered via
 *   `ol/source/Cluster` (D7).
 * - Popups use a single reusable `ol/Overlay` whose DOM node renders React
 *   content.
 * - Geolocation is explicit (a "locate" button), never on mount (D8).
 * - A ResizeObserver + `fullscreenchange` keep OL's size in sync (D4); the
 *   current viewport is reported through `onViewportChange` (D6).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import OlMap from 'ol/Map.js'
import View from 'ol/View.js'
import TileLayer from 'ol/layer/Tile.js'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import Cluster from 'ol/source/Cluster.js'
import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import Overlay from 'ol/Overlay.js'
import { fromLonLat, transformExtent } from 'ol/proj.js'
import { defaults as defaultControls } from 'ol/control/defaults.js'
import { Circle as CircleStyle, Fill, Stroke, Style, Text as TextStyle } from 'ol/style.js'
import 'ol/ol.css'
import type { FeatureLike } from 'ol/Feature.js'
import { Box, Button, IconButton, Paper, Typography } from '@mui/material'
import { Close as CloseIcon, MyLocation as MyLocationIcon } from '@mui/icons-material'
import { SatsAmount } from '../../components/currency/SatsAmount'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { createBaseLayer, TILE_MAX_ZOOM } from '../../components/map/base-layer'
import type { MapBbox, MapMarker } from '../../types/map'

// Brand colors (mirror of --color-action-secondary-default / --color-primary-50)
const COLOR_OFFER = '#21E168'
const COLOR_COMPANY = '#E84541'
const COLOR_USER = '#4A90E2'

// Centered on Europe as the neutral default before any marker fit.
const DEFAULT_CENTER: [number, number] = [10.5, 48.5]

interface Selection {
  id: string
  kind: 'offer' | 'company'
  title: string
  subtitle?: string
  priceSats?: number
  href: string
}

export interface MapViewProps {
  markers: MapMarker[]
  isDark?: boolean
  /** Reports the current viewport (EPSG:4326 bbox) after moves/resizes. */
  onViewportChange?: (bbox: MapBbox) => void
}

// Tile seam (createBaseLayer / TILE_MAX_ZOOM) lives in
// `components/map/base-layer.ts` so the location picker shares it (FU-916/919).

const offerStyle = new Style({
  image: new CircleStyle({
    radius: 7,
    fill: new Fill({ color: COLOR_OFFER }),
    stroke: new Stroke({ color: '#ffffff', width: 2.5 }),
  }),
})

const companyStyle = new Style({
  image: new CircleStyle({
    radius: 9,
    fill: new Fill({ color: COLOR_COMPANY }),
    stroke: new Stroke({ color: '#ffffff', width: 3 }),
  }),
})

const userStyle = new Style({
  image: new CircleStyle({
    radius: 8,
    fill: new Fill({ color: COLOR_USER }),
    stroke: new Stroke({ color: '#ffffff', width: 3 }),
  }),
})

function clusterStyle(count: number) {
  return new Style({
    image: new CircleStyle({
      radius: 15,
      fill: new Fill({ color: 'rgba(232,69,65,0.92)' }),
      stroke: new Stroke({ color: '#ffffff', width: 3 }),
    }),
    text: new TextStyle({
      text: String(count),
      fill: new Fill({ color: '#ffffff' }),
      font: '700 12px system-ui, sans-serif',
    }),
  })
}

function markerStyle(feature: FeatureLike): Style {
  const clustered = feature.get('features') as Feature[] | undefined
  if (clustered && clustered.length > 1) return clusterStyle(clustered.length)
  const single = clustered && clustered.length === 1 ? clustered[0] : (feature as Feature)
  return single.get('kind') === 'company' ? companyStyle : offerStyle
}

// Scoped CSS for OL controls + the dark tile approximation (ADR-406 D2/Consequences).
const MAP_CSS = `
  .col-map-tiles--dark {
    filter: invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.92) saturate(0.65);
  }
  /* The map owns pan/pinch; Lenis is structurally opted out (data-lenis-prevent). */
  .col-map, .col-map .ol-viewport { touch-action: none; }
  .col-map-popup { z-index: 6; }
  .col-map-popup--hidden { display: none; }
  .ol-control button {
    background: var(--theme-surface, #ffffff);
    color: var(--theme-text, #2c3a4b);
    border: 1px solid var(--theme-border, #ebbef2);
  }
  .ol-control button:hover { background: var(--color-neutral-9, #f4f6f9); }
  /* Bottom-left: the top-left corner is used by the page's KPI chips overlay. */
  .ol-zoom { top: auto; bottom: 44px; left: 12px; }
  .ol-attribution { font-size: 10px; }
  .ol-attribution ul { color: var(--theme-text-muted, #858c94); }
  .ol-attribution a { color: var(--color-primary-50, #e84541); }
`

export function MapView({ markers, isDark = false, onViewportChange }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapElRef = useRef<HTMLDivElement | null>(null)
  const popupElRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<OlMap | null>(null)
  const tileLayerRef = useRef<TileLayer | null>(null)
  const overlayRef = useRef<Overlay | null>(null)
  const markerSourceRef = useRef<VectorSource | null>(null)
  const userSourceRef = useRef<VectorSource | null>(null)
  const hasFittedRef = useRef(false)
  const darkRef = useRef(isDark)
  const viewportCbRef = useRef(onViewportChange)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [locateFailed, setLocateFailed] = useState(false)
  const [tileErrors, setTileErrors] = useState(false)
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    viewportCbRef.current = onViewportChange
  }, [onViewportChange])

  const closePopup = useCallback(() => {
    setSelection(null)
    overlayRef.current?.setPosition(undefined)
  }, [])

  // ── Map lifecycle (once) ───────────────────────────────────────────────────
  useEffect(() => {
    const target = mapElRef.current
    const popupEl = popupElRef.current
    if (!target || !popupEl) return

    const markerSource = new VectorSource()
    markerSourceRef.current = markerSource
    const clusterSource = new Cluster({ distance: 44, source: markerSource })
    const markerLayer = new VectorLayer({ source: clusterSource, style: markerStyle })
    const userSource = new VectorSource()
    userSourceRef.current = userSource
    const userLayer = new VectorLayer({ source: userSource, style: userStyle })

    const tileLayer = createBaseLayer(darkRef.current)
    tileLayerRef.current = tileLayer
    tileLayer.getSource()?.on('tileloaderror', () => setTileErrors(true))

    const overlay = new Overlay({
      element: popupEl,
      positioning: 'bottom-center',
      offset: [0, -16],
      stopEvent: true,
      autoPan: { animation: { duration: reducedMotion ? 0 : 250 } },
    })
    overlayRef.current = overlay
    overlay.setPosition(undefined)

    const map = new OlMap({
      target,
      layers: [tileLayer, userLayer, markerLayer],
      overlays: [overlay],
      // Attribution stays permanently expanded — OSM licence obligation (D2).
      controls: defaultControls({ attributionOptions: { collapsible: false } }),
      view: new View({ center: fromLonLat(DEFAULT_CENTER), zoom: 4, maxZoom: TILE_MAX_ZOOM }),
    })
    mapRef.current = map

    const emitViewport = () => {
      const size = map.getSize()
      if (!size || !size[0] || !size[1]) return
      const [minLng, minLat, maxLng, maxLat] = transformExtent(
        map.getView().calculateExtent(size),
        'EPSG:3857',
        'EPSG:4326',
      )
      viewportCbRef.current?.([minLng, minLat, maxLng, maxLat])
    }

    map.on('singleclick', (evt) => {
      const hit = map.forEachFeatureAtPixel(evt.pixel, (feature) => feature, { hitTolerance: 6 })
      if (!hit) {
        closePopup()
        return
      }
      const clustered = hit.get('features') as Feature[] | undefined
      if (clustered && clustered.length > 1) {
        const coords = clustered
          .map((f) => (f.getGeometry() as Point | undefined)?.getCoordinates())
          .filter((c): c is number[] => Array.isArray(c))
        if (coords.length > 0) {
          const lngs = coords.map((c) => c[0])
          const lats = coords.map((c) => c[1])
          map.getView().fit(
            [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
            { padding: [80, 80, 80, 80], maxZoom: 14, duration: reducedMotion ? 0 : 400 },
          )
        }
        closePopup()
        return
      }
      const single = clustered && clustered.length === 1 ? clustered[0] : hit
      const geometry = single.getGeometry() as Point | undefined
      if (!geometry) return
      setSelection({
        id: String(single.get('id') ?? ''),
        kind: single.get('kind') === 'company' ? 'company' : 'offer',
        title: String(single.get('title') ?? ''),
        subtitle: (single.get('subtitle') as string | undefined) || undefined,
        priceSats: single.get('priceSats') as number | undefined,
        href: String(single.get('href') ?? '/buy'),
      })
      overlay.setPosition(geometry.getCoordinates())
    })

    map.on('pointermove', (evt) => {
      const targetEl = map.getTargetElement()
      if (!targetEl) return
      targetEl.style.cursor = map.hasFeatureAtPixel(evt.pixel, { hitTolerance: 6 }) ? 'pointer' : ''
    })

    map.on('moveend', emitViewport)

    const resizeObserver = new ResizeObserver(() => {
      map.updateSize()
      emitViewport()
    })
    if (containerRef.current) resizeObserver.observe(containerRef.current)
    const handleFullscreen = () => map.updateSize()
    document.addEventListener('fullscreenchange', handleFullscreen)

    emitViewport()

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreen)
      resizeObserver.disconnect()
      map.setTarget(undefined)
      map.dispose()
      mapRef.current = null
      overlayRef.current = null
      tileLayerRef.current = null
      markerSourceRef.current = null
      userSourceRef.current = null
    }
  }, [closePopup, reducedMotion])

  // ── Marker sync (viewport-driven markers prop) ─────────────────────────────
  useEffect(() => {
    const source = markerSourceRef.current
    if (!source) return
    const features = markers.map(
      (m) =>
        new Feature({
          geometry: new Point(fromLonLat([m.lng, m.lat])),
          kind: m.kind,
          id: m.id,
          title: m.title,
          subtitle: m.subtitle,
          priceSats: m.priceSats,
          href: m.href,
        }),
    )
    source.clear()
    source.addFeatures(features)

    const map = mapRef.current
    if (map && features.length > 0 && !hasFittedRef.current) {
      hasFittedRef.current = true
      const extent = source.getExtent()
      if (extent && Number.isFinite(extent[0])) {
        map.getView().fit(extent, { padding: [64, 64, 64, 64], maxZoom: 12, duration: reducedMotion ? 0 : 600 })
      }
    }
  }, [markers, reducedMotion])

  // ── Theme ──────────────────────────────────────────────────────────────────
  // `ol` exposes no runtime `setClassName` on layers, so the base layer is
  // swapped (dark tiles are a CSS-filter approximation — ADR-406 D2).
  useEffect(() => {
    const map = mapRef.current
    if (!map || darkRef.current === isDark) return
    darkRef.current = isDark
    const previous = tileLayerRef.current
    if (previous) map.removeLayer(previous)
    const next = createBaseLayer(isDark)
    tileLayerRef.current = next
    next.getSource()?.on('tileloaderror', () => setTileErrors(true))
    map.getLayers().insertAt(0, next)
  }, [isDark])

  // ── Explicit geolocation (ADR-406 D8) ──────────────────────────────────────
  const handleLocate = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setLocateFailed(true)
      return
    }
    setLocateFailed(false)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const coord = fromLonLat([coords.longitude, coords.latitude])
        const source = userSourceRef.current
        source?.clear()
        source?.addFeature(new Feature({ geometry: new Point(coord) }))
        mapRef.current?.getView().animate({ center: coord, zoom: 12, duration: reducedMotion ? 0 : 700 })
      },
      () => setLocateFailed(true),
      { timeout: 6000, maximumAge: 60_000 },
    )
  }, [reducedMotion])

  const popupBody = useMemo(() => {
    if (!selection) return null
    return (
      <Paper elevation={3} sx={{ position: 'relative', p: 1.5, pr: 3.5, minWidth: 180, maxWidth: 250, borderRadius: 2 }}>
        <IconButton
          size="small"
          onClick={closePopup}
          aria-label="Close"
          sx={{ position: 'absolute', top: 2, right: 2, p: 0.25 }}
        >
          <CloseIcon sx={{ fontSize: 15 }} />
        </IconButton>
        <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3, mb: 0.25 }}>
          {selection.title}
        </Typography>
        {selection.subtitle && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            {selection.subtitle}
          </Typography>
        )}
        {selection.priceSats != null && (
          <Box sx={{ mb: 0.75 }}>
            <SatsAmount sats={selection.priceSats} size="sm" />
          </Box>
        )}
        <Button
          component={Link}
          to={selection.href}
          size="small"
          variant="text"
          sx={{ p: 0, minWidth: 0, fontSize: 12, fontWeight: 600 }}
        >
          {selection.kind === 'company' ? 'View Vendor' : 'View Offer'} →
        </Button>
      </Paper>
    )
  }, [closePopup, selection])

  // Screen-reader announcement of the current marker count (ADR-406 D8 / FU-922).
  const announcement = markers.length === 0
    ? 'No offers or vendors in this map view'
    : `${markers.length} offers or vendors in this map view`

  return (
    <div
      ref={containerRef}
      className="col-map"
      data-lenis-prevent=""
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: isDark ? '#10161c' : '#eef1f4',
      }}
    >
      <style>{MAP_CSS}</style>

      <div ref={mapElRef} style={{ position: 'absolute', inset: 0 }} />

      {/* OL overlay anchor — React renders the popup content inside it. */}
      <div ref={popupElRef} className={selection ? 'col-map-popup' : 'col-map-popup col-map-popup--hidden'}>
        {popupBody}
      </div>

      <div
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {announcement}
      </div>

      {tileErrors && (
        <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 5 }}>
          <Paper elevation={2} sx={{ px: 1.5, py: 0.75, borderRadius: 1.5 }}>
            <Typography variant="caption" color="text.secondary">Map tiles unavailable</Typography>
          </Paper>
        </div>
      )}

      {/* Explicit locate control (never a permission prompt on mount). */}
      <div
        style={{
          position: 'absolute',
          right: 12,
          bottom: 40,
          zIndex: 5,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 6,
        }}
      >
        {locateFailed && (
          <Typography
            variant="caption"
            sx={{
              bgcolor: 'var(--theme-surface, #fff)',
              color: 'text.secondary',
              px: 1,
              py: 0.5,
              borderRadius: 1,
              boxShadow: 1,
            }}
          >
            Location unavailable
          </Typography>
        )}
        <IconButton
          onClick={handleLocate}
          aria-label="Show my location"
          sx={{
            bgcolor: 'var(--theme-surface, #fff)',
            border: '1px solid var(--theme-border, #ebbef2)',
            boxShadow: 1,
            '&:hover': { bgcolor: 'var(--color-neutral-9, #f4f6f9)' },
          }}
        >
          <MyLocationIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </div>
    </div>
  )
}
