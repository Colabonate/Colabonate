/**
 * useViewportBottomOffset
 *
 * Firefox on Android sizes the initial containing block to the *small* viewport
 * (dynamic URL bar visible). When the URL bar hides on scroll, the visual
 * viewport grows at the bottom, but `position: fixed; bottom: 0` elements stay
 * anchored to the now-smaller layout viewport – the docked bar visibly floats
 * up by the toolbar height and sticks there. Chrome and Safari re-anchor such
 * elements to the visual viewport instead.
 *
 * Fix: measure the gap between the docked element's rendered bottom edge and
 * the visual viewport's bottom edge, then translate the element down by it.
 * The measurement includes any offset already applied, so it converges in one
 * step and stays a no-op (offset 0) in browsers that behave correctly – no
 * user-agent sniffing needed.
 *
 * The resolved value is also published as `--viewport-bottom-offset` on
 * <html> so other bottom-docked elements (FABs) can follow the same shift.
 */

import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

const CSS_VAR = '--viewport-bottom-offset'
/** Sanity bound – dynamic toolbars are well below this. */
const MAX_OFFSET = 200

export function useViewportBottomOffset<T extends HTMLElement>(
  enabled: boolean,
): { ref: RefObject<T | null>; offset: number } {
  const ref = useRef<T>(null)
  const applied = useRef(0)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    const root = document.documentElement
    const reset = () => {
      applied.current = 0
      setOffset(0)
      root.style.removeProperty(CSS_VAR)
    }

    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!enabled || !vv) {
      reset()
      return
    }

    let frame = 0

    const measure = () => {
      frame = 0
      const el = ref.current
      if (!el) return

      // getBoundingClientRect() is in layout-viewport coordinates; offsetTop
      // maps the visual viewport into that same space. rect.bottom already
      // reflects `applied.current`, which makes this self-correcting.
      const rect = el.getBoundingClientRect()
      const delta = vv.offsetTop + vv.height - rect.bottom
      if (Math.abs(delta) < 0.5) return

      const next = Math.min(MAX_OFFSET, Math.max(0, Math.round(applied.current + delta)))
      if (next === applied.current) return

      applied.current = next
      setOffset(next)
      root.style.setProperty(CSS_VAR, `${next}px`)
    }

    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(measure)
    }

    schedule()
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    window.addEventListener('orientationchange', schedule)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      window.removeEventListener('orientationchange', schedule)
      reset()
    }
  }, [enabled])

  return { ref, offset }
}
