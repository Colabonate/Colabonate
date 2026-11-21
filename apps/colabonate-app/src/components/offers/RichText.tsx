import { useMemo } from 'react'
import DOMPurify from 'dompurify'
import { cn } from '@ds/utils'

// ADR-295 D2: the single allowlist for rich-text descriptions. The editor
// emits exactly this set; every render surface sanitizes against it again.
// ADR-295 D6 (media extension): img for inline images (data-URL from the
// standard optimize pipeline, or https URL).
const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li', 'h3', 'h4', 'a', 'img']
const ALLOWED_ATTR = ['href', 'target', 'rel', 'src', 'alt', 'title', 'width']

// img src: https URLs (external) or data:image/* (project-standard optimized
// uploads — same storage pattern as the offer photos). Nothing else.
const SAFE_IMG_SRC = /^(https:\/\/|data:image\/(?:jpeg|png|webp|gif);base64,)/i
// Links: web protocols only (DOMPurify already blocks javascript:, this also
// rejects exotic schemes explicitly).
const SAFE_HREF = /^https?:\/\//i

// Registered once at module level: harden every sanitized fragment.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node instanceof HTMLAnchorElement) {
    const href = node.getAttribute('href')
    if (href && !SAFE_HREF.test(href)) node.removeAttribute('href')
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
  if (node instanceof HTMLImageElement) {
    const src = node.getAttribute('src')
    if (!src || !SAFE_IMG_SRC.test(src)) node.removeAttribute('src')
    node.setAttribute('loading', 'lazy')
  }
})

export function sanitizeRichText(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  })
}

// ── Video embeds (ADR-295 D6) ───────────────────────────────────────────────
// Stored HTML only ever contains a plain <a href> to a video page — iframes
// never survive sanitizeRichText(). At RENDER time, whitelisted video links
// are transformed into embeds whose iframe src is rebuilt from a strictly
// regex-validated host + id, so no stored markup can smuggle an arbitrary
// iframe source.

const YOUTUBE_RE = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/
const VIMEO_RE = /^(?:https?:\/\/)?(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d+)/

export function videoEmbedSrc(url: string): { type: 'youtube' | 'vimeo'; src: string } | null {
  const yt = url.match(YOUTUBE_RE)
  if (yt) return { type: 'youtube', src: `https://www.youtube-nocookie.com/embed/${yt[1]}` }
  const vimeo = url.match(VIMEO_RE)
  if (vimeo) return { type: 'vimeo', src: `https://player.vimeo.com/video/${vimeo[1]}` }
  return null
}

/**
 * Replaces whitelisted video links in SANITIZED html with a 16:9 embed card.
 * Channel/profile URLs (e.g. youtube.com/@handle) do not match and stay links.
 */
export function transformVideoEmbeds(html: string): string {
  if (!html.includes('youtube') && !html.includes('youtu.be') && !html.includes('vimeo.com')) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  let changed = false
  for (const a of Array.from(doc.body.querySelectorAll('a[href]'))) {
    const embed = videoEmbedSrc(a.getAttribute('href') ?? '')
    if (!embed) continue
    const figure = doc.createElement('div')
    figure.className = 'video-embed'
    figure.setAttribute('data-embed-type', embed.type)
    const iframe = doc.createElement('iframe')
    iframe.setAttribute('src', embed.src)
    iframe.setAttribute('title', a.textContent?.trim() || 'Video')
    iframe.setAttribute('loading', 'lazy')
    iframe.setAttribute('allowfullscreen', '')
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
    figure.appendChild(iframe)
    a.replaceWith(figure)
    changed = true
  }
  return changed ? doc.body.innerHTML : html
}

// Plain-text extraction for validation / preview truncation (ADR-295 D2).
export function richTextToPlainText(html: string): string {
  if (!html) return ''
  const hasHtml = /<[a-z][\s\S]*>/i.test(html)
  if (!hasHtml) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return (doc.body.textContent ?? '').replace(/\u00a0/g, ' ')
}

export function hasRichTextHtml(value: string): boolean {
  return /<[a-z][\s\S]*>/i.test(value)
}

export interface RichTextProps {
  value: string
  className?: string
}

/**
 * Renders an offer description: sanitized restricted HTML (ADR-295 D2) or —
 * for legacy values without HTML tags — plain text with pre-wrap, matching
 * the pre-ADR-295 rendering exactly.
 */
export function RichText({ value, className }: RichTextProps) {
  const html = useMemo(
    () => (hasRichTextHtml(value) ? transformVideoEmbeds(sanitizeRichText(value)) : ''),
    [value],
  )

  if (!html) {
    return (
      <div
        className={className}
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'break-word' }}
      >
        {value}
      </div>
    )
  }

  return (
    <div
      className={cn('rich-text-content', className)}
      // Sanitized against the ADR-295 allowlist + video-embed transform above;
      // iframes only ever originate from the strict videoEmbedSrc() whitelist.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
