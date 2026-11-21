// Lightweight user preferences backed by localStorage.
// Components can read/write via getPref/setPref or use the reactive usePref() hook.
// Changes dispatch a CustomEvent so other components update automatically.

const PREFIX = 'colabonate:pref:'

// ── Low-level helpers ──────────────────────────────────────────────────────────

export function getPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw !== null ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function setPref<T>(key: string, value: T): void {
  localStorage.setItem(PREFIX + key, JSON.stringify(value))
  window.dispatchEvent(new CustomEvent('pref-change', { detail: { key, value } }))
}

// ── Reactive hook ──────────────────────────────────────────────────────────────

export function usePref<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => getPref(key, fallback))

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail.key === key) setValue(detail.value)
    }
    window.addEventListener('pref-change', handler)
    return () => window.removeEventListener('pref-change', handler)
  }, [key])

  const set = useCallback(
    (v: T) => {
      setPref(key, v)
      setValue(v)
    },
    [key],
  )

  return [value, set]
}

// ── One-time default country (from browser locale) ─────────────────────────
// Derives the account's default country best-effort from the browser locale
// region subtag (e.g. "de-DE" → DE), validated against the supported country
// list, so the "Nearby / Region / Worldwide" proximity filters (Home
// Marketplace slider, BuyDashboard) have something to match out-of-the-box.
// City is intentionally NOT defaulted — the user enters it manually.
// Guarded by a flag so an explicit empty/cleared choice sticks. Call once from
// a component that mounts on every route (not a specific settings page) —
// e.g. the router's root layout.
export function useDefaultLocationPreference(): void {
  useEffect(() => {
    try {
      if (localStorage.getItem(PREFIX + 'locationAutoSet')) return
      if (!getPref('userCountry', '')) {
        const derived = getBrowserCountry()
        if (derived) setPref('userCountry', derived)
      }
      localStorage.setItem(PREFIX + 'locationAutoSet', '1')
    } catch { /* localStorage unavailable */ }
  }, [])
}

// ── Imports (kept local to avoid bundling React if unused) ─────────────────────

import { useState, useEffect, useCallback } from 'react'
import { getBrowserCountry } from '../components/offers/offerFormConstants'
