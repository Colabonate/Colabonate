import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { gsap } from 'gsap'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useReducedMotion } from '../hooks/useReducedMotion'

const STORAGE_PREFIX = 'colabonate:swipe-hint:'
const MOBILE_MEDIA = '(max-width: 600px)'
const AUTO_DISMISS_MS = 3200

interface SwipeHintProps {
  /**
   * Namespace so different detail pages (offers, coop) track their own
   * first-time state within the same session. Use a stable page id, e.g.
   * 'offer-detail' or 'coop-detail'.
   */
  storageKey: string
  /**
   * Wrapped element that should "demo" the swipe gesture when the hint shows.
   * The element briefly nudges horizontally and returns — like the user
   * touched and released, without actually navigating.
   */
  demoRef: React.RefObject<HTMLElement | null>
  /**
   * Whether there are actually siblings to swipe between. When false the
   * hint stays hidden (nothing to browse to).
   */
  hasSiblings: boolean
  /**
   * Fired when the user actually swipes and navigation happens. Lets the
   * hint dismiss immediately on the first real swipe.
   */
  onSwipeNavigate?: () => void
  /**
   * Localized label. Default: "Swipe to browse"
   */
  label?: string
}

export function SwipeHint({
  storageKey,
  demoRef,
  hasSiblings,
  onSwipeNavigate,
  label = 'Swipe to browse',
}: SwipeHintProps) {
  const prefersReduced = useReducedMotion()
  const [visible, setVisible] = useState(false)
  const hintRef = useRef<HTMLDivElement>(null)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const consumedRef = useRef(false)

  // Decide whether to show on mount (and on prop changes). One-time per
  // session: sessionStorage is wiped when the tab closes, so the user sees
  // the hint again in a new session — matching the original requirement.
  useEffect(() => {
    if (consumedRef.current) return
    if (!hasSiblings) return
    try {
      if (sessionStorage.getItem(STORAGE_PREFIX + storageKey) === '1') return
    } catch {
      // sessionStorage unavailable — fail open: show the hint anyway
    }
    if (typeof window === 'undefined') return
    if (!window.matchMedia(MOBILE_MEDIA).matches) return

    consumedRef.current = true
    try {
      sessionStorage.setItem(STORAGE_PREFIX + storageKey, '1')
    } catch { /* ignore */ }
    setVisible(true)
  }, [hasSiblings, storageKey])

  // Run the entry + demo animation; auto-dismiss after AUTO_DISMISS_MS.
  useEffect(() => {
    if (!visible) return
    if (typeof document === 'undefined') return

    const hint = hintRef.current
    const demo = demoRef.current
    const reduced = prefersReduced ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduced) {
      if (hint) gsap.set(hint, { opacity: 1, y: 0 })
    } else {
      if (hint) {
        gsap.fromTo(
          hint,
          { opacity: 0, y: 12 },
          { opacity: 1, y: 0, duration: 0.32, ease: 'power2.out' },
        )
      }
      // Demo the swipe gesture: gentle horizontal nudge on the content that
      // returns to centre. Mirrors the real `useDetailSwipeNav` slide-out
      // direction so the user sees exactly what to expect.
      if (demo) {
        gsap.fromTo(
          demo,
          { x: 0 },
          {
            keyframes: [
              { x: -28, opacity: 0.96, duration: 0.32, ease: 'power2.out' },
              { x: 0, opacity: 1, duration: 0.42, ease: 'power3.out' },
            ],
            delay: 0.18,
          },
        )
      }
    }

    dismissTimerRef.current = setTimeout(() => setVisible(false), AUTO_DISMISS_MS)
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    }
  }, [visible, prefersReduced, demoRef])

  // Dismiss on first successful swipe-navigation (parent calls onSwipeNavigate
  // from useDetailSwipeNav when navigation actually fires).
  useEffect(() => {
    if (!onSwipeNavigate) return
    let cancelled = false
    const handler = () => {
      if (cancelled) return
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
      setVisible(false)
    }
    // Wrap the callback in a stable handler via a tiny event so the parent
    // can fire-and-forget without prop churn.
    window.addEventListener('colabonate:swipe-hint-dismiss', handler)
    return () => {
      cancelled = true
      window.removeEventListener('colabonate:swipe-hint-dismiss', handler)
    }
  }, [onSwipeNavigate])

  // Hide completely after exit animation so it never blocks the page.
  useEffect(() => {
    if (visible) return
    const hint = hintRef.current
    if (!hint) return
    gsap.killTweensOf(hint)
    gsap.to(hint, {
      opacity: 0,
      y: 6,
      duration: 0.22,
      ease: 'power2.in',
      onComplete: () => {
        // No-op: the component unmounts via conditional render below.
      },
    })
  }, [visible])

  if (!visible) return null
  if (typeof document === 'undefined') return null

  const dismiss = () => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    setVisible(false)
  }

  return createPortal(
    <div
      ref={hintRef}
      role="status"
      aria-live="polite"
      onClick={dismiss}
      onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') dismiss() }}
      tabIndex={-1}
      className="md:hidden"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
        transform: 'translateX(-50%)',
        zIndex: 1300,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        borderRadius: 'var(--radius-full, 9999px)',
        background: 'var(--theme-bg-elevated)',
        color: 'var(--theme-text)',
        border: '1px solid var(--theme-border)',
        boxShadow: 'var(--theme-shadow)',
        fontSize: 13,
        fontWeight: 600,
        lineHeight: 1.2,
        cursor: 'pointer',
        userSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
        whiteSpace: 'nowrap',
        maxWidth: 'calc(100vw - 32px)',
      }}
    >
      <span
        className="swipe-hint-icon"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--theme-text-muted)' }}
      >
        <ChevronLeft size={14} strokeWidth={2.5} />
        <ChevronRight size={14} strokeWidth={2.5} />
      </span>
      <span>{label}</span>
      <style>{`
        @keyframes swipe-hint-pulse {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(3px); }
        }
        .swipe-hint-icon { animation: swipe-hint-pulse 1.1s ease-in-out 0.4s 2; }
      `}</style>
    </div>,
    document.body,
  )
}

/**
 * Helper the detail pages call from inside `useDetailSwipeNav`'s navigate
 * path so the hint can dismiss immediately on the first real swipe.
 */
export function notifySwipeHintDismissed(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('colabonate:swipe-hint-dismiss'))
}
