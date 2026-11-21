// usePageListViewMode – one Grid/List preference shared across every subtab of
// a shell page (CoopManage, SellListings). The page owns a single storage key;
// each tab hydrates from it on mount and writes back on toggle, so choosing
// "List" on one subtab applies to all subtab contents (ADR-368 follow-up,
// user report 2026-09-05).
import { useCallback, useState } from 'react'
import type { ListBrowserViewMode } from '../components/list-browser'

export interface UsePageListViewModeOptions {
  /** Single page-wide storage key (e.g. 'coopManage_viewMode'). */
  storageKey: string
  /** Legacy per-tab key to migrate a previous preference once (optional). */
  legacyKey?: string
  /** Fallback when neither the page key nor the legacy key is set. */
  initial: ListBrowserViewMode
}

export function usePageListViewMode({ storageKey, legacyKey, initial }: UsePageListViewModeOptions) {
  const [viewMode, setMode] = useState<ListBrowserViewMode>(() => {
    const saved = localStorage.getItem(storageKey)
    if (saved === 'list' || saved === 'gallery') return saved
    const legacy = legacyKey ? localStorage.getItem(legacyKey) : null
    if (legacy === 'list' || legacy === 'gallery') return legacy
    return initial
  })

  const setViewMode = useCallback((next: ListBrowserViewMode) => {
    setMode(next)
    localStorage.setItem(storageKey, next)
  }, [storageKey])

  return [viewMode, setViewMode] as const
}
