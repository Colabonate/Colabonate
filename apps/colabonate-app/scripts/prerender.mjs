// Build-time prerenderer for the public routes of the Colabonate SPA.
//
// Serves the built dist/ with a minimal static server (SPA fallback), visits
// every public route with headless Chromium (Playwright, repo-root dependency)
// and writes the fully rendered DOM back to dist/<route>/index.html. Bots
// without JavaScript (LLM crawlers, secondary search crawlers) get the full
// page text and the per-route metadata that <Seo /> set in the live DOM;
// users get the unchanged SPA — main.tsx mounts with createRoot() over the
// snapshot markup.
//
// Also generates dist/sitemap.xml from the same route list.
//
// Fails loud: any route that does not render aborts the build.
//
// Usage: node scripts/prerender.mjs   (from apps/colabonate-app, after `vite build`)
// Env:   SITE_URL — canonical origin used in the sitemap (default: seo-routes.mjs)
//        PRERENDER_API_PROXY — optional origin (e.g. http://127.0.0.1:4001) that
//          all /api/* requests from the prerender browser are proxied to, so
//          snapshots render with real data (ADR-294 D4). Unset = static-only,
//          API-less rendering (today's behavior, fail-soft).

import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { PUBLIC_ROUTES, SEO_BASE_URL } from './seo-routes.mjs'
import { writeSkillsIndexes } from './skills-index.mjs'
import { writeAiCatalog } from './ai-catalog.mjs'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(appDir, 'dist')

if (!existsSync(path.join(distDir, 'index.html'))) {
  console.error('[prerender] dist/index.html not found — run `vite build` first.')
  process.exit(1)
}

const API_PROXY = process.env.PRERENDER_API_PROXY
  ? process.env.PRERENDER_API_PROXY.replace(/\/+$/, '')
  : null
console.log(`[prerender] API proxy: ${API_PROXY ?? '(disabled)'}`)

// ADR-294 D2: only anonymous/public query keys may enter the __RQ_STATE__
// snapshot seed. Never pubkey-scoped keys (tickets, identity, wallet-*, …) —
// the prerender browser has no session, but the allowlist must enforce that,
// not silently rely on it.
const SEED_QUERY_KEYS = new Set([
  // ADR-363 D1: the unified marketplace feed ('all-offers' and
  // 'offers-by-type' are now derived views over this same family).
  'listings',
  'standard-categories',
  'cooperations-discover',
  // ADR-376 D1/D6: useCoopExploreData's coop-context composition now reads
  // this canonical, already-shared key instead of a private fetch — same
  // key BuyDashboard's Vendors tab already seeds.
  'companies',
  'category-counts',
  'exchange-rates',
  // ADR-324 D2 seeded /search's two default-view queries here; ADR-376 D1
  // decomposed the coop half ('coop-explore-data') into the canonical
  // per-entity keys above, so that key is no longer produced and is
  // deliberately not listed.
  'offer-search',
  // ADR-301: Home's "Services & Collaborations" slider (SERVICE/PRODUCT/COOP
  // pools) — anonymous/public, not pubkey-scoped. Missing here meant it never
  // reached the pre-mount hydrate() and depended solely on the
  // PersistQueryClientProvider localStorage restore on every full reload
  // (e.g. the hard navigation after login), which does not reliably win the
  // race — see ADR-294 D2's "Rejected Alternatives" for the same race class.
  // The pools now live under 'listings' too; 'offer-search' stays as the
  // legacy single-page key.
  'offers-by-type',
])

// The localStorage key the app's persister writes (keep in sync with
// src/lib/queryClient.ts QUERY_CACHE_STORAGE_KEY). Read, not imported, because
// this script runs as plain Node against the built app.
const QUERY_CACHE_STORAGE_KEY = 'TANSTACK_QUERY_OFFLINE_CACHE'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

// Minimal static server with SPA history fallback (mirrors nginx try_files).
const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    let filePath = path.join(distDir, urlPath)
    if (!filePath.startsWith(distDir)) {
      res.writeHead(403).end()
      return
    }
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      const nested = path.join(filePath, 'index.html')
      filePath = existsSync(nested) ? nested : path.join(distDir, 'index.html')
    }
    const body = await readFile(filePath)
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' })
    res.end(body)
  } catch (err) {
    res.writeHead(500).end(String(err))
  }
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const origin = `http://127.0.0.1:${port}`

// ADR-294 D2: extract the allowlisted subset of the prerender browser's
// persisted query cache as a dehydrated clientState. Empty arrays ARE seeded
// deliberately — an allowlisted query that resolved empty must behave on a
// cold first visit exactly like on a warm reload (data [] → not pending →
// splash can hide; background refetch reconciles). Skipping empties would
// leave exactly that query network-bound and re-block the splash. Only
// null/undefined data (errored queries) is skipped. Polls until at least one
// allowlisted query is present — the persister's first mount flush writes an
// EMPTY cache long before any query resolves and then throttles for 1000 ms.
async function extractSeedState(page) {
  for (let i = 0; i < 12; i++) {
    const raw = await page.evaluate((key) => localStorage.getItem(key), QUERY_CACHE_STORAGE_KEY)
    if (raw) {
      try {
        const all = JSON.parse(raw)?.clientState?.queries ?? []
        const queries = all.filter((q) => {
          const key0 = Array.isArray(q?.queryKey) ? q.queryKey[0] : undefined
          if (!SEED_QUERY_KEYS.has(key0)) return false
          return q?.state?.data !== null && q?.state?.data !== undefined
        })
        if (queries.length > 0) {
          console.log(
            `[prerender]   seed: ${queries.length}/${all.length} queries allowlisted ` +
              `(${all.map((q) => (Array.isArray(q?.queryKey) ? String(q.queryKey[0]) : '?')).join(', ')})`,
          )
          return { queries, mutations: [] }
        }
      } catch {
        // unparseable (mid-write?) — keep polling
      }
    }
    await page.waitForTimeout(500)
  }
  console.log('[prerender]   seed: no allowlisted queries appeared in the persisted cache')
  return null
}

// Inert JSON data block, injected only into the "/" snapshot (ADR-294 D2 —
// only Home has the boot-path gap). "<" is escaped so user-influenced offer
// text can never terminate the script tag early.
function injectRqState(html, clientState) {
  const json = JSON.stringify(clientState).replace(/</g, '\\u003c')
  const tag = `<script id="__RQ_STATE__" type="application/json">${json}</script>`
  return html.replace('</body>', `${tag}\n</body>`)
}

async function renderRoute(browser, routePath) {
  const page = await browser.newPage()
  try {
    // ADR-294 D4: optional /api proxy so snapshots render with real data.
    // Registered before goto. Fulfilled via plain Node fetch (NOT
    // route.fetch — observed to hang pending in this multi-page prerender
    // context until page.close() aborted every request) and route.fulfill.
    if (API_PROXY) {
      await page.route('**/api/**', async (route) => {
        const req = route.request()
        const url = new URL(req.url())
        const target = API_PROXY + url.pathname + url.search
        try {
          const headers = {}
          for (const [k, v] of Object.entries(req.headers())) {
            const lk = k.toLowerCase()
            if (lk !== 'host' && lk !== 'connection' && lk !== 'content-length') headers[k] = v
          }
          const init = { method: req.method(), headers }
          if (req.postData() !== null) init.body = req.postData()
          const response = await fetch(target, init)
          const body = await response.arrayBuffer()
          await route.fulfill({
            status: response.status,
            headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
            body: Buffer.from(body),
          })
        } catch (err) {
          console.warn(`[prerender]   api-proxy failed ${url.pathname}: ${err.message}`)
          await route.abort()
        }
      })
    }
    // Reduced motion: skips GSAP reveal animations so below-the-fold content
    // is not captured with opacity:0 inline styles.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`${origin}${routePath}`, { waitUntil: 'load', timeout: 30_000 })
    // React mounted + splash hidden (main.tsx adds the class after mount).
    // state:'attached' — the class hides the element via visibility:hidden,
    // so the default 'visible' state would race against the CSS transition.
    await page.waitForSelector('#app-splash.app-splash--hidden', { state: 'attached', timeout: 20_000 })
    // Route component (lazy via Suspense) actually rendered.
    await page.waitForFunction(() => (document.getElementById('root')?.textContent?.length ?? 0) > 200, {
      timeout: 20_000,
    })
    // Let <Seo /> effects + lazy suspense boundaries settle.
    await page.waitForTimeout(800)
    const seedState = routePath === '/' ? await extractSeedState(page) : null
    let html = await page.content()
    if (seedState) html = injectRqState(html, seedState)
    const title = await page.title()
    const description = await page
      .$eval('meta[name="description"]', (el) => el.content)
      .catch(() => '(none)')
    return { html: `<!doctype html>\n${html}`, title, description, seeded: !!seedState }
  } finally {
    await page.close()
  }
}

function sitemapXml(routes) {
  const lastmod = new Date().toISOString().slice(0, 10)
  const urls = routes
    .map(
      (r) => `  <url>
    <loc>${SEO_BASE_URL}${r.path}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`
}

// Static public/ files (robots.txt, llms.txt, agents.md) are copied verbatim by Vite and
// never pass through <Seo />, so their legacy beta origin must be rewritten to
// this build's canonical origin (ADR-287). No-op when the origin already matches.
const BETA_ORIGIN = 'https://colabonate.app'
async function rewriteStaticOrigins() {
  if (SEO_BASE_URL === BETA_ORIGIN) return
  for (const file of ['robots.txt', 'llms.txt', 'agents.md']) {
    const filePath = path.join(distDir, file)
    if (!existsSync(filePath)) continue
    const source = await readFile(filePath, 'utf8')
    if (!source.includes(BETA_ORIGIN)) continue
    await writeFile(filePath, source.split(BETA_ORIGIN).join(SEO_BASE_URL))
    console.log(`[prerender] rewrote ${file} origin → ${SEO_BASE_URL}`)
  }
}

const browser = await chromium.launch()
const failures = []
try {
  for (const route of PUBLIC_ROUTES) {
    try {
      const { html, title, description, seeded } = await renderRoute(browser, route.path)
      const outFile =
        route.path === '/' ? path.join(distDir, 'index.html') : path.join(distDir, route.path, 'index.html')
      await mkdir(path.dirname(outFile), { recursive: true })
      await writeFile(outFile, html)
      console.log(
        `[prerender] ${route.path}  —  "${title}"  (${description.slice(0, 70)}…)${seeded ? '  [__RQ_STATE__ seed]' : ''}`,
      )
    } catch (err) {
      failures.push({ path: route.path, err })
      console.error(`[prerender] FAILED ${route.path}: ${err.message}`)
    }
  }

  await writeFile(path.join(distDir, 'sitemap.xml'), sitemapXml(PUBLIC_ROUTES))
  console.log(`[prerender] wrote sitemap.xml (${PUBLIC_ROUTES.length} urls, base ${SEO_BASE_URL})`)

  await rewriteStaticOrigins()

  // ADR-414 D8: hosted-skill discovery indexes. MUST run after the origin
  // rewrite above — the digests are taken over the bytes nginx will serve.
  const { written } = await writeSkillsIndexes(distDir, SEO_BASE_URL)
  if (written) console.log(`[prerender] wrote skills discovery indexes (${written} skill, base ${SEO_BASE_URL})`)

  // ADR-414 D6 / FU-955: domain-level AI Catalog (MCP server card + skills). Same ordering rule —
  // its digests cover the bytes nginx serves, and it reads the skill digests computed above.
  const catalog = await writeAiCatalog(distDir, SEO_BASE_URL)
  if (catalog.written) console.log(`[prerender] wrote /.well-known/ai-catalog.json (${catalog.written} entries, base ${SEO_BASE_URL})`)
} finally {
  await browser.close()
  server.close()
}

if (failures.length > 0) {
  console.error(`[prerender] ${failures.length} route(s) failed — aborting build.`)
  process.exit(1)
}
console.log('[prerender] done.')
