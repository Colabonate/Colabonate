# SectionMenu

## Purpose

Rendert `NavSubItem`-Einträge aus der Navigation-Config auf zwei Arten:

- **`mode="cards"`** – Dashboard-Karten im Content-Bereich (Titel + Beschreibung + Arrow)
- **`mode="list"`** – Kompakte Liste für Floating Context Pages und Options-Panels

Implementiert das Dual-Rendering-Pattern aus ADR-027.
Die Daten kommen aus `navigationConfig` via `getSubItems(config, path)`.

## Usage

```tsx
import { SectionMenu } from '@ds/ui';
import { getSubItems, navigationConfig } from '@ds/ui';

// Dashboard-Karten (Standard)
const subItems = getSubItems(navigationConfig, '/buy');

<SectionMenu
  items={subItems}
  mode="cards"
  onSelect={(item) => navigate(item.path)}
/>

// Floating Context Page / Options-Panel
<SectionMenu
  items={subItems}
  mode="list"
  onSelect={(item) => navigate(item.path)}
/>
```

## Props

| Prop        | Type                        | Default    | Description                                  |
|-------------|-----------------------------|------------|----------------------------------------------|
| `items`     | `NavSubItem[]`              | —          | Untermenü-Einträge (required)                |
| `mode`      | `'cards' \| 'list'`         | `'cards'`  | Render-Modus                                 |
| `onSelect`  | `(item: NavSubItem) => void`| —          | Callback bei Klick auf einen Eintrag         |
| `className` | `string`                    | —          | Zusätzliche CSS-Klassen                      |
| + alle nativen `<div>`-Attribute |          |            |                                              |

## NavSubItem Shape

```typescript
interface NavSubItem {
  label: string;        // Angezeigter Label
  description?: string; // Beschreibungstext (nur in mode="cards" sichtbar)
  icon?: string;        // Icon-Key (aktuell als Placeholder)
  path: string;         // Ziel-Pfad für onSelect-Callback
  badge?: string;       // Badge-Text (z.B. "NEU", "START", "BETA")
}
```

## Tokens

| Token | Verwendung |
|-------|------------|
| `--color-surface-secondary` | Karten-Hintergrund |
| `--color-surface-primary` | Listen-Hintergrund |
| `--color-border-default` | Karten- und Listen-Rahmen |
| `--color-action-primary-default` | Hover-Akzent, Badge-Hintergrund |
| `--color-action-primary-10` | Hover-Hintergrund |
| `--color-neutral-black` | Label-Farbe |
| `--color-neutral-5` | Beschreibungstext, Icons |
| `--color-neutral-white` | Badge-Text |
| `--typography-fontfamily-display` | Karten-Label |
| `--typography-fontfamily-sans` | Beschreibung, Listen-Label |

## Do ✅
- `mode="cards"` für Dashboard-Übersichtsseiten (Start-Seite jeder Section)
- `mode="list"` für Floating Context Pages und Options-Panels
- `onSelect` immer übergeben — Navigationsziel ist Verantwortung des Aufrufers
- `getSubItems(navigationConfig, path)` aus `@ds/ui` für die Daten nutzen

## Don't ❌
- Keine Navigation-Logik (`useNavigate`) in der Komponente selbst
- Keine statisch hardcodierten Items — immer aus `navigationConfig` beziehen
- `mode="cards"` nicht in engen Sidebars verwenden (Breakpoints beachten)
