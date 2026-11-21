# SliderList

## Purpose

Horizontale Slider-Liste mit optionalem TabNav-Header, Card-Elementen und zweistufigem Filter-System (Segmented Control + Sub-Tabs). Wiederverwendbar für Tickets, Offers, Provider und andere Slider-Sektionen auf dem Home-Dashboard.

## Usage

### Basic (single-level tabs)

```tsx
import { SliderList } from '@ds/ui'

<SliderList
  title="Sell Angebote"
  tabs={[{ id: 'all', label: 'Alle' }, { id: 'active', label: 'Aktiv' }]}
  activeTab="all"
  onTabChange={(id) => setActiveTab(id)}
  linkLabel="Alle anzeigen"
  onLinkClick={() => navigate('/offers')}
  items={offers.map(o => ({ id: o.id, title: o.title, category: o.categoryCode }))}
/>
```

### Two-level filter (segments + sub-tabs)

```tsx
<SliderList
  title="Tickets"
  segments={[
    { id: 'my-tickets', label: 'My Tickets', count: 5, subTabs: SUB_TABS },
    { id: 'my-offers', label: 'My Offers', count: 12, subTabs: SUB_TABS },
    { id: 'marketplace', label: 'Marketplace', count: 48, subTabs: SUB_TABS },
  ]}
  activeSegment="my-tickets"
  onSegmentChange={(id) => { setActiveSegment(id); setActiveSubTab('all') }}
  tabs={SUB_TABS}
  activeTab="all"
  onTabChange={setActiveSubTab}
  tabVariant="outlined"
  infoCards={{
    'my-tickets': { title: 'Your Tickets', description: '…' },
    'my-offers': { title: 'Your Offers', description: '…' },
    'marketplace': { title: 'Marketplace', description: '…' },
  }}
  items={filteredItems}
/>
```

## Props

| Prop                | Type              | Default  | Description                                       |
|---------------------|-------------------|----------|---------------------------------------------------|
| `title`             | `string`          | –        | Sektions-Titel im Header                          |
| `subtitle`          | `string`          | –        | Optional eyebrow text (e.g. "In your area")       |
| `subtitleCollapsible` | `boolean`       | `false`  | Shows a small info-icon next to the title that hides/reveals THIS section's subtitle. Initially collapsed; the freed space folds away (no whitespace). |
| `tabs`              | `SliderTab[]`     | –        | Sub-Tabs (shown below segments, or standalone)     |
| `activeTab`         | `string`          | –        | Aktiver Sub-Tab-ID                                |
| `onTabChange`       | `(id: string) => void` | –   | Callback bei Sub-Tab-Wechsel                      |
| `tabVariant`        | `'underline' \| 'outlined'` | `'underline'` | Tab-Stil                   |
| `segments`          | `SliderSegment[]` | –        | Zweistufige Filter: Segmented Control über Tabs   |
| `activeSegment`     | `string`          | –        | Aktives Segment                                    |
| `onSegmentChange`   | `(id: string) => void` | –   | Callback bei Segment-Wechsel (reset sub-tab!)     |
| `infoCards`         | `Record<string, InfoCard>` | –  | Pro-Segment InfoCards (überschreibt `infoCard`)   |
| `linkLabel`         | `string`          | –        | Text für den "Alle anzeigen"-Link                  |
| `linkHref`          | `string`          | –        | URL für den "Alle anzeigen"-Link (fallback)        |
| `onLinkClick`       | `() => void`      | –        | SPA-Navigation für den Link                        |
| `items`             | `SliderListItem[]`| –        | Items für automatische Card-Rendering              |
| `variant`           | `SliderListVariant` | `'default'` | Card-Variante (`default`, `provider`, `ticket`, `offer`, `partner`, `partner-card`) |
| `loading`           | `boolean`         | `false`  | Zeigt Loading-Skeletons                            |
| `skeletonCount`     | `number`          | `4`      | Anzahl Skeleton-Platzhalter                        |
| `emptyMessage`      | `string`          | –        | Nachricht wenn keine Items vorhanden               |
| `enableDragScroll`  | `boolean`         | `true`   | Drag-to-Scroll mit Inertia                        |
| `showArrows`        | `boolean`         | `true`   | Navigations-Pfeile auf Desktop                    |
| `onCardClick`       | `(id: string) => void` | –   | Callback bei Card-Klick                            |
| `activeItemId`      | `string`         | –        | Markiert die Card mit `aria-current` + Selected-Style (Ring + Elevation-Lift) und scrollt sie automatisch in den sichtbaren Bereich. Opt-in, kein Effekt wenn weggelassen. |
| `compactCards`      | `boolean`        | `false`  | Kompaktere Card-Dimensionen und engeres Innen-Padding (bisher nur `offer`). Reduziert die Bildhöhe auf ~60px und die Card-Höhe auf 168px. |
| `hideCardBadges`    | `boolean`        | `false`  | Blendet die Kategorie- und Entity-Type-Badges im Card-Body aus (bisher nur `offer`). |
| `compactHeader`     | `boolean`        | `false`  | Reduziert den vertikalen Abstand zwischen Header (Segments/Tabs) und Card-Liste (marginBottom `mb-8 → mb-1`, Scroll-Container-Padding `32px → 8px`). |

### SliderSegment

```typescript
interface SliderSegment {
  id: string
  label: string
  count?: number           // Badge-Zahl im Segment-Button
  subTabs?: SliderTab[]    // Sub-Tabs die bei aktivem Segment angezeigt werden
}
```

## Tokens

| Token                 | Verwendung                |
|-----------------------|---------------------------|
| `--color-primary-*`   | Active Tab/Segment, Link  |
| `--color-surface-*`   | Skeleton, Inactive Tab BG |
| `--color-text-*`      | Titel, Muted-Text         |
| `--theme-bg-subtle`   | Segmented Control BG      |

## Do ✅

- Bei Segment-Wechsel Sub-Tab auf `'all'` zurücksetzen
- `infoCards` statt `infoCard` verwenden wenn Segmente aktiv sind
- `onSegmentChange` + `onTabChange` kombinieren für zweistufige Filter
- Snap-Verhalten für Touch-Devices aktiv lassen

## Don't ❌

- Keine feste Breite – immer `w-full` mit internem Scroll
- Nicht für vertikale Listen verwenden (nur horizontal)
- `segments` und `tabs` nicht gleichzeitig mit identischer Funktion nutzen – `segments.subTabs` ersetzt `tabs`

### Selected item (`activeItemId`)

Detail-Views (z. B. `BuyProductDetail`, ADR-188) binden die aktuell betrachtete Entity an einen `SliderList` und übergeben ihre ID via `activeItemId`. Die passende Card erhält:

- `aria-current="true"` für Screen-Reader
- einen 2-px Ring in `--color-primary-50` mit Offset zur Hintergrund-Karte
- einen leichten Lift (`-translate-y-0.5`) und einen erhöhten Shadow
- `z-20`, damit die Selected-Card über FadeOut-Edges sichtbar bleibt

Wenn `activeItemId` wechselt (z. B. Route-Navigation) scrollt die Liste die Card via `snapToNearest` in den sichtbaren Bereich, ohne die manuelle Scroll-Position des Users dauerhaft zurückzusetzen (nur wenn die Card nicht bereits vollständig sichtbar ist). Wird der Prop weggelassen, verhält sich der Slider exakt wie vorher — keine bestehende Aufrufstelle ändert sich.
