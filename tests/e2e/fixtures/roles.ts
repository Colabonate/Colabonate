import { test as base, expect } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'

// ADR-377 D4: role fixtures are the standard auth primitive for UI journeys.
// Each role gets a fresh browser context with a unique-per-run hex pubkey and
// a demo-login session (POST /api/auth/demo, DEMO_LOGIN_ENABLED=1 comes from
// playwright.config.ts) seeded into localStorage before any app script runs —
// the proven pattern from coop-guide-nav.spec.ts (FU-640).

export type RoleName = 'buyer' | 'seller' | 'partner'

const ROLE_HEX_PREFIX: Record<RoleName, string> = {
  buyer: 'b0',
  seller: '50',
  partner: 'a0',
}

/** Unique hex pubkey per call (B4): role prefix + timestamp + randomness, zero-padded to 64 chars. */
export function rolePubkey(role: RoleName): string {
  const uniq = (Date.now().toString(16) + Math.random().toString(16).slice(2, 10)).replace(/[^0-9a-f]/g, '')
  return (ROLE_HEX_PREFIX[role] + uniq).padEnd(64, '0').slice(0, 64)
}

/**
 * Creates a new authenticated browser context for `role`.
 * The returned page has `pubkey` + `authToken` in localStorage for every
 * navigation — pass `page` straight into journey steps.
 */
export async function authedPage(browser: Browser, role: RoleName): Promise<Page> {
  const pubkey = rolePubkey(role)
  const context = await browser.newContext()
  const res = await context.request.post('/api/auth/demo', { data: { pubkey } })
  if (!res.ok()) {
    await context.close()
    throw new Error(
      `demo login failed for role "${role}": HTTP ${res.status()} — ` +
      'is the server running with DEMO_LOGIN_ENABLED=1 (playwright.config.ts webServer default)?',
    )
  }
  const { token } = (await res.json()) as { pubkey: string; token: string }
  if (!token) {
    await context.close()
    throw new Error(`demo login for role "${role}" returned no token`)
  }
  await context.addInitScript(
    ([p, t]) => {
      localStorage.setItem('pubkey', p as string)
      localStorage.setItem('authToken', t as string)
    },
    [pubkey, token] as const,
  )
  return context.newPage()
}

type RolePageFixtures = {
  buyer: Page
  seller: Page
  partner: Page
}

/**
 * `journeyTest` extends `test` with one authenticated page per role. Roles are
 * lazy — a fixture only mints a session when the test destructures it, so a
 * buy-only journey never pays for a seller context.
 *
 * ```ts
 * journeyTest('buyer releases escrow', async ({ buyer, seller }) => { ... })
 * ```
 */
export const journeyTest = base.extend<RolePageFixtures>({
  buyer: async ({ browser }, use) => {
    const page = await authedPage(browser, 'buyer')
    await use(page)
    await page.context().close()
  },
  seller: async ({ browser }, use) => {
    const page = await authedPage(browser, 'seller')
    await use(page)
    await page.context().close()
  },
  partner: async ({ browser }, use) => {
    const page = await authedPage(browser, 'partner')
    await use(page)
    await page.context().close()
  },
})

export { expect }

const SERVER_BASE_URL = process.env.PLAYWRIGHT_SERVER_URL || 'http://localhost:4001'

/**
 * Mint a demo session straight from Node (no browser). Returns null when the
 * server refuses demo login (403 DEMO_LOGIN_ENABLED missing) — the documented
 * FU-640 pitfall of `reuseExistingServer` picking up a foreign dev server.
 * Callers `test.skip(!session, ...)` on null so CI (which always boots the
 * server with the flag from playwright.config.ts) stays strict while local
 * runs against a reused server skip cleanly instead of failing.
 */
export async function demoSession(pubkey: string): Promise<{ pubkey: string; token: string } | null> {
  const res = await fetch(`${SERVER_BASE_URL}/api/auth/demo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pubkey }),
  })
  if (!res.ok) return null
  const data = (await res.json()) as { pubkey: string; token: string }
  return data.token ? data : null
}

export const DEMO_LOGIN_SKIP_REASON =
  'demo login disabled on the reused dev server (DEMO_LOGIN_ENABLED != 1, FU-640 pitfall) — CI boots its own server with the flag'
