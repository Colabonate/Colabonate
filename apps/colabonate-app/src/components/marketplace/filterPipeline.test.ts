import { describe, it, expect } from 'vitest'
import { buildFilteredOffers } from './filterPipeline'
import type { Offer } from '../../types/api'

function makeOffer(partial: Partial<Offer> & { id: string }): Offer {
  return {
    title: partial.id,
    offerType: 'PRODUCT',
    priceSats: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  } as Offer
}

function run(offers: Offer[], sortBy: string): string[] {
  return buildFilteredOffers({
    searchResults: offers,
    hideNoImageOffers: false,
    isUsableImage: () => true,
    taxonomy: 'standard',
    selectedGammaTags: [],
    sortBy,
  }).map(o => o.id)
}

describe('buildFilteredOffers price sort with non-sats remote offers', () => {
  it('price-asc keeps remote offers without a sats price last', () => {
    const offers = [
      makeOffer({ id: 'remote-eur', source: 'REMOTE', priceCurrency: 'EUR', priceAmount: '20', priceSats: 0 }),
      makeOffer({ id: 'expensive', priceSats: 2000 }),
      makeOffer({ id: 'remote-zero', source: 'REMOTE', priceSats: 0 }),
      makeOffer({ id: 'cheap', priceSats: 1000 }),
    ]
    expect(run(offers, 'price-asc')).toEqual(['cheap', 'expensive', 'remote-eur', 'remote-zero'])
  })

  it('price-desc also keeps remote offers without a sats price last', () => {
    const offers = [
      makeOffer({ id: 'remote-eur', source: 'REMOTE', priceCurrency: 'EUR', priceAmount: '20', priceSats: 0 }),
      makeOffer({ id: 'cheap', priceSats: 1000 }),
      makeOffer({ id: 'remote-zero', source: 'REMOTE', priceSats: 0 }),
      makeOffer({ id: 'expensive', priceSats: 2000 }),
    ]
    expect(run(offers, 'price-desc')).toEqual(['expensive', 'cheap', 'remote-eur', 'remote-zero'])
  })

  it('treats a LOCAL offer with priceSats 0 and no currency as a normal price', () => {
    const offers = [
      makeOffer({ id: 'local-free', source: 'LOCAL', priceSats: 0 }),
      makeOffer({ id: 'priced', priceSats: 500 }),
    ]
    expect(run(offers, 'price-asc')).toEqual(['local-free', 'priced'])
  })

  it('keeps incoming order among remote offers without a sats price', () => {
    const offers = [
      makeOffer({ id: 'remote-b', source: 'REMOTE', priceSats: 0 }),
      makeOffer({ id: 'remote-a', source: 'REMOTE', priceSats: 0 }),
      makeOffer({ id: 'priced', priceSats: 100 }),
    ]
    expect(run(offers, 'price-asc')).toEqual(['priced', 'remote-b', 'remote-a'])
    expect(run(offers, 'price-desc')).toEqual(['priced', 'remote-b', 'remote-a'])
  })

  it('name sort is unaffected', () => {
    const offers = [
      makeOffer({ id: 'b', title: 'Beta', source: 'REMOTE', priceSats: 0 }),
      makeOffer({ id: 'a', title: 'Alpha', priceSats: 9000 }),
    ]
    expect(run(offers, 'name')).toEqual(['a', 'b'])
  })

  it('newest sort is unaffected', () => {
    const offers = [
      makeOffer({ id: 'old', createdAt: '2025-01-01T00:00:00.000Z', priceSats: 1 }),
      makeOffer({ id: 'new', createdAt: '2026-06-01T00:00:00.000Z', source: 'REMOTE', priceSats: 0 }),
    ]
    expect(run(offers, 'newest')).toEqual(['new', 'old'])
  })
})
