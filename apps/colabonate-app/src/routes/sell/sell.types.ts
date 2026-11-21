import type { ReactNode } from 'react'
import type { KPIItem } from '@ds/ui'

// ADR-368 D2: Sell is goods-only — 'stack' (agents) moved to Cooperate Manage.
export type SellTab = 'listings' | 'catalogs' | 'products'

export interface SellTabProps {
  pubkey: string
  onKpiChange: (items: KPIItem[], loading: boolean) => void
  /**
   * Page-level sub-tab pill (SubTabPill) threaded into the tab so it can
   * sit in ONE line with the tab's ListHeader on desktop (stacked on
   * mobile) via ListBrowser's headerPrefix slot.
   */
  headerPrefix?: ReactNode
}

// ADR-368 D1: Cooperate Manage shell tabs (`/coop/manage?tab=`). 'all' is the
// combined, section-grouped overview over the four content tabs (default).
export type CoopTab = 'all' | 'cooperations' | 'services' | 'stack' | 'bounties'

// Same contract as SellTabProps — a tab under a shell that owns the
// PageHeader / KPIStrip / SubTabPill / FloatingAddButton chrome.
export interface CoopTabProps {
  pubkey: string
  onKpiChange: (items: KPIItem[], loading: boolean) => void
  headerPrefix?: ReactNode
}

export type { ReactNode }
