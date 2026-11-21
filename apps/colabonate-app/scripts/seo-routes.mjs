// Canonical list of public, indexable routes of the Colabonate web app.
// Single source for build-time prerendering (scripts/prerender.mjs) and the
// generated sitemap.xml. Keep in sync with the public routes in src/App.tsx.
//
// Per-route titles/descriptions are NOT stored here — they are set at the
// page level via <Seo /> (src/components/Seo.tsx) and harvested from the
// rendered DOM by the prerender script.

// Beta was retired 2026-09-23 — the fallback is the production origin so a
// build without SITE_URL never emits links to a dead host.
export const SEO_BASE_URL = process.env.SITE_URL || 'https://colabonate.app'

export const PUBLIC_ROUTES = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  // Public read tier (ADR-303 D9 + D12) — indexable discovery pages.
  { path: '/coop',    changefreq: 'daily',  priority: '0.9' },
  { path: '/buy',     changefreq: 'daily',  priority: '0.9' },
  { path: '/buy/map', changefreq: 'weekly', priority: '0.6' },
  { path: '/search',  changefreq: 'weekly', priority: '0.6' },
  { path: '/tasks',   changefreq: 'daily',  priority: '0.6' },
  { path: '/about',   changefreq: 'monthly', priority: '0.8' },
  { path: '/features', changefreq: 'monthly', priority: '0.8' },
  { path: '/pricing', changefreq: 'monthly', priority: '0.8' },
  { path: '/roadmap', changefreq: 'monthly', priority: '0.6' },
  { path: '/about/foundation',   changefreq: 'monthly', priority: '0.5' },
  { path: '/about/codex',         changefreq: 'monthly', priority: '0.5' },
  { path: '/about/role-onboarding', changefreq: 'monthly', priority: '0.5' },
  { path: '/help', changefreq: 'weekly', priority: '0.7' },
  // Help sections — ids from src/routes/help/helpData.tsx (HELP_SECTIONS)
  { path: '/help/beta',           changefreq: 'weekly',  priority: '0.6' },
  { path: '/help/getting-started', changefreq: 'monthly', priority: '0.6' },
  { path: '/help/login-providers',  changefreq: 'monthly', priority: '0.6' },
  { path: '/help/buying',           changefreq: 'monthly', priority: '0.6' },
  { path: '/help/selling',          changefreq: 'monthly', priority: '0.6' },
  { path: '/help/cooperation',      changefreq: 'monthly', priority: '0.6' },
  { path: '/help/wallet',           changefreq: 'monthly', priority: '0.6' },
  { path: '/help/identity-trust',   changefreq: 'monthly', priority: '0.6' },
  { path: '/help/dao-governance',   changefreq: 'monthly', priority: '0.6' },
  { path: '/help/tickets-orders',   changefreq: 'monthly', priority: '0.6' },
  { path: '/legal/privacy',  changefreq: 'yearly',  priority: '0.3' },
  { path: '/legal/terms',    changefreq: 'yearly',  priority: '0.3' },
  { path: '/legal/imprint',  changefreq: 'yearly',  priority: '0.3' },
  { path: '/contact',        changefreq: 'yearly',  priority: '0.4' },
]
