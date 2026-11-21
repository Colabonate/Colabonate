import type { PrismaClient } from '@prisma/client'
import { getRedis } from '../lib/redis.js'

interface GeoResult {
  lat: number
  lng: number
}

interface GeocodeRequest {
  country: string
  region?: string
  city?: string
}

class CoalescingQueue {
  private queue: Map<string, Array<(result: GeoResult | null) => void>> = new Map()
  private processing: Set<string> = new Set()
  private lastCall: Map<string, number> = new Map()
  private readonly minInterval = 1000

  enqueue(req: GeocodeRequest, callback: (result: GeoResult | null) => void) {
    const key = this.keyFor(req)
    if (!this.queue.has(key)) {
      this.queue.set(key, [])
    }
    this.queue.get(key)!.push(callback)
    this.process(key, req)
  }

  private keyFor(req: GeocodeRequest): string {
    return `${req.country}:${req.region ?? ''}:${req.city ?? ''}`
  }

  private async process(key: string, req: GeocodeRequest) {
    if (this.processing.has(key)) return
    const now = Date.now()
    const last = this.lastCall.get(key) || 0
    const wait = Math.max(0, this.minInterval - (now - last))
    this.processing.add(key)
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
    this.lastCall.set(key, Date.now())
    const result = await this.fetchFromNominatim(req)
    this.processing.delete(key)
    const callbacks = this.queue.get(key) || []
    this.queue.delete(key)
    callbacks.forEach(cb => cb(result))
  }

  private async fetchFromNominatim(req: GeocodeRequest): Promise<GeoResult | null> {
    const query = [req.city, req.region, req.country].filter(Boolean).join(', ')
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Colabonate/1.0 (geocoding)' },
      })
      if (!res.ok) return null
      const data = await res.json() as Array<{ lat: string; lon: string }>
      if (data.length === 0) return null
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
    } catch {
      return null
    }
  }
}

const queue = new CoalescingQueue()

export async function geocode(
  prisma: PrismaClient,
  country: string,
  region?: string,
  city?: string,
): Promise<GeoResult | null> {
  if (!country) return null
  const redis = getRedis()
  const cacheKey = `geo:${country}:${region ?? ''}:${city ?? ''}`
  if (redis) {
    const cached = await redis.get(cacheKey)
    if (cached) {
      try { return JSON.parse(cached) } catch { /* invalid cache */ }
    }
  }
  const existing = await prisma.geoLookup.findUnique({
    where: { country_region_city: { country, region: region ?? '', city: city ?? '' } },
  })
  if (existing) {
    const result = { lat: existing.lat, lng: existing.lng }
    if (redis) await redis.setex(cacheKey, 86400, JSON.stringify(result))
    return result
  }
  return new Promise(resolve => queue.enqueue({ country, region, city }, resolve))
}

export async function geocodeAndStore(
  prisma: PrismaClient,
  country: string,
  region?: string,
  city?: string,
): Promise<GeoResult | null> {
  const result = await geocode(prisma, country, region, city)
  if (!result) return null
  try {
    await prisma.geoLookup.upsert({
      where: { country_region_city: { country, region: region ?? '', city: city ?? '' } },
      create: { country, region: region ?? '', city: city ?? '', lat: result.lat, lng: result.lng, provider: 'nominatim' },
      update: { lat: result.lat, lng: result.lng, provider: 'nominatim', fetchedAt: new Date() },
    })
  } catch { /* already exists */ }
  return result
}