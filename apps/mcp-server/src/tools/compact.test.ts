import { describe, it, expect } from 'vitest'
import { compactText, compactToolResult, INLINE_IMAGE_PLACEHOLDER } from './compact.js'

const B64 = 'UklGRo4VAABXRUJQVlA4'.repeat(40) // >64 base64 chars, like a real thumbnail
const uri = `data:image/webp;base64,${B64}`

const asResult = (obj: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(obj) }] })
const textOf = (r: { content: Array<{ text: string }> }) => r.content[0].text

describe('compactText / compactToolResult (FU-961)', () => {
  it('replaces data-URI images in nested arrays and keeps the JSON valid', () => {
    const out = textOf(compactToolResult('list_bounties', asResult({ tasks: [{ id: 'a', images: [uri, uri], title: 't' }] })))
    expect(out).not.toContain('base64,')
    const parsed = JSON.parse(out)
    expect(parsed.tasks[0].images).toEqual([INLINE_IMAGE_PLACEHOLDER, INLINE_IMAGE_PLACEHOLDER])
    expect(parsed.tasks[0].title).toBe('t')
  })

  it('replaces images inside a JSON-in-a-string field (the list_daos shape)', () => {
    const out = textOf(compactToolResult('list_daos', asResult({ daos: [{ id: 'd', images: JSON.stringify([uri]) }] })))
    expect(out).not.toContain('base64,')
    expect(JSON.parse(out).daos[0].images).toBe(JSON.stringify([INLINE_IMAGE_PLACEHOLDER]))
  })

  it('leaves normal https image URLs and short data URIs alone', () => {
    const payload = { images: ['https://cdn.example/x.webp'], icon: 'data:image/png;base64,AAAA' }
    expect(compactText(JSON.stringify(payload))).toBe(JSON.stringify(payload))
  })

  it('drops the duplicate `edges` of a cooperation page but keeps cooperations and pageInfo', () => {
    const coops = [{ id: '1' }, { id: '2' }]
    const body = { edges: coops.map((node) => ({ cursor: node.id, node })), pageInfo: { hasNextPage: false }, cooperations: coops }
    const parsed = JSON.parse(textOf(compactToolResult('discover_cooperations', asResult(body))))
    expect(parsed.edges).toBeUndefined()
    expect(parsed.cooperations).toEqual(coops)
    expect(parsed.pageInfo).toEqual({ hasNextPage: false })
  })

  it('keeps `edges` when it does not mirror `cooperations`', () => {
    const body = { edges: [{ node: { id: '1' } }], cooperations: [{ id: '1' }, { id: '2' }] }
    expect(JSON.parse(textOf(compactToolResult('discover_cooperations', asResult(body)))).edges).toBeDefined()
  })

  it('exempts upload_image, whose returned data URL must be reusable verbatim', () => {
    const r = asResult({ success: true, url: uri })
    expect(compactToolResult('upload_image', r)).toBe(r)
    expect(textOf(r)).toContain(uri)
  })

  it('passes through non-text content, error results and non-JSON text unchanged in shape', () => {
    const img = { content: [{ type: 'image' as const, data: B64, mimeType: 'image/webp' }] }
    expect(compactToolResult('x', img)).toEqual(img)
    expect(compactToolResult('x', { content: [{ type: 'text' as const, text: 'API Error: 404 Not Found — {"error":"nope"}' }], isError: true })).toMatchObject({ isError: true })
    expect(compactText('plain text, not json')).toBe('plain text, not json')
    expect(compactToolResult('x', undefined)).toBeUndefined()
  })

  it('shrinks a realistic oversized payload by orders of magnitude', () => {
    const big = `data:image/webp;base64,${'A'.repeat(500_000)}`
    const before = JSON.stringify({ daos: [{ id: 'd', name: 'Foundation', images: JSON.stringify([big]) }] })
    const after = compactText(before)
    expect(before.length).toBeGreaterThan(500_000)
    expect(after.length).toBeLessThan(500)
  })
})
