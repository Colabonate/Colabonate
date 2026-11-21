import type { HTMLAttributes } from 'react';
import type { NavSubItem } from '../navigation/navigation.types';

/**
 * Render-Modus der SectionMenu-Komponente. (ADR-027)
 *
 * - `cards`  → Dashboard-Karten im Content-Bereich (Titel + Icon + Beschreibung + Action)
 * - `list`   → Kompakte vertikale Liste für Floating Context Page / Options-Panel
 */
export type SectionMenuMode = 'cards' | 'list';

export interface SectionMenuProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  /** Untermenü-Einträge aus der Navigation-Config */
  items: NavSubItem[];
  /**
   * Render-Modus.
   * - `cards`: Grid-Layout mit Beschreibungstext (Default)
   * - `list`:  Kompakte Liste ohne Beschreibung
   */
  mode?: SectionMenuMode;
  /** Callback wenn ein Eintrag geklickt wird */
  onSelect?: (item: NavSubItem) => void;
}
