import { useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { SliderList } from '@ds/ui'
import type { SliderListItem, SliderSegment } from '@ds/ui'
import { useSliderItemsFiat } from './currency/useSliderItemsFiat'
import { Storefront, Public, ArrowForward } from '@mui/icons-material'

export type DetailSliderSegment = 'vendor' | 'all'

export type DetailSliderEntityType = 'offer' | 'cooperation'

const ENTITY_LABELS: Record<DetailSliderEntityType, { singular: string; plural: string }> = {
  offer: { singular: 'offer', plural: 'offers' },
  cooperation: { singular: 'collaboration', plural: 'collaborations' },
}

/**
 * Builds a synthetic placeholder card item that lives inside the slider list
 * (same dimensions as a real OfferCard) and carries the empty-state copy.
 * The card is non-clickable; an optional "switch to {otherSegment}" action
 * is rendered inside the card body when the other segment has items.
 */
function buildPlaceholderItem(args: {
  entityType: DetailSliderEntityType
  activeSegment: DetailSliderSegment
  hasItemsInOtherSegment: boolean
  onSwitchSegment?: () => void
}): SliderListItem {
  const { entityType, activeSegment, hasItemsInOtherSegment, onSwitchSegment } = args
  const labels = ENTITY_LABELS[entityType]
  const isVendorSegment = activeSegment === 'vendor'
  const title = isVendorSegment
    ? entityType === 'cooperation'
      ? 'No other collaborations from this initiator'
      : 'No other offers from this seller'
    : `No related ${labels.plural} yet`
  const description = isVendorSegment
    ? entityType === 'cooperation'
      ? 'This initiator has not published any other open collaborations.'
      : 'This seller has not published any other offers.'
    : `No ${labels.plural} match this category, type or location.`

  // The placeholder is rendered by a custom renderItem path so we can keep
  // the standard OfferCard chrome. We attach an opaque `__placeholder` flag
  // to the item so renderPlaceholderCard() knows to take over.
  return {
    id: `__placeholder_${activeSegment}`,
    title,
    category: '',
    avatarUrl: undefined,
    priceSats: 0,
    entityType: 'offer',
    __placeholder: true,
    __placeholderDescription: description,
    __placeholderActionLabel: hasItemsInOtherSegment
      ? (isVendorSegment ? 'See marketplace' : 'See vendor')
      : undefined,
    __placeholderOnAction: onSwitchSegment,
  } as SliderListItem & { __placeholder?: boolean; __placeholderDescription?: string; __placeholderActionLabel?: string; __placeholderOnAction?: () => void }
}

/** Stand-alone card that fills a slot in the slider when its segment is empty. */
function PlaceholderCard({
  item,
  onAction,
}: {
  item: SliderListItem & { __placeholder?: boolean; __placeholderDescription?: string; __placeholderActionLabel?: string; __placeholderOnAction?: () => void }
  onAction?: () => void
}) {
  if (!item.__placeholder) return null
  const actionLabel = item.__placeholderActionLabel
  const action = item.__placeholderOnAction ?? onAction
  const Icon = item.title.toLowerCase().includes('vendor') || item.title.toLowerCase().includes('seller') || item.title.toLowerCase().includes('initiator') ? Storefront : Public

  return (
    <div
      role="status"
      className="shrink-0 snap-start flex flex-col items-stretch rounded-xl cursor-default overflow-hidden shrink-0"
      style={{
        background: 'var(--theme-surface)',
        border: '1px dashed var(--theme-border)',
        width: 156,
        height: 168,
      }}
    >
      <div
        className="relative w-full overflow-hidden rounded-t-xl shrink-0 flex items-center justify-center"
        style={{ height: 60, background: 'rgba(232,69,65,0.06)' }}
      >
        <Icon sx={{ fontSize: 22, color: 'var(--color-primary-50)' }} />
      </div>
      <div className="flex flex-col items-start flex-1 min-h-0 w-full px-3 pt-2 pb-3">
        <span
          className="flex-1 min-h-0 line-clamp-2"
          style={{
            fontFamily: 'var(--typography-fontfamily-sans, system-ui)',
            fontSize: '14px',
            fontWeight: 600,
            lineHeight: 1.3,
            color: 'var(--theme-text)',
          }}
        >
          {item.title}
        </span>
        {item.__placeholderDescription && (
          <span
            className="line-clamp-2 mt-1"
            style={{
              fontFamily: 'var(--typography-fontfamily-sans, system-ui)',
              fontSize: '11px',
              lineHeight: 1.35,
              color: 'var(--theme-text-muted)',
            }}
          >
            {item.__placeholderDescription}
          </span>
        )}
        {actionLabel && action && (
          <button
            type="button"
            onClick={action}
            className="flex items-center gap-1 mt-auto text-[11px] font-semibold rounded-md px-2 py-1 cursor-pointer transition-colors duration-150"
            style={{
              background: 'rgba(232,69,65,0.08)',
              color: 'var(--color-primary-50)',
              border: '1px solid rgba(232,69,65,0.20)',
            }}
            aria-label={actionLabel}
          >
            {actionLabel}
            <ArrowForward sx={{ fontSize: 12 }} />
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Optional filter context applied to the "All marketplace" segment so the
 * slider shows only items that belong to the same browsing context as the
 * currently-viewed offer (e.g. same category prefix + offerType + country).
 *
 * The vendor segment is unaffected — siblings are still all offers by the
 * same creator.
 */
export interface DetailSliderContextFilters {
  /** match against `categoryCode?.startsWith(categoryPrefix)` — e.g. 'services' shows
   *  everything under services/, 'services/consulting' narrows further. */
  categoryPrefix?: string
  /** exact offerType match: 'SERVICE' | 'PRODUCT' | 'ITEM' | 'AGENT_SETUP' */
  offerType?: 'SERVICE' | 'PRODUCT' | 'ITEM' | 'AGENT_SETUP'
  /** exact country match (ISO code) */
  country?: string | null
  /** exact companyId match */
  companyId?: string | null
}

export interface DetailSliderNavProps {
  /** id of the offer currently bound to the surrounding detail view (route param) */
  activeId: string
  /** siblings from the same vendor — items with `id === activeId` are excluded by the caller */
  vendorItems: SliderListItem[]
  /** marketplace list (sorted by createdAt) — the active offer stays in the list */
  allItems: SliderListItem[]
  /** optional context filters applied to the 'all' segment; vendor segment unaffected */
  contextFilters?: DetailSliderContextFilters
  /** builds the destination route for a clicked sibling card */
  toDetailRoute: (id: string) => string
  loading?: boolean
  /** hide the slider entirely when both segments are empty, or when the
   *  marketplace segment is empty and the vendor segment has at most one
   *  sibling — a lone card isn't worth the vertical space on the detail
   *  page. When `false` (default) an informative empty-state is
   *  rendered instead so the user always sees relevant context. */
  hideWhenSingular?: boolean
  /** currently active segment (controlled). The page owns this state so the
   *  mobile swipe nav can follow the same segment the user selected here. */
  activeSegment: DetailSliderSegment
  /** segment change callback (controlled). Fires both on user toggle and on
   *  the internal auto-select (when the active segment is empty but the other
   *  has items). Use a stable callback (e.g. a setState dispatcher). */
  onSegmentChange: (segment: DetailSliderSegment) => void
  /** what kind of entity this slider is browsing — drives the empty-state copy */
  entityType?: DetailSliderEntityType
}

const VENDOR_SEGMENT_ID = 'vendor'
const ALL_SEGMENT_ID = 'all'

/** Apply the optional context filters to the marketplace list (vendor segment unaffected).
 *  Exported so the mobile swipe nav resolves the exact same list the slider shows. */
export function applyContextFilters(
  allItems: SliderListItem[],
  contextFilters?: DetailSliderContextFilters,
): SliderListItem[] {
  if (!contextFilters) return allItems
  const { categoryPrefix, offerType, country, companyId } = contextFilters
  return allItems.filter(item => {
    const meta = item as SliderListItem & {
      categoryCode?: string
      offerType?: string
      country?: string | null
      companyId?: string | null
    }
    if (categoryPrefix && !meta.categoryCode?.startsWith(categoryPrefix)) return false
    if (offerType && meta.offerType !== offerType) return false
    if (country && meta.country !== country) return false
    if (companyId && meta.companyId !== companyId) return false
    return true
  })
}

/**
 * Thin adapter around `SliderList` for buyer detail pages (ADR-188).
 *
 * Renders a `SliderList` with two segments — "More from this vendor" and
 * "All marketplace" — bound to the same `activeId` as the surrounding detail
 * view. Clicking a sibling card navigates to that detail route; the route
 * param is the single source of truth for the active item (D5).
 *
 * The adapter owns the local UI state for the active segment (default: 'vendor').
 * It does not persist it — that is FU-45.
 */
export function DetailSliderNav({
  activeId,
  vendorItems,
  allItems,
  contextFilters,
  toDetailRoute,
  loading = false,
  hideWhenSingular = false,
  activeSegment,
  onSegmentChange,
  entityType = 'offer',
}: DetailSliderNavProps) {
  const navigate = useNavigate()
  // Tracks whether the user manually toggled the segment. Until they do, we
  // auto-select whichever segment actually has items (handles async loading),
  // so the vendor's offers are shown directly when the marketplace segment is
  // empty (and vice-versa).
  const userTouchedSegment = useRef(false)

  const segments: SliderSegment[] = useMemo(
    () => [
      { id: VENDOR_SEGMENT_ID, label: 'Vendor' },
      { id: ALL_SEGMENT_ID, label: 'Marketplace' },
    ],
    [],
  )

  // Apply context filters to the marketplace list. Items that don't match
  // are hidden from the slider so the user only browses related offers.
  const filteredAllItems = useMemo(
    () => applyContextFilters(allItems, contextFilters),
    [allItems, contextFilters],
  )

  const currentItems = useMemo(
    () => (activeSegment === VENDOR_SEGMENT_ID ? vendorItems : filteredAllItems),
    [activeSegment, vendorItems, filteredAllItems],
  )

  // Arrow-key navigation: ← previous sibling, → next sibling within the
  // active segment. Navigates to the detail route just like a click.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      // Ignore when typing in an input/textarea/contenteditable.
      const el = e.target as HTMLElement | null
      if (el) {
        const tag = el.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return
      }
      const items = currentItems.filter(i => !String(i.id).startsWith('__placeholder_'))
      if (items.length === 0) return
      const idx = items.findIndex(i => i.id === activeId)
      if (idx === -1) return
      const dir = e.key === 'ArrowLeft' ? -1 : 1
      const nextIdx = idx + dir
      if (nextIdx < 0 || nextIdx >= items.length) return
      e.preventDefault()
      navigate(toDetailRoute(items[nextIdx].id))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [currentItems, activeId, navigate, toDetailRoute])

  const vendorItemCount = vendorItems.length
  const allCountExcludingActive = filteredAllItems.filter(i => i.id !== activeId).length
  const vendorHasItems = vendorItemCount > 0
  const allHasItemsExcludingActive = allCountExcludingActive > 0
  const currentHasItems = activeSegment === VENDOR_SEGMENT_ID ? vendorHasItems : allHasItemsExcludingActive
  const otherSegmentHasItems = activeSegment === VENDOR_SEGMENT_ID ? allHasItemsExcludingActive : vendorHasItems

  const bothSegmentsEmpty = !vendorHasItems && !allHasItemsExcludingActive
  // Hide the slider when there is at most a single vendor sibling AND the
  // marketplace segment has no items — a lone card isn't worth the vertical
  // space on the detail page (saves room for the actual content).
  const marketplaceEmptyAndAtMostOneSibling = !allHasItemsExcludingActive && vendorItemCount <= 1

  // Auto-select the non-empty segment until the user manually toggles. Runs
  // when items load asynchronously so the vendor's offers surface directly.
  useEffect(() => {
    if (userTouchedSegment.current || loading) return
    if (activeSegment === ALL_SEGMENT_ID && !allHasItemsExcludingActive && vendorHasItems) {
      onSegmentChange(VENDOR_SEGMENT_ID)
    } else if (activeSegment === VENDOR_SEGMENT_ID && !vendorHasItems && allHasItemsExcludingActive) {
      onSegmentChange(ALL_SEGMENT_ID)
    }
  }, [activeSegment, vendorHasItems, allHasItemsExcludingActive, loading, onSegmentChange])

  // When the active segment is empty we still render the slider (so the
  // segments toggle stays visible), but we inject a synthetic placeholder
  // card that lives *inside* the list — same dimensions as a real card, just
  // dashed border + informative copy + optional switch-segment action.
  const switchToOtherSegment = otherSegmentHasItems
    ? () => onSegmentChange(activeSegment === VENDOR_SEGMENT_ID ? ALL_SEGMENT_ID : VENDOR_SEGMENT_ID)
    : undefined

  const itemsForList: SliderListItem[] = currentHasItems
    ? currentItems
    : [buildPlaceholderItem({
        entityType,
        activeSegment,
        hasItemsInOtherSegment: otherSegmentHasItems,
        onSwitchSegment: switchToOtherSegment,
      })]
  // Must run before the `hideWhenSingular` bail-out below: the bail-out flips
  // from true to false once the async item lists arrive, and a hook after it
  // would change the hook order between renders ("Rendered more hooks than
  // during the previous render" → the whole detail page hits the error boundary).
  const itemsWithFiat = useSliderItemsFiat(itemsForList)

  if (hideWhenSingular && (bothSegmentsEmpty || marketplaceEmptyAndAtMostOneSibling)) return null


  const renderItem = (item: SliderListItem) => {
    const placeholderItem = item as SliderListItem & { __placeholder?: boolean }
    if (placeholderItem.__placeholder) {
      return <PlaceholderCard item={placeholderItem} />
    }
    return null
  }

  return (
    <SliderList
      variant="offer"
      segments={segments}
      activeSegment={activeSegment}
      onSegmentChange={(id) => { userTouchedSegment.current = true; onSegmentChange(id as DetailSliderSegment) }}
      items={itemsWithFiat}
      activeItemId={activeId}
      loading={loading}
      skeletonCount={4}
      enableDragScroll
      showArrows
      compactCards
      hideCardBadges
      compactHeader
      renderItem={renderItem}
      onCardClick={(id) => {
        // The placeholder card id starts with __placeholder_ — guard so it
        // doesn't navigate when (somehow) clicked.
        if (id.startsWith('__placeholder_')) return
        navigate(toDetailRoute(id))
      }}
    />
  )
}