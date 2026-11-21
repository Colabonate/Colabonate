# AddressBlock

## Purpose
Read-only display of a `Company` address (`address` / `zipCode` / `city` / `country`) as a labeled block, so `/u/:pubkey`, `/c/:companyId`, and `/sell/company` share one rendering instead of three bespoke layouts (ADR-367 D1).

## Usage

```tsx
import { AddressBlock } from '@ds/ui'

<AddressBlock address={company.address} zipCode={company.zipCode} city={company.city} country={company.country} />
<AddressBlock address={company.address} city={company.city} country={company.country} label="Location" showIcon={false} />
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `address` | `string \| null` | — | Street + house number |
| `zipCode` | `string \| null` | — | ZIP code |
| `city` | `string \| null` | — | City |
| `country` | `string \| null` | — | Country |
| `label` | `string` | `"Address"` | Section header label |
| `showIcon` | `boolean` | `true` | Show the map-pin icon |
| `mapLinkSlot` | `ReactNode` | — | Optional map/geocoding link (FU-648) |
| + all native `<div>` attributes | | | |

## Tokens

| Token | Usage |
|-------|-------|
| `--theme-text` | Address lines |
| `--theme-text-muted` | Header label, icon |

## Do
- Pass `Company` fields directly
- Use the `mapLinkSlot` for a future map link (not built yet)

## Don't
- Render a form — this is read-only; edit forms live in `/sell/company/*`
