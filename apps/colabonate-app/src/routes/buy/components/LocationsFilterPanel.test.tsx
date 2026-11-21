// @vitest-environment jsdom
import '../../../test/setup-component-tests'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { LocationsFilterPanel, buildLocationOptions } from './LocationsFilterPanel'
import { COUNTRIES } from '../../../components/offers/offerFormConstants'
import type { SearchFacets } from '../../../hooks/useOfferSearch'

const nameOf = (code: string) => COUNTRIES.find(c => c.code === code)?.name ?? code

// 25+ facet keys, like the production measurement in ADR-418.
const FACET_COUNTS: Record<string, number> = {
  US: 77, NL: 36, DE: 30, CH: 1, CA: 1, FR: 12, GB: 9, ES: 5, IT: 4, AT: 3,
  BE: 2, PL: 2, SE: 2, NO: 2, DK: 2, FI: 2, IE: 2, PT: 2, CZ: 2, HU: 1,
  RO: 1, GR: 1, BG: 1, HR: 1, SI: 1,
}
const facet: SearchFacets = { country: FACET_COUNTS, countryless: 4002, total: 4243 }

function renderPanel(props: Partial<Parameters<typeof LocationsFilterPanel>[0]> = {}) {
  const onCountryChange = vi.fn()
  const utils = render(
    <LocationsFilterPanel
      countryFilter=""
      onCountryChange={onCountryChange}
      allCountries={['US', 'DE']}
      facet={facet}
      {...props}
    />,
  )
  return { ...utils, onCountryChange }
}

// Option buttons only (excludes the "All countries" button).
function optionButtons() {
  return screen.getAllByRole('button').filter(b => b.textContent !== 'All countries' && !/All countries/.test(b.textContent ?? ''))
}

describe('LocationsFilterPanel (ADR-418 D4)', () => {
  it('renders every facet key, not only a few loaded ones', () => {
    renderPanel()
    expect(optionButtons()).toHaveLength(Object.keys(FACET_COUNTS).length)
    for (const code of Object.keys(FACET_COUNTS)) {
      expect(screen.getByRole('button', { name: new RegExp(nameOf(code)) })).toBeInTheDocument()
    }
  })

  it('sorts by count descending, then name', () => {
    renderPanel()
    const labels = optionButtons().map(b => b.textContent ?? '')
    expect(labels[0]).toContain(nameOf('US'))
    expect(labels[0]).toContain('77')
    expect(labels[1]).toContain(nameOf('NL'))
    expect(labels[2]).toContain(nameOf('DE'))
    // Ties (count 2) are ordered alphabetically by display name.
    const twos = Object.entries(FACET_COUNTS).filter(([, n]) => n === 2).map(([c]) => nameOf(c))
    const sorted = [...twos].sort((a, b) => a.localeCompare(b))
    const start = labels.findIndex(l => l.includes(sorted[0]))
    expect(labels.slice(start, start + twos.length).map(l => l.replace(/\d+$/, ''))).toEqual(sorted)
  })

  it('shows the count next to each name, formatted with toLocaleString', () => {
    renderPanel({ facet: { country: { US: 4002 }, countryless: 0, total: 4002 } })
    const btn = screen.getByRole('button', { name: new RegExp(nameOf('US')) })
    expect(within(btn).getByText((4002).toLocaleString())).toBeInTheDocument()
  })

  it('selecting a country keeps every option visible', () => {
    const { rerender, onCountryChange } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(nameOf('DE')) }))
    expect(onCountryChange).toHaveBeenCalledWith('DE')

    rerender(
      <LocationsFilterPanel countryFilter="DE" onCountryChange={onCountryChange} allCountries={['US', 'DE']} facet={facet} />,
    )
    expect(optionButtons()).toHaveLength(Object.keys(FACET_COUNTS).length)
    expect(screen.getByRole('button', { name: new RegExp(nameOf('US')) })).toBeInTheDocument()
  })

  it('clicking the selected country clears the selection', () => {
    const { onCountryChange } = renderPanel({ countryFilter: 'DE' })
    fireEvent.click(screen.getByRole('button', { name: new RegExp(nameOf('DE')) }))
    expect(onCountryChange).toHaveBeenCalledWith('')
  })

  it('keeps a stale selection visible with count 0', () => {
    renderPanel({ countryFilter: 'JP', facet: { country: { US: 1 }, countryless: 0, total: 1 } })
    const btn = screen.getByRole('button', { name: new RegExp(nameOf('JP')) })
    expect(within(btn).getByText('0')).toBeInTheDocument()
  })

  it('shows 3 skeleton rows while loading without a facet, and no fallback list', () => {
    const { container } = renderPanel({ facet: undefined, loading: true, allCountries: ['US', 'DE'] })
    const skeletons = container.querySelectorAll('[aria-hidden="true"].animate-pulse')
    expect(skeletons).toHaveLength(3)
    expect(screen.queryByRole('button', { name: new RegExp(nameOf('US')) })).toBeNull()
  })

  it('falls back to allCountries without a facet (error or not loaded)', () => {
    renderPanel({ facet: undefined, loading: false, allCountries: ['US', 'DE'] })
    expect(screen.getByRole('button', { name: new RegExp(nameOf('US')) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: new RegExp(nameOf('DE')) })).toBeInTheDocument()
    expect(optionButtons()).toHaveLength(2)
    expect(screen.queryByText(/No location/)).toBeNull()
  })

  it('shows the no-location hint only when countryless > 0', () => {
    const { unmount } = renderPanel()
    expect(screen.getByText(`No location (${(4002).toLocaleString()})`)).toBeInTheDocument()
    expect(screen.getByText(/Excluded when a country is selected/)).toBeInTheDocument()
    unmount()

    renderPanel({ facet: { country: FACET_COUNTS, countryless: 0, total: 100 } })
    expect(screen.queryByText(/No location/)).toBeNull()
  })

  it('the no-location hint is not a button', () => {
    renderPanel()
    const hint = screen.getByText(/No location/)
    expect(hint.closest('button')).toBeNull()
  })
})

describe('buildLocationOptions (ADR-418 D4 pure rules)', () => {
  it('uses the facet keys when present', () => {
    const opts = buildLocationOptions(facet, ['XX'], '')
    expect(opts.map(o => o.code)).toHaveLength(Object.keys(FACET_COUNTS).length)
    expect(opts.some(o => o.code === 'XX')).toBe(false)
  })

  it('appends a stale selection with count 0', () => {
    const opts = buildLocationOptions({ country: { US: 1 }, countryless: 0, total: 1 }, [], 'FR')
    expect(opts).toEqual([{ code: 'US', count: 1 }, { code: 'FR', count: 0 }])
  })

  it('falls back to allCountries without counts when facet is undefined', () => {
    expect(buildLocationOptions(undefined, ['US', 'DE'], '')).toEqual([{ code: 'US' }, { code: 'DE' }])
  })
})
