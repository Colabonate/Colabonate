# PageContainer – Colabonate Design System

Zentraler Container für Page-Content mit responsivem Layout.

## Überblick

`PageContainer` und verwandte Komponenten bieten ein konsistentes Layout-System für alle Pages der App:

- **Responsive Padding** - Mobile-first Ansatz
- **Max-Width Kontrolle** - Presets für verschiedene Page-Größen
- **Navigation Safe-Area** - Automatische Abstände für MainMenu
- **Design Token Integration** - Nutzt `var(--theme-*)` Variablen

## Komponenten

### PageContainer

Der Haupt-Container für Seiten-Content.

```tsx
import { PageContainer } from '@ds/ui';

<PageContainer size="standard">
  <h1>Titel</h1>
  <p>Content...</p>
</PageContainer>
```

**Props:**

| Prop | Typ | Default | Beschreibung |
|------|-----|---------|--------------|
| `size` | `'narrow' \| 'standard' \| 'wide' \| 'full'` | `'standard'` | Maximale Breite |
| `spacing` | `'none' \| 'sm' \| 'md' \| 'lg'` | `'lg'` | Vertikaler Abstand nach oben |
| `centered` | `boolean` | `true` | Horizontal zentriert |
| `withNavPadding` | `boolean` | `true` | Padding für MainMenu |

**Size-Presets:**

| Preset | Max-Width | Anwendungsfall |
|--------|-----------|----------------|
| `narrow` | 720px | Account, Settings |
| `standard` | 1100px | Home, Offers, Tickets |
| `wide` | 1200px | Dashboard mit Widgets |
| `full` | 100% | Map, Fullscreen |

### PageSection

Vertikaler Abschnitt innerhalb einer Page.

```tsx
<PageContainer>
  <PageSection spacing="lg">
    <h2>Section 1</h2>
  </PageSection>
  <PageSection spacing="md" withBorder>
    <h2>Section 2</h2>
  </PageSection>
</PageContainer>
```

### PageHeader

Standardisierter Page-Header.

```tsx
<PageHeader
  title="Meine Tickets"
  subtitle="Verwalte deine Käufe und Verkäufe"
  actions={<Button>Neues Ticket</Button>}
/>
```

### PageCard

Einfache Card-Komponente.

```tsx
<PageCard padded bordered>
  <p>Content...</p>
</PageCard>
```

## Responsive Verhalten

### Breakpoints

| Name | Breite | Nutzung |
|------|--------|---------|
| xs | 0-359px | Sehr kleine Mobile |
| sm | 360-599px | Mobile (Figma Design) |
| md | 600-899px | Tablet |
| lg | 900-1199px | Desktop |
| xl | ≥1200px | Großer Desktop |

### Navigation Padding

Der `withNavPadding` Prop fügt automatisch das richtige Padding hinzu:

- **Mobile (<900px):** `pt-[58px]` - Abstand zur Bottom Nav
- **Desktop (≥900px):** `pt-[68px]` - Abstand zur Top Bar

Dies ist synchronisiert mit dem `MainMenu` Breakpoint.

## Tokens

Nutzt folgende CSS-Variablen:

```css
--theme-surface    /* Card-Hintergrund */
--theme-border     /* Border-Farbe */
--theme-bg         /* Seiten-Hintergrund */
--theme-text       /* Textfarbe */
--theme-text-muted /* Gedämpfter Text */
```

## Migration Guide

### Vorher (MUI)

```tsx
<Box sx={{ 
  maxWidth: 720, 
  mx: 'auto', 
  display: 'flex', 
  flexDirection: 'column', 
  gap: { xs: 4, md: 5 },
  pt: { xs: 2, sm: 2.5 },
}}>
```

### Nachher (PageContainer)

```tsx
<PageContainer size="narrow" spacing="lg">
```

## Siehe auch

- [RESPONSIVE-DESIGN.md](../../docs/skills/RESPONSIVE-DESIGN.md)
- [useBreakpoint Hook](../utils/index.ts)
- [MainMenu](../main-menu/main-menu.tsx)
