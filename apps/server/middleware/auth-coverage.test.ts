// apps/server/middleware/auth-coverage.test.ts — FU-212-C: CI lint that fails the build
// if any state-changing app.{post,patch,delete} route is added without `requireAuth(prisma)`.
//
// This mirrors `scripts/beta/auth-coverage.ts` but runs as a vitest unit test inside
// `pnpm test` / `pnpm test:ci`. It does NOT require a running server or any HTTP — it
// reads `apps/server/index.ts` as text and pattern-matches route declarations.
//
// The test is intentionally lenient: a future ROUTE that does not match any entry in
// `REQUIRED` is reported but does NOT fail the build (we don't want to block additions
// of unknown routes; we just want to enforce the auth contract on the named routes).
// The named routes that DO need `requireAuth` MUST all pass.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO = resolve(__dirname, '..', '..', '..')
const INDEX_TS = join(REPO, 'apps', 'server', 'index.ts')

interface Endpoint {
  name: string
  method: 'post' | 'patch' | 'delete' | 'get' | 'put'
  path: string
}

const REQUIRED: Endpoint[] = [
  // ADR-212 P0 — state/money endpoints, must always carry requireAuth(prisma).
  { name: 'PATCH /api/cooperations/:id/status', method: 'patch', path: '/api/cooperations/:id/status' },
  { name: 'POST /api/cooperations/:id/fund-escrow', method: 'post', path: '/api/cooperations/:id/fund-escrow' },
  { name: 'POST .../milestones/:mid/release-payment', method: 'post', path: '/api/cooperations/:id/milestones/:mid/release-payment' },
  { name: 'POST /api/tickets/:id/release-payment', method: 'post', path: '/api/tickets/:id/release-payment' },
  { name: 'POST .../applications/:appId/accept', method: 'post', path: '/api/cooperations/:id/milestones/:mid/applications/:appId/accept' },
  { name: 'POST .../applications/:appId/decline', method: 'post', path: '/api/cooperations/:id/milestones/:mid/applications/:appId/decline' },
  // ADR-212 P2 — read-IDOR endpoints, must always carry requireAuth(prisma).
  { name: 'GET /api/tickets/:id/payment-status', method: 'get', path: '/api/tickets/:id/payment-status' },
  { name: 'GET /api/cooperations/:id', method: 'get', path: '/api/cooperations/:id' },
  { name: 'GET .../applications', method: 'get', path: '/api/cooperations/:id/milestones/:mid/applications' },
  // ADR-235 — per-user preference writes, must always carry requireAuth(prisma).
  { name: 'PATCH /api/user/:pubkey/currency', method: 'patch', path: '/api/user/:pubkey/currency' },
]

function escape(path: string): string {
  return path
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:[a-zA-Z]+/g, '[^,\\)\'\"\\s]+')
}

function checkEndpoint(src: string, ep: Endpoint): { found: boolean; authed: boolean } {
  const pat = new RegExp(
    `app\\.${ep.method}\\s*\\(\\s*['"\`]${escape(ep.path)}['"\`]\\s*,\\s*([^,]+(?:,[^,]+)*?)\\s*async\\s*\\(`,
    'm',
  )
  const m = src.match(pat)
  if (!m) return { found: false, authed: false }
  return {
    found: true,
    authed: /requireAuth\s*\(\s*prisma\s*\)/.test(m[1]),
  }
}

// Escrow/dispute/private-verdict routers are mounted on the bare '/api' path,
// so auth cannot live at the mount — each route carries the guard itself
// (`...guard` = [requireAuth(prisma), enforceCallerIdentity]).
const ROUTER_REQUIRED: Array<Endpoint & { file: string }> = [
  { name: 'POST /tickets/:id/escrow/phase1', method: 'post', path: '/tickets/:id/escrow/phase1', file: 'escrow.ts' },
  { name: 'POST /tickets/:id/escrow/phase2', method: 'post', path: '/tickets/:id/escrow/phase2', file: 'escrow.ts' },
  { name: 'POST /tickets/:id/escrow/phase3', method: 'post', path: '/tickets/:id/escrow/phase3', file: 'escrow.ts' },
  { name: 'POST /tickets/:id/escrow/release', method: 'post', path: '/tickets/:id/escrow/release', file: 'escrow.ts' },
  { name: 'POST /tickets/:id/escrow/cancel', method: 'post', path: '/tickets/:id/escrow/cancel', file: 'escrow.ts' },
  { name: 'POST /tickets/:id/dispute', method: 'post', path: '/tickets/:id/dispute', file: 'dispute.ts' },
  { name: 'POST /tickets/:id/nominate-arbiter', method: 'post', path: '/tickets/:id/nominate-arbiter', file: 'dispute.ts' },
  { name: 'POST /tickets/:id/accept-arbiter', method: 'post', path: '/tickets/:id/accept-arbiter', file: 'dispute.ts' },
  { name: 'GET /tickets/:id/arbiters', method: 'get', path: '/tickets/:id/arbiters', file: 'dispute.ts' },
  { name: 'POST /disputes/:id/escalate', method: 'post', path: '/disputes/:id/escalate', file: 'dispute.ts' },
  { name: 'POST /disputes/:id/withdraw', method: 'post', path: '/disputes/:id/withdraw', file: 'dispute.ts' },
  { name: 'GET /disputes', method: 'get', path: '/disputes', file: 'dispute.ts' },
  { name: 'GET /disputes/:id', method: 'get', path: '/disputes/:id', file: 'dispute.ts' },
  { name: 'GET /disputes/:id/appeal', method: 'get', path: '/disputes/:id/appeal', file: 'dispute.ts' },
  { name: 'POST /disputes/:id/appeal', method: 'post', path: '/disputes/:id/appeal', file: 'dispute.ts' },
  { name: 'POST /disputes/:id/verdict', method: 'post', path: '/disputes/:id/verdict', file: 'dispute.ts' },
  { name: 'POST /disputes/:id/disclose', method: 'post', path: '/disputes/:id/disclose', file: 'dispute.ts' },
  { name: 'GET /disputes/:id/disclosures', method: 'get', path: '/disputes/:id/disclosures', file: 'dispute.ts' },
  { name: 'POST /disputes/:id/check-forfeit', method: 'post', path: '/disputes/:id/check-forfeit', file: 'dispute.ts' },
  { name: 'POST /tickets/:id/private-verdict', method: 'post', path: '/tickets/:id/private-verdict', file: 'private-verdict.ts' },
  // FU-749 — identity upgrade mutates an account; session-ownership auth is mandatory.
  { name: 'POST /identity/upgrade-l1', method: 'post', path: '/upgrade-l1', file: 'identity.ts' },
]

function checkRouterEndpoint(src: string, ep: Endpoint): { found: boolean; authed: boolean } {
  const pat = new RegExp(
    `router\\.${ep.method}\\s*\\(\\s*['"\`]${escape(ep.path)}['"\`]\\s*,\\s*(.*?)async\\s*\\(`,
    'm',
  )
  const m = src.match(pat)
  if (!m) return { found: false, authed: false }
  return {
    found: true,
    authed: /\.\.\.guard|requireAuth\s*\(\s*prisma\s*\)/.test(m[1]),
  }
}

describe('ADR-212 auth coverage (FU-212-C)', () => {
  const src = readFileSync(INDEX_TS, 'utf8')

  it('every required protected route mounts requireAuth(prisma)', () => {
    const violations: string[] = []
    for (const ep of REQUIRED) {
      const { found, authed } = checkEndpoint(src, ep)
      if (!found) {
        violations.push(`${ep.name} — route not found in index.ts (was it renamed?)`)
        continue
      }
      if (!authed) {
        violations.push(`${ep.name} — found but requireAuth(prisma) is missing from the middleware chain`)
      }
    }
    if (violations.length > 0) {
      throw new Error(
        'Auth-coverage violations (CI gate tripped):\n  - ' + violations.join('\n  - '),
      )
    }
    expect(violations).toEqual([])
  })

  it('every escrow/dispute/private-verdict route carries the auth guard', () => {
    const sources = new Map<string, string>()
    const violations: string[] = []
    for (const ep of ROUTER_REQUIRED) {
      if (!sources.has(ep.file)) {
        sources.set(ep.file, readFileSync(join(REPO, 'apps', 'server', 'routes', ep.file), 'utf8'))
      }
      const { found, authed } = checkRouterEndpoint(sources.get(ep.file)!, ep)
      if (!found) {
        violations.push(`${ep.name} (${ep.file}) — route not found (was it renamed?)`)
        continue
      }
      if (!authed) {
        violations.push(`${ep.name} (${ep.file}) — found but ...guard / requireAuth(prisma) is missing`)
      }
    }
    if (violations.length > 0) {
      throw new Error(
        'Auth-coverage violations (CI gate tripped):\n  - ' + violations.join('\n  - '),
      )
    }
    expect(violations).toEqual([])
  })

  it('wallet and upload routers mount requireAuth(prisma)', () => {
    for (const mount of ['/api/wallet', '/api/upload']) {
      const pat = new RegExp(`app\\.use\\(\\s*['"\`]${mount.replace(/\//g, '\\/')}['"\`]\\s*,\\s*requireAuth\\s*\\(\\s*prisma\\s*\\)`)
      expect(pat.test(src), `${mount} must mount requireAuth(prisma)`).toBe(true)
    }
  })
})

describe('FU-221-C demo-login flag gate', () => {
  const SESSION_TS = join(REPO, 'apps', 'server', 'routes', 'auth-session.ts')
  const RATE_LIMIT_TS = join(REPO, 'apps', 'server', 'middleware', 'rate-limit.ts')

  function readOrFail(path: string): string {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      throw new Error(`Cannot read ${path} (test environment broken, was the file renamed?)`)
    }
  }

  it('auth-session /demo route gates on DEMO_LOGIN_ENABLED, not just NODE_ENV', () => {
    const src = readOrFail(SESSION_TS)
    // The guard must check both NODE_ENV=production AND the new flag. Pre-FU-221-C
    // code only checked NODE_ENV (the ADR-215 tunnel-basic-auth bypass loophole).
    expect(src).toMatch(/process\.env\.DEMO_LOGIN_ENABLED/)
    expect(src).toMatch(/NODE_ENV\s*===\s*['"]production['"]\s*\|\|\s*!?demoLoginEnabled/)
    // Fail-closed response must mention the flag name so operators can self-diagnose.
    expect(src).toMatch(/DEMO_LOGIN_ENABLED=1/)
  })

  it('rate-limit unauthenticatedLimiter skip honours DEMO_LOGIN_ENABLED', () => {
    const src = readOrFail(RATE_LIMIT_TS)
    // The /api/auth/demo rate-limit bypass must be gated by the same flag — otherwise
    // the bypass is active even when the endpoint is closed (inconsistent UX).
    expect(src).toMatch(/DEMO_LOGIN_ENABLED/)
    expect(src).toMatch(/req\.path\s*===\s*['"]\/api\/auth\/demo['"]/)
  })
})