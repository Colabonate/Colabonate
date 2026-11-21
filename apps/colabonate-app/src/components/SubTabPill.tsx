// SubTabPill – shared secondary sub-tab pill row (SellListings sub tabs,
// BuyOrders type filter, …). Single source for the pill styling so every
// consumer renders the exact same control: --theme-surface-secondary track,
// --theme-surface active segment with primary-tinted label.
//
// Arrangement contract (list pages): the pill sits NEXT TO the ListHeader in
// one line on desktop (>=600px) and stacks ABOVE it on mobile (<600px).
// ListBrowser consumers pass it via `headerPrefix`; direct ListHeader
// consumers wrap both in `flex flex-col md:flex-row md:items-center gap-2`.

import type { ReactNode } from 'react'
import { cn } from '@ds/utils'

export interface SubTabPillTab<T extends string = string> {
  key: T
  label: string
  icon?: ReactNode
}

export interface SubTabPillProps<T extends string = string> {
  tabs: SubTabPillTab<T>[]
  active: T
  onChange: (key: T) => void
  /** Accessible name for the tab list (e.g. "Order type"). */
  ariaLabel?: string
  className?: string
}

export function SubTabPill<T extends string = string>({ tabs, active, onChange, ariaLabel, className }: SubTabPillProps<T>) {
  return (
    <div
      className={cn('flex gap-1 p-1 rounded-xl w-fit max-w-full overflow-x-auto', className)}
      style={{ background: 'var(--theme-surface-secondary)', border: '1px solid var(--theme-border)' }}
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map(tab => {
        const isActive = active === tab.key
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            role="tab"
            aria-selected={isActive}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold cursor-pointer transition-all duration-150 shrink-0"
            style={{
              background: isActive ? 'var(--theme-surface)' : 'transparent',
              color: isActive ? 'var(--color-primary-50)' : 'var(--theme-text-muted)',
              boxShadow: isActive ? '0 1px 4px rgba(0,0,0,0.10)' : 'none',
              fontFamily: 'var(--typography-fontfamily-sans)',
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
