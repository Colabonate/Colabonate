// FilterFAB + FilterDrawerShell – shared scroll-revealed filter-drawer machinery.
// The FAB appears in the right-aligned vertical FAB stack (Home's Add/AI/Cart tier
// system; default tier 2, directly above the CartFAB/DaoFAB tier-1 slot) and opens a
// left slide-in drawer over a blurred backdrop, so the app stays subtly visible
// behind it. Consumers provide the drawer body: ListBrowser's FilterDrawer renders
// tabs/sort/categories, DaoDiscovery renders sort + DaoSidebar.

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { gsap } from 'gsap'
import { SlidersHorizontal, X } from 'lucide-react'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useReducedMotion } from '../../hooks/useReducedMotion'

const FAB_SHADOW = '0 4px 16px rgba(99,179,237,0.35), 0 2px 6px rgba(0,0,0,0.15)'

// ── FilterFAB ─────────────────────────────────────────────────────────────────

export interface FilterFABProps {
  visible: boolean
  /** Number of active filters shown as a badge (0 hides the badge). */
  activeCount: number
  onClick: () => void
  /** Mobile `bottom` offset (CSS value). Defaults to the tier-2 slot above the bottom FAB row. */
  bottomOffset?: string
  /** Desktop `top` offset in px. Defaults to the tier-2 slot below the top FAB row. */
  topOffset?: number
}

export function FilterFAB({ visible, activeCount, onClick, bottomOffset, topOffset }: FilterFABProps) {
  const { isMobile } = useBreakpoint()
  const wrapRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const tween = gsap.to(el, {
      autoAlpha: visible ? 1 : 0,
      scale: visible ? 1 : 0.6,
      duration: prefersReducedMotion ? 0 : 0.25,
      ease: 'power2.out',
    })
    return () => { tween.kill() }
  }, [visible, prefersReducedMotion])

  return (
    <div
      ref={wrapRef}
      className="fixed z-50"
      style={{
        // Home-style vertical FAB stack, right-aligned: tier 2 (AI-FAB slot),
        // directly above the CartFAB/DaoFAB tier-1 default.
        ...(isMobile
          ? { bottom: bottomOffset ?? 'calc(58px + env(safe-area-inset-bottom, 0px) + 72px)', top: 'auto' }
          : { top: topOffset ?? 190, bottom: 'auto' }),
        right: isMobile ? 12 : 40,
        opacity: 0,
        visibility: 'hidden',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <button
        onClick={onClick}
        aria-label="Open filters"
        className="relative shrink-0 flex items-center justify-center rounded-full cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95"
        style={{
          width: isMobile ? 48 : 56,
          height: isMobile ? 48 : 56,
          background: 'var(--color-primary-50)',
          boxShadow: FAB_SHADOW,
        }}
      >
        <SlidersHorizontal size={isMobile ? 18 : 22} color="white" />
        {activeCount > 0 && (
          <span
            className="absolute flex items-center justify-center rounded-full text-[10px] font-bold shrink-0"
            style={{
              top: -4,
              right: -4,
              minWidth: 20,
              height: 20,
              padding: '0 4px',
              background: '#E84541',
              color: 'white',
              boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
            }}
          >
            {activeCount}
          </span>
        )}
      </button>
    </div>
  )
}

// ── SectionLabel ──────────────────────────────────────────────────────────────

export function FilterDrawerSectionLabel({ children }: { children: ReactNode }) {
  return (
    <span
      className="text-[9px] font-bold uppercase tracking-widest"
      style={{ color: 'var(--theme-text-muted)', fontFamily: 'var(--typography-fontfamily-sans)' }}
    >
      {children}
    </span>
  )
}

// ── FilterDrawerShell ─────────────────────────────────────────────────────────

export interface FilterDrawerShellProps {
  open: boolean
  onClose: () => void
  /** Live result count shown in the header subtitle and the footer button. */
  resultCount: number
  /** Drawer body, rendered inside the scrollable section area. */
  children: ReactNode
}

export function FilterDrawerShell({ open, onClose, resultCount, children }: FilterDrawerShellProps) {
  // Keep the drawer mounted while the close animation plays out.
  const [rendered, setRendered] = useState(open)
  const backdropRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => {
    if (open) setRendered(true)
  }, [open])

  useEffect(() => {
    if (!rendered) return
    const backdrop = backdropRef.current
    const panel = panelRef.current
    if (!backdrop || !panel) return
    const duration = prefersReducedMotion ? 0 : 0.3
    const tweens = open
      ? [
          gsap.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration }),
          gsap.fromTo(panel, { x: '-100%' }, { x: '0%', duration, ease: 'power3.out' }),
        ]
      : [
          gsap.to(backdrop, { opacity: 0, duration }),
          gsap.to(panel, { x: '-100%', duration, ease: 'power3.in', onComplete: () => setRendered(false) }),
        ]
    return () => { tweens.forEach(t => t.kill()) }
  }, [open, rendered, prefersReducedMotion])

  // Escape closes; body scroll is locked while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!rendered) return null

  return (
    <div className="fixed inset-0" style={{ zIndex: 1300 }} role="dialog" aria-modal="true" aria-label="Filters">
      <div
        ref={backdropRef}
        className="absolute inset-0"
        style={{
          background: 'rgba(0,0,0,0.30)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
        }}
        onClick={onClose}
      />

      <div
        ref={panelRef}
        className="absolute top-0 left-0 flex flex-col h-full"
        style={{
          width: 'min(320px, 86vw)',
          background: 'var(--theme-surface)',
          borderRight: '1px solid var(--theme-border)',
          borderTopRightRadius: 16,
          borderBottomRightRadius: 16,
          boxShadow: '8px 0 32px rgba(0,0,0,0.18)',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          transform: 'translateX(-100%)',
        }}
      >
        {/* ── Header ── */}
        <div className="shrink-0 flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: '1px solid var(--theme-border)' }}>
          <div
            className="flex items-center justify-center rounded-lg shrink-0"
            style={{ width: 32, height: 32, background: 'rgba(99,179,237,0.12)' }}
          >
            <SlidersHorizontal size={15} style={{ color: 'var(--color-primary-50)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold" style={{ color: 'var(--theme-text)' }}>Filters</div>
            <div className="text-[10px]" style={{ color: 'var(--theme-text-muted)' }}>
              {resultCount} result{resultCount !== 1 ? 's' : ''}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close filters"
            className="flex items-center justify-center rounded-lg cursor-pointer shrink-0 transition-all duration-150 hover:opacity-70"
            style={{
              width: 32, height: 32,
              background: 'var(--theme-bg-subtle)',
              border: '1px solid var(--theme-border)',
              color: 'var(--theme-text-muted)',
            }}
          >
            <X size={15} />
          </button>
        </div>

        {/* ── Scrollable filter sections ── */}
        {/* data-lenis-prevent: Lenis (app-wide smoothWheel) hijacks every wheel
            event and scrolls only the window. Without this flag the drawer body
            can never be mouse-wheel-scrolled, so the categories below the fold
            are unreachable (same fix as the ListBrowser sidebar). */}
        <div
          data-lenis-prevent=""
          className="flex-1 flex flex-col gap-4 px-4 py-3 overflow-y-auto"
          style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--theme-border) transparent' }}
        >
          {children}
        </div>

        {/* ── Footer ── */}
        <div
          className="shrink-0 px-4 pt-3"
          style={{
            borderTop: '1px solid var(--theme-border)',
            paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
          }}
        >
          <button
            onClick={onClose}
            className="w-full flex items-center justify-center text-[13px] font-semibold rounded-xl cursor-pointer transition-all duration-150 hover:opacity-90 active:scale-[0.99]"
            style={{ height: 40, background: 'var(--color-primary-50)', color: 'white', border: 'none' }}
          >
            Show {resultCount} result{resultCount !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
