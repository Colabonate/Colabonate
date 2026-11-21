import { describe, it, expect } from 'vitest'
import { initialCountryFilter } from './initial-country-filter'

describe('initialCountryFilter (ADR-418 D6)', () => {
  it('defaults to All countries without a proximity link, even with a valid profile country', () => {
    expect(initialCountryFilter('DE', null)).toBe('')
    expect(initialCountryFilter('DE', '')).toBe('')
  })
  it('keeps world unscoped', () => {
    expect(initialCountryFilter('DE', 'world')).toBe('')
  })
  it('scopes to the profile country for Nearby and Region links', () => {
    expect(initialCountryFilter('DE', 'nearby')).toBe('DE')
    expect(initialCountryFilter('DE', 'region')).toBe('DE')
  })
  it('never scopes to a stale or free-text profile value', () => {
    expect(initialCountryFilter('Germany', 'region')).toBe('')
    expect(initialCountryFilter('', 'nearby')).toBe('')
  })
})
