import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'
import { NON_VARIATION_OFFER } from '../lib/offer-filters.js'

const SLIDER_LIMIT = 12
const MAX_LIMIT = 60
const DEFAULT_LIMIT = 24

export type PartnerSort = 'offers' | 'alphabetical' | 'category' | 'recent'
export type PartnerFilters = { new?: boolean; top?: boolean; nearby?: boolean }

function parseOfferImages(o: { images: unknown }): string[] {
  if (!o.images) return []
  if (Array.isArray(o.images)) {
    return o.images.filter((s): s is string => typeof s === 'string')
  }
  if (typeof o.images === 'string') {
    try {
      const parsed = JSON.parse(o.images)
      return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : []
    } catch {
      return []
    }
  }
  return []
}

function parseBool(v: unknown): boolean {
  if (v === true) return true
  if (v === false || v == null) return false
  const s = String(v).toLowerCase()
  return s === '1' || s === 'true' || s === 'yes'
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((s): s is string => typeof s === 'string')
  if (typeof v === 'string') {
    return v.split(',').map(s => s.trim()).filter(Boolean)
  }
  return []
}

export interface PartnerUser {
  pubkey: string
  lnAddress: string | null
  picture: string | null
  offerCount: number
  categories: string[]
  firstOfferAt: string | null
  rating: number | null
  reviewCount: number
  verified: boolean
}

export interface PartnerCompany {
  id: string
  name: string
  logoUrl: string | null
  bannerUrl: string | null
  ownerPubkey: string
  offerCount: number
  categories: string[]
  firstOfferAt: string | null
  verified: boolean
}

export interface PartnerListResponse {
  segment: 'users' | 'companies'
  items: Array<PartnerUser | PartnerCompany>
  total: number
  limit: number
  offset: number
  sort: PartnerSort
  filters: Required<PartnerFilters>
}

export function createPartnersRouter(prisma: PrismaClient): Router {
  const router = Router()

  router.get('/', async (req, res) => {
    try {
      const segmentParam = String(req.query.segment ?? 'users')
      const segment: 'users' | 'companies' = segmentParam === 'companies' ? 'companies' : 'users'

      const sort: PartnerSort = (() => {
        const s = String(req.query.sort ?? 'offers')
        if (s === 'alphabetical' || s === 'category' || s === 'recent') return s
        return 'offers'
      })()

      const filters: Required<PartnerFilters> = {
        new: parseBool(req.query.new),
        top: parseBool(req.query.top),
        nearby: parseBool(req.query.nearby),
      }
      const country = typeof req.query.country === 'string' ? req.query.country : null
      const categoryFilter = asStringArray(req.query.categories)

      const limit = Math.min(
        Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT),
        MAX_LIMIT
      )
      const offset = Math.max(0, Number(req.query.offset) || 0)
      const forSlider = req.query.slider === '1'
      const effectiveLimit = forSlider ? Math.min(limit, SLIDER_LIMIT) : limit

      const offerWhere: Record<string, unknown> = {
        status: 'ACTIVE',
        blockedAt: null, // ADR-284 D2
        AND: [NON_VARIATION_OFFER], // ADR-270 D7: browse surfaces show parents only
      }
      if (segment === 'users') {
        offerWhere.creator = { profileVisibility: { not: 'PRIVATE' } }
      } else {
        offerWhere.companyId = { not: null }
      }
      if (country) offerWhere.country = country
      if (categoryFilter.length > 0) offerWhere.categoryCode = { in: categoryFilter }
      if (filters.new) {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        offerWhere.publishedAt = { gte: sevenDaysAgo }
      }

      if (segment === 'users') {
        const [grouped, totalCount, topRated] = await Promise.all([
          prisma.offer.groupBy({
            by: ['creatorPubkey'],
            where: offerWhere,
            _count: { _all: true },
            _min: { publishedAt: true },
          }),
          prisma.offer.findMany({
            where: offerWhere,
            select: { creatorPubkey: true },
            distinct: ['creatorPubkey'],
          }),
          filters.top
            ? prisma.review.groupBy({
                by: ['revieweePubkey'],
                _avg: { stars: true },
                _count: { _all: true },
              })
            : Promise.resolve([] as Array<{ revieweePubkey: string; _avg: { stars: number | null }; _count: { _all: number } }>),
        ])

        const ratingMap = new Map<string, { rating: number; count: number }>()
        for (const r of topRated) {
          if (r._avg.stars == null) continue
          ratingMap.set(r.revieweePubkey, {
            rating: Math.round(r._avg.stars * 10) / 10,
            count: r._count._all,
          })
        }

        let candidates = grouped
        if (filters.top) {
          candidates = candidates.filter(g => {
            const r = ratingMap.get(g.creatorPubkey)
            return !!r && r.rating >= 4.0 && r.count >= 3
          })
        }
        if (filters.nearby && country) {
          // already applied via offerWhere.country; no-op
        }
        if (filters.nearby && !country) {
          candidates = []
        }

        const total = candidates.length
        const pubkeys = candidates.map(c => c.creatorPubkey)
        if (pubkeys.length === 0) {
          res.json({
            segment: 'users',
            items: [],
            total,
            limit: effectiveLimit,
            offset,
            sort,
            filters,
          } satisfies PartnerListResponse)
          return
        }

        const [users, offerImages] = await Promise.all([
          prisma.user.findMany({
            where: { pubkey: { in: pubkeys } },
            select: { pubkey: true, lnAddress: true, picture: true, identityLevel: true, categoryCodes: true },
          }),
          prisma.offer.findMany({
            where: { ...offerWhere, creatorPubkey: { in: pubkeys } },
            select: { creatorPubkey: true, images: true },
            orderBy: { publishedAt: 'desc' },
          }),
        ])

        const userMap = new Map(users.map(u => [u.pubkey, u]))
        const offerImageMap = new Map<string, string>()
        for (const o of offerImages) {
          const imgs = parseOfferImages(o)
          if (imgs.length > 0 && !offerImageMap.has(o.creatorPubkey)) {
            offerImageMap.set(o.creatorPubkey, imgs[0])
          }
        }
        const enriched: Array<PartnerUser & { _firstOfferAt: number; _display: string }> = candidates.map(g => {
          const user = userMap.get(g.creatorPubkey)
          const rating = ratingMap.get(g.creatorPubkey)
          const display = user?.lnAddress || `${g.creatorPubkey.slice(0, 8)}…`
          return {
            pubkey: g.creatorPubkey,
            lnAddress: user?.lnAddress ?? null,
            picture: user?.picture ?? offerImageMap.get(g.creatorPubkey) ?? null,
            offerCount: g._count._all,
            categories: user?.categoryCodes ?? [],
            firstOfferAt: g._min.publishedAt?.toISOString() ?? null,
            rating: rating?.rating ?? null,
            reviewCount: rating?.count ?? 0,
            verified: (user?.identityLevel ?? 0) >= 1,
            _firstOfferAt: g._min.publishedAt?.getTime() ?? 0,
            _display: display.toLowerCase(),
          }
        })

        enriched.sort((a, b) => {
          switch (sort) {
            case 'alphabetical':
              return a._display.localeCompare(b._display)
            case 'recent':
              return b._firstOfferAt - a._firstOfferAt
            case 'category':
            case 'offers':
            default:
              return b.offerCount - a.offerCount
          }
        })

        const sliced = enriched.slice(offset, offset + effectiveLimit)
        const items: PartnerUser[] = sliced.map(s => {
          const { _firstOfferAt: _, _display: __, ...rest } = s
          return rest
        })

        res.json({
          segment: 'users',
          items,
          total,
          limit: effectiveLimit,
          offset,
          sort,
          filters,
        } satisfies PartnerListResponse)
        return
      }

      // segment === 'companies'
      const [grouped, totalGroups] = await Promise.all([
        prisma.offer.groupBy({
          by: ['companyId'],
          where: offerWhere,
          _count: { _all: true },
          _min: { publishedAt: true },
        }),
        prisma.offer.findMany({
          where: { ...offerWhere, companyId: { not: null } },
          select: { companyId: true },
          distinct: ['companyId'],
        }),
      ])

      let candidates = grouped.filter(g => g.companyId)
      if (filters.nearby && !country) candidates = []

      const total = candidates.length
      const companyIds = candidates.map(c => c.companyId!).filter(Boolean)
      if (companyIds.length === 0) {
        res.json({
          segment: 'companies',
          items: [],
          total,
          limit: effectiveLimit,
          offset,
          sort,
          filters,
        } satisfies PartnerListResponse)
        return
      }

      const [companies, offerImages] = await Promise.all([
        prisma.company.findMany({
          where: { id: { in: companyIds }, isActive: true, blockedAt: null }, // ADR-284 D2
          select: { id: true, name: true, logoUrl: true, bannerUrl: true, ownerPubkey: true, images: true },
        }),
        prisma.offer.findMany({
          where: { ...offerWhere, companyId: { in: companyIds } },
          select: { companyId: true, images: true },
          orderBy: { publishedAt: 'desc' },
        }),
      ])

      const companyMap = new Map(companies.map(c => [c.id, c]))
      const offerImageMap = new Map<string, string>()
      for (const o of offerImages) {
        if (!o.companyId) continue
        const imgs = parseOfferImages(o)
        if (imgs.length > 0 && !offerImageMap.has(o.companyId)) {
          offerImageMap.set(o.companyId, imgs[0])
        }
      }
      const enriched = candidates
        .filter(g => g.companyId && companyMap.has(g.companyId))
        .map(g => {
          const c = companyMap.get(g.companyId!)!
          return {
            id: c.id,
            name: c.name,
            logoUrl: c.logoUrl ?? parseOfferImages({ images: c.images })[0] ?? offerImageMap.get(c.id) ?? null,
            bannerUrl: c.bannerUrl,
            ownerPubkey: c.ownerPubkey,
            offerCount: g._count._all,
            categories: [],
            firstOfferAt: g._min.publishedAt?.toISOString() ?? null,
            verified: false,
            _firstOfferAt: g._min.publishedAt?.getTime() ?? 0,
            _display: c.name.toLowerCase(),
          }
        })

      enriched.sort((a, b) => {
        switch (sort) {
          case 'alphabetical':
            return a._display.localeCompare(b._display)
          case 'recent':
            return b._firstOfferAt - a._firstOfferAt
          case 'category':
          case 'offers':
          default:
            return b.offerCount - a.offerCount
        }
      })

      const sliced = enriched.slice(offset, offset + effectiveLimit)
      const items: PartnerCompany[] = sliced.map(s => {
        const { _firstOfferAt: _, _display: __, ...rest } = s
        return rest
      })

      res.json({
        segment: 'companies',
        items,
        total,
        limit: effectiveLimit,
        offset,
        sort,
        filters,
      } satisfies PartnerListResponse)
    } catch (error) {
      console.error('Failed to fetch partners:', error)
      res.status(500).json({ error: 'Failed to fetch partners' })
    }
  })

  return router
}
