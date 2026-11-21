// Default SEO metadata for the Colabonate web app.
// Used by <Seo /> (src/components/Seo.tsx) as fallback/reset values.
// The mirror copy for build tooling lives in scripts/seo-routes.mjs
// (plain JS, not part of the TS compilation unit).

// Canonical public origin for absolute SEO URLs (canonical, og:url, og:image).
// Baked at build time (ADR-287): a production build passes VITE_SITE_URL
// (= compose SITE_URL, e.g. https://colabonate.app). Unset falls back to the
// production origin — colabonate.app was retired 2026-09-23, so a build
// without SITE_URL no longer emits links to a dead host.
export const SEO_BASE_URL =
  (import.meta.env.VITE_SITE_URL as string | undefined)?.trim() || 'https://colabonate.app'

export const SEO_DEFAULTS = {
  siteName: 'Colabonate',
  title: 'Colabonate',
  description:
    'Colabonate is the peer-to-peer marketplace to buy, sell and cooperate directly — ' +
    'with Bitcoin Lightning payments, Nostr identity and community-governed escrow.',
  ogImage: `${SEO_BASE_URL}/og-image.png`,
  ogType: 'website',
  twitterCard: 'summary_large_image',
} as const
