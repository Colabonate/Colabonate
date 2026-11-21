# FeatureGrid

Eine Grid-Komponente zur Darstellung mehrerer FeatureCards mit Titel und optionalem Untertitel.

## Verwendung

```tsx
import { FeatureGrid } from '@ds/ui'
import { Bitcoin, Shield, MapPin, Star } from 'lucide-react'

<FeatureGrid
  title="Warum Colabonate?"
  subtitle="Dezentraler Handel, der sich für dich lohnt"
  columns={4}
  features={[
    {
      icon: <Bitcoin />,
      title: "Bitcoin-nativ",
      description: "Direkte Zahlungen ohne Zwischenhändler"
    },
    {
      icon: <Shield />,
      title: "Dezentral & Sicher",
      description: "Keine zentrale Kontrolle, deine Daten gehören dir"
    }
  ]}
/>
```

## Props

| Prop | Typ | Standard | Beschreibung |
|------|-----|----------|--------------|
| `title` | `string` | - | Sektionstitel |
| `subtitle` | `string` | - | Optionaler Untertitel |
| `features` | `FeatureCardProps[]` | - | Array von FeatureCards |
| `columns` | `2 \| 3 \| 4` | `3` | Anzahl Spalten auf Desktop |
| `className` | `string` | - | Zusätzliche CSS-Klassen |

## Responsive Verhalten

| Breakpoint | Spalten (columns=3) | Spalten (columns=4) |
|------------|---------------------|---------------------|
| Mobile (< 640px) | 1 | 1 |
| Tablet (≥ 640px) | 2 | 2 |
| Desktop (≥ 1024px) | 3 | 4 |

## Tokens

- `--color-neutral-1` – Titel-Farbe
- `--color-neutral-5` – Subtitle-Farbe
- `--typography-fontfamily-sans` – Font Family

## Do's

- Verwende konsistente Icon-Größen (20x20px empfohlen)
- Halte Feature-Beschreibungen kurz (1-2 Sätze)
- Nutze `columns=4` für viele Features, `columns=2` für wenige
- Zentriere den Header für bessere Lesbarkeit

## Don'ts

- Nicht mehr als 8 Features in einem Grid
- Keine unterschiedlichen Varianten in einem Grid mischen
- Nicht zu viele Spalten auf Mobile erzwingen
