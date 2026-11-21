import { Router, type Request, type Response } from 'express'
import { type PrismaClient, Prisma, CatalogType } from '@prisma/client'
import { invalidateListCache } from '../middleware/cache.js'
import { writeWithOutbox } from '../lib/outbox.js'
import { rejectEscrowIfDisabled } from '../lib/escrow-gate.js'
import { resolveCategoryCode, DEFAULT_OFFER_CATEGORY_CODE } from '../lib/category-code.js'
import { hasSellerPaymentMethodConfigured } from '../services/sellerPaymentResolver.js'

// ADR-340 D6: `routes/catalog.ts` is the single router for both PRODUCT and
// AGENT_SETUP catalogs. Mounted behind `requireAuth(prisma)` in `index.ts`,
// so `req.authPubkey` is guaranteed on every request. Each write enforces
// per-type ownership: PRODUCT → caller's `Company`; AGENT_SETUP → caller
// owns the Catalog row directly. The public `?companyId=` / `?ownerPubkey=`
// reads stay open so non-owners can browse.

const MAX_NAME_LENGTH = 60
const MAX_CATALOGS_PER_OWNER = 50
const MAX_CATALOGS_PER_COMPANY = 50

const CATALOG_SELECT_BASE = {
  id: true,
  companyId: true,
  ownerPubkey: true,
  catalogType: true,
  standardCategoryId: true,
  name: true,
  description: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  standardCategory: { select: { id: true, slug: true, name: true } },
  company: { select: { id: true, name: true, logoUrl: true, ownerPubkey: true } },
  agentMembers: { select: { agentProfileId: true, addedAt: true } },
} as const

type AuthedRequest = Request & { authPubkey?: string; authToken?: string }

function callerPubkey(req: Request): string | null {
  const pk = (req as AuthedRequest).authPubkey
  return typeof pk === 'string' && pk.length > 0 ? pk : null
}

/**
 * Resolves the Product catalog the caller can write to for a given `companyId`.
 * Returns the Company row on success, or an error string the caller should
 * surface via `res.status(...).json(...)`.
 */
async function assertCompanyOwnership(
  prisma: PrismaClient,
  callerPubkey: string,
  companyId: string,
): Promise<{ ok: true; company: { id: string; ownerPubkey: string } } | { ok: false; status: number; error: string }> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, ownerPubkey: true } })
  if (!company) return { ok: false, status: 404, error: 'Company not found' }
  if (company.ownerPubkey !== callerPubkey) return { ok: false, status: 403, error: 'FORBIDDEN' }
  return { ok: true, company }
}

/**
 * Loads a catalog + asserts ownership. The caller is "owner" iff:
 *  - catalogType=PRODUCT AND catalog.company.ownerPubkey === callerPubkey
 *  - catalogType=AGENT_SETUP AND catalog.ownerPubkey === callerPubkey
 */
async function assertCatalogOwnership(
  prisma: PrismaClient,
  callerPubkey: string,
  catalogId: string,
): Promise<{ ok: true; catalog: { id: string; catalogType: CatalogType; companyId: string | null; ownerPubkey: string | null; name: string; company: { ownerPubkey: string } | null } } | { ok: false; status: number; error: string; code?: string }> {
  const catalog = await prisma.catalog.findUnique({
    where: { id: catalogId },
    select: { id: true, catalogType: true, companyId: true, ownerPubkey: true, name: true, company: { select: { ownerPubkey: true } } },
  })
  if (!catalog) return { ok: false, status: 404, error: 'NOT_FOUND' }
  if (catalog.catalogType === 'PRODUCT') {
    if (!catalog.company || catalog.company.ownerPubkey !== callerPubkey) {
      return { ok: false, status: 403, error: 'FORBIDDEN' }
    }
  } else {
    if (catalog.ownerPubkey !== callerPubkey) {
      return { ok: false, status: 403, error: 'FORBIDDEN' }
    }
  }
  return { ok: true, catalog }
}

// ADR-395: a product's owner is its Company. `catalog.company` is only a
// fallback for rows written before the companyId backfill.
const PRODUCT_OWNER_SELECT = {
  companyId: true,
  company: { select: { ownerPubkey: true } },
  catalog: { select: { companyId: true, company: { select: { ownerPubkey: true } } } },
} as const

type ProductOwnerRow = {
  companyId: string | null
  company: { ownerPubkey: string } | null
  catalog: { companyId: string | null; company: { ownerPubkey: string } | null } | null
}

function productOwnerPubkey(p: ProductOwnerRow): string | undefined {
  return p.company?.ownerPubkey ?? p.catalog?.company?.ownerPubkey
}

function productCompanyId(p: ProductOwnerRow): string | null {
  return p.companyId ?? p.catalog?.companyId ?? null
}

export function createCatalogRouter(prisma: PrismaClient) {
  const router = Router()

  // GET / — public read by companyId / ownerPubkey, or `mine=1` for caller-owned.
  // The mine=1 branch returns both PRODUCT (via Company ownership) and AGENT_SETUP
  // (via direct ownerPubkey) catalogs — used by CatalogsTab as the single fetch.
  router.get('/', async (req: Request, res: Response) => {
    try {
      const companyIdQuery = typeof req.query['companyId'] === 'string' ? req.query['companyId'] : undefined
      const ownerPubkeyQuery = typeof req.query['ownerPubkey'] === 'string' ? req.query['ownerPubkey'] : undefined
      const mine = req.query['mine']
      const caller = callerPubkey(req)

      let where: Prisma.CatalogWhereInput = {}
      let includeCompany = true
      if (mine === '1' || mine === 'true') {
        if (!caller) return res.status(401).json({ error: 'UNAUTHORIZED' })
        // Caller's Company ids (for PRODUCT catalogs) ∪ caller's own ownerPubkey (AGENT_SETUP).
        const myCompanies = await prisma.company.findMany({
          where: { ownerPubkey: caller },
          select: { id: true },
        })
        const companyIds = myCompanies.map(c => c.id)
        where = {
          OR: [
            { ownerPubkey: caller },
            ...(companyIds.length > 0 ? [{ companyId: { in: companyIds } }] : []),
          ],
        }
        includeCompany = false // company is always loaded via include, but caller wants their own — keep
      } else if (companyIdQuery) {
        where = { companyId: companyIdQuery, catalogType: 'PRODUCT' }
      } else if (ownerPubkeyQuery) {
        // ownerPubkey public filter → AGENT_SETUP catalogs only (PRODUCT ownership
        // runs through Company, not User; the companyId filter handles that path).
        where = { ownerPubkey: ownerPubkeyQuery, catalogType: 'AGENT_SETUP' }
      } else {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'pass ?companyId, ?ownerPubkey, or ?mine=1' })
      }

      const catalogs = await prisma.catalog.findMany({
        where,
        select: { ...CATALOG_SELECT_BASE, products: { select: { id: true } } },
        orderBy: { createdAt: 'desc' },
      })

      return res.json({ catalogs })
    } catch (error) {
      console.error('Failed to fetch catalogs:', error)
      return res.status(500).json({ error: 'Failed to fetch catalogs' })
    }
  })

  // GET /:id — public read (single catalog). Membership is only projected
  // for AGENT_SETUP catalogs (PRODUCT catalogs have no members).
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const id = req.params['id'] as string
      const catalog = await prisma.catalog.findUnique({
        where: { id },
        select: {
          ...CATALOG_SELECT_BASE,
          products: {
            orderBy: { createdAt: 'desc' },
            select: { id: true, name: true, priceSats: true, isAvailable: true, images: true, standardCategoryId: true, createdAt: true },
          },
        },
      })
      if (!catalog) return res.status(404).json({ error: 'Catalog not found' })
      return res.json({ catalog })
    } catch (error) {
      console.error('Failed to fetch catalog:', error)
      return res.status(500).json({ error: 'Failed to fetch catalog' })
    }
  })

  // POST / — type-aware create. PRODUCT → companyId required + caller-owned.
  // AGENT_SETUP → ownerPubkey derived from session.
  router.post('/', async (req: Request, res: Response) => {
    const caller = callerPubkey(req)
    if (!caller) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const { companyId, name, description, standardCategoryId, type } = req.body ?? {}

    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'name is required' })
    }
    if (name.trim().length > MAX_NAME_LENGTH) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: `name must not exceed ${MAX_NAME_LENGTH} characters` })
    }

    const catalogType: CatalogType = type === 'AGENT_SETUP' ? 'AGENT_SETUP' : 'PRODUCT'

    try {
      if (catalogType === 'PRODUCT') {
        if (!companyId || typeof companyId !== 'string') {
          return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'companyId is required for PRODUCT catalogs' })
        }
        const ownership = await assertCompanyOwnership(prisma, caller, companyId)
        if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error })

        const count = await prisma.catalog.count({ where: { companyId, catalogType: 'PRODUCT' } })
        if (count >= MAX_CATALOGS_PER_COMPANY) {
          return res.status(400).json({ error: 'LIMIT_REACHED', message: `cannot exceed ${MAX_CATALOGS_PER_COMPANY} catalogs per company` })
        }
      } else {
        const count = await prisma.catalog.count({ where: { ownerPubkey: caller, catalogType: 'AGENT_SETUP' } })
        if (count >= MAX_CATALOGS_PER_OWNER) {
          return res.status(400).json({ error: 'LIMIT_REACHED', message: `cannot exceed ${MAX_CATALOGS_PER_OWNER} agent catalogs` })
        }
      }

      if (standardCategoryId) {
        const category = await prisma.standardCategory.findUnique({ where: { id: standardCategoryId } })
        if (!category) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'standardCategoryId does not exist' })
      }

      const catalog = await prisma.catalog.create({
        data: {
          companyId: catalogType === 'PRODUCT' ? companyId : null,
          ownerPubkey: catalogType === 'AGENT_SETUP' ? caller : null,
          catalogType,
          name: name.trim(),
          description: typeof description === 'string' ? description : null,
          standardCategoryId: standardCategoryId || null,
        },
        select: CATALOG_SELECT_BASE,
      })

      return res.status(201).json({ catalog })
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === 'P2002') {
        return res.status(400).json({ error: 'DUPLICATE_NAME', message: 'A catalog with this name already exists in the same scope' })
      }
      console.error('[catalog] POST / error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // PATCH /:id — rename / re-theme / toggle isActive (PRODUCT only).
  // Type is immutable post-create (D2).
  router.patch('/:id', async (req: Request, res: Response) => {
    const caller = callerPubkey(req)
    if (!caller) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const id = req.params.id as string
    const { name, description, standardCategoryId, isActive } = req.body ?? {}

    try {
      const ownership = await assertCatalogOwnership(prisma, caller, id)
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error })

      if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'name must be a non-empty string' })
      }
      if (isActive !== undefined && ownership.catalog.catalogType !== 'PRODUCT') {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'isActive is only editable on PRODUCT catalogs' })
      }
      if (standardCategoryId) {
        const category = await prisma.standardCategory.findUnique({ where: { id: standardCategoryId } })
        if (!category) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'standardCategoryId does not exist' })
      }

      const catalog = await prisma.catalog.update({
        where: { id },
        data: {
          ...(name !== undefined && { name: name.trim().slice(0, MAX_NAME_LENGTH) }),
          ...(description !== undefined && { description: description || null }),
          ...(standardCategoryId !== undefined && { standardCategoryId: standardCategoryId || null }),
          ...(isActive !== undefined && { isActive: Boolean(isActive) }),
        },
        select: CATALOG_SELECT_BASE,
      })
      return res.json({ catalog })
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code === 'P2002') return res.status(400).json({ error: 'DUPLICATE_NAME', message: 'A catalog with this name already exists in the same scope' })
      console.error('[catalog] PATCH /:id error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // DELETE /:id — owner-only. Cascade handles products (PRODUCT) and
  // memberships (AGENT_SETUP).
  router.delete('/:id', async (req: Request, res: Response) => {
    const caller = callerPubkey(req)
    if (!caller) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const id = req.params.id as string
    try {
      const ownership = await assertCatalogOwnership(prisma, caller, id)
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error })

      await prisma.catalog.delete({ where: { id } })
      return res.json({ success: true })
    } catch (err) {
      console.error('[catalog] DELETE /:id error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // PUT /:id/agents — AGENT_SETUP catalog membership toggle (ADR-339 D5,
  // promoted to the unified router). Idempotent on both branches.
  router.put('/:id/agents', async (req: Request, res: Response) => {
    const caller = callerPubkey(req)
    if (!caller) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const id = req.params.id as string
    const { agentProfileId, member } = req.body ?? {}

    if (typeof agentProfileId !== 'string' || !agentProfileId) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'agentProfileId is required' })
    }
    if (typeof member !== 'boolean') {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'member must be a boolean' })
    }

    try {
      const ownership = await assertCatalogOwnership(prisma, caller, id)
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error })
      if (ownership.catalog.catalogType !== 'AGENT_SETUP') {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'membership endpoints require an AGENT_SETUP catalog' })
      }

      // Profile-ownership validation (ADR-339 D5): only own profiles may be
      // cataloged — a catalog is the owner's private organization surface.
      const profile = await prisma.agentProfile.findUnique({ where: { id: agentProfileId }, select: { ownerPubkey: true, deletedAt: true } })
      if (!profile) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'agentProfileId does not exist' })
      if (profile.deletedAt) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'agentProfileId references a deleted agent setup' })
      if (profile.ownerPubkey !== caller) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'agentProfileId must reference one of your own agent profiles' })
      }

      if (member) {
        await prisma.catalogAgentMember.upsert({
          where: { catalogId_agentProfileId: { catalogId: id, agentProfileId } },
          create: { catalogId: id, agentProfileId },
          update: {},
        })
      } else {
        await prisma.catalogAgentMember.deleteMany({ where: { catalogId: id, agentProfileId } })
      }
      return res.json({ success: true, agentProfileId, member })
    } catch (err) {
      console.error('[catalog] PUT /:id/agents error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // PRODUCT-only sub-routes (products live under a PRODUCT catalog).
  // ─────────────────────────────────────────────────────────────────────────

  // GET /company/:companyId/products — company-wide product list (FU-541 fix:
  // the picker needs every product the caller can move across their catalogs).
  router.get('/company/:companyId/products', async (req: Request, res: Response) => {
    const caller = callerPubkey(req)
    if (!caller) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const companyId = req.params['companyId'] as string
    try {
      const ownership = await assertCompanyOwnership(prisma, caller, companyId)
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error })

      // ADR-395: includes products without a catalog (catalog = null).
      const products = await prisma.product.findMany({
        where: { OR: [{ companyId }, { catalog: { companyId, catalogType: 'PRODUCT' } }] },
        select: {
          id: true, name: true, priceSats: true, isAvailable: true, images: true, catalogId: true, companyId: true,
          createdAt: true, gammaTags: true,
          standardCategory: { select: { id: true, name: true, slug: true, offerType: true } },
          catalog: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
      return res.json({ products })
    } catch (err) {
      console.error('[catalog] GET /company/:id/products error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // GET /:catalogId/products — products in this catalog. Public read; ownership
  // is irrelevant for browsing, only writes need it.
  router.get('/:catalogId/products', async (req: Request, res: Response) => {
    try {
      const catalogId = req.params['catalogId'] as string
      const catalog = await prisma.catalog.findUnique({ where: { id: catalogId }, select: { catalogType: true } })
      if (!catalog) return res.status(404).json({ error: 'Catalog not found' })
      if (catalog.catalogType !== 'PRODUCT') {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'products are only attached to PRODUCT catalogs' })
      }
      const products = await prisma.product.findMany({
        where: { catalogId },
        include: { standardCategory: true },
        orderBy: { createdAt: 'desc' },
      })
      return res.json({ products })
    } catch (error) {
      console.error('Failed to fetch products:', error)
      return res.status(500).json({ error: 'Failed to fetch products' })
    }
  })

  // POST /:catalogId/products — create product inside a PRODUCT catalog
  // (ownership check + seller-payment gate for ACTIVE direct-pay).
  router.post('/:catalogId/products', async (req: Request, res: Response) => {
    const caller = callerPubkey(req)
    if (!caller) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const catalogId = req.params['catalogId'] as string
    const {
      standardCategoryId, name, description, priceSats,
      sku, stock, isAvailable = true, images, useEscrow, phase2WindowHours, status,
    } = req.body ?? {}

    if (!standardCategoryId || !name || priceSats === undefined) {
      return res.status(400).json({ error: 'Missing required fields: standardCategoryId, name, priceSats' })
    }
    if (rejectEscrowIfDisabled(req, res)) return

    try {
      const ownership = await assertCatalogOwnership(prisma, caller, catalogId)
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error })
      if (ownership.catalog.catalogType !== 'PRODUCT') {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'products may only be attached to PRODUCT catalogs' })
      }
      // Re-load with company for the offer-link fields.
      const catalog = await prisma.catalog.findUnique({ where: { id: catalogId }, include: { company: true } })
      if (!catalog || !catalog.company) return res.status(404).json({ error: 'Catalog not found' })

      const standardCategory = await prisma.standardCategory.findUnique({ where: { id: standardCategoryId } })
      if (!standardCategory) return res.status(400).json({ error: 'Invalid standardCategoryId' })

      const offerType = standardCategory.offerType === 'SERVICE' ? 'SERVICE' : 'PRODUCT'
      const offerStatus: 'ACTIVE' | 'DRAFT' =
        status === 'ACTIVE' || status === 'DRAFT' ? status : isAvailable ? 'ACTIVE' : 'DRAFT'

      if (offerStatus === 'ACTIVE' && !(useEscrow ?? false)) {
        const configured = await hasSellerPaymentMethodConfigured(prisma, catalog.company.ownerPubkey)
        if (!configured) {
          return res.status(422).json({
            error: 'SELLER_PAYMENT_NOT_CONFIGURED',
            message: 'Please add a Lightning address or an NWC wallet in Settings before publishing an offer.',
          })
        }
      }

      const product = await prisma.$transaction(async (tx) =>
        writeWithOutbox(
          tx,
          'offer',
          '',
          'upsert',
          { source: 'catalog-product', catalogId },
          (offerId) => tx.product.create({
            data: {
              catalogId,
              companyId: catalog.companyId,
              standardCategoryId,
              name,
              description,
              priceSats,
              sku,
              stock,
              isAvailable,
              images: Array.isArray(images) ? JSON.stringify(images) : null,
              offers: {
                create: {
                  id: offerId,
                  title: name,
                  description: description || null,
                  priceSats,
                  categoryCode: standardCategory.slug,
                  category: standardCategory.name,
                  status: offerStatus,
                  publishedAt: offerStatus === 'ACTIVE' ? new Date() : undefined,
                  offerType,
                  ticketType: offerType === 'SERVICE' ? 'MILESTONE' : 'SMART_ORDER',
                  creatorPubkey: catalog.company!.ownerPubkey,
                  companyId: catalog.companyId,
                  images: Array.isArray(images) ? (images as Prisma.InputJsonValue) : Prisma.JsonNull,
                  useEscrow: useEscrow ?? false,
                  phase2WindowHours:
                    typeof phase2WindowHours === 'number' && Number.isInteger(phase2WindowHours) && phase2WindowHours >= 1 && phase2WindowHours <= 168
                      ? phase2WindowHours
                      : 24,
                }
              }
            },
            include: { offers: true, standardCategory: true },
          }),
        )
      )

      await invalidateListCache('offers')
      return res.json({ success: true, product })
    } catch (error) {
      console.error('Failed to create product:', error)
      if (!res.headersSent) return res.status(500).json({ error: 'Failed to create product' })
    }
  })

  // POST /:catalogId/products/assign — move a product into this catalog
  // (FU-541 fix). The previous schema required a catalog on the product; the
  // assign endpoint is therefore a reassignment, not a creation. Ownership
  // is enforced by validating both the source (current catalog) and the
  // target catalog are owned by the caller.
  router.post('/:catalogId/products/assign', async (req: Request, res: Response) => {
    const caller = callerPubkey(req)
    if (!caller) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const catalogId = req.params['catalogId'] as string
    const { productId } = req.body ?? {}
    if (typeof productId !== 'string' || !productId) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'productId is required' })
    }

    try {
      const ownership = await assertCatalogOwnership(prisma, caller, catalogId)
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error })
      if (ownership.catalog.catalogType !== 'PRODUCT') {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'products may only be assigned to PRODUCT catalogs' })
      }

      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true, catalogId: true, ...PRODUCT_OWNER_SELECT },
      })
      if (!product) return res.status(404).json({ error: 'Product not found' })
      if (productOwnerPubkey(product) !== caller) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'product must belong to one of your own companies' })
      }
      // ADR-395: a product only moves between catalogs of its own company.
      const ownerCompanyId = productCompanyId(product)
      if (ownerCompanyId && ownership.catalog.companyId !== ownerCompanyId) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'target catalog belongs to a different company' })
      }
      if (product.catalogId === catalogId) {
        return res.json({ success: true, productId, catalogId, unchanged: true })
      }

      const updated = await prisma.product.update({
        where: { id: productId },
        data: { catalogId, companyId: ownerCompanyId ?? ownership.catalog.companyId },
        select: { id: true, catalogId: true, name: true },
      })
      return res.json({ success: true, product: updated })
    } catch (err) {
      console.error('[catalog] POST /:catalogId/products/assign error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // GET /products/:productId — public read.
  router.get('/products/:productId', async (req: Request, res: Response) => {
    try {
      const productId = req.params['productId'] as string
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: { standardCategory: true, catalog: true },
      })
      if (!product) return res.status(404).json({ error: 'Product not found' })
      return res.json({ product })
    } catch (error) {
      console.error('Failed to fetch product:', error)
      return res.status(500).json({ error: 'Failed to fetch product' })
    }
  })

  // PATCH /products/:productId — caller-owned (via product's Company).
  router.patch('/products/:productId', async (req: Request, res: Response) => {
    const caller = callerPubkey(req)
    if (!caller) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const productId = req.params['productId'] as string
    const {
      standardCategoryId, name, description, priceSats,
      sku, stock, isAvailable, images,
    } = req.body ?? {}

    try {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: PRODUCT_OWNER_SELECT,
      })
      if (!product) return res.status(404).json({ error: 'NOT_FOUND' })
      if (productOwnerPubkey(product) !== caller) {
        return res.status(403).json({ error: 'FORBIDDEN' })
      }

      const updateData: Prisma.ProductUpdateInput = {}
      if (standardCategoryId !== undefined) updateData.standardCategory = { connect: { id: standardCategoryId } }
      if (name !== undefined) updateData.name = name
      if (description !== undefined) updateData.description = description
      if (priceSats !== undefined) updateData.priceSats = priceSats
      if (sku !== undefined) updateData.sku = sku
      if (stock !== undefined) updateData.stock = stock
      if (isAvailable !== undefined) updateData.isAvailable = isAvailable
      if (images !== undefined) updateData.images = Array.isArray(images) ? JSON.stringify(images) : null

      const updated = await prisma.product.update({ where: { id: productId }, data: updateData })
      return res.json({ success: true, product: updated })
    } catch (error) {
      console.error('Failed to update product:', error)
      return res.status(500).json({ error: 'Failed to update product' })
    }
  })

  // DELETE /products/:productId — caller-owned. Audit-fix: archive + detach
  // linked Offers first (they carry buyer-facing ticket history). Then delete
  // the product row; the outbox event re-indexes each Offer as ARCHIVED in
  // Meilisearch so the marketplace stops surfacing it.
  router.delete('/products/:productId', async (req: Request, res: Response) => {
    const caller = callerPubkey(req)
    if (!caller) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const productId = req.params['productId'] as string
    try {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: {
          id: true,
          ...PRODUCT_OWNER_SELECT,
          offers: { select: { id: true } },
        },
      })
      if (!product) return res.status(404).json({ error: 'NOT_FOUND' })
      if (productOwnerPubkey(product) !== caller) {
        return res.status(403).json({ error: 'FORBIDDEN' })
      }

      await prisma.$transaction(async (tx) => {
        for (const offerRef of product.offers) {
          await writeWithOutbox(
            tx,
            'offer',
            offerRef.id,
            'upsert',
            { status: 'ARCHIVED', reason: 'product-deleted', productId },
            (id) => tx.offer.update({
              where: { id },
              data: {
                status: 'ARCHIVED',
                productId: null, // detach so the FK doesn't block deletion; tickets preserve buyer history
                publishedAt: null,
              },
            }),
          )
        }
        await tx.product.delete({ where: { id: productId } })
      })

      await invalidateListCache('offers')
      return res.json({ success: true, archivedOffers: product.offers.length })
    } catch (error) {
      console.error('Failed to delete product:', error)
      if (!res.headersSent) return res.status(500).json({ error: 'Failed to delete product' })
    }
  })

  // POST /:catalogId/products/:productId/offers — additional offer for an
  // existing product (caller-owned).
  router.post('/:catalogId/products/:productId/offers', async (req: Request, res: Response) => {
    const caller = callerPubkey(req)
    if (!caller) return res.status(401).json({ error: 'UNAUTHORIZED' })

    const catalogId = req.params['catalogId'] as string
    const productId = req.params['productId'] as string
    const {
      title, description, priceSats, categoryCode, category, ticketType,
      images, location, useEscrow, phase2WindowHours, status,
    } = req.body ?? {}

    if (!title || priceSats === undefined) {
      return res.status(400).json({ error: 'Missing required fields: title, priceSats' })
    }
    if (rejectEscrowIfDisabled(req, res)) return

    try {
      const ownership = await assertCatalogOwnership(prisma, caller, catalogId)
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error })
      if (ownership.catalog.catalogType !== 'PRODUCT') {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'products may only be attached to PRODUCT catalogs' })
      }

      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: { company: PRODUCT_OWNER_SELECT.company, catalog: PRODUCT_OWNER_SELECT.catalog, standardCategory: true },
      })
      if (!product || product.catalogId !== catalogId) return res.status(404).json({ error: 'Product not found' })
      const ownerPubkey = productOwnerPubkey(product)
      if (!ownerPubkey) return res.status(404).json({ error: 'Product not found' })

      // Category consistency: an explicitly provided categoryCode must be a
      // real StandardCategory slug — absent falls back to the product's own
      // (validated at product creation).
      const offerCategoryResolution = await resolveCategoryCode(prisma, categoryCode)
      if (!offerCategoryResolution.ok) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: offerCategoryResolution.message, code: 'INVALID_CATEGORY_CODE' })
      }

      const offerStatus: 'ACTIVE' | 'DRAFT' = status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT'
      if (offerStatus === 'ACTIVE' && !(useEscrow ?? false)) {
        const configured = await hasSellerPaymentMethodConfigured(prisma, ownerPubkey)
        if (!configured) {
          return res.status(422).json({
            error: 'SELLER_PAYMENT_NOT_CONFIGURED',
            message: 'Please add a Lightning address or an NWC wallet in Settings before publishing an offer.',
          })
        }
      }

      const offer = await prisma.$transaction(async (tx) =>
        writeWithOutbox(
          tx,
          'offer',
          '',
          'upsert',
          { source: 'catalog-offer', productId },
          (id) => tx.offer.create({
            data: {
              id,
              title,
              description: description || null,
              priceSats,
              categoryCode: offerCategoryResolution.categoryCode || product.standardCategory?.slug || DEFAULT_OFFER_CATEGORY_CODE,
              category: category || product.standardCategory?.name,
              status: offerStatus,
              publishedAt: offerStatus === 'ACTIVE' ? new Date() : undefined,
              ticketType: ticketType || 'SMART_ORDER',
              offerType: 'PRODUCT',
              creatorPubkey: ownerPubkey,
              companyId: productCompanyId(product),
              productId: product.id,
              images: Array.isArray(images) ? (images as Prisma.InputJsonValue) : Prisma.JsonNull,
              location: location || null,
              useEscrow: useEscrow ?? false,
              phase2WindowHours:
                typeof phase2WindowHours === 'number' && Number.isInteger(phase2WindowHours) && phase2WindowHours >= 1 && phase2WindowHours <= 168
                  ? phase2WindowHours
                  : 24,
            },
            include: { product: true },
          }),
        )
      )

      await invalidateListCache('offers')
      return res.json({ success: true, offer })
    } catch (error) {
      console.error('Failed to create additional offer:', error)
      if (!res.headersSent) return res.status(500).json({ error: 'Failed to create additional offer' })
    }
  })

  return router
}