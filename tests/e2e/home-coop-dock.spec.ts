import { test, expect, type Page } from '@playwright/test'

// ADR-324: Home → /search scroll-dock transition + Search data prefetch
// (supersedes the ADR-303 dock section, which targeted /coop).
//
// The dock preview is rendered after the Footer in Layout.tsx and mirrors
// Search's above-the-fold. An IntersectionObserver prefetches the Search
// chunk + data queries 600px ahead, and a commit observer fires
// navigate('/search?context=coop', { state: { fromDock: true } }) when 70%
// of the preview is visible (COMMIT_PROGRESS = 0.7).
//
// Tests cover the behaviours promised in ADR-324 §Implementation Plan step 7:
// (a) commit lands on /search?context=coop, (b) abort below threshold,
// (c) reduced-motion static CTA, (d) guest can dock all the way through
// (no /login bounce), (e) dock prefetch warms the TanStack cache,
// (f) guest action → login → returnTo round-trip (ADR-303 D9, unaffected).

const APP_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173'

async function goHome(page: Page) {
  await page.goto(APP_URL)
  // ensure a fresh window regardless of test ordering
  await page.evaluate(() => { try { localStorage.clear() } catch { /* noop */ } })
  await page.goto(APP_URL)
  await page.waitForLoadState('networkidle')
}

async function scrollPastDock(page: Page) {
  // Scroll past the home content + the full dock block — way beyond the
  // COMMIT_PROGRESS threshold (0.7).
  await page.evaluate(() => {
    const total = document.documentElement.scrollHeight + window.innerHeight * 1.5
    window.scrollTo({ top: total, behavior: 'instant' as ScrollBehavior })
  })
}

test.describe('ADR-324 Home → /search scroll-dock + data cache', () => {
  test('(a) full dock-through lands on /search?context=coop with real Search', async ({ page }) => {
    await goHome(page)
    await scrollPastDock(page)

    // Wait for the navigation away from / to settle.
    await page.waitForURL((url) => url.pathname === '/search', { timeout: 10_000 })

    // Real Search renders with the Cooperate context active (URL param +
    // selected segment in the ContextSwitcher tablist).
    expect(page.url()).toContain('context=coop')
    await expect(page.getByRole('tab', { name: /Cooperate/ })).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 })
  })

  test('(b) abort below threshold stays on /', async ({ page }) => {
    await goHome(page)

    // Scroll so only ~35% of the dock block is visible — inside the prefetch
    // range but well below COMMIT_PROGRESS (0.7).
    await page.evaluate(() => {
      const el = document.querySelector('section[aria-label="Search & Explore"]') as HTMLElement
      const rect = el.getBoundingClientRect()
      const dockTop = rect.top + window.scrollY
      window.scrollTo({ top: dockTop + rect.height * 0.35 - window.innerHeight, behavior: 'instant' as ScrollBehavior })
    })

    // Give the observers a moment, then assert we're still on Home.
    await page.waitForTimeout(500)
    expect(new URL(page.url()).pathname).toBe('/')

    // Scroll back up entirely — the dock must be fully reversible.
    await page.evaluate(() => { window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }) })
    await page.waitForTimeout(300)
    expect(new URL(page.url()).pathname).toBe('/')
  })

  test('(c) reduced-motion shows static CTA pointing to /search', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await goHome(page)

    // The reduced-motion fallback is a static CTA card — no observers, no
    // auto-navigation. It must link to /search?context=coop.
    const cta = page.getByRole('link', { name: /Search & Explore/ })
    await expect(cta).toBeVisible({ timeout: 10_000 })
    const href = await cta.getAttribute('href')
    expect(href).toContain('/search')
    expect(href).toContain('context=coop')

    // No auto-commit under reduced motion, even when scrolled to the end.
    await scrollPastDock(page)
    await page.waitForTimeout(500)
    expect(new URL(page.url()).pathname).toBe('/')
  })

  test('(d) guest can dock through to /search (no /login bounce)', async ({ page }) => {
    // Stay logged out (no localStorage mutation).
    await goHome(page)
    await scrollPastDock(page)

    await page.waitForURL((url) => url.pathname === '/search', { timeout: 10_000 })

    // /search must render for guests — no /login redirect.
    await expect(page.getByRole('tab', { name: /Cooperate/ })).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 })
    expect(new URL(page.url()).pathname).not.toBe('/login')
  })

  test('(e) dock prefetch warms coop-explore-data + offer-search caches', async ({ page }) => {
    // Route-mock the API so this test is deterministic: it verifies the
    // prefetch → TanStack cache pipeline, not the server. Against the live
    // test server, 6 sequential Home loads blow the 60 req/min rate limit,
    // and fetchCoopExploreData's catch-all turns 429s into cached EMPTY data
    // (no retry) — a real degradation note, but not what this test asserts.
    const empty = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    await page.route('**/api/standard-categories/tree/flat*', (r) => r.fulfill(empty({ standardCategories: [] })))
    await page.route('**/api/cooperations/discover*', (r) => r.fulfill(empty({ cooperations: [], edges: [], pageInfo: {} })))
    await page.route('**/api/offers*', (r) => r.fulfill(empty({ offers: [], edges: [], pageInfo: {} })))
    await page.route('**/api/companies*', (r) => r.fulfill(empty({ companies: [], edges: [], pageInfo: {} })))
    await page.route('**/api/partners*', (r) => r.fulfill(empty({ items: [] })))
    await page.route('**/api/search*', (r) => r.fulfill(empty({ hits: [], estimatedTotalHits: 0, processingTimeMs: 1 })))

    await goHome(page)

    // Register the response waits BEFORE scrolling so neither prefetch
    // response can be missed. Since ADR-376 D1/D5 + ADR-363 D1 the dock
    // prefetch warms the canonical shared queries: cooperations-discover
    // (first=100) and the ['listings','marketplace'] infinite feed via
    // /api/search (first=100, cursor-paginated — the old opaque
    // ['coop-explore-data'] bundle and first=200 search no longer exist).
    const coopResponse = page.waitForResponse(
      (r) => r.url().includes('/api/cooperations/discover') && r.url().includes('first=100') && r.ok(),
      { timeout: 15_000 },
    )
    const searchResponse = page.waitForResponse(
      (r) => r.url().includes('/api/search') && r.url().includes('first=100') && r.ok(),
      { timeout: 15_000 },
    )

    await scrollPastDock(page)
    await Promise.all([coopResponse, searchResponse])

    // The results land in the persisted TanStack cache (persister throttle is
    // 1s — poll until both query keys show up).
    const persisted = () => page.evaluate(() => localStorage.getItem('TANSTACK_QUERY_OFFLINE_CACHE') ?? '')
    await expect.poll(persisted, { timeout: 10_000 }).toContain('cooperations-discover')
    await expect.poll(persisted, { timeout: 10_000 }).toContain('listings')
  })

  // Scroll exactly to the LOCK point: the whole trigger section fully visible
  // with DOCK_BOTTOM_GAP (80px) below it. Past this point the page must stop
  // scrolling entirely — further input only builds virtual tension.
  // Home keeps growing after networkidle (sliders/images hydrate late) — the
  // dock can shift by thousands of px, so wait for the page height to
  // stabilize first, then re-anchor once after another settle window.
  async function scrollToLockPoint(page: Page): Promise<number> {
    await page.waitForFunction(() => {
      const w = window as unknown as { __lastH?: number; __lastT?: number }
      const h = document.documentElement.scrollHeight
      const now = Date.now()
      if (h !== w.__lastH) {
        w.__lastH = h
        w.__lastT = now
        return false
      }
      return now - (w.__lastT ?? 0) > 500
    }, undefined, { timeout: 15_000 })
    const lockY = await page.evaluate(() => {
      const el = document.querySelector('section[aria-label="Search & Explore"]') as HTMLElement
      const stage = el.querySelector('[data-dock-stage]') as HTMLElement
      const secTop = el.getBoundingClientRect().top + window.scrollY
      return Math.max(0, Math.round(secTop + stage.offsetHeight + 80 - window.innerHeight))
    })
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }), lockY)
    await page.waitForTimeout(500)
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }), lockY)
    await page.waitForTimeout(400)
    return lockY
  }

  test('(g) page locks at the trigger; sustained wheeling commits', async ({ page }) => {
    await goHome(page)
    await scrollToLockPoint(page)
    const beforeY = await page.evaluate(() => window.scrollY)

    // 4 wheel ticks × 120px build tension but must NOT commit and — the core
    // assertion — must NOT move the page: scrollY stays frozen at the lock.
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 120)
      await page.waitForTimeout(70)
    }
    await page.waitForTimeout(600)
    expect(new URL(page.url()).pathname).toBe('/')
    const frozenY = await page.evaluate(() => window.scrollY)
    expect(Math.abs(frozenY - beforeY)).toBeLessThanOrEqual(2)

    // Keep wheeling — sustained input overcomes the band. Catch the moment
    // tension hits 1 (commit fired, route transition pending): the page must
    // stay frozen even under continued wheel input until /search takes over.
    let caughtCommit = false
    let preCommitY = 0
    for (let i = 0; i < 60; i++) {
      await page.mouse.wheel(0, 120)
      await page.waitForTimeout(30)
      const st = await page.evaluate(() => ({
        p: parseFloat(getComputedStyle(document.querySelector('section[aria-label="Search & Explore"]')).getPropertyValue('--dock-progress')),
        y: Math.round(window.scrollY),
        path: location.pathname,
      }))
      if (st.path !== '/') break // route already swapped — hold window over
      if (st.p >= 1) {
        caughtCommit = true
        preCommitY = st.y
        for (let k = 0; k < 5; k++) await page.mouse.wheel(0, 200)
        await page.waitForTimeout(120)
        const post = await page.evaluate(() => ({ y: window.scrollY, path: location.pathname }))
        if (post.path === '/') {
          expect(Math.abs(post.y - preCommitY)).toBeLessThanOrEqual(2)
        }
        break
      }
    }
    // The commit must actually have been reached (guards against a silently
    // broken tension model passing the waitForURL below for other reasons).
    expect(caughtCommit || new URL(page.url()).pathname === '/search').toBe(true)

    await page.waitForURL((url) => url.pathname === '/search', { timeout: 10_000 })
  })

  test('(g2) tension springs back while the page stays locked', async ({ page }) => {
    await goHome(page)
    await scrollToLockPoint(page)
    const beforeY = await page.evaluate(() => window.scrollY)

    // Fight partway into the band, then stop.
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 120)
      await page.waitForTimeout(70)
    }
    await page.waitForTimeout(600) // let the consumed ticks settle
    const mid = await page.evaluate(() => {
      const el = document.querySelector('section[aria-label="Search & Explore"]') as HTMLElement
      return { y: window.scrollY, p: getComputedStyle(el).getPropertyValue('--dock-progress').trim() }
    })
    expect(parseFloat(mid.p)).toBeGreaterThan(0.35) // tension built up
    expect(Math.abs(mid.y - beforeY)).toBeLessThanOrEqual(2) // page never moved

    // Idle > SPRING_IDLE_MS → the band relaxes (viz decays to 0). The page
    // stays locked the whole time, no commit.
    await page.waitForTimeout(2000)
    const settled = await page.evaluate(() => {
      const el = document.querySelector('section[aria-label="Search & Explore"]') as HTMLElement
      return { y: window.scrollY, p: getComputedStyle(el).getPropertyValue('--dock-progress').trim() }
    })
    expect(Math.abs(parseFloat(settled.p))).toBeLessThan(0.05)
    expect(Math.abs(settled.y - beforeY)).toBeLessThanOrEqual(2)
    expect(new URL(page.url()).pathname).toBe('/')
  })

  test('(h) mobile viewport: short input commits and progress persists while idling', async ({ page }) => {
    // FU-342 mobile tuning: at the lock a commit should cost ~1 screen of raw
    // input (near-linear tension, shorter spacer) and partial progress must
    // NOT spring back during a pause — 1–2 short swipes are enough. isMobile
    // keys on viewport width, so a 390px viewport activates the mobile path
    // even though headless Chromium reports a fine pointer.
    await page.setViewportSize({ width: 390, height: 844 })
    await goHome(page)
    await scrollToLockPoint(page)
    const beforeY = await page.evaluate(() => window.scrollY)

    // Two 120px ticks — well under a screen — already build visible tension
    // while the page stays frozen at the lock.
    for (let i = 0; i < 2; i++) {
      await page.mouse.wheel(0, 120)
      await page.waitForTimeout(70)
    }
    const mid = await page.evaluate(() => {
      const el = document.querySelector('section[aria-label="Search & Explore"]') as HTMLElement
      return { y: window.scrollY, p: parseFloat(getComputedStyle(el).getPropertyValue('--dock-progress')) }
    })
    expect(mid.p).toBeGreaterThan(0.4)
    expect(Math.abs(mid.y - beforeY)).toBeLessThanOrEqual(2)

    // Idle well past SPRING_IDLE_MS: on mobile the band must NOT relax —
    // partial progress persists, so the next swipe continues where this one
    // stopped (the desktop (g2) test asserts the opposite decay).
    await page.waitForTimeout(1800)
    const idleP = parseFloat(await page.evaluate(() => {
      const el = document.querySelector('section[aria-label="Search & Explore"]') as HTMLElement
      return getComputedStyle(el).getPropertyValue('--dock-progress')
    }))
    expect(idleP).toBeGreaterThan(0.3)

    // A few more ticks commit — a fraction of the sustained desktop budget.
    let committed = false
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 120)
      await page.waitForTimeout(30)
      committed = (await page.evaluate(() => location.pathname)) !== '/'
      if (committed) break
    }
    expect(committed).toBe(true)
    await page.waitForURL((url) => url.pathname === '/search', { timeout: 10_000 })
  })

  test('(f) guest action → login → returnTo round-trip', async ({ page }) => {
    await page.goto(APP_URL)
    await page.evaluate(() => { try { localStorage.clear() } catch { /* noop */ } })

    // Visit /buy/cart while logged out — the loader-level requireAuth
    // redirects to /login with ?next=/buy/cart.
    await page.goto(`${APP_URL}/buy/cart`)
    await page.waitForURL((url) => url.pathname === '/login', { timeout: 10_000 })
    expect(new URL(page.url()).search).toContain('next=')
    expect(decodeURIComponent(new URL(page.url()).search)).toContain('/buy/cart')

    // Log in via the demo endpoint (gated by DEMO_LOGIN_ENABLED=1, set in
    // playwright.config.ts; mock-payment + dev mode). Use the REAL token from
    // the response — a placeholder token fails server-side session validation
    // and bounces back to /login.
    const login = await page.evaluate(async () => {
      const res = await fetch('/api/auth/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pubkey: 'test-buyer-pubkey-0000000000000000000000000000000000000000000000000000000000' }),
      })
      if (!res.ok) return null
      return res.json() as Promise<{ pubkey: string; token: string }>
    })
    // Locally Playwright reuses an already-running dev server
    // (reuseExistingServer), which may lack DEMO_LOGIN_ENABLED=1 — skip then.
    // In CI the server starts fresh from playwright.config.ts env and the
    // full round-trip runs.
    test.skip(!login, 'demo login disabled on the reused dev server (DEMO_LOGIN_ENABLED != 1)')

    // The login tab helper redirects to the validated returnTo.
    await page.evaluate(({ pubkey, token }) => {
      localStorage.setItem('pubkey', pubkey)
      localStorage.setItem('authToken', token)
    }, login!)
    await page.goto(`${APP_URL}/buy/cart`)
    await expect(page).toHaveURL(/\/buy\/cart/, { timeout: 10_000 })
  })
})
