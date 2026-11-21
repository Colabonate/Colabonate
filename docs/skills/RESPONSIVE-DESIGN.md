# SKILL: Responsive Design – Colabonate Design System

This skill describes the **binding responsive strategy** in the Colabonate Design System.
Read this document before writing responsive code.

---

## Quick Start

### Neues Page-Layout

```tsx
import { PageContainer, PageSection, PageHeader } from '@ds/ui';

<PageContainer size="standard">
  <PageHeader title="Meine Tickets" subtitle="Verwalte deine Tickets" />
  <PageSection spacing="lg">
    <StatsStrip />
  </PageSection>
  <PageSection spacing="md">
    <TicketList />
  </PageSection>
</PageContainer>
```

### Responsive Logik im Code

```tsx
import { usePageLayout, useIsMobile, useIsDesktop } from '@ds/utils';

function MyComponent() {
  const { isMobile, isDesktop, navHeight } = usePageLayout()
  
  // Layout-Entscheidungen
  if (isMobile) {
    return <MobileView />
  }
  return <DesktopView />
}
```

---

## Zwei-Layer-Ansatz (WICHTIG)

Das Projekt hat zwei klar getrennte Layer mit unterschiedlichen Technologien:

| Layer | Technologie | Responsive Methode |
|-------|-------------|-------------------|
| `packages/ui/*` (Components) | React + Tailwind CSS | **Tailwind breakpoint classes** |
| `packages/utils/*` (Hooks) | React + TypeScript | **usePageLayout/useIsMobile/useIsDesktop Hooks** |
| `apps/colabonate-app/*` (Pages) | React + MUI | **PageContainer + MUI `sx` prop** |

> Diese Trennung ist intentional: `@ds/ui` Components sind framework-agnostisch (headless-first).
> Pages nutzen MUI weil sie komplexe Logik haben.

---

## Breakpoints (Single Source of Truth)

Definiert in `packages/utils/responsive.ts` → **immer hier prüfen, nie hardcodieren**:

```
xs:   0px    →   < 360px   (very small mobile)
sm:  360px   →  360–599px  (Mobile – Figma design basis)
md:  600px   →  600–899px  (Tablet)
lg:  900px   →  900–1199px (Desktop – MainMenu breakpoint)
xl:  1200px  →  ≥ 1200px   (Large Desktop)
```

### Tailwind Class Mapping

Tailwind nutzt diese Breakpoints automatisch:

```
sm: 360px  →  `sm:` prefix
md: 600px  →  `md:` prefix
lg: 900px  →  `lg:` prefix
xl: 1200px →  `xl:` prefix
```

---

## Page Layout System

### PageContainer

Zentraler Container für Page-Content:

```tsx
import { PageContainer } from '@ds/ui';

// Account Page (narrow = 720px)
<PageContainer size="narrow" />

// Home/Offers (standard = 1100px)
<PageContainer size="standard" />

// Dashboard (wide = 1200px)
<PageContainer size="wide" />

// Map/Fullscreen
<PageContainer size="full" />
```

**Props:**

| Prop | Typ | Default | Beschreibung |
|------|-----|---------|--------------|
| `size` | `'narrow' \| 'standard' \| 'wide' \| 'full'` | `'standard'` | Max-Width |
| `spacing` | `'none' \| 'sm' \| 'md' \| 'lg'` | `'lg'` | Vertical spacing |
| `centered` | `boolean` | `true` | Horizontal zentriert |
| `withNavPadding` | `boolean` | `true` | Padding für MainMenu |

### PageSection

Vertikaler Abschnitt:

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

Standardisierter Header:

```tsx
<PageHeader
  title="Meine Tickets"
  subtitle="Verwalte deine Käufe"
  actions={<Button>Neues Ticket</Button>}
/>
```

---

## Strategie 1: Tailwind (für `packages/ui` components)

### Core Principle: Mobile-First

Immer ohne Prefix für Mobile schreiben, dann mit Prefixes erweitern:

```tsx
// ✅ Richtig: Mobile-First
<div className="flex flex-col gap-4 md:flex-row md:gap-6 lg:gap-8">

// ❌ Falsch: Desktop-First (vermeiden)
<div className="flex-row max-md:flex-col">
```

### Typische Responsive Patterns

**Grid Layouts:**
```tsx
// 1 column → 2 → 3 → 4
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
```

**Flexbox Direction:**
```tsx
// Stacked on mobile, side-by-side from tablet
<div className="flex flex-col md:flex-row gap-4">
```

**Spacing (Token-basiert):**
```tsx
// Smaller spacing on mobile, larger on desktop
<div className="p-4 md:p-6 lg:p-8">
```

**Font Sizes:**
```tsx
<h1 className="text-2xl md:text-3xl lg:text-4xl font-bold">
```

**Visibility:**
```tsx
// Show only on mobile
<div className="block md:hidden">Mobile Nav</div>
// Show only on desktop
<div className="hidden md:block">Desktop Nav</div>
```

---

## Strategie 2: usePageLayout Hook (für komplexe Logik)

Für Layout-Entscheidungen im Code (nicht für pure Styles):

```tsx
import { usePageLayout } from '@ds/utils';

function MyPage() {
  const { isMobile, isDesktop, navHeight, container, grid } = usePageLayout()

  // Logik-basierte Entscheidungen
  if (isMobile) {
    return (
      <div className={container.full.className}>
        <MobileHeader />
        <div className={`${grid.cols1} gap-4`}>
          {items.map(item => <MobileCard key={item.id} item={item} />)}
        </div>
      </div>
    )
  }

  return (
    <div className={container.standard.className}>
      <DesktopHeader />
      <div className={`${grid.cols3} gap-6`}>
        {items.map(item => <DesktopCard key={item.id} item={item} />)}
      </div>
    </div>
  )
}
```

### Verfügbare Hooks

| Hook | Returns | Use Case |
|------|---------|----------|
| `usePageLayout()` | `{ isMobile, isTablet, isDesktop, navHeight, container, grid, spacing }` | Alle Layout-Infos |
| `useIsMobile()` | `boolean` | Einfache Mobile-Abfrage |
| `useIsDesktop()` | `boolean` | Einfache Desktop-Abfrage |
| `useBreakpoint()` | `'xs' \| 'sm' \| 'md' \| 'lg' \| 'xl'` | Genauer Breakpoint |

---

## Figma → Code: Responsive Checklist

Wenn ein Figma Design importiert wird (normalerweise Mobile 360px):

```
[ ] 1. Ist der Figma Frame Mobile (360px) oder Desktop?
[ ] 2. Brauchen Layouts mehr Spalten auf größeren Screens?
        → Flex direction, grid columns prüfen
[ ] 3. Sind Spacings token-basiert und skalieren sie?
        → Tailwind: p-4 md:p-6 lg:p-8
[ ] 4. Ist max-width gesetzt für Content?
        → PageContainer size-Prop nutzen
[ ] 5. Sind Touch-Targets groß genug (≥44px)?
[ ] 6. Sind Texte auf Desktop größer als Mobile (optional)?
[ ] 7. Sind feste px-Werte durch fluid/token-basierte ersetzt?
        → style={{ width: '360px' }} → className="w-full max-w-[360px]"
[ ] 8. Gibt es Modal/Overlay Komponenten?
        → Full width auf Mobile, fixed width auf Desktop
```

---

## Anti-Patterns (NIEMALS nutzen)

```tsx
// ❌ Fixed pixel widths für Container
<div style={{ width: '360px' }} />

// ❌ Viewport sizes als hardcoded Werte
sx={{ width: 360, height: 800 }}

// ❌ Tailwind classes inside MUI sx (mischen)
<Box sx={{ className: 'flex flex-col' }} />  // funktioniert nicht

// ❌ Desktop-first media queries in Tailwind
<div className="flex-row max-md:flex-col" />

// ❌ Inline styles für responsive values
<div style={{ fontSize: window.innerWidth < 600 ? '14px' : '16px' }} />
```

---

## Navigation Integration

### MainMenu Breakpoint

Das MainMenu wechselt bei **900px** zwischen Mobile und Desktop:

- **< 900px:** Bottom Navigation (58px Höhe)
- **≥ 900px:** Top Bar (68px Höhe, 52px beim Scrollen)

### PageContainer withNavPadding

```tsx
// Automatisch richtiges Padding für MainMenu
<PageContainer withNavPadding={true}>
  // Content mit korrektem Abstand zur Navigation
</PageContainer>
```

### Safe Areas

Für iOS Safe Areas (Kerbe etc.) wird automatisch `env()` genutzt wenn verfügbar.

---

## Layout Constants

In `packages/utils/responsive.ts`:

```typescript
export const LAYOUT = {
  mobileNavHeight: 58,           // Bottom Nav
  desktopNavHeight: 68,           // Top Bar (normal)
  desktopNavHeightScrolled: 52,   // Top Bar (scrolled)
}

export const BREAKPOINTS = {
  xs: 0,
  sm: 360,
  md: 600,
  lg: 900,   // ← MainMenu Breakpoint
  xl: 1200,
}
```

---

## PageContainer Size Presets

| Preset | Max-Width | Anwendungsfall |
|--------|-----------|----------------|
| `narrow` | 720px | Account, Settings, Login |
| `standard` | 1100px | Home, Offers, Tickets |
| `wide` | 1200px | Dashboard mit Widgets |
| `full` | 100% | Map, Fullscreen Modal |

---

## Grid Column Presets

Nutze `usePageLayout().grid`:

| Preset | Mobile | Tablet | Desktop | Large Desktop |
|--------|--------|--------|---------|--------------|
| `cols1` | 1 | 1 | 1 | 1 |
| `cols2` | 1 | 2 | 2 | 2 |
| `cols3` | 1 | 2 | 3 | 3 |
| `cols4` | 1 | 2 | 4 | 4 |

---

## Collapsible Sections Convention (Mobile-First)

All collapsible/expandable sections default to **closed** on initial load:

- KPI-Strips: `defaultCollapsed={true}` (global, all viewports — ADR-189)
- WhyColabonate: `expandedFeature` starts `null` on mobile
- SellDashboard: `hoursExpanded` defaults `false`
- MutualArbiterPanel: `expanded` defaults `false`
- BuyDashboard `categoryOpen`: **stays open** (category browsing immediately visible — explicit decision)

**Rule:** When adding a new collapsible section, default it to `false`/`null` (closed). Only set `true` if there is a specific reason (e.g. primary navigation, first-use onboarding).

---

## Verwandte Skills

- [ADD-COMPONENT.md](./ADD-COMPONENT.md) – Component structure
- [TOKEN-PIPELINE.md](./TOKEN-PIPELINE.md) – Spacing token references
- [FIGMA-MCP.md](./FIGMA-MCP.md) – Step 4a: Responsive adjustment on import
- [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) – Project overview
