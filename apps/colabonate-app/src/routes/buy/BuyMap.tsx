/**
 * BuyMap — full-bleed marketplace map page (ADR-406).
 *
 * Layout: the page opts into the immersive shell contract (D3) and fills the
 * space between the app header and footer at full width. ≥md renders a
 * list-rail + map split; mobile renders the map with a draggable bottom sheet.
 * Fullscreen uses the native Fullscreen API with a CSS fallback for iOS Safari (D4).
 *
 * Data: markers are loaded per viewport from GET /api/map/markers (D6) with the
 * same filter dimensions as the marketplace (kind / offerType / categoryCode /
 * country / q — FU-914).
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Avatar, Box, Card, CardActionArea, Chip, IconButton, InputBase, Paper, Skeleton, Stack, Typography,
} from '@mui/material'
import {
  Close as CloseIcon, Fullscreen as FullscreenIcon, FullscreenExit as FullscreenExitIcon,
  Inventory2 as Inventory2Icon, List as ListIcon, LocationOn as LocationOnIcon,
  Map as MapIcon, Navigation as NavigationIcon, Search as SearchIcon, Store as StoreIcon,
  Work as WorkIcon,
} from '@mui/icons-material'
import { useIsMobile, useTheme } from '@ds/utils'
import { useMapMarkers } from '../../hooks/useMapMarkers'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { useImmersiveLayout } from '../../context/ImmersiveLayoutContext'
import { Seo } from '../../components/Seo'
import { SatsAmount } from '../../components/currency/SatsAmount'
import type { MapBbox, MapKind, MapMarker } from '../../types/map'

const MapView = lazy(() => import('./MapView').then((m) => ({ default: m.MapView })))

const OFFER_TYPE_OPTIONS: Array<{ value: string | null; label: string }> = [
  { value: null, label: 'All types' },
  { value: 'PRODUCT', label: 'Products' },
  { value: 'SERVICE', label: 'Services' },
]

function normalizeKind(value: string | null): MapKind {
  return value === 'offers' || value === 'vendors' ? value : 'all'
}

// ── Marker list row ──────────────────────────────────────────────────────────

function MarkerRow({ marker }: { marker: MapMarker }) {
  const isService = marker.offerType === 'SERVICE'
  return (
    <Card
      component={Link}
      to={marker.href}
      variant="outlined"
      sx={{
        textDecoration: 'none', borderRadius: 3,
        transition: 'all 0.2s',
        '&:hover': { transform: 'translateY(-1px)', boxShadow: 4 },
      }}
    >
      <CardActionArea sx={{ display: 'flex', alignItems: 'center', p: '10px 12px', borderRadius: 3 }}>
        <Avatar
          variant="rounded"
          sx={{ width: 36, height: 36, bgcolor: isService ? 'rgba(99,179,237,0.12)' : 'rgba(72,187,120,0.12)', mr: 1.5, flexShrink: 0 }}
        >
          {isService
            ? <WorkIcon sx={{ fontSize: 16, color: '#63B3ED' }} />
            : <Inventory2Icon sx={{ fontSize: 16, color: '#48B978' }} />}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
            {marker.title}
          </Typography>
          {marker.subtitle && (
            <Stack direction="row" alignItems="center" spacing={0.25} sx={{ mt: 0.25 }}>
              <LocationOnIcon sx={{ fontSize: 10, color: 'text.secondary' }} />
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {marker.subtitle}
              </Typography>
            </Stack>
          )}
        </Box>
        {marker.priceSats != null && (
          <Box sx={{ flexShrink: 0, textAlign: 'right' }}>
            <SatsAmount sats={marker.priceSats} size="sm" />
          </Box>
        )}
      </CardActionArea>
    </Card>
  )
}

// ── Filter chips ─────────────────────────────────────────────────────────────

function FilterChips({
  kind, onKind, offerType, onOfferType,
}: {
  kind: MapKind
  onKind: (k: MapKind) => void
  offerType: string | null
  onOfferType: (t: string | null) => void
}) {
  const kindOptions: Array<{ value: MapKind; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'offers', label: 'Offers' },
    { value: 'vendors', label: 'Vendors' },
  ]
  return (
    <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', rowGap: 0.75 }}>
      {kindOptions.map((opt) => (
        <Chip
          key={opt.value}
          label={opt.label}
          size="small"
          color={kind === opt.value ? 'primary' : 'default'}
          variant={kind === opt.value ? 'filled' : 'outlined'}
          onClick={() => onKind(opt.value)}
        />
      ))}
      {kind !== 'vendors' && OFFER_TYPE_OPTIONS.map((opt) => (
        <Chip
          key={opt.label}
          label={opt.label}
          size="small"
          color={offerType === opt.value ? 'primary' : 'default'}
          variant={offerType === opt.value ? 'filled' : 'outlined'}
          onClick={() => onOfferType(opt.value)}
        />
      ))}
    </Stack>
  )
}

// ── Search box ───────────────────────────────────────────────────────────────

function SearchBox({ query, onChange, isDark }: { query: string; onChange: (v: string) => void; isDark: boolean }) {
  return (
    <Paper
      elevation={0}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, borderRadius: 3,
        border: `1.5px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'var(--color-neutral-8, #EBEEF2)'}`,
        background: isDark ? 'rgba(30,42,50,0.98)' : '#ffffff',
      }}
    >
      <SearchIcon sx={{ fontSize: 18, color: isDark ? 'rgba(255,255,255,0.4)' : 'var(--color-neutral-5, #858C94)', flexShrink: 0 }} />
      <InputBase
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search offers and vendors…"
        fullWidth
        sx={{
          fontSize: 14,
          color: isDark ? 'rgba(255,255,255,0.9)' : 'var(--color-neutral-1, #2C3A4B)',
          '& input::placeholder': { color: isDark ? 'rgba(255,255,255,0.35)' : 'var(--color-neutral-5, #858C94)', opacity: 1 },
        }}
      />
      {query && (
        <IconButton
          size="small"
          onClick={() => onChange('')}
          sx={{ p: 0.25, flexShrink: 0, color: isDark ? 'rgba(255,255,255,0.5)' : 'var(--color-neutral-5, #858C94)' }}
          aria-label="Clear search"
        >
          <CloseIcon sx={{ fontSize: 15 }} />
        </IconButton>
      )}
    </Paper>
  )
}

// ── KPI chips ────────────────────────────────────────────────────────────────

function KPIChips({ markers, isDark }: { markers: MapMarker[]; isDark: boolean }) {
  const offers = markers.filter((m) => m.kind === 'offer').length
  const vendors = markers.filter((m) => m.kind === 'company').length
  const places = new Set(markers.map((m) => m.subtitle ?? '').filter(Boolean)).size

  const chips = [
    { icon: <LocationOnIcon sx={{ fontSize: 11 }} />, value: offers, label: 'Offers' },
    { icon: <StoreIcon sx={{ fontSize: 11 }} />, value: vendors, label: 'Vendors' },
    { icon: <NavigationIcon sx={{ fontSize: 11 }} />, value: places, label: 'Places' },
  ]

  return (
    <Box sx={{ display: 'flex', gap: 0.5 }}>
      {chips.map((chip) => (
        <Box
          key={chip.label}
          sx={{
            display: 'flex', alignItems: 'center', gap: 0.5,
            px: 1, py: 0.5, borderRadius: 1.5,
            background: isDark ? 'rgba(20,26,32,0.85)' : 'rgba(255,255,255,0.92)',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'var(--color-neutral-8, #EBEEF2)'}`,
            backdropFilter: 'blur(6px)',
          }}
        >
          <Box sx={{ color: 'var(--color-primary-50, #E84541)', display: 'flex', alignItems: 'center' }}>{chip.icon}</Box>
          <Typography sx={{ fontSize: 11, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: isDark ? 'rgba(255,255,255,0.9)' : 'var(--color-neutral-2, #394452)' }}>
            {chip.value}
          </Typography>
          <Typography sx={{ fontSize: 9, fontWeight: 600, color: isDark ? 'rgba(255,255,255,0.4)' : 'var(--color-neutral-5, #858C94)', lineHeight: 1, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {chip.label}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

// ── List content (rail + sheet) ──────────────────────────────────────────────

function ListContent({ markers, hasFilter, query }: { markers: MapMarker[]; hasFilter: boolean; query: string }) {
  if (markers.length === 0) {
    return (
      <Stack alignItems="center" sx={{ py: 6 }} spacing={1.5}>
        <Avatar sx={{ width: 56, height: 56, bgcolor: 'action.hover' }}>
          <LocationOnIcon sx={{ fontSize: 28, color: 'text.secondary' }} />
        </Avatar>
        <Typography variant="body1" sx={{ fontSize: 15, fontWeight: 600 }}>
          {hasFilter ? 'No results' : 'Nothing in view'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13, textAlign: 'center', maxWidth: 280 }}>
          {hasFilter
            ? <>No offers or vendors match your filters{query ? <> for &ldquo;{query}&rdquo;</> : null}. Try a different search or filter.</>
            : 'Pan or zoom the map to load offers and vendors in that area.'}
        </Typography>
      </Stack>
    )
  }
  return (
    <Stack spacing={1}>
      {markers.map((marker) => <MarkerRow key={`${marker.kind}-${marker.id}`} marker={marker} />)}
    </Stack>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function BuyMap() {
  const [searchParams] = useSearchParams()
  const initialKind = normalizeKind(searchParams.get('kind'))
  const initialCategory = searchParams.get('categoryCode')
  const initialCountry = searchParams.get('country')

  const [kind, setKind] = useState<MapKind>(initialKind)
  const [offerType, setOfferType] = useState<string | null>(searchParams.get('offerType'))
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const [bbox, setBbox] = useState<MapBbox | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetRatio, setSheetRatio] = useState(0.36)
  const [nativeFullscreen, setNativeFullscreen] = useState(false)
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRegionRef = useRef<HTMLDivElement | null>(null)
  const fullscreenBtnRef = useRef<HTMLButtonElement | null>(null)
  const wasFullscreenRef = useRef(false)
  const dragRef = useRef<{ startY: number; startRatio: number } | null>(null)

  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const isMobile = useIsMobile()
  useImmersiveLayout()

  const debouncedBbox = useDebouncedValue(bbox, 250)
  const debouncedQuery = useDebouncedValue(query, 350)

  const { data, isLoading } = useMapMarkers({
    bbox: debouncedBbox,
    kind,
    offerType: offerType ?? undefined,
    categoryCode: initialCategory ?? undefined,
    country: initialCountry ?? undefined,
    q: debouncedQuery.trim() || undefined,
  })
  const markers = data?.markers ?? []
  const offerMarkers = useMemo(() => markers.filter((m) => m.kind === 'offer'), [markers])
  const hasFilter = kind !== 'all' || offerType !== null || debouncedQuery.trim() !== ''

  const isFullscreen = nativeFullscreen || pseudoFullscreen

  useEffect(() => {
    const onChange = () => setNativeFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  useEffect(() => {
    if (!pseudoFullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPseudoFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pseudoFullscreen])

  // Focus management for fullscreen (ADR-406 D8 / FU-922).
  useEffect(() => {
    const previous = wasFullscreenRef.current
    wasFullscreenRef.current = isFullscreen
    if (isFullscreen && !previous) mapRegionRef.current?.focus()
    else if (!isFullscreen && previous) fullscreenBtnRef.current?.focus()
  }, [isFullscreen])

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current
    if (!el) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else if (document.fullscreenEnabled) {
        await el.requestFullscreen()
      } else {
        // iOS Safari: no element Fullscreen API — CSS fallback (ADR-406 D4).
        setPseudoFullscreen((v) => !v)
      }
    } catch {
      setPseudoFullscreen((v) => !v)
    }
  }, [])

  // ── Mobile sheet drag (ADR-406 FU-923) ─────────────────────────────────────
  const onSheetPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startY: e.clientY, startRatio: sheetRatio }
  }, [sheetRatio])

  const onSheetPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const height = containerRef.current?.clientHeight || 800
    const next = drag.startRatio + (e.clientY - drag.startY) / height
    setSheetRatio(Math.min(0.9, Math.max(0.12, next)))
  }, [])

  const onSheetPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    setSheetRatio((r) => (r < 0.3 ? 0.2 : r > 0.68 ? 0.85 : 0.45))
  }, [])

  // Immersive height: viewport minus app header (and footer on ≥md). The
  // custom properties are published by Layout (ADR-406 D3).
  const immersiveHeight = isMobile
    ? 'calc(100dvh - var(--app-nav-h, 58px))'
    : 'calc(100dvh - var(--app-nav-h, 68px) - var(--app-footer-h, 0px))'

  const mapFallback = (
    <Box sx={{ position: 'absolute', inset: 0 }}>
      <Skeleton variant="rounded" sx={{ width: '100%', height: '100%' }} />
    </Box>
  )

  const rail = !isMobile && (
    <Box
      sx={{
        width: 360, flexShrink: 0, height: '100%', display: 'flex', flexDirection: 'column',
        borderRight: '1px solid var(--theme-border)', bgcolor: 'var(--theme-bg)',
      }}
    >
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <SearchBox query={query} onChange={setQuery} isDark={isDark} />
        <FilterChips kind={kind} onKind={setKind} offerType={offerType} onOfferType={setOfferType} />
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', px: 2, pb: 2, overscrollBehavior: 'contain' }}>
        {isLoading ? <Skeleton variant="rounded" height={120} /> : <ListContent markers={offerMarkers} hasFilter={hasFilter} query={query} />}
      </Box>
    </Box>
  )

  const toolbar = (
    <Stack direction="row" spacing={1} sx={{ position: 'absolute', top: 12, right: 12, zIndex: 5 }}>
      {isMobile && (
        <IconButton
          onClick={() => setSheetOpen((v) => !v)}
          aria-label={sheetOpen ? 'Show map' : 'Show list'}
          sx={{ bgcolor: 'var(--theme-surface, #fff)', border: '1px solid var(--theme-border, #ebbef2)', boxShadow: 1, '&:hover': { bgcolor: 'var(--color-neutral-9, #f4f6f9)' } }}
        >
          {sheetOpen ? <MapIcon sx={{ fontSize: 18 }} /> : <ListIcon sx={{ fontSize: 18 }} />}
        </IconButton>
      )}
      <IconButton
        ref={fullscreenBtnRef}
        onClick={toggleFullscreen}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        sx={{ bgcolor: 'var(--theme-surface, #fff)', border: '1px solid var(--theme-border, #ebbef2)', boxShadow: 1, '&:hover': { bgcolor: 'var(--color-neutral-9, #f4f6f9)' } }}
      >
        {isFullscreen ? <FullscreenExitIcon sx={{ fontSize: 18 }} /> : <FullscreenIcon sx={{ fontSize: 18 }} />}
      </IconButton>
    </Stack>
  )

  return (
    <Box
      ref={containerRef}
      className="page-animate"
      sx={{
        position: isFullscreen ? 'fixed' : 'relative',
        inset: isFullscreen ? 0 : 'auto',
        zIndex: isFullscreen ? 1400 : 'auto',
        width: '100%',
        height: isFullscreen ? '100dvh' : immersiveHeight,
        display: 'flex',
        overflow: 'hidden',
        bgcolor: 'var(--theme-bg)',
      }}
    >
      <Seo
        title="Map"
        description="Explore offers and vendors on the Colabonate marketplace map — discover products and services by location."
        path="/buy/map"
      />

      {rail}

      <Box
        ref={mapRegionRef}
        tabIndex={0}
        aria-label="Marketplace map"
        sx={{ position: 'relative', flex: 1, minWidth: 0, height: '100%', outline: 'none' }}
      >
        {/* MapView stays mounted across viewport refetches so the map view
            survives; the loading state is a non-destructive overlay. */}
        <Suspense fallback={mapFallback}>
          <MapView markers={markers} isDark={isDark} onViewportChange={setBbox} />
        </Suspense>
        {isLoading && mapFallback}

        {!isMobile && (
          <Box sx={{ position: 'absolute', top: 12, left: 12, zIndex: 5, maxWidth: 'calc(100% - 120px)' }}>
            <KPIChips markers={markers} isDark={isDark} />
          </Box>
        )}

        {toolbar}
      </Box>

      {isMobile && sheetOpen && (
        <Box
          sx={{
            position: 'absolute', left: 0, right: 0, bottom: 0, top: `${sheetRatio * 100}%`, zIndex: 10,
            display: 'flex', flexDirection: 'column',
            bgcolor: 'var(--theme-bg)', borderTopLeftRadius: 16, borderTopRightRadius: 16,
            boxShadow: 8, overflow: 'hidden',
          }}
        >
          <Box
            onPointerDown={onSheetPointerDown}
            onPointerMove={onSheetPointerMove}
            onPointerUp={onSheetPointerUp}
            onPointerCancel={onSheetPointerUp}
            sx={{ pt: 1, pb: 0.5, display: 'flex', justifyContent: 'center', cursor: 'grab', touchAction: 'none', flexShrink: 0 }}
            role="separator"
            aria-label="Drag to resize list"
          >
            <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: 'var(--theme-border)' }} />
          </Box>
          <Box sx={{ px: 2, pb: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25, borderBottom: '1px solid var(--theme-border)', flexShrink: 0 }}>
            <SearchBox query={query} onChange={setQuery} isDark={isDark} />
            <FilterChips kind={kind} onKind={setKind} offerType={offerType} onOfferType={setOfferType} />
          </Box>
          <Box sx={{ flex: 1, overflowY: 'auto', px: 2, pb: 'calc(16px + env(safe-area-inset-bottom, 0px))', overscrollBehavior: 'contain' }}>
            <Box sx={{ pt: 2 }}>
              {isLoading ? <Skeleton variant="rounded" height={120} /> : <ListContent markers={offerMarkers} hasFilter={hasFilter} query={query} />}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  )
}
