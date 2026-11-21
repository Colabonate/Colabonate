import { describe, it, expect, vi, beforeEach } from 'vitest'

const apiCallMock = vi.fn()
vi.mock('../lib/api', () => ({ apiCall: (...args: unknown[]) => apiCallMock(...args) }))

import {
  fetchOfferSearch,
  fetchSearchFacets,
  searchFacetsQueryKey,
  withoutCountry,
} from './useOfferSearch'

// ADR-418 D3: the facet cache key must not change when only the country
// changes, otherwise choosing a country refetches and re-keys the option list.
describe('searchFacetsQueryKey (ADR-418 D3)', () => {
  it('is identical for two countries with the same other filters', () => {
    const a = searchFacetsQueryKey({ q: 'bike', offerType: 'PRODUCT', country: 'DE' })
    const b = searchFacetsQueryKey({ q: 'bike', offerType: 'PRODUCT', country: 'US' })
    const none = searchFacetsQueryKey({ q: 'bike', offerType: 'PRODUCT' })
    expect(a).toEqual(b)
    expect(a).toEqual(none)
  })

  it('changes when a non-country filter changes', () => {
    const a = searchFacetsQueryKey({ q: 'bike', country: 'DE' })
    const b = searchFacetsQueryKey({ q: 'chair', country: 'DE' })
    expect(a).not.toEqual(b)
  })

  it('keeps the search-facets namespace', () => {
    expect(searchFacetsQueryKey({ country: 'DE' })[0]).toBe('search-facets')
  })
})

describe('withoutCountry (ADR-418 D1)', () => {
  it('removes country without mutating the input', () => {
    const input = { q: 'x', country: 'DE' }
    const out = withoutCountry(input)
    expect(out).toEqual({ q: 'x' })
    expect('country' in out).toBe(false)
    expect(input.country).toBe('DE')
  })
})

describe('fetchSearchFacets / fetchOfferSearch URLs', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    apiCallMock.mockResolvedValue({ ok: true, json: async () => ({ country: {}, countryless: 0, total: 0 }) })
  })

  it('facets request omits country but keeps every other filter', async () => {
    await fetchSearchFacets({
      q: 'bike',
      offerType: 'PRODUCT',
      country: 'DE',
      capability: ['a', 'b'],
      minReputation: 3,
    })
    const url = apiCallMock.mock.calls[0][0] as string
    expect(url.startsWith('/api/search/facets?')).toBe(true)
    const qs = new URLSearchParams(url.split('?')[1])
    expect(qs.has('country')).toBe(false)
    expect(qs.get('q')).toBe('bike')
    expect(qs.get('offerType')).toBe('PRODUCT')
    expect(qs.getAll('capability')).toEqual(['a', 'b'])
    expect(qs.get('minReputation')).toBe('3')
    expect(qs.has('first')).toBe(false)
  })

  it('facets returns the parsed body', async () => {
    const body = { country: { US: 2 }, countryless: 1, total: 3 }
    apiCallMock.mockResolvedValueOnce({ ok: true, json: async () => body })
    await expect(fetchSearchFacets({})).resolves.toEqual(body)
  })

  it('list fetcher still sends country and paging params (unchanged behavior)', async () => {
    apiCallMock.mockResolvedValueOnce({ ok: true, json: async () => ({ hits: [], estimatedTotalHits: 0, processingTimeMs: 0 }) })
    await fetchOfferSearch({ country: 'DE', q: 'x' }, 100, 'cursor-1')
    const url = apiCallMock.mock.calls[0][0] as string
    const qs = new URLSearchParams(url.split('?')[1])
    expect(url.startsWith('/api/search?')).toBe(true)
    expect(qs.get('country')).toBe('DE')
    expect(qs.get('q')).toBe('x')
    expect(qs.get('first')).toBe('100')
    expect(qs.get('after')).toBe('cursor-1')
  })
})
