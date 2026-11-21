import { useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { instantScrollToTop, smoothScrollToTop } from '../lib/lenis-setup'

/**
 * Restores scroll position to the top on route changes.
 *
 * React Router's <ScrollRestoration> is intentionally not used because Lenis
 * owns smooth scrolling. This component mirrors that behaviour by observing
 * pathname changes and smoothly scrolling to the top.
 *
 * ADR-303 D4 (fromDock branch): when the route change carries
 * `state: { fromDock: true }` (Home → /coop scroll-dock commit), the scroll
 * reset is INSTANT and happens before paint (useLayoutEffect) — at commit the
 * full-viewport dock preview already occupies exactly the pixels the target
 * page's top will occupy, so an animated scroll-up would visually betray the
 * swap. The fromDock pattern is reusable for future dock transitions.
 */
export function ScrollToTop() {
  const location = useLocation()
  const { pathname } = location
  const previousPathname = useRef<string>(pathname)

  useLayoutEffect(() => {
    if (previousPathname.current !== pathname) {
      previousPathname.current = pathname
      const fromDock = (location.state as { fromDock?: boolean } | null)?.fromDock === true
      if (fromDock) instantScrollToTop()
      else smoothScrollToTop()
    }
  }, [pathname, location.state])

  return null
}
