// @vitest-environment jsdom
import '../../test/setup-component-tests'
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, act } from '@testing-library/react'
import type { KPIItem } from '@ds/ui'

// Node 22 ships an experimental global `localStorage` that is `undefined`
// without `--localstorage-file`, shadowing jsdom's. Stub a Map-backed Storage
// so the real `userPreferences` module (bare `localStorage`) works under test.
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

beforeAll(() => { vi.stubGlobal('localStorage', createStorage()) })

// ADR-407: the wrapper is the single place that turns the global display prefs
// into `@ds/ui` KPIStrip props. Mock the design-system component and assert the
// props it receives — that is the whole contract of the wrapper.
const hoisted = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }))

vi.mock('@ds/ui', () => ({
  KPIStrip: (props: Record<string, unknown>) => {
    hoisted.calls.push(props)
    return null
  },
}))

import { KPIStrip } from './KpiStrip'
import { setPref } from '../../utils/userPreferences'
import {
  KPI_STRIP_SIZE_KEY,
  KPI_STRIP_COLLAPSED_KEY,
  clearKpiCollapseStorage,
} from '../../utils/kpiDisplayPrefs'

const HEADED: KPIItem[] = [{ value: 1, label: 'Open', heading: 'Group' }]
const PLAIN: KPIItem[] = [{ value: 1, label: 'Open' }]

const last = () => hoisted.calls[hoisted.calls.length - 1]

beforeEach(() => {
  hoisted.calls.length = 0
  localStorage.clear()
})

describe('KPIStrip global wrapper (ADR-407)', () => {
  it('defaults to small + collapsed for strips with headings', () => {
    render(<KPIStrip items={HEADED} />)
    expect(last().compact).toBe(true)
    expect(last().collapsible).toBe(true)
    expect(last().defaultCollapsed).toBe(true)
  })

  it('size=large disables compact', () => {
    setPref(KPI_STRIP_SIZE_KEY, 'large')
    render(<KPIStrip items={HEADED} />)
    expect(last().compact).toBe(false)
  })

  it('collapsed=false makes sections start expanded', () => {
    setPref(KPI_STRIP_COLLAPSED_KEY, false)
    render(<KPIStrip items={HEADED} />)
    expect(last().defaultCollapsed).toBe(false)
  })

  it('embedded always forces compact, even with size=large', () => {
    setPref(KPI_STRIP_SIZE_KEY, 'large')
    render(<KPIStrip items={PLAIN} embedded />)
    expect(last().compact).toBe(true)
  })

  it('heading-less strips are never collapsible', () => {
    render(<KPIStrip items={PLAIN} />)
    expect(last().collapsible).toBe(false)
    expect(last().defaultCollapsed).toBeUndefined()
  })

  it('re-applies the default when the collapse pref changes live', () => {
    render(<KPIStrip items={HEADED} />)
    expect(last().defaultCollapsed).toBe(true)
    act(() => { setPref(KPI_STRIP_COLLAPSED_KEY, false) })
    expect(last().defaultCollapsed).toBe(false)
  })
})

describe('clearKpiCollapseStorage (ADR-407 D5)', () => {
  it('removes only kpi-* keys and leaves everything else', () => {
    localStorage.setItem('kpi-home-strip', '{"map":{},"inherit":true}')
    localStorage.setItem('kpi-search-strip', '{}')
    localStorage.setItem('unrelated-key', 'keep')
    clearKpiCollapseStorage()
    expect(localStorage.getItem('kpi-home-strip')).toBeNull()
    expect(localStorage.getItem('kpi-search-strip')).toBeNull()
    expect(localStorage.getItem('unrelated-key')).toBe('keep')
  })
})
