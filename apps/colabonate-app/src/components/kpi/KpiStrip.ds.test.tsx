// @vitest-environment jsdom
import '../../test/setup-component-tests'
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, act } from '@testing-library/react'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import type { KPIItem } from '@ds/ui'
import { KPIStrip } from './KpiStrip'
import { setPref } from '../../utils/userPreferences'
import { KPI_STRIP_COLLAPSED_KEY } from '../../utils/kpiDisplayPrefs'

// Real `@ds/ui` KPIStrip (no mock): verifies that the wrapper's remount on a
// collapse-pref change actually flips the rendered collapse state (ADR-407 D5).
function createStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => { map.delete(k) },
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
  } as Storage
}

beforeAll(() => {
  vi.stubGlobal('localStorage', createStorage())
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() { return false },
    }),
  })
})

const theme = createTheme()
const HEADED: KPIItem[] = [{ value: 1, label: 'Open', heading: 'Group' }]
const wrap = (ui: React.ReactNode) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
const collapsedContainer = (c: HTMLElement) => c.querySelector('div[style*="opacity: 0"]')

beforeEach(() => { localStorage.clear() })

describe('KPIStrip wrapper × real KPIStrip (ADR-407)', () => {
  it('starts collapsed by default (opacity-0 container present)', () => {
    const { container } = wrap(<KPIStrip items={HEADED} wrap storageKey="kpi-t" />)
    expect(collapsedContainer(container)).toBeTruthy()
  })

  it('starts expanded when the pref is false', () => {
    setPref(KPI_STRIP_COLLAPSED_KEY, false)
    const { container } = wrap(<KPIStrip items={HEADED} wrap storageKey="kpi-t" />)
    expect(collapsedContainer(container)).toBeFalsy()
  })

  it('re-applies on a live pref change', () => {
    const { container } = wrap(<KPIStrip items={HEADED} wrap storageKey="kpi-t" />)
    expect(collapsedContainer(container)).toBeTruthy()
    act(() => setPref(KPI_STRIP_COLLAPSED_KEY, false))
    expect(collapsedContainer(container)).toBeFalsy()
  })
})
