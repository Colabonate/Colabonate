# BusinessFieldsChips

## Purpose
Read-only renderer for `Company.businessFields` (Json) as chips. This is the first time business fields are displayed publicly — today the field is edit-only (via `CategoryMultiSelect` in `SellCompanyFields.tsx`) and never shown to a prospective partner (ADR-367 D1/D6).

## Usage

```tsx
import { BusinessFieldsChips } from '@ds/ui'

<BusinessFieldsChips fields={company.businessFields} />
<BusinessFieldsChips fields={company.businessFields} label="Industries" showIcon={false} />
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `fields` | `BusinessField[] \| null` | — | `Company.businessFields` (already parsed to an array by the API, ADR-229) |
| `label` | `string` | `"Business Fields"` | Section header label |
| `showIcon` | `boolean` | `true` | Show the tag icon |
| + all native `<div>` attributes | | | |

## Tokens

| Token | Usage |
|-------|-------|
| `--theme-bg-subtle` | Chip background |
| `--theme-border` | Chip border |
| `--theme-text` | Chip text |
| `--theme-text-muted` | Header label, icon |

## Do
- Pass the parsed `Company.businessFields` array directly
- Use as the read-side counterpart to `SellCompanyFields`' `CategoryMultiSelect`

## Don't
- Pass a JSON string — expect the parsed array
- Render edit controls here
