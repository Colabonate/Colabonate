# ReputationBadge

## Purpose

Headless Design-System-Komponente zur Anzeige von Reputationsdaten (Score, Identity-Level, COL-Points). Verwendet CSS Custom Properties aus `@ds/tokens`. Keine Logik, kein State, nur Darstellung.

## Usage

```tsx
import { ReputationBadge } from '@ds/ui'

// Score-only
<ReputationBadge variant="score" score={4.2} size="medium" />

// Level-only
<ReputationBadge variant="level" identityLevel={2} size="small" />

// Combined (score + level + COL-Points bei large)
<ReputationBadge variant="combined" score={4.2} identityLevel={2} colPoints={185} size="large" />

// Loading-Skeleton
<ReputationBadge loading size="medium" />
```

## Props

| Prop            | Type                                   | Default     | Description                          |
|-----------------|----------------------------------------|-------------|--------------------------------------|
| `score`         | `number`                               | –           | Reputations-Score 0.0–5.0            |
| `identityLevel` | `0 \| 1 \| 2 \| 3`                   | `0`         | Identity-Level des Users             |
| `colPoints`     | `number`                               | –           | COL-Points (nur bei `combined large`)|
| `variant`       | `'score' \| 'level' \| 'combined'`    | `'score'`   | Display-Variante                     |
| `size`          | `'small' \| 'medium' \| 'large'`      | `'medium'`  | Größe                                |
| `loading`       | `boolean`                              | `false`     | Zeigt Loading-Skeleton               |
| + alle nativen `<div>`-Attribute |                    |             |                                      |

## Tokens

| Token / Klasse              | Verwendung                          |
|-----------------------------|-------------------------------------|
| `rep-badge--level-0`        | Grau (Anonymous)                    |
| `rep-badge--level-1`        | Blau (Nostr Profile)                |
| `rep-badge--level-2`        | Lila (Peer Verified)                |
| `rep-badge--level-3`        | Gold (HID Verified)                 |

CSS-Klassen nutzen `var(--color-*)` aus dem Token-System.

## Do ✅

- `variant="score"` für kompakte Score-Anzeige in Listen
- `variant="combined"` für vollständige Badge-Anzeige in Profil-Cards
- `loading` verwenden während Daten geladen werden

## Don't ❌

- Kein hardcoded CSS oder Inline-Styles
- Keine API-Calls oder State innerhalb dieser Komponente
- Nicht verwechseln mit MUI-`Chip`: `ReputationBadge` ist DS-nativ
