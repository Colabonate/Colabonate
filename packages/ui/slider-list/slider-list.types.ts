import type { HTMLAttributes, ReactNode, ElementType, CSSProperties } from 'react'

export interface SliderTab {
  id: string
  label: string
}

export interface FilterChipOption {
  value: string
  label: string
  count?: number
}

export interface FilterChipDef {
  id: string
  label: string
  icon?: ReactNode
  options: FilterChipOption[]
  value: string
  onChange: (value: string) => void
  color?: string
  bg?: string
}

/**
 * Ein Segment im zweistufigen Filter-System.
 * Jedes Segment kann eigene Sub-Tabs definieren, die die
 * bestehenden `tabs`-Props dynamisch ersetzen.
 */
export interface SliderSegment {
  id: string
  label: string
  /** Optionale Badge-Zahl (z.B. aktive Tickets-Anzahl) */
  count?: number
  /**
   * True while this segment's own data pool is still being fetched —
   * independent of which segment is currently active. Renders a small
   * loading indicator instead of the count badge so an inactive tab whose
   * query hasn't resolved yet is distinguishable from a genuinely empty one.
   * Ignored once `count` is truthy (real data wins over the loading hint).
   */
  loading?: boolean
  /** Sub-Tabs die angezeigt werden wenn dieses Segment aktiv ist */
  subTabs?: SliderTab[]
}

/**
 * Unterscheidet den Daten-Typ des Eintrags:
 * - 'offer'   → Angebot (vom Verkäufer erstellt, existiert unabhängig von Käufen)
 * - 'ticket'  → Transaktion (konkreter Kauf/Buchung eines Angebots)
 * - 'person'  → Individueller Partner / Freiberufler (PartnerCard)
 * - 'company' → Unternehmen / Händler (PartnerCard)
 * Wird in OfferCard / TicketCard / PartnerCard als visueller Typ-Indikator dargestellt.
 */
export type SliderItemEntityType = 'offer' | 'ticket' | 'person' | 'company'

export interface SliderListItem {
  id: string
  title: string
  description?: string
  providerName?: string
  category: string
  avatarUrl?: string
  rating?: number
  reviewCount?: number
  priceRange?: string
  priceSats?: number
  /**
   * Pre-formatted price text for items without a plain sats price (e.g. '2 EUR', 'Price on request'). When set, cards show this text instead of the sats number.
   */
  priceLabel?: string
  /**
   * Pre-formatted fiat equivalent of priceSats (e.g. "€4.85"), rendered as a
   * small white chip next to the sats price (ADR-235). The consumer formats it
   * (via useCurrency) — this package stays headless and currency-agnostic.
   */
  priceFiat?: string
  status?: string
  statusLabel?: string
  icon?: ReactNode
  isFavorite?: boolean
  /** Unterscheidet Angebot (offer) von Transaktion (ticket) – steuert Typ-Badge in der Card */
  entityType?: SliderItemEntityType
  /** True when the offer is an AGENT_SETUP listing — renders the agent card
   *  theme (green-tinted background + drift animation + centered Bot badge). */
  isAgent?: boolean
  /** ISO creation timestamp of the entry (ADR-385). Rendered by the cards as a
   *  compact `dd.mm.yy` label on the seller/provider line (or alone when no
   *  provider is set), same colour/size as the provider text. */
  createdAt?: string
  onClick?: () => void
}

export type SliderListVariant = 'default' | 'provider' | 'ticket' | 'offer' | 'partner' | 'partner-card'

export interface SliderListProps extends HTMLAttributes<HTMLDivElement> {
  /** Section title displayed in the header */
  title?: string
  /** Optional inline style for the section-title heading (e.g. a lighter
   *  `fontWeight` than the global typography token). */
  titleStyle?: CSSProperties
  /** Optional subtitle/eyebrow text */
  subtitle?: string
  /** Render a small info-icon toggle next to the title that hides/reveals the
   *  subtitle for THIS section only. Initially collapsed (subtitle hidden); the
   *  freed space folds away so no extra whitespace remains. Default: false
   *  (subtitle always visible, no toggle icon). */
  subtitleCollapsible?: boolean
  /** Optional badge rendered before the subtitle – e.g. to indicate filter scope (local/global) */
  subtitleTag?: { label: string; color: string; bg: string; icon?: ReactNode }
  /** Optional icon rendered before the title in a styled container */
  icon?: ReactNode
  /** Background color for the icon container (default: rgba(232,69,65,0.10)) */
  iconBg?: string
  /** Text/color for the icon (default: var(--color-primary-50)) */
  iconColor?: string
  /** Optional tabs for filtering – renders a TabNav in the header */
  tabs?: SliderTab[]
  /** Currently active tab id */
  activeTab?: string
  /** Called when a tab is selected */
  onTabChange?: (tabId: string) => void
  /** Visual style of the tab buttons – 'underline' (default) or 'outlined' */
  tabVariant?: 'underline' | 'outlined'
  /** Optional segments for two-level filtering – renders a segmented control above tabs */
  segments?: SliderSegment[]
  /** Currently active segment id */
  activeSegment?: string
  /** Called when a segment is selected – typically resets sub-tab to 'all' */
  onSegmentChange?: (segmentId: string) => void
  /** Link label for the "show all" action */
  linkLabel?: string
  /** Link target for the "show all" action – kept for backward compat (used as href fallback) */
  linkHref?: string
  /** Called when the "show all" link is clicked – use instead of linkHref for SPA navigation */
  onLinkClick?: () => void
  /** Render the link as a full labeled MUI Button (icon + label, size L) from the tablet breakpoint up;
   *  on mobile it stays the compact icon-only button. */
  linkButton?: boolean
  /** Items to render inside the horizontal scroll */
  children?: ReactNode
  /** Node injected at the second slot (after items[0]) — always visible regardless of item count */
  secondSlot?: ReactNode
  /** Node injected into the header, rendered directly below the subtitle (before segments / filter chips). */
  headerSlot?: ReactNode
  /** Alternative: pass items array and let SliderList render them */
  items?: SliderListItem[]
  /** Custom item renderer */
  renderItem?: (item: SliderListItem) => ReactNode
  /** Show loading skeleton */
  loading?: boolean
  /** Number of skeleton placeholders to show when loading */
  skeletonCount?: number
  /** Custom skeleton element */
  skeleton?: ReactNode
  /** Empty state message */
  emptyMessage?: string
  /** large empty-state element (icon + title + description + optional CTA)
   *  rendered when `items` is empty. Overrides `emptyMessage` if both are set. */
  emptyState?: ReactNode
  /** Optional info card rendered as the first item in the slider – always visible */
  infoCard?: { title: string; description: string; ctaLabel?: string; onCta?: () => void; badges?: Array<{ label: string; color: string; bg: string }> }
  /** Visual variant of the slider */
  variant?: SliderListVariant
  /** Enable drag-to-scroll with inertia */
  enableDragScroll?: boolean
  /** Show arrow navigation buttons (desktop) */
  showArrows?: boolean
  /** Called when favorite is toggled on a provider card */
  onFavoriteToggle?: (id: string) => void
  /** Called when a card is clicked */
  onCardClick?: (id: string) => void
  /** Custom card component for variant rendering */
  cardComponent?: ElementType<{ item: SliderListItem }>
  /** Erzwingt ein bestimmtes Card-Theme unabhängig vom App-Theme.
   *  Wenn nicht gesetzt, wird das globale Theme via useTheme() verwendet. */
  cardTheme?: 'light' | 'dark'
  /** Info card pro Segment – wird anstelle von infoCard verwendet wenn segments vorhanden */
  infoCards?: Record<string, { title: string; description: string; ctaLabel?: string; onCta?: () => void; badges?: Array<{ label: string; color: string; bg: string }> }>
  /** Render the info card at half width (intro / compact style) */
  infoCardCompact?: boolean
  /** id of the item currently "selected" / bound to the surrounding detail view.
   *  Renders the matching card with the selected style and scrolls it into view.
   *  Omit for unchanged behaviour (no selected marker, no auto-scroll). */
  activeItemId?: string
  /** Reduce card dimensions and tighten internal padding (used by detail-page
   *  sibling-browse sliders where vertical space is at a premium).
   *  Only affects card variants that opt in (currently `offer`). */
  compactCards?: boolean
  /** Hide the category + entity-type badges inside the card body.
   *  Only affects card variants that opt in (currently `offer`). */
  hideCardBadges?: boolean
  /** Reduce vertical space between the header (segments/tabs) and the card list.
   *  Used by detail-page sibling-browse sliders where vertical real estate is
   *  at a premium (e.g. ADR-188 DetailSliderNav). */
  compactHeader?: boolean
  /** Remove the leading left spacer so the first card aligns flush with the
   *  container edge (no left indent). Default keeps the indent for backward compat. */
  flushStart?: boolean
  /** Interactive filter chips rendered below the segments/tabs.
   *  Each chip opens an MUI Menu submenu to pick one option. */
  filterChips?: FilterChipDef[]
  /** Collapse the filter chips behind a single filter-icon button, rendered
   *  before the "show all" link in the header. When true, the chips are no
   *  longer shown inline; the icon button opens a popover containing them.
   *  Default: false (inline chips below the segments/tabs). */
  collapseFilterChips?: boolean
}
