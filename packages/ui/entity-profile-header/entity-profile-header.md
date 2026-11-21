# EntityProfileHeader

## Purpose
Shared banner + avatar + title header for both identity shapes (`user` Nostr Kind-0 and `company`), replacing the two hand-rolled banner/avatar treatments previously duplicated across `UserProfile.tsx` and `CompanyProfile.tsx` (ADR-367 D1).

## Usage

```tsx
import { EntityProfileHeader } from '@ds/ui'

<EntityProfileHeader
  variant="user"
  bannerUrl={profile.banner}
  avatarUrl={profile.picture}
  title={displayName}
  badges={<IdentityLevelBadge level={level} size="small" />}
  subtitle={<span>{profile.nip05}</span>}
/>

<EntityProfileHeader
  variant="company"
  bannerUrl={company.bannerUrl}
  avatarUrl={company.logoUrl}
  title={company.name}
  subtitle={<span>{company.city}</span>}
/>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'user' \| 'company'` | — | Drives avatar fallback icon (person/storefront) and avatar shape (circle/square) |
| `bannerUrl` | `string \| null` | `null` | Full-bleed background image with surface fade |
| `avatarUrl` | `string \| null` | `null` | Avatar/logo image overlaying the fallback |
| `title` | `string` | — | Display name / company name |
| `subtitle` | `ReactNode` | — | Node below the title row |
| `badges` | `ReactNode` | — | Inline nodes right of the title |
| `avatarFallback` | `ReactNode` | first title letter | Fallback when no avatar (or avatar fails to load) |
| + all native `<div>` attributes | | | |

## Tokens

| Token | Usage |
|-------|-------|
| `--theme-surface` | Card background |
| `--theme-border` | Card border |
| `--theme-bg-subtle` | Banner placeholder background |
| `--color-primary-10` / `--color-primary-50` | Avatar fallback background / text |
| `--theme-text` | Title |
| `--theme-text-muted` | (consumers pass subtitle content) |

## Do
- Use for both `/u/:pubkey` and `/c/:companyId` headers
- Pass `avatarFallback` when the source has a custom fallback beyond the first letter

## Don't
- Embed offers, reputation, or contact data here — this is header-only; compose those as separate block sections
- Hardcode banner/avatar sizes outside the component
