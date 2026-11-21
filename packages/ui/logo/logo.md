# Logo

## Purpose
Multi-brand logo component with CSS variable theming. Supports four brands (Colabonate group) and three color themes. SVGs are embedded as inline JSX — no external asset import required.

## Usage

```tsx
import { Logo } from '@ds/ui';

{/* Default: Colabonate on colored/neutral background */}
<Logo />
<Logo brand="colabonate" theme="default" />

{/* Sub-brands */}
<Logo brand="colabobuy" theme="default" />
<Logo brand="colabonow" theme="default" />
<Logo brand="colabosell" theme="default" />

{/* On white background → monochrome dark */}
<Logo brand="colabonate" theme="on-white" />

{/* On dark background → monochrome light */}
<Logo brand="colabonate" theme="on-dark" className="bg-slate-900 p-4" />
```

## Props

| Prop        | Type                                                   | Default        | Description                                           |
|-------------|--------------------------------------------------------|----------------|-------------------------------------------------------|
| `brand`     | `colabonate \| colabobuy \| colabonow \| colabosell`   | `colabonate`   | Which brand / sub-brand to display                    |
| `theme`     | `default \| on-white \| on-dark`                       | `default`      | Background context — controls color via CSS variable  |
| `className` | `string`                                               | –              | Additional classes on the wrapper `<div>`             |

## Theming

The component uses the CSS custom property `--fill-0` to control all SVG fill colors:

| Theme      | `--fill-0`    | Appearance                                              |
|------------|---------------|---------------------------------------------------------|
| `default`  | not set       | Dual-color: Slate (`#3D4C53`) + Accent red (`#E94541`)  |
| `on-white` | `#2A2A2A`     | Fully dark grey (monochrome)                            |
| `on-dark`  | `#F3F3F3`     | Fully light grey (monochrome)                           |

## Dimensions (from Figma)

| Brand        | Width (px) | Height (px) |
|--------------|------------|-------------|
| `colabonate` | 463        | 96          |
| `colabobuy`  | 375.2      | 64          |
| `colabonow`  | 403.3      | 64          |
| `colabosell` | 383.0      | 64          |

Dimensions are stored as the `SIZES` constant in `logo.tsx` and come directly from Figma.

## Tokens

| Token / Variable | Usage                                             |
|------------------|---------------------------------------------------|
| `--fill-0`       | CSS custom property — controls all SVG fill colors |

## Figma Code Connect

Three Figma components are linked via `logo.figma.tsx` (one per theme):

| Figma component  | Node ID        | Theme      |
|------------------|----------------|------------|
| Logo (Default)   | `218-56879`    | `default`  |
| LogoOnWhite      | `10075-121919` | `on-white` |
| LogoOnDark       | `635-62113`    | `on-dark`  |

Publish command (requires Figma Professional/Org/Enterprise + PAT):
```bash
npx @figma/code-connect publish --token <FIGMA_TOKEN>
```

## Do ✅
- Always set `theme` explicitly when the background context is known
- Use `on-white` on light surfaces (white, light grey), `on-dark` on dark surfaces
- Use `default` when the logo appears on a colored or mixed background
- Use `className` for spacing and wrapper styling

## Don't ❌
- Do not import SVG paths directly from `logo-svgs.tsx` — always use `<Logo>`
- Do not manually set `style={{ '--fill-0': ... }}` from outside — `theme` handles this
- Do not override fixed `width`/`height` values — dimensions come from Figma
- Do not edit `logo-svgs.tsx` directly — the source is Figma (MCP export)
