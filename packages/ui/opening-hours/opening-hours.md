# OpeningHours

## Purpose
Displays business opening hours with today's status (open/closed), live open-now indicator, and an expandable weekly schedule.

## Usage

```tsx
import { OpeningHours } from '@ds/ui'

<OpeningHours hours={company.openingHours} />
<OpeningHours hours={company.openingHours} compact />
<OpeningHours hours={company.openingHours} label="Store Hours" showIcon={false} />
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `hours` | `Partial<OpeningHoursData> \| null \| undefined` | — | `{ mon: { start: "09:00", end: "17:00" }, sat: null, ... }` — the parsed object, never a JSON string |
| `compact` | `boolean` | `false` | Show only today's hours, no expand toggle |
| `showIcon` | `boolean` | `true` | Show the Clock icon |
| `label` | `string` | `"Opening Hours"` | Section header label |
| + all native `<div>` attributes | | | |

## Tokens

| Token | Usage |
|-------|-------|
| `--theme-text` | Day/time text |
| `--theme-text-muted` | Header label, closed days, icon |
| `--color-primary-50` | Today highlight, TODAY badge |
| `--color-status-success` | Open-now dot |
| `--color-status-error` | Closed-now dot |

## Do
- Use for company/store opening hours display
- Pass the parsed `Company.openingHours` object directly (native Prisma `Json?` field, ADR-229)

## Don't
- Use for editable hours (this is read-only display)
- Pass a JSON string (`JSON.stringify`'d) — the component expects the object, not its serialized form
