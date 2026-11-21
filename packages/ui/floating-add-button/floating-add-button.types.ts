/**
 * FloatingActionButton – FAB mit Context-Aware Dropdown
 *
 * Positioniert sich sticky oben rechts im Content-Bereich.
 * Das Submenu öffnet sich nach unten links.
 * Liest Aktionen dynamisch aus FABContext (useFABActions).
 */

export type FloatingActionButtonTheme = 'light' | 'dark';

export type FloatingActionButtonSize = 'sm' | 'md' | 'lg';

export interface FABAction {
  id: string
  label: string
  info?: string
  group: string
  icon?: 'plus' | 'briefcase' | 'package' | 'handshake' | 'bot'
  onClick: () => void
}

export interface FloatingActionButtonProps {
  /** Color scheme – 'light' or 'dark'. Default: auto from context */
  theme?: FloatingActionButtonTheme;
  /** Button size. Default: 'md' */
  size?: FloatingActionButtonSize;
  /** Distance from right edge in px. Default: 0 */
  offsetRight?: number;
  /** Distance from top edge in px. Default: 0 */
  offsetTop?: number;
  /** Additional CSS classes */
  className?: string;
  /** Dynamic actions from context. When empty, FAB is hidden. */
  actions?: FABAction[];
  /**
   * When true, the FAB fades + blurs out and drifts slightly upward as the
   * page scrolls down from the top, revealing the content beneath it.
   * The motion is capped at a fixed scroll distance. Default: false.
   */
  scrollFade?: boolean;
  /** @deprecated Use actions prop from FABContext instead */
  onCreateItem?: () => void;
  /** @deprecated Use actions prop from FABContext instead */
  onCreateService?: () => void;
}
