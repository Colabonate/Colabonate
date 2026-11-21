import { describe, it, expect } from 'vitest'
import type { CartItem } from '../types/api'
import { parseStoredCart, needsSourceCheck, applySourceResults } from './cart-integrity'

const valid = (overrides: Partial<CartItem> = {}): CartItem => ({
  offerId: 'offer-1',
  title: 'Item',
  priceSats: 1000,
  offerType: 'PRODUCT',
  sellerPubkey: 'seller-1',
  quantity: 1,
  ...overrides,
} as CartItem)

describe('parseStoredCart', () => {
  it('returns [] for non-array input', () => {
    expect(parseStoredCart({ offerId: 'x' })).toEqual([])
    expect(parseStoredCart('nope')).toEqual([])
    expect(parseStoredCart(null)).toEqual([])
    expect(parseStoredCart(undefined)).toEqual([])
  })

  it('keeps a valid item unchanged', () => {
    const item = valid()
    expect(parseStoredCart([item])).toEqual([item])
  })

  it('drops malformed entries', () => {
    const bad = [
      { title: 'no id', priceSats: 1, sellerPubkey: 's', quantity: 1 },
      valid({ offerId: '' }),
      valid({ quantity: 0 }),
      valid({ quantity: 1.5 }),
      valid({ priceSats: 'x' as unknown as number }),
      null,
      'string',
      42,
    ]
    expect(parseStoredCart(bad)).toEqual([])
  })

  it('drops items with source REMOTE and keeps LOCAL', () => {
    const remote = valid({ offerId: 'r', source: 'REMOTE' })
    const local = valid({ offerId: 'l', source: 'LOCAL' })
    expect(parseStoredCart([remote, local]).map(i => i.offerId)).toEqual(['l'])
  })

  it('never throws on odd input', () => {
    expect(() => parseStoredCart(null)).not.toThrow()
    expect(() => parseStoredCart(undefined)).not.toThrow()
    expect(() => parseStoredCart('abc')).not.toThrow()
  })
})

describe('needsSourceCheck', () => {
  it('is true only when source is undefined', () => {
    expect(needsSourceCheck(valid())).toBe(true)
    expect(needsSourceCheck(valid({ source: 'LOCAL' }))).toBe(false)
    expect(needsSourceCheck(valid({ source: 'REMOTE' }))).toBe(false)
  })
})

describe('applySourceResults', () => {
  it('removes REMOTE items and returns them as removedRemote', () => {
    const remote = valid({ offerId: 'r' })
    const result = applySourceResults([remote], { r: 'REMOTE' })
    expect(result.items).toEqual([])
    expect(result.removedRemote).toEqual([remote])
  })

  it('marks LOCAL items with source LOCAL', () => {
    const result = applySourceResults([valid({ offerId: 'l' })], { l: 'LOCAL' })
    expect(result.items[0].source).toBe('LOCAL')
    expect(result.removedRemote).toEqual([])
  })

  it('keeps items without a result unchanged', () => {
    const item = valid({ offerId: 'unknown' })
    const result = applySourceResults([item], {})
    expect(result.items).toEqual([item])
    expect(result.items[0].source).toBeUndefined()
  })

  it('preserves order', () => {
    const items = [valid({ offerId: 'a' }), valid({ offerId: 'b' }), valid({ offerId: 'c' })]
    const result = applySourceResults(items, { b: 'REMOTE', a: 'LOCAL' })
    expect(result.items.map(i => i.offerId)).toEqual(['a', 'c'])
    expect(result.removedRemote.map(i => i.offerId)).toEqual(['b'])
  })

  it('does not mutate inputs', () => {
    const items = [valid({ offerId: 'a' }), valid({ offerId: 'b' })]
    const before = JSON.stringify(items)
    applySourceResults(items, { a: 'LOCAL', b: 'REMOTE' })
    expect(JSON.stringify(items)).toBe(before)
  })
})
