import { describe, it, expect } from 'vitest'
import { toMyOfferCard } from './my-offer-card'

describe('toMyOfferCard (ADR-422)', () => {
  it('maps a slim owner row: thumbnail avatar, publishedAt date', () => {
    expect(toMyOfferCard({
      id: 'a', title: 'Bitcoin T-Shirt', categoryCode: 'goods/clothing', priceSats: 41715,
      imageThumbs: ['data:image/jpeg;base64,AAA'], images: [], publishedAt: '2026-09-19T21:20:03.702Z',
    })).toEqual({
      id: 'a', title: 'Bitcoin T-Shirt', categoryCode: 'goods/clothing', priceSats: 41715,
      avatarUrl: 'data:image/jpeg;base64,AAA', createdAt: '2026-09-19T21:20:03.702Z',
    })
  })
  it('falls back to the first full image and createdAt for full rows', () => {
    const card = toMyOfferCard({ id: 'b', title: 'x', priceSats: 1, images: ['https://img/1.jpg', 'https://img/2.jpg'], createdAt: '2026-01-01T00:00:00Z' })
    expect(card.avatarUrl).toBe('https://img/1.jpg')
    expect(card.createdAt).toBe('2026-01-01T00:00:00Z')
    expect(card.categoryCode).toBe('')
  })
  it('has no avatar when neither thumbnails nor images exist', () => {
    expect(toMyOfferCard({ id: 'c', title: 'y', priceSats: 1, imageThumbs: [], images: [] }).avatarUrl).toBeUndefined()
  })
})
