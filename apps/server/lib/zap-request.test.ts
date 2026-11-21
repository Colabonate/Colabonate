import { describe, it, expect } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { validateZapRequest, zapDescriptionHash, type ZapExpectation } from './zap-request.js'

const NOW = 1_800_000_000
const buyerSk = generateSecretKey()
const buyerPk = getPublicKey(buyerSk)
const payeePk = getPublicKey(generateSecretKey())
const otherPk = getPublicKey(generateSecretKey())
const LISTING = `30402:${payeePk}:mercasats-187`

const expect0: ZapExpectation = {
  buyerPubkey: buyerPk,
  payeePubkey: payeePk,
  amountMsats: 21_000_000,
  listingAddress: LISTING,
}

function baseTags(): string[][] {
  return [
    ['p', payeePk],
    ['amount', '21000000'],
    ['a', LISTING],
    ['relays', 'wss://relay.example.com', 'wss://nos.lol'],
  ]
}

function sign(overrides: Partial<{ kind: number; created_at: number; tags: string[][]; content: string }> = {}) {
  return finalizeEvent(
    {
      kind: overrides.kind ?? 9734,
      created_at: overrides.created_at ?? NOW,
      tags: overrides.tags ?? baseTags(),
      content: overrides.content ?? 'thanks',
    },
    buyerSk,
  )
}

describe('validateZapRequest', () => {
  it('accepts a correctly signed zap request and returns its exact JSON', () => {
    const event = sign()
    const result = validateZapRequest(event, expect0, NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.json).toBe(JSON.stringify(event))
    expect(result.id).toBe(event.id)
  })

  it('rejects a tampered event (signature no longer valid)', () => {
    const event = sign()
    const result = validateZapRequest({ ...event, content: 'tampered' }, expect0, NOW)
    expect(result).toEqual({ ok: false, reason: 'zap request signature invalid' })
  })

  it('rejects an author that is not the buyer', () => {
    const event = finalizeEvent({ kind: 9734, created_at: NOW, tags: baseTags(), content: '' }, generateSecretKey())
    expect(validateZapRequest(event, { ...expect0, buyerPubkey: otherPk }, NOW).ok).toBe(false)
    expect(validateZapRequest(event, expect0, NOW).ok).toBe(false)
  })

  it('rejects a wrong p tag', () => {
    const tags = baseTags().map((t) => (t[0] === 'p' ? ['p', otherPk] : t))
    expect(validateZapRequest(sign({ tags }), expect0, NOW).ok).toBe(false)
  })

  it('rejects a missing p tag', () => {
    const tags = baseTags().filter((t) => t[0] !== 'p')
    expect(validateZapRequest(sign({ tags }), expect0, NOW).ok).toBe(false)
  })

  it('rejects duplicate p tags', () => {
    const tags = [...baseTags(), ['p', payeePk]]
    expect(validateZapRequest(sign({ tags }), expect0, NOW).ok).toBe(false)
  })

  it('rejects a wrong amount tag', () => {
    const tags = baseTags().map((t) => (t[0] === 'amount' ? ['amount', '1000'] : t))
    expect(validateZapRequest(sign({ tags }), expect0, NOW).ok).toBe(false)
  })

  it('rejects a missing amount tag', () => {
    const tags = baseTags().filter((t) => t[0] !== 'amount')
    expect(validateZapRequest(sign({ tags }), expect0, NOW).ok).toBe(false)
  })

  it('rejects a wrong a tag', () => {
    const tags = baseTags().map((t) => (t[0] === 'a' ? ['a', `30402:${otherPk}:other`] : t))
    expect(validateZapRequest(sign({ tags }), expect0, NOW).ok).toBe(false)
  })

  it('rejects a missing a tag', () => {
    const tags = baseTags().filter((t) => t[0] !== 'a')
    expect(validateZapRequest(sign({ tags }), expect0, NOW).ok).toBe(false)
  })

  it('rejects a missing relays tag', () => {
    const tags = baseTags().filter((t) => t[0] !== 'relays')
    expect(validateZapRequest(sign({ tags }), expect0, NOW).ok).toBe(false)
  })

  it('rejects more than 10 relays', () => {
    const relays = Array.from({ length: 11 }, (_, i) => `wss://relay${i}.example.com`)
    const tags = baseTags().map((t) => (t[0] === 'relays' ? ['relays', ...relays] : t))
    expect(validateZapRequest(sign({ tags }), expect0, NOW).ok).toBe(false)
  })

  it('rejects a non-websocket relay URL', () => {
    const tags = baseTags().map((t) => (t[0] === 'relays' ? ['relays', 'https://relay.example.com'] : t))
    expect(validateZapRequest(sign({ tags }), expect0, NOW).ok).toBe(false)
  })

  it('rejects an extra disallowed tag', () => {
    const tags = [...baseTags(), ['e', 'a'.repeat(64)]]
    expect(validateZapRequest(sign({ tags }), expect0, NOW).ok).toBe(false)
  })

  it('rejects content longer than 280 characters', () => {
    expect(validateZapRequest(sign({ content: 'x'.repeat(281) }), expect0, NOW).ok).toBe(false)
  })

  it('accepts content of exactly 280 characters', () => {
    expect(validateZapRequest(sign({ content: 'x'.repeat(280) }), expect0, NOW).ok).toBe(true)
  })

  it('rejects a created_at more than 10 minutes away from now', () => {
    const event = sign({ created_at: NOW - 11 * 60 })
    expect(validateZapRequest(event, expect0, NOW).ok).toBe(false)
  })

  it('rejects a wrong kind', () => {
    const event = sign({ kind: 1 })
    expect(validateZapRequest(event, expect0, NOW).ok).toBe(false)
  })

  it('rejects non-object inputs without throwing', () => {
    for (const value of [null, 'x', 42, undefined, []]) {
      expect(validateZapRequest(value, expect0, NOW).ok).toBe(false)
    }
  })
})

describe('zapDescriptionHash', () => {
  it('is the sha256 hex of the UTF-8 JSON string', () => {
    expect(zapDescriptionHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
