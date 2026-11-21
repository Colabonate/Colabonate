import { getRedis } from '../lib/redis.js'

export const cache = {
  async get<T>(key: string): Promise<T | null> {
    const redis = getRedis()
    if (!redis) return null
    const val = await redis.get(key)
    if (!val) return null
    try { return JSON.parse(val) as T } catch { return null }
  },

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const redis = getRedis()
    if (!redis) return
    await redis.setex(key, ttlSeconds, JSON.stringify(value))
  },

  async del(key: string): Promise<void> {
    const redis = getRedis()
    if (!redis) return
    await redis.del(key)
  },

  async bumpVersion(tag: string): Promise<number> {
    const redis = getRedis()
    if (!redis) return 0
    return redis.incr(`version:${tag}`)
  },

  async getVersion(tag: string): Promise<number> {
    const redis = getRedis()
    if (!redis) return 0
    const v = await redis.get(`version:${tag}`)
    return v ? parseInt(v, 10) : 0
  },

  async getOrCompute<T>(
    key: string,
    ttl: number,
    compute: () => Promise<T>,
  ): Promise<T> {
    const redis = getRedis()
    if (!redis) return compute()

    const cached = await this.get<T>(key)
    if (cached !== null) return cached

    const lockKey = `lock:${key}`
    const haveLock = await redis.set(lockKey, '1', 'EX', 10, 'NX')
    if (!haveLock) {
      await new Promise(r => setTimeout(r, 50))
      const retry = await this.get<T>(key)
      if (retry !== null) return retry
      return compute()
    }

    try {
      const fresh = await compute()
      await this.set(key, fresh, ttl)
      return fresh
    } finally {
      if (haveLock) await redis.del(lockKey)
    }
  },

  async invalidateByPattern(pattern: string): Promise<void> {
    const redis = getRedis()
    if (!redis) return
    const keys = await redis.keys(pattern)
    if (keys.length > 0) await redis.del(...keys)
  },
}

export function versionedKey(version: number, prefix: string, hash: string): string {
  return `v${version}:${prefix}:${hash}`
}

export async function computeQueryHash(params: Record<string, unknown>): Promise<string> {
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&')
  const enc = new TextEncoder().encode(sorted)
  const hash = await crypto.subtle.digest('SHA-256', enc)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}