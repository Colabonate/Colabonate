import { describe, it, expect } from 'vitest'
import { foreignPriceText } from './offer-price-text'

describe('foreignPriceText', () => {
  it('formats a foreign currency price as "amount CURRENCY"', () => {
    expect(foreignPriceText({ source: 'REMOTE', priceSats: 0, priceAmount: '2', priceCurrency: 'EUR' })).toBe('2 EUR')
  })

  it('uppercases the currency code', () => {
    expect(foreignPriceText({ source: 'REMOTE', priceSats: 0, priceAmount: '10', priceCurrency: 'usdc' })).toBe('10 USDC')
  })

  it('falls back to "?" when the amount is missing', () => {
    expect(foreignPriceText({ source: 'REMOTE', priceSats: 0, priceAmount: null, priceCurrency: 'EUR' })).toBe('? EUR')
  })

  it('shows "Price on request" for a REMOTE zero-price offer without currency', () => {
    expect(foreignPriceText({ source: 'REMOTE', priceSats: 0, priceAmount: null, priceCurrency: null })).toBe('Price on request')
  })

  it('returns null for a LOCAL zero-price offer without currency', () => {
    expect(foreignPriceText({ source: 'LOCAL', priceSats: 0, priceAmount: null, priceCurrency: null })).toBeNull()
  })

  it('returns null for a REMOTE offer with a real sats price', () => {
    expect(foreignPriceText({ source: 'REMOTE', priceSats: 1500, priceAmount: null, priceCurrency: null })).toBeNull()
  })

  it('returns null for a LOCAL offer with a sats price', () => {
    expect(foreignPriceText({ source: 'LOCAL', priceSats: 1500, priceAmount: null, priceCurrency: null })).toBeNull()
  })
})
