# KPIStrip

## Purpose

Horizontale Reihe von KPI-Metriken (Icon + Value + Label). Wird auf dem Home-Dashboard, in der Anbieter-Übersicht, im Tickets-Slider und in den Buy/Sell-Routen verwendet.

## Features

- **Compact Square Cards:** `min-width` + `min-height` = quadratische Mindestgröße, aber Content-bestimmte Höhe
- **Label-Truncation:** Lange Labels werden mit `…` abgeschnitten (Ellipsis)
- **Tooltip:** Bei Hover über abgeschnittene Labels wird der vollständige Text angezeigt
- **Hover-Elevation:** Subtiles Shadow + translateY(−1px) – nicht zu aggressiv
- **Overflow-Safe:** Padding auf dem Flex-Container verhindert Shadow-Clipping
- **Responsive:** Alle Maße (Größe, Schrift, Padding, Gap) passen sich an Breakpoints an

## Usage

```tsx
import { KPIStrip } from '@ds/ui'
import Storefront from '@mui/icons-material/Storefront'
import ReceiptLong from '@mui/icons-material/ReceiptLong'
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline'

<KPIStrip
  items={[
    { icon: <Storefront sx={{ fontSize: 20 }} />, value: 12, label: 'Angebote', color: 'text-primary' },
    { icon: <ReceiptLong sx={{ fontSize: 20 }} />, value: 5, label: 'Aktive Tickets', color: 'text-warning' },
    { icon: <CheckCircleOutline sx={{ fontSize: 20 }} />, value: 23, label: 'Abgeschlossen', color: 'text-success' },
  ]}
/>

// Loading state
<KPIStrip items={[]} loading skeletonCount={3} />

// With tooltips on interactive cards
<KPIStrip
  items={[
    { icon: <Store sx={{ fontSize: 20 }} />, value: 5, label: 'Vendors', onClick: () => {}, active: true, tooltip: 'Toggle vendor list panel' },
    { icon: <MapPin sx={{ fontSize: 20 }} />, value: '→', label: 'Map', onClick: () => navigate('/map'), tooltip: 'Open map view', tooltipPlacement: 'top' },
  ]}
/>
```

## App-wide override (ADR-407)

In `apps/colabonate-app` every strip is rendered through the app-level wrapper
`apps/colabonate-app/src/components/kpi/KpiStrip.tsx` — import `KPIStrip` from
there, **not** from `@ds/ui`. The wrapper turns the global Settings → Appearance
prefs into props:

- `kpiStripSize` (`small` \| `large`, default `small`) → `compact` (small = forced
  smallest tier everywhere, large = responsive tier). Overrides any per-page value.
- `kpiStripCollapsed` (boolean, default `true`) → `collapsible` (auto-enabled for
  any strip with headings) + `defaultCollapsed`. Per-heading user toggles still win.

Because these are governed globally, the wrapper **omits** `compact`,
`defaultCollapsed` and `defaultCollapsedHeadings` from its public API. Strips
embedded in `PageHeader` actions pass `embedded` to stay always small.

## Props

| Prop            | Type          | Default | Description                              |
|-----------------|---------------|---------|------------------------------------------|
| `items`         | `KPIItem[]`   | –       | KPI-Daten (Icon, Value, Label, Color)    |
| `loading`       | `boolean`     | `false` | Zeigt Loading-Skeletons                  |
| `skeletonCount` | `number`      | `3`     | Anzahl Skeleton-Platzhalter              |
| + alle nativen `<div>`-Attribute | | | |

### KPIItem

| Feld    | Type              | Description                            |
|---------|-------------------|----------------------------------------|
| `icon`  | `ReactNode`       | Icon (@mui/icons-material empfohlen)   |
| `value` | `number \| string`| KPI-Wert                               |
| `label` | `string`          | Beschreibung unter dem Wert            |
| `color` | `string`          | Tailwind text-Klasse (optional)        |
| `onClick`| `() => void`       | Click-Handler – macht die Karte interaktiv (optional) |
| `active` | `boolean`          | Ob die Karte aktiv/angedrückt dargestellt wird |
| `tooltip`| `string`           | Tooltip-Text bei Hover über die gesamte Karte |
| `tooltipPlacement`| `'top' \| 'bottom' \| 'left' \| 'right'` | Tooltip-Position (default: `bottom`) |
| `avatarUrl` | `string` | Kreisförmiges Profilbild (22px) vor Icon/Value (z. B. Nostr-Profilbild); wird bei Ladefehler versteckt |
| `bannerUrl` | `string` | Dekoratives Cover-Bild als subtiler, weichgezeichneter Karten-Hintergrund (z. B. Nostr-Banner); wird bei Ladefehler versteckt |

## Responsive Breakpoints

| Eigenschaft    | xs (0-359px) | sm (360px+) | md (600px+) | lg (900px+) |
|----------------|-------------|-------------|-------------|-------------|
| Square min     | 80×80px     | 96×96px     | 108×108px   | 120×120px   |
| Value font     | 16px        | 18px        | 20px        | 20px        |
| Label font     | 10px        | 11px        | 11px        | 11px        |
| Card padding   | 6×8px       | 8×10px      | 10×12px     | 10×12px     |

## Design Principles (UI/UX Pro Max)

- **Minimalism:** Keine unnötigen Dekorationen, Flat Design mit subtilen Borders
- **Content-driven Height:** `min-height` statt `aspect-ratio` – Karte wächst mit dem Content
- **Compact Spacing:** Reduzierte Gaps und Padding für minimalen vertikalen Footprint
- **Subtle Hover:** 150ms Transition, kleiner Shadow (0 2px 8px), nur −1px Lift
- **Touch-Safe:** Min 80×80px auf Mobile (≥ 44×44px Touch Target)

## Implementation Notes

- **Collapse-Persistenz (`storageKey` + `collapsible`):** Gespeichert wird pro Seite (Key) und damit über alle Sub-Tabs geteilt — `{ map: Record<heading, collapsed>, inherit: boolean }`. `map` materialisiert den Zustand jedes gesehenen Headings (gleicher Name = gleicher Zustand, auch nach Tab-Wechsel); `inherit` ist der Zustand für noch nie gesehene Headings und trägt die letzte Collapse/Expand-Wahl über Sub-Tabs mit unterschiedlichen Headings hinweg (z. B. SellListings `Browse` → Agent Stack `Agent Stack`). Eine leere Map ist eine gültige Präferenz („alles expandiert") und wird nie gelöscht — Defaults klappten sonst nach explizitem Expandieren wieder auf. Nur User-Toggles schreiben; beim Fehlen des Keys greifen `defaultCollapsed`/`defaultCollapsedHeadings`.

- **Quadratische Mindestgröße:** `min-width` + `min-height` (nicht `aspect-ratio`) – die Karte kann breiter werden, bleibt aber mindestens quadratisch
- **Value-Text:** Truncation mit `text-overflow: ellipsis` – die Card wächst, der Text wird abgeschnitten
- **Label-Truncation:** `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`
- **Tooltip:** Aktiv bei `label.length > 16` Zeichen
- **Hover-Shadow:** Subtiler Shadow `0 2px 8px rgba(0,0,0,0.08)` mit Padding-Container statt margin-Offset
- **Keine leeren Spacer-Elemente** mehr im Flex-Container (aufgeräumt)

## Do ✅

- `stat-number` Klasse behalten (GSAP Counter-Animation nutzt sie)
- Horizontales Scrollen auf Mobile erlauben
- Icons von `@mui/icons-material` verwenden (`sx={{ fontSize: 20 }}`)

## Don't ❌

- Keine hardcoded Farben – nur Token-Klassen
- Nicht in vertikaler Ausrichtung erzwingen
