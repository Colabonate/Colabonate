# SKILL: Colabonate Design System – Project Overview

This document explains the architecture and conventions of the Colabonate Design System.
It is intended for AI assistants and new developers who want to get productive quickly.

---

## Monorepo Structure

```
Colabonate_WebApp/
├─ apps/
│  └─ playground/          ← Vite + React Dev Environment (Port 5173)
│     ├─ src/
│     │  ├─ App.tsx         ← Routing + Layout
│     │  ├─ index.css       ← @import tokens.css + typography.css + Tailwind
│     │  └─ pages/          ← One file per showcase page
│     ├─ vite.config.ts     ← Aliases @ds/tokens, @ds/ui, @ds/utils
│     └─ tailwind.config.js ← Extends Token Config
│
├─ packages/
│  ├─ tokens/              ← @ds/tokens
│  │  ├─ tokens.json        ← Source of truth (hand-maintained)
│  │  ├─ css/tokens.css     ← Generated (do not commit!)
│  │  ├─ css/typography.css ← Global h1–h6 base styles (commit this!)
│  │  ├─ scripts/build.js   ← tokens.json → tokens.css
│  │  └─ tailwind.config.js ← CSS Vars → Tailwind classes
│  │
│  ├─ ui/                  ← @ds/ui
│  │  ├─ index.ts           ← Central export point for all components
│  │  ├─ button/            ← Button component
│  │  ├─ input/             ← Input component
│  │  ├─ logo/              ← Logo component
│  │  └─ text/              ← Text component
│  │
│  └─ utils/               ← @ds/utils
│     └─ index.ts           ← cn() utility (clsx + tailwind-merge)
│
├─ scripts/
│  └─ preflight.js          ← Dev environment check
├─ docs/
│  └─ skills/               ← This directory – LLM Skill Docs
└─ package.json             ← pnpm workspaces root
```

---

## Package Names (Workspace Aliases)

| Alias        | Path                              | Usage                          |
|--------------|-----------------------------------|--------------------------------|
| `@ds/tokens` | `packages/tokens/tokens.json`     | Design token data (JSON)       |
| `@ds/ui`     | `packages/ui/index.ts`            | All UI components              |
| `@ds/utils`  | `packages/utils/index.ts`         | Utility functions (cn, etc.)   |

---

## Important Commands

```bash
# Start Playground (Vite Dev Server, Port 5173)
npx pnpm playground

# Run token pipeline (tokens.json → css/tokens.css)
npx pnpm tokens:build

# Check dev environment (Pre-flight Check)
npx pnpm preflight

# Install all dependencies
npx pnpm install

# TypeScript check for all packages
npx pnpm typecheck
```

> Note: `pnpm` is invoked via `npx pnpm` because pnpm is not globally in PATH.

---

## Implemented Components (@ds/ui)

| Component | File                             | Documentation              |
|-----------|----------------------------------|----------------------------|
| `Logo`    | `packages/ui/logo/logo.tsx`      | `packages/ui/logo/logo.md`  |
| `Button`  | `packages/ui/button/button.tsx`  | `packages/ui/button/button.md` |
| `Input`   | `packages/ui/input/input.tsx`    | `packages/ui/input/input.md`|
| `Text`    | `packages/ui/text/text.tsx`      | `packages/ui/text/text.md`  |

---

## Architecture Conventions

### Token-first
- **No hardcoded CSS values** in component code
- Colors, font sizes, spacing come exclusively from `tokens.css`
- Tailwind classes are generated via token mapping in `packages/tokens/tailwind.config.js`

### Headless-first
- Components only control structure and token-based styling
- No logic, no state except the essentials (e.g., `useId()` for accessibility)
- Interaction logic belongs in the app, not in the component

### No External Asset Import
- SVGs are embedded as inline JSX (see `logo-svgs.tsx`)
- No `import logo from './logo.svg?url'`

### TypeScript
- Each component has a `.types.ts` file with all props as Interface/Type
- Generics and polymorphism via `as?: ElementType` (see `Text` component)

### CSS Custom Properties for Theming
- Theming via `--variable-name` CSS Custom Properties
- Logo example: `--fill-0` controls all SVG colors via a single property
- **Semantic Theme Variables** für Dark Mode Support:
  - `var(--theme-text, #1A2026)` – Primärer Text (automatisch hell/dunkel)
  - `var(--theme-text-muted, #858C94)` – Sekundärer Text, Icons, Muted Elements
  - Diese Variablen werden vom Theme-System automatisch umgeschaltet beim Toggle zwischen Light/Dark Mode
  - **Pattern:** Immer semantische Variablen verwenden statt direkter Color-Tokens (`var(--color-neutral-9)`) für adaptive Farben

---

## Token Pipeline (Short Version)

```
Figma (Source)
  → packages/tokens/tokens.json        (MCP Export)
  → pnpm tokens:build
  → packages/tokens/css/tokens.css     (generated, ~400 CSS Vars)
  → packages/tokens/css/typography.css (handcrafted, h1–h6 base styles)
  → apps/*/src/index.css               (@import both, before Tailwind)
  → Tailwind Config (CSS Vars → Utility Classes)
```

For details: [TOKEN-PIPELINE.md](./TOKEN-PIPELINE.md)

## Typography Conventions

**Never define `h1`–`h6` styles in app-level CSS or inline in components.**

All heading base styles live in `packages/tokens/css/typography.css` and are applied globally via `@import`. This means:

```tsx
// ✅ Correct – inherits from typography.css
function SectionHeader({ title }: { title: string }) {
  return <h2>{title}</h2>
}

// ❌ Wrong – duplicates what typography.css already provides
function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="text-[var(--typography-heading-h2-mobile-light-fontsize)] font-light ...">
      {title}
    </h2>
  )
}
```

When adding a new app to the monorepo, always import both files in `index.css`:
```css
@import "@ds/tokens/css/tokens.css";
@import "@ds/tokens/css/typography.css";
@import "tailwindcss";
```

---

## Figma → Code Workflow

1. Open Figma page with relevant component
2. Call `get_design_context` MCP tool → receives props, code reference, screenshot
3. Create component in `packages/ui/<name>/`
4. Export in `packages/ui/index.ts`
5. Showcase in Playground at `apps/playground/src/pages/`

For details: [FIGMA-MCP.md](./FIGMA-MCP.md)

---

## Adding a New Component

For details: [ADD-COMPONENT.md](./ADD-COMPONENT.md)
