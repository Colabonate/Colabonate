// ListingFilterSidebar — ADR-363 D6: the Marketplace filter SidePanel made
// reusable across every listing surface. Search (marketplace), BuyDashboard
// and CoopExplore render the SAME panel stack through this component: the
// SidebarPanelToggleGroup (icon row + optional Save-current-filter action),
// optional saved-filter chips, and the enabled panels stacked in toggle order
// with the shared divider logic.
//
// Consumers own the filter STATE and HANDLERS and provide the panel content
// via renderPanel — this component owns presentation + ordering only, so the
// two filter models render identically:
//   - 'server' — filters are /api/search params (Search, BuyDashboard)
//   - 'client' — filters run through the coop client pipeline (useCoopFilters)
//
// Panel order IS the render order (ADR-333 D2/D5b); panels that render null
// drop out of the stack without leaving a gap.

import type { ReactNode } from 'react'
import { cn } from '@ds/utils'
import { SidebarPanelToggleGroup, type SidebarPanelId } from '../../routes/buy/components/SidebarPanelToggleGroup'
import type { TaxonomyAxis } from '../list-browser/list-browser.types'

export function ListingFilterSidebar({
  filterModel,
  availablePanels,
  enabledPanels,
  onTogglePanel,
  effectiveTaxonomy,
  onSaveFilter,
  savedFilterChips,
  renderPanel,
}: {
  /** Which pipeline drives the panels: server-side /api/search params or the client-side coop filter pipeline. */
  filterModel: 'server' | 'client'
  availablePanels: SidebarPanelId[]
  enabledPanels: SidebarPanelId[]
  onTogglePanel: (id: SidebarPanelId) => void
  effectiveTaxonomy: TaxonomyAxis
  /** When provided, renders the Save-current-filter action in the toggle group. */
  onSaveFilter?: () => void
  /** Optional saved-filter chips block (rendered below the toggle group). */
  savedFilterChips?: ReactNode
  /** Panel content per id — return null for a panel that renders nothing on this surface/tab. */
  renderPanel: (id: SidebarPanelId) => ReactNode
}) {
  // filterModel is the semantic contract of which pipeline drives the panels
  // ('server' = /api/search params, 'client' = useCoopFilters). The component
  // renders identically for both — consumers wire the panel content and the
  // filter state to their pipeline.
  void filterModel
  return (
    <>
      <SidebarPanelToggleGroup
        enabledPanels={enabledPanels}
        onTogglePanel={onTogglePanel}
        effectiveTaxonomy={effectiveTaxonomy}
        onSaveFilter={onSaveFilter}
        availablePanels={availablePanels}
      />
      {savedFilterChips}
      {enabledPanels
        .map(id => [id, renderPanel(id)] as const)
        .filter(([, content]) => content)
        .map(([id, content], i) => (
          <div
            key={id}
            className={cn('shrink-0', i > 0 && 'pt-1.5 mt-1.5')}
            style={{ borderTop: i > 0 ? '1px solid var(--theme-border)' : 'none' }}
          >
            {content}
          </div>
        ))}
    </>
  )
}
