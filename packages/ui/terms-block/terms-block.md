# TermsBlock

## Purpose
Read-only display of `Company.terms` (markdown/plain text). Today `terms` is written in `SellCompanyTerms.tsx` but never shown to a prospective partner anywhere — this is the first public read renderer (ADR-367 D6).

## Usage

```tsx
import { TermsBlock } from '@ds/ui'

<TermsBlock terms={company.terms} />
<TermsBlock terms={company.terms} label="AGB" showIcon={false} />
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `terms` | `string \| null` | — | `Company.terms` (markdown or plain text) |
| `label` | `string` | `undefined` | Optional section header; omit to render the text only |
| `showIcon` | `boolean` | `true` | Show the gavel icon |
| + all native `<div>` attributes | | | |

## Tokens

| Token | Usage |
|-------|-------|
| `--theme-text` | Terms text |
| `--theme-text-muted` | Header label, icon |

## Do
- Pass `Company.terms` directly
- Wrap in a section card (e.g. `CompanyBlock`'s "Terms & Conditions" section)

## Don't
- Render edit controls here — editing lives in `SellCompanyTerms.tsx`
- Render markdown with a heavy renderer — `whitespace-pre-line` preserves the author's line breaks
