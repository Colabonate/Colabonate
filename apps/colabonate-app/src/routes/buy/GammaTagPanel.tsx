// GammaTagPanel — flat, frequency-sorted, multi-select Gamma `t` tag chips
// (ADR-277 D3/D7). Unlike CategorySidebar's 3-level UNSPSC slide navigation,
// the gamma axis has no hierarchy — every tag is a peer, selection is
// OR-combined, and there is nothing to "drill into". Chips are always
// content-width (never a full-width row) and wrap, so several fit per line.
// Owns its own chip-area height cap + scroll (the optional search box stays
// pinned above it, never scrolled away) so callers just pass a max height.

import { useMemo, useState } from 'react'
import { Hash, Tag } from 'lucide-react'
import { SearchInput } from '../../components/ui/SearchInput'
import type { GammaTagFacet } from '../../components/list-browser/list-browser.types'

export interface GammaTagPanelProps {
  facets: GammaTagFacet[]
  selectedTags: string[]
  onSelectTags: (tags: string[]) => void
  showOfferCounts?: boolean
  /** Shows a "Filter…" search box above the chips — Standard-axis (CategorySidebar) parity, sidebar/desktop only. */
  showSearch?: boolean
  /** Caps the chip area's height with its own independent scroll; omit for no cap. Mutually exclusive with `fill`. */
  chipsMaxHeight?: number
  /**
   * Fill mode: the chip area becomes `flex: 1; min-height: 0` and scrolls
   * within whatever real height its flex-column ancestor gives it, instead
   * of a fixed pixel cap — for a desktop sidebar that should use all
   * available viewport space. Requires the immediate parent to establish an
   * actual (not just max-) height and be `display: flex; flex-direction: column`.
   */
  fill?: boolean
}

export function GammaTagPanel({
  facets,
  selectedTags,
  onSelectTags,
  showOfferCounts = true,
  showSearch = false,
  chipsMaxHeight,
  fill = false,
}: GammaTagPanelProps) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? facets.filter(f => f.tag.toLowerCase().includes(q)) : facets
  }, [facets, search])

  function toggle(tag: string) {
    onSelectTags(
      selectedTags.includes(tag)
        ? selectedTags.filter(t => t !== tag)
        : [...selectedTags, tag],
    )
  }

  const chipAreaStyle = fill
    ? {
        flex: '1 1 0%',
        minHeight: 0,
        overflowY: 'auto' as const,
        scrollbarWidth: 'thin' as const,
        scrollbarColor: 'var(--theme-border) transparent',
        overscrollBehavior: 'contain' as const,
      }
    : chipsMaxHeight
    ? {
        maxHeight: chipsMaxHeight,
        overflowY: 'auto' as const,
        scrollbarWidth: 'thin' as const,
        scrollbarColor: 'var(--theme-border) transparent',
        overscrollBehavior: 'contain' as const,
      }
    : undefined

  return (
    <div className={fill ? 'flex flex-col gap-1.5 h-full min-h-0' : 'flex flex-col gap-1.5'}>
      {showSearch && (
        <SearchInput
          variant="compact"
          size="sm"
          value={search}
          onChange={setSearch}
          onClear={() => setSearch('')}
          placeholder="Filter…"
        />
      )}
      {filtered.length === 0 ? (
        <div className="flex items-center justify-center gap-1 px-2 py-1.5 text-center">
          <Tag size={11} style={{ color: 'var(--theme-text-muted)', flexShrink: 0 }} />
          <span className="text-[11px]" style={{ color: 'var(--theme-text-muted)' }}>
            {facets.length === 0 ? 'No tags' : 'No matches'}
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap content-start gap-1.5" style={chipAreaStyle} data-lenis-prevent="">
          {filtered.map(({ tag, count }) => {
            const isSelected = selectedTags.includes(tag)
            return (
              <button
                key={tag}
                onClick={() => toggle(tag)}
                className="inline-flex items-center gap-1 rounded-md cursor-pointer transition-all duration-150 shrink-0"
                style={{
                  padding: '4px 8px',
                  background: isSelected ? 'var(--color-primary-50)' : 'var(--theme-bg-subtle)',
                  border: isSelected ? '1px solid var(--color-primary-50)' : '1px solid var(--theme-border)',
                  color: isSelected ? 'white' : 'var(--theme-text)',
                }}
                aria-pressed={isSelected}
              >
                <Hash size={11} style={{ flexShrink: 0, opacity: isSelected ? 1 : 0.5 }} />
                <span className="text-[13px] font-medium whitespace-nowrap">{tag}</span>
                {showOfferCounts && (
                  <span
                    className="text-[11px] font-semibold whitespace-nowrap"
                    style={{ color: isSelected ? 'rgba(255,255,255,0.85)' : 'var(--theme-text-muted)' }}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
