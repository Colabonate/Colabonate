import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'
import { cacheMiddleware } from '../middleware/cache.js'
import { tagsForCategoryCode } from '../services/gamma-category-map.js'

// ADR-277 Phase E1: tag suggestions for the offer-wizard's gamma-tag input.
// `popular` is the live corpus, frequency-sorted (unnest is the standard
// Postgres way to aggregate over a String[] column — Prisma has no groupBy
// over array elements). `suggested` is the D3 seed map for the offer's
// chosen categoryCode. Neither list is a constraint (D3): sellers may type
// any tag; normalization happens client- and server-side via
// normalizeGammaTag(s), not here.
export function createGammaTagsRouter(prisma: PrismaClient) {
  const router = Router()

  router.get('/', cacheMiddleware(300), async (req, res) => {
    try {
      const { categoryCode } = req.query

      const popularRows = await prisma.$queryRaw<Array<{ tag: string; count: bigint }>>`
        SELECT tag, count(*) AS count
        FROM "Offer", unnest("gammaTags") AS tag
        WHERE status = 'ACTIVE'
        GROUP BY tag
        ORDER BY count DESC
        LIMIT 50
      `
      const popular = popularRows.map(r => r.tag)
      const suggested = typeof categoryCode === 'string' && categoryCode
        ? tagsForCategoryCode(categoryCode)
        : []

      res.json({ popular, suggested })
    } catch (error) {
      console.error('Failed to fetch gamma tag suggestions:', error)
      res.status(500).json({ error: 'Failed to fetch gamma tag suggestions' })
    }
  })

  return router
}
