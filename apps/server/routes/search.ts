import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { OFFER_INDEX_ALIAS, OFFER_INDEX_NAME, OFFER_INDEX_SETTINGS, type OfferSearchDocument } from '../services/search-config.js'
import { parsePagination, buildPaginatedResult, decodeCursor, encodeCursor } from '../lib/pagination.js'
import { getMeili } from '../lib/meili.js'
import { NON_VARIATION_OFFER } from '../lib/offer-filters.js'
import { versionedListCache } from '../middleware/cache.js'

// ADR-363 D2: tolerant reader for the AGENT_SETUP composite keyset cursor.
// The shared cursor codec (pagination.ts) only validates date sortKeys, so
// the reputation-first sort carries { reputationScore, publishedAt } as an
// opaque JSON string inside sortKey and decodes it here. Non-agent cursors
// stay on decodeCursor (date validation untouched).
interface AgentCursorPayload {
  id: string
  reputationScore: number | null
  publishedAt: string
}

function decodeAgentCursor(after: string): AgentCursorPayload | null {
  try {
    const decoded = JSON.parse(Buffer.from(after, 'base64url').toString('utf-8'))
    if (!decoded.id || typeof decoded.sortKey !== 'string') return null
    const sortKey = JSON.parse(decoded.sortKey)
    if (!sortKey || typeof sortKey.publishedAt !== 'string') return null
    return {
      id: decoded.id,
      reputationScore: typeof sortKey.reputationScore === 'number' ? sortKey.reputationScore : null,
      publishedAt: sortKey.publishedAt,
    }
  } catch {
    return null
  }
}

// ADR-363 D2 (review fix): the Meili path paginates with a plain offset
// cursor encoded as { id: '', sortKey: '<offset>' } — the shared decodeCursor
// requires a truthy id AND a date sortKey, so it always returned null and
// offset pagination never advanced past page 1. This reader accepts exactly
// that wire format; anything else returns null (falls back to offset 0).
function decodeOffsetCursor(after: string): number | null {
  try {
    const decoded = JSON.parse(Buffer.from(after, 'base64url').toString('utf-8'))
    if (typeof decoded.id !== 'string' || typeof decoded.sortKey !== 'string') return null
    const offset = Number(decoded.sortKey)
    if (!Number.isFinite(offset) || offset < 0 || !Number.isInteger(offset)) return null
    return offset
  } catch {
    return null
  }
}

async function getSearchIndex() {
  const client = getMeili()
  if (!client) return null
  try {
    const indexes = await client.getIndexes()
    const aliasIndex = indexes.results.find((i: any) => i.uid === OFFER_INDEX_ALIAS)
    if (aliasIndex) return OFFER_INDEX_ALIAS
    const versionIndex = indexes.results.find((i: any) => i.uid === OFFER_INDEX_NAME)
  } catch {
    return null
  }
}

function normalizeSearchHit(o: any) {
  const hit = { ...o }
  if (!hit.images) {
    hit.images = []
  } else if (typeof hit.images === 'string') {
    try {
      hit.images = JSON.parse(hit.images)
    } catch {
      hit.images = []
    }
  } else if (!Array.isArray(hit.images)) {
    hit.images = []
  }
  // FU-233-D: wallet credentials are server-only — never serialized.
  delete hit.lightningSubWalletAdminKey
  delete hit.lightningSubWalletId
  return hit
}

function sanitizeMeiliFilter(value: string): string {
  return value.replace(/"/g, '')
}

// ADR-418 D1: shared filter builders. GET / (list) and GET /facets reuse these
// so the two cannot drift. `omitCountry` is the disjunctive-facet switch: the
// facets endpoint must count every country under the *other* filters, so it
// drops the country clause. Default (no opts) produces the list's filters.
export interface SearchFilterOptions {
  omitCountry?: boolean
}

export async function buildMeiliFilters(
  prisma: PrismaClient,
  query: Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  opts: SearchFilterOptions = {},
): Promise<string[]> {
  const { offerType, country, categoryCode, gammaTag, language, companyId, creatorPubkey, capability, minReputation, agentBillingModel, canvasProvider } = query

  const filters: string[] = ['status = ACTIVE']
  if (offerType) filters.push(`offerType = "${sanitizeMeiliFilter(String(offerType))}"`)
  if (country && !opts.omitCountry) filters.push(`country = "${sanitizeMeiliFilter(String(country))}"`)
  if (companyId) filters.push(`companyId = "${sanitizeMeiliFilter(String(companyId))}"`)
  if (creatorPubkey) filters.push(`creatorPubkey = "${sanitizeMeiliFilter(String(creatorPubkey))}"`)
  // ADR-313 D2: capability is OR-combined (any match), mirrors gammaTag below.
  if (capability) {
    const caps = (Array.isArray(capability) ? capability : [capability]).map(c => sanitizeMeiliFilter(String(c)))
    filters.push(`agentCapabilities IN [${caps.map(c => `"${c}"`).join(', ')}]`)
  }
  if (minReputation) filters.push(`agentReputationScore >= ${Number(minReputation)}`)
  if (agentBillingModel) filters.push(`agentBillingModel = "${sanitizeMeiliFilter(String(agentBillingModel))}"`)
  // ADR-370 D6 (Phase 2, FU-671): the canvasProvider facet was indexed since
  // ADR-342 Phase B (search-config) but never filtered — activate it end-to-end.
  if (canvasProvider) filters.push(`canvasProvider = "${sanitizeMeiliFilter(String(canvasProvider))}"`)
  // ADR-277 D4: gamma axis is flat and multi-select, OR-combined — unlike
  // categoryCode below, no descendant expansion (there is no hierarchy).
  if (gammaTag) {
    const tags = (Array.isArray(gammaTag) ? gammaTag : [gammaTag]).map(t => sanitizeMeiliFilter(String(t)))
    filters.push(`gammaTags IN [${tags.map(t => `"${t}"`).join(', ')}]`)
  }
  if (categoryCode) {
    // Meilisearch has no prefix filter operator, so expand the requested
    // category to itself plus all descendant slugs — mirrors the
    // startsWith clause in buildDbWhere.
    const code = sanitizeMeiliFilter(String(categoryCode))
    const descendants = await prisma.standardCategory.findMany({
      where: { slug: { startsWith: `${code}/` } },
      select: { slug: true },
    })
    const codes = [code, ...descendants.map(d => sanitizeMeiliFilter(d.slug))]
    filters.push(`categoryCode IN [${codes.map(c => `"${c}"`).join(', ')}]`)
  }
  if (language) filters.push(`language = "${sanitizeMeiliFilter(String(language))}"`)
  return filters
}

// Shared DB where-builder for the DB fallback list (GET /) and the facets
// endpoint. Returns the filter-only where; the list adds its keyset cursor
// clauses on top. `omitCountry` mirrors buildMeiliFilters (ADR-418 D1).
export function buildDbWhere(
  query: Record<string, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  opts: SearchFilterOptions = {},
): Record<string, unknown> {
  const { q, offerType, country, categoryCode, gammaTag, language, companyId, creatorPubkey, capability, minReputation, agentBillingModel, canvasProvider } = query

  const where: Record<string, unknown> = {
    status: 'ACTIVE',
    blockedAt: null, // ADR-284 D2
  }
  if (offerType) where.offerType = offerType
  if (country && !opts.omitCountry) where.country = country
  if (language) where.language = language
  if (companyId) where.companyId = companyId
  if (creatorPubkey) where.creatorPubkey = creatorPubkey
  // ADR-313 D2: agent-specific filters. capability is OR-combined (any match);
  // minReputation and agentBillingModel narrow further.
  if (agentBillingModel) where.agentBillingModel = agentBillingModel
  if (capability || minReputation) {
    const agentProfileWhere: Record<string, unknown> = {}
    if (capability) {
      const caps = Array.isArray(capability) ? capability.map(String) : [String(capability)]
      agentProfileWhere.capabilities = { hasSome: caps }
    }
    if (minReputation) agentProfileWhere.reputationScore = { gte: Number(minReputation) }
    where.agentProfile = { is: agentProfileWhere }
  }
  // ADR-152 Phase 4.2: never surface offers from PRIVATE-profile creators.
  where.creator = { profileVisibility: { not: 'PRIVATE' } }

  const andClauses: object[] = [NON_VARIATION_OFFER] // ADR-270 D7
  // ADR-370 D6 (Phase 2, FU-671): canvasProvider via the JSON path
  // (agentConfigMeta.canvas.provider — mirrors the Meili flat facet).
  if (canvasProvider) {
    andClauses.push({ agentConfigMeta: { path: ['canvas', 'provider'], equals: String(canvasProvider) } })
  }
  if (gammaTag) {
    // ADR-277 D4: OR-combined — any selected tag matches.
    const tags = Array.isArray(gammaTag) ? gammaTag.map(String) : [String(gammaTag)]
    andClauses.push({ gammaTags: { hasSome: tags } })
  }
  if (categoryCode) {
    andClauses.push({ OR: [
      { categoryCode: String(categoryCode) },
      { categoryCode: { startsWith: `${String(categoryCode)}/` } },
    ] })
  }
  if (q) {
    andClauses.push({ OR: [
      { title: { contains: q as string, mode: 'insensitive' } },
      { description: { contains: q as string, mode: 'insensitive' } },
      { city: { contains: q as string, mode: 'insensitive' } },
      { region: { contains: q as string, mode: 'insensitive' } },
    ] })
  }
  if (andClauses.length > 0) where.AND = andClauses
  return where
}

export function createSearchRouter(prisma: PrismaClient): Router {
  const router = Router()

  // ── Autosuggest cache ───────────────────────────────────────────────────────
  // Small in-memory LRU for typeahead keystroke bursts. 200 keys / 60s TTL.
  class LruCache<K, V> {
    private cache = new Map<K, { value: V; expiresAt: number }>()
    constructor(private maxSize: number, private ttlMs: number) {}

    get(key: K): V | undefined {
      const entry = this.cache.get(key)
      if (!entry) return undefined
      if (Date.now() > entry.expiresAt) {
        this.cache.delete(key)
        return undefined
      }
      // Move to back (most recently used)
      this.cache.delete(key)
      this.cache.set(key, entry)
      return entry.value
    }

    set(key: K, value: V) {
      if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
        const firstKey = this.cache.keys().next().value as K
        this.cache.delete(firstKey)
      }
      this.cache.delete(key)
      this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs })
    }
  }

  interface SuggestOffer {
    id: string
    title: string
    categoryCode: string
    offerType: string
  }

  interface SuggestCategory {
    code: string
    label: string
    count: number
  }

  interface SuggestResponse {
    offers: SuggestOffer[]
    categories: SuggestCategory[]
  }

  const suggestCache = new LruCache<string, SuggestResponse>(200, 60_000)

  function buildSuggestCacheKey(q: string, lang: string | undefined): string {
    return `${q.toLowerCase().trim()}|${lang ?? ''}`
  }

  router.get('/suggest', async (req, res) => {
    const q = String(req.query.q || '').trim()
    const lang = req.query.lang ? String(req.query.lang) : undefined
    const limit = Math.min(Math.max(Number(req.query.limit) || 6, 1), 20)

    res.set('Cache-Control', 'public, max-age=30')

    if (!q) {
      return res.json({ offers: [], categories: [] })
    }

    const cacheKey = buildSuggestCacheKey(q, lang)
    const cached = suggestCache.get(cacheKey)
    if (cached) {
      return res.json(cached)
    }

    const searchBackend = process.env.SEARCH_BACKEND ?? 'database'
    const client = getMeili()

    try {
      let offers: SuggestOffer[] = []

      if (searchBackend !== 'database' && client) {
        const indexName = await getSearchIndex()
        if (indexName) {
          const results = await client.index(indexName).search(q, {
            filter: ['status = ACTIVE'],
            limit,
            attributesToRetrieve: ['id', 'title', 'categoryCode', 'offerType'],
          })
          offers = results.hits.map((hit: any) => ({
            id: hit.id,
            title: hit.title,
            categoryCode: hit.categoryCode,
            offerType: hit.offerType,
          }))
        }
      }

      // Meili unavailable / empty / mis-configured: fall back to DB.
      if (offers.length === 0) {
        const dbOffers = await prisma.offer.findMany({
          where: {
            status: 'ACTIVE',
            blockedAt: null, // ADR-284 D2
            AND: [NON_VARIATION_OFFER], // ADR-270 D7
            creator: { profileVisibility: { not: 'PRIVATE' } },
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { description: { contains: q, mode: 'insensitive' } },
              { city: { contains: q, mode: 'insensitive' } },
              { region: { contains: q, mode: 'insensitive' } },
            ],
          },
          select: {
            id: true,
            title: true,
            categoryCode: true,
            offerType: true,
          },
          orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
          take: limit,
        })
        offers = dbOffers as SuggestOffer[]
      }

      // Aggregate categories from returned offers.
      const categoryCounts = new Map<string, number>()
      for (const offer of offers) {
        if (offer.categoryCode) {
          categoryCounts.set(offer.categoryCode, (categoryCounts.get(offer.categoryCode) || 0) + 1)
        }
      }

      const categorySlugs = Array.from(categoryCounts.keys())
      const categoryNames = categorySlugs.length > 0
        ? await prisma.standardCategory.findMany({
            where: { slug: { in: categorySlugs } },
            select: { slug: true, name: true },
          })
        : []
      const nameBySlug = new Map(categoryNames.map(c => [c.slug, c.name]))

      const categories: SuggestCategory[] = Array.from(categoryCounts.entries())
        .map(([code, count]) => ({ code, label: nameBySlug.get(code) || code, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 4)

      const response: SuggestResponse = { offers, categories }
      suggestCache.set(cacheKey, response)
      res.json(response)
    } catch (err) {
      console.error('[search/suggest] error:', err)
      res.status(500).json({ error: 'Suggest failed' })
    }
  })

  router.get('/', versionedListCache('offers', 60), async (req, res) => {
    const searchBackend = process.env.SEARCH_BACKEND ?? 'database'
    const client = getMeili()

    if (searchBackend === 'database' || !client) {
      return dbSearchFallback(prisma, req, res)
    }

    try {
      const indexName = await getSearchIndex()
      if (!indexName) {
        return dbSearchFallback(prisma, req, res)
      }

      const { q, offerType, sort, first, after } = req.query
      const { limit } = parsePagination(req.query as Record<string, unknown>)

      // ADR-418 D1: filter building lives in buildMeiliFilters (shared with GET /facets).
      const filters = await buildMeiliFilters(prisma, req.query)

      // ADR-313 D4: agent-setup listings default to reputation-first sorting.
      // ADR-363 D2: every sort appends the `id` tiebreaker so the ordering is
      // a stable total order — offset pagination then cannot reorder rows
      // within an unchanged dataset (the mid-batch-insert case is handled
      // client-side by dedupeHits, useOfferSearch.ts).
      const defaultSort = offerType === 'AGENT_SETUP' ? ['agentReputationScore:desc', 'id:desc'] : undefined
      let meiliSort: string[] | undefined = undefined
      if (sort) {
        const sortStr = String(sort)
        if (sortStr === 'price-asc') meiliSort = ['priceSats:asc', 'id:desc']
        else if (sortStr === 'price-desc') meiliSort = ['priceSats:desc', 'id:desc']
        else if (sortStr === 'newest') meiliSort = ['publishedAt:desc', 'id:desc']
        else if (
          sortStr === 'createdAt:desc' || sortStr === 'createdAt:asc' ||
          sortStr === 'priceSats:desc' || sortStr === 'priceSats:asc' ||
          sortStr === 'publishedAt:desc' || sortStr === 'publishedAt:asc' ||
          sortStr === 'agentReputationScore:desc' || sortStr === 'agentReputationScore:asc'
        ) {
          meiliSort = [sortStr, 'id:desc']
        }
      } else if (defaultSort) {
        meiliSort = defaultSort
      }

      const meiliLimit = Math.min(Number(first) || 100, 100)
      // ADR-335 D2: the Meili cursor is a plain offset — Meilisearch's native
      // pagination primitive, sort-agnostic regardless of what `sort` carries.
      // Reuses encodeCursor purely for a consistent opaque wire format shared
      // with the DB-fallback path's composite cursor (id = '' here).
      // ADR-363 D2 (review fix): decodeCursor rejects id='' + non-date
      // sortKeys, so the Meili path must read its offset with the tolerant
      // decodeOffsetCursor — otherwise offset pagination never advanced past
      // page 1 (every `after=` page re-served offset 0).
      const meiliOffset = typeof after === 'string' ? (decodeOffsetCursor(after) ?? 0) : 0
      const results = await client.index(indexName).search(q as string || '', {
        filter: filters,
        sort: meiliSort,
        limit: meiliLimit,
        offset: meiliOffset,
        // ADR-403: `offerType` facet powers the /search subtab result counts +
        // auto-switch (Products/Services/All) without extra requests — the same
        // single search response carries the per-type distribution.
        facets: ['gammaTags', 'offerType'],
      })

      // Meili stores a search-optimised shape (createdAt as epoch-ms; some legacy
      // docs omit fields), but the SPA's Offer type expects the DB shape (ISO
      // strings, full relations). Re-hydrate the full offers from Postgres by the
      // Meili hit IDs, preserving Meili's relevance order, so /api/search returns
      // the SAME shape as the DB fallback regardless of backend. Fixes the
      // /buy + /search sort crash ("o.createdAt is undefined / not a string").
      const hitIds = (results.hits as any[]).map(h => h.id)
      let ordered: any[] = []
      if (hitIds.length > 0) {
        // ADR-284 D2: Meilisearch itself has no blockedAt filter attribute (that
        // would need an index-sync change, out of scope here) — this Postgres
        // re-hydration is where blocked offers actually get dropped from what
        // the client sees. A blocked offer can still consume a Meili hit slot
        // (undercounting `limit`), but never appears in the returned list.
        const full = await prisma.offer.findMany({
          where: { id: { in: hitIds }, status: 'ACTIVE', blockedAt: null, creator: { profileVisibility: { not: 'PRIVATE' } } },
          include: {
            creator: { select: { pubkey: true, lnAddress: true } },
            company: { select: { id: true, name: true, logoUrl: true } },
            // ADR-315 D3: badge fields flow through the search re-hydration so
            // search-result cards can render the "Verified" chip.
            agentProfile: { select: { id: true, name: true, avatarUrl: true, capabilities: true, reputationScore: true, trustScore: true, isVerified: true, verifiedAt: true } },
          },
        })
        const byId = new Map(full.map((o: any) => [o.id, o]))
        ordered = hitIds.map(id => byId.get(id)).filter(Boolean)
      }

      // ADR-335 D2: maxTotalHits is a hard ceiling — requests past it return an
      // empty hits array, not an error. `results.hits.length === meiliLimit`
      // degrades safely to hasNextPage:false in that case (no bug), but is
      // the correct "is there more" signal for every normal page too.
      const meiliHasMore = results.hits.length === meiliLimit
      const meiliEndCursor = meiliHasMore ? encodeCursor('', String(meiliOffset + meiliLimit)) : null

      res.json({
        hits: ordered.map(normalizeSearchHit),
        estimatedTotalHits: results.estimatedTotalHits,
        processingTimeMs: results.processingTimeMs,
        facetDistribution: results.facetDistribution,
        pageInfo: { hasNextPage: meiliHasMore, endCursor: meiliEndCursor },
      })
    } catch (err) {
      console.error('[search] meili error:', err)
      return dbSearchFallback(prisma, req, res)
    }
  })

  // ADR-418 D1: location facet for the /search and /buy Location filter. Same
  // filters as GET / but `country` is deliberately ignored (disjunctive facet),
  // so every country stays selectable while one is picked. Cached 60s on the
  // shared `offers` tag, like the list.
  router.get('/facets', versionedListCache('offers', 60), async (req, res) => {
    const searchBackend = process.env.SEARCH_BACKEND ?? 'database'
    const client = getMeili()

    if (searchBackend === 'database' || !client) {
      return facetsDbFallback(prisma, req, res)
    }

    try {
      const indexName = await getSearchIndex()
      if (!indexName) {
        return facetsDbFallback(prisma, req, res)
      }

      const { q } = req.query
      const filters = await buildMeiliFilters(prisma, req.query, { omitCountry: true })
      const results = await client.index(indexName).search(q as string || '', {
        filter: filters,
        facets: ['country'],
        limit: 0,
      })

      // Meili omits null-valued documents from the distribution, so the
      // countryless remainder is exact arithmetic over the estimated total.
      // Empty-string keys are treated like null: never returned as a country.
      const country: Record<string, number> = {}
      let counted = 0
      for (const [key, value] of Object.entries((results.facetDistribution?.country ?? {}) as Record<string, number>)) {
        if (!key) continue
        country[key] = value
        counted += value
      }
      const total = results.estimatedTotalHits ?? 0
      res.json({ country, countryless: Math.max(0, total - counted), total })
    } catch (err) {
      console.error('[search/facets] meili error:', err)
      return facetsDbFallback(prisma, req, res)
    }
  })

  return router
}

// ADR-418 D1: DB-fallback facet (SEARCH_BACKEND=database, or Meili error).
// One groupBy over the same where as the list minus `country`; null/empty
// country rows fold into `countryless`, so the response shape matches Meili.
async function facetsDbFallback(prisma: PrismaClient, req: any, res: any): Promise<void> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const where = buildDbWhere(req.query, { omitCountry: true })
    const groups = await prisma.offer.groupBy({ by: ['country'], where, _count: true })

    const country: Record<string, number> = {}
    let countryless = 0
    let total = 0
    for (const g of groups) {
      const n = typeof g._count === 'number' ? g._count : 0
      total += n
      if (g.country) country[g.country] = n
      else countryless += n
    }
    res.json({ country, countryless, total })
  } catch (err) {
    console.error('[search/facets] db fallback error:', err)
    res.status(500).json({ error: 'Facets failed' })
  }
}

async function dbSearchFallback(prisma: PrismaClient, req: any, res: any): Promise<void> {
  try {
    const { offerType, first, after } = req.query
    const { limit } = parsePagination(req.query as Record<string, unknown>)

    // ADR-418 D1: filter-only where from buildDbWhere (shared with GET /facets).
    const where = buildDbWhere(req.query)

    const startMs = Date.now()

    // ADR-313 D4: agent-setup listings default to reputation-first sorting
    // instead of recency — an unreviewed brand-new agent shouldn't outrank a
    // proven one just by publish date.
    const isAgentSort = offerType === 'AGENT_SETUP'
    let orderBy: any[]
    if (isAgentSort) {
      // NULLS LAST must be EXPLICIT: Postgres sorts NULLs FIRST for DESC by
      // default, but every keyset predicate below (and the product intent —
      // unreviewed agents should not outrank proven ones) assumes the null-score
      // group sorts after the scored rows. Prisma's `nulls: 'last'` keeps the
      // ORDER BY and the cursor predicates in lock-step (review fix 2026-09-02).
      orderBy = [
        { agentProfile: { reputationScore: { sort: 'desc' as const, nulls: 'last' as const } } },
        { publishedAt: 'desc' as const },
        { id: 'desc' as const },
      ]
    } else if (req.query.sort === 'price-asc') {
      orderBy = [{ priceSats: 'asc' as const }, { id: 'desc' as const }]
    } else if (req.query.sort === 'price-desc') {
      orderBy = [{ priceSats: 'desc' as const }, { id: 'desc' as const }]
    } else if (req.query.sort === 'name') {
      orderBy = [{ title: 'asc' as const }, { id: 'desc' as const }]
    } else {
      orderBy = [{ publishedAt: 'desc' as const }, { id: 'desc' as const }]
    }

    const take = Math.min(Number(first) || 20, 100)
    const afterCursor = typeof after === 'string' ? decodeCursor(after) : null
    // ADR-363 D2 (review fix): the AGENT_SETUP cursor encodes a JSON sortKey
    // ({ reputationScore, publishedAt }) that the shared decodeCursor rejects
    // (date-only validator) — so the keyset branch must be gated on the
    // tolerant decodeAgentCursor, NEVER on afterCursor (which is always null
    // for these cursors; the old skip-based path had the identical broken
    // gate, page 2+ silently re-served page 1).
    const agentCur = typeof after === 'string' && isAgentSort ? decodeAgentCursor(after) : null

    // ADR-363 D2: AGENT_SETUP no longer paginates by skip-based offset (the
    // ADR-335 fallback — a new row inserted between two batch loads shifted
    // the offset and could render the same offer twice). The shared codec
    // (pagination.ts) is date-only, so the reputation-first sort encodes its
    // own composite cursor payload ({ reputationScore, publishedAt }) inside
    // the opaque sortKey and decodes it here with a tolerant reader. Every
    // other sort keeps the composite (publishedAt, id) keyset cursor, which
    // is correct across concurrent inserts/deletes between batch loads.
    if (agentCur) {
      const andClauses2 = (where.AND as object[] | undefined) ?? []
      // A row's effective reputation score is NULL when it has no
      // agentProfile OR when agentProfile exists but reputationScore is null
      // (Float? — schema.prisma:320). Both groups sort together AFTER all
      // scored rows (orderBy above pins `nulls: 'last'` explicitly — Postgres
      // would otherwise put NULLs first for DESC), ordered by (publishedAt, id)
      // among themselves, so both must be matched in every null-score predicate
      // below.
      const NULL_SCORE = {
        OR: [
          { agentProfile: { is: null } },
          { agentProfile: { is: { reputationScore: null } } },
        ],
      }
      if (agentCur.reputationScore === null) {
        // Cursor row sits inside the null-score group: only the null-score
        // rows AFTER it (lower publishedAt, or same date + lower id) follow.
        andClauses2.push({
          AND: [
            NULL_SCORE,
            {
              OR: [
                { publishedAt: { lt: agentCur.publishedAt } },
                { AND: [{ publishedAt: agentCur.publishedAt }, { id: { lt: agentCur.id } }] },
              ],
            },
          ],
        })
      } else {
        andClauses2.push({
          OR: [
            // NULLS LAST in Postgres: every null-score row follows any
            // non-null cursor row.
            NULL_SCORE,
            { agentProfile: { is: { reputationScore: { lt: agentCur.reputationScore } } } },
            {
              AND: [
                { agentProfile: { is: { reputationScore: agentCur.reputationScore } } },
                { publishedAt: { lt: agentCur.publishedAt } },
              ],
            },
            {
              AND: [
                { agentProfile: { is: { reputationScore: agentCur.reputationScore } } },
                { publishedAt: agentCur.publishedAt },
                { id: { lt: agentCur.id } },
              ],
            },
          ],
        })
      }
      where.AND = andClauses2
    } else if (afterCursor) {
      const cursorDate = new Date(afterCursor.sortKey)
      const andClauses2 = (where.AND as object[] | undefined) ?? []
      andClauses2.push({
        OR: [
          { publishedAt: { lt: cursorDate } },
          { AND: [{ publishedAt: cursorDate }, { id: { lt: afterCursor.id } }] },
        ],
      })
      where.AND = andClauses2
    }

    // ADR-335 D2: totalCount only needs computing once — the client only ever
    // reads page 1's estimatedTotalHits (useOfferSearchInfinite ignores it on
    // later pages), so re-running count() on every batch is a wasted query,
    // worse on this where-clause since it joins through creator/agentProfile
    // relation filters.
    const [offers, totalCount, typeCounts] = await Promise.all([
      prisma.offer.findMany({
        where,
        include: {
          creator: { select: { pubkey: true, lnAddress: true } },
          company: { select: { id: true, name: true, logoUrl: true } },
          // ADR-315 D3: badge fields flow through the DB fallback path too.
          agentProfile: { select: { id: true, name: true, avatarUrl: true, capabilities: true, reputationScore: true, trustScore: true, isVerified: true, verifiedAt: true } },
        },
        orderBy,
        take: take + 1,
      }),
      afterCursor ? Promise.resolve(undefined) : prisma.offer.count({ where }),
      // ADR-403: mirror Meili's `offerType` facet on the DB fallback so the
      // /search subtab counts work identically with SEARCH_BACKEND=database.
      // Page 1 only, like totalCount above.
      after ? Promise.resolve([]) : prisma.offer.groupBy({ by: ['offerType'], where, _count: true }),
    ])

    const hasMore = offers.length > take
    const pageOffers = hasMore ? offers.slice(0, take) : offers
    const lastHit: any = pageOffers[pageOffers.length - 1]
    // ACTIVE offers can still have a null publishedAt (e.g. legacy/ingested
    // rows) — fall back to the epoch so the cursor never crashes on toISOString().
    // ADR-363 D2: the AGENT_SETUP cursor carries the composite keyset payload
    // (reputationScore, publishedAt) inside the opaque sortKey; every other
    // sort keeps the date sortKey the shared codec validates.
    const endCursor = hasMore && lastHit
      ? (isAgentSort
          ? encodeCursor(lastHit.id, JSON.stringify({ reputationScore: lastHit.agentProfile?.reputationScore ?? null, publishedAt: (lastHit.publishedAt ?? new Date(0)).toISOString() }))
          : encodeCursor(lastHit.id, (lastHit.publishedAt ?? new Date(0)).toISOString()))
      : null

    const hits = pageOffers.map(normalizeSearchHit)

    // ADR-403: same shape Meilisearch returns, so the client reads one field
    // regardless of backend. Empty array when paginating (page > 1).
    const typeFacet: Record<string, number> = {}
    for (const c of typeCounts ?? []) {
      if (c.offerType) typeFacet[c.offerType] = typeof c._count === 'number' ? c._count : 0
    }

    res.json({
      hits,
      estimatedTotalHits: totalCount,
      processingTimeMs: Date.now() - startMs,
      facetDistribution: Object.keys(typeFacet).length > 0 ? { offerType: typeFacet } : undefined,
      pageInfo: { hasNextPage: hasMore, endCursor },
    })
  } catch (err) {
    console.error('[search] db fallback error:', err)
    res.status(500).json({ error: 'Search failed' })
  }
}