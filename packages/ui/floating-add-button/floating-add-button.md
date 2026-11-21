# FloatingAddButton

Ein Floating Action Button (FAB) mit einem Dropdown-Menü für "Sell" und "Cooperate" Aktionen.

## Zweck

Der FloatingAddButton bietet einen schnellen Zugriff auf primäre Aktionen (Produkte erstellen, Dienstleistungen anbieten, Kooperationen starten) von jeder Seite aus. Der Button ist oben rechts im Content-Bereich positioniert und öffnet bei Klick ein Dropdown-Menü, das sich nach unten links öffnet.

## Verwendung

```tsx
import { FloatingAddButton } from '@ds/ui';

// Basis-Verwendung
<FloatingAddButton />

// Mit dunklem Theme
<FloatingAddButton theme="dark" />

// Größe anpassen
<FloatingAddButton size="lg" />

// Position anpassen
<FloatingAddButton offsetRight={16} offsetTop={16} />
```

## Props

| Prop | Typ | Default | Beschreibung |
|------|-----|---------|--------------|
| `theme` | `'light' \| 'dark'` | `'light'` | Farbschema des Buttons und Dropdowns |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Größe des Buttons (44px, 56px, 64px) |
| `offsetRight` | `number` | `0` | Abstand vom rechten Rand in Pixeln |
| `offsetTop` | `number` | `0` | Abstand vom oberen Rand in Pixeln |
| `scrollFade` | `boolean` | `false` | Blendet die FAB beim Herunterscrollen vom Seitenanfang via Opacity + Blur aus und lässt sie leicht nach oben gleiten (gedeckelt bei fester Scroll-Distanz), sodass der Inhalt darunter sichtbar wird |
| `className` | `string` | `''` | Zusätzliche CSS-Klassen |

## Design-Token

### Farb-Token

| Token | Verwendung |
|-------|------------|
| `var(--color-action-primary-default)` | Button Hintergrund |
| `var(--color-action-primary-active)` | Button Hover/Active Hintergrund |
| `var(--color-neutral-white)` | Icon und Text Farbe |
| `var(--color-neutral-2)` | Dropdown Hintergrund (light) |
| `var(--color-secondary-90)` | Dropdown Hintergrund (dark) |
| `var(--color-border-subtle)` | Dropdown Rahmen |
| `var(--color-shadow-lg)` | Dropdown Schatten |
| `var(--color-primary-10)` | Akzentfarbe für Gruppen-Labels (light) |
| `var(--color-primary-30)` | Akzentfarbe für Gruppen-Labels (dark) |

### Typografie-Token

| Token | Verwendung |
|-------|------------|
| `var(--typography-fontfamily-display)` | Gruppen-Labels |
| `var(--typography-fontfamily-sans)` | Button-Labels |

## Struktur

```
FloatingAddButton
├── Container (relative position, z-50)
├── Dropdown-Menü
│   ├── Accent-Linie (oben)
│   ├── Sell Gruppe
│   │   ├── Products (Privatverkäufer)
│   │   └── Products (Gründer)
│   └── Cooperate Gruppe
│       ├── Services
│       └── Cooperation
└── FAB Button (Plus-Icon)
```

## Verhalten

- **Klick**: Öffnet/schließt das Dropdown-Menü
- **Click-Outside**: Schließt das Dropdown-Menü
- **Animation**: Dropdown öffnet nach unten links mit Fade-In und Scale-Effekt
- **Position**: Oben rechts im Content-Bereich, relativ zum Parent-Container

## Do's

- ✅ Verwende Design-Token für alle Farbwerte
- ✅ Nutze `cn()` für Class-Komposition
- ✅ Stelle sicher, dass der Button auf allen Bildschirmgrößen erreichbar ist
- ✅ Verwende semantische ARIA-Attribute für Barrierefreiheit

## Don'ts

- ❌ Verwende keine hardcoded CSS-Werte (außer für Positionierung)
- ❌ Füge keine Logik oder State in die Dropdown-Items ein
- ❌ Überschreibe nicht die Token-Variablen mit inline-styles
- ❌ Verwende keine anderen Icons als die definierten SVG-Icons

## Beispiel

```tsx
// In Home.tsx – oben rechts im Header
import { FloatingAddButton } from '@ds/ui';

export function Home() {
  return (
    <PageContainer>
      <header className="flex justify-between items-center">
        <h1>Willkommen</h1>
        <div className="flex items-center gap-3">
          <Link to="/notifications"><Bell /></Link>
          <FloatingAddButton theme="light" size="md" offsetRight={0} offsetTop={0} />
        </div>
      </header>
      {/* Page Content */}
    </PageContainer>
  );
}
```

## Barrierefreiheit

- `aria-expanded` zeigt den Status des Dropdown-Menüs an
- `aria-label` beschreibt die Aktion des Buttons
- `role="menu"` für das Dropdown-Menü
- `aria-hidden` für nicht sichtbare Elemente

## Responsive Verhalten

Der Button ist relativ zum Parent-Container positioniert und passt sich der Content-Breite an.
