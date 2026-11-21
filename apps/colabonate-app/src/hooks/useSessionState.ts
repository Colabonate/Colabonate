// Drop-in replacement for useState that persists the value to sessionStorage.
//
// Use for filter/list state that should survive in-app page navigation within
// a single browser tab (e.g. BuyDashboard / Search filters) without polluting
// the URL or persisting forever across sessions. sessionStorage is wiped when
// the tab closes, matching the existing daoDashboard_pageSize / coopManage_*
// patterns in this app.
//
// Mount priority (first non-undefined wins):
//   1. overrideOnMount() — URL deep-link / explicit navigation param
//   2. sessionStorage value — resume previous in-session selection
//   3. fallback — component default
//
// When an override wins on mount it is also written back to sessionStorage so a
// deep-link becomes the new "previous selection" for subsequent navigations.

import { useCallback, useState } from 'react'

const PREFIX = 'colabonate:session:'

/** Read a sessionStorage value, returning fallback on miss / parse error / unavailable storage. */
export function readSession<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(PREFIX + key)
    if (raw !== null) return JSON.parse(raw) as T
  } catch {
    // sessionStorage unavailable or invalid JSON — fail gracefully
  }
  return fallback
}

export function useSessionState<T>(
  key: string,
  fallback: T | (() => T),
  overrideOnMount?: () => T | undefined,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    const override = overrideOnMount?.()
    if (override !== undefined) {
      try {
        sessionStorage.setItem(PREFIX + key, JSON.stringify(override))
      } catch {
        // sessionStorage unavailable — keep override in-memory only
      }
      return override
    }
    const initial = typeof fallback === 'function' ? (fallback as () => T)() : fallback
    return readSession(key, initial)
  })

  const set = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState(prev => {
        const next = typeof value === 'function' ? (value as (p: T) => T)(prev) : value
        try {
          sessionStorage.setItem(PREFIX + key, JSON.stringify(next))
        } catch {
          // sessionStorage unavailable — keep in-memory state only
        }
        return next
      })
    },
    [key],
  )

  return [state, set]
}
