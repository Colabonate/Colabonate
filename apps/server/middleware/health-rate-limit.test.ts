import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// FU-748 (corrected 2026-09-18): /health must live in its OWN rate-limit
// budget, mounted before combinedRateLimiter. Two properties matter:
//   1. bounded — a runaway/abusive poller still gets capped (60/min/IP),
//      because every probe pings Postgres/Redis/Meili;
//   2. independent — health traffic must NOT consume the anonymous guest
//      bucket, and a burned guest budget must NOT 429 the health probe
//      (uptime monitors depend on it; ADR-227 D2's /metrics reasoning).
//
// The limiters are module singletons with in-memory stores in the test env,
// so each test re-imports the module fresh (vi.resetModules) — otherwise the
// window counters leak between tests.

let healthLimiter: typeof import('./rate-limit.js').healthLimiter
let unauthenticatedLimiter: typeof import('./rate-limit.js').unauthenticatedLimiter

beforeEach(async () => {
  vi.resetModules()
  ;({ healthLimiter, unauthenticatedLimiter } = await import('./rate-limit.js'))
})

function buildApp() {
  const app = express()
  // Mirrors the mounting order in index.ts exactly: path-scoped health
  // budget first (a bare app.use(healthLimiter) would wrongly swallow API
  // traffic into the health bucket — caught live on the throwaway server),
  // then the combined limiter for everything else.
  app.use('/health', healthLimiter)
  app.get('/health', (_req, res) => res.status(200).json({ status: 'healthy' }))
  app.use('/api', unauthenticatedLimiter)
  app.get('/api/probe', (_req, res) => res.status(200).json({ ok: true }))
  return app
}

describe('healthLimiter', () => {
  it('still bounds runaway health polling (429 past its own 60/min cap)', async () => {
    const app = buildApp()
    // Exhaust the health budget…
    for (let i = 0; i < 60; i++) {
      const res = await request(app).get('/health')
      expect(res.status).toBe(200)
    }
    // …the 61st request in the same window is capped by the healthLimiter
    // itself (bounded, not exempt — each probe costs DB/Redis/Meili pings).
    const capped = await request(app).get('/health')
    expect(capped.status).toBe(429)
  })

  it('health traffic does not consume the anonymous guest bucket', async () => {
    const app = buildApp()
    // Burn the FULL health budget…
    for (let i = 0; i < 70; i++) {
      await request(app).get('/health')
    }
    // …and the guest bucket is untouched: an anonymous API request still
    // passes with its complete 120/min budget.
    const guest = await request(app).get('/api/probe')
    expect(guest.status).toBe(200)
  })

  it('a burned guest budget does not 429 the health probe', async () => {
    const app = buildApp()
    // Burn the anonymous guest bucket via API requests…
    for (let i = 0; i < 121; i++) {
      await request(app).get('/api/probe')
    }
    expect((await request(app).get('/api/probe')).status).toBe(429)
    // …the health probe answers from its own budget regardless.
    const health = await request(app).get('/health')
    expect(health.status).toBe(200)
  })
})

describe('health mounting order (index.ts)', () => {
  it('mounts healthLimiter + health router BEFORE combinedRateLimiter', () => {
    // Source-order contract, same spirit as middleware/auth-coverage.test.ts:
    // the health budget only stays independent while the mounting precedes
    // the combined limiter. Guards against an accidental reordering during
    // future middleware work.
    const indexPath = fileURLToPath(new URL('../index.ts', import.meta.url))
    const source = readFileSync(indexPath, 'utf-8')
    const healthMount = source.indexOf("app.use('/health', healthLimiter)")
    const combinedMount = source.indexOf('app.use(combinedRateLimiter)')
    expect(healthMount, "app.use('/health', healthLimiter) must exist in index.ts").toBeGreaterThan(-1)
    expect(combinedMount, 'app.use(combinedRateLimiter) must exist in index.ts').toBeGreaterThan(-1)
    expect(healthMount, 'healthLimiter must mount before combinedRateLimiter (FU-748)').toBeLessThan(combinedMount)
  })
})
