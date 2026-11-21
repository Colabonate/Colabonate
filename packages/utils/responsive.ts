/**
 * Responsive Utilities – Colabonate Design System
 * 
 * Single Source of Truth für Breakpoints:
 * - xs:  0px   (very small mobile)
 * - sm:  360px (mobile)
 * - md:  600px (tablet)
 * - lg:  900px (desktop - entspricht MainMenu Breakpoint)
 * - xl:  1200px (large desktop)
 * 
 * @usage
 * import { breakpoints, cn, useBreakpoint } from '@ds/utils'
 * 
 * // Tailwind classes
 * <div className={cn('px-4 md:px-6 lg:px-8')}>
 * 
 * // Hook for logic
 * const bp = useBreakpoint() // 'xs' | 'sm' | 'md' | 'lg' | 'xl'
 */

import { useSyncExternalStore } from 'react';

// ─── Breakpoint Constants ──────────────────────────────────────────────────────

/** Breakpoint values in pixels – must match Tailwind config and MainMenu */
export const BREAKPOINTS = {
  xs: 0,
  sm: 360,
  md: 600,
  lg: 900,
  xl: 1200,
} as const

export type Breakpoint = keyof typeof BREAKPOINTS

/** Media query strings for useSyncExternalStore */
const MEDIA_QUERIES: Record<Breakpoint, string> = {
  xs: '(max-width: 359px)',
  sm: '(min-width: 360px) and (max-width: 599px)',
  md: '(min-width: 600px) and (max-width: 899px)',
  lg: '(min-width: 900px) and (max-width: 1199px)',
  xl: '(min-width: 1200px)',
}

/** Mobile query: anything below desktop (below lg) */
const MOBILE_QUERY = '(max-width: 899px)'

/** Desktop query: lg and above */
const DESKTOP_QUERY = '(min-width: 900px)'

// ─── Breakpoint Hook ───────────────────────────────────────────────────────────

/**
 * Returns the current breakpoint as a string.
 * SSR-safe with useSyncExternalStore.
 * 
 * @example
 * const bp = useBreakpoint()
 * if (bp === 'xs') return <MobileOnly />
 * if (bp === 'lg') return <DesktopLayout />
 */
export function useBreakpoint(): Breakpoint {
  const mq = typeof window !== 'undefined' 
    ? window.matchMedia 
    : null

  // Helper to get current breakpoint
  const getBreakpoint = (): Breakpoint => {
    if (typeof window === 'undefined') return 'sm' // SSR default
    if (window.matchMedia(MEDIA_QUERIES.xl).matches) return 'xl'
    if (window.matchMedia(MEDIA_QUERIES.lg).matches) return 'lg'
    if (window.matchMedia(MEDIA_QUERIES.md).matches) return 'md'
    if (window.matchMedia(MEDIA_QUERIES.sm).matches) return 'sm'
    return 'xs'
  }

  const subscribe = (callback: () => void) => {
    if (!mq) return () => {}
    const queries = Object.values(MEDIA_QUERIES)
    const listeners = queries.map(q => {
      const listener = mq(q)
      listener.addEventListener('change', callback)
      return () => listener.removeEventListener('change', callback)
    })
    return () => listeners.forEach(unsub => unsub())
  }

  const getSnapshot = getBreakpoint
  const getServerSnapshot = (): Breakpoint => 'sm'

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Returns true if current viewport is mobile (below lg breakpoint).
 * Synced with MainMenu: mobile = <900px.
 */
export function useIsMobile(): boolean {
  const subscribe = (callback: () => void) => {
    if (typeof window === 'undefined') return () => {}
    const mediaQuery = window.matchMedia(MOBILE_QUERY)
    mediaQuery.addEventListener('change', callback)
    return () => mediaQuery.removeEventListener('change', callback)
  }

  const getSnapshot = (): boolean => {
    if (typeof window === 'undefined') return true
    return window.matchMedia(MOBILE_QUERY).matches
  }

  const getServerSnapshot = (): boolean => true

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Returns true if current viewport is desktop (lg or above).
 * Synced with MainMenu: desktop = >=900px.
 */
export function useIsDesktop(): boolean {
  const subscribe = (callback: () => void) => {
    if (typeof window === 'undefined') return () => {}
    const mediaQuery = window.matchMedia(DESKTOP_QUERY)
    mediaQuery.addEventListener('change', callback)
    return () => mediaQuery.removeEventListener('change', callback)
  }

  const getSnapshot = (): boolean => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(DESKTOP_QUERY).matches
  }

  const getServerSnapshot = (): boolean => false

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

// ─── Layout Constants ───────────────────────────────────────────────────────────

/** MainMenu heights – must match MainMenu component */
export const LAYOUT = {
  /** Bottom Nav height on mobile */
  mobileNavHeight: 58,
  /** Top Bar height on desktop (normal) */
  desktopNavHeight: 68,
  /** Top Bar height on desktop (scrolled) */
  desktopNavHeightScrolled: 52,
} as const

/**
 * Returns the appropriate margin/padding for content below navigation.
 * Accounts for safe areas on mobile devices.
 */
export function useNavSafeArea(): { top: number; bottom: number } {
  const isMobile = useIsMobile()
  const isDesktop = useIsDesktop()
  
  // CSS custom properties for safe areas
  const getSafeAreas = () => {
    if (typeof document === 'undefined') {
      return { top: 0, bottom: 0 }
    }
    
    const style = getComputedStyle(document.documentElement)
    return {
      top: parseInt(style.getPropertyValue('--sat') || '0') || 0,
      bottom: parseInt(style.getPropertyValue('--sab') || '0') || 0,
    }
  }

  return {
    top: isMobile ? LAYOUT.mobileNavHeight : isDesktop ? LAYOUT.desktopNavHeight : LAYOUT.mobileNavHeight,
    bottom: getSafeAreas().bottom,
  }
}

// ─── Tailwind Class Helpers ─────────────────────────────────────────────────────

/**
 * Grid column classes for responsive grids.
 * 1 column on mobile → 2 on sm → 3 on lg → 4 on xl
 */
export const gridCols = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
} as const

/**
 * Gap classes for responsive spacing.
 */
export const gap = {
  sm: 'gap-2',
  md: 'gap-3 md:gap-4',
  lg: 'gap-4 md:gap-6 lg:gap-8',
} as const

/**
 * Padding classes for page containers.
 * Matches maxWidth logic from Account.tsx and Offers.tsx
 */
export const pagePadding = {
  /** Narrow pages like Account (max-w-3xl) */
  narrow: 'px-4 sm:px-6 lg:px-8 py-4 md:py-5',
  /** Standard pages like Offers (max-w-5xl) */
  standard: 'px-4 sm:px-6 lg:px-8 py-4 md:py-5',
  /** Wide pages like Home (max-w-6xl) */
  wide: 'px-4 md:px-6 pb-6',
} as const

/**
 * Max-width classes for page containers.
 */
export const pageMaxWidth = {
  narrow: 'max-w-[720px]',    // Account.tsx
  standard: 'max-w-[1100px]', // Offers.tsx, Tickets.tsx, Home.tsx
  wide: 'max-w-[1200px]',
  full: 'max-w-full',
} as const

// ─── Re-export cn for convenience ──────────────────────────────────────────────

export { cn } from './cn'
