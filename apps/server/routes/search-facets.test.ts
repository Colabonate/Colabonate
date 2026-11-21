// ADR-418 — contract tests for GET /api/search/facets and the shared filter
// builders it reuses with GET /api/search. Meili and the Redis-backed cache are
// mocked; Prisma is a vi.fn() fake. The real router + real middleware run.
import express from 'express'
import request from 'supertest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

const mockMeili = vi.hoisted(() => ({ client: null as any })) // eslint-disable-line @typescript-eslint/no-explicit-any

vi.mock('../lib/meili.js', () => ({
  getMeili: () => mockMeili.client,
}))

// Cache disabled: versionedListCache passes straight through when `cache` is null.
vi.mock('../services/cache.js', () => ({
  cache: null,
  versionedKey: (...parts: unknown[]) => parts.join(':'),
  computeQueryHash: async () => 'h',
}))

import { createSearchRouter, buildMeiliFilters, buildDbWhere } from './search'
import { OFFER_INDEX_SETTINGS } from '../services/search-config'

function makePrisma() {
  return {
    offer: {
      groupBy: vi.fn(async () => []),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    standardCategory: {
      findMany: vi.fn(async () => []),
    },
  } as unknown as PrismaClient & {
    offer: { groupBy: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> }
    standardCategory: { findMany: ReturnType<typeof vi.fn> }
  }
}

function makeMeiliClient(searchImpl: (...args: unknown[]) => unknown) {
  const search = vi.fn(searchImpl)
  const client = {
    getIndexes: vi.fn(async () => ({ results: [{ uid: 'offers' }] })),
    index: vi.fn(() => ({ search })),
  }
  return { client, search }
}

function makeApp(prisma: PrismaClient) {
  const app = express()
  app.use('/api/search', createSearchRouter(prisma))
  return app
}

describe('ADR-418 buildMeiliFilters', () => {
  it('with omitCountry the filter never contains a country clause but keeps the others', async () => {
    const prisma = makePrisma()
    const filters = await buildMeiliFilters(
      prisma,
      { country: 'DE', offerType: 'PRODUCT', companyId: 'c1', language: 'en' },
      { omitCountry: true },
    )
    expect(filters.some(f => f.includes('country'))).toBe(false)
    expect(filters).toContain('status = ACTIVE')
    expect(filters).toContain('offerType = "PRODUCT"')
    expect(filters).toContain('companyId = "c1"')
    expect(filters).toContain('language = "en"')
  })

  it('default (list) keeps the country clause in the original position', async () => {
    const prisma = makePrisma()
    const filters = await buildMeiliFilters(prisma, { offerType: 'PRODUCT', country: 'DE', language: 'en' })
    expect(filters).toEqual([
      'status = ACTIVE',
      'offerType = "PRODUCT"',
      'country = "DE"',
      'language = "en"',
    ])
  })

  it('passes a quote-injection value through sanitizeMeiliFilter', async () => {
    const prisma = makePrisma()
    const filters = await buildMeiliFilters(prisma, { companyId: 'DE" OR 1=1' })
    expect(filters).toContain('companyId = "DE OR 1=1"')
    // Only the two delimiter quotes remain on the clause.
    const clause = filters.find(f => f.startsWith('companyId'))!
    expect(clause.split('"').length - 1).toBe(2)
  })
})

describe('ADR-418 buildDbWhere', () => {
  it('with omitCountry the where has no country key but keeps the other filters', () => {
    const where = buildDbWhere({ country: 'DE', offerType: 'PRODUCT', q: 'bitcoin' }, { omitCountry: true })
    expect(where).not.toHaveProperty('country')
    expect(where.offerType).toBe('PRODUCT')
    expect(where.status).toBe('ACTIVE')
    expect(where.AND).toBeDefined()
  })

  it('default keeps country on the where', () => {
    const where = buildDbWhere({ country: 'DE' })
    expect(where.country).toBe('DE')
  })
})

describe('ADR-418 search-config faceting', () => {
  it('raises maxValuesPerFacet above the 249 ISO 3166 alpha-2 codes', () => {
    const max = OFFER_INDEX_SETTINGS.faceting?.maxValuesPerFacet
    expect(max).toBeGreaterThanOrEqual(249)
  })
})

describe('GET /api/search/facets — Meili path', () => {
  beforeEach(() => {
    process.env.SEARCH_BACKEND = 'meili'
  })
  afterEach(() => {
    delete process.env.SEARCH_BACKEND
    mockMeili.client = null
  })

  it('computes countryless as estimatedTotalHits minus the country sum', async () => {
    const { client } = makeMeiliClient(async () => ({
      facetDistribution: { country: { US: 2, DE: 1 } },
      estimatedTotalHits: 7,
    }))
    mockMeili.client = client
    const res = await request(makeApp(makePrisma())).get('/api/search/facets')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ country: { US: 2, DE: 1 }, countryless: 4, total: 7 })
  })

  it('clamps countryless at zero when the estimate is below the facet sum', async () => {
    const { client } = makeMeiliClient(async () => ({
      facetDistribution: { country: { US: 2, DE: 1 } },
      estimatedTotalHits: 2,
    }))
    mockMeili.client = client
    const res = await request(makeApp(makePrisma())).get('/api/search/facets')
    expect(res.body.countryless).toBe(0)
  })

  it('never returns an empty key in country (folds it into countryless)', async () => {
    const { client } = makeMeiliClient(async () => ({
      facetDistribution: { country: { '': 3, US: 1 } },
      estimatedTotalHits: 4,
    }))
    mockMeili.client = client
    const res = await request(makeApp(makePrisma())).get('/api/search/facets')
    expect(res.body.country).toEqual({ US: 1 })
    expect(res.body.countryless).toBe(3)
    expect(Object.keys(res.body.country)).not.toContain('')
  })

  it('searches with the list filters minus country, facets: [country], limit 0', async () => {
    const { client, search } = makeMeiliClient(async () => ({
      facetDistribution: {},
      estimatedTotalHits: 0,
    }))
    mockMeili.client = client
    await request(makeApp(makePrisma())).get('/api/search/facets?country=DE&offerType=PRODUCT&q=bitcoin')
    expect(search).toHaveBeenCalledTimes(1)
    const [q, opts] = search.mock.calls[0] as [string, Record<string, unknown>]
    expect(q).toBe('bitcoin')
    expect(opts.facets).toEqual(['country'])
    expect(opts.limit).toBe(0)
    expect(opts.filter).toEqual(['status = ACTIVE', 'offerType = "PRODUCT"'])
  })

  it('injection-style country value never reaches the Meili filter', async () => {
    const { client, search } = makeMeiliClient(async () => ({
      facetDistribution: {},
      estimatedTotalHits: 0,
    }))
    mockMeili.client = client
    await request(makeApp(makePrisma())).get('/api/search/facets?country=' + encodeURIComponent('DE" OR 1=1'))
    const [, opts] = search.mock.calls[0] as [string, { filter: string[] }]
    expect(opts.filter.join(' ')).not.toContain('country')
    expect(opts.filter.join(' ')).not.toContain('1=1')
  })

  it('falls back to the DB path when Meili errors', async () => {
    const { client } = makeMeiliClient(async () => {
      throw new Error('meili down')
    })
    mockMeili.client = client
    const prisma = makePrisma()
    prisma.offer.groupBy.mockResolvedValueOnce([{ country: 'US', _count: 1 }])
    const res = await request(makeApp(prisma)).get('/api/search/facets')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ country: { US: 1 }, countryless: 0, total: 1 })
  })
})

describe('GET /api/search/facets — DB path', () => {
  beforeEach(() => {
    process.env.SEARCH_BACKEND = 'database'
  })
  afterEach(() => {
    delete process.env.SEARCH_BACKEND
  })

  it('folds null country rows into countryless and sums total over all rows', async () => {
    const prisma = makePrisma()
    prisma.offer.groupBy.mockResolvedValueOnce([
      { country: 'US', _count: 2 },
      { country: 'DE', _count: 1 },
      { country: null, _count: 2 },
    ])
    const res = await request(makeApp(prisma)).get('/api/search/facets')
    expect(res.body).toEqual({ country: { US: 2, DE: 1 }, countryless: 2, total: 5 })
  })

  it('groupBy runs on the where without country', async () => {
    const prisma = makePrisma()
    await request(makeApp(prisma)).get('/api/search/facets?country=DE&offerType=PRODUCT')
    const arg = prisma.offer.groupBy.mock.calls[0][0] as { by: string[]; where: Record<string, unknown> }
    expect(arg.by).toEqual(['country'])
    expect(arg.where).not.toHaveProperty('country')
    expect(arg.where.offerType).toBe('PRODUCT')
  })

  it('has the same response shape as the Meili path for the same data', async () => {
    // Meili path: US 2, DE 1, 2 countryless out of 5.
    const { client } = makeMeiliClient(async () => ({
      facetDistribution: { country: { US: 2, DE: 1 } },
      estimatedTotalHits: 5,
    }))
    mockMeili.client = client
    process.env.SEARCH_BACKEND = 'meili'
    const meiliBody = (await request(makeApp(makePrisma())).get('/api/search/facets')).body
    mockMeili.client = null

    // DB path: same data.
    process.env.SEARCH_BACKEND = 'database'
    const prisma = makePrisma()
    prisma.offer.groupBy.mockResolvedValueOnce([
      { country: 'US', _count: 2 },
      { country: 'DE', _count: 1 },
      { country: null, _count: 2 },
    ])
    const dbBody = (await request(makeApp(prisma)).get('/api/search/facets')).body

    expect(dbBody).toEqual(meiliBody)
    expect(Object.keys(dbBody).sort()).toEqual(['country', 'countryless', 'total'])
    expect(typeof dbBody.countryless).toBe('number')
    expect(typeof dbBody.total).toBe('number')
  })
})

describe('GET /api/search (list) — filters unchanged by the ADR-418 refactor', () => {
  beforeEach(() => {
    process.env.SEARCH_BACKEND = 'meili'
  })
  afterEach(() => {
    delete process.env.SEARCH_BACKEND
    mockMeili.client = null
  })

  it('still sends the country clause to Meili for the list', async () => {
    const { client, search } = makeMeiliClient(async () => ({
      hits: [],
      estimatedTotalHits: 0,
      processingTimeMs: 1,
      facetDistribution: {},
    }))
    mockMeili.client = client
    await request(makeApp(makePrisma())).get('/api/search?country=DE&offerType=PRODUCT&language=en')
    const [, opts] = search.mock.calls[0] as [string, { filter: string[] }]
    expect(opts.filter).toEqual([
      'status = ACTIVE',
      'offerType = "PRODUCT"',
      'country = "DE"',
      'language = "en"',
    ])
  })
})
