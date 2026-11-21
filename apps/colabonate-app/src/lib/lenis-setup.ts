/**
 * Performant GSAP Smooth Scroll via Lenis.
 *
 * Architecture:
 * - Lenis hijacks native scroll → smooth RAF-driven scroll position.
 * - GSAP ScrollTrigger is kept in sync via lenis.on('scroll') → ScrollTrigger.update().
 * - Lenis RAF is driven by the GSAP ticker (single animation frame for Lenis + ScrollTrigger).
 * - React Router's <ScrollRestoration> is suppressed (lenis replaces it).
 *
 * Performance notes (gsap-performance skill):
 * - Lenis runs on the main thread but uses a simple lerp model — minimal overhead.
 * - ScrollTrigger.update() is called once per frame, not on every scroll event.
 * - prefers-reduced-motion disables Lenis entirely (native scroll untouched).
 */

import Lenis from 'lenis'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

let lenisInstance: Lenis | null = null
let lenisTicker: ((time: number) => void) | null = null
let overlayLockObserver: MutationObserver | null = null

// Local view of the window property we expose for programmatic smooth scroll.
// Declared standalone (NOT intersected with `Window`) so it doesn't clash with
// the global `lenis` typing already present on `Window`.
interface LenisWindow {
  lenis?: Lenis
}

/**
 * Initialize smooth scroll. Safe to call multiple times — returns the
 * existing instance if already initialised.
 *
 * Call once in App.tsx after providers are mounted.
 * Returns the instance so ScrollRestoration can be disabled.
 */
export function initSmoothScroll(): Lenis {
  if (lenisInstance) return lenisInstance

  // Respect prefers-reduced-motion — leave native scroll untouched.
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (prefersReduced) return null as unknown as Lenis

  lenisInstance = new Lenis({
    duration: 1.0,          // transition duration in seconds — lower = snappier, less input lag
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // ease-out-expo
    orientation: 'vertical',
    smoothWheel: true,       // hijack wheel events for smooth interpolation
    // ADR-278/FU-278-A: without this, Lenis preventDefault()s EVERY wheel event
    // and scrolls only the window — no inner scroll container (MUI Dialog/Menu
    // content, chat lists, drawers, sidebars) can ever be mouse-scrolled.
    // allowNestedScroll makes Lenis probe the event path for a container that
    // can still scroll in the wheel direction and defer to native scrolling
    // there (native chaining semantics). `data-lenis-prevent` stays the
    // stronger, explicit opt-out for structural regions (list-browser sidebar
    // card, onboarding pager) — it exempts the whole subtree even at the
    // inner scroll edge, where allowNestedScroll would hand back to Lenis.
    // Safe for window scrolling here: no ancestor of normal page content
    // matches the probe (html is excluded as Lenis's rootElement; body/main
    // use overflow: clip) — verified 2026-08-16, see ADR-278 audit.
    allowNestedScroll: true,
    syncTouch: false,        // no touch sync needed on desktop app
    touchMultiplier: 1.5,   // touch swipe sensitivity
  })

  // ── Single RAF Loop (GSAP ticker) ────────────────────────────────────────
  // Drive Lenis from the GSAP ticker so Lenis and ScrollTrigger share ONE
  // animation frame instead of running a separate requestAnimationFrame loop
  // (no double rAF, no per-scroll closure allocation). lagSmoothing(0) keeps
  // Lenis and ScrollTrigger frame-locked. (gsap-performance skill: single loop)
  lenisTicker = (time: number) => lenisInstance!.raf(time * 1000)
  gsap.ticker.add(lenisTicker)
  gsap.ticker.lagSmoothing(0)

  // ── ScrollTrigger Sync ───────────────────────────────────────────────────
  // Lenis owns the scroll position — hand ScrollTrigger its update fn by
  // reference so it recomputes once per frame with no extra wrapper closure.
  lenisInstance.on('scroll', ScrollTrigger.update)

  // ── Public scroll utilities ──────────────────────────────────────────────
  // Expose scrollTo for programmatic smooth scrolling (e.g. scrollIntoView).
  ;(window as unknown as LenisWindow).lenis = lenisInstance

  // ── Overlay scroll lock (FU-278-A) ───────────────────────────────────────
  // Overlays lock page scrolling by hiding overflow on a root element — but
  // that does NOT lock this app's scroller: index.css keeps
  // `html.lenis { overflow-y: scroll }` so the native scrollbar stays present,
  // and an `overflow: hidden` root only blocks USER scrolling — programmatic
  // window.scrollTo still moves it, which is exactly what Lenis does. Without
  // this mirror, the window keeps smooth-scrolling behind every open overlay.
  // Two lock styles must be covered:
  //   • FilterDrawerShell sets `body.style.overflow = 'hidden'`
  //   • MUI v7 ModalManager sets `documentElement.style.overflow = 'hidden'`
  //     (it targets html instead of body when html has computed
  //     `overflow-y: scroll` — the `html.lenis` rule)
  // Mirroring the lock onto Lenis is the central fix: while stopped, Lenis
  // preventDefaults wheel events that no inner container consumes — nothing
  // scrolls behind the overlay. Overlay CONTENT still wheel-scrolls natively
  // because Lenis runs the `data-lenis-prevent`/allowNestedScroll path check
  // BEFORE the isStopped branch, and at the content's scroll end the stopped
  // branch cancels native chaining (no leak to the window).
  const isOverlayLocked = () =>
    document.body.style.overflow === 'hidden'
    || document.documentElement.style.overflow === 'hidden'
  const syncOverlayLock = () => {
    if (isOverlayLocked()) lenisInstance!.stop()
    else lenisInstance!.start()
  }
  syncOverlayLock()
  overlayLockObserver = new MutationObserver(syncOverlayLock)
  overlayLockObserver.observe(document.body, { attributes: true, attributeFilter: ['style'] })
  overlayLockObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })

  return lenisInstance
}

/**
 * Scroll to a target element smoothly. Use this instead of
 * element.scrollIntoView() for consistent smooth behaviour.
 */
export function smoothScrollTo(target: string | HTMLElement, offset = 0) {
  if (!lenisInstance) {
    const el = typeof target === 'string' ? document.querySelector(target) : target
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  lenisInstance.scrollTo(target as string | HTMLElement, { offset, duration: 1.4 })
}

/**
 * Smoothly scroll to the top of the page. Falls back to native scroll when
 * Lenis is disabled (prefers-reduced-motion).
 */
export function smoothScrollToTop() {
  if (!lenisInstance) {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }
  lenisInstance.scrollTo(0, { duration: 1.2 })
}

/**
 * Instantly reset scroll to the top — no animation. Used by ScrollToTop's
 * fromDock branch (ADR-303 D4): at the dock commit the full-viewport preview
 * already occupies exactly the pixels the target page's top will occupy, so an
 * animated scroll-up would visually betray the swap.
 */
export function instantScrollToTop() {
  if (!lenisInstance) {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    return
  }
  lenisInstance.scrollTo(0, { immediate: true })
}

/** Stop and destroy the Lenis instance. Call on app unmount if needed. */
export function destroySmoothScroll() {
  overlayLockObserver?.disconnect()
  overlayLockObserver = null
  if (lenisTicker) gsap.ticker.remove(lenisTicker)
  lenisTicker = null
  lenisInstance?.destroy()
  lenisInstance = null
  ;(window as unknown as LenisWindow).lenis = undefined
}
