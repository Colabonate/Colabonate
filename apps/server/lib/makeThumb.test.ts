import { describe, it, expect } from 'vitest'
import { makeThumb, makeThumbsFromImages } from './makeThumb.js'

// 1x1 transparent PNG data-URL
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PICSUM_URL = 'https://picsum.photos/seed/foo/600/400'

describe('makeThumb', () => {
  it('generates a webp thumbnail for a data-URL image', async () => {
    const thumb = await makeThumb(TINY_PNG)
    expect(thumb).toMatch(/^data:image\/webp;base64,/)
  })

  it('returns null for a plain (non-data-URL) image', async () => {
    expect(await makeThumb(PICSUM_URL)).toBeNull()
  })
})

describe('makeThumbsFromImages', () => {
  it('returns null for non-array or empty input', async () => {
    expect(await makeThumbsFromImages(undefined)).toBeNull()
    expect(await makeThumbsFromImages([])).toBeNull()
  })

  it('resizes data-URL entries into webp thumbnails', async () => {
    const result = await makeThumbsFromImages([TINY_PNG])
    expect(result).not.toBeNull()
    expect(result![0]).toMatch(/^data:image\/webp;base64,/)
  })

  // Regression: /api/cooperations/discover and /api/offers' slim browse
  // select (ADR-194, ADR-376) only ever send `imageThumbs`, never the raw
  // `images` column — a plain-URL entry dropped here would be permanently
  // invisible in those list views (this broke Home's Services &
  // Collaborations slider for every seed cooperation using picsum URLs).
  it('passes a plain-URL entry through unchanged instead of dropping it', async () => {
    const result = await makeThumbsFromImages([PICSUM_URL])
    expect(result).toEqual([PICSUM_URL])
  })

  it('preserves 1:1 correspondence for a mixed data-URL + plain-URL array', async () => {
    const result = await makeThumbsFromImages([TINY_PNG, PICSUM_URL])
    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)
    expect(result![0]).toMatch(/^data:image\/webp;base64,/)
    expect(result![1]).toBe(PICSUM_URL)
  })

  it('drops non-string entries', async () => {
    const result = await makeThumbsFromImages([PICSUM_URL, 42, null])
    expect(result).toEqual([PICSUM_URL])
  })
})
