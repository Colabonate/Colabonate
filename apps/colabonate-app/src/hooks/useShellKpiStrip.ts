// useShellKpiStrip – lifted-KPI state for shell pages that mount one tab at a
// time (SellListings / CoopManage, ADR-219/368). The shell owns the KPIStrip;
// each tab lifts its own KPI items via `onKpiChange`.
//
// Root cause it fixes (user report 2026-09-05): every tab switch unmounts the
// active tab and mounts the next one, whose first KPI effect reports
// `loading=true` with zero-count items. The shell used to forward that
// directly to <KPIStrip>, which dropped the previous tab's chips and rendered
// the skeleton (fixed chip count) instead — a visible layout flash/jump on
// every switch.
//
// Contract:
//  - While a (re)mounted tab reports `loading=true`, the last committed strip
//    stays visible (loading reports are ignored) — no skeleton mid-session.
//  - `loading` stays `true` only until the FIRST committed strip arrives, so
//    <KPIStrip> shows its skeleton exactly once per page mount.
import { useCallback, useState } from 'react'
import type { KPIItem } from '@ds/ui'

export function useShellKpiStrip() {
  const [items, setItems] = useState<KPIItem[]>([])
  const [loading, setLoading] = useState(true)

  const handleKpiChange = useCallback((next: KPIItem[], nextLoading: boolean) => {
    if (nextLoading) return
    setItems(next)
    setLoading(false)
  }, [])

  return { items, loading, handleKpiChange }
}
