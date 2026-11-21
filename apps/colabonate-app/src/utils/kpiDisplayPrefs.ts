// ADR-407 — Global KPI strip display preferences.
//
// The size and initial collapse state are read by the app-level KPIStrip
// wrapper (`components/kpi/KpiStrip.tsx`) and written from Settings →
// Appearance. Values live in the existing localStorage pref store (`usePref`).

export type KpiStripSize = 'small' | 'large'

export const KPI_STRIP_SIZE_KEY = 'kpiStripSize'
export const KPI_STRIP_COLLAPSED_KEY = 'kpiStripCollapsed'

/**
 * `@ds/ui` KPIStrip persists its per-heading collapse state directly under the
 * raw `storageKey` (e.g. `kpi-home-strip`) — *not* through the pref namespace.
 * Clearing every `kpi-*` key makes a changed global collapse default take
 * effect everywhere instead of being shadowed by a stored explicit toggle
 * (ADR-407 D5 / OD-2). Only call this on an explicit user change of the
 * "Collapsed on load" setting — never on page load.
 */
export function clearKpiCollapseStorage(): void {
  try {
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('kpi-')) doomed.push(key)
    }
    for (const key of doomed) localStorage.removeItem(key)
  } catch {
    /* localStorage unavailable */
  }
}
