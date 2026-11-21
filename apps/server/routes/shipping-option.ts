import { Router } from 'express'
import { PrismaClient, ShippingServiceType } from '@prisma/client'
import { nostrService } from '../services/nostr-relay.js'
import { SHIPPING_SERVICE_TYPES, DURATION_UNITS, type ShippingServiceType as GammaShippingServiceType, type DurationUnit } from '@col/nostr-schema'
import { getOrCreateCompanySigningKey, hasSigningIdentityKey } from '../services/nostr-signing-identity.js'
import { readLnurlpDomain } from '../lib/lnAddressHandle.js'

function asGammaService(v: string): GammaShippingServiceType {
  const lower = v.toLowerCase()
  return (SHIPPING_SERVICE_TYPES as readonly string[]).includes(lower) ? (lower as GammaShippingServiceType) : 'standard'
}

function asDurationUnit(v: string | null): DurationUnit | undefined {
  return v && (DURATION_UNITS as readonly string[]).includes(v) ? (v as DurationUnit) : undefined
}

/** ADR-277 D5/C2: publish (or re-publish) a ShippingOption as Kind 30406, write nostrEventId back. */
async function publishAndSyncShippingOption(prisma: PrismaClient, id: string): Promise<string | null> {
  const option = await prisma.shippingOption.findUnique({ where: { id }, include: { company: { select: { id: true, name: true, logoUrl: true } } } })
  if (!option) return null

  await nostrService.connect()
  // ADR-412 D2: persistent per-company signing key (see nostr-relay.ts publishOffer).
  let signingKey: Uint8Array | undefined
  if (hasSigningIdentityKey()) {
    const identity = await getOrCreateCompanySigningKey(prisma, option.company.id)
    signingKey = identity.sk
    if (identity.isNew) {
      await nostrService.publishEntityProfile(identity.sk, { name: option.company.name, picture: option.company.logoUrl, nip05: `${option.company.id}@${readLnurlpDomain()}` })
    }
  }
  const event = await nostrService.publishShippingOption({
    id: option.id,
    d: option.d,
    title: option.title,
    baseCost: option.baseCost,
    currency: option.currency,
    countries: option.countries.split(',').map(c => c.trim()).filter(Boolean),
    service: asGammaService(option.service),
    carrier: option.carrier ?? undefined,
    regions: option.regions ? option.regions.split(',').map(r => r.trim()).filter(Boolean) : undefined,
    durationMin: option.durationMin != null ? String(option.durationMin) : undefined,
    durationMax: option.durationMax != null ? String(option.durationMax) : undefined,
    durationUnit: asDurationUnit(option.durationUnit),
    location: option.location ?? undefined,
    geohash: option.geohash ?? undefined,
    weightMin: option.weightMin ?? undefined,
    weightMinUnit: option.weightUnit ?? undefined,
    weightMax: option.weightMax ?? undefined,
    weightMaxUnit: option.weightUnit ?? undefined,
    dimMin: option.dimMin ?? undefined,
    dimMinUnit: option.dimUnit ?? undefined,
    dimMax: option.dimMax ?? undefined,
    dimMaxUnit: option.dimUnit ?? undefined,
    priceWeight: option.priceWeight ?? undefined,
    priceWeightCurrency: option.priceWeightCur ?? undefined,
    priceVolume: option.priceVolume ?? undefined,
    priceVolumeCurrency: option.priceVolumeCur ?? undefined,
    priceDistance: option.priceDistance ?? undefined,
    priceDistanceCurrency: option.priceDistanceCur ?? undefined,
  }, signingKey)

  if (!event) return null
  await prisma.shippingOption.update({ where: { id }, data: { nostrEventId: event.id } })
  return event.id
}

export function createShippingOptionRouter(prisma: PrismaClient) {
  const router = Router()

  router.get('/company/:companyId', async (req, res) => {
    try {
      const { companyId } = req.params
      const options = await prisma.shippingOption.findMany({
        where: { companyId, isActive: true },
        orderBy: { createdAt: 'desc' },
      })
      res.json({ shippingOptions: options })
    } catch (error) {
      console.error('Failed to fetch shipping options:', error)
      res.status(500).json({ error: 'Failed to fetch shipping options' })
    }
  })

  router.get('/by-pubkey/:pubkey', async (req, res) => {
    try {
      const { pubkey } = req.params
      const company = await prisma.company.findUnique({
        where: { ownerPubkey: pubkey },
        select: { id: true },
      })
      if (!company) return res.json({ shippingOptions: [] })
      const options = await prisma.shippingOption.findMany({
        where: { companyId: company.id, isActive: true },
        orderBy: { createdAt: 'desc' },
      })
      res.json({ shippingOptions: options })
    } catch (error) {
      console.error('Failed to fetch shipping options by pubkey:', error)
      res.status(500).json({ error: 'Failed to fetch shipping options' })
    }
  })

  router.get('/:id', async (req, res) => {
    try {
      const option = await prisma.shippingOption.findUnique({ where: { id: req.params.id } })
      if (!option) return res.status(404).json({ error: 'Shipping option not found' })
      res.json({ shippingOption: option })
    } catch (error) {
      console.error('Failed to fetch shipping option:', error)
      res.status(500).json({ error: 'Failed to fetch shipping option' })
    }
  })

  router.post('/', async (req, res) => {
    try {
      const {
        companyId, d, title, baseCost, currency, countries,
        service, carrier, regions, durationMin, durationMax, durationUnit,
        location, geohash, weightMin, weightMax, weightUnit,
        dimMin, dimMax, dimUnit,
        priceWeight, priceWeightCur, priceVolume, priceVolumeCur,
        priceDistance, priceDistanceCur,
      } = req.body

      if (!companyId || !d || !title || !baseCost || !currency || !countries) {
        return res.status(400).json({ error: 'Missing required fields: companyId, d, title, baseCost, currency, countries' })
      }

      const serviceEnum = Object.values(ShippingServiceType).includes(service)
        ? service
        : ShippingServiceType.STANDARD

      const option = await prisma.shippingOption.create({
        data: {
          companyId, d, title, baseCost, currency,
          countries: Array.isArray(countries) ? countries.join(',') : countries,
          service: serviceEnum,
          carrier: carrier || null,
          regions: regions ? (Array.isArray(regions) ? regions.join(',') : regions) : null,
          durationMin: durationMin ?? null,
          durationMax: durationMax ?? null,
          durationUnit: durationUnit || null,
          location: location || null,
          geohash: geohash || null,
          weightMin: weightMin || null,
          weightMax: weightMax || null,
          weightUnit: weightUnit || null,
          dimMin: dimMin || null,
          dimMax: dimMax || null,
          dimUnit: dimUnit || null,
          priceWeight: priceWeight || null,
          priceWeightCur: priceWeightCur || null,
          priceVolume: priceVolume || null,
          priceVolumeCur: priceVolumeCur || null,
          priceDistance: priceDistance || null,
          priceDistanceCur: priceDistanceCur || null,
        },
      })

      try {
        const nostrEventId = await publishAndSyncShippingOption(prisma, option.id)
        if (nostrEventId) option.nostrEventId = nostrEventId
      } catch (publishError) {
        console.error('Failed to publish new shipping option to Nostr:', publishError)
      }

      res.json({ success: true, shippingOption: option })
    } catch (error) {
      console.error('Failed to create shipping option:', error)
      res.status(500).json({ error: 'Failed to create shipping option' })
    }
  })

  router.patch('/:id', async (req, res) => {
    try {
      const { id } = req.params
      const existing = await prisma.shippingOption.findUnique({ where: { id } })
      if (!existing) return res.status(404).json({ error: 'Shipping option not found' })

      const {
        title, baseCost, currency, countries, service, carrier,
        regions, durationMin, durationMax, durationUnit,
        location, geohash, weightMin, weightMax, weightUnit,
        dimMin, dimMax, dimUnit,
        priceWeight, priceWeightCur, priceVolume, priceVolumeCur,
        priceDistance, priceDistanceCur, isActive,
      } = req.body

      const data: Record<string, unknown> = {}
      if (title !== undefined) data.title = title
      if (baseCost !== undefined) data.baseCost = baseCost
      if (currency !== undefined) data.currency = currency
      if (countries !== undefined) data.countries = Array.isArray(countries) ? countries.join(',') : countries
      if (service !== undefined) {
        data.service = Object.values(ShippingServiceType).includes(service)
          ? service
          : ShippingServiceType.STANDARD
      }
      if (carrier !== undefined) data.carrier = carrier
      if (regions !== undefined) data.regions = Array.isArray(regions) ? regions.join(',') : regions
      if (durationMin !== undefined) data.durationMin = durationMin
      if (durationMax !== undefined) data.durationMax = durationMax
      if (durationUnit !== undefined) data.durationUnit = durationUnit
      if (location !== undefined) data.location = location
      if (geohash !== undefined) data.geohash = geohash
      if (weightMin !== undefined) data.weightMin = weightMin
      if (weightMax !== undefined) data.weightMax = weightMax
      if (weightUnit !== undefined) data.weightUnit = weightUnit
      if (dimMin !== undefined) data.dimMin = dimMin
      if (dimMax !== undefined) data.dimMax = dimMax
      if (dimUnit !== undefined) data.dimUnit = dimUnit
      if (priceWeight !== undefined) data.priceWeight = priceWeight
      if (priceWeightCur !== undefined) data.priceWeightCur = priceWeightCur
      if (priceVolume !== undefined) data.priceVolume = priceVolume
      if (priceVolumeCur !== undefined) data.priceVolumeCur = priceVolumeCur
      if (priceDistance !== undefined) data.priceDistance = priceDistance
      if (priceDistanceCur !== undefined) data.priceDistanceCur = priceDistanceCur
      if (isActive !== undefined) data.isActive = isActive

      const option = await prisma.shippingOption.update({ where: { id }, data })

      try {
        // ADR-277 C3: NIP-09 delete on deactivate, republish otherwise.
        const justDeactivated = existing.isActive && isActive === false
        if (justDeactivated) {
          if (existing.nostrEventId) {
            const deletionKey = hasSigningIdentityKey()
              ? (await getOrCreateCompanySigningKey(prisma, existing.companyId)).sk
              : undefined
            await nostrService.publishDeletion(existing.nostrEventId, 'Shipping option deactivated', deletionKey)
          }
        } else {
          const nostrEventId = await publishAndSyncShippingOption(prisma, option.id)
          if (nostrEventId) option.nostrEventId = nostrEventId
        }
      } catch (publishError) {
        console.error('Failed to sync shipping option to Nostr:', publishError)
      }

      res.json({ success: true, shippingOption: option })
    } catch (error) {
      console.error('Failed to update shipping option:', error)
      res.status(500).json({ error: 'Failed to update shipping option' })
    }
  })

  router.delete('/:id', async (req, res) => {
    try {
      const existing = await prisma.shippingOption.findUnique({ where: { id: req.params.id }, select: { nostrEventId: true, companyId: true } })
      if (existing?.nostrEventId) {
        try {
          const deletionKey = hasSigningIdentityKey()
            ? (await getOrCreateCompanySigningKey(prisma, existing.companyId)).sk
            : undefined
          await nostrService.publishDeletion(existing.nostrEventId, 'Shipping option deleted', deletionKey)
        } catch (publishError) {
          console.error('Failed to publish shipping option deletion to Nostr:', publishError)
        }
      }
      await prisma.shippingOption.delete({ where: { id: req.params.id } })
      res.json({ success: true })
    } catch (error) {
      console.error('Failed to delete shipping option:', error)
      res.status(500).json({ error: 'Failed to delete shipping option' })
    }
  })

  return router
}
