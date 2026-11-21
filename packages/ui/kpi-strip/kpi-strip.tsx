import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Card, CardContent, Skeleton, Tooltip, useMediaQuery, useTheme } from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { cn } from '@ds/utils'
import type { KPIItem, KPIStripProps } from './kpi-strip.types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SkeletonCard({ minWidth }: { minWidth: number }) {
  return (
    <Card
      elevation={0}
      sx={{
        minWidth,
        borderRadius: '12px',
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <CardContent sx={{ p: '10px 14px !important', display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Skeleton variant="text" width="70%" height={20} />
        <Skeleton variant="text" width="90%" height={12} />
      </CardContent>
    </Card>
  )
}

/** Group a flat KPIItem list into sections based on the `heading` marker. */
function groupBySections(items: KPIItem[]): { heading?: string; headingBadge?: boolean; items: KPIItem[] }[] {
  const sections: { heading?: string; headingBadge?: boolean; items: KPIItem[] }[] = []
  for (const item of items) {
    if (item.heading || sections.length === 0) {
      sections.push({ heading: item.heading, headingBadge: item.headingBadge, items: [item] })
    } else {
      sections[sections.length - 1].items.push(item)
    }
  }
  return sections
}

/** Pulsing red indicator dot, absolutely positioned over its relative-positioned parent (e.g. an icon). */
function IconBadgeDot() {
  return (
    <>
      <span
        style={{
          position: 'absolute',
          top: -3,
          right: -3,
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: 'var(--color-status-error)',
          animation: 'kpiBadgePing 1.4s ease-in-out infinite',
          opacity: 0.7,
        }}
      />
      <span
        style={{
          position: 'absolute',
          top: -3,
          right: -3,
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: 'var(--color-status-error)',
        }}
      />
    </>
  )
}

/** Pulsing red indicator dot, inline after a section heading's text (visible while collapsed). */
function HeadingBadgeDot() {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: 6, height: 6, marginLeft: 1, flexShrink: 0 }}>
      <span
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: 'var(--color-status-error)',
          animation: 'kpiBadgePing 1.4s ease-in-out infinite',
          opacity: 0.7,
        }}
      />
      <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--color-status-error)' }} />
    </span>
  )
}

const badgeKeyframes = (
  <style>{`
    @keyframes kpiBadgePing {
      0%   { transform: scale(1);   opacity: 0.7; }
      70%  { transform: scale(2.2); opacity: 0; }
      100% { transform: scale(2.2); opacity: 0; }
    }
  `}</style>
)

// ---------------------------------------------------------------------------
// Collapsible Section
// ---------------------------------------------------------------------------

function CollapsibleSection({
  section,
  sectionIndex,
  isCollapsed,
  onToggle,
  collapsible,
  renderCard,
  separatorEl,
  spacing,
}: {
  section: { heading?: string; headingBadge?: boolean; items: KPIItem[] }
  sectionIndex: number
  isCollapsed: boolean
  onToggle: () => void
  collapsible: boolean
  renderCard: (item: KPIItem, key: string | number) => React.ReactNode
  separatorEl: (key: string | number) => React.ReactNode
  spacing: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLButtonElement>(null)
  const [headingWidth, setHeadingWidth] = useState<number | undefined>(undefined)

  useLayoutEffect(() => {
    if (!collapsible || !headingRef.current) return
    const width = headingRef.current.offsetWidth
    setHeadingWidth(width)
  }, [collapsible, section.heading])

  const containerWidth = isCollapsed && headingWidth != null ? headingWidth : undefined

  return (
    <div
      ref={containerRef}
      className="overflow-visible"
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: spacing,
        flexShrink: 1,
        flexBasis: 'auto',
        maxWidth: containerWidth,
        transition: containerWidth
          ? 'max-width 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
          : 'max-width 0.35s cubic-bezier(0.4, 0, 0.2, 1) 0.1s',
      }}
    >
      {section.heading && (
        <button
          ref={headingRef}
          type="button"
          onClick={collapsible ? onToggle : undefined}
          className={cn(
            'flex items-center gap-1 border-0 bg-transparent p-0 m-0',
            collapsible && 'cursor-pointer hover:opacity-80 transition-opacity duration-150',
          )}
          style={{
            fontFamily: 'var(--typography-fontfamily-sans)',
            fontSize: '10px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--color-neutral-6)',
            opacity: 0.6,
            paddingLeft: 2,
            whiteSpace: 'nowrap',
          }}
        >
          {collapsible && (
            <span
              style={{
                display: 'inline-flex',
                transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                fontSize: 10,
                opacity: 0.5,
              }}
            >
              <ChevronRightIcon sx={{ fontSize: 12 }} />
            </span>
          )}
          {section.heading}
          {isCollapsed && section.headingBadge && <HeadingBadgeDot />}
        </button>
      )}

      <div
        className={isCollapsed ? 'overflow-hidden' : 'overflow-visible'}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: spacing,
          maxWidth: isCollapsed ? 0 : undefined,
          maxHeight: isCollapsed ? 0 : undefined,
          opacity: isCollapsed ? 0 : 1,
          transition: isCollapsed
            ? 'max-width 0.25s cubic-bezier(0.4, 0, 0.2, 1), max-height 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.15s ease'
            : 'max-width 0.35s cubic-bezier(0.4, 0, 0.2, 1) 0.05s, max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1) 0.05s, opacity 0.2s ease 0.05s',
          marginTop: isCollapsed ? -spacing : 0,
          pointerEvents: isCollapsed ? 'none' : undefined,
        }}
      >
        {section.items.map((item, ii) => (
          <Fragment key={ii}>
            {item.separator && ii > 0 && separatorEl(`sep-${sectionIndex}-${ii}`)}
            {renderCard(item, `${sectionIndex}-${ii}`)}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Collapse persistence (per storageKey = per page, shared across sub tabs)
// ---------------------------------------------------------------------------
// Stored shape v2: { map: Record<heading, collapsed>, inherit: boolean }.
// - `map` materializes the state of every heading the strip has rendered, so
//   per-heading toggles survive sub tab switches (same heading name = same
//   state) and never flip retroactively.
// - `inherit` is the state applied to headings never seen before: it carries
//   the user's last collapse/expand choice ACROSS sub tabs with different
//   heading sets (e.g. SellListings 'Browse' → Agent Stack 'Agent Stack').
//   A toggle that leaves ALL visible sections collapsed (or all expanded)
//   propagates that state to every remembered heading and becomes the
//   inherited default; mixed states only change the toggled heading.
// - v1 migration: a stored string[] (collapsed headings) maps to entries=true
//   with inherit=true.
// - The empty map is a VALID stored preference ("user expanded everything") —
//   it is never deleted, so defaults don't re-collapse after explicit expand.
interface StoredCollapseState {
  map: Record<string, boolean>
  inherit: boolean
}

function readStored(key: string): StoredCollapseState | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return null
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      const map: Record<string, boolean> = {}
      for (const h of parsed as string[]) map[h] = true
      return { map, inherit: parsed.length > 0 }
    }
    if (parsed && typeof parsed === 'object' && typeof (parsed as StoredCollapseState).map === 'object') {
      return parsed as StoredCollapseState
    }
  } catch { /* ignore */ }
  return null
}

function writeStored(key: string, state: StoredCollapseState) {
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KPIStrip({
  items,
  loading = false,
  skeletonCount = 4,
  wrap = false,
  compact = false,
  collapsible = false,
  storageKey,
  defaultCollapsedHeadings,
  defaultCollapsed,
  className,
  ...props
}: KPIStripProps) {
  const theme = useTheme()
  const SPACING = 6

  const [collapseState, setCollapseState] = useState<StoredCollapseState>(() => {
    if (storageKey) {
      const stored = readStored(storageKey)
      if (stored) return stored
    }
    const initial: Record<string, boolean> = {}
    if (defaultCollapsedHeadings) {
      for (const heading of defaultCollapsedHeadings) initial[heading] = true
    } else if (defaultCollapsed) {
      for (const item of items) {
        if (item.heading) initial[item.heading] = true
      }
    }
    return { map: initial, inherit: defaultCollapsed === true }
  })

  /** Current visible headings (section labels), joined into a stable dep key. */
  const headingsKey = items.map(i => i.heading).filter(Boolean).join('\u0000')

  // Materialize unseen headings with the inherited state when the heading set
  // changes (sub tab / context switch inside the same page). In-memory only —
  // persistence happens exclusively on user toggles, so a stored value always
  // reflects an explicit choice.
  useEffect(() => {
    if (!headingsKey) return
    const headings = headingsKey.split('\u0000').filter(Boolean)
    setCollapseState(prev => {
      let changed = false
      const map = { ...prev.map }
      for (const h of headings) {
        if (map[h] === undefined) { map[h] = prev.inherit; changed = true }
      }
      return changed ? { ...prev, map } : prev
    })
  }, [headingsKey])

  function toggleSection(heading: string) {
    const prev = collapseState
    const flipped = { ...prev.map, [heading]: !(prev.map[heading] ?? prev.inherit) }
    const visible = headingsKey.split('\u0000').filter(Boolean)
    const state = (h: string) => flipped[h] ?? prev.inherit
    // Carry the last collapse/expand choice across sub tabs: when this toggle
    // leaves every visible section in one state, that state wins for the
    // WHOLE strip — inherited by unseen headings and propagated to every
    // remembered heading (including other sub tabs' sections still carrying
    // their mount-time default). Mixed → only the toggled heading changes.
    const uniform = visible.length > 0 && visible.every(state)
      ? true
      : visible.length > 0 && visible.every(h => !state(h))
        ? false
        : null
    const map = uniform === null
      ? flipped
      : Object.fromEntries(Object.keys(flipped).map(h => [h, uniform]))
    const inherit = uniform ?? prev.inherit
    setCollapseState({ map, inherit })
    if (storageKey) writeStored(storageKey, { map, inherit })
  }

  // Re-apply default-collapsed headings so they stay collapsed even when React
  // Fast Refresh preserves state during HMR (the useState initializer only runs
  // on a real mount). Skipped entirely once an explicit preference is stored —
  // the stored state (including "all expanded") always wins over defaults.
  const defaultsKey = (defaultCollapsedHeadings ?? []).join('\u0000')
  useEffect(() => {
    if (!defaultsKey) return
    if (storageKey && localStorage.getItem(storageKey) !== null) return
    const headings = defaultsKey.split('\u0000').filter(Boolean)
    setCollapseState(prev => {
      let changed = false
      const map = { ...prev.map }
      for (const h of headings) {
        if (map[h] !== true) { map[h] = true; changed = true }
      }
      return changed ? { ...prev, map } : prev
    })
  }, [defaultsKey])

  // When compact, force the smallest sizing tier regardless of viewport.
  // When not compact, use responsive breakpoints.
  // Theme breakpoints: sm=360, md=600, lg=900, xl=1200
  const isSm = useMediaQuery(theme.breakpoints.up('sm'))
  const isMd = useMediaQuery(theme.breakpoints.up('md'))
  const isLg = useMediaQuery(theme.breakpoints.up('lg'))
  const isXl = useMediaQuery(theme.breakpoints.up('xl'))

  // Responsive sizing
  // Project convention: "mobile" = xs + sm = below md (< 600px).
  const isMobileWidth = !isMd
  const cardMinWidth  = compact ? 44 : isXl ? 96 : isLg ? 80 : isMd ? 64 : 40
  const valueFontSize = compact ? 16 : isXl ? 20 : isMd ? 18 : 14
  const labelFontSize = compact ? 10 : isMd ? 11 : 9
  const cardPadding   = compact ? '8px 12px' : isXl ? '12px 16px' : isMd ? '10px 14px' : '6px 10px'
  // In horizontal-scroll mode, clamp label to cardMinWidth so the card stays compact.
  // In wrap / section mode, no max – cards grow to their natural content width.
  const hPadding      = isXl ? 32 : isMd ? 28 : isSm ? 28 : 24
  const labelMaxWidth = wrap ? undefined : cardMinWidth - hPadding

  // ── Card renderer ────────────────────────────────────────────────────────

  const renderCard = (item: KPIItem, key: string | number) => {
    const activeBorderColor = item.activeColor ?? 'primary.main'
    const activeBg          = item.activeColor ? `${item.activeColor}14` : 'rgba(99, 179, 237, 0.08)'

    const displayValue  = typeof item.value === 'number' ? item.value.toLocaleString('de-DE') : item.value
    const tooltipTitle  = item.tooltip ?? `${displayValue} ${item.label}`

    const card = (
      <Card
        elevation={0}
        onClick={item.onClick}
        sx={{
          flexShrink: wrap ? 1 : 0,
          minWidth: item.fitContent ? 'auto' : cardMinWidth,
          borderRadius: '14px',
          border: '1px solid',
          borderColor: item.active ? activeBorderColor : 'divider',
          background: item.active ? activeBg : 'background.paper',
          cursor: item.onClick ? 'pointer' : 'default',
          userSelect: 'none',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          position: 'relative',
          '&:hover': {
            boxShadow: '0 0px 10px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)',
            borderColor: 'primary.light',
            transform: 'scale(1.02)',
          },
          '&:active': item.onClick ? { transform: 'scale(0.98)' } : undefined,
        }}
      >
        {/* Decorative banner background (e.g. Nostr profile banner) — subtle,
            blurred cover behind the content; hidden automatically on error. */}
        {item.bannerUrl && (
          <img
            src={item.bannerUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full object-cover"
            style={{
              opacity: 0.18,
              filter: 'blur(1.5px)',
              transform: 'scale(1.06)',
              pointerEvents: 'none',
            }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        )}
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, p: `${cardPadding} !important`, position: 'relative', ...(item.fitContent ? { justifyContent: 'center', alignItems: 'center' } : {}) }}>
          {item.fitContent ? (
            <span style={{ display: 'flex', position: 'relative', color: 'var(--color-neutral-5)', transition: 'color 0.2s ease' }}>
              {item.icon}
              {item.badge && <IconBadgeDot />}
            </span>
          ) : (
          <>
          {/* Row 1: avatar · icon · value · actions */}
          <div className="flex items-center gap-1">
            {/* Avatar (optional circular profile picture) */}
            {item.avatarUrl && (
              <img
                src={item.avatarUrl}
                alt=""
                className="shrink-0 rounded-full object-cover"
                style={{ width: 22, height: 22, border: `1.5px solid ${item.active ? activeBorderColor : 'var(--theme-border, #e0e0e0)'}` }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
              />
            )}
            {/* Icon (optional) */}
            {item.icon && (
              <span style={{ display: 'flex', position: 'relative', color: 'var(--color-neutral-5)', transition: 'color 0.2s ease' }}>
                {item.icon}
                {item.badge && <IconBadgeDot />}
              </span>
            )}

            {/* Value */}
            <span
              className={cn('stat-number tabular-nums flex-1 min-w-0', item.color)}
              style={{
                fontFamily: 'var(--typography-fontfamily-sans)',
                fontSize: `${valueFontSize}px`,
                fontWeight: 600,
                letterSpacing: '-0.02em',
                lineHeight: 1.3,
                color: item.color ? undefined : 'var(--color-text-primary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {typeof item.value === 'number' ? item.value.toLocaleString('de-DE') : item.value}
            </span>

            {/* Action buttons (e.g. logout) */}
            {item.actions && item.actions.length > 0 && (
              <div className="flex gap-0.5 shrink-0">
                {item.actions.map((action, ai) => (
                  <Tooltip key={ai} title={action.label} placement="top">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); action.onClick() }}
                      className="flex items-center justify-center w-5 h-5 rounded-md border-0 bg-transparent cursor-pointer transition-all duration-150 p-0"
                      style={{
                        color: 'var(--color-neutral-5)',
                        background: 'transparent',
                      }}
                      onMouseEnter={(e) => {
                        const el = e.currentTarget
                        el.style.background = 'var(--color-neutral-3)'
                        el.style.color = 'var(--color-primary-50)'
                      }}
                      onMouseLeave={(e) => {
                        const el = e.currentTarget
                        el.style.background = 'transparent'
                        el.style.color = 'var(--color-neutral-5)'
                      }}
                    >
                      {action.icon}
                    </button>
                  </Tooltip>
                ))}
              </div>
            )}
          </div>

          {/* Label */}
          <Tooltip
            title={item.label}
            placement="bottom"
            slotProps={{ tooltip: { sx: { fontSize: '11px', maxWidth: 240 } } }}
            disableHoverListener={item.label.length <= 16}
          >
            <span
              style={{
                fontFamily: 'var(--typography-fontfamily-sans)',
                fontSize: `${labelFontSize}px`,
                fontWeight: 400,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                lineHeight: 1.3,
                color: 'var(--color-neutral-6)',
                whiteSpace: 'nowrap',
                overflow: labelMaxWidth ? 'hidden' : undefined,
                textOverflow: labelMaxWidth ? 'ellipsis' : undefined,
                display: 'block',
                maxWidth: labelMaxWidth,
              }}
            >
              {item.label}
            </span>
          </Tooltip>
          </>
          )}
        </CardContent>
      </Card>
    )

    return (
      <Tooltip
        key={key}
        title={tooltipTitle}
        placement={item.tooltipPlacement ?? 'bottom'}
        slotProps={{ tooltip: { sx: { fontSize: '12px', maxWidth: 240, px: 1.5, py: 0.75 } } }}
        arrow
      >
        {card}
      </Tooltip>
    )
  }

  // ── Separator ────────────────────────────────────────────────────────────

  const separatorEl = (key: string | number) => (
    <div
      key={key}
      style={{
        width: 1,
        alignSelf: 'stretch',
        margin: '6px 0',
        background: 'var(--theme-border)',
        flexShrink: 0,
      }}
    />
  )

  // ── Loading skeletons ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div role="group" aria-label="KPI Overview" className={cn(className)} {...props}>
        <div
          className="flex"
          style={{
            gap: theme.spacing(0.75),
            padding: isMobileWidth ? '0px 12px' : theme.spacing(0.5),
          }}
        >
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <SkeletonCard key={i} minWidth={cardMinWidth} />
          ))}
        </div>
      </div>
    )
  }

  // ── Wrap mode ────────────────────────────────────────────────────────────

  if (wrap) {
    const hasHeadings = items.some(item => item.heading)

    // ── Flat wrap (no headings): every card wraps individually ──────────────
    if (!hasHeadings) {
      return (
        <div
          role="group"
          aria-label="KPI Overview"
          className={cn('flex flex-wrap items-stretch', className)}
          style={{
            gap: theme.spacing(0.75),
            padding: isMobileWidth ? '0px 12px' : theme.spacing(0.5),
          }}
          {...props}
        >
          {badgeKeyframes}
          {items.map((item, i) => (
            <Fragment key={i}>
              {item.separator && separatorEl(`sep-${i}`)}
              {renderCard(item, i)}
            </Fragment>
          ))}
        </div>
      )
    }

    // ── Sectioned wrap: each section is an atomic inline-flex block ─────────
    // Sections flow like words in a paragraph; cards inside never break mid-section.
    const sections = groupBySections(items)

    // When all heading sections are collapsed, reduce vertical padding so the
    // compact heading row doesn't carry the full strip padding (oben/unten).
    // On mobile (xs + sm = < md = < 600px) we drop vertical padding to 0px and
    // shrink the inter-section gap so the strip hugs its neighbours with as
    // little vertical footprint as possible — verified on all pages where
    // KPIStrip is used with `wrap collapsible defaultCollapsed={isMobile}`.
    const headingSections = sections.filter(s => s.heading)
    const resolveCollapsed = (h?: string) => (h != null ? (collapseState.map[h] ?? collapseState.inherit) : false)
    const allCollapsed =
      collapsible &&
      headingSections.length > 0 &&
      headingSections.every(s => resolveCollapsed(s.heading))
    const collapsedPadding = isMobileWidth
      ? '0px 12px'
      : theme.spacing(0.5, 1.5)
    const collapsedGap = isMobileWidth
      ? theme.spacing(0.5)
      : theme.spacing(2)
    // On mobile, also trim the expanded-state vertical padding so the strip
    // stays compact even when a user expands a section.
    const expandedPadding = isMobileWidth
      ? theme.spacing(0.5, 1.5)
      : theme.spacing(1.5)

    return (
      <div
        role="group"
        aria-label="KPI Overview"
        className={cn('flex flex-wrap items-start overflow-visible', className)}
        style={{
          gap: allCollapsed ? collapsedGap : theme.spacing(2),
          padding: allCollapsed ? collapsedPadding : expandedPadding,
        }}
        {...props}
      >
        {badgeKeyframes}
        {sections.map((section, si) => {
          const isCollapsed = collapsible && section.heading ? resolveCollapsed(section.heading) : false

          return (
            <CollapsibleSection
              key={si}
              section={section}
              sectionIndex={si}
              isCollapsed={isCollapsed}
              onToggle={() => toggleSection(section.heading!)}
              collapsible={collapsible}
              renderCard={renderCard}
              separatorEl={separatorEl}
              spacing={SPACING}
            />
          )
        })}
      </div>
    )
  }

  // ── Horizontal-scroll mode (default) ─────────────────────────────────────

  return (
    <div
      role="group"
      aria-label="KPI Overview"
      className={cn(
        'overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
      {...props}
    >
      {badgeKeyframes}
      <div
        className="flex items-stretch"
        style={{
          gap: theme.spacing(0.75),
          padding: isMobileWidth ? '0px 12px' : theme.spacing(0.5),
        }}
      >
        {items.map((item, i) => (
          <Fragment key={i}>
            {item.separator && separatorEl(`sep-${i}`)}
            {renderCard(item, i)}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
