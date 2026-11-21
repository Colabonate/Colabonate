# TabBar

## Purpose

Generische horizontale Tab-Navigation. Verwendet auf dem Home-Dashboard für die Anbieter-Übersicht (Environment / For You / Favorites).

## Usage

```tsx
import { TabBar } from '@ds/ui'
import Public from '@mui/icons-material/Public'
import AutoAwesome from '@mui/icons-material/AutoAwesome'
import Favorite from '@mui/icons-material/Favorite'

<TabBar
  tabs={[
    { id: 'env', label: 'Environment', icon: <Public sx={{ fontSize: 16 }} /> },
    { id: 'foryou', label: 'For You', icon: <AutoAwesome sx={{ fontSize: 16 }} /> },
    { id: 'fav', label: 'Favorites', icon: <Favorite sx={{ fontSize: 16 }} /> },
  ]}
  activeTab="env"
  onChange={(id) => setActiveTab(id)}
/>
```

### Wrapped tabs (multi-line)

```tsx
<TabBar
  tabs={[...]}
  activeTab="env"
  onChange={(id) => setActiveTab(id)}
  wrap
/>
```

## Props

| Prop        | Type                       | Default | Description                    |
|-------------|----------------------------|---------|--------------------------------|
| `tabs`      | `TabItem[]`                | –       | Tab-Einträge                   |
| `activeTab` | `string`                   | –       | Aktiver Tab-ID                 |
| `onChange`   | `(tabId: string) => void` | –       | Callback bei Tab-Wechsel       |
| `wrap`      | `boolean`                  | `false` | Tabs auf mehrere Zeilen umbrechen statt horizontal zu scrollen |
| + alle nativen `<div>`-Attribute | | | |

### TabItem

| Feld   | Type        | Description                           |
|--------|-------------|---------------------------------------|
| `id`   | `string`    | Eindeutiger Tab-Identifier            |
| `label`| `string`    | Anzeigetext                           |
| `icon` | `ReactNode` | Optionales Icon (@mui/icons-material) |

## Tokens

| Token                 | Verwendung              |
|-----------------------|-------------------------|
| `--color-primary-*`   | Active Tab Background   |
| `--color-surface-*`   | Hover Background        |
| `--color-text-*`      | Tab Label Text          |
| `--radius-*`          | Rounded Corners         |

## Do ✅

- Icons von `@mui/icons-material` verwenden (`sx={{ fontSize: 16 }}`)
- Horizontales Scrollen auf Mobile erlauben (oder mit `wrap` umbrechen lassen)
- `role="tablist"` / `role="tab"` für Accessibility

## Don't ❌

- Keine hardcoded Farben
- Nicht mit MUI Tabs kombinieren
