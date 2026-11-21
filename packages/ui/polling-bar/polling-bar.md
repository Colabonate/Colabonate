# PollingBar

## Zweck
Dezenter 2px-Balken am oberen Bildschirmrand, der den Hintergrund-Polling-Status von Nostr-Ticket-Daten visualisiert. Rein präsentational – kein eigener State.

## Usage
```tsx
import { PollingBar } from '@ds/ui'

<PollingBar status="scanning" />
<PollingBar status="fetching" progress={70} />
<PollingBar status="found" />
```

## Props
| Prop | Typ | Default | Beschreibung |
|------|-----|---------|--------------|
| `status` | `PollingBarStatus` | — | Pflicht. Steuert Animation und Farbe |
| `progress` | `number` | `0` | 0–100, nur bei `status="fetching"` relevant |
| `reducedMotion` | `boolean` | `false` | Deaktiviert alle Animationen (barrierefreiheit) |
| `className` | `string` | — | Zusätzliche Klassen für Positioning-Overrides |

## Status-Zustände
| Status | Visuell | Wann |
|--------|---------|------|
| `idle` | Statischer Streifen, 15% Opacity | Zwischen Polls |
| `scanning` | Gradient-Blob läuft von links nach rechts (2.8s Loop) | Aktiv überwachend |
| `fetching` | Balken füllt sich auf `progress`% | API-Request läuft |
| `found` | Grüner Blitz, fade-out 1.2s | Neue Tickets entdeckt |
| `error` | Warning-Farbe, fade-out 2.5s | Request fehlgeschlagen |

## Tokens
| Token | Verwendung |
|-------|-----------|
| `--color-primary-50` | idle, scanning, fetching |
| `--color-status-success` | found |
| `--color-status-warning` | error |

## Positionierung
- `position: fixed; top: 0; z-index: 1300` — liegt über dem sticky Navbar (z-index 1200)
- `pointer-events: none` — unterbricht keine Klicks
- Benötigt keine Layout-Anpassungen (kein Platzbedarf im Flow)

## Keyframes (in `index.css` definiert)
```css
@keyframes polling-scan { ... }
@keyframes polling-found { ... }
@keyframes polling-error-fade { ... }
```

## Do ✅
- `reducedMotion` aus `useReducedMotion()` Hook durchreichen
- Status von außen (Context) steuern
- `aria-hidden="true"` ist bereits gesetzt

## Don't ❌
- Keinen State in die Komponente einbauen
- Nicht direkt in Seiten verwenden – über `Layout.tsx` einbinden
- Kein hardcoded CSS (nur Token-Variablen)
