import { useState, useRef, useEffect, type CSSProperties } from 'react'
import { Search, X } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────

export type SearchInputVariant = 'compact' | 'expanded' | 'toggle'
export type SearchInputSize = 'sm' | 'md'

export interface SearchInputProps {
  /** Visual variant */
  variant?: SearchInputVariant
  /** Size preset: sm (sidebar) or md (list header) */
  size?: SearchInputSize
  /** Controlled value */
  value: string
  /** Value change handler */
  onChange: (value: string) => void
  /** Called on Enter */
  onSearch?: () => void
  /** Called on clear / Escape */
  onClear?: () => void
  /** Focus callback */
  onFocus?: () => void
  /** Blur callback */
  onBlur?: () => void
  /** Placeholder text */
  placeholder?: string
  /** Auto-focus input when opened */
  autoFocus?: boolean
  /** Additional class on wrapper */
  className?: string
  /** Additional inline styles on wrapper */
  style?: CSSProperties
  /** Custom aria-label for the search icon button */
  ariaLabel?: string
  /** Disabled state */
  disabled?: boolean
}

// ── Size Config ──────────────────────────────────────────────────────

const SIZE_CONFIG = {
  sm: {
    fontSize: 11,
    iconSize: 12,
    clearSize: 11,
    inputPadding: '2px 4px',
    wrapperPadding: '3px 5px',
    borderRadius: 6,
    gap: 3,
    iconButtonSize: 18,
    minWidth: 0,
  },
  md: {
    fontSize: 14,
    iconSize: 15,
    clearSize: 13,
    inputPadding: '8px 6px',
    wrapperPadding: '4px 6px',
    borderRadius: 8,
    gap: 4,
    iconButtonSize: 28,
    minWidth: 200,
  },
} as const

// ── Component ────────────────────────────────────────────────────────

export function SearchInput({
  variant = 'expanded',
  size = 'md',
  value,
  onChange,
  onSearch,
  onClear,
  onFocus: externalOnFocus,
  onBlur: externalOnBlur,
  placeholder = 'Search…',
  autoFocus = false,
  className = '',
  style,
  ariaLabel = 'Search',
  disabled = false,
}: SearchInputProps) {
  const [focused, setFocused] = useState(false)
  const [open, setOpen] = useState(variant === 'expanded' || variant === 'compact')
  const inputRef = useRef<HTMLInputElement>(null)
  const cfg = SIZE_CONFIG[size]

  // Sync open state when variant is not toggle
  useEffect(() => {
    if (variant !== 'toggle') setOpen(true)
  }, [variant])

  // Auto-focus when opening: for the toggle variant, always focus when the
  // user activates the search; for expanded/compact, respect the autoFocus prop.
  useEffect(() => {
    if (!open) return
    if (variant === 'toggle' || autoFocus) {
      if (inputRef.current) {
        const t = requestAnimationFrame(() => inputRef.current?.focus())
        return () => cancelAnimationFrame(t)
      }
    }
  }, [open, autoFocus, variant])

  function handleToggle() {
    if (open && value) {
      onSearch?.()
    } else if (open) {
      onClear?.()
      setOpen(false)
    } else {
      setOpen(true)
    }
  }

  function handleClear() {
    onChange('')
    onClear?.()
    inputRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { onSearch?.(); e.preventDefault() }
    if (e.key === 'Escape') { handleClear(); e.preventDefault() }
  }

  // ── Toggle variant: icon-only when closed ──
  if (variant === 'toggle' && !open) {
    return (
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={`flex items-center justify-center rounded-lg cursor-pointer transition-all duration-150 ${className}`}
        style={{
          width: 36,
          height: 36,
          minWidth: 36,
          background: 'transparent',
          color: 'var(--theme-text-muted)',
          border: '1px solid var(--theme-border)',
          ...style,
        }}
        aria-label={`Open ${ariaLabel.toLowerCase()}`}
      >
        <Search size={16} />
      </button>
    )
  }

  // ── Open state wrapper (shared by all variants when visible) ──
  const wrapperStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: cfg.gap,
    padding: cfg.wrapperPadding,
    borderRadius: cfg.borderRadius,
    background: 'var(--theme-bg-subtle)',
    border: '1px solid',
    borderColor: focused ? 'var(--color-primary-50)' : 'rgba(0,0,0,0.12)',
    transition: 'border-color 0.2s ease, background 0.2s ease',
    outline: 'none',
    width: '100%',
    minWidth: variant === 'toggle' ? cfg.minWidth : 0,
    ...style,
  }

  return (
    <div className={`search-input ${className}`} style={wrapperStyle}>
      {/* Search icon */}
      <Search
        size={cfg.iconSize}
        style={{
          color: focused ? 'var(--color-primary-50)' : 'var(--theme-text-muted)',
          flexShrink: 0,
          transition: 'color 0.2s ease',
        }}
      />

      {/* Input */}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => { setFocused(true); externalOnFocus?.() }}
        onBlur={() => { setFocused(false); externalOnBlur?.() }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        className="outline-none"
        style={{
          fontSize: cfg.fontSize,
          padding: cfg.inputPadding,
          background: 'transparent',
          color: 'var(--theme-text)',
          border: 'none',
          flex: 1,
          minWidth: 0,
          lineHeight: 1.4,
        }}
      />

      {/* Clear button (X) */}
      {value && (
        <button
          type="button"
          onClick={handleClear}
          className="flex items-center justify-center cursor-pointer"
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            width: cfg.iconButtonSize,
            height: cfg.iconButtonSize,
            minWidth: cfg.iconButtonSize,
            borderRadius: '50%',
            color: 'var(--theme-text-muted)',
            transition: 'color 0.15s ease, background 0.15s ease',
          }}
          aria-label="Clear search"
          onMouseEnter={e => {
            e.currentTarget.style.color = 'var(--theme-text)'
            e.currentTarget.style.background = 'rgba(0,0,0,0.06)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = 'var(--theme-text-muted)'
            e.currentTarget.style.background = 'none'
          }}
        >
          <X size={cfg.clearSize} />
        </button>
      )}

      {/* Toggle close button (only for toggle variant when open) */}
      {variant === 'toggle' && (
        <button
          type="button"
          onClick={handleToggle}
          className="flex items-center justify-center cursor-pointer"
          style={{
            background: 'var(--color-primary-50)',
            border: 'none',
            padding: 0,
            width: cfg.iconButtonSize,
            height: cfg.iconButtonSize,
            minWidth: cfg.iconButtonSize,
            borderRadius: '50%',
            color: 'white',
            transition: 'opacity 0.15s ease',
          }}
          aria-label={value ? 'Submit search' : 'Close search'}
        >
          <Search size={cfg.iconSize} />
        </button>
      )}
    </div>
  )
}
