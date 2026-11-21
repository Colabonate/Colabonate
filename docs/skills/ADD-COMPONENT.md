# SKILL: Add New Component to Design System

Step-by-step guide for adding a new UI component.

---

## Checklist

```
[ ] 1. Create directory: packages/ui/<name>/
[ ] 2. Create types file: <name>.types.ts
[ ] 3. Create component: <name>.tsx
[ ] 4. Create documentation: <name>.md
[ ] 5. Export in packages/ui/index.ts
[ ] 6. Create or extend playground page
[ ] 7. Run preflight check: pnpm preflight
```

---

## Step 1: Create Directory

```bash
# Example: New component "Card"
mkdir packages/ui/card
```

Files to create:
```
packages/ui/card/
├─ card.types.ts   ← TypeScript types
├─ card.tsx        ← Implementation
└─ card.md         ← Documentation
```

---

## Step 2: Types File (`<name>.types.ts`)

```typescript
// packages/ui/card/card.types.ts
import { HTMLAttributes, ReactNode } from 'react';

export type CardVariant = 'default' | 'elevated' | 'outlined';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  children: ReactNode;
}
```

**Rules:**
- Props always extend the appropriate HTML attribute interface (`HTMLAttributes<...>`)
- Exclude conflicting native HTML attribute props via `Omit<..., 'size'>`
- For polymorphic components: add `as?: ElementType`

---

## Step 3: Component (`<name>.tsx`)

```typescript
// packages/ui/card/card.tsx
import { cn } from '@ds/utils';
import type { CardProps, CardVariant } from './card.types';

const variantClasses: Record<CardVariant, string> = {
  default:  'bg-white border border-gray-200',
  elevated: 'bg-white shadow-lg',
  outlined: 'bg-transparent border-2 border-gray-300',
};

export function Card({ variant = 'default', children, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl p-6',
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
```

**Rules:**
- Always use `cn()` from `@ds/utils` for class composition
- Variants as record lookup, not `if/else`
- Styling only via token-based Tailwind classes or CSS custom properties
- Always forward `className` and `...props` (native HTML attributes)
- **No inline styles with hex values**
- **No hardcoded spacing/colors** – only token classes

---

## Step 4: Documentation (`<name>.md`)

```markdown
# Card

## Purpose
Brief description – what does the component do?

## Usage

\`\`\`tsx
import { Card } from '@ds/ui';

<Card>Content</Card>
<Card variant="elevated">Elevated Card</Card>
\`\`\`

## Props

| Prop      | Type                               | Default     | Description     |
|-----------|------------------------------------|-------------|-----------------|
| `variant` | `default \| elevated \| outlined`  | `default`   | Visual variant |
| + all native `<div>` attributes |    |             |                 |

## Tokens

| Token              | Usage        |
|--------------------|---------------|
| `--color-surface-*`| Background colors |

## Do ✅
- ...

## Don't ❌
- ...
```

---

## Step 5: Export in `packages/ui/index.ts`

```typescript
// packages/ui/index.ts – keep existing exports, add new line:
export { Card } from './card/card';
export type { CardProps, CardVariant } from './card/card.types';
```

**Important:** Always export both the component and the types.

---

## Step 6: Playground Page

### Create New Page (for standalone component)

```typescript
// apps/playground/src/pages/CardPage.tsx
import { Card } from '@ds/ui';

export function CardPage() {
  return (
    <div className="p-8 space-y-8">
      <h1 className="text-3xl font-bold">Card</h1>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Variants</h2>
        <div className="flex gap-4 flex-wrap">
          <Card variant="default">Default</Card>
          <Card variant="elevated">Elevated</Card>
          <Card variant="outlined">Outlined</Card>
        </div>
      </section>
    </div>
  );
}
```

### Register in App.tsx

```typescript
// apps/playground/src/App.tsx – add navigation:
import { CardPage } from './pages/CardPage';

// In route configuration:
{ path: 'card', element: <CardPage /> }
```

---

## Step 7: Verification

```bash
# 1. Preflight check (verifies all files are correct)
npx pnpm preflight

# 2. Start playground and visually inspect
npx pnpm playground
```

Open `http://localhost:5173` and navigate to the new page.

---

## Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| Tailwind classes not working | Token not in Tailwind config | Check class in `packages/tokens/tailwind.config.js` |
| TypeScript errors in Playground | `rootDir` constraint | Known pre-existing bug, does not block Vite build |
| `cn` not found | Missing import | Add `import { cn } from '@ds/utils'` |
| Component not found | Missing export | Check `packages/ui/index.ts` |

---

## Template Structure at a Glance

```
packages/ui/<name>/
├─ <name>.types.ts    ← export type Variant = ...; export interface Props extends HTML... {}
├─ <name>.tsx         ← import { cn } from '@ds/utils'; export function Name({ ...props }) {}
└─ <name>.md          ← # Name \n ## Purpose \n ## Usage \n ## Props \n ## Tokens \n ## Do/Don't
```
