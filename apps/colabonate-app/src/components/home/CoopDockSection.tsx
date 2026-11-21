// CoopDockSection — Home → /search scroll-dock transition (ADR-324 D1–D8;
// supersedes the ADR-303 D1–D8 dock section, whose target was /coop).
//
// Rendered AFTER the Footer in Layout.tsx as a compact end-of-Home section
// (snap stage). The PageHeader is `hidden` on purpose — it must never render a
// visible page header here (user request); it only feeds the mobile nav bar.
// Once the section is fully visible, the page
// LOCKS — it does not scroll any further. Continued scroll input only
// stretches a virtual rubber band (damped wheel consumption + a scroll clamp
// that converts any overflow into tension for touch/scrollbar/keys); stopping
// lets the visualization spring back to slack; tension = 1 commits to
// /search?context=coop.
//
// Reduced-motion (D6) + prerender get a static CTA card.
//
// Snap-dock indicator (ADR-324 addendum): the approach is visualized as a
// rubber-band mechanism — a blurred "Search & Explore" card travels upward
// into a dashed target outline. A damped progress curve gives increasing
// resistance the closer the card gets; blur dissolves as it sharpens into its
// dock. The resistance is REAL, not just visual: downward wheel input inside
// the approach span is intercepted before Lenis and re-applied with a damping
// factor that shrinks toward the commit point — the user must overcome the
// resistance with continued scrolling, and progress = 1 triggers the elastic
// GSAP snap + route commit. The former skeleton/preview mirror of Search's
// above-the-fold (KPIStrip skeleton, ContextSwitcher mirror, preview rows)
// was removed by user request — the snap stage alone communicates the
// transition.

import { useEffect, useRef, type RefObject } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { gsap } from 'gsap'
import type Lenis from 'lenis'
import { PageContainer } from '@ds/ui'
import { cn } from '@ds/utils'
import { PageHeader } from '../PageHeader'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { cooperationsDiscoverQueryOptions, companiesQueryOptions } from '../../hooks/useEntityQueries'
import { fetchOfferSearch, getListingNextPageParam } from '../../hooks/useOfferSearch'
import { readSession } from '../../hooks/useSessionState'
import { queryClient } from '../../lib/queryClient'

const PREFETCH_AHEAD_PX = 600
// Rubber-band damping: damped = 1 - (1 - p)^RUBBER_EXPONENT. Exponent > 1
// means early scroll moves the snap card quickly while each additional pixel
// near the dock yields less movement — perceived resistance builds toward the
// snap point, like stretching a rubber band.
const RUBBER_EXPONENT = 1.7
// Resistance (scroll-lock model): once the trigger section is fully visible,
// the page stops scrolling entirely. The invisible spacer (SPACER_VH) below
// provides (a) the overflow buffer the scroll clamp converts into virtual
// tension for non-wheel inputs (touch flings, scrollbar, PgDn/End) and (b)
// the tension normalization length. Wheel input at the lock is fully consumed
// (page frozen) and builds tension damped by
// factor = MIN_WHEEL_FACTOR + (1-MIN)·(1-p)^WHEEL_DAMP_EXPONENT — halved
// strength (user request): MIN 0.18, exponent 1.5, ≈2× raw input to commit.
// Releasing input lets the visualization spring back to slack.
//
// Touch devices (FU-342, 2026-09-04): the desktop tuning made a commit cost
// ~4× a screen height of cumulative swiping, and the 500 ms spring-back threw
// away partial progress on every pause. Touch surfaces use the MOBILE_*
// overrides instead: a shorter spacer (shorter absolute scroll distance AND
// shorter tension normalization length), a damping floor raised toward linear
// so late-game progress isn't bled off, and spring-back disabled — 1–2 short
// swipes at the lock commit the transition (user request, 2026-09-04).
const SPACER_VH = 100
const MIN_WHEEL_FACTOR = 0.18
const WHEEL_DAMP_EXPONENT = 1.5
const SPRING_IDLE_MS = 500
const MOBILE_SPACER_VH = 60
const MOBILE_MIN_WHEEL_FACTOR = 0.6
const MOBILE_WHEEL_DAMP_EXPONENT = 1.2
// The snap stage sticks to the viewport bottom (this gap below it) once the
// user has scrolled it DOCK_BOTTOM_GAP px up from the bottom edge — the
// visualization must stay in view while the rubber band is fought, never
// scrolling out of the page. Also clears the 58px mobile bottom nav.
const DOCK_BOTTOM_GAP = 80

const SEARCH_TARGET = '/search?context=coop'

// Mirror Search.tsx's countryFilter mount resolution so the prefetched
// offer-search key matches the query Search actually mounts with. ADR-418 D6:
// Search starts on "All countries" (the dock link carries no `proximity`), so
// only a sessionStorage override from an earlier visit can differ.
function defaultSearchCountry(): string | undefined {
  const MISS = '\0miss'
  const session = readSession<string>('search:countryFilter', MISS)
  return session !== MISS ? (session || undefined) : undefined
}

// D4 — prefetch the Search chunk AND its two data queries during the dock
// approach, so Search mounts with warm caches. Both prefetchQuery calls are
// fire-and-forget: TanStack dedupes against in-flight/fresh entries, and a
// missed prefetch just means Search shows its normal loading state.
function prefetchSearchData() {
  void import('../../routes/home/Search')

  // Coop data — ADR-376 D1/D5: warm the same canonical, SHARED cache entries
  // Home's "Services & Collaborations" slider and useCoopExploreData's
  // coop-context composition both read (was one opaque `['coop-explore-data']`
  // bundle before the D1 decomposition; that key no longer exists).
  void queryClient.prefetchQuery(cooperationsDiscoverQueryOptions('', 100))
  void queryClient.prefetchQuery(companiesQueryOptions())
  for (const offerType of ['COOP', 'SERVICE', 'AGENT_SETUP'] as const) {
    void queryClient.prefetchInfiniteQuery({
      queryKey: ['listings', 'marketplace', { offerType }],
      queryFn: ({ pageParam }) => fetchOfferSearch({ offerType }, 100, pageParam as string | undefined),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: getListingNextPageParam,
      pages: 1,
      staleTime: 30_000,
    })
  }

  // Marketplace data — ADR-363 D1: warm the SAME infinite-query entry that
  // Search mounts (['listings', 'marketplace', params], see useListingFeed in
  // useOfferSearch.ts), so the dock transition lands on warm caches. No
  // query/filter = Search's default "newest offers" view. The country is
  // resolved the way Search resolves it on mount (see defaultSearchCountry);
  // undefined values hash out of the query key, so `{ country: 'DE' }` matches
  // Search's `{ q: undefined, …, country: 'DE' }`.
  const country = defaultSearchCountry()
  const params = country ? { country } : {}
  void queryClient.prefetchInfiniteQuery({
    queryKey: ['listings', 'marketplace', params],
    queryFn: ({ pageParam }) => fetchOfferSearch(params, 100, pageParam as string | undefined),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: getListingNextPageParam,
    pages: 1,
    staleTime: 30_000,
  })
}

// ─── Snap-dock indicator ─────────────────────────────────────────────────────
// Pure CSS-var consumer: the section's scroll handler writes --dock-progress /
// --dock-damped, this stage never re-renders while scrolling. The metaphor is
// an "Aufschieben" slot: a blurred card travels up into a dashed outline (the
// dock), un-blurring as resistance builds, then snaps in elastically at commit.
function DockSnapStage({ cardRef, isMobile }: { cardRef: RefObject<HTMLDivElement | null>; isMobile: boolean }) {
  const cardHeight = isMobile ? 72 : 84
  const snapDistance = isMobile ? 48 : 56
  const bracket = '2px solid var(--color-primary-50)'
  return (
    <div aria-hidden="true" style={{ width: 'min(440px, 100%)', margin: `${isMobile ? 12 : 16}px auto 0` }}>
      {/* Slot: dashed dock outline + traveling card below it */}
      <div className="relative" style={{ height: cardHeight + snapDistance }}>
        {/* Dock outline (snap target) with viewfinder brackets */}
        <div
          className="absolute left-0 right-0 top-0 rounded-2xl"
          style={{
            height: cardHeight,
            border: '1.5px dashed rgba(232,69,65,0.85)',
            opacity: 'calc(0.30 + 0.70 * var(--dock-damped, 0))',
          }}
        >
          <span className="absolute" style={{ top: -5, left: -5, width: 18, height: 18, borderLeft: bracket, borderTop: bracket, borderTopLeftRadius: 8 }} />
          <span className="absolute" style={{ top: -5, right: -5, width: 18, height: 18, borderRight: bracket, borderTop: bracket, borderTopRightRadius: 8 }} />
          <span className="absolute" style={{ bottom: -5, left: -5, width: 18, height: 18, borderLeft: bracket, borderBottom: bracket, borderBottomLeftRadius: 8 }} />
          <span className="absolute" style={{ bottom: -5, right: -5, width: 18, height: 18, borderRight: bracket, borderBottom: bracket, borderBottomRightRadius: 8 }} />
        </div>

        {/* Traveling card — offset + blur driven by the damped progress var.
            Outer div owns the var-driven motion; the inner div is GSAP's snap
            target, so the two transforms never fight each other. */}
        <div
          className="absolute left-0 right-0 top-0"
          style={{
            height: cardHeight,
            transform: `translateY(calc((1 - var(--dock-damped, 0)) * ${snapDistance}px)) scale(calc(0.96 + 0.04 * var(--dock-damped, 0)))`,
            filter: 'blur(calc((1 - var(--dock-damped, 0)) * 10px))',
          }}
        >
          <div
            ref={cardRef}
            className="flex h-full w-full items-center gap-3 rounded-2xl px-4"
            style={{
              background: 'var(--theme-surface)',
              border: '1px solid var(--theme-border)',
              boxShadow: '0 16px 40px rgba(0,0,0,0.18)',
            }}
          >
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{ background: 'rgba(232,69,65,0.12)', color: 'var(--color-primary-50)' }}
            >
              <Search size={18} />
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-semibold" style={{ color: 'var(--theme-text)' }}>
                Search & Explore
              </span>
              <span className="truncate text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                Marketplace & cooperations — one query, two lenses
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tension track — linear fill toward the commit point. The contrast to
          the damped card motion is what makes the resistance readable: the bar
          keeps filling while the card barely moves anymore. */}
      <div className="relative mt-3 overflow-hidden rounded-full" style={{ height: 4, background: 'var(--theme-border)' }}>
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: 'calc(var(--dock-progress, 0) * 100%)',
            background: 'linear-gradient(90deg, var(--color-accent-1), var(--color-primary-50))',
          }}
        />
      </div>

      {/* Cross-fading hint labels (flip at 50% progress) */}
      <div className="relative mt-2" style={{ height: 16 }}>
        <span
          className="absolute inset-0 text-center text-xs font-medium"
          style={{ color: 'var(--theme-text-muted)', opacity: 'calc(1 - min(1, var(--dock-progress, 0) * 2))' }}
        >
          Keep scrolling to enter
        </span>
        <span
          className="absolute inset-0 text-center text-xs font-semibold"
          style={{ color: 'var(--color-primary-50)', opacity: 'calc(max(0, var(--dock-progress, 0) * 2 - 1))' }}
        >
          Almost there — releasing into Search
        </span>
      </div>
    </div>
  )
}

export function CoopDockSection() {
  const navigate = useNavigate()
  const prefersReduced = useReducedMotion()
  const { isMobile } = useBreakpoint()
  // Touch tuning (FU-342): isMobile (viewport < 600px) misses coarse-pointer
  // surfaces like landscape phones and tablets, so gate on either signal.
  const isTouch =
    isMobile
    || (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches)
  const spacerVh = isTouch ? MOBILE_SPACER_VH : SPACER_VH
  const sectionRef = useRef<HTMLElement>(null)
  const stageWrapRef = useRef<HTMLDivElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const committedRef = useRef(false)
  const snapCardRef = useRef<HTMLDivElement>(null)
  const snapTlRef = useRef<gsap.core.Timeline | null>(null)

  useEffect(() => {
    if (prefersReduced || !sectionRef.current) return

    const section = sectionRef.current

    // Effective resistance params: desktop keeps the damped rubber band;
    // touch is near-linear so a commit costs ~1.3× the spacer length of raw
    // input instead of ~4× (see MOBILE_* constants above).
    const minWheelFactor = isTouch ? MOBILE_MIN_WHEEL_FACTOR : MIN_WHEEL_FACTOR
    const wheelDampExp = isTouch ? MOBILE_WHEEL_DAMP_EXPONENT : WHEEL_DAMP_EXPONENT
    const dampFactor = (t: number) =>
      minWheelFactor + (1 - minWheelFactor) * Math.pow(1 - Math.min(1, t), wheelDampExp)

    // Prefetch observer: fires well ahead.
    const prefetchObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          prefetchSearchData()
          prefetchObserver.disconnect()
        }
      },
      { rootMargin: `${PREFETCH_AHEAD_PX}px` },
    )
    prefetchObserver.observe(section)

    const overlayLocked = () =>
      document.body.style.overflow === 'hidden'
      || document.documentElement.style.overflow === 'hidden'

    // Sticky pin line for the WHOLE trigger block (header + snap stage): pins
    // with its bottom DOCK_BOTTOM_GAP px above the viewport bottom. Measured
    // from the rendered block height (breakpoint-dependent), re-measured on
    // resize, clamped at 0 for very short viewports. The CSS fallback (100dvh)
    // keeps the block below the pin line until measured, so it never pins
    // prematurely.
    const measureStickyTop = () => {
      const wrap = stageWrapRef.current
      if (!wrap) return
      const topPx = Math.max(0, window.innerHeight - Math.round(wrap.offsetHeight) - DOCK_BOTTOM_GAP)
      section.style.setProperty('--dock-sticky-top', `${topPx}px`)
    }
    measureStickyTop()

    // Lock point: the scroll position where the whole trigger block is fully
    // visible with DOCK_BOTTOM_GAP px below it. Computed from the SECTION's
    // document offset (stable — its children stick inside it, the section box
    // itself never moves) plus the wrapper's offsetHeight (unaffected by
    // sticky). Past this point the page must NOT scroll any further.
    const lockScrollY = () => {
      const wrap = stageWrapRef.current
      if (!wrap) return Number.POSITIVE_INFINITY
      const secTop = section.getBoundingClientRect().top + window.scrollY
      return Math.max(0, secTop + wrap.offsetHeight + DOCK_BOTTOM_GAP - window.innerHeight)
    }
    // Tension normalization length: the scrollable room between the lock
    // point and the page's max scroll (= spacer height − DOCK_BOTTOM_GAP). A
    // full jump to the page bottom therefore converts to exactly tension = 1
    // (clear intent to go all the way through).
    const spanLength = () => {
      const maxScrollY = document.documentElement.scrollHeight - window.innerHeight
      return Math.max(1, maxScrollY - lockScrollY())
    }

    // Virtual tension: once the page is locked, scroll input no longer moves
    // the page at all — it only stretches the band (this value 0..1). The
    // visualization (CSS vars) is driven by it; commit fires at 1.
    let tension = 0
    const writeViz = () => {
      const p = Math.max(0, Math.min(1, tension))
      const damped = 1 - Math.pow(1 - p, RUBBER_EXPONENT)
      section.style.setProperty('--dock-progress', p.toFixed(4))
      section.style.setProperty('--dock-damped', damped.toFixed(4))
      section.style.setProperty('--dock-glow-opacity', p.toFixed(4))
    }

    // Commit: the resistance was overcome (tension = 1). The card snaps into
    // its dock elastically while the glow peaks; the route commits ~340ms in.
    const commit = () => {
      if (committedRef.current) return
      committedRef.current = true
      cancelSpring()
      killSpringTween()

      const card = snapCardRef.current
      section.style.setProperty('--dock-progress', '1')
      section.style.setProperty('--dock-damped', '1')
      if (!card) {
        navigate(SEARCH_TARGET, { state: { fromDock: true } })
        return
      }

      snapTlRef.current = gsap.timeline()
        .to(section, { '--dock-glow-opacity': 1.35, duration: 0.2, ease: 'power2.out' }, 0.05)
        .fromTo(card, { y: 0 }, { y: -7, duration: 0.1, ease: 'power2.out' }, 0.1)
        .to(card, { y: 0, duration: 0.55, ease: 'elastic.out(1, 0.45)' }, 0.2)
        .call(() => { navigate(SEARCH_TARGET, { state: { fromDock: true } }) }, undefined, 0.34)
    }

    // ── Scroll lock — the page stops cold at the lock point ──────────────────
    // Any scroll position beyond lockScrollY() is clamped back immediately;
    // the overflow is converted into virtual tension. This is the safety net
    // for every input the wheel handler can't consume (touch flings, scrollbar
    // drags, PgDn/End keys) AND the seamless transition for the one wheel tick
    // that jumps across the lock point mid-Lenis-animation.
    // After COMMIT the lock stays engaged until the route unmounts Home —
    // during the snap animation + router transition the section must stay
    // glued to the footer; the page must not drift into the spacer.
    const clampToLock = (lockY: number) => {
      const lenis = (window as unknown as { lenis?: Lenis }).lenis
      if (lenis) lenis.scrollTo(lockY, { immediate: true, force: true })
      else window.scrollTo({ top: lockY })
    }
    const onScroll = () => {
      if (overlayLocked()) return
      const lockY = lockScrollY()
      const y = window.scrollY
      if (committedRef.current) {
        if (y > lockY + 0.5) clampToLock(lockY)
        return
      }
      if (y < lockY - 1) {
        // Scrolled back above the lock — the band is released entirely.
        if (tension > 0) {
          tension = 0
          writeViz()
        }
        return
      }
      if (y <= lockY + 0.5) return // sitting AT the lock — nothing to do
      const len = spanLength()
      if (len <= 0) return
      const overflow = y - lockY
      const factor = dampFactor(tension)
      tension += (overflow * factor) / len
      clampToLock(lockY)
      writeViz()
      if (tension >= 1) commit()
      else armSpring()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    const onResize = () => {
      measureStickyTop()
    }
    window.addEventListener('resize', onResize, { passive: true })

    // ── Wheel resistance — consumed at the lock, page never moves ────────────
    // Once locked, downward wheel input is fully consumed BEFORE Lenis and
    // only stretches the band (damped by the factor curve — the halved
    // strength). Upward input first releases built-up tension; once the band
    // is slack, the page scrolls up freely again. Never intercepts: horizontal
    // deltas, overlay-locked pages, data-lenis-prevent subtrees, pinch-zoom.
    const onWheel = (e: WheelEvent) => {
      if (e.defaultPrevented || e.ctrlKey) return
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      if (overlayLocked()) return
      for (const node of e.composedPath()) {
        if (node instanceof Element && node.hasAttribute('data-lenis-prevent')) return
      }

      // After COMMIT the page is frozen for good: consume ALL vertical wheel
      // input (both directions) until the route unmounts Home, so the snap
      // animation + router transition can't be scrolled apart from the footer.
      if (committedRef.current) {
        e.preventDefault()
        e.stopImmediatePropagation()
        return
      }

      const len = spanLength()
      if (len <= 0) return
      const lockY = lockScrollY()
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1)

      if (dy > 0) {
        if (window.scrollY < lockY - 1) return // free scroll toward the lock
        // Locked: consume entirely — the page must not scroll any further.
        e.preventDefault()
        e.stopImmediatePropagation()
        cancelSpring()
        killSpringTween()
        const factor = dampFactor(tension)
        tension += (dy * factor) / len
        writeViz()
        if (tension >= 1) commit()
        else armSpring()
        return
      }

      // Upward: unwind the band first, then let the page scroll up freely.
      if (tension > 0.01 && window.scrollY >= lockY - 1) {
        e.preventDefault()
        e.stopImmediatePropagation()
        cancelSpring()
        killSpringTween()
        tension = Math.max(0, tension + dy / len)
        writeViz()
        return
      }
      if (tension > 0) {
        tension = 0
        writeViz()
      }
    }
    window.addEventListener('wheel', onWheel, { passive: false, capture: true })

    // ── Spring-back — the band relaxes, the page stays locked ────────────────
    // When input stops with tension in (0,1), the visualization eases back to
    // slack (card sinks + blurs, track empties). No page movement is involved.
    let springTimer = 0
    let springTween: gsap.core.Tween | null = null
    const springObj = { t: 0 }
    function cancelSpring() {
      if (springTimer) window.clearTimeout(springTimer)
      springTimer = 0
    }
    function killSpringTween() {
      springTween?.kill()
      springTween = null
    }
    function armSpring() {
      // Touch (FU-342): no spring-back — partial swipes keep their progress;
      // the band only resets by scrolling back above the lock or committing.
      if (isTouch) return
      cancelSpring()
      springTimer = window.setTimeout(() => {
        springTimer = 0
        if (committedRef.current || overlayLocked()) return
        if (tension <= 0 || tension >= 1) return
        springObj.t = tension
        springTween = gsap.to(springObj, {
          t: 0,
          duration: Math.min(1.2, 0.4 + 0.8 * tension),
          ease: 'power2.out',
          onUpdate: () => {
            tension = springObj.t
            writeViz()
          },
          onComplete: () => {
            tension = 0
            springTween = null
          },
        })
      }, SPRING_IDLE_MS)
    }

    // FU-410: while any pixel of the dock is in the viewport, flag it on
    // <body> — fixed FAB layers (.fab-layer) hide via the global CSS rule so
    // they don't cover the preview during the final approach.
    const fabObserver = new IntersectionObserver(
      (entries) => {
        document.body.toggleAttribute('data-dock-approach', entries[0]?.isIntersecting ?? false)
      },
      { threshold: 0 },
    )
    fabObserver.observe(section)

    return () => {
      prefetchObserver.disconnect()
      fabObserver.disconnect()
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions)
      cancelSpring()
      killSpringTween()
      snapTlRef.current?.kill()
      document.body.removeAttribute('data-dock-approach')
    }
  }, [prefersReduced, navigate, isTouch])

  // ── D6 — reduced-motion fallback ─────────────────────────────────────────
  if (prefersReduced) {
    return (
      <section aria-label="Search & Explore" className="mt-4 md:mt-8">
        <PageContainer size="wide" spacing="none" gap="none">
          <Link
            to={SEARCH_TARGET}
            className={cn(
              'flex items-center justify-between gap-3 rounded-xl border p-4 md:p-5',
              'transition-colors duration-200',
            )}
            style={{
              background: 'var(--theme-surface)',
              borderColor: 'var(--theme-border)',
            }}
          >
            <span className="flex items-center gap-3 min-w-0">
              <span
                className="flex items-center justify-center w-10 h-10 rounded-xl shrink-0"
                style={{ background: 'var(--theme-bg-subtle)', color: 'var(--theme-text-muted)' }}
              >
                <Search size={18} />
              </span>
              <span className="flex flex-col min-w-0">
                <span className="text-sm font-semibold" style={{ color: 'var(--theme-text)' }}>
                  Search & Explore
                </span>
                <span className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                  One query, two lenses — marketplace and cooperations
                </span>
              </span>
            </span>
            <span className="text-sm font-semibold shrink-0" style={{ color: 'var(--color-primary-50)' }}>
              Open Search →
            </span>
          </Link>
        </PageContainer>
      </section>
    )
  }

  return (
    <section ref={sectionRef} aria-label="Search & Explore">
      {/* Sticky trigger block — the WHOLE section (header + snap stage) as one
          unit. It enters the viewport below the footer like normal page
          content, then pins DOCK_BOTTOM_GAP px above the viewport bottom: the
          page (footer included) scrolls past above it while the complete
          trigger visualization stays put for the entire resistance span —
          nothing of it scrolls out. Pin line via --dock-sticky-top (measured);
          the 100dvh fallback disables pinning until then. */}
      <div
        ref={stageWrapRef}
        data-dock-stage
        className="sticky"
        style={{
          top: 'var(--dock-sticky-top, 100dvh)',
          maxWidth: '1600px',
          marginLeft: 'auto',
          marginRight: 'auto',
          backgroundImage: 'radial-gradient(ellipse 50% 50% at 50% 0%, rgba(232,69,65, calc(0.25 * var(--dock-glow-opacity, 0))) 0%, transparent 60%)',
        }}
      >
        <PageContainer
          size="wide"
          spacing="none"
          gap="none"
          className="!mt-0 !pt-0"
          style={{
            maxWidth: '1600px',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          <Link
            to={SEARCH_TARGET}
            className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:top-4 focus:left-4 focus:px-4 focus:py-2 focus:rounded-lg"
            style={{ background: 'var(--theme-surface)', color: 'var(--theme-text)' }}
          >
            Search & Explore
          </Link>

          <PageHeader
            icon={
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 9H2V7h5zm0 3H2v2h5zm13.59 7-3.83-3.83c-.8.52-1.74.83-2.76.83-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5c0 1.02-.31 1.96-.83 2.75L22 17.59zM17 11c0-1.65-1.35-3-3-3s-3 1.35-3 3 1.35 3 3 3 3-1.35 3-3M2 19h10v-2H2z" /></svg>
            }
            title="Search & Explore"
            subtitle="One query, two lenses — marketplace and cooperations"
            onBack={() => navigate('/')}
            hidden
          />
        </PageContainer>

        <div className="px-4">
          <DockSnapStage cardRef={snapCardRef} isMobile={isMobile} />
        </div>
      </div>

      {/* Invisible resistance spacer — pure scroll room so the commit point
          sits BEYOND the trigger's arrival and the wheel damping can engage.
          Progress through this spacer IS the rubber-band tension. Touch uses a
          shorter spacer (MOBILE_SPACER_VH) so the commit needs less absolute
          scrolling (FU-342). */}
      <div ref={spacerRef} aria-hidden="true" style={{ height: `${spacerVh}vh` }} />
    </section>
  )
}
