import { Star, X } from 'lucide-react'
import type { FilterFavorite } from '../../../utils/filterFavorites'

export function SaveFilterAction({
  savedFilters,
  currentFilters,
  onApplyFilter,
  onDeleteFilter,
  onSaveFilter,
  showButton = true,
}: {
  savedFilters: FilterFavorite[]
  currentFilters: Record<string, unknown>
  onApplyFilter: (id: string) => void
  onDeleteFilter: (id: string) => void
  onSaveFilter: () => void
  /** ADR-333 V2: pass false when the save action lives in the SidebarPanelToggleGroup — chips only. */
  showButton?: boolean
}) {
  return (
    <>
      {savedFilters.length > 0 && (
        <div className="flex flex-col gap-1 shrink-0">
          <div className="flex items-center gap-1.5 px-0.5">
            <Star size={10} style={{ color: 'var(--color-primary-50)' }} />
            <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--theme-text-muted)' }}>
              Saved Filters
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {savedFilters.map(filter => {
              const isActive = JSON.stringify(currentFilters) === JSON.stringify(filter.filters)
              return (
                <button
                  key={filter.id}
                  onClick={() => onApplyFilter(filter.id)}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium cursor-pointer transition-all duration-150"
                  style={{
                    background: isActive ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
                    color: isActive ? 'white' : 'var(--theme-text)',
                    border: isActive ? 'none' : '1px solid var(--theme-border)',
                  }}
                >
                  <Star size={8} className={isActive ? 'fill-white' : ''} style={{ color: isActive ? 'white' : 'var(--color-primary-50)' }} />
                  {filter.name}
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteFilter(filter.id) }}
                    className="ml-0.5 hover:opacity-70"
                    style={{ background: 'none', border: 'none', padding: 0, color: isActive ? 'white' : 'var(--theme-text-muted)' }}
                  >
                    <X size={8} />
                  </button>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {showButton && (
        <button
          onClick={onSaveFilter}
          className="flex items-center justify-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition-all duration-150"
          style={{
            background: 'rgba(99,179,237,0.08)',
            border: '1px solid rgba(99,179,237,0.20)',
            color: 'var(--color-primary-50)',
          }}
        >
          <Star size={10} />
          Save current filter
        </button>
      )}
    </>
  )
}
