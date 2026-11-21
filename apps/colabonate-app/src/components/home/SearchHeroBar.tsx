import { useMemo, useState } from 'react'
import { X } from 'lucide-react'

import { cn } from '@ds/utils'

import { SearchInput } from '../ui/SearchInput'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { useSearchSuggest, type SearchSuggestOffer, type SearchSuggestCategory } from '../../hooks/useSearchSuggest'
import type { ActiveFilterChip } from '../list-browser/list-browser.types'

export interface SearchHeroBarProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  onOfferSelect?: (offerId: string) => void
  className?: string
  /** Called when the input receives focus. */
  onFocus?: () => void
  /** Called when the input loses focus. */
  onBlur?: () => void
  /**
   * Active filters currently scoping the results (country, category, …). Shown
   * as dismissible chips on focus so the user can see — and clear — what the
   * suggestions/results are filtered by.
   */
  filterChips?: ActiveFilterChip[]
}

export function SearchHeroBar({
  value,
  onChange,
  onSubmit,
  onOfferSelect,
  className,
  onFocus,
  onBlur,
  filterChips = [],
}: SearchHeroBarProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const prefersReduced = useReducedMotion()
  const { data, isLoading, error } = useSearchSuggest(value)

  const offers = data?.offers ?? []
  const categories = data?.categories ?? []
  const totalOptions = offers.length + categories.length

  const flatOptions = useMemo(() => {
    return [
      ...offers.map<FlatOption>(offer => ({ type: 'offer', offer })),
      ...categories.map<FlatOption>(category => ({ type: 'category', category })),
    ]
  }, [offers, categories])

  function handleKeyDownCapture(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      if (!open && value.length >= 2) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(true)
        setActiveIndex(0)
        return
      }
      if (!open || totalOptions === 0) return
      e.preventDefault()
      e.stopPropagation()
      setActiveIndex(i => (i + 1) % totalOptions)
      return
    }

    if (e.key === 'ArrowUp') {
      if (!open || totalOptions === 0) return
      e.preventDefault()
      e.stopPropagation()
      setActiveIndex(i => (i - 1 + totalOptions) % totalOptions)
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      if (activeIndex >= 0 && flatOptions[activeIndex]) {
        selectOption(flatOptions[activeIndex])
      } else {
        onSubmit(value)
        setOpen(false)
      }
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      setActiveIndex(-1)
    }
  }

  function selectOption(option: FlatOption) {
    if (option.type === 'offer') {
      onOfferSelect?.(option.offer.id)
    } else {
      onSubmit(option.category.label)
    }
    setOpen(false)
    setActiveIndex(-1)
  }

  function handleMouseEnter(index: number) {
    setActiveIndex(index)
  }

  function handleOptionMouseDown(e: React.MouseEvent) {
    // Prevent the input from losing focus before the click handler runs.
    e.preventDefault()
  }

  const activeDescendantId = activeIndex >= 0 ? getOptionId(flatOptions[activeIndex], activeIndex) : undefined

  const showDropdown = open && value.length >= 2 && !error

  return (
    <div
      className={cn('relative', className)}
      role="combobox"
      aria-expanded={showDropdown}
      aria-controls="search-suggest-listbox"
      aria-activedescendant={activeDescendantId}
      aria-haspopup="listbox"
      onKeyDownCapture={handleKeyDownCapture}
    >
      {open && filterChips.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-2" role="group" aria-label="Active filters">
          {filterChips.map(chip => (
            <button
              key={chip.id}
              type="button"
              onMouseDown={handleOptionMouseDown}
              onClick={chip.onRemove}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg cursor-pointer transition-colors duration-150"
              style={{
                background: 'rgba(99,179,237,0.10)',
                border: '1px solid rgba(99,179,237,0.25)',
                color: 'var(--color-primary-50)',
              }}
              aria-label={`Remove filter ${chip.label}`}
              title={`Remove ${chip.label}`}
            >
              {chip.icon}
              <span className="text-[11px]">{chip.label}</span>
              <X size={11} />
            </button>
          ))}
        </div>
      )}
      <SearchInput
        variant="expanded"
        size="md"
        value={value}
        onChange={onChange}
        onFocus={() => { setOpen(true); onFocus?.() }}
        onBlur={() => { setOpen(false); onBlur?.() }}
        onSearch={() => {
          onSubmit(value)
          setOpen(false)
        }}
        placeholder="Search products, services & vendors…"
        ariaLabel="Search"
        className="w-full"
        style={{
          background: 'color-mix(in srgb, var(--theme-bg-subtle) 30%, transparent)',
          backdropFilter: 'blur(8px)',
        }}
      />

      {showDropdown && (
        <div
          id="search-suggest-listbox"
          role="listbox"
          aria-label="Search suggestions"
          className={cn(
            'absolute z-50 left-0 right-0 top-full mt-2 rounded-xl border overflow-hidden shadow-lg',
            !prefersReduced && 'animate-in fade-in slide-in-from-top-1 duration-200'
          )}
          style={{
            background: 'var(--theme-surface)',
            borderColor: 'var(--theme-border)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
          }}
        >
          {isLoading && <SuggestSkeleton />}

          {!isLoading && totalOptions === 0 && (
            <div
              role="option"
              className="px-4 py-3 text-sm"
              style={{ color: 'var(--theme-text-muted)' }}
            >
              No suggestions — press Enter to search all
            </div>
          )}

          {!isLoading && offers.length > 0 && (
            <div role="group" aria-label="Offers">
              {offers.map((offer, index) => (
                <div
                  key={offer.id}
                  id={`search-suggest-option-${index}`}
                  role="option"
                  aria-selected={activeIndex === index}
                  className={cn(
                    'px-4 py-2.5 text-sm cursor-pointer transition-colors duration-150',
                    activeIndex === index && 'font-medium'
                  )}
                  style={{
                    background: activeIndex === index ? 'var(--theme-bg-subtle)' : 'transparent',
                    color: 'var(--theme-text)',
                  }}
                  onMouseEnter={() => handleMouseEnter(index)}
                  onMouseDown={handleOptionMouseDown}
                  onClick={() => selectOption({ type: 'offer', offer })}
                >
                  {offer.title}
                </div>
              ))}
            </div>
          )}

          {!isLoading && categories.length > 0 && (
            <div role="group" aria-label="Categories">
              {categories.map((category, index) => {
                const optionIndex = offers.length + index
                return (
                  <div
                    key={category.code}
                    id={`search-suggest-option-${optionIndex}`}
                    role="option"
                    aria-selected={activeIndex === optionIndex}
                    className={cn(
                      'px-4 py-2.5 text-sm cursor-pointer transition-colors duration-150 flex items-center justify-between',
                      activeIndex === optionIndex && 'font-medium'
                    )}
                    style={{
                      background: activeIndex === optionIndex ? 'var(--theme-bg-subtle)' : 'transparent',
                      color: 'var(--theme-text)',
                    }}
                    onMouseEnter={() => handleMouseEnter(optionIndex)}
                    onMouseDown={handleOptionMouseDown}
                    onClick={() => selectOption({ type: 'category', category })}
                  >
                    <span>{category.label}</span>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded-md"
                      style={{
                        background: 'var(--theme-bg-subtle)',
                        color: 'var(--theme-text-muted)',
                      }}
                    >
                      {category.count}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Internal helpers ─────────────────────────────────────────────────────────

type FlatOption =
  | { type: 'offer'; offer: SearchSuggestOffer }
  | { type: 'category'; category: SearchSuggestCategory }

function getOptionId(_option: FlatOption, index: number): string {
  return `search-suggest-option-${index}`
}

function SuggestSkeleton() {
  return (
    <div className="p-2 space-y-2">
      <div
        className="h-10 rounded-lg animate-pulse"
        style={{ background: 'var(--theme-bg-subtle)' }}
      />
      <div
        className="h-10 rounded-lg animate-pulse"
        style={{ background: 'var(--theme-bg-subtle)' }}
      />
      <div
        className="h-10 rounded-lg animate-pulse"
        style={{ background: 'var(--theme-bg-subtle)' }}
      />
    </div>
  )
}
