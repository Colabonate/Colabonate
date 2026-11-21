import type { Response, NextFunction } from 'express'
import type { AppRequest } from '../types/express.js'
import { cache, versionedKey, computeQueryHash } from '../services/cache.js'

let cacheEnabledOverride: boolean | null = null

export function isCacheEnabled(): boolean {
  if (cacheEnabledOverride !== null) return cacheEnabledOverride
  return process.env.CACHE_ENABLED !== 'false'
}

export function setCacheEnabled(enabled: boolean): void {
  cacheEnabledOverride = enabled
}

export const CACHE_ENABLED = true

export function cacheMiddleware(ttlSeconds: number) {
  return async (req: AppRequest, res: Response, next: NextFunction) => {
    if (!isCacheEnabled() || !cache) return next()

    const params = req.query as Record<string, unknown>
    const hash = await computeQueryHash(params)
    const key = `${req.path}?${hash}`

    try {
      const cached = await cache.get(key)
      if (cached) {
        res.setHeader('X-Cache', 'HIT')
        res.setHeader('Cache-Control', `public, max-age=${Math.floor(ttlSeconds / 3)}, s-maxage=${ttlSeconds}, stale-while-revalidate=${Math.floor(ttlSeconds / 2)}`)
        res.json(cached)
        return
      }
    } catch (err) {
      console.warn('[Cache Middleware] Redis error:', err)
      return next()
    }

    const originalJson = res.json.bind(res)
    res.json = function (body: unknown) {
      if (res.statusCode === 200) {
        cache.set(key, body, ttlSeconds).catch(() => {})
      }
      return originalJson(body)
    }

    res.setHeader('X-Cache', 'MISS')
    next()
  }
}

export function versionedListCache(prefix: string, ttlSeconds: number) {
  return async (req: AppRequest, res: Response, next: NextFunction) => {
    if (!isCacheEnabled() || !cache) return next()

    const tag = prefix
    let version = 0
    try {
      version = await cache.getVersion(tag)
    } catch (err) {
      console.warn('[Cache Middleware] Redis error:', err)
      return next()
    }

    const params = req.query as Record<string, unknown>
    const hash = await computeQueryHash(params)
    // ADR-301: when version === 0 the list has never been invalidated, so
    // we'd skip cache entirely. Instead, treat version 0 as "version 1, not
    // yet known" and prime the cache on the first successful response — the
    // first mutation will then bump version 1 → 2 and the next request
    // sees a clean cache miss → fill cycle. Without this, /api/cooperations/
    // discover never caches until the first POST /api/cooperations (which
    // invalidates 'cooperations') runs, leaving the first dozens of home-
    // page loads at full DB latency.
    const effectiveVersion = version === 0 ? 1 : version
    const key = versionedKey(effectiveVersion, prefix, hash)

    try {
      const cached = await cache.get(key)
      if (cached) {
        res.setHeader('X-Cache', 'HIT')
        res.setHeader('Cache-Control', `public, max-age=${Math.floor(ttlSeconds / 3)}, s-maxage=${ttlSeconds}, stale-while-revalidate=${Math.floor(ttlSeconds / 2)}`)
        res.json(cached)
        return
      }
    } catch (err) {
      console.warn('[Cache Middleware] Redis error:', err)
      return next()
    }

    const originalJson = res.json.bind(res)
    res.json = function (body: unknown) {
      if (res.statusCode === 200) {
        cache.set(key, body, ttlSeconds).catch(() => {})
        // ADR-301: also seed the version key on first write so subsequent
        // bumps move past version 1 (otherwise they'd skip the version-1
        // entries we just wrote).
        if (version === 0) {
          cache.bumpVersion(tag).catch(() => {/* swallow */})
        }
      }
      return originalJson(body)
    }

    res.setHeader('X-Cache', 'MISS')
    next()
  }
}

export async function invalidateListCache(prefix: string): Promise<void> {
  await cache.bumpVersion(prefix)
}