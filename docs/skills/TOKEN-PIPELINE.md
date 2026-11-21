# SKILL: Token Pipeline

How design tokens flow from `tokens.json` through CSS to Tailwind utility classes.

---

## Overview

```
packages/tokens/tokens.json          ← Source of Truth (hand-maintained)
    ↓  npx pnpm tokens:build
packages/tokens/css/tokens.css       ← Generated CSS Custom Properties (~405 vars)
    ↓  @import in index.css
apps/playground/src/index.css        ← Loads all tokens into the browser
    ↓  Tailwind Config reads CSS vars
packages/tokens/tailwind.config.js   ← Maps CSS vars to Tailwind classes
    ↓  extends in app config
apps/playground/tailwind.config.js   ← Final Tailwind setup
```

---

## tokens.json — Source of Truth

**Path:** `packages/tokens/tokens.json`

Hand-maintained JSON file defining all design tokens: colors, typography, spacing, radii, shadows, etc.

```json
{
  "color": {
    "primary": {
      "50": "#E84541",
      "60": "#CF3632"
    }
  },
  "typography": {
    "heading": {
      "h1": {
        "mobile": {
          "light": {
            "fontsize": "32px",
            "fontweight": "600",
            "lineheight": "38px"
          }
        }
      }
    }
  }
}
```

**Rules:**
- This is the single source of truth — never hardcode values that should be tokens.
- After editing, always run `npx pnpm tokens:build` to regenerate CSS.
- Validated by `scripts/preflight.js`.

---

## build.js — Token Transformation

**Path:** `packages/tokens/scripts/build.js`

Transforms nested JSON into flat CSS Custom Properties:

- Keys joined with `-`, spaces/slashes → hyphens
- Result: `typography.heading.h1.mobile.light.fontsize` → `--typography-heading-h1-mobile-light-fontsize`

```bash
npx pnpm tokens:build
# Output: ~405 CSS variables → packages/tokens/css/tokens.css
```

---

## tokens.css — Generated CSS Custom Properties

**Path:** `packages/tokens/css/tokens.css`
**Status:** Generated — do not edit manually (in `.gitignore`)

```css
:root {
  --color-primary-50: #E84541;
  --typography-heading-h1-mobile-light-fontsize: 32px;
  /* ... ~405 variables */
}
```

---

## typography.css — Global h1–h6 Base Styles

**Path:** `packages/tokens/css/typography.css`
**Status:** Handcrafted — commit this file

Binds `h1`–`h6` HTML elements to typography tokens (light variant, responsive with mobile/tablet/desktop breakpoints).

```css
h2 {
  font-size:      var(--typography-heading-h2-mobile-light-fontsize);
  font-weight:    var(--typography-heading-h2-mobile-light-fontweight);
  line-height:    var(--typography-heading-h2-mobile-light-lineheight);
  letter-spacing: var(--typography-heading-h2-mobile-light-letterspacing);
  color:          var(--theme-text);
}
/* + @media breakpoints for tablet (600px) and desktop (900px) */
```

**Rules:**
- `h1` + `h2`: use explicit `letterspacing` tokens
- `h3`–`h6`: use derived values (~-1% of font-size)
- Never define `h1`–`h6` selectors in app-level CSS — always in this file

---

## index.css — Token Import in Apps

**Path:** `apps/*/src/index.css`

```css
/* IMPORTANT: @import MUST come before @tailwind (CSS spec) */
@import "@ds/tokens/css/tokens.css";
@import "@ds/tokens/css/typography.css";

@import "tailwindcss";
```

**Order is critical:** `tokens.css` → `typography.css` → Tailwind. `scripts/preflight.js` validates this.

---

## tailwind.config.js — Tokens → Utility Classes

**Path:** `packages/tokens/tailwind.config.js`

Dynamically reads `tokens.json` and generates Tailwind theme extensions. This means every token is automatically available as a Tailwind class.

```javascript
// Dynamic generation from tokens.json
const dynamicTheme = generateTailwindConfig(tokens);

module.exports = {
  theme: {
    extend: {
      ...dynamicTheme,
      colors: { ...dynamicTheme.color },
      spacing: { ...dynamicTheme.spacing },
      screens: {
        'sm': '360px', 'md': '600px', 'lg': '900px',
        'xl': '1200px', '2xl': '1440px',
      }
    },
  },
};
```

Apps extend this config:

```javascript
// apps/playground/tailwind.config.js
const tokenConfig = require('../../packages/tokens/tailwind.config');
module.exports = { content: ['./src/**/*.{tsx,ts}', '../../packages/ui/**/*.{tsx,ts}'], ...tokenConfig };
```

---

## Using Tokens in Components

### Via Tailwind class (preferred)

```tsx
<div className="text-color-brand-primary bg-color-surface-default">
  Content
</div>
```

### Via CSS Custom Property (for unmapped values)

```tsx
<span style={{ fontSize: 'var(--typography-display-large-desktop-regular-fontsize)' }}>
  Text
</span>
```

### Via CSS Variable for Dynamic Theming

```tsx
<div style={{ '--fill-0': '#2A2A2A' } as React.CSSProperties}>
  <SvgComponent />
</div>
```

---

## When to Run `tokens:build`

| Situation | Build needed? |
|-----------|---------------|
| `tokens.json` was edited | **Yes** |
| New token group added | **Yes** |
| Fresh clone / `tokens.css` missing | **Yes** |
| Only component code changed | No |
| Tailwind config changed | No |
| `tokens.css` exists and `tokens.json` unchanged | No |

---

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| CSS variables not working | `tokens.css` not generated | Run `npx pnpm tokens:build` |
| Colors missing in app | `@import` missing or wrong order | Check `index.css` import order |
| Tailwind classes have no effect | Token not mapped | Check `packages/tokens/tailwind.config.js` |
| Build fails | Invalid JSON in `tokens.json` | Validate with `JSON.parse()` |

```bash
# Quick health check:
npx pnpm preflight
# → Section "3 · Token-Pipeline" shows variable count
```

---

## Adding New Tokens

1. Edit `packages/tokens/tokens.json` — add the new token in the appropriate group
2. Run `npx pnpm tokens:build` to regenerate `tokens.css`
3. The token is now available as both `var(--token-name)` and (if the group is mapped) as a Tailwind class
4. If it's a new top-level group, verify it appears in `tailwind.config.js` output
