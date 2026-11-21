# ListHeader

## Purpose

Wiederverwendbarer Listen-Header der MUI Tabs (Filter-Navigation) mit optionalen Aktionen und einem **integrierten View-Toggle** (Gallery/List) in einer einzigen Zeile kombiniert. Der gesamte Bereich wird von einem subtilen `Paper`-Background mit `borderRadius: 3` umhüllt.

Konsolidiert das wiederholte Pattern aus BuyOrders, BuySearch, BuyCategoryProducts und SellCatalog.

## UX Rules (ui-ux-pro-max)

| Rule | Umsetzung |
|------|-----------|
| `touch-target-size` | View-Buttons: 36px visual + 4px padding → ≥44px Touch Target |
| `state-clarity` | Active Toggle: `primary.main` Hintergrund + weißes Icon |
| `cursor-pointer` | Alle interaktiven Elemente via MUI ToggleButton |
| `spacing-scale` | 4pt/8dp System (gap: 8px, px: 12px, py: 4px) |
| `color-semantic` | Theme-Tokens: `primary.main`, `text.secondary`, `action.hover` |
| `visual-hierarchy` | Tabs links (flex: 1), Aktionen rechts (flexShrink: 0) |

## Usage

```tsx
import { ListHeader } from '@ds/ui'

// Mit Tabs + integriertem View-Toggle
<ListHeader
  tabs={[
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'inactive', label: 'Inactive' },
  ]}
  activeTab="all"
  onTabChange={setFilterTab}
  viewMode="gallery"
  onViewModeChange={setViewMode}
  mt={1}
/>
```

```tsx
// Mit Tabs + View-Toggle + Sort-Action
<ListHeader
  tabs={[{ key: 'all', label: 'All' }, { key: 'products', label: 'Products' }]}
  activeTab="all"
  onTabChange={setFilterTab}
  actions={[
    { key: 'sort', element: <SortDropdown /> },
  ]}
  viewMode="gallery"
  onViewModeChange={setViewMode}
  mt={2}
/>
```

```tsx
// Ohne Tabs (nur View-Toggle + Actions)
<ListHeader
  tabs={[]}
  activeTab=""
  onTabChange={() => {}}
  actions={[{ key: 'sort', element: <SortButton /> }]}
  viewMode="gallery"
  onViewModeChange={setViewMode}
  mt={2}
  mb={1.5}
/>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `tabs` | `ListHeaderTab[]` | – | Tab-Konfiguration (leeres Array = keine Tabs) |
| `activeTab` | `string` | – | Aktiver Tab-Key |
| `onTabChange` | `(key: string) => void` | – | Callback bei Tab-Wechsel |
| `actions` | `ListHeaderAction[]` | `[]` | Optionale Aktionen rechts (Sort, Filter, etc.) |
| `viewMode` | `'gallery' \| 'list'` | – | Aktiviert den integrierten View-Toggle |
| `onViewModeChange` | `(mode) => void` | – | Callback bei View-Mode-Wechsel |
| `mt` | `number` | `undefined` | Abstand nach oben (px) |
| `mb` | `number` | `undefined` | Abstand nach unten (px) |

### ListHeaderTab

| Feld | Type | Description |
|------|------|-------------|
| `key` | `string` | Eindeutiger Schlüssel |
| `label` | `string` | Anzeigetext |

### ListHeaderAction

| Feld | Type | Description |
|------|------|-------------|
| `key` | `string` | Eindeutiger Schlüssel |
| `element` | `ReactNode` | React-Element (z.B. Sort-Button, Filter-Chip) |

## Design

```
┌─ Paper (bg: background.paper, border: divider, radius: 12px) ─────────────┐
│                                                                         │
│  [All] [Active] [Inactive] ──────── [Sort ▾] [⊞] [≡]                    │
│  ↑ MUI Tabs (flex: 1)              ↑ Actions  ↑ View-Toggle             │
│  indicator: primary.main, 3px      (flexShrink: 0)                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### View-Toggle States

| State | Hintergrund | Icon-Farbe |
|-------|-------------|------------|
| Active | `primary.main` | `primary.contrastText` (white) |
| Inactive | transparent | `text.secondary` |
| Hover (active) | `primary.dark` | white |
| Hover (inactive) | `action.hover` | – |

## Tokens

| Token | Verwendung |
|-------|-------------|
| `primary.main` | Aktiver Tab-Text + Indicator + Active Toggle |
| `primary.dark` | Active Toggle Hover |
| `text.secondary` | Inaktiver Tab-Text + Inactive Toggle |
| `action.hover` | Toggle-Group Hintergrund + Inactive Hover |
| `background.paper` | Paper-Background |
| `divider` | Paper-Border |

## Verwendet auf

| Seite | Tabs | View-Toggle | Actions |
|-------|------|-------------|---------|
| `/sell/catalog` | All / Active / Inactive | ✓ | – |
| `/buy/search` | All / Products / Services | ✓ | Sort-Dropdown |
| `/buy/categories/:id` | – | ✓ | Sort-Button + Menu |

## Do / Don't

| ✅ Do | ❌ Don't |
|-------|----------|
| `viewMode` + `onViewModeChange` für View-Toggle nutzen | Eigenen ToggleButtonGroup als Action übergeben |
| Theme-Tokens für Styling nutzen | Hardcoded Farben |
| `actions` für Sort, Filter, etc. verwenden | Komplexe Formulare in Actions einbauen |
| `mt`/`mb` für Abstand nutzen | Eigene margin-Styles hinzufügen |
