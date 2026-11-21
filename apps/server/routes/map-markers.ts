// ADR-406 D6 (FU-913/FU-914/FU-915): viewport-aware marker source for the
// marketplace map. Public read tier — the same visibility rules as GET
// /api/offers and GET /api/companies apply, but only lightweight marker
// fields are returned so a pannable map never loads the full catalog.
//
// GET /api/map/markers
//   bbox=minLng,minLat,maxLng,maxLat   optional; omit to get the global set
//   kind=all|offers|vendors            default all
//   offerType=PRODUCT|SERVICE          offers only
//   categoryCode=<code>                offers only (standard category)
//   country=<ISO-3166-1-alpha-2>       both
//   q=<text>                           title (offers) / name (vendors)
//   limit=<n>                          per-bucket cap (default 800, max 2000)
//
// Response: { markers: MapMarker[], count, truncated }

import { Router } from 'express'
import type { PrismaClient, Prisma } from '@prisma/client'

const DEFAULT_LIMIT = 800
const MAX_LIMIT = 2000

type MarkerKind = 'offer' | 'company'

interface MapMarker {
  id: string
  kind: MarkerKind
  lat: number
  lng: number
  title: string
  subtitle?: string
  priceSats?: number
  /** Offer-only: OfferType (PRODUCT / SERVICE / …) for list iconography. */
  offerType?: string
  href: string
}

interface Bbox {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

function parseBbox(raw: unknown): Bbox | null {
  if (typeof raw !== 'string') return null
  const parts = raw.split(',').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null
  const [minLng, minLat, maxLng, maxLat] = parts
  return { minLng, minLat, maxLng, maxLat }
}

function parseLimit(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(Math.floor(n), MAX_LIMIT)
}

function joinLocation(parts: Array<string | null | undefined>): string | undefined {
  const value = parts.filter((p): p is string => Boolean(p && p.trim())).join(', ')
  return value || undefined
}

export function createMapMarkersRouter(prisma: PrismaClient): Router {
  const router = Router()

  router.get('/markers', async (req, res) => {
    try {
      const bbox = parseBbox(req.query.bbox)
      const kind = String(req.query.kind ?? 'all')
      const offerType = req.query.offerType ? String(req.query.offerType) : undefined
      const categoryCode = req.query.categoryCode ? String(req.query.categoryCode) : undefined
      const country = req.query.country ? String(req.query.country) : undefined
      const q = req.query.q ? String(req.query.q).trim() : undefined
      const limit = parseLimit(req.query.limit)

      const wantOffers = kind === 'all' || kind === 'offers'
      const wantVendors = kind === 'all' || kind === 'vendors'

      const lat: Prisma.FloatNullableFilter = bbox
        ? { gte: bbox.minLat, lte: bbox.maxLat }
        : { not: null }
      const lng: Prisma.FloatNullableFilter = bbox
        ? { gte: bbox.minLng, lte: bbox.maxLng }
        : { not: null }

      const offerWhere: Prisma.OfferWhereInput = {
        status: 'ACTIVE',
        blockedAt: null,
        lat,
        lng,
        // Same public-browse rules as GET /api/offers (ADR-152 / ADR-284).
        creator: { profileVisibility: { not: 'PRIVATE' } },
        OR: [{ productType: null }, { productType: { not: 'variation' } }],
        ...(offerType ? { offerType: offerType as Prisma.OfferWhereInput['offerType'] } : {}),
        ...(categoryCode ? { categoryCode } : {}),
        ...(country ? { country } : {}),
        ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}),
      }

      const companyWhere: Prisma.CompanyWhereInput = {
        isActive: true,
        lat,
        lng,
        ...(country ? { country } : {}),
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
      }

      const [offers, companies] = await Promise.all([
        wantOffers
          ? prisma.offer.findMany({
              where: offerWhere,
              select: {
                id: true, title: true, priceSats: true, offerType: true,
                lat: true, lng: true, city: true, country: true, location: true,
              },
              orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
              take: limit,
            })
          : Promise.resolve([]),
        wantVendors
          ? prisma.company.findMany({
              where: companyWhere,
              select: { id: true, name: true, ownerPubkey: true, city: true, country: true, lat: true, lng: true },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: limit,
            })
          : Promise.resolve([]),
      ])

      const markers: MapMarker[] = [
        ...offers.map((o): MapMarker => ({
          id: o.id,
          kind: 'offer',
          lat: o.lat as number,
          lng: o.lng as number,
          title: o.title,
          subtitle: o.location ?? joinLocation([o.city, o.country]),
          priceSats: o.priceSats,
          offerType: o.offerType,
          href: `/buy/product/${o.id}`,
        })),
        ...companies.map((c): MapMarker => ({
          id: c.id,
          kind: 'company',
          lat: c.lat as number,
          lng: c.lng as number,
          title: c.name,
          subtitle: joinLocation([c.city, c.country]),
          href: `/buy/vendors/${c.ownerPubkey}`,
        })),
      ].filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng))

      res.json({
        markers,
        count: markers.length,
        truncated: offers.length >= limit || companies.length >= limit,
      })
    } catch (error) {
      console.error('Failed to fetch map markers:', error)
      res.status(500).json({ error: 'Failed to fetch map markers' })
    }
  })

  return router
}
