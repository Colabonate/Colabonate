import { describe, it, expect } from 'vitest'
import { DEFAULT_OFFER_CATEGORY_CODE, resolveCategoryCode } from './category-code.js'

const KNOWN_SLUG = 'goods/electronics'
const prisma = {
  standardCategory: {
    findUnique: async ({ where }: { where: { slug: string } }) =>
      where.slug === KNOWN_SLUG ? { slug: KNOWN_SLUG } : null,
  },
}

describe('resolveCategoryCode', () => {
  it('passes undefined through as "not provided"', async () => {
    const result = await resolveCategoryCode(prisma, undefined)
    expect(result).toEqual({ ok: true, categoryCode: undefined })
  })

  it('maps null and empty string to an explicit null clear', async () => {
    expect(await resolveCategoryCode(prisma, null)).toEqual({ ok: true, categoryCode: null })
    expect(await resolveCategoryCode(prisma, '')).toEqual({ ok: true, categoryCode: null })
    expect(await resolveCategoryCode(prisma, '   ')).toEqual({ ok: true, categoryCode: null })
  })

  it('resolves a valid slug to the canonical stored slug', async () => {
    const result = await resolveCategoryCode(prisma, ` ${KNOWN_SLUG} `)
    expect(result).toEqual({ ok: true, categoryCode: KNOWN_SLUG })
  })

  it('rejects unknown slugs with a 400-worthy message', async () => {
    const result = await resolveCategoryCode(prisma, 'services/marketing/digital')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('services/marketing/digital')
      expect(result.message).toContain('StandardCategory')
    }
  })

  it('rejects non-string values', async () => {
    const result = await resolveCategoryCode(prisma, 42)
    expect(result.ok).toBe(false)
  })
})

describe('DEFAULT_OFFER_CATEGORY_CODE', () => {
  it('stays a real taxonomy slug contract for the offer create fallback', () => {
    expect(DEFAULT_OFFER_CATEGORY_CODE).toBe('services/other')
  })
})
