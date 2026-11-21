import { getRedis } from './redis.js'

// FU-681 — cap/rate-limit-hit counters. No metrics system exists in this repo
// (Loki only ingests console lines, ADR-227); this is the "cheapest fix" the
// follow-up itself named, extended with actual counting so the Admin panel
// can show a number instead of asking an operator to grep raw access logs.
// Persisted in Redis when reachable (survives restarts, shared across
// instances); falls back to an in-memory counter (reset on restart, per
// process) otherwise — same fallback posture as middleware/rate-limit.ts's
// own Redis/memory store split. All-time totals, no time window: the goal is
// "is this happening at all", not rate analysis (Loki/log-grep remains the
// tool for that).

const REDIS_KEY_CAP = 'metrics:launch-cap-reject'

export const RATE_LIMIT_BUCKETS = ['unauth', 'auth', 'search', 'email-auth', 'email'] as const
export type RateLimitBucket = (typeof RATE_LIMIT_BUCKETS)[number]

const memoryCounters: Record<string, number> = {}

function redisKeyForBucket(bucket: RateLimitBucket): string {
  return `metrics:rate-limit-reject:${bucket}`
}

async function increment(key: string): Promise<void> {
  const redis = getRedis()
  if (redis) {
    try {
      await redis.incr(key)
      return
    } catch {
      // fall through to memory
    }
  }
  memoryCounters[key] = (memoryCounters[key] ?? 0) + 1
}

async function read(key: string): Promise<number> {
  const redis = getRedis()
  if (redis) {
    try {
      const raw = await redis.get(key)
      if (raw !== null) return Number(raw) || 0
    } catch {
      // fall through to memory
    }
  }
  return memoryCounters[key] ?? 0
}

/** Fire-and-forget — never let a counter write slow down the reject response. */
export function recordLaunchCapReject(): void {
  void increment(REDIS_KEY_CAP)
}

/** Fire-and-forget — called from the rate-limit handler, on the hot 429 path. */
export function recordRateLimitReject(bucket: RateLimitBucket): void {
  void increment(redisKeyForBucket(bucket))
}

export interface LaunchReadinessMetrics {
  capRejections: number
  rateLimitRejections: Record<RateLimitBucket, number>
}

export async function getLaunchReadinessMetrics(): Promise<LaunchReadinessMetrics> {
  const [capRejections, ...bucketCounts] = await Promise.all([
    read(REDIS_KEY_CAP),
    ...RATE_LIMIT_BUCKETS.map((b) => read(redisKeyForBucket(b))),
  ])
  const rateLimitRejections = Object.fromEntries(
    RATE_LIMIT_BUCKETS.map((b, i) => [b, bucketCounts[i]])
  ) as Record<RateLimitBucket, number>
  return { capRejections, rateLimitRejections }
}
