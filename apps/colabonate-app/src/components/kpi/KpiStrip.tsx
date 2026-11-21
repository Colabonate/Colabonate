import { KPIStrip as DSKPIStrip } from '@ds/ui'
import type { KPIStripProps } from '@ds/ui'
import { usePref } from '../../utils/userPreferences'
import { KPI_STRIP_SIZE_KEY, KPI_STRIP_COLLAPSED_KEY } from '../../utils/kpiDisplayPrefs'
import type { KpiStripSize } from '../../utils/kpiDisplayPrefs'

// ADR-407 — app-level KPI strip wrapper.
//
// The design-system `KPIStrip` stays headless/prop-driven; this wrapper turns
// the global display prefs (Settings → Appearance) into its `compact`,
// `collapsible` and `defaultCollapsed` props so size and initial collapse are
// governed globally across the whole app instead of per page.
//
// `compact` / `defaultCollapsed` / `defaultCollapsedHeadings` are intentionally
// omitted from the public props — the global settings override them.
export type KpiStripGlobalProps = Omit<
  KPIStripProps,
  'compact' | 'defaultCollapsed' | 'defaultCollapsedHeadings'
> & {
  /**
   * Force the smallest tier regardless of the global size pref. Used for strips
   * embedded in `PageHeader` actions (Buy → Categories / Category products)
   * that must not blow up the header (ADR-407 D3 / owner decision).
   */
  embedded?: boolean
}

export function KPIStrip({ embedded = false, items, collapsible, ...rest }: KpiStripGlobalProps) {
  const [size] = usePref<KpiStripSize>(KPI_STRIP_SIZE_KEY, 'small')
  const [initialCollapsed] = usePref<boolean>(KPI_STRIP_COLLAPSED_KEY, true)

  const hasHeadings = items.some(item => item.heading)
  const isCollapsible = collapsible ?? hasHeadings
  const compact = embedded || size === 'small'

  // Remount when the global collapse pref changes so the new initial state is
  // applied by `KPIStrip`'s useState initializer (ADR-407 D5). `storageKey`
  // persistence is cleared by Settings on the same toggle, so the default wins.
  return (
    <DSKPIStrip
      key={initialCollapsed ? 'kpi-collapsed' : 'kpi-expanded'}
      {...rest}
      items={items}
      compact={compact}
      collapsible={isCollapsible}
      defaultCollapsed={isCollapsible ? initialCollapsed : undefined}
    />
  )
}
