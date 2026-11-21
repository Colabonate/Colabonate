// ADR-395 live smoke: company products with an OPTIONAL catalog, over real
// HTTP against a throwaway server instance —
//   1. PRODUCT offer with createProduct + no catalog → Product row under the
//      company (catalogId null), offer linked + company-branded. DRAFT works.
//   2. Same with an own catalog → Product lands in that catalog.
//   3. Foreign catalog → 400; createProduct without a company → 400
//      COMPANY_REQUIRED; catalogId without createProduct/productId → 400.
//   4. Listing for an existing product: own productId → linked + companyId
//      derived; a stranger's productId → 400 (previously accepted unchecked).
//   5. GET /api/catalog/company/:id/products includes the catalog-less
//      product (with createdAt + standardCategory for the Products tab).
//   6. Assign the catalog-less product to a catalog; a stranger cannot.
// Run (spin a throwaway server first — the :4001 dev instance does not hot-reload):
//   APP_PORT=4098 npx tsx apps/server/index.ts
//   BASE_URL=http://localhost:4098 DATABASE_URL=<from .env> npx tsx apps/server/scripts/adr395-company-products-smoke.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4098'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, detail ?? '') }
}

async function makeUser() {
  const pubkey = randomBytes(32).toString('hex')
  const token = randomBytes(32).toString('hex')
  await prisma.user.create({ data: { pubkey, identityLevel: 2 } })
  await prisma.session.create({
    data: { pubkey, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 3600_000) },
  })
  return { pubkey, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }
}

async function main() {
  const category = await prisma.standardCategory.findFirst({ where: { level: 2, slug: { startsWith: 'goods/' } }, select: { id: true, slug: true } })
    ?? await prisma.standardCategory.findFirst({ select: { id: true, slug: true } })
  if (!category) throw new Error('No StandardCategory rows — seed categories first')

  const owner = await makeUser()
  const stranger = await makeUser()
  const noCompany = await makeUser()
  const company = await prisma.company.create({ data: { ownerPubkey: owner.pubkey, name: `adr395-${owner.pubkey.slice(0, 6)}`, isActive: true } })
  const strangerCompany = await prisma.company.create({ data: { ownerPubkey: stranger.pubkey, name: `adr395-s-${stranger.pubkey.slice(0, 6)}`, isActive: true } })
  const catalog = await prisma.catalog.create({ data: { companyId: company.id, name: 'ADR-395 Catalog' } })
  const strangerCatalog = await prisma.catalog.create({ data: { companyId: strangerCompany.id, name: 'ADR-395 Stranger Catalog' } })
  const strangerProduct = await prisma.product.create({
    data: { companyId: strangerCompany.id, catalogId: strangerCatalog.id, name: 'Stranger product', priceSats: 10 },
  })

  const call = (headers: Record<string, string>, path: string, method = 'GET', body?: unknown) =>
    fetch(`${BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })

  const base = {
    description: 'ADR-395 smoke', priceSats: 1500, stock: 7, offerType: 'PRODUCT', status: 'DRAFT',
    categoryCode: category.slug, country: 'DE', city: 'Berlin', gammaTags: ['Smoke Test'],
    images: ['https://picsum.photos/seed/adr395/600/400'],
  }

  try {
    // ── 1: new product, no catalog ──────────────────────────────────────
    let r = await call(owner.headers, '/api/offers', 'POST', { ...base, title: 'Catalog-less product', createProduct: true })
    let data = await r.json()
    check('1 new product without catalog -> 200', r.status === 200, { status: r.status, data })
    const offer1 = await prisma.offer.findUnique({ where: { id: data.offer?.id ?? '' }, include: { product: true } })
    check('1 offer linked to a product', !!offer1?.productId, offer1)
    check('1 product catalogId is null', offer1?.product?.catalogId === null, offer1?.product)
    check('1 product companyId = own company', offer1?.product?.companyId === company.id, offer1?.product)
    check('1 offer companyId derived from own company', offer1?.companyId === company.id, offer1?.companyId)
    check('1 product carries name/price/stock/category', offer1?.product?.name === 'Catalog-less product'
      && offer1?.product?.priceSats === 1500 && offer1?.product?.stock === 7
      && offer1?.product?.standardCategoryId === category.id, offer1?.product)
    check('1 offer keeps storefront fields (country/city/tags)', offer1?.country === 'DE' && offer1?.city === 'Berlin'
      && (offer1?.gammaTags ?? []).includes('smoke-test'), { country: offer1?.country, city: offer1?.city, tags: offer1?.gammaTags })
    check('1 DRAFT status kept', offer1?.status === 'DRAFT', offer1?.status)

    // ── 2: new product in own catalog ───────────────────────────────────
    r = await call(owner.headers, '/api/offers', 'POST', { ...base, title: 'Cataloged product', createProduct: true, catalogId: catalog.id, companyId: company.id })
    data = await r.json()
    check('2 new product with own catalog -> 200', r.status === 200, { status: r.status, data })
    const offer2 = await prisma.offer.findUnique({ where: { id: data.offer?.id ?? '' }, include: { product: true } })
    check('2 product sits in the chosen catalog', offer2?.product?.catalogId === catalog.id && offer2?.product?.companyId === company.id, offer2?.product)

    // ── 3: rejections ───────────────────────────────────────────────────
    r = await call(owner.headers, '/api/offers', 'POST', { ...base, title: 'x', createProduct: true, catalogId: strangerCatalog.id })
    check('3 foreign catalog -> 400', r.status === 400, { status: r.status })
    r = await call(noCompany.headers, '/api/offers', 'POST', { ...base, title: 'x', createProduct: true })
    data = await r.json()
    check('3 no company -> 400 COMPANY_REQUIRED', r.status === 400 && data.error === 'COMPANY_REQUIRED', { status: r.status, data })
    r = await call(owner.headers, '/api/offers', 'POST', { ...base, title: 'x', catalogId: catalog.id })
    check('3 catalogId without createProduct -> 400', r.status === 400, { status: r.status })
    r = await call(owner.headers, '/api/offers', 'POST', { ...base, title: 'x', offerType: 'SERVICE', createProduct: true })
    check('3 createProduct on SERVICE -> 400', r.status === 400, { status: r.status })

    // ── 4: listing for an existing product ──────────────────────────────
    r = await call(owner.headers, '/api/offers', 'POST', { ...base, title: 'Second listing', productId: offer2!.productId })
    data = await r.json()
    check('4 own existing product -> 200', r.status === 200, { status: r.status, data })
    const offer4 = await prisma.offer.findUnique({ where: { id: data.offer?.id ?? '' } })
    check('4 listing linked to the existing product', offer4?.productId === offer2!.productId, offer4?.productId)
    check('4 companyId derived from the product', offer4?.companyId === company.id, offer4?.companyId)
    const productCount = await prisma.product.count({ where: { companyId: company.id } })
    check('4 no extra product row created', productCount === 2, productCount)
    r = await call(owner.headers, '/api/offers', 'POST', { ...base, title: 'hijack', productId: strangerProduct.id })
    check("4 stranger's productId -> 400", r.status === 400, { status: r.status })

    // ── 5: Products tab source ──────────────────────────────────────────
    r = await call(owner.headers, `/api/catalog/company/${company.id}/products`)
    data = await r.json()
    const listed = (data.products ?? []) as Array<{ id: string; catalogId: string | null; createdAt?: string; standardCategory?: { slug: string } | null }>
    const catalogLess = listed.find(p => p.id === offer1!.productId)
    check('5 company products include the catalog-less product', !!catalogLess && catalogLess.catalogId === null, listed)
    check('5 list rows carry createdAt + standardCategory', !!catalogLess?.createdAt && catalogLess?.standardCategory?.slug === category.slug, catalogLess)
    check('5 list has both products', listed.length === 2, listed.length)

    // ── 6: assign the catalog-less product later ────────────────────────
    r = await call(stranger.headers, `/api/catalog/${strangerCatalog.id}/products/assign`, 'POST', { productId: offer1!.productId })
    check('6 stranger cannot assign my product -> 403', r.status === 403, { status: r.status })
    r = await call(owner.headers, `/api/catalog/${catalog.id}/products/assign`, 'POST', { productId: offer1!.productId })
    check('6 owner assigns catalog -> 200', r.status === 200, { status: r.status })
    const assigned = await prisma.product.findUnique({ where: { id: offer1!.productId! } })
    check('6 product now in the catalog', assigned?.catalogId === catalog.id && assigned?.companyId === company.id, assigned)
  } finally {
    const pubkeys = [owner.pubkey, stranger.pubkey, noCompany.pubkey]
    const offerIds = (await prisma.offer.findMany({ where: { creatorPubkey: { in: pubkeys } }, select: { id: true } })).map(o => o.id)
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: offerIds } } })
    await prisma.offer.deleteMany({ where: { id: { in: offerIds } } })
    await prisma.product.deleteMany({ where: { companyId: { in: [company.id, strangerCompany.id] } } })
    await prisma.catalog.deleteMany({ where: { companyId: { in: [company.id, strangerCompany.id] } } })
    await prisma.company.deleteMany({ where: { id: { in: [company.id, strangerCompany.id] } } })
    await prisma.session.deleteMany({ where: { pubkey: { in: pubkeys } } })
    await prisma.user.deleteMany({ where: { pubkey: { in: pubkeys } } })
    await prisma.$disconnect()
  }

  console.log(`\nADR-395 smoke: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
