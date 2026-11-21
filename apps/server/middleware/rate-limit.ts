import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit'
import RedisStore, { type RedisReply } from 'rate-limit-redis'
import type { Request } from 'express'
import { createHash } from 'crypto'
import { getRedis } from '../lib/redis.js'
import { recordRateLimitReject, type RateLimitBucket } from '../lib/launch-readiness-metrics.js'

// NOTE (was ADR-139 Phase 1, ADR-166, FU-193): memory-store rate limiting is fine for
// a single-instance deployment, but the limits collapse into one bucket per process
// when the server scales horizontally (FOLLOWUPS.md FU-212-B). ADR-212 P3 made Redis
// a hard requirement on the Beta stack (REDIS_PASSWORD required), so this middleware
// now uses `rate-limit-redis` whenever a Redis client is reachable — preserving the
// memory fallback for unit tests and any future redis-less deployment (e.g. local
// playground).

type RateLimiterOptions = Pick<Options, 'windowMs' | 'max'> & {
  skip?: (req: Request) => boolean
  /** Override the Redis key prefix (useful per-limiter: "rl:auth", "rl:search"). */
  prefix?: string
  keyGenerator?: (req: Request) => string
  /** FU-681: counts every 429 from this limiter under this bucket for the Admin > Launch Readiness panel. */
  bucket?: RateLimitBucket
}

function buildStore(prefix: string): Options['store'] | undefined {
  const redis = getRedis()
  if (!redis) return undefined // memory store fallback
  return new RedisStore({
    sendCommand: (...args: string[]) =>
      redis.call(args[0], ...args.slice(1)) as unknown as Promise<RedisReply>,
    prefix,
  })
}

export function createRateLimiter(options: RateLimiterOptions): ReturnType<typeof rateLimit> {
  const bucket = options.bucket
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    skip: options.skip,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(options.keyGenerator ? { keyGenerator: options.keyGenerator } : {}),
    ...(options.prefix ? { store: buildStore(options.prefix) } : {}),
    ...(bucket ? {
      handler: (_req, res, _next, opts) => {
        recordRateLimitReject(bucket)
        res.status(opts.statusCode).send(opts.message)
      },
    } : {}),
  })
}

// FU-252-E: hash of the caller's own session token — every authenticated
// caller holds a distinct token, so this gives each session its own budget
// instead of every request behind one IP (CGNAT, corporate NAT, mobile
// carrier-grade NAT) sharing a single bucket. `combinedRateLimiter`
// (index.ts) only routes here after matching SESSION_TOKEN_RE, so the header
// is always present and well-formed by this point. Falls back to the
// library's default IP-based key on the (should-be-unreachable) case the
// header is missing, rather than throwing.
export function authTokenKey(req: Request): string {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
  if (!token) return req.ip ? ipKeyGenerator(req.ip) : 'unknown'
  return `tok:${createHash('sha256').update(token).digest('hex')}`
}

// FU-252-E / Product-Launch Sub-Plan 01 §1.2 (founder decision 2026-09-05,
// revised same day after live load-testing): this is the global fallback for
// every request without a valid session token (offer browsing, public read
// routes, login flows, AND — this is the part the first draft of the
// decision missed — every unauthenticated /api/search request too, since
// `combinedRateLimiter` (index.ts) routes here before searchLimiter's own
// middleware ever runs). Raised 60->120/min: a clean live measurement showed
// anonymous search bursts hit exactly this ceiling regardless of
// searchLimiter's own limit, so raising searchLimiter alone (see its
// comment) did not protect anonymous browsing/searching as first assumed —
// only login-bypassed traffic benefited. 120/min still leaves login as the
// real escape hatch for a CGNAT user who wants a bigger, token-keyed budget.
export const unauthenticatedLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  prefix: 'rl:unauth',
  bucket: 'unauth',
  skip: (req) => {
    // FU-221-C: gate demo-login rate-limit bypass on DEMO_LOGIN_ENABLED so the
    // bypass is only active when the endpoint is actually reachable. Without this
    // the limiter would skip even if auth-session.ts returns 403.
    const demoLoginEnabled =
      process.env.DEMO_LOGIN_ENABLED === '1' || process.env.DEMO_LOGIN_ENABLED === 'true'
    if (process.env.NODE_ENV !== 'production' && demoLoginEnabled) {
      if (req.path === '/api/auth/demo') return true
    }
    return false
  },
})

// FU-748 (corrected 2026-09-18): /health sat in the shared anonymous guest
// bucket above — an uptime monitor polling every few seconds drained the
// ENTIRE IP budget (guests behind the same IP saw empty lists) and then got
// 429'd itself; measured live on colabonate.app (130-request burst → /health
// 429, remaining=0). ADR-227 D2 exempted /metrics from the guest bucket for
// exactly this class of infra-probe interference; /health gets a dedicated,
// generous-but-BOUNDED limiter instead of a full exemption because every
// probe pings Postgres + Redis + Meilisearch (not free — a hard exemption
// would be an unauthenticated DoS lever against the DB). Mounted BEFORE
// combinedRateLimiter in index.ts so neither limiter sees the other's
// traffic. 60/min/IP covers any sane monitor cadence (1s polls included)
// with headroom for multi-monitor setups.
export const healthLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  prefix: 'rl:health',
})

export const authenticatedLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 300,
  prefix: 'rl:auth',
  keyGenerator: authTokenKey,
  bucket: 'auth',
})

// FU-252-E / Product-Launch Sub-Plan 01 §1.2 (founder decision 2026-09-05):
// stays IP-keyed by design — search is public and unauthenticated as well as
// authenticated traffic hits it, and the authenticatedLimiter token-key fix
// above does not apply here. Raised 120->240/min so several household
// members browsing behind one shared/CGNAT IP during the invite cohort don't
// share a single search budget. **Only reaches this limiter for a request
// that already passed unauthenticatedLimiter/authenticatedLimiter** —
// `combinedRateLimiter` (index.ts) runs first and 429s an anonymous search
// burst at ITS OWN ceiling before this one ever gets a chance to apply (a
// live load test found this the hard way: raising this value alone did
// nothing for anonymous search traffic). See unauthenticatedLimiter's own
// comment for the corresponding fix on that side.
export const searchLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 240,
  prefix: 'rl:search',
  bucket: 'search',
})

// `emailAuthLimiter` covers the magic-link login flow (/api/auth/email/send,
// /verify, /link-*, …). A user can legitimately retry the link once or twice
// (page reload, accidental double-click, "request a new link" button), so 30
// per hour is enough headroom without inviting real abuse. Separate Redis
// prefix from `emailLimiter` so contact-form / newsletter buckets stay
// independent.
export const emailAuthLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: buildStore('rl:email-auth'),
  message: {
    error: 'Too many email-login requests',
    message: 'You have requested several magic-link emails in a short time. Please wait a minute before trying again.',
    retryAfterSeconds: 3600,
  },
  handler: (_req, res, _next, opts) => {
    recordRateLimitReject('email-auth')
    res.status(opts.statusCode).send(opts.message)
  },
})

// Tight 5/hour for /api/feedback and /api/newsletter (real spam vectors).
export const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: buildStore('rl:email'),
  message: {
    error: 'Too many requests',
    message: 'Please wait a while before submitting again.',
    retryAfterSeconds: 3600,
  },
  handler: (_req, res, _next, opts) => {
    recordRateLimitReject('email')
    res.status(opts.statusCode).send(opts.message)
  },
})