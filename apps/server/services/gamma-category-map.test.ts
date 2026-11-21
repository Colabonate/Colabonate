// ADR-380: Gamma tag -> standard category derivation (map v2 + offerType).

import { describe, expect, it } from 'vitest'

import {
  CATEGORY_TO_GAMMA_TAGS,
  deriveCategoryCodeFromGammaTags,
  offerTypeForCategoryCode,
  tagsForCategoryCode,
} from './gamma-category-map.js'

describe('gamma-category-map — ADR-277/380 reverse resolution', () => {
  it('resolves a real corpus service tag to its standard service category', () => {
    expect(deriveCategoryCodeFromGammaTags(['freelance'])).toBe('services')
    expect(deriveCategoryCodeFromGammaTags(['copywriting'])).toBe('services/writing-translation/copywriting')
    expect(deriveCategoryCodeFromGammaTags(['web-development'])).toBe('services/development/web')
    expect(deriveCategoryCodeFromGammaTags(['seo'])).toBe('services/marketing/seo')
  })

  it('picks the most specific mapped tag, not the first one declared', () => {
    // `services` resolves to the level-1 root, `web-development` to a level-3
    // leaf — the longer slug must win regardless of tag order.
    expect(deriveCategoryCodeFromGammaTags(['services', 'web-development'])).toBe('services/development/web')
    expect(deriveCategoryCodeFromGammaTags(['web-development', 'services'])).toBe('services/development/web')
  })

  it('keeps the ADR-277 contract: unmapped tags yield an empty categoryCode', () => {
    expect(deriveCategoryCodeFromGammaTags(['some-unmapped-hashtag'])).toBe('')
  })

  it('the v1 generic mappings still hold (no accidental widening)', () => {
    expect(deriveCategoryCodeFromGammaTags(['electronics'])).toBe('goods/electronics')
    expect(deriveCategoryCodeFromGammaTags(['clothing'])).toBe('goods/clothing')
    expect(deriveCategoryCodeFromGammaTags(['software'])).toBe('digital/software')
  })
})

describe('gamma-category-map — ADR-380 offerType derivation', () => {
  it('maps the services subtree to SERVICE and everything else to PRODUCT', () => {
    expect(offerTypeForCategoryCode('services')).toBe('SERVICE')
    expect(offerTypeForCategoryCode('services/development/web')).toBe('SERVICE')
    expect(offerTypeForCategoryCode('goods/electronics')).toBe('PRODUCT')
    expect(offerTypeForCategoryCode('digital/software')).toBe('PRODUCT')
    expect(offerTypeForCategoryCode('')).toBe('PRODUCT')
  })
})

describe('gamma-category-map — forward suggestions', () => {
  it('suggests level-3 tags for a level-3 category', () => {
    expect(tagsForCategoryCode('services/development/web')).toContain('web-development')
  })

  it('falls back to the nearest mapped ancestor for an unmapped deep slug', () => {
    expect(tagsForCategoryCode('services/development/web/something-new')).toEqual(
      CATEGORY_TO_GAMMA_TAGS['services/development/web'],
    )
  })
})
