import { describe, it, expect } from 'vitest'
import { buildCompanyProductData } from './company-product'

const base = { companyId: 'co1', catalogId: null, standardCategoryId: 'cat1', name: 'Apple Juice' }

describe('buildCompanyProductData (ADR-395)', () => {
  it('creates a catalog-less company product', () => {
    const data = buildCompanyProductData({ ...base, priceSats: 1200, stock: 5 })
    expect(data.companyId).toBe('co1')
    expect(data.catalogId).toBeNull()
    expect(data.priceSats).toBe(1200)
    expect(data.stock).toBe(5)
    expect(data.isAvailable).toBe(true)
    expect(data.listingVisibility).toBe('on-sale')
  })

  it('keeps an explicit catalog assignment', () => {
    expect(buildCompanyProductData({ ...base, catalogId: 'k1' }).catalogId).toBe('k1')
  })

  it('serializes array fields into the legacy JSON-string columns', () => {
    const data = buildCompanyProductData({
      ...base,
      images: ['a.jpg', 'b.jpg'],
      specs: [{ key: 'Volume', value: '500ml' }],
      variantAxes: [{ name: 'Size', values: ['S'] }],
    })
    expect(JSON.parse(data.images!)).toEqual(['a.jpg', 'b.jpg'])
    expect(JSON.parse(data.specs!)).toEqual([{ key: 'Volume', value: '500ml' }])
    expect(JSON.parse(data.variantAxes!)).toEqual([{ name: 'Size', values: ['S'] }])
  })

  it('maps empty or invalid inputs to null instead of garbage', () => {
    const data = buildCompanyProductData({ ...base, images: [], stock: '', priceSats: 'abc', description: '  ' })
    expect(data.images).toBeNull()
    expect(data.stock).toBeNull()
    expect(data.priceSats).toBe(0)
    expect(data.description).toBeNull()
  })

  it('accepts numeric strings for price and stock', () => {
    const data = buildCompanyProductData({ ...base, priceSats: '2500', stock: '10' })
    expect(data.priceSats).toBe(2500)
    expect(data.stock).toBe(10)
  })
})
