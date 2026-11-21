// ADR-334 D1: GET /api/stats — ecosystem-wide aggregates for KPI strips.
//
// One roundtrip for every headline number the KPI strips on Home, CoopExplore
// and /search's coop context show, so they stop deriving "how many exist?"
// from windowed result sets (useAllOffers caps at 30, useOfferSearch caps at
// 100 server-side, useCoopExploreData caps at 100 per source — see the
// research doc docs/research/2026-08-24-ecosystem-stats-data-sources.md).
//
// All queries run in one Promise.all against the same base where-fragments
// the corresponding browse endpoints use, so a KPI number can never disagree
// with the list it summarizes for filtering reasons. Fixed payload, no query
// params — plain cacheMiddleware(30) (versionedListCache buys nothing for a
// single-key response and 30s TTL self-expires).

import { Router } from 'express'
import type { PrismaClient, Prisma } from '@prisma/client'
import { NON_VARIATION_OFFER } from '../lib/offer-filters.js'
import { cacheMiddleware } from '../middleware/cache.js'

// Public-browse offer lens — mirrors /api/offers' and /api/partners' public
// where: ACTIVE, not admin-blocked (ADR-284 D2), non-PRIVATE creator
// (ADR-152 Phase 4.2), parents only (ADR-270 D7).
const PUBLIC_OFFER_WHERE: Prisma.OfferWhereInput = {
  status: 'ACTIVE',
  blockedAt: null,
  creator: { profileVisibility: { not: 'PRIVATE' } },
  AND: [NON_VARIATION_OFFER],
}

// Marketplace lens additionally hides COOP-type offers — network cooperations
// surface in the coop context (Search/BuyDashboard both exclude them from
// marketplace results via offerType !== 'COOP').
const MARKETPLACE_OFFER_WHERE: Prisma.OfferWhereInput = {
  ...PUBLIC_OFFER_WHERE,
  offerType: { not: 'COOP' },
}

// OPEN cooperations that are not TENDER and not SERVICE = the "projects"
// bucket the coop KPI counts (coopToCoopItem maps cooperationType
// === 'TENDER' → 'tender', === 'SERVICE' → 'bundle', every other value
// including NULL → 'project'). `NOT: { cooperationType: 'TENDER' }` alone
// would drop NULL rows (same Prisma-`<>`-vs-NULL trap as
// NON_VARIATION_OFFER), hence the explicit OR.
// ADR-368 D4: SERVICE cooperations (Service Bundles) leave the projects
// bucket for the new `cooperations.service` count.
const OPEN_PROJECT_COOP_WHERE: Prisma.CooperationWhereInput = {
  status: 'OPEN',
  OR: [
    { cooperationType: null },
    { cooperationType: { notIn: ['TENDER', 'SERVICE'] } },
  ],
}

export function createStatsRouter(prisma: PrismaClient): Router {
  const router = Router()

  router.get('/', cacheMiddleware(30), async (_req, res) => {
    try {
      const [
        offersTotal,
        offersProducts,
        offersServices,
        offersAgents,
        offersSum,
        providerGroups,
        vendors,
        coopTotal,
        coopOpen,
        coopTenders,
        coopProjects,
        coopServiceBundles,
        coopNetwork,
        coopBudgetAll,
        coopBudgetOpen,
        remoteOffers,
      ] = await Promise.all([
        prisma.offer.count({ where: MARKETPLACE_OFFER_WHERE }),
        prisma.offer.count({ where: { ...MARKETPLACE_OFFER_WHERE, offerType: 'PRODUCT' } }),
        prisma.offer.count({ where: { ...MARKETPLACE_OFFER_WHERE, offerType: 'SERVICE' } }),
        prisma.offer.count({ where: { ...MARKETPLACE_OFFER_WHERE, offerType: 'AGENT_SETUP' } }),
        prisma.offer.aggregate({ _sum: { priceSats: true }, where: MARKETPLACE_OFFER_WHERE }),
        // Providers = people with public offers, ALL offer types (matches
        // /api/partners?segment=users, so the Coop Partners KPI can reuse it).
        prisma.offer.groupBy({
          by: ['creatorPubkey'],
          where: PUBLIC_OFFER_WHERE,
          _count: { _all: true },
        }),
        // Mirrors /api/companies' public where.
        prisma.company.count({ where: { isActive: true } }),
        prisma.cooperation.count(),
        prisma.cooperation.count({ where: { status: 'OPEN' } }),
        prisma.cooperation.count({ where: { status: 'OPEN', cooperationType: 'TENDER' } }),
        prisma.cooperation.count({ where: OPEN_PROJECT_COOP_WHERE }),
        // ADR-368 D4 (FU-659): unwindowed count of OPEN Service Bundles
        // (cooperationType === 'SERVICE') for the Services KPI chip.
        prisma.cooperation.count({ where: { status: 'OPEN', cooperationType: 'SERVICE' } }),
        // Network cooperations live in the Offer model (offerType=COOP).
        prisma.offer.count({ where: { ...PUBLIC_OFFER_WHERE, offerType: 'COOP' } }),
        prisma.cooperation.aggregate({ _sum: { budgetSats: true } }),
        prisma.cooperation.aggregate({ _sum: { budgetSats: true }, where: { status: 'OPEN' } }),
        // Mirrors the retired useRemoteOfferCount call
        // (/api/offers?source=REMOTE&status=ACTIVE&includeCount=true).
        prisma.offer.count({ where: { ...PUBLIC_OFFER_WHERE, source: 'REMOTE' } }),
      ])

      res.json({
        offers: {
          total: offersTotal,
          products: offersProducts,
          services: offersServices,
          agents: offersAgents,
          totalSats: offersSum._sum.priceSats ?? 0,
        },
        providers: providerGroups.length,
        vendors,
        cooperations: {
          total: coopTotal,
          open: coopOpen,
          tenders: coopTenders,
          projects: coopProjects,
          // ADR-368 D4: unwindowed count of OPEN Service Bundles — the Services
          // KPI chip adds this to offers.services. projects excludes it.
          service: coopServiceBundles,
          network: coopNetwork,
          totalBudgetSats: coopBudgetAll._sum.budgetSats ?? 0,
          openBudgetSats: coopBudgetOpen._sum.budgetSats ?? 0,
        },
        remoteOffers,
      })
    } catch (err) {
      console.error('[stats] GET / error:', err)
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to compute ecosystem stats' })
    }
  })

  return router
}
