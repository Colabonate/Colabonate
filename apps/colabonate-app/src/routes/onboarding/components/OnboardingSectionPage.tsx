import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@ds/utils'
import { AppLogo } from '../../../components/branding/AppLogo'
import { useReducedMotion } from '../../../hooks/useReducedMotion'

/**
 * OnboardingSectionPage — the shared layout shell for all three onboarding routes
 * (ADR-151). It renders the pinned page chrome and guarantees the
 * "≤3 sections per page, scrollable" pattern:
 *
 *   ┌───────────────────────────────┐
 *   │  Header (AppLogo)        ─ pinned (sticky top)
 *   │  topBar? (progress/dots) ─ pinned (sticky top)
 *   ├───────────────────────────────┤
 *   │  children (section stack) │ ← inner scroll (overflow-y-auto),
 *   │                           │   keyboard-focusable, focus resets on
 *   │  ▲ content fades into ──  │   page change. Top & bottom edges fade
 *   │  ▼ the background colour ─ │   into --theme-bg via a non-interactive
 *   ├───────────────────────────────┤   is clipped).
 *   │  footer?                 ─ pinned (sticky bottom)
 *   └───────────────────────────────┘
 *
 * The routes own their concrete chrome (progress indicator, footer controls) by
 * passing `topBar` / `footer` nodes; this component only owns the layout shell +
 * scroll/focus/fade behaviour. It is app-level (carries navigation/state
 * concerns) and therefore stays out of headless `packages/ui` per AGENTS.md.
 *
 * Use {@link OnboardingFooter} for the standard Back / Continue / Skip footer.
 */
interface OnboardingSectionPageProps {
  /** Optional pinned node under the logo (progress bar / step indicator / dots). */
  topBar?: ReactNode
  /** Scrollable section content. */
  children: ReactNode
  /** Pinned footer node. Omit to render no footer (e.g. final/done page). */
  footer?: ReactNode
  /**
   * Changes to this value reset the inner scroll to the top and move keyboard
   * focus onto the scroll container — i.e. pass the current page index/id so the
   * user lands at the top of each new page. For single-page routes, leave it
   * constant.
   */
  pageKey?: string | number
  /** Extra className on the scroll container. */
  className?: string
}

/** Height (px) of the top/bottom fade, measured from each edge of the scroll area. */
const FADE_PX = 28

/**
 * Build a `background-image` gradient (used on a non-interactive overlay
 * div) that fades the scroll content into the background at the clipped
 * edge(s). Kept on an overlay — *not* as a `mask-image` on the scroll
 * container — because CSS `mask-image` removes pointer/wheel hit testing
 * inside the transparent bands, which silently broke desktop mouse-wheel
 * scrolling while mobile touch swipes still worked. Returns `null` when
 * nothing is clipped (no overlay rendered on short pages).
 */
function fadeGradient(fadeTop: boolean, fadeBottom: boolean): string | null {
  if (!fadeTop && !fadeBottom) return null
  const top = fadeTop
    ? `linear-gradient(to bottom, var(--theme-bg), transparent ${FADE_PX}px)`
    : 'transparent'
  const bottom = fadeBottom
    ? `linear-gradient(to top, var(--theme-bg), transparent ${FADE_PX}px)`
    : 'transparent'
  return `${top}, ${bottom}`
}

export function OnboardingSectionPage({
  topBar,
  children,
  footer,
  pageKey,
  className,
}: OnboardingSectionPageProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const prefersReduced = useReducedMotion()
  // Which edges currently have content clipped behind the pinned chrome.
  const [fade, setFade] = useState<{ top: boolean; bottom: boolean }>({
    top: false,
    bottom: false,
  })

  /** Recompute which edges need a fade. Bails out when nothing changed. */
  const updateFade = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const top = el.scrollTop > 0
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1
    setFade((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }))
  }, [])

  // Reset scroll + focus on page change, then re-measure the fade.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: 0, behavior: prefersReduced ? 'auto' : 'smooth' })
    // Move focus to the scroll region so keyboard users land at the page top.
    el.focus({ preventScroll: true })
    updateFade()
  }, [pageKey, prefersReduced, updateFade])

  // Re-measure when the viewport or the content height changes (resize, page
  // swap, async image load). ResizeObserver covers all three without polling.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => updateFade())
    ro.observe(el)
    const content = el.firstElementChild
    if (content) ro.observe(content)
    return () => ro.disconnect()
  }, [updateFade])

  const fadeBg = fadeGradient(fade.top, fade.bottom)

  return (
    <div
      className="flex flex-col h-dvh"
      style={{ background: 'var(--theme-bg)' }}
    >
      {/* ── Header (pinned) ─────────────────────────────────────────── */}
      <div className="flex items-center justify-center px-6 py-5 shrink-0">
        <AppLogo brand="colabonate" height={32} />
      </div>

      {/* ── Optional progress / step indicator (pinned) ─────────────── */}
      {topBar && <div className="shrink-0">{topBar}</div>}

      {/* ── Scrollable section stack ────────────────────────────────── */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          tabIndex={0}
          // Tells Lenis to leave this self-contained scroll region alone —
          // wheel/touch pass through to native scroll instead of being hijacked
          // for document-level smooth scroll (which would swallow desktop wheel).
          data-lenis-prevent
          onScroll={updateFade}
          className={cn('absolute inset-0 overflow-y-auto outline-none', className)}
        >
          {children}
        </div>
        {fadeBg && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ backgroundImage: fadeBg }}
          />
        )}
      </div>

      {/* ── Footer (pinned) ─────────────────────────────────────────── */}
      {footer && <div className="shrink-0">{footer}</div>}
    </div>
  )
}
