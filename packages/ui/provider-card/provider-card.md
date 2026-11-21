# ProviderCard

## Purpose

Anbieter-Karte für horizontale Scroll-Listen auf dem Home-Dashboard. Zeigt Avatar, Name, Kategorie, Rating und Preisrange.

## Usage

```tsx
import { ProviderCard } from '@ds/ui'

<ProviderCard
  name="Max Mustermann"
  category="Service"
  avatarUrl="/img/avatar.jpg"
  rating={4.5}
  priceRange="500–2000 sats"
  isFavorite={false}
  onFavoriteToggle={() => toggleFavorite(id)}
/>
```

## Props

| Prop              | Type       | Default | Description                       |
|-------------------|------------|---------|-----------------------------------|
| `name`            | `string`   | –       | Anzeigename                       |
| `category`        | `string`   | –       | Kategorie-Badge                   |
| `avatarUrl`       | `string`   | –       | Avatar-Bild-URL                   |
| `rating`          | `number`   | –       | Rating 0–5                        |
| `priceRange`      | `string`   | –       | Preisspanne (z.B. "500–2000 sats")|
| `isFavorite`      | `boolean`  | `false` | Favoriten-Status                  |
| `onFavoriteToggle`| `() => void`| –      | Callback für Favoriten-Toggle     |
| + alle nativen `<div>`-Attribute | | | |

## Tokens

| Token                 | Verwendung              |
|-----------------------|-------------------------|
| `--color-surface-*`   | Karten-Hintergrund      |
| `--color-border-*`    | Karten-Border           |
| `--color-text-*`      | Name, Kategorie, Label  |
| `--color-primary-*`   | Favoriten-Icon          |
| `--shadow-*`          | Hover-Shadow            |

## Do ✅

- Snap-Start für horizontales Scrollen
- Touch-Target ≥44px für Favoriten-Button
- Truncate für lange Namen

## Don't ❌

- Keine hardcoded CSS
- Nicht ohne `SliderList`-Wrapper verwenden
