import { describe, it, expect } from 'vitest'
import { countryCodeFromText } from './offerFormConstants'

describe('countryCodeFromText (ADR-420)', () => {
  it('accepts codes in any case and English or German names', () => {
    expect(countryCodeFromText('DE')).toBe('DE')
    expect(countryCodeFromText('de')).toBe('DE')
    expect(countryCodeFromText('Germany')).toBe('DE')
    expect(countryCodeFromText(' germany ')).toBe('DE')
    expect(countryCodeFromText('Deutschland')).toBe('DE')
  })
  it('returns empty for unknown or empty values', () => {
    expect(countryCodeFromText('Narnia')).toBe('')
    expect(countryCodeFromText('')).toBe('')
    expect(countryCodeFromText(undefined)).toBe('')
  })
})
