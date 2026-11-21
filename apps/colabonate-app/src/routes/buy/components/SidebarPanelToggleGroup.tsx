// SidebarPanelToggleGroup — ADR-333 D2. Fixed-order icon toggle group for
// the marketplace sidebar's configurable panels (locations/images/
// categories/agentFilters). The icons never move — only their active state
// and the resulting panel stack change. The Categories slot is the one dynamic
// entry: its icon/label swap between LayoutGrid/"Categories" and
// Hash/"Gamma Tags" driven by `effectiveTaxonomy` (read-only — the axis
// itself is switched only via ListBrowser's header control).
//
// V2 (user feedback, 2026-08-23): no position-number badges — the ordered
// stack itself shows the click order. The Save-current-filter ACTION renders
// as a subdued fifth button after a subtle divider: an action, not a toggle
// (no aria-pressed), styled with the app's save-filter tint and explained
// by a native title tooltip so the icon-only button stays understandable.

import { MapPin, ImageOff, LayoutGrid, Hash, Bot, Star } from 'lucide-react'
import type { TaxonomyAxis } from '../../../components/list-browser/list-browser.types'

export type SidebarPanelId = 'locations' | 'images' | 'categories' | 'agentFilters'

export function SidebarPanelToggleGroup({
  enabledPanels,
  onTogglePanel,
  effectiveTaxonomy,
  onSaveFilter,
  // ADR-363 D6: which icons the group offers. Marketplace surfaces default to
  // all four; coop surfaces pass a subset (e.g. ['locations', 'images']) so
  // the row only offers panels their client pipeline actually implements.
  availablePanels = ['locations', 'images', 'categories', 'agentFilters'],
}: {
  enabledPanels: SidebarPanelId[]
  onTogglePanel: (id: SidebarPanelId) => void
  effectiveTaxonomy: TaxonomyAxis
  /** When provided, renders the Save-current-filter action as a subdued fifth button. */
  onSaveFilter?: () => void
  availablePanels?: SidebarPanelId[]
}) {
  const isGamma = effectiveTaxonomy === 'gamma'
  const panels: Array<{ id: SidebarPanelId; label: string; icon: React.ReactNode }> = [
    { id: 'locations', label: 'Locations', icon: <MapPin size={13} /> },
    { id: 'images', label: 'Images', icon: <ImageOff size={13} /> },
    { id: 'categories', label: isGamma ? 'Gamma Tags' : 'Categories', icon: isGamma ? <Hash size={13} /> : <LayoutGrid size={13} /> },
    { id: 'agentFilters', label: 'Agent Filters', icon: <Bot size={13} /> },
  ]
  return (
    <div className="flex items-center gap-1 pb-1.5 mb-1.5" style={{ borderBottom: '1px solid var(--theme-border)' }}>
      {panels
        .filter(p => availablePanels.includes(p.id))
        .map(({ id, label, icon }) => {
        const active = enabledPanels.includes(id)
        return (
          <button
            key={id}
            onClick={() => onTogglePanel(id)}
            aria-pressed={active}
            title={label}
            className="flex items-center justify-center rounded-md cursor-pointer transition-all duration-150 flex-1"
            style={{
              height: 26,
              background: active ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
              color: active ? 'white' : 'var(--theme-text-muted)',
              border: active ? 'none' : '1px solid var(--theme-border)',
            }}
          >
            {icon}
          </button>
        )
      })}
      {onSaveFilter && (
        <>
          <div aria-hidden style={{ width: 1, height: 16, background: 'var(--theme-border)', flexShrink: 0 }} />
          <button
            onClick={onSaveFilter}
            title="Save current filter"
            aria-label="Save current filter"
            className="flex items-center justify-center rounded-md cursor-pointer transition-all duration-150"
            style={{
              height: 26,
              width: 26,
              flexShrink: 0,
              background: 'rgba(99,179,237,0.08)',
              border: '1px solid rgba(99,179,237,0.20)',
              color: 'var(--color-primary-50)',
            }}
          >
            <Star size={13} />
          </button>
        </>
      )}
    </div>
  )
}
