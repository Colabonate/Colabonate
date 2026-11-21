/**
 * LocationPicker — compact OpenLayers map for choosing an exact point
 * (ADR-406 FU-916). Reuses the shared tile seam (`base-layer.ts`).
 *
 * Interaction: click the map to place/move the pin, "use my location" to jump
 * to the browser position, and clear to remove the pin. Controlled via
 * `lat`/`lng`; calls `onChange(null)` to clear.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import OlMap from 'ol/Map.js'
import View from 'ol/View.js'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import { fromLonLat, toLonLat } from 'ol/proj.js'
import { defaults as defaultControls } from 'ol/control/defaults.js'
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style.js'
import 'ol/ol.css'
import { Box, IconButton, Stack, Typography } from '@mui/material'
import { Close as CloseIcon, MyLocation as MyLocationIcon } from '@mui/icons-material'
import { createBaseLayer, TILE_MAX_ZOOM } from './base-layer'

const DEFAULT_CENTER: [number, number] = [10.5, 48.5]

const pinStyle = new Style({
  image: new CircleStyle({
    radius: 8,
    fill: new Fill({ color: '#E84541' }),
    stroke: new Stroke({ color: '#ffffff', width: 3 }),
  }),
})

export interface LocationPickerProps {
  lat: number | null
  lng: number | null
  onChange: (coords: { lat: number; lng: number } | null) => void
  isDark?: boolean
  height?: number
  helperText?: string
}

export function LocationPicker({ lat, lng, onChange, isDark = false, height = 240, helperText }: LocationPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const targetRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<OlMap | null>(null)
  const sourceRef = useRef<VectorSource | null>(null)
  const onChangeRef = useRef(onChange)
  const [locateFailed, setLocateFailed] = useState(false)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const target = targetRef.current
    if (!target) return
    const source = new VectorSource()
    sourceRef.current = source
    const layer = new VectorLayer({ source, style: pinStyle })
    const hasInitial = lat != null && lng != null
    const map = new OlMap({
      target,
      layers: [createBaseLayer(isDark), layer],
      controls: defaultControls({ attributionOptions: { collapsible: false } }),
      view: new View({
        center: fromLonLat(hasInitial ? [lng as number, lat as number] : DEFAULT_CENTER),
        zoom: hasInitial ? 13 : 4,
        maxZoom: TILE_MAX_ZOOM,
      }),
    })
    mapRef.current = map
    map.on('singleclick', (evt) => {
      const [nextLng, nextLat] = toLonLat(evt.coordinate)
      onChangeRef.current({ lat: nextLat, lng: nextLng })
    })
    const resizeObserver = new ResizeObserver(() => map.updateSize())
    if (containerRef.current) resizeObserver.observe(containerRef.current)
    return () => {
      resizeObserver.disconnect()
      map.setTarget(undefined)
      map.dispose()
      mapRef.current = null
      sourceRef.current = null
    }
    // Initial view/theme are intentionally read once; coords sync below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Move the pin when the controlled coords change (no recentring on edits).
  useEffect(() => {
    const source = sourceRef.current
    if (!source) return
    source.clear()
    if (lat != null && lng != null) {
      source.addFeature(new Feature({ geometry: new Point(fromLonLat([lng, lat])) }))
    }
  }, [lat, lng])

  const handleLocate = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setLocateFailed(true)
      return
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocateFailed(false)
        mapRef.current?.getView().animate({ center: fromLonLat([coords.longitude, coords.latitude]), zoom: 14, duration: 500 })
        onChangeRef.current({ lat: coords.latitude, lng: coords.longitude })
      },
      () => setLocateFailed(true),
      { timeout: 6000, maximumAge: 60_000 },
    )
  }, [])

  const hasPin = lat != null && lng != null

  return (
    <Box>
      <Box
        ref={containerRef}
        sx={{
          position: 'relative', width: '100%', height, borderRadius: 2, overflow: 'hidden',
          border: '1px solid var(--theme-border)', bgcolor: isDark ? '#10161c' : '#eef1f4',
        }}
      >
        <div ref={targetRef} data-lenis-prevent="" style={{ position: 'absolute', inset: 0 }} />
        {hasPin && (
          <IconButton
            size="small"
            onClick={() => onChange(null)}
            aria-label="Clear location"
            sx={{ position: 'absolute', top: 8, right: 8, bgcolor: 'var(--theme-surface, #fff)', border: '1px solid var(--theme-border)', '&:hover': { bgcolor: 'var(--color-neutral-9, #f4f6f9)' } }}
          >
            <CloseIcon sx={{ fontSize: 15 }} />
          </IconButton>
        )}
        <IconButton
          size="small"
          onClick={handleLocate}
          aria-label="Use my location"
          sx={{ position: 'absolute', right: 8, bottom: 8, bgcolor: 'var(--theme-surface, #fff)', border: '1px solid var(--theme-border)', '&:hover': { bgcolor: 'var(--color-neutral-9, #f4f6f9)' } }}
        >
          <MyLocationIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.75, gap: 2 }}>
        <Typography variant="caption" color="text.secondary">
          {hasPin ? `${(lat as number).toFixed(5)}, ${(lng as number).toFixed(5)}` : 'Click the map to place a pin'}
        </Typography>
        {helperText && (
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>{helperText}</Typography>
        )}
      </Stack>
      {locateFailed && (
        <Typography variant="caption" color="error">Location unavailable</Typography>
      )}
    </Box>
  )
}
