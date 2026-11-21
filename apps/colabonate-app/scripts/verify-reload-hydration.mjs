// ADR-294 verification: reload/first-visit hydration against the REAL
// production build (dist/) served by `vite preview`, with a stubbed API.
//
// Orchestrates everything after `vite build`:
//   1. stub API server (deterministic data for the public Home queries)
//   2. re-run scripts/prerender.mjs with PRERENDER_API_PROXY pointed at the
//      stub  → dist/index.html must contain an allowlisted __RQ_STATE__ seed
//   3. spawn vite preview
//   4. Playwright scenarios, measured via getComputedStyle(#app-splash)
//      .visibility === 'hidden' (NOT class presence — the v0.1.1 stuck-splash
//      regression slipped through class-presence checks, see ADR-290):
//        warm     — seeded localStorage, API delayed 2000ms → splash must hide
//                   from the cache (~eval+700ms floor), never from the network
//        baseline — same but EMPTY cache → must wait for the delayed fetch
//                   (proves the delay actually bites in the warm/cold runs)
//        cold     — empty cache + prerender __RQ_STATE__ seed, API delayed
//                   2000ms → hides fast, tag removed, cache seeded in storage
//        expired  — cache dataUpdatedAt rewound 25h → restore discards →
//                   waits for the delayed (1500ms) fetch, never stuck
//        hung     — API never responds → ADR-290 MAX_WAIT_MS=4000 fallback
//
// Usage: node scripts/verify-reload-hydration.mjs   (from apps/colabonate-app,
// after `npx pnpm build`)

import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PREVIEW_PORT = 41730
const origin = `http://127.0.0.1:${PREVIEW_PORT}`

// ── Stub API data (public Home queries only) ────────────────────────────────

const STUB_OFFERS = [
  {
    id: 'stub-offer-1',
    title: 'ADR-294 Stub Offer Alpha',
    description: 'Deterministic stub product for reload-hydration verification.',
    priceSats: 21_000,
    images: [],
    offerType: 'PRODUCT',
    categoryCode: 'stub-hydroponics',
    city: 'Berlin',
    location: 'Stub Street 1, Berlin, 10115, Germany',
    country: 'DE',
    createdAt: '2026-08-01T12:00:00.000Z',
    creatorPubkey: 'a'.repeat(64),
    creator: { lnAddress: 'alpha@stub.local' },
    sellerStats: { rating: 4.8, reviewCount: 12 },
  },
  {
    id: 'stub-offer-2',
    title: 'ADR-294 Stub Offer Beta',
    description: 'Deterministic stub service for reload-hydration verification.',
    priceSats: 33_000,
    images: [],
    offerType: 'SERVICE',
    categoryCode: 'stub-hydroponics',
    city: 'Berlin',
    location: 'Stub Street 2, Berlin, 10115, Germany',
    country: 'DE',
    createdAt: '2026-08-02T12:00:00.000Z',
    creatorPubkey: 'b'.repeat(64),
    creator: { lnAddress: 'beta@stub.local' },
    sellerStats: { rating: 4.2, reviewCount: 7 },
  },
  {
    id: 'stub-offer-3',
    title: 'ADR-294 Stub Offer Gamma',
    description: 'Deterministic stub coop offer for reload-hydration verification.',
    priceSats: 50_000,
    images: [],
    offerType: 'COOP',
    categoryCode: 'stub-hydroponics',
    city: 'Vienna',
    location: 'Stub Street 3, Vienna, 1010, Austria',
    country: 'AT',
    createdAt: '2026-08-03T12:00:00.000Z',
    creatorPubkey: 'c'.repeat(64),
    creator: { lnAddress: 'gamma@stub.local' },
    sellerStats: { rating: 5, reviewCount: 3 },
  },
]

function stubBody(pathname) {
  if (pathname === '/api/offers/count-by-category') {
    return { counts: [{ categoryCode: 'stub-hydroponics', _count: 3 }] }
  }
  if (pathname === '/api/offers') {
    return { edges: STUB_OFFERS.map((node) => ({ node })), offers: STUB_OFFERS }
  }
  if (pathname === '/api/standard-categories/tree/flat') {
    return {
      standardCategories: [{ id: 'sc-1', slug: 'stub-hydroponics', name: 'Stub Hydroponics', code: 'stub-hydroponics' }],
    }
  }
  if (pathname === '/api/cooperations/discover') {
    return { edges: [] }
  }
  if (pathname === '/api/exchange-rates') {
    return { rates: { EUR: 0.00000095, USD: 0.00000104 }, lastUpdated: new Date().toISOString(), stale: false }
  }
  if (pathname === '/api/partners') {
    // Shape per ADR-180 — Home's Partners slider does data.items.filter(...)
    return { segment: 'users', items: [], total: 0, limit: 12, offset: 0, sort: 'offers', filters: {} }
  }
  return {}
}

const stub = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(stubBody(pathname)))
})
await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve))
const stubPort = stub.address().port
console.log(`[verify] stub API on http://127.0.0.1:${stubPort}`)

// ── 1. Prerender with the stub API behind PRERENDER_API_PROXY ────────────────

console.log('[verify] prerendering dist/ with PRERENDER_API_PROXY …')
// Async spawn (NOT spawnSync) — a sync child would block this process's event
// loop and the stub API server above could never answer the prerender's
// proxied requests (they would all hang until the child exits).
const prerenderExit = new Promise((resolve, reject) => {
  const child = spawn('node', ['scripts/prerender.mjs'], {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, PRERENDER_API_PROXY: `http://127.0.0.1:${stubPort}` },
  })
  const timer = setTimeout(() => child.kill('SIGKILL'), 240_000)
  child.on('error', reject)
  child.on('exit', (code) => {
    clearTimeout(timer)
    resolve(code ?? 1)
  })
})
if ((await prerenderExit) !== 0) {
  console.error('[verify] FAIL: prerender exited non-zero')
  stub.close()
  process.exit(1)
}

const snapshotHtml = await readFile(path.join(appDir, 'dist', 'index.html'), 'utf8')
const snapshotChecks = [
  ['snapshot contains __RQ_STATE__ tag', snapshotHtml.includes('id="__RQ_STATE__"')],
  // ADR-363 D1: the marketplace feed family is now 'listings' (all-offers /
  // offers-by-type were folded into it).
  ['seed contains listings feed', snapshotHtml.includes('"listings"')],
  ['seed contains standard-categories', snapshotHtml.includes('"standard-categories"')],
  ['seed does NOT contain pubkey-scoped user-tickets', !snapshotHtml.includes('"user-tickets"')],
  ['seed does NOT contain pubkey-scoped identity', !snapshotHtml.includes('"identity"')],
  ['seed does NOT contain pubkey-scoped wallet-transactions', !snapshotHtml.includes('"wallet-transactions"')],
]
let snapshotOk = true
for (const [label, ok] of snapshotChecks) {
  console.log(`[verify]   ${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) snapshotOk = false
}
if (!snapshotOk) {
  console.error('[verify] FAIL: __RQ_STATE__ snapshot checks failed')
  stub.close()
  process.exit(1)
}

// ── 2. vite preview against the prerendered dist/ ───────────────────────────

const preview = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], {
  cwd: appDir,
  shell: true,
  stdio: 'ignore',
})
let previewUp = false
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(origin)
    if (r.ok) {
      previewUp = true
      break
    }
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 500))
}
if (!previewUp) {
  console.error('[verify] FAIL: vite preview did not come up')
  preview.kill('SIGTERM')
  stub.close()
  process.exit(1)
}
console.log(`[verify] vite preview on ${origin}`)

// ── 3. Playwright scenarios ──────────────────────────────────────────────────

const browser = await chromium.launch()
const results = []
let failures = 0

function record(name, pass, ms, note = '') {
  results.push({ name, pass, ms, note })
  if (!pass) failures++
  console.log(`[verify]   ${pass ? 'PASS' : 'FAIL'}  ${name}${ms != null ? `  (${ms} ms)` : ''}${note ? `  — ${note}` : ''}`)
}

/** /api/* interception: fulfill from the stub after a delay (or hang forever). */
async function stubApi(page, { delayMs = 0, hang = false }) {
  await page.route('**/api/**', async (route) => {
    if (hang) {
      await new Promise(() => {}) // never resolves, never fulfills (pitfall from the parent handoff)
    }
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
    const pathname = new URL(route.request().url()).pathname
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stubBody(pathname)) })
  })
}

/** Navigate to / and return ms until the splash is *visually* hidden. */
async function measureSplashHidden(page) {
  const t0 = Date.now()
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => {
      const el = document.getElementById('app-splash')
      return el !== null && getComputedStyle(el).visibility === 'hidden'
    },
    null,
    { polling: 'raf', timeout: 12_000 },
  )
  return Date.now() - t0
}

try {
  // Capture a realistic persisted cache from a fast first load (never hand-built).
  const captureCtx = await browser.newContext()
  const capturePage = await captureCtx.newPage()
  await stubApi(capturePage, { delayMs: 50 })
  await measureSplashHidden(capturePage)
  await capturePage.waitForTimeout(1_800) // persister throttle (1000ms) flush
  const capturedCache = await capturePage.evaluate(() => localStorage.getItem('TANSTACK_QUERY_OFFLINE_CACHE'))
  await captureCtx.close()
  if (!capturedCache) {
    console.error('[verify] FAIL: could not capture a persisted cache from the fast first load')
    process.exit(1)
  }
  console.log('[verify] captured persisted cache from live page (fast load)')

  // WARM — seeded localStorage, API delayed 2000ms. With ADR-294 D2 baked in,
  // a "no localStorage" baseline is no longer data-less (the snapshot seed
  // serves it — that is the cold scenario), so the assertion is pure timing:
  // the cache must hide the splash well below the 2000ms network delay.
  const warmCtx = await browser.newContext()
  await warmCtx.addInitScript((c) => localStorage.setItem('TANSTACK_QUERY_OFFLINE_CACHE', c), capturedCache)
  const warmPage = await warmCtx.newPage()
  await stubApi(warmPage, { delayMs: 2_000 })
  const warmMs = await measureSplashHidden(warmPage)
  await warmCtx.close()

  // BASELINE (reference only) — empty cache, API delayed 2000ms. Since D2,
  // this run is served by the snapshot seed, so it measures the same fast
  // path; logged to show the delay actually binds later (hung scenario).
  const baseCtx = await browser.newContext()
  const basePage = await baseCtx.newPage()
  await stubApi(basePage, { delayMs: 2_000 })
  const baseMs = await measureSplashHidden(basePage)
  await baseCtx.close()

  record('warm: splash hides from cache, not the 2000ms-delayed network', warmMs <= 1_600, warmMs, `reference no-cache run: ${baseMs} ms`)

  // COLD — empty cache, prerender __RQ_STATE__ seed, API delayed 2000ms.
  // The timing bound is the proof of data service: with a 2000ms-delayed API
  // the splash cannot hide before ~2000ms unless the snapshot hydrated.
  const coldCtx = await browser.newContext()
  const coldPage = await coldCtx.newPage()
  await stubApi(coldPage, { delayMs: 2_000 })
  const coldMs = await measureSplashHidden(coldPage)
  const coldTagRemoved = await coldPage.evaluate(() => document.getElementById('__RQ_STATE__') === null)
  await coldCtx.close()
  record(
    'cold: first visit hydrates from the prerender snapshot',
    coldMs <= 1_600 && coldTagRemoved,
    coldMs,
    `tagRemoved=${coldTagRemoved}`,
  )

  // EXPIRED — cache dataUpdatedAt rewound 25h. TanStack's persisted-restore
  // invalidates over-age queries and serves the stale data while refetching
  // in the background — so the splash must NOT block on the network (fast),
  // and must never get stuck. Not network-bound is the assertion.
  const expiredCache = JSON.parse(capturedCache)
  for (const q of expiredCache.clientState?.queries ?? []) {
    if (q.state?.dataUpdatedAt) q.state.dataUpdatedAt -= 25 * 60 * 60 * 1_000
  }
  const expCtx = await browser.newContext()
  await expCtx.addInitScript(
    (c) => localStorage.setItem('TANSTACK_QUERY_OFFLINE_CACHE', JSON.stringify(c)),
    expiredCache,
  )
  const expPage = await expCtx.newPage()
  await stubApi(expPage, { delayMs: 1_500 })
  const expMs = await measureSplashHidden(expPage)
  await expCtx.close()
  record('expired: >24h cache serves stale + background refetch, never stuck', expMs <= 2_200, expMs)

  // HUNG — ADR-290 fallback regression test. The snapshot seed must be
  // stripped from the served document (intercept the '/' response) so this
  // context truly has NO data — otherwise D2 would satisfy Home instantly and
  // the MAX_WAIT_MS=4000 path would never be exercised. API never responds.
  const hungCtx = await browser.newContext()
  const hungPage = await hungCtx.newPage()
  await hungPage.route(origin + '/', async (route) => {
    const response = await route.fetch()
    const html = (await response.text()).replace(
      /<script id="__RQ_STATE__" type="application\/json">[\s\S]*?<\/script>/,
      '',
    )
    await route.fulfill({ response, body: html, headers: { 'content-type': 'text/html; charset=utf-8' } })
  })
  await stubApi(hungPage, { hang: true })
  const hungMs = await measureSplashHidden(hungPage)
  await hungCtx.close()
  record('hung: ADR-290 fallback hides the splash at ~MAX_WAIT_MS, not stuck', hungMs >= 3_300 && hungMs <= 5_200, hungMs)
} finally {
  await browser.close()
  preview.kill('SIGTERM')
  stub.close()
}

console.log('')
console.log('── ADR-294 verification summary ──')
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.ms != null ? ` (${r.ms} ms)` : ''}${r.note ? ` — ${r.note}` : ''}`)
}
process.exit(failures === 0 ? 0 : 1)
