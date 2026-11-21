# NavButton

A compact button component designed for navigation bars (bottom/top navigation). Displays an icon with an optional label below.

## Purpose

Used in `MainMenu` component for the tab navigation items. Provides consistent styling for navigation actions with proper states (default, hover, active).

## Usage

```tsx
import { NavButton } from '@ds/ui';

// Basic usage
<NavButton 
  icon={<MyIcon />}
  label="Home"
  onClick={() => {}}
/>

// Active state
<NavButton 
  icon={<IconBuy />}
  label="Buy"
  variant="active"
/>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'default' \| 'active' \| 'hover'` | `'default'` | Visual state of the button |
| `size` | `'small' \| 'medium'` | `'medium'` | Size variant |
| `icon` | `ReactNode` | - | Icon element to display |
| `label` | `string` | - | Label text below icon |
| `fullWidth` | `boolean` | `false` | Whether button takes full width |

## Tokens Used

- `var(--color-action-primary-default)` - Active state icon color
- `var(--color-action-neutral-hover)` - Hover state icon color
- `var(--color-neutral-5)` - Default icon color
- `var(--color-neutral-black)` - Default label color
- `var(--color-neutral-4)` - Hover label color
- `var(--typography-fontfamily-sans)` - Font family

## Do's

- Use for tab navigation in MainMenu
- Provide accessible label via `aria-label` for icon-only buttons
- Use `variant="active"` for currently selected tab

## Don'ts

- Don't use for primary actions (use Button component)
- Don't omit `label` without providing `aria-label`