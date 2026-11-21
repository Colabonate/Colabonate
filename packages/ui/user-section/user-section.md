# UserSection

## Purpose

User-Info-Bereich am unteren Ende des Home-Dashboards. Zeigt Avatar, Namen, Lightning-Adresse und Action-Buttons (Wallet, Settings, Profil).

## Usage

```tsx
import { UserSection } from '@ds/ui'
import AccountBalanceWallet from '@mui/icons-material/AccountBalanceWallet'
import Settings from '@mui/icons-material/Settings'
import Person from '@mui/icons-material/Person'

<UserSection
  name="Max Mustermann"
  lnAddress="max@getalby.com"
  actions={[
    { icon: <AccountBalanceWallet sx={{ fontSize: 18 }} />, label: 'Wallet', to: '/wallet' },
    { icon: <Settings sx={{ fontSize: 18 }} />, label: 'Settings', to: '/settings' },
    { icon: <Person sx={{ fontSize: 18 }} />, label: 'Profil', to: '/profile' },
  ]}
/>
```

## Props

| Prop        | Type           | Default | Description                    |
|-------------|----------------|---------|--------------------------------|
| `name`      | `string`       | –       | Anzeigename                    |
| `lnAddress` | `string`       | –       | Lightning-Adresse              |
| `avatarUrl` | `string`       | –       | Avatar-Bild-URL                |
| `actions`   | `ActionItem[]` | –       | Action-Buttons                 |
| + alle nativen `<section>`-Attribute | | | |

### ActionItem

| Feld    | Type        | Description                    |
|---------|-------------|--------------------------------|
| `icon`  | `ReactNode` | Icon (@mui/icons-material)     |
| `label` | `string`    | Button-Text                    |
| `to`    | `string`    | Link-Ziel                      |

## Tokens

| Token                 | Verwendung              |
|-----------------------|-------------------------|
| `--color-surface-*`   | Hintergrund, Buttons    |
| `--color-primary-*`   | Focus-Ring              |
| `--color-text-*`      | Name, LN-Adresse        |
| `--color-border-*`    | Avatar-Border, Card     |

## Do ✅

- MUI Icons für Action-Buttons (`sx={{ fontSize: 18 }}`)
- Zentrierte Darstellung
- Responsive: Touch-Targets ≥44px

## Don't ❌

- Keine hardcoded CSS
- Nicht in die Navigation integrieren (separate Section)
