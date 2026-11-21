import type { HTMLAttributes, ReactNode } from 'react';

/**
 * MainMenu – Navigationsleiste (Bottom Navigation + Desktop Top Bar)
 * Figma Node: 505:66660
 *
 * Varianten decken alle App-Zustände ab:
 * - Default  → Nur Home + Burger (kein Tab aktiv)
 * - START    → Home + 4 Action-Tabs + großer Burger-Button
 * - noMenu   → Nur Home (kein Burger, kein Tab)
 * - BarOnly  → Leere Bar (nur Hintergrund)
 * - Store    → Store-spezifische Tabs (Buy/CoOp/Wallet, CoOp aktiv)
 * - Help     → Tabs (Buy/CoOp/Wallet), Help aktiv (kein spez. Tab)
 * - Wallet   → Tabs, Wallet aktiv
 * - Buy      → Tabs, Buy aktiv
 * - Variant9 → Alternative Tabs (Categories/Wallet/Profile/Shopping Cart)
 * - Init     → Initialisierungs-Zustand (wie START)
 */
export type MainMenuVariant =
  | 'Default'
  | 'START'
  | 'noMenu'
  | 'BarOnly'
  | 'Store'
  | 'Help'
  | 'Wallet'
  | 'Buy'
  | 'Variant9'
  | 'Init';

/**
 * Einzelner Eintrag im Untermenü (2. Ebene)
 */
export interface MainMenuSubItem {
  /** Angezeigter Label */
  label: string;
  /** Optionale Beschreibung / Subtitle */
  description?: string;
  /** Optionales Icon (ReactNode für Mobile, string-Key für Desktop-Dropdown) */
  icon?: ReactNode;
  /** Icon-Key für Desktop-Dropdown (maps to SubMenuIcon, z.B. 'categories', 'vendors') */
  iconKey?: string;
  /** Callback beim Klick */
  onClick?: () => void;
  /** Navigation path (for active-state detection in MobileNav) */
  path?: string;
  /** Deaktivierter Zustand */
  disabled?: boolean;
  /** Badge-Text (z. B. "NEU", "BETA") */
  badge?: string;
}

/** Definiert einen einzelnen Tab-Eintrag in der Navigation (1. Ebene) */
export interface MainMenuTab {
  /** Angezeigter Label (uppercase) */
  label: string;
  /** Icon-Slot – React-Node (SVG) */
  icon: ReactNode;
  /**
   * Untermenü-Einträge (2. Ebene).
   * Wenn gesetzt, öffnet ein Klick auf diesen Tab die Sub-Navigation.
   */
  subItems?: MainMenuSubItem[];
  /** Nur Icon anzeigen (Desktop Top Bar) – kein Label-Text */
  iconOnly?: boolean;
  /** Callback beim Klick auf den Tab */
  onClick?: () => void;
  /** Callback beim Hovern über den Tab */
  onMouseEnter?: () => void;
  /** Callback beim Verlassen des Tabs */
  onMouseLeave?: () => void;
}

/**
 * Aktuelle Navigationsebene:
 * - 'root' → 1. Ebene (Haupt-Tabs)
 * - 'sub'  → 2. Ebene (Untermenü eines ausgewählten Tabs)
 */
export type MainMenuLevel = 'root' | 'sub';

/**
 * Steuert welcher Navigations-Modus gerendert wird:
 * - 'auto'    → Responsive: Bottom Nav auf Mobile, Top Bar auf Desktop (default)
 * - 'mobile'  → Immer Bottom Nav (z.B. im Playground / Storybook-Isolation)
 * - 'desktop' → Immer Top Bar
 */
export type MainMenuMode = 'auto' | 'mobile' | 'desktop';

/**
 * Steuert das Farbschema der Navigation:
 * - 'light' → Helles Design (weißer Hintergrund, dunkler Text)
 * - 'dark'  → Dunkles Design (#252C33 Hintergrund, heller Text)
 */
export type MainMenuTheme = 'light' | 'dark';

export interface MainMenuProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Figma-Variante der MainMenu-Komponente */
  variant?: MainMenuVariant;

  /**
   * Render-Modus: 'auto' (responsive), 'mobile' (Bottom Nav), 'desktop' (Top Bar).
   * Default: 'auto'
   */
  mode?: MainMenuMode;

  /**
   * Farbschema: 'light' (hell) oder 'dark' (dunkel).
   * Default: 'light'
   */
  theme?: MainMenuTheme;

  /** Callback für den Home-Button */
  onHome?: () => void;

  /** Callback für den Search-Button (Desktop: nach Home-Logo, Mobile: nach Home in Bottom Nav) */
  onSearch?: () => void;

  /** Callback für den Burger-Menu-Button */
  onBurger?: () => void;

  /** Callback für den Back-Navigation-Button (falls sichtbar) */
  onBack?: () => void;

  /**
   * Optionale Tab-Overrides – falls nicht gesetzt, werden
   * die Figma-Standard-Tabs für die jeweilige Variante gerendert.
   */
  tabs?: MainMenuTab[];

  /** Welcher Tab ist aktiv (by index, 0-based) */
  activeTab?: number;

  /** Welcher Tab ist gehovered (by index, 0-based) - für interaktive Demos */
  hoveredTab?: number;

  /** Aktueller Pfad für Desktop-Navigation (für active State) */
  currentPath?: string;

  /** Callback für Navigation in Desktop Top Bar */
  onNavigate?: (to: string) => void;

  /** Optionaler Slot ganz rechts in der Desktop Top Bar (z.B. Theme-Toggle) */
  rightSlot?: React.ReactNode;

  /** Optionaler Badge-Slot oben rechts am Brand-Logo – Desktop Top Bar und Mobile Bottom Nav (z.B. BETA-Badge) */
  brandBadge?: React.ReactNode;

  /**
   * Callback wenn sich die Navigationsebene ändert.
   * Wird aufgerufen wenn zwischen Root (1. Ebene) und Sub (2. Ebene) gewechselt wird.
   */
  onLevelChange?: (level: MainMenuLevel, activeParent?: string) => void;

  /**
   * Page-Header-Inhalt für die Mobile Bottom Nav – nur sichtbar wenn keine Tabs
   * vorhanden sind (z.B. Variant "Default"). Füllt den Mittelbereich zwischen
   * Logo und Burger-Button mit Back-Button, Icon, Titel und optionalem Subtitle.
   */
  mobileHeader?: {
    /** Seiten-Titel (wird einzeilig + truncated angezeigt) */
    title: string;
    /** Optionaler Untertitel (wird einzeilig + truncated unter dem Titel angezeigt) */
    subtitle?: string;
    /** Optionales kleines Icon links vom Titel (ReactNode, empfohlen: 20×20px SVG) */
    icon?: ReactNode;
    /** Wenn gesetzt, wird ein Back-Button links angezeigt */
    onBack?: () => void;
  };
}
