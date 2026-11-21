import { useEffect, useRef } from 'react'

/**
 * Fires the `colabonate:app-ready` window event once, the first time `ready`
 * becomes true. `main.tsx` (ADR-290) listens for this on the Home route to
 * hide the boot splash once Home has actually finished its first load,
 * instead of a fixed timer that can reveal it mid-load. Fires at most once
 * per page load — later `ready` flips (e.g. a background refetch) are
 * intentionally ignored, since the splash is already gone by then.
 */
export function useSignalAppReady(ready: boolean) {
  const firedRef = useRef(false)

  useEffect(() => {
    if (!ready || firedRef.current) return
    firedRef.current = true
    window.dispatchEvent(new Event('colabonate:app-ready'))
  }, [ready])
}
