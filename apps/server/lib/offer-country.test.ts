import { describe, it, expect } from 'vitest'
import { resolveOfferCountry } from './offer-country.js'

describe('resolveOfferCountry (ADR-420)', () => {
  it('normalizes names and lowercase codes to ISO alpha-2', () => {
    expect(resolveOfferCountry('Germany', undefined)).toEqual({ ok: true, country: 'DE' })
    expect(resolveOfferCountry('de', undefined)).toEqual({ ok: true, country: 'DE' })
    expect(resolveOfferCountry(' DE ', undefined)).toEqual({ ok: true, country: 'DE' })
  })
  it('derives the country from the location text when none is sent', () => {
    expect(resolveOfferCountry(undefined, 'Lübeck, 23560, Germany')).toEqual({ ok: true, country: 'DE' })
    expect(resolveOfferCountry(undefined, 'Lübeck, 23560, DE')).toEqual({ ok: true, country: 'DE' })
  })
  it('leaves the field alone when nothing is sent or derivable', () => {
    expect(resolveOfferCountry(undefined, undefined)).toEqual({ ok: true, country: undefined })
    expect(resolveOfferCountry(undefined, 'Somewhere nice')).toEqual({ ok: true, country: undefined })
  })
  it('an explicit country wins over the location text', () => {
    expect(resolveOfferCountry('FR', 'Berlin, Germany')).toEqual({ ok: true, country: 'FR' })
  })
  it('null and empty string clear the country', () => {
    expect(resolveOfferCountry(null, 'Berlin, Germany')).toEqual({ ok: true, country: null })
    expect(resolveOfferCountry('', 'Berlin, Germany')).toEqual({ ok: true, country: null })
    expect(resolveOfferCountry('   ', undefined)).toEqual({ ok: true, country: null })
  })
  it('rejects values that would never match a country filter', () => {
    const bad = resolveOfferCountry('Narnia', undefined)
    expect(bad.ok).toBe(false)
    expect(resolveOfferCountry(42, undefined).ok).toBe(false)
  })
})
