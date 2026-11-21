/**
 * Immersive layout contract (ADR-406 D3).
 *
 * Layout.tsx owns the `immersive` state and provides this context; it also
 * publishes the live chrome sizes as `--app-nav-h` / `--app-footer-h` CSS
 * custom properties on the shell. A route that wants to fill the viewport
 * between the header and the footer (e.g. the full-bleed map) opts in via
 * `useImmersiveLayout()`; while enabled, Layout drops its default vertical
 * padding on <main> and the page owns its height.
 */

import { createContext, useContext, useEffect } from 'react'

export interface ImmersiveLayoutValue {
  /** True while an immersive route is mounted. */
  immersive: boolean
  setImmersive: (value: boolean) => void
}

export const ImmersiveLayoutContext = createContext<ImmersiveLayoutValue>({
  immersive: false,
  setImmersive: () => {},
})

/** Mark the current route as immersive (full-bleed) while it is mounted. */
export function useImmersiveLayout(enabled = true): boolean {
  const { immersive, setImmersive } = useContext(ImmersiveLayoutContext)
  useEffect(() => {
    setImmersive(enabled)
    return () => setImmersive(false)
  }, [enabled, setImmersive])
  return immersive
}
