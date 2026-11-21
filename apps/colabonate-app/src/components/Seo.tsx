import { useEffect } from 'react'
import { SEO_BASE_URL, SEO_DEFAULTS } from '../config/seo'

/**
 * Per-route SEO metadata manager (dependency-free alternative to
 * react-helmet). Sets document.title, meta description, canonical URL,
 * Open Graph / Twitter tags, robots and an optional JSON-LD block while the
 * page is mounted, and restores the index.html defaults on unmount.
 *
 * The prerender script (scripts/prerender.mjs) harvests exactly these tags
 * from the rendered DOM, so this component is the single source of truth for
 * per-route metadata.
 */

export interface SeoProps {
  /** Page title without brand suffix — rendered as "<title> | Colabonate". */
  title?: string
  /** Meta description, ideally 120–160 characters. */
  description?: string
  /** Canonical path, e.g. "/about". Defaults to window.location.pathname. */
  path?: string
  /** Open Graph type, default "website". */
  ogType?: string
  /** Emit meta robots "noindex,nofollow" (login, onboarding, …). */
  noindex?: boolean
  /** Optional schema.org JSON-LD object injected as application/ld+json. */
  jsonLd?: Record<string, unknown>
}

const JSONLD_ATTR = 'data-seo-jsonld'

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.content = content
}

function upsertCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!el) {
    el = document.createElement('link')
    el.rel = 'canonical'
    document.head.appendChild(el)
  }
  el.href = href
}

function applyTags(props: SeoProps) {
  const description = props.description ?? SEO_DEFAULTS.description
  const path = props.path ?? window.location.pathname
  const url = `${SEO_BASE_URL}${path}`
  const fullTitle = props.title ? `${props.title} | ${SEO_DEFAULTS.siteName}` : SEO_DEFAULTS.title

  document.title = fullTitle
  upsertMeta('name', 'description', description)
  upsertMeta('name', 'robots', props.noindex ? 'noindex,nofollow' : 'index,follow')
  upsertCanonical(url)

  upsertMeta('property', 'og:site_name', SEO_DEFAULTS.siteName)
  upsertMeta('property', 'og:type', props.ogType ?? SEO_DEFAULTS.ogType)
  upsertMeta('property', 'og:title', fullTitle)
  upsertMeta('property', 'og:description', description)
  upsertMeta('property', 'og:url', url)
  upsertMeta('property', 'og:image', SEO_DEFAULTS.ogImage)

  upsertMeta('name', 'twitter:card', SEO_DEFAULTS.twitterCard)
  upsertMeta('name', 'twitter:title', fullTitle)
  upsertMeta('name', 'twitter:description', description)
  upsertMeta('name', 'twitter:image', SEO_DEFAULTS.ogImage)

  document.head.querySelector(`script[${JSONLD_ATTR}]`)?.remove()
  if (props.jsonLd) {
    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.setAttribute(JSONLD_ATTR, 'true')
    script.textContent = JSON.stringify(props.jsonLd)
    document.head.appendChild(script)
  }
}

export function Seo(props: SeoProps) {
  const { title, description, path, ogType, noindex, jsonLd } = props
  useEffect(() => {
    applyTags({ title, description, path, ogType, noindex, jsonLd })
    return () => applyTags({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, path, ogType, noindex, JSON.stringify(jsonLd)])
  return null
}
