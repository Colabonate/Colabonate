// ADR-334 live smoke: GET /api/stats against the running dev server + local
// Postgres. Verifies the response shape, each count against an independent
// prisma.count with the same where-clauses, and the internal invariants
// (tenders + projects + service == open cooperations; openBudget <=
// totalBudget).
//
// Run with:
//   DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr334-ecosystem-stats-smoke.ts
//
// Expected: every assertion PASSes against any DB (seed or live) — the
// endpoint must always agree with its own ground-truth prisma queries.
import { config as loadEnv } from 'dotenv'
import { resolve } from 'node:path'
// Smoke runs from the repo root (npx tsx apps/server/scripts/...). Load the
// root .env explicitly so DATABASE_URL is found without needing the caller
// to export it.
loadEnv({ path: resolve(process.cwd(), '.env') })

import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4001'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, detail ?? '') }
}

// Same where-fragments as the route (apps/server/routes/stats.ts). Annotated
// with the generated Prisma input types so the enum fields type-check (loose
// string inference widens 'ACTIVE'/'TENDER' past the Prisma enums).
const PUBLIC_OFFER_WHERE: Prisma.OfferWhereInput = {
  status: 'ACTIVE',
  blockedAt: null,
  creator: { profileVisibility: { not: 'PRIVATE' } },
  AND: [{ OR: [{ productType: null }, { productType: { not: 'variation' } }] }],
}
const MARKETPLACE_OFFER_WHERE: Prisma.OfferWhereInput = {
  ...PUBLIC_OFFER_WHERE,
  offerType: { not: 'COOP' },
}
const OPEN_PROJECT_COOP_WHERE: Prisma.CooperationWhereInput = {
  status: 'OPEN',
  OR: [{ cooperationType: null }, { cooperationType: { notIn: ['TENDER', 'SERVICE'] } }],
}

async function main() {
  // 1. Endpoint reachable + returns the documented shape
  const res = await fetch(`${BASE_URL}/api/stats`)
  check('GET /api/stats -> 200', res.status === 200, res.status)
  const body = await res.json()

  // 2. Shape — every key in the type is present and numeric
  for (const k of ['offers', 'providers', 'vendors', 'cooperations', 'remoteOffers']) {
    check(`body has top-level "${k}"`, k in body, body)
  }
  for (const k of ['total', 'products', 'services', 'agents', 'totalSats']) {
    check(`body.offers has "${k}"`, k in (body.offers ?? {}))
  }
  for (const k of ['total', 'open', 'tenders', 'projects', 'service', 'network', 'totalBudgetSats', 'openBudgetSats']) {
    check(`body.cooperations has "${k}"`, k in (body.cooperations ?? {}))
  }
  for (const k of ['offers.total', 'providers', 'vendors', 'remoteOffers', 'cooperations.total', 'cooperations.tenders', 'cooperations.totalBudgetSats']) {
    const v = k.split('.').reduce((o: any, kk) => (o == null ? undefined : o[kk]), body)
    check(`body.${k} is a non-negative number`, typeof v === 'number' && Number.isFinite(v) && v >= 0, v)
  }

  // 3. Independent prisma counts — must agree with the endpoint
  const [
    offersTotal, offersProducts, offersServices, offersAgents, offersSum,
    providerGroups, vendors,
    coopTotal, coopOpen, coopTenders, coopProjects, coopServiceBundles, coopNetwork,
    budgetAll, budgetOpen, remoteOffers,
  ] = await Promise.all([
    prisma.offer.count({ where: MARKETPLACE_OFFER_WHERE }),
    prisma.offer.count({ where: { ...MARKETPLACE_OFFER_WHERE, offerType: 'PRODUCT' } }),
    prisma.offer.count({ where: { ...MARKETPLACE_OFFER_WHERE, offerType: 'SERVICE' } }),
    prisma.offer.count({ where: { ...MARKETPLACE_OFFER_WHERE, offerType: 'AGENT_SETUP' } }),
    prisma.offer.aggregate({ _sum: { priceSats: true }, where: MARKETPLACE_OFFER_WHERE }),
    prisma.offer.groupBy({ by: ['creatorPubkey'], where: PUBLIC_OFFER_WHERE, _count: { _all: true } }),
    prisma.company.count({ where: { isActive: true } }),
    prisma.cooperation.count(),
    prisma.cooperation.count({ where: { status: 'OPEN' } }),
    prisma.cooperation.count({ where: { status: 'OPEN', cooperationType: 'TENDER' } }),
    prisma.cooperation.count({ where: OPEN_PROJECT_COOP_WHERE }),
    prisma.cooperation.count({ where: { status: 'OPEN', cooperationType: 'SERVICE' } }),
    prisma.offer.count({ where: { ...PUBLIC_OFFER_WHERE, offerType: 'COOP' } }),
    prisma.cooperation.aggregate({ _sum: { budgetSats: true } }),
    prisma.cooperation.aggregate({ _sum: { budgetSats: true }, where: { status: 'OPEN' } }),
    prisma.offer.count({ where: { ...PUBLIC_OFFER_WHERE, source: 'REMOTE' } }),
  ])

  check('offers.total matches prisma.count', body.offers.total === offersTotal, { endpoint: body.offers.total, prisma: offersTotal })
  check('offers.products matches prisma.count', body.offers.products === offersProducts, { endpoint: body.offers.products, prisma: offersProducts })
  check('offers.services matches prisma.count', body.offers.services === offersServices, { endpoint: body.offers.services, prisma: offersServices })
  check('offers.agents matches prisma.count', body.offers.agents === offersAgents, { endpoint: body.offers.agents, prisma: offersAgents })
  check('offers.totalSats matches prisma.aggregate', body.offers.totalSats === (offersSum._sum.priceSats ?? 0), { endpoint: body.offers.totalSats, prisma: offersSum._sum.priceSats })
  check('providers matches groupBy length', body.providers === providerGroups.length, { endpoint: body.providers, prisma: providerGroups.length })
  check('vendors matches prisma.company.count', body.vendors === vendors, { endpoint: body.vendors, prisma: vendors })
  check('cooperations.total matches prisma.count', body.cooperations.total === coopTotal, { endpoint: body.cooperations.total, prisma: coopTotal })
  check('cooperations.open matches prisma.count', body.cooperations.open === coopOpen, { endpoint: body.cooperations.open, prisma: coopOpen })
  check('cooperations.tenders matches prisma.count', body.cooperations.tenders === coopTenders, { endpoint: body.cooperations.tenders, prisma: coopTenders })
  check('cooperations.projects matches prisma.count', body.cooperations.projects === coopProjects, { endpoint: body.cooperations.projects, prisma: coopProjects })
  check('cooperations.service matches prisma.count', body.cooperations.service === coopServiceBundles, { endpoint: body.cooperations.service, prisma: coopServiceBundles })
  check('cooperations.network matches prisma.count', body.cooperations.network === coopNetwork, { endpoint: body.cooperations.network, prisma: coopNetwork })
  check('cooperations.totalBudgetSats matches prisma.aggregate', body.cooperations.totalBudgetSats === (budgetAll._sum.budgetSats ?? 0), { endpoint: body.cooperations.totalBudgetSats, prisma: budgetAll._sum.budgetSats })
  check('cooperations.openBudgetSats matches prisma.aggregate', body.cooperations.openBudgetSats === (budgetOpen._sum.budgetSats ?? 0), { endpoint: body.cooperations.openBudgetSats, prisma: budgetOpen._sum.budgetSats })
  check('remoteOffers matches prisma.count', body.remoteOffers === remoteOffers, { endpoint: body.remoteOffers, prisma: remoteOffers })

  // 4. Internal invariants
  check('tenders + projects + service == open cooperations', body.cooperations.tenders + body.cooperations.projects + body.cooperations.service === coopOpen, {
    tenders: body.cooperations.tenders, projects: body.cooperations.projects, service: body.cooperations.service, open: coopOpen,
  })
  check('service >= 0', body.cooperations.service >= 0, { service: body.cooperations.service })
  check('open <= total cooperations', body.cooperations.open <= body.cooperations.total, { open: body.cooperations.open, total: body.cooperations.total })
  check('openBudgetSats <= totalBudgetSats', body.cooperations.openBudgetSats <= body.cooperations.totalBudgetSats, {
    open: body.cooperations.openBudgetSats, total: body.cooperations.totalBudgetSats,
  })
  check('remoteOffers <= offers.total (REMOTE ⊆ all public)', body.remoteOffers <= body.offers.total + coopNetwork, {
    remote: body.remoteOffers, marketplace: body.offers.total, network: coopNetwork,
  })

  // 5. Type split is exhaustive for the marketplace lens (PRODUCT + SERVICE + AGENT_SETUP + ITEM = total)
  const itemCount = await prisma.offer.count({ where: { ...MARKETPLACE_OFFER_WHERE, offerType: 'ITEM' } })
  check('products + services + agents + ITEM == marketplace total', body.offers.products + body.offers.services + body.offers.agents + itemCount === body.offers.total, {
    products: body.offers.products, services: body.offers.services, agents: body.offers.agents, item: itemCount, total: body.offers.total,
  })

  console.log(`\nSummary: ${pass} PASS / ${fail} FAIL`)
  await prisma.$disconnect()
  if (fail > 0) process.exit(1)
}

main().catch((err) => { console.error('Smoke crashed:', err); process.exit(2) })
