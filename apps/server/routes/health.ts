import { Router } from 'express'
import type { PrismaClient } from '@prisma/client'
import { createRequire } from 'node:module'
import { isCacheEnabled, setCacheEnabled } from '../middleware/cache.js'
import { getRedis } from '../lib/redis.js'
import { getMeili } from '../lib/meili.js'

// ADR-288: single monorepo semver, synced across root/app/server package.json
// by scripts/version/bump-version.sh. Read from this package's own
// package.json rather than the monorepo root so it resolves the same way
// inside the server's Docker build context (which only has apps/server/).
const require = createRequire(import.meta.url)
const { version: APP_VERSION } = require('../package.json')

export function createHealthRouter(prisma: PrismaClient): Router {
  const router = Router()

  const redis = getRedis()
  const meili = getMeili()

  router.get('/health', async (_req, res) => {
    const [db, redisHealth, meiliHealth] = await Promise.all([
      prisma.$queryRaw`SELECT 1`.then(() => 'ok').catch(() => 'fail'),
      redis ? redis.ping().then(() => 'ok').catch(() => 'fail') : 'unconfigured',
      meili ? meili.health().then(() => 'ok').catch(() => 'fail') : 'unconfigured',
    ])

    const nostrConnected = checkNostrHealth()

    const status = db === 'ok' && redisHealth === 'ok' ? 'healthy' : 'degraded'

    res.status(status === 'healthy' ? 200 : 503).json({
      status,
      version: APP_VERSION,
      timestamp: new Date().toISOString(),
      services: { db: db, redis: redisHealth, meilisearch: meiliHealth, nostr: nostrConnected },
    })
  })

  router.get('/health/db', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      res.json({ status: 'ok', timestamp: new Date().toISOString() })
    } catch (err) {
      res.status(503).json({ status: 'fail', error: String(err), timestamp: new Date().toISOString() })
    }
  })

  router.get('/health/redis', async (_req, res) => {
    if (!redis) {
      res.json({ status: 'unconfigured', timestamp: new Date().toISOString() })
      return
    }
    try {
      await redis.ping()
      res.json({ status: 'ok', timestamp: new Date().toISOString() })
    } catch (err) {
      res.status(503).json({ status: 'fail', error: String(err), timestamp: new Date().toISOString() })
    }
  })

  router.get('/health/meili', async (_req, res) => {
    if (!meili) {
      res.json({ status: 'unconfigured', timestamp: new Date().toISOString() })
      return
    }
    try {
      const health = await meili.health()
      res.json({ status: health.status === 'available' ? 'ok' : 'fail', timestamp: new Date().toISOString() })
    } catch (err) {
      res.status(503).json({ status: 'fail', error: String(err), timestamp: new Date().toISOString() })
    }
  })

  router.get('/health/nostr', async (_req, res) => {
    const connected = checkNostrHealth()
    if (connected) {
      res.json({ status: 'ok', connectedRelays: connected.count, lastEventAt: connected.lastEventAt ?? null, timestamp: new Date().toISOString() })
    } else {
      res.json({ status: 'unconfigured', timestamp: new Date().toISOString() })
    }
  })

  router.get('/health/cache', async (_req, res) => {
    res.json({
      status: isCacheEnabled() ? 'enabled' : 'disabled',
      cacheEnabled: isCacheEnabled(),
      envOverride: process.env.CACHE_ENABLED ?? '(not set)',
      note: 'POST /health/cache with { enabled: boolean } to toggle in-process (persists until restart)',
      timestamp: new Date().toISOString(),
    })
  })

  router.post('/health/cache', async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress
    if (ip && ip !== '127.0.0.1' && !ip.startsWith('10.') && !ip.startsWith('192.168.')) {
      res.status(403).json({ error: 'Internal endpoint' })
      return
    }
    const { enabled } = req.body as { enabled?: boolean }
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'Body must contain { enabled: boolean }' })
      return
    }
    setCacheEnabled(enabled)
    res.json({
      status: 'ok',
      cacheEnabled: enabled,
      note: `Cache ${enabled ? 'enabled' : 'disabled'} in-process. Set CACHE_ENABLED env var for permanent toggle.`,
      timestamp: new Date().toISOString(),
    })
  })

  return router
}

function checkNostrHealth(): { count: number; lastEventAt: string | null } | null {
  try {
    const { nostrService } = require('../services/nostr-relay.js')
    if (!nostrService) return null
    return {
      count: nostrService.connectedRelayCount?.() ?? 0,
      lastEventAt: nostrService.lastEventTimestamp?.() ?? null,
    }
  } catch {
    return null
  }
}