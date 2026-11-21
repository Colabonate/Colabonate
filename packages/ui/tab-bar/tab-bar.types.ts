import type { HTMLAttributes, ReactNode } from 'react'

export interface TabItem {
  id: string
  label: string
  icon?: ReactNode
}

export interface TabBarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** Tab items to display */
  tabs: TabItem[]
  /** Currently active tab id */
  activeTab: string
  /** Called when a tab is selected */
  onChange: (tabId: string) => void
  /** Allow tabs to wrap to multiple lines instead of horizontal scrolling */
  wrap?: boolean
}
