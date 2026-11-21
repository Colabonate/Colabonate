import { describe, it, expect } from 'vitest'
import type { Request } from 'express'
import { authTokenKey } from './rate-limit.js'

function mockReq(overrides: Partial<Request>): Request {
  return overrides as Request
}

describe('authTokenKey', () => {
  it('keys by a hash of the bearer token when present', () => {
    const req = mockReq({ headers: { authorization: 'Bearer abc123' } })
    const key = authTokenKey(req)
    expect(key).toMatch(/^tok:[0-9a-f]{64}$/)
  })

  it('produces a stable key for the same token', () => {
    const req1 = mockReq({ headers: { authorization: 'Bearer same-token' } })
    const req2 = mockReq({ headers: { authorization: 'Bearer same-token' } })
    expect(authTokenKey(req1)).toBe(authTokenKey(req2))
  })

  it('falls back to a normalized IPv4 key when no bearer token is present', () => {
    const req = mockReq({ headers: {}, ip: '203.0.113.7' })
    expect(authTokenKey(req)).toBe('203.0.113.7')
  })

  // Regression for ERR_ERL_KEY_GEN_IPV6: a raw req.ip fallback lets an IPv6
  // caller rotate through its assigned /64 (or wider) allocation to get a
  // fresh rate-limit bucket per request, defeating the limiter entirely.
  // express-rate-limit's own ipKeyGenerator collapses the address to a
  // subnet instead, matching every other caller in the same allocation.
  it('collapses an IPv6 fallback address to its subnet, not the raw address', () => {
    const req1 = mockReq({ headers: {}, ip: '2001:db8:1234:5678::1' })
    const req2 = mockReq({ headers: {}, ip: '2001:db8:1234:5678::2' })
    const key1 = authTokenKey(req1)
    const key2 = authTokenKey(req2)
    expect(key1).toBe(key2)
    expect(key1).not.toBe('2001:db8:1234:5678::1')
  })

  it('falls back to "unknown" when neither a token nor an IP is present', () => {
    const req = mockReq({ headers: {}, ip: undefined })
    expect(authTokenKey(req)).toBe('unknown')
  })
})
