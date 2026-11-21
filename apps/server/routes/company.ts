import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'
import { nostrService } from '../services/nostr-relay'
import { requireAuth, type AuthenticatedRequest } from '../middleware/require-auth.js'
import { invalidateListCache, cacheMiddleware } from '../middleware/cache.js'
import { geocodeCity } from '../lib/geocode.js'
import { getOrCreateCompanySigningKey, hasSigningIdentityKey } from '../services/nostr-signing-identity.js'
import { readLnurlpDomain } from '../lib/lnAddressHandle.js'

function safeParseJson<T>(value: unknown, fallback: T): T {
  if (!value) return fallback
  if (typeof value === 'object') return value as T
  if (typeof value === 'string') {
    try { return JSON.parse(value) } catch { return fallback }
  }
  return fallback
}

export function createCompanyRouter(prisma: PrismaClient) {
  const router = Router()
  const auth = requireAuth(prisma)

  router.get('/', async (req, res) => {
    res.json({ company: null })
  })

  router.get('/by-id/:id', async (req, res) => {
    try {
      const { id } = req.params
      const company = await prisma.company.findUnique({
        where: { id },
        include: { catalogs: { where: { isActive: true as boolean } } }
      })

      if (!company) {
        res.json({ company: null })
        return
      }

      if (!company.isActive) {
        res.json({ company: null })
        return
      }

      // ADR-284 D2: blocked companies read as "not found" publicly, same
      // treatment as inactive.
      if (company.blockedAt) {
        res.json({ company: null })
        return
      }

      res.json({
        company: {
          ...company,
          images: safeParseJson<string[]>(company.images, []),
          openingHours: safeParseJson<Record<string, unknown>>(company.openingHours, {}),
        }
      })
    } catch (error) {
      console.error('Failed to fetch company by id:', error)
      res.status(500).json({ error: 'Failed to fetch company' })
    }
  })

  router.get('/:pubkey', async (req, res) => {
    try {
      const { pubkey } = req.params
      const company = await prisma.company.findUnique({
        where: { ownerPubkey: pubkey },
        include: { catalogs: { where: { isActive: true as boolean } } }
      })

      if (!company) {
        res.json({ company: null })
        return
      }

      if (!company.isActive) {
        res.json({ company: null })
        return
      }

      // ADR-284 D2: blocked companies read as "not found" publicly, same
      // treatment as inactive.
      if (company.blockedAt) {
        res.json({ company: null })
        return
      }

      const companyWithParsedImages = {
        ...company,
        images: safeParseJson<string[]>(company.images, []),
        openingHours: safeParseJson<Record<string, unknown>>(company.openingHours, {}),
      }

      res.json({ company: companyWithParsedImages })
    } catch (error) {
      console.error('Failed to fetch company:', error)
      res.status(500).json({ error: 'Failed to fetch company' })
    }
  })

  router.get('/me', auth, async (req: AuthenticatedRequest, res) => {
    try {
      const pubkey = req.authPubkey!
      const company = await prisma.company.findUnique({
        where: { ownerPubkey: pubkey },
        include: { catalogs: { where: { isActive: true as boolean } } }
      })

      if (!company || !company.isActive) {
        res.json({ company: null })
        return
      }

      const companyWithParsedImages = {
        ...company,
        images: safeParseJson<string[]>(company.images, []),
        openingHours: safeParseJson<Record<string, unknown>>(company.openingHours, {}),
      }

      res.json({ company: companyWithParsedImages })
    } catch (error) {
      console.error('Failed to fetch company:', error)
      res.status(500).json({ error: 'Failed to fetch company' })
    }
  })

  router.post('/', auth, async (req: AuthenticatedRequest, res) => {
    try {
      const {
        name,
        description,
        address,
        city,
        zipCode,
        country,
        openingHours,
        businessFields,
        terms,
        logoUrl,
        images,
        lat,
        lng,
      } = req.body

      const ownerPubkey = req.authPubkey!

      if (!name) {
        return res.status(400).json({ error: 'Missing required fields: name' })
      }

      let resolvedLat: number | null = typeof lat === 'number' ? lat : null
      let resolvedLng: number | null = typeof lng === 'number' ? lng : null
      if (resolvedLat === null && (city || country)) {
        const coords = await geocodeCity(city, country)
        if (coords) { resolvedLat = coords.lat; resolvedLng = coords.lng }
      }

      const existingCompany = await prisma.company.findUnique({
        where: { ownerPubkey }
      })

      let company
      if (existingCompany) {
        company = await prisma.company.update({
          where: { id: existingCompany.id },
          data: {
            name,
            description,
            address,
            city,
            zipCode,
            country,
            lat: resolvedLat,
            lng: resolvedLng,
            openingHours,
            businessFields,
            terms,
            logoUrl,
            images: images || null,
            isActive: true,
          }
        })
      } else {
        company = await prisma.company.create({
          data: {
            ownerPubkey,
            name,
            description,
            address,
            city,
            zipCode,
            country,
            lat: resolvedLat,
            lng: resolvedLng,
            openingHours,
            businessFields,
            terms,
            logoUrl,
            images: images || null,
            isActive: true,
          }
        })
      }

      res.json({ success: true, company })

      await invalidateListCache('companies')
    } catch (error) {
      console.error('Failed to create/update company:', error)
      res.status(500).json({ error: 'Failed to create/update company' })
    }
  })

  router.patch('/me', auth, async (req: AuthenticatedRequest, res) => {
    try {
      const pubkey = req.authPubkey!
      const existing = await prisma.company.findUnique({ where: { ownerPubkey: pubkey } })
      if (!existing) {
        return res.status(404).json({ error: 'Company not found' })
      }
      const allowedFields = [
        'name', 'description', 'address', 'city', 'zipCode', 'country',
        'lat', 'lng',
        'openingHours', 'businessFields', 'coopRadius', 'terms',
        'imprint', 'privacyPolicy', 'legalJurisdiction', 'taxId',
        'website', 'email', 'phone', 'socialLinks', 'logoUrl', 'bannerUrl',
        'isActive', 'images', 'hourlyRateSats',
      ]
      const data: Record<string, unknown> = {}
      for (const field of allowedFields) {
        if (field in req.body) data[field] = req.body[field]
      }
      // auto-geocode if city/country changed but lat/lng not provided
      if (!('lat' in req.body) && ('city' in req.body || 'country' in req.body)) {
        const geocity = (req.body.city ?? existing.city) as string | null
        const geocountry = (req.body.country ?? existing.country) as string | null
        const coords = await geocodeCity(geocity, geocountry)
        if (coords) { data.lat = coords.lat; data.lng = coords.lng }
      }
      const company = await prisma.company.update({ where: { id: existing.id }, data })
      res.json({ success: true, company })

      await invalidateListCache('companies')
    } catch (error) {
      console.error('Failed to patch company:', error)
      res.status(500).json({ error: 'Failed to patch company' })
    }
  })

  router.patch('/:pubkey', auth, async (req: AuthenticatedRequest, res) => {
    try {
      const { pubkey } = req.params
      if (pubkey !== req.authPubkey) {
        return res.status(403).json({ error: 'Not authorized to update this company' })
      }
      const existing = await prisma.company.findUnique({ where: { ownerPubkey: pubkey } })
      if (!existing) {
        return res.status(404).json({ error: 'Company not found' })
      }
      const allowedFields = [
        'name', 'description', 'address', 'city', 'zipCode', 'country',
        'lat', 'lng',
        'openingHours', 'businessFields', 'coopRadius', 'terms',
        'imprint', 'privacyPolicy', 'legalJurisdiction', 'taxId',
        'website', 'email', 'phone', 'socialLinks', 'logoUrl', 'bannerUrl',
        'isActive', 'images', 'hourlyRateSats',
      ]
      const data: Record<string, unknown> = {}
      for (const field of allowedFields) {
        if (field in req.body) data[field] = req.body[field]
      }
      // auto-geocode if city/country changed but lat/lng not provided
      if (!('lat' in req.body) && ('city' in req.body || 'country' in req.body)) {
        const geocity = (req.body.city ?? existing.city) as string | null
        const geocountry = (req.body.country ?? existing.country) as string | null
        const coords = await geocodeCity(geocity, geocountry)
        if (coords) { data.lat = coords.lat; data.lng = coords.lng }
      }
      const company = await prisma.company.update({ where: { id: existing.id }, data })
      res.json({ success: true, company })

      await invalidateListCache('companies')
    } catch (error) {
      console.error('Failed to patch company:', error)
      res.status(500).json({ error: 'Failed to patch company' })
    }
  })

  router.post('/:pubkey/publish', auth, async (req: AuthenticatedRequest, res) => {
    try {
      const { pubkey } = req.params
      if (pubkey !== req.authPubkey) {
        return res.status(403).json({ error: 'Not authorized to publish this company' })
      }
      const company = await prisma.company.findUnique({
        where: { ownerPubkey: pubkey }
      })

      if (!company) {
        return res.status(404).json({ error: 'Company not found' })
      }

      let socialLinks: { twitter?: string; nostr?: string } = {}
      if (company.socialLinks) {
        const parsed = safeParseJson<Record<string, string>>(company.socialLinks, {})
        socialLinks = {
          twitter: parsed.twitter,
          nostr: parsed.nostr,
        }
      }

      let businessFields: string[] = []
      if (company.businessFields) {
        const parsed = safeParseJson<unknown[]>(company.businessFields, [])
        businessFields = Array.isArray(parsed)
          ? parsed.map(f => typeof f === 'object' && f !== null && 'unspscCode' in f && typeof f.unspscCode === 'string' ? f.unspscCode : String(f))
          : []
      }

      let openingHours: Record<string, string> = safeParseJson<Record<string, string>>(company.openingHours, {})

      // ADR-412 D2: persistent per-company signing key, not a fresh ephemeral
      // one per publish. Falls back to ephemeral when at-rest encryption
      // isn't configured (dev without NWC_SECRET_KEY).
      let signingKey: Uint8Array | undefined
      if (hasSigningIdentityKey()) {
        const identity = await getOrCreateCompanySigningKey(prisma, company.id)
        signingKey = identity.sk
        if (identity.isNew) {
          await nostrService.publishEntityProfile(identity.sk, { name: company.name, picture: company.logoUrl, about: company.description, nip05: `${company.id}@${readLnurlpDomain()}` })
        }
      }

      const event = await nostrService.publishCompany({
        id: company.id,
        name: company.name,
        description: company.description || undefined,
        address: company.address || undefined,
        city: company.city || undefined,
        zipCode: company.zipCode || undefined,
        country: company.country || undefined,
        coopRadius: company.coopRadius || undefined,
        businessFields,
        logoUrl: company.logoUrl || undefined,
        bannerUrl: company.bannerUrl || undefined,
        images: safeParseJson<string[]>(company.images, []),
        website: company.website || undefined,
        email: company.email || undefined,
        phone: company.phone || undefined,
        socialLinks,
        openingHours,
        terms: company.terms || undefined,
        ownerPubkey: company.ownerPubkey
      }, signingKey)

      if (event) {
        const updatedCompany = await prisma.company.update({
          where: { id: company.id },
          data: {
            nostrEventId: event.id,
            publishedAt: new Date()
          }
        })
        res.json({
          success: true,
          nostrEventId: event.id,
          publishedAt: updatedCompany.publishedAt?.toISOString()
        })
      } else {
        res.status(500).json({ error: 'Failed to publish company to Nostr' })
      }
    } catch (error) {
      console.error('Failed to publish company:', error)
      res.status(500).json({ error: 'Failed to publish company' })
    }
  })

  router.delete('/:pubkey', auth, async (req: AuthenticatedRequest, res) => {
    try {
      const { pubkey } = req.params
      if (pubkey !== req.authPubkey) {
        return res.status(403).json({ error: 'Not authorized to delete this company' })
      }
      const company = await prisma.company.findUnique({
        where: { ownerPubkey: pubkey }
      })

      if (!company) {
        return res.status(404).json({ error: 'Company not found' })
      }

      await prisma.company.update({
        where: { id: company.id },
        data: {
          isActive: false,
          nostrEventId: null,
          publishedAt: null,
        },
      })

      res.json({ success: true, softDeleted: true })
    } catch (error) {
      console.error('Failed to delete company:', error)
      res.status(500).json({ error: 'Failed to delete company' })
    }
  })

  return router
}
