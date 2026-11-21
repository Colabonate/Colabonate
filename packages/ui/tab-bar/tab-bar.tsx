import { cn } from '@ds/utils'
import type { TabBarProps } from './tab-bar.types'

export function TabBar({ tabs, activeTab, onChange, wrap, className, ...props }: TabBarProps) {
  return (
    <nav
      role="tablist"
      className={cn(
        'items-center rounded-full p-0.5 gap-0.5',
        wrap
          ? 'flex flex-wrap justify-center w-full'
          : 'inline-flex self-start overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
        'bg-[var(--theme-bg-subtle,rgba(0,0,0,0.04))]',
        className
      )}
      {...props}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            style={{ fontFamily: 'var(--typography-fontfamily-sans)' }}
            className={cn(
              'relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border',
              'text-[11px] font-semibold uppercase tracking-widest whitespace-nowrap',
              'transition-all duration-200 outline-none select-none cursor-pointer',
              'focus-visible:ring-2 focus-visible:ring-[var(--color-primary-50)] focus-visible:ring-offset-1',
              isActive
                ? 'border-[var(--color-primary-50)] bg-transparent text-[var(--color-primary-50)]'
                : 'border-transparent bg-transparent text-[var(--theme-text-muted,#858C94)] hover:text-[var(--theme-text,#3D4C53)]'
            )}
          >
            {tab.icon && (
              <span className={cn('flex-shrink-0', isActive ? 'text-[var(--color-primary-50)]' : '')}>
                {tab.icon}
              </span>
            )}
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}
