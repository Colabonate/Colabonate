import { useState, useEffect } from 'react'

// ── Types ────────────────────────────────────────────────────────────

export type Breakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

// ── Project Breakpoints (from packages/ui/theme.ts) ─────────────────

const BREAKPOINTS: Record<Breakpoint, number> = {
  xs: 0,
  sm: 360,
  md: 600,
  lg: 900,
  xl: 1200,
}

function getBreakpoint(width: number): Breakpoint {
  if (width >= BREAKPOINTS.xl) return 'xl'
  if (width >= BREAKPOINTS.lg) return 'lg'
  if (width >= BREAKPOINTS.md) return 'md'
  if (width >= BREAKPOINTS.sm) return 'sm'
  return 'xs'
}

// ── Hook ────────────────────────────────────────────────────────────

export function useBreakpoint() {
  const [bp, setBp] = useState<Breakpoint>(() =>
    typeof window !== 'undefined' ? getBreakpoint(window.innerWidth) : 'md',
  )

  useEffect(() => {
    const mqls = Object.values(BREAKPOINTS).map(
      v => window.matchMedia(`(min-width: ${v}px)`),
    )
    const handler = () => setBp(getBreakpoint(window.innerWidth))
    mqls.forEach(mql => mql.addEventListener('change', handler))
    return () => mqls.forEach(mql => mql.removeEventListener('change', handler))
  }, [])

  return {
    breakpoint: bp,
    isMobile: bp === 'xs' || bp === 'sm',
    isDesktop: bp === 'lg' || bp === 'xl',
  }
}
