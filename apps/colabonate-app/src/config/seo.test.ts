import { afterEach, describe, expect, it, vi } from 'vitest'

// ADR-287: the canonical origin is baked at build time via VITE_SITE_URL.
// Regression guard — production served beta canonical/og:url because
// config/seo.ts hardcoded the beta origin (found live 2026-09-23).
describe('SEO_BASE_URL (ADR-287)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('uses VITE_SITE_URL when set (production)', async () => {
    vi.stubEnv('VITE_SITE_URL', 'https://colabonate.app')
    vi.resetModules()
    const { SEO_BASE_URL, SEO_DEFAULTS } = await import('./seo')
    expect(SEO_BASE_URL).toBe('https://colabonate.app')
    expect(SEO_DEFAULTS.ogImage).toBe('https://colabonate.app/og-image.png')
  })

  it('falls back to the production origin when unset (beta retired)', async () => {
    vi.stubEnv('VITE_SITE_URL', '')
    vi.resetModules()
    const { SEO_BASE_URL, SEO_DEFAULTS } = await import('./seo')
    expect(SEO_BASE_URL).toBe('https://colabonate.app')
    expect(SEO_DEFAULTS.ogImage).toBe('https://colabonate.app/og-image.png')
  })
})
