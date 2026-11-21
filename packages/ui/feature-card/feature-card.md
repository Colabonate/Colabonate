# FeatureCard

Eine Card-Komponente zur Darstellung von Features oder Vorteilen.

## Verwendung

```tsx
import { FeatureCard } from '@ds/ui'
import { Bitcoin, Shield, MapPin, Star } from 'lucide-react'

<FeatureCard
  icon={<Bitcoin />}
  title="Bitcoin-nativ"
  description="Direkte Zahlungen ohne Zwischenhändler"
/>
```

## Props

| Prop | Typ | Standard | Beschreibung |
|------|-----|----------|--------------|
| `icon` | `ReactNode` | - | Icon-Komponente (z.B. von Lucide) |
| `title` | `string` | - | Titel des Features |
| `description` | `string` | - | Beschreibung des Features |
| `variant` | `'default' \| 'highlighted'` | `'default'` | Visuelle Variante |
| `className` | `string` | - | Zusätzliche CSS-Klassen |

## Varianten

### Default
- Weißer Hintergrund
- Grauer Rahmen
- Primärfarbe für Icon

### Highlighted
- Primärfarbe Hintergrund
- Weißer Text
- Transparentes Icon-Container

## Tokens

- `--color-primary-50` – Primärfarbe (Icon, highlighted Hintergrund)
- `--color-neutral-1` – Titel-Farbe
- `--color-neutral-5` – Beschreibungs-Farbe
- `--color-neutral-8` – Rahmen-Farbe
- `--color-neutral-9` – Icon-Container Hintergrund
- `--typography-fontfamily-sans` – Font Family

## Do's

- Verwende aussagekräftige Icons
- Halte Titel kurz und prägnant
- Nutze `highlighted` Variant für wichtigste Features
- Verwende Token-Variablen für Farben

## Don'ts

- Keine hardcoded CSS-Werte
- Nicht zu viele Cards auf einmal highlighten
- Keine langen Beschreibungen (max. 2-3 Zeilen)
