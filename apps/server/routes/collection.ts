import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
import { nostrService } from '../services/nostr-relay.js'
import { NON_VARIATION_OFFER } from '../lib/offer-filters.js'
import { getOrCreateCompanySigningKey, hasSigningIdentityKey } from '../services/nostr-signing-identity.js'
import { readLnurlpDomain } from '../lib/lnAddressHandle.js'

/**
 * ADR-277 D5/D10/C1: publish (or re-publish) a ProductCollection as Kind 30405 and write the
 * resulting event id back to nostrEventId. Resolves the `a` product refs per the D10 rule —
 * ProductCollectionMember points at a Product, which has a 1:N relation to Offer, so we pick
 * each product's most recently published ACTIVE non-variation offer (excludes ADR-270 variation
 * children, consistent with how they're already filtered out of browse/search). A product with
 * no such offer is silently skipped, not an error — a collection may legitimately reference a
 * product that hasn't published an offer yet.
 */
async function publishAndSyncCollection(prisma: PrismaClient, collectionId: string): Promise<string | null> {
  const collection = await prisma.productCollection.findUnique({
    where: { id: collectionId },
    include: {
      company: { select: { id: true, ownerPubkey: true, name: true, logoUrl: true } },
      products: {
        include: {
          product: {
            include: {
              offers: {
                where: { status: 'ACTIVE', blockedAt: null, AND: [NON_VARIATION_OFFER] }, // ADR-284 D2
                orderBy: { publishedAt: 'desc' },
                take: 1,
                select: { id: true, creatorPubkey: true },
              },
            },
          },
        },
        orderBy: { sortOrder: 'asc' },
      },
      shippingOptions: { include: { shippingOption: { select: { d: true } } } },
    },
  })
  if (!collection) return null

  const productRefs = collection.products
    .map(m => m.product.offers[0])
    .filter((offer): offer is { id: string; creatorPubkey: string } => Boolean(offer))
    .map(offer => ({ pubkey: offer.creatorPubkey, d: offer.id }))

  if (productRefs.length === 0) {
    // NIP-99/Gamma requires a-tags to point at a real 30402 event; publishing an empty
    // collection would be spec-invalid (D10). Wait for at least one member to have an offer.
    console.warn(`[collection] skipping Nostr publish for ${collectionId}: no member product has a resolvable offer yet`)
    return null
  }

  const shippingOptionRefs = collection.shippingOptions.map(link => ({
    pubkey: collection.company.ownerPubkey,
    d: link.shippingOption.d,
  }))

  await nostrService.connect()
  // ADR-412 D2: resolve the company's persistent listing signing key instead of
  // a fresh ephemeral one. Falls back to ephemeral (today's behavior) when
  // at-rest encryption isn't configured (e.g. dev without NWC_SECRET_KEY).
  let signingKey: Uint8Array | undefined
  if (hasSigningIdentityKey()) {
    const identity = await getOrCreateCompanySigningKey(prisma, collection.company.id)
    signingKey = identity.sk
    if (identity.isNew) {
      await nostrService.publishEntityProfile(identity.sk, { name: collection.company.name, picture: collection.company.logoUrl, nip05: `${collection.company.id}@${readLnurlpDomain()}` })
    }
  }
  const event = await nostrService.publishProductCollection({
    id: collection.id,
    d: collection.d,
    title: collection.title,
    summary: collection.summary,
    image: collection.image,
    location: collection.location,
    geohash: collection.geohash,
    productRefs,
    shippingOptionRefs: shippingOptionRefs.length > 0 ? shippingOptionRefs : undefined,
  }, signingKey)

  if (!event) return null
  await prisma.productCollection.update({ where: { id: collectionId }, data: { nostrEventId: event.id } })
  return event.id
}

export function createCollectionRouter(prisma: PrismaClient) {
  const router = Router()

  router.get('/company/:companyId', async (req, res) => {
    try {
      const { companyId } = req.params
      const collections = await prisma.productCollection.findMany({
        where: { companyId, isActive: true },
        include: {
          products: { include: { product: true }, orderBy: { sortOrder: 'asc' } },
          shippingOptions: { include: { shippingOption: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
      res.json({ collections })
    } catch (error) {
      console.error('Failed to fetch collections:', error)
      res.status(500).json({ error: 'Failed to fetch collections' })
    }
  })

  router.get('/by-pubkey/:pubkey', async (req, res) => {
    try {
      const { pubkey } = req.params
      const company = await prisma.company.findUnique({
        where: { ownerPubkey: pubkey },
        select: { id: true },
      })
      if (!company) return res.json({ collections: [] })
      const collections = await prisma.productCollection.findMany({
        where: { companyId: company.id, isActive: true },
        include: {
          products: { include: { product: true }, orderBy: { sortOrder: 'asc' } },
          shippingOptions: { include: { shippingOption: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
      res.json({ collections })
    } catch (error) {
      console.error('Failed to fetch collections by pubkey:', error)
      res.status(500).json({ error: 'Failed to fetch collections' })
    }
  })

  router.get('/:id', async (req, res) => {
    try {
      const collection = await prisma.productCollection.findUnique({
        where: { id: req.params.id },
        include: {
          products: { include: { product: true }, orderBy: { sortOrder: 'asc' } },
          shippingOptions: { include: { shippingOption: true } },
        },
      })
      if (!collection) return res.status(404).json({ error: 'Collection not found' })
      res.json({ collection })
    } catch (error) {
      console.error('Failed to fetch collection:', error)
      res.status(500).json({ error: 'Failed to fetch collection' })
    }
  })

  router.post('/', async (req, res) => {
    try {
      const { companyId, d, title, summary, image, location, geohash, productIds, shippingOptionIds } = req.body

      if (!companyId || !d || !title || !productIds?.length) {
        return res.status(400).json({ error: 'Missing required fields: companyId, d, title, productIds' })
      }

      const collection = await prisma.productCollection.create({
        data: {
          companyId, d, title,
          summary: summary || null,
          image: image || null,
          location: location || null,
          geohash: geohash || null,
          products: {
            create: productIds.map((productId: string, index: number) => ({
              productId,
              sortOrder: index,
            })),
          },
          ...(shippingOptionIds?.length && {
            shippingOptions: {
              create: shippingOptionIds.map((shippingOptionId: string) => ({ shippingOptionId })),
            },
          }),
        },
        include: {
          products: { include: { product: true } },
          shippingOptions: { include: { shippingOption: true } },
        },
      })

      try {
        const nostrEventId = await publishAndSyncCollection(prisma, collection.id)
        if (nostrEventId) collection.nostrEventId = nostrEventId
      } catch (publishError) {
        // Non-fatal: the collection exists in the DB either way; relay publish is best-effort.
        console.error('Failed to publish new collection to Nostr:', publishError)
      }

      res.json({ success: true, collection })
    } catch (error) {
      console.error('Failed to create collection:', error)
      res.status(500).json({ error: 'Failed to create collection' })
    }
  })

  router.patch('/:id', async (req, res) => {
    try {
      const { id } = req.params
      const existing = await prisma.productCollection.findUnique({ where: { id } })
      if (!existing) return res.status(404).json({ error: 'Collection not found' })

      const { title, summary, image, location, geohash, isActive, productIds, shippingOptionIds } = req.body

      const data: Record<string, unknown> = {}
      if (title !== undefined) data.title = title
      if (summary !== undefined) data.summary = summary
      if (image !== undefined) data.image = image
      if (location !== undefined) data.location = location
      if (geohash !== undefined) data.geohash = geohash
      if (isActive !== undefined) data.isActive = isActive

      if (productIds !== undefined) {
        await prisma.productCollectionMember.deleteMany({ where: { collectionId: id } })
        data.products = {
          create: productIds.map((productId: string, index: number) => ({
            productId,
            sortOrder: index,
          })),
        }
      }

      if (shippingOptionIds !== undefined) {
        await prisma.collectionShippingOption.deleteMany({ where: { collectionId: id } })
        if (shippingOptionIds.length > 0) {
          data.shippingOptions = {
            create: shippingOptionIds.map((shippingOptionId: string) => ({ shippingOptionId })),
          }
        }
      }

      const collection = await prisma.productCollection.update({
        where: { id },
        data,
        include: {
          products: { include: { product: true }, orderBy: { sortOrder: 'asc' } },
          shippingOptions: { include: { shippingOption: true } },
        },
      })

      try {
        // ADR-277 C3: NIP-09 delete on deactivate, republish otherwise (content edit or
        // membership change) so the on-relay object graph stays in sync.
        const justDeactivated = existing.isActive && isActive === false
        if (justDeactivated) {
          if (existing.nostrEventId) {
            const deletionKey = hasSigningIdentityKey()
              ? (await getOrCreateCompanySigningKey(prisma, existing.companyId)).sk
              : undefined
            await nostrService.publishDeletion(existing.nostrEventId, 'Collection deactivated', deletionKey)
          }
        } else {
          const nostrEventId = await publishAndSyncCollection(prisma, collection.id)
          if (nostrEventId) collection.nostrEventId = nostrEventId
        }
      } catch (publishError) {
        console.error('Failed to sync collection to Nostr:', publishError)
      }

      res.json({ success: true, collection })
    } catch (error) {
      console.error('Failed to update collection:', error)
      res.status(500).json({ error: 'Failed to update collection' })
    }
  })

  router.delete('/:id', async (req, res) => {
    try {
      const existing = await prisma.productCollection.findUnique({ where: { id: req.params.id }, select: { nostrEventId: true, companyId: true } })
      if (existing?.nostrEventId) {
        try {
          const deletionKey = hasSigningIdentityKey()
            ? (await getOrCreateCompanySigningKey(prisma, existing.companyId)).sk
            : undefined
          await nostrService.publishDeletion(existing.nostrEventId, 'Collection deleted', deletionKey)
        } catch (publishError) {
          console.error('Failed to publish collection deletion to Nostr:', publishError)
        }
      }
      await prisma.productCollection.delete({ where: { id: req.params.id } })
      res.json({ success: true })
    } catch (error) {
      console.error('Failed to delete collection:', error)
      res.status(500).json({ error: 'Failed to delete collection' })
    }
  })

  return router
}
