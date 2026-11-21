import { useEffect, useMemo, useRef, type RefObject, type TouchEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { gsap } from 'gsap'
import type { SliderListItem } from '@ds/ui'
import { useReducedMotion } from './useReducedMotion'
import {
  applyContextFilters,
  type DetailSliderContextFilters,
  type DetailSliderSegment,
} from '../components/DetailSliderNav'

/**
 * Detail page ↔ swipe navigation (ADR-188 companion).
 *
 * On mobile, a horizontal touch swipe over the detail content navigates to the
 * next / previous item — following the **same segment the user selected in the
 * `DetailSliderNav`** (Vendor ↔ Marketplace). When Marketplace is active the
 * same context filters the slider applies are reused, so the swipe browses the
 * exact list the user sees in the slider.
 *
 * A GSAP slide-out animates the content in the swipe direction, then React
 * Router takes over; the arriving page reads the `detailSwipeDir` location
 * state and plays a matching slide-in.
 *
 * Swipes use `replace: true` so the browser-native Back button always returns
 * to the previous page in app navigation (the list/marketplace), not to the
 * previously-swiped item — swiping between items stays an in-place browse
 * gesture and never pollutes the back stack.
 *
 * Vertical movement is intentionally ignored so normal scrolling is never
 * hijacked, and the gesture only fires on touch devices within the mobile
 * breakpoint. Reduced-motion users get instant navigation.
 */

const MOBILE_MEDIA = '(max-width: 600px)'
const SWIPE_THRESHOLD = 55
export const DETAIL_SWIPE_STATE_KEY = 'detailSwipeDir'
export type DetailSwipeDir = 'next' | 'prev'

interface UseDetailSwipeNavOptions {
  /** wrapper around the detail content that slides on swipe */
  containerRef: RefObject<HTMLElement | null>
  /** currently active slider segment — decides which list is browsed */
  segment: DetailSliderSegment
  /** vendor siblings list (includes the active item) */
  vendorItems: SliderListItem[]
  /** marketplace list (includes the active item) */
  allItems: SliderListItem[]
  /** context filters applied to the marketplace list, mirroring the slider */
  contextFilters?: DetailSliderContextFilters
  activeId: string | undefined
  toRoute: (id: string) => string
  /** master switch (e.g. disable for non-cooperation entities on CoopDetail) */
  enabled?: boolean
  /**
   * Fired after a successful swipe navigation (not on rubber-band end-of-list).
   * Used by the one-time `SwipeHint` to dismiss itself on the first real
   * swipe so the user is never fighting the tutorial.
   */
  onSwipeNavigate?: () => void
}

interface SwipeState {
  detailSwipeDir?: DetailSwipeDir
}

export function useDetailSwipeNav({
  containerRef,
  segment,
  vendorItems,
  allItems,
  contextFilters,
  activeId,
  toRoute,
  enabled = true,
  onSwipeNavigate,
}: UseDetailSwipeNavOptions) {
  const navigate = useNavigate()
  const location = useLocation()
  const prefersReduced = useReducedMotion()
  const startX = useRef<number | null>(null)
  const startY = useRef<number | null>(null)

  const isMobile = () =>
    typeof window !== 'undefined' && window.matchMedia(MOBILE_MEDIA).matches

  // Resolve the browse list for the active segment, exactly like the slider:
  // vendor segment = vendor siblings, marketplace segment = context-filtered
  // marketplace list.
  const items = useMemo(
    () =>
      segment === 'vendor'
        ? vendorItems
        : applyContextFilters(allItems, contextFilters),
    [segment, vendorItems, allItems, contextFilters],
  )

  // Slide-in when arriving via a swipe (direction carried in location state).
  // IMPORTANT: navigating between two items only changes the route `id` param,
  // so React Router reuses the same component instance (no remount). We therefore
  // key the effect on `location.key` — which changes on every navigation — not
  // on mount. Without this the wrapper would stay at the slide-out end state
  // (opacity:0 / xPercent) and the page would render blank.
  useEffect(() => {
    const dir = (location.state as SwipeState | null)?.[DETAIL_SWIPE_STATE_KEY]
    const el = containerRef.current
    if (!dir || !el || prefersReduced) return
    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { xPercent: dir === 'next' ? 100 : -100, opacity: 0 },
        {
          xPercent: 0,
          opacity: 1,
          duration: 0.32,
          ease: 'power3.out',
          clearProps: 'opacity,transform',
        },
      )
    })
    return () => ctx.revert()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key, prefersReduced])

  const onTouchStart = (e: TouchEvent) => {
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
  }

  const onTouchEnd = (e: TouchEvent) => {
    if (!enabled || prefersReduced || !isMobile()) return
    if (startX.current === null || startY.current === null) return
    const dx = startX.current - e.changedTouches[0].clientX
    const dy = startY.current - e.changedTouches[0].clientY
    startX.current = null
    startY.current = null
    if (Math.abs(dx) < SWIPE_THRESHOLD) return
    // vertical-dominant gesture → let the page scroll
    if (Math.abs(dx) < Math.abs(dy)) return
    // nothing to browse (single item or empty)
    if (items.length <= 1) return

    const idx = items.findIndex(i => i.id === activeId)
    if (idx === -1) return
    const dir: DetailSwipeDir = dx > 0 ? 'next' : 'prev'
    const targetIdx = dir === 'next' ? idx + 1 : idx - 1
    const el = containerRef.current

    // End of list → gentle rubber-band nudge, no navigation.
    if (targetIdx < 0 || targetIdx >= items.length) {
      if (el) {
        gsap.fromTo(
          el,
          { x: dir === 'next' ? 14 : -14 },
          { x: 0, duration: 0.35, ease: 'elastic.out(1, 0.4)' },
        )
      }
      return
    }

    const go = (): void => {
      navigate(toRoute(items[targetIdx].id), {
        replace: true,
        state: { [DETAIL_SWIPE_STATE_KEY]: dir },
      })
      onSwipeNavigate?.()
    }

    if (!el) {
      go()
      return
    }
    gsap.to(el, {
      xPercent: dir === 'next' ? -100 : 100,
      opacity: 0,
      duration: 0.26,
      ease: 'power2.in',
      onComplete: go,
    })
  }

  return { onTouchStart, onTouchEnd }
}
