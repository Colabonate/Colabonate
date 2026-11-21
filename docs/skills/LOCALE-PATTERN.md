# SKILL: Locale Formatting Pattern

Centralized locale formatting via `LocaleContext` — single source of truth for number, date, and time formatting.

---

## When to Use

- Formatting numbers, dates, or times in any component
- Creating new components that display prices, dates, or timestamps
- Refactoring hardcoded `.toLocaleString()` / `.toLocaleDateString()` / `.toLocaleTimeString()` calls

---

## Available Functions

### Inside React Components / Hooks (via `useTranslation()`)

```typescript
import { useTranslation } from '../../contexts/LocaleContext'

function MyComponent() {
  const { formatNumber, formatDate, formatTime } = useTranslation()

  return (
    <div>
      <span>{formatNumber(1234)}</span>           {/* "1,234" */}
      <span>{formatDate(new Date())}</span>        {/* "04/05/2026" */}
      <span>{formatTime(new Date())}</span>        {/* "2:30 PM" */}
    </div>
  )
}
```

### Outside React (Module-Level Helpers)

```typescript
import { formatLocaleNumber, formatLocaleDate, formatLocaleTime } from '../../contexts/LocaleContext'

export const formatted = formatLocaleNumber(1234)  // "1,234"
```

---

## Replacement Reference

| Before (❌ hardcoded) | After (✅ centralized) |
|-----------------------|-----------------------|
| `price.toLocaleString('de-DE')` | `formatNumber(price)` |
| `date.toLocaleDateString('de-DE', {...})` | `formatDate(date, {...})` |
| `time.toLocaleTimeString('en-GB', {...})` | `formatTime(time, {...})` |
| `value.toLocaleString()` (no args) | `formatNumber(value)` |

---

## Critical: Inner Component Hook Scoping

Each inner React function component needs its **OWN** `useTranslation()` hook. Hooks from a parent component are NOT accessible in child function components defined in the same file.

```typescript
// ❌ WRONG — formatNumber not accessible in ItemRow
export function ItemList({ items }) {
  const { formatNumber } = useTranslation()
  return items.map(item => <ItemRow item={item} />)
}

// ✅ CORRECT — each component has its own hook
export function ItemList({ items }) {
  return items.map(item => <ItemRow item={item} />)
}

function ItemRow({ item }) {
  const { formatNumber } = useTranslation()
  return <span>{formatNumber(item.price)}</span>
}
```

> **Build will fail** with `noUnusedLocals: true` if you declare a hook in a component that doesn't use the destructured variable.

---

## Files

- **Context:** `apps/colabonate-app/src/contexts/LocaleContext.tsx`
- **JSON declaration:** `apps/colabonate-app/src/types/json.d.ts`
- **Translation data:** `packages/data/categories/i18n/en.json`
- **ADR:** `docs/decisions/076-centralized-locale-formatting.md`

---

## Conventions

- **No hardcoded locale strings** — never use `'de-DE'`, `'en-GB'`, `'en-US'` directly
- **No bare `.toLocaleString()`** — always go through `formatNumber()`
- **JSON imports** use relative paths (not `@ds/data` alias) due to `verbatimModuleSyntax`
- **V1: EN-only** — locale is fixed to `'en'`, extensible for `'de'` in v2
