import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'
import { seedStandardCategories } from '../services/categorySeed'
import { cacheMiddleware } from '../middleware/cache.js'
import { NON_VARIATION_OFFER } from '../lib/offer-filters.js'

export function createStandardCategoriesRouter(prisma: PrismaClient) {
  const router = Router()

  // ---------------------------------------------------------------------------
  // GET /api/standard-categories
  // Returns full 3-level hierarchy (level 1 → 2 → 3) optionally filtered by offerType
  // ---------------------------------------------------------------------------
  router.get('/', cacheMiddleware(86400), async (_req, res) => {
    try {
      const { offerType } = _req.query

      const where: any = { level: 1 }
      if (offerType && typeof offerType === 'string') {
        where.offerType = offerType as 'PRODUCT' | 'SERVICE'
      }

      const rootCategories = await prisma.standardCategory.findMany({
        where,
        include: {
          children: {
            include: {
              children: {
                orderBy: { sortOrder: 'asc' },
              },
            },
            orderBy: { sortOrder: 'asc' },
          },
        },
        orderBy: { sortOrder: 'asc' },
      })

      res.json({ standardCategories: rootCategories })
    } catch (error) {
      console.error('Failed to fetch standard categories:', error)
      res.status(500).json({ error: 'Failed to fetch standard categories' })
    }
  })

  // ---------------------------------------------------------------------------
  // GET /api/standard-categories/tree/flat
  // Returns a flat list of all standard categories (for dropdowns / pickers)
  // Must be registered before /:slug to avoid being caught by the wildcard.
  // ---------------------------------------------------------------------------
  router.get('/tree/flat', cacheMiddleware(86400), async (_req, res) => {
    try {
      const { offerType } = _req.query

      const where: any = {}
      if (offerType && typeof offerType === 'string') {
        where.offerType = offerType as 'PRODUCT' | 'SERVICE'
      }

      const allCategories = await prisma.standardCategory.findMany({
        where,
        orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }],
      })

      res.json({ standardCategories: allCategories })
    } catch (error) {
      console.error('Failed to fetch flat category tree:', error)
      res.status(500).json({ error: 'Failed to fetch flat category tree' })
    }
  })

  // ---------------------------------------------------------------------------
  // GET /api/standard-categories/browse/:slug
  // Browse endpoint: returns standard category tree + aggregated offer counts
  // Used by Buy Marketplace for category browsing
  // ADR-078: Removed vendorCategoryCount (vendor categories eliminated)
  // Must be registered before /:slug to avoid being caught by the wildcard.
  // ---------------------------------------------------------------------------
  router.get('/browse/:slug', async (req, res) => {
    try {
      const { slug } = req.params

      const category = await prisma.standardCategory.findUnique({
        where: { slug },
        include: {
          children: { orderBy: { sortOrder: 'asc' } },
        },
      })

      if (!category) {
        return res.status(404).json({ error: 'Standard category not found' })
      }

      // Count active offers in this category tree (self + direct children)
      const offerCount = await prisma.offer.count({
        where: {
          status: 'ACTIVE',
          AND: [NON_VARIATION_OFFER], // ADR-270 D7
          OR: [
            { categoryCode: category.slug },
            ...(category.children.map(c => ({ categoryCode: c.slug }))),
          ],
        },
      })

      res.json({
        category,
        stats: {
          offerCount,
          subcategoryCount: category.children.length,
        },
      })
    } catch (error) {
      console.error('Failed to browse standard category:', error)
      res.status(500).json({ error: 'Failed to browse standard category' })
    }
  })

  // ---------------------------------------------------------------------------
  // GET /api/standard-categories/:slug
  // Returns a single category (any level) with its parent chain
  // ---------------------------------------------------------------------------
  router.get('/:slug', async (req, res) => {
    try {
      const { slug } = req.params

      const category = await prisma.standardCategory.findUnique({
        where: { slug },
        include: {
          parent: {
            include: {
              parent: true,
            },
          },
          children: {
            orderBy: { sortOrder: 'asc' },
          },
        },
      })

      if (!category) {
        return res.status(404).json({ error: 'Standard category not found' })
      }

      res.json({ category })
    } catch (error) {
      console.error('Failed to fetch standard category:', error)
      res.status(500).json({ error: 'Failed to fetch standard category' })
    }
  })

  return router
}

// ---------------------------------------------------------------------------
// POST /api/standard-categories/seed
// Seed (or re-seed) all 3-level standard categories into the DB (ADR-078 v2)
// ---------------------------------------------------------------------------
export function createCategorySeedRouter(prisma: PrismaClient) {
  const router = Router()

  router.post('/', async (req, res) => {
    // FU-875: re-seeding is an operator action. In production it is only
    // reachable from inside the server container (loopback socket — not the
    // proxy-derived req.ip, which a client could influence via X-Forwarded-For).
    // Dev/test stacks keep the plain `curl -X POST` from the runbooks.
    if (process.env.NODE_ENV === 'production') {
      const remote = req.socket.remoteAddress ?? ''
      const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
      if (!isLoopback) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'Category seeding is only available from inside the server container.' })
      }
    }
    try {
      const { count, byLevel } = await seedStandardCategories(prisma)
      res.json({
        message: `Seeded ${count} categories (L1: ${byLevel[1] || 0}, L2: ${byLevel[2] || 0}, L3: ${byLevel[3] || 0})`,
        count,
        byLevel,
      })
    } catch (error) {
      console.error('Failed to seed standard categories:', error)
      res.status(500).json({ error: 'Failed to seed standard categories' })
    }
  })

  return router
}
