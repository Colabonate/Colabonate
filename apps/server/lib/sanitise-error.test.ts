import { describe, it, expect } from 'vitest'
import { sanitiseUpstreamError } from './sanitise-error.js'

describe('sanitiseUpstreamError', () => {
  it('extracts the LNBits `detail` field and keeps the HTTP status', () => {
    const msg = 'LNBits API error: 400 - {"detail": "Not enough balance available."}'
    expect(sanitiseUpstreamError(msg)).toBe('HTTP 400: Not enough balance available.')
  })

  it('extracts an LND `message` field', () => {
    const msg = 'LND error: 500 - {"message": "invoice already settled"}'
    expect(sanitiseUpstreamError(msg)).toBe('HTTP 500: invoice already settled')
  })

  it('redacts hex key material / wallet ids from a raw body', () => {
    const adminKey = 'a'.repeat(32)
    const msg = `LNBits API error: 401 - invalid api-key ${adminKey}`
    expect(sanitiseUpstreamError(msg)).toBe('HTTP 401: invalid api-key <redacted>')
  })

  it('redacts internal URLs', () => {
    const msg = 'fetch failed: http://lnbits.internal:5000/api/v1/payments down'
    expect(sanitiseUpstreamError(msg)).toBe('fetch failed: <url> down')
  })

  it('replaces HTML error pages with a generic summary', () => {
    const msg = '<html><body>502 Bad Gateway — nginx/1.25 on host prod-lnbits-01</body></html>'
    const out = sanitiseUpstreamError(msg)
    expect(out).toBe('Upstream provider error (HTTP 502).')
    expect(out).not.toContain('prod-lnbits-01')
  })

  it('falls back to a generic message when nothing useful remains', () => {
    expect(sanitiseUpstreamError('   ')).toBe('Upstream payment provider error.')
  })

  it('accepts an Error instance', () => {
    expect(sanitiseUpstreamError(new Error('LNBits API error: 503 - upstream timeout'))).toBe(
      'HTTP 503: upstream timeout',
    )
  })

  it('truncates very long messages', () => {
    const msg = 'LNBits API error: 500 - ' + 'payment failed '.repeat(50)
    const out = sanitiseUpstreamError(msg)
    expect(out.startsWith('HTTP 500: ')).toBe(true)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThan(300)
  })

  it('returns a status-only summary when the JSON field is empty', () => {
    const msg = 'LNBits API error: 502 - {}'
    expect(sanitiseUpstreamError(msg)).toBe('Upstream provider error (HTTP 502).')
  })
})
