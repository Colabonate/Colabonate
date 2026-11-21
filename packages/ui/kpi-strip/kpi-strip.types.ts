import type { HTMLAttributes, ReactNode } from 'react'

export interface KPIItem {
  /** Icon element (@mui/icons-material or custom) */
  icon?: ReactNode
  /** KPI value – number triggers animation, string is displayed as-is */
  value: number | string
  /** Label below the value */
  label: string
  /** Optional color override (Tailwind text class) */
  color?: string
  /** Optional click handler – makes the card interactive */
  onClick?: () => void
  /** Whether this KPI item is currently active/toggled on */
  active?: boolean
  /** Tooltip text shown on hover – wraps the entire card */
  tooltip?: string
  /** Tooltip placement (default: bottom) */
  tooltipPlacement?: 'top' | 'bottom' | 'left' | 'right'
  /** Show a small vertical line before this item to visually separate it from the group */
  separator?: boolean
  /** Section heading rendered above this item as a full-width row (wrap mode only) */
  heading?: string
  /** Custom active color (CSS color) – overrides the default primary blue when active */
  activeColor?: string
  /** IconButton actions rendered in the top-right corner of the card (e.g. logout, settings) */
  actions?: Array<{ icon: ReactNode; label: string; onClick: () => void }>
  /** Icon-only card: shrinks to fit the icon with spacing, no value/label rendered */
  fitContent?: boolean
  /** Show a pulsing red indicator dot over the icon (e.g. unread notifications) */
  badge?: boolean
  /** Show a small red indicator dot at the end of this item's section heading text.
   *  Only relevant when `heading` is also set (wrap + collapsible mode) — surfaces
   *  the badge even while the section is collapsed and the card itself is hidden. */
  headingBadge?: boolean
  /** Circular avatar image URL rendered before the icon/value row (e.g. Nostr profile picture) */
  avatarUrl?: string
  /** Cover image rendered as a subtle, blurred card background (e.g. Nostr profile banner).
   *  Purely decorative: low opacity behind the content, hidden automatically when the URL fails. */
  bannerUrl?: string
}

export interface KPIStripProps extends HTMLAttributes<HTMLDivElement> {
  /** KPI items to display */
  items: KPIItem[]
  /** Show loading skeleton */
  loading?: boolean
  /** Animate numbers on mount (GSAP counter) */
  animate?: boolean
  /** Number of skeleton placeholders when loading */
  skeletonCount?: number
  /** Wrap cards instead of horizontal scroll */
  wrap?: boolean
  /** Force smallest sizing tier regardless of viewport (useful when embedded in a constrained container like PageHeader actions) */
  compact?: boolean
  /** Make section headings clickable to collapse/expand their KPI items (wrap mode only) */
  collapsible?: boolean
  /** localStorage key to persist collapsed section state across sessions (requires collapsible).
   * Persisted per page and shared across sub tabs: per-heading toggles carry over by heading
   * name, and headings not seen before inherit the user's last collapse/expand choice. */
  storageKey?: string
  /** Headings that should start collapsed on every render, merged with persisted state (requires collapsible) */
  defaultCollapsedHeadings?: string[]
  /** When true, all sections with headings start collapsed (only when no stored user preference exists; requires collapsible) */
  defaultCollapsed?: boolean
}
