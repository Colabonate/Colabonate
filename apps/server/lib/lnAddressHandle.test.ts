import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  buildPayRequest,
  normalizeHandle,
  parseCallbackAmount,
  readLnurlpDomain,
  validateHandle,
  type LnurlpLimits,
} from './lnAddressHandle'

const LIMITS: LnurlpLimits = { minSendable: 1000, maxSendable: 1_000_000_000 }

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('normalizeHandle', () => {
  it('lowercases and trims', () => {
    expect(normalizeHandle('  Alice  ')).toBe('alice')
  })

  it('accepts @handle and handle@domain', () => {
    expect(normalizeHandle('@alice')).toBe('alice')
    expect(normalizeHandle('Alice@colabonate.app')).toBe('alice')
  })

  it('returns empty string for missing input', () => {
    expect(normalizeHandle(null)).toBe('')
    expect(normalizeHandle(undefined)).toBe('')
    expect(normalizeHandle('')).toBe('')
  })
})

describe('validateHandle', () => {
  it('accepts a normal handle', () => {
    const result = validateHandle('Alice_01')
    expect(result).toEqual({ ok: true, handle: 'alice_01' })
  })

  it('rejects too short / too long handles', () => {
    expect(validateHandle('ab').ok).toBe(false)
    expect(validateHandle('a'.repeat(31)).ok).toBe(false)
  })

  it('rejects invalid separators and characters', () => {
    expect(validateHandle('-alice').ok).toBe(false)
    expect(validateHandle('alice.').ok).toBe(false)
    expect(validateHandle('ali ce').ok).toBe(false)
    expect(validateHandle('ali/ce').ok).toBe(false)
  })

  it('rejects reserved handles', () => {
    expect(validateHandle('admin').ok).toBe(false)
    expect(validateHandle('support').ok).toBe(false)
    expect(validateHandle('Colabonate').ok).toBe(false)
  })
})

describe('parseCallbackAmount', () => {
  it('converts millisatoshis to sats', () => {
    expect(parseCallbackAmount('21000', LIMITS)).toEqual({ ok: true, sats: 21 })
  })

  it('rejects missing / non-integer / out-of-range amounts', () => {
    expect(parseCallbackAmount(undefined, LIMITS).ok).toBe(false)
    expect(parseCallbackAmount('', LIMITS).ok).toBe(false)
    expect(parseCallbackAmount('21.5', LIMITS).ok).toBe(false)
    expect(parseCallbackAmount('abc', LIMITS).ok).toBe(false)
    expect(parseCallbackAmount('999', LIMITS).ok).toBe(false)
    expect(parseCallbackAmount(String(LIMITS.maxSendable + 1), LIMITS).ok).toBe(false)
  })

  it('floors sub-sat remainders and rejects sub-sat totals', () => {
    expect(parseCallbackAmount('2500', LIMITS)).toEqual({ ok: true, sats: 2 })
    expect(parseCallbackAmount('1500', LIMITS)).toEqual({ ok: true, sats: 1 })
    expect(parseCallbackAmount('1000', LIMITS)).toEqual({ ok: true, sats: 1 })
  })
})

describe('buildPayRequest', () => {
  it('builds a LUD-06 payRequest with identifier metadata and a trimmed callback', () => {
    const doc = buildPayRequest('alice', 'colabonate.app', 'https://colabonate.app/', LIMITS)
    expect(doc.tag).toBe('payRequest')
    expect(doc.callback).toBe('https://colabonate.app/.well-known/lnurlp/alice/callback')
    expect(doc.minSendable).toBe(LIMITS.minSendable)
    expect(doc.maxSendable).toBe(LIMITS.maxSendable)
    expect(doc.allowsNostr).toBe(false)
    const metadata = JSON.parse(doc.metadata) as string[][]
    expect(metadata).toContainEqual(['text/identifier', 'alice@colabonate.app'])
  })
})

describe('readLnurlpDomain', () => {
  it('prefers LNURLP_DOMAIN', () => {
    vi.stubEnv('LNURLP_DOMAIN', 'ln.example.org')
    vi.stubEnv('BASE_URL', 'https://colabonate.app')
    expect(readLnurlpDomain()).toBe('ln.example.org')
  })

  it('falls back to the BASE_URL host', () => {
    vi.stubEnv('LNURLP_DOMAIN', '')
    vi.stubEnv('BASE_URL', 'https://colabonate.app')
    vi.stubEnv('LNURLP_BASE_URL', '')
    expect(readLnurlpDomain()).toBe('colabonate.app')
  })
})
