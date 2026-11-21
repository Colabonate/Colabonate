# MainMenu

Responsive Hauptnavigation – Bottom Nav Bar (Mobile) + Sticky Top Bar (Desktop).
Unterstützt **2-Ebenen-Navigation** mit animiertem Übergang, Back-Button und Breadcrumb.

Figma Node: `505:66660`

---

## Varianten

| Variante  | Beschreibung |
|-----------|--------------|
| `Default` | Home + Burger (keine Tabs aktiv) |
| `START`   | Home + 4 Tabs + Start-Burger |
| `Store`   | Tabs, Sell aktiv |
| `Buy`     | Tabs, Buy aktiv |
| `Help`    | Tabs, CoOp aktiv |
| `Wallet`  | Tabs, Wallet aktiv |
| `Variant9`| Alternative Tabs (Categories/Wallet/Profile/Cart) |
| `noMenu`  | Nur Home-Button |
| `BarOnly` | Leere Bar |
| `Init`    | Wie START |

---

## Render-Modus (`mode`)

| Wert      | Verhalten |
|-----------|-----------|
| `auto`    | Responsive: Bottom Nav `< 600px`, Top Bar `≥ 600px` |
| `mobile`  | Immer Bottom Nav |
| `desktop` | Immer Top Bar |

---

## Theme (`theme`)

| Wert    | Hintergrund | Text |
|---------|-------------|------|
| `light` | Weiß (`--color-neutral-white`) | Dunkel |
| `dark`  | `--color-secondary-80` | Hell |

---

## 2-Ebenen-Navigation

### Wie es funktioniert

Wenn ein Tab **`subItems`** hat, öffnet ein Klick darauf die 2. Ebene:

- **Mobile**: Bottom Sheet Overlay mit Liste der Sub-Items (animiert von unten)
- **Desktop**: Sekundäre Nav-Leiste unter der Top Bar (animiert einfahrend)

In der 2. Ebene:
- **Back-Button** links → zurück zur 1. Ebene
- **Breadcrumb** zeigt den Namen des aktiven Parent-Tabs
- Sub-Items sind klickbar und feuern `onClick` auf dem jeweiligen `MainMenuSubItem`

### Sub-Item Dot-Indicator

Tabs mit `subItems` zeigen einen kleinen Dot-Indikator oben rechts am Icon – aktiv (gefüllt) wenn das Untermenü geöffnet ist.

---

## Props

```tsx
interface MainMenuProps {
  variant?: MainMenuVariant;    // Default: 'Default'
  mode?: MainMenuMode;          // Default: 'auto'
  theme?: MainMenuTheme;        // Default: 'light'

  // Callbacks
  onHome?: () => void;
  onBurger?: () => void;
  onBack?: () => void;          // Aufgerufen beim Back-Button der 2. Ebene
  onLevelChange?: (level: MainMenuLevel, activeParent?: string) => void;

  // Tab-Konfiguration
  tabs?: MainMenuTab[];         // Override der Standard-Tabs
  activeTab?: number;           // Aktiver Tab-Index (0-based)

  // Desktop Top Bar
  currentPath?: string;         // z. B. '/' oder '/offers'
  onNavigate?: (to: string) => void;

  // Branding
  rightSlot?: React.ReactNode;  // Optionaler Slot ganz rechts in der Desktop Top Bar
  brandBadge?: React.ReactNode; // Badge oben rechts am Logo (Desktop + Mobile), z. B. BETA
}
```

### `MainMenuTab`

```tsx
interface MainMenuTab {
  label: string;
  icon: ReactNode;
  subItems?: MainMenuSubItem[];  // → aktiviert 2-Ebenen-Nav für diesen Tab
  onClick?: () => void;
}
```

### `MainMenuSubItem`

```tsx
interface MainMenuSubItem {
  label: string;
  description?: string;
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  badge?: string;               // z. B. 'NEU', 'BETA'
}
```

---

## Usage

### Minimal (Standard-Tabs, kein Submenü)

```tsx
<MainMenu variant="START" theme="light" onHome={() => navigate('/')} />
```

### Mit 2-Ebenen-Navigation

```tsx
const tabs: MainMenuTab[] = [
  {
    label: 'Buy',
    icon: <IconBuy />,
    subItems: [
      { label: 'Marketplace', description: 'Alle Angebote', onClick: () => navigate('/buy') },
      { label: 'Deals', description: 'Sonderangebote', badge: 'NEU', onClick: () => navigate('/deals') },
    ],
  },
  // ...
];

<MainMenu
  variant="Buy"
  theme="dark"
  tabs={tabs}
  activeTab={0}
  onLevelChange={(level, parent) => console.log(level, parent)}
/>
```

### Level-Change Callback

```tsx
<MainMenu
  variant="START"
  onLevelChange={(level, activeParent) => {
    if (level === 'sub') {
      console.log(`Ebene 2 geöffnet: ${activeParent}`);
    } else {
      console.log('Zurück zur Hauptnavigation');
    }
  }}
/>
```

---

## Tokens

| Token | Verwendung |
|-------|-----------|
| `--color-action-primary-default` | Aktiver Tab, Back-Button, Primary-Akzente |
| `--color-action-primary-10` | Aktiver Tab-Hintergrund, Level-Indikatoren |
| `--color-action-primary-active` | Gedrückter Start-Button |
| `--color-secondary-80` | Dark-Theme Hintergrund |
| `--color-secondary-90` | Dark-Theme Dropdown/Drawer |
| `--color-neutral-white` | Light-Theme Hintergrund |
| `--color-neutral-5` | Inaktive Tab-Icons (Light) |
| `--color-neutral-6` | Inaktive Tab-Icons (Dark) |

---

## Do / Don't

**Do:**
- `tabs` mit `subItems` verwenden für kontextuelle Untermenüs
- `onLevelChange` nutzen um App-State mit der Nav-Ebene zu synchronisieren
- `theme` konsistent durch die gesamte Seite durchreichen

**Don't:**
- Keine hardcodierten Farben in `subItems.icon` – `currentColor` verwenden
- `mode="mobile"` nicht in Production für Desktop-Nutzer – nur für Playground/Tests
- Maximal 6 `subItems` pro Tab (UI wird sonst zu dicht auf Mobile)
