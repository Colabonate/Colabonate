/**
 * ListHeader – Types
 *
 * Wiederverwendbarer Listen-Header mit Tabs und optionalen Aktionen rechts.
 * Kombiniert MUI Tabs (Filter) mit View-Toggle, Sort-Button etc. in einer Zeile.
 * Umhüllt den gesamten Bereich mit einem subtilen Surface-Background.
 */

import type { ReactNode } from 'react'

/** Compatibility slot props used by legacy list-page layouts */
export interface ListHeaderSlotProps {
  /** Search input / search bar slot */
  searchSlot?: ReactNode
  /** Sort control slot */
  sortSlot?: ReactNode
  /** Right-side action slot (view toggle, panel toggle, etc.) */
  rightSlot?: ReactNode
  /** Result count number */
  resultCount?: number
  /** Label shown next to the result count */
  resultLabel?: string
}

/** Einzelner Tab-Eintrag */
export interface ListHeaderTab {
  /** Eindeutiger Schlüssel */
  key: string
  /** Anzeigetext */
  label: string
}

/** Optionaler Eintrag für die rechte Aktions-Leiste */
export interface ListHeaderAction {
  /** Eindeutiger Schlüssel */
  key: string
  /** React-Element (z.B. Sort-Button, Filter-Chip) */
  element: ReactNode
}

export interface ListHeaderProps extends ListHeaderSlotProps {
  /** Tab-Konfiguration (leeres Array = tabs ausblenden) */
  tabs: ListHeaderTab[]
  /** Aktiver Tab-Key */
  activeTab: string
  /** Callback bei Tab-Wechsel */
  onTabChange: (key: string) => void
  /** Optionale Aktionen rechts (Sort-Button, Filter-Chips, etc.) */
  actions?: ListHeaderAction[]
  /** Zusätzlicher Abstand nach oben */
  mt?: number
  /** Zusätzlicher Abstand nach unten */
  mb?: number
  /** View-Modus für den integrierten View-Toggle */
  viewMode?: 'gallery' | 'list'
  /** Callback bei View-Mode-Wechsel (aktiviert den integrierten View-Toggle) */
  onViewModeChange?: (mode: 'gallery' | 'list') => void
}
