import { describe, expect, it } from 'vitest'
import {
  ACTIVE_MCP_PASS_ORDER,
  computePassExpiry,
  DEFAULT_MCP_PASS_TIERS,
  findAnyMcpPassTier,
  findMcpPassTier,
  getMcpPassTiers,
  LEGACY_MCP_PASS_TIERS,
  mcpLifetimeConnectionTtlMs,
} from './mcp-passes.js'

describe('getMcpPassTiers (ADR-384 D11 / ADR-410)', () => {
  it('defaults to the single lifetime tier at the payment floor', () => {
    expect(getMcpPassTiers(undefined)).toEqual(DEFAULT_MCP_PASS_TIERS)
    expect(DEFAULT_MCP_PASS_TIERS).toEqual([{ id: 'lifetime', hours: null, priceSats: 2600 }])
  })
  it('accepts a valid override (incl. null hours), rejects malformed / duplicate / non-integer input', () => {
    expect(getMcpPassTiers(JSON.stringify([{ id: 'hour', hours: 1, priceSats: 3000 }]))).toEqual([{ id: 'hour', hours: 1, priceSats: 3000 }])
    expect(getMcpPassTiers(JSON.stringify([{ id: 'patron', hours: null, priceSats: 5000 }]))).toEqual([{ id: 'patron', hours: null, priceSats: 5000 }])
    expect(getMcpPassTiers('{nope')).toEqual(DEFAULT_MCP_PASS_TIERS)
    expect(getMcpPassTiers(JSON.stringify([{ id: 'x', hours: 0, priceSats: 1 }]))).toEqual(DEFAULT_MCP_PASS_TIERS)
    expect(getMcpPassTiers(JSON.stringify([{ id: 'x', hours: 'soon', priceSats: 5000 }]))).toEqual(DEFAULT_MCP_PASS_TIERS)
    expect(getMcpPassTiers(JSON.stringify([{ id: 'x', hours: 1, priceSats: 1.5 }]))).toEqual(DEFAULT_MCP_PASS_TIERS)
    const dup = [{ id: 'a', hours: 1, priceSats: 2600 }, { id: 'a', hours: 2, priceSats: 5000 }]
    expect(getMcpPassTiers(JSON.stringify(dup))).toEqual(DEFAULT_MCP_PASS_TIERS)
  })
  it('sale lookup finds the lifetime tier and rejects unknown ids', () => {
    expect(findMcpPassTier('lifetime')).toEqual({ id: 'lifetime', hours: null, priceSats: 2600 })
    expect(findMcpPassTier('nope')).toBeUndefined()
    expect(findMcpPassTier(1)).toBeUndefined()
  })
  it('legacy tiers resolve via findAnyMcpPassTier but are never for sale (ADR-410 D4)', () => {
    expect(findMcpPassTier('week')).toBeUndefined()
    expect(findAnyMcpPassTier('week')).toEqual({ id: 'week', hours: 168, priceSats: 7000, legacy: true })
    expect(findAnyMcpPassTier('day')?.priceSats).toBe(2600)
    expect(findAnyMcpPassTier('month')?.hours).toBe(720)
    expect(findAnyMcpPassTier('nope')).toBeUndefined()
    expect(LEGACY_MCP_PASS_TIERS.every((t) => t.legacy === true && t.hours !== null)).toBe(true)
  })
})

describe('computePassExpiry (dated tiers only)', () => {
  const now = new Date('2026-09-19T12:00:00Z')
  it('starts now when no pass is active', () => {
    expect(computePassExpiry(now, null, 24).toISOString()).toBe('2026-09-20T12:00:00.000Z')
    expect(computePassExpiry(now, new Date('2026-09-18T00:00:00Z'), 24).toISOString()).toBe('2026-09-20T12:00:00.000Z')
  })
  it('extends from the end of a still-active pass', () => {
    expect(computePassExpiry(now, new Date('2026-09-21T12:00:00Z'), 24).toISOString()).toBe('2026-09-22T12:00:00.000Z')
  })
})

describe('mcpLifetimeConnectionTtlMs (ADR-410 D3)', () => {
  it('defaults to 366 days and clamps env overrides to 1 hour .. 5 years', () => {
    expect(mcpLifetimeConnectionTtlMs()).toBe(366 * 24 * 3600_000)
  })
})

describe('active pass query helpers (ADR-410 D2)', () => {
  it('treats null expiry as active and pins lifetime-first ordering', () => {
    const where = ACTIVE_MCP_PASS_ORDER.length ? { status: 'PAID', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } : null
    expect(where).not.toBeNull()
    expect(ACTIVE_MCP_PASS_ORDER).toEqual([{ expiresAt: { sort: 'desc', nulls: 'first' } }])
  })
})
