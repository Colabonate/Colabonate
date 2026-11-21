# PartnerAvatar

## Purpose

Avatar mit Name und Rolle für die Partners-Section auf dem Home-Dashboard. Wird innerhalb eines HorizontalScroll-Patterns verwendet.

## Usage

```tsx
import { PartnerAvatar } from '@ds/ui'

<PartnerAvatar
  name="Alice"
  role="Developer"
  avatarUrl="/img/alice.jpg"
  onClick={() => navigate('/partner/alice')}
/>
```

## Props

| Prop        | Type         | Default | Description                    |
|-------------|--------------|---------|--------------------------------|
| `name`      | `string`     | –       | Anzeigename                    |
| `role`      | `string`     | –       | Rolle / Funktion               |
| `avatarUrl` | `string`     | –       | Avatar-Bild-URL                |
| `onClick`   | `() => void` | –       | Click-Handler (optional)       |
| + alle nativen `<div>`-Attribute | | | |

## Tokens

| Token                 | Verwendung              |
|-----------------------|-------------------------|
| `--color-surface-*`   | Avatar-Placeholder BG   |
| `--color-text-*`      | Name, Rolle             |
| `--color-border-*`    | Avatar-Border           |

## Do ✅

- Snap-Start für horizontales Scrollen
- Initial-Buchstabe als Fallback ohne Bild

## Don't ❌

- Keine hardcoded Größen oder Farben
- Nicht ohne HorizontalScroll-Wrapper
