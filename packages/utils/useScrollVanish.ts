import { useEffect, type RefObject } from 'react'

export interface ScrollVanishOptions {
  /** Master switch. When false the hook is inert and clears any styles it set. */
  enabled?: boolean
  /** Temporarily hold the element fully visible (e.g. while its menu is open). */
  paused?: boolean
  /** Upward travel (px) at full vanish. */
  maxShift?: number
  /** Blur (px) at full vanish. */
  maxBlur?: number
}

// Damped-spring constants tuned for a soft, unhurried rubber-band wobble.
// Lower damping = bouncier; lower stiffness = slower return.
const STIFFNESS = 0.085
const DAMPING = 0.75
// Distance (px) from an edge within which the page counts as "at" that edge.
const EDGE_GUARD = 4
// Accumulated overscroll (px) that maps to a full vanish.
const MAX_OVER = 260
// Per-frame decay of the overscroll pull, so releasing springs the FAB back.
// Higher = the pull lingers longer, so the FAB returns more slowly.
const DECAY = 0.94

/**
 * Overscroll-driven vanish for a fixed element. The element stays put during
 * normal scrolling; only when the page is already pinned at an edge and the
 * user keeps pulling past it does it drift away while fading + blurring — at
 * the top it drifts UP, at the bottom it drifts DOWN, and the harder the pull,
 * the more it vanishes. Releasing lets the pull decay and the element
 * rubber-bands back through a damped spring. Honors `prefers-reduced-motion`
 * by snapping.
 *
 * Listens to `wheel` + `touchmove` because scroll events don't fire once
 * `scrollY` is pinned at an edge. Writes `opacity` / `transform` / `filter` /
 * `pointerEvents` directly on the ref'd element via rAF, so it never re-renders
 * the component. Apply it to a positioning wrapper, not the interactive button,
 * so hover/active transforms stay independent. Do NOT add a CSS transition for
 * these properties — the spring is the smoothing.
 */
export function useScrollVanish(
  ref: RefObject<HTMLElement | null>,
  {
    enabled = true,
    paused = false,
    maxShift = 64,
    maxBlur = 6,
  }: ScrollVanishOptions = {},
) {
  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const stiffness = reduced ? 1 : STIFFNESS
    const damping = reduced ? 0 : DAMPING
    const decay = reduced ? 0 : DECAY

    let over = 0 // accumulated overscroll past the active edge, px
    let dir = -1 // drift direction: -1 = up (top edge), +1 = down (bottom edge)
    let cur = 0
    let vel = 0
    let raf = 0

    const atTop = () => window.scrollY <= EDGE_GUARD
    const atBottom = () =>
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - EDGE_GUARD

    const applyStyles = (c: number) => {
      // Visual props clamp to a valid range; transform keeps the overshoot so
      // the wobble is visible in the motion itself. `dir` flips the drift for
      // the bottom edge.
      const vis = Math.min(1, Math.max(0, c))
      el.style.opacity = String(1 - vis)
      // Firefox mobile bug: a non-`none` transform on a `position: fixed`
      // wrapper re-parents the fixed positioning context to that element, so
      // the FAB stops being fixed to the viewport and scrolls with the page.
      // Only write the transform while the spring is visibly moving; clear it
      // (don't leave `translateY(0)`) once it's settled.
      if (vis > 0.001) {
        el.style.transform = `translateY(${(dir * c * maxShift).toFixed(2)}px)`
      } else {
        el.style.transform = ''
      }
      el.style.filter = vis > 0.001 ? `blur(${(vis * maxBlur).toFixed(2)}px)` : 'none'
      el.style.pointerEvents = vis > 0.95 ? 'none' : 'auto'
    }

    const tick = () => {
      over *= decay
      if (over < 0.5) over = 0
      const t = paused ? 0 : Math.min(1, over / MAX_OVER)
      vel = vel * damping + (t - cur) * stiffness
      cur += vel
      if (over === 0 && Math.abs(t - cur) < 0.0005 && Math.abs(vel) < 0.0005) {
        cur = t
        vel = 0
        applyStyles(cur)
        raf = 0
        return
      }
      applyStyles(cur)
      raf = requestAnimationFrame(tick)
    }

    const kick = () => { if (!raf) raf = requestAnimationFrame(tick) }

    const addPull = (px: number) => {
      over = Math.min(MAX_OVER * 1.15, over + px)
      kick()
    }

    const onWheel = (e: WheelEvent) => {
      if (paused) return
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1
      const delta = e.deltaY * unit
      if (atTop() && delta < 0) { dir = -1; addPull(-delta) }       // pull up past top
      else if (atBottom() && delta > 0) { dir = 1; addPull(delta) } // pull down past bottom
    }

    let lastTouchY = 0
    const onTouchStart = (e: TouchEvent) => { lastTouchY = e.touches[0]?.clientY ?? 0 }
    const onTouchMove = (e: TouchEvent) => {
      if (paused) return
      const y = e.touches[0]?.clientY ?? lastTouchY
      const dy = y - lastTouchY // finger down → positive, finger up → negative
      lastTouchY = y
      if (atTop() && dy > 0) { dir = -1; addPull(dy * 1.5) }          // pull down past top
      else if (atBottom() && dy < 0) { dir = 1; addPull(-dy * 1.5) }  // pull up past bottom
    }

    applyStyles(cur)
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      if (raf) cancelAnimationFrame(raf)
      el.style.opacity = ''
      el.style.transform = ''
      el.style.filter = ''
      el.style.pointerEvents = ''
    }
  }, [ref, enabled, paused, maxShift, maxBlur])
}
