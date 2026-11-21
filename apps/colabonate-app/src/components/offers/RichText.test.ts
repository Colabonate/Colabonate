// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { sanitizeRichText, richTextToPlainText, hasRichTextHtml, transformVideoEmbeds, videoEmbedSrc } from '../../components/offers/RichText'

describe('sanitizeRichText (ADR-295 D2 allowlist)', () => {
  it('keeps allowed tags and attributes', () => {
    const html = '<p>Hi <strong>there</strong> <em>friend</em></p><h3>Head</h3><ul><li>one</li></ul><a href="https://example.com">link</a>'
    const out = sanitizeRichText(html)
    expect(out).toContain('<strong>there</strong>')
    expect(out).toContain('<em>friend</em>')
    expect(out).toContain('<h3>Head</h3>')
    expect(out).toContain('<li>one</li>')
    expect(out).toContain('href="https://example.com"')
  })

  it('strips script tags and event handlers', () => {
    const out = sanitizeRichText('<p>ok</p><script>alert(1)</script><p onclick="alert(2)">bad</p><img src=x onerror=alert(3)>')
    expect(out).not.toContain('script')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('onerror')
    expect(out).toContain('<p>ok</p>')
  })

  it('neutralizes javascript: URLs in links', () => {
    const out = sanitizeRichText('<a href="javascript:alert(1)">x</a>')
    expect(out).not.toContain('javascript:')
  })

  it('forces target=_blank + rel on links', () => {
    const out = sanitizeRichText('<a href="https://example.com">x</a>')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it('drops tags outside the allowlist but keeps their text', () => {
    const out = sanitizeRichText('<blockquote>quoted</blockquote><table><tr><td>cell</td></tr></table>')
    expect(out).not.toContain('<blockquote>')
    expect(out).not.toContain('<table>')
    expect(out).toContain('quoted')
    expect(out).toContain('cell')
  })
})

describe('richTextToPlainText', () => {
  it('strips tags from HTML descriptions', () => {
    expect(richTextToPlainText('<p>Hello <strong>world</strong></p>')).toBe('Hello world')
  })

  it('returns plain values untouched (legacy offers)', () => {
    expect(richTextToPlainText('Just plain text')).toBe('Just plain text')
    expect(richTextToPlainText('')).toBe('')
  })

  it('flattens list items with separators', () => {
    const out = richTextToPlainText('<ul><li>a</li><li>b</li></ul>')
    expect(out).toContain('a')
    expect(out).toContain('b')
    expect(out).not.toContain('<li>')
  })
})

describe('hasRichTextHtml', () => {
  it('detects HTML but not plain text with angle brackets', () => {
    expect(hasRichTextHtml('<p>x</p>')).toBe(true)
    expect(hasRichTextHtml('5 < 6 but 7 > 6')).toBe(false)
    expect(hasRichTextHtml('plain')).toBe(false)
  })
})

describe('media allowlist (ADR-295 D6)', () => {
  it('keeps inline images with https or data-URL sources', () => {
    const out = sanitizeRichText('<p>pic <img src="https://example.com/a.png" alt="a" width="50%"> and <img src="data:image/jpeg;base64,AAAA"></p>')
    expect(out).toContain('src="https://example.com/a.png"')
    expect(out).toContain('width="50%"')
    expect(out).toContain('src="data:image/jpeg;base64,AAAA"')
  })

  it('strips unsafe img sources (http, javascript, data:text/html)', () => {
    const out = sanitizeRichText('<img src="http://example.com/a.png"><img src="javascript:alert(1)"><img src="data:text/html,<script>x</script>">')
    expect(out).not.toContain('http://example.com')
    expect(out).not.toContain('javascript:')
    expect(out).not.toContain('data:text/html')
  })

  it('never lets a stored iframe survive sanitization', () => {
    const out = sanitizeRichText('<iframe src="https://evil.example.com/embed"></iframe><p>ok</p>')
    expect(out).not.toContain('<iframe')
    expect(out).toContain('<p>ok</p>')
  })
})

describe('videoEmbedSrc (ADR-295 D6 whitelist)', () => {
  it('resolves YouTube watch / short / youtu.be / embed URLs to nocookie', () => {
    expect(videoEmbedSrc('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(videoEmbedSrc('https://youtu.be/dQw4w9WgXcQ')?.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(videoEmbedSrc('https://www.youtube.com/shorts/abc123XYZ_-Q')?.src).toBe('https://www.youtube-nocookie.com/embed/abc123XYZ_-Q')
  })

  it('resolves Vimeo URLs to the player domain', () => {
    expect(videoEmbedSrc('https://vimeo.com/123456789')?.src).toBe('https://player.vimeo.com/video/123456789')
    expect(videoEmbedSrc('https://player.vimeo.com/video/123456789')?.src).toBe('https://player.vimeo.com/video/123456789')
  })

  it('rejects channel pages and non-video URLs', () => {
    expect(videoEmbedSrc('https://youtube.com/@colabonate')).toBeNull()
    expect(videoEmbedSrc('https://example.com/video')).toBeNull()
  })
})

describe('transformVideoEmbeds', () => {
  it('replaces whitelisted video anchors with a nocookie iframe card', () => {
    const sanitized = sanitizeRichText('<p><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">My video</a></p>')
    const out = transformVideoEmbeds(sanitized)
    expect(out).toContain('class="video-embed"')
    expect(out).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"')
    expect(out).not.toContain('<a href="https://www.youtube.com')
  })

  it('leaves plain links and channel URLs untouched', () => {
    const html = '<p><a href="https://example.com/page">docs</a> <a href="https://youtube.com/@colabonate">channel</a></p>'
    const out = transformVideoEmbeds(html)
    expect(out).toBe(html)
  })
})
