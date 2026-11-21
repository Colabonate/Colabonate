// Edge-case tests for validateZapRequest / zapDescriptionHash (ADR-417 D3).
// Complements zap-request.test.ts.

import { createHash } from 'crypto'
import { describe, it, expect } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { validateZapRequest, zapDescriptionHash, type ZapExpectation } from './zap-request.js'

const NOW = 1_800_000_000
const buyerSk = generateSecretKey()
const buyerPk = getPublicKey(buyerSk)
const payeePk = getPublicKey(generateSecretKey())
const otherPk = getPublicKey(generateSecretKey())
const LISTING = `30402:${payeePk}:edge-listing`

const EXPECT: ZapExpectation = {
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
    ['relays', 'wss://relay.example.com'],
  ]
}

function signWith(tags: string[][], overrides: { kind?: number; created_at?: number; content?: string } = {}) {
  return finalizeEvent(
    { kind: overrides.kind ?? 9734, created_at: overrides.created_at ?? NOW, tags, content: overrides.content ?? '' },
    buyerSk,
  )
}

function withTags(replace: (tags: string[][]) => string[][]) {
  return signWith(replace(baseTags()))
}

function flipFirstHexChar(hex: string): string {
  return (hex[0] === 'a' ? 'b' : 'a') + hex.slice(1)
}

describe('validateZapRequest edge cases', () => {
  describe('signature and id integrity', () => {
    it('rejects an event whose id was tampered (id no longer hashes the content)', () => {
      const event = signWith(baseTags())
      const r = validateZapRequest({ ...event, id: flipFirstHexChar(event.id) }, EXPECT, NOW)
      expect(r).toEqual({ ok: false, reason: 'zap request signature invalid' })
    })

    it('rejects an event whose sig was tampered', () => {
      const event = signWith(baseTags())
      const r = validateZapRequest({ ...event, sig: flipFirstHexChar(event.sig) }, EXPECT, NOW)
      expect(r).toEqual({ ok: false, reason: 'zap request signature invalid' })
    })

    it('rejects a sig of the wrong length without throwing', () => {
      const event = signWith(baseTags())
      expect(() => validateZapRequest({ ...event, sig: 'ab' }, EXPECT, NOW)).not.toThrow()
      expect(validateZapRequest({ ...event, sig: 'ab' }, EXPECT, NOW).ok).toBe(false)
    })

    it('rejects an event whose sig was mutated in place after a successful validation', () => {
      // Regression guard: nostr-tools caches verdicts on the verified object. The
      // validator verifies a fresh copy, so an in-place mutation must still be caught.
      const event = signWith(baseTags())
      expect(validateZapRequest(event, EXPECT, NOW).ok).toBe(true)
      event.sig = flipFirstHexChar(event.sig)
      expect(validateZapRequest(event, EXPECT, NOW)).toEqual({ ok: false, reason: 'zap request signature invalid' })
    })

    it('rejects an event whose content was mutated in place after a successful validation', () => {
      const event = signWith(baseTags(), { content: 'original' })
      expect(validateZapRequest(event, EXPECT, NOW).ok).toBe(true)
      event.content = 'changed'
      expect(validateZapRequest(event, EXPECT, NOW).ok).toBe(false)
    })
  })

  describe('kind and shape', () => {
    it('rejects a kind 9735 receipt presented as a zap request', () => {
      const event = signWith(baseTags(), { kind: 9735 })
      expect(validateZapRequest(event, EXPECT, NOW)).toEqual({ ok: false, reason: 'zap request has wrong kind' })
    })

    it.each([null, undefined, [], 'str', 42, true])('rejects non-object input %j', (value) => {
      expect(() => validateZapRequest(value, EXPECT, NOW)).not.toThrow()
      expect(validateZapRequest(value, EXPECT, NOW).ok).toBe(false)
    })

    it.each(['id', 'pubkey', 'sig', 'content'])('rejects an event missing %s', (field) => {
      const event: Record<string, unknown> = { ...signWith(baseTags()) }
      delete event[field]
      expect(validateZapRequest(event, EXPECT, NOW)).toEqual({ ok: false, reason: 'zap request is malformed' })
    })

    it('rejects a non-string id', () => {
      const event = { ...signWith(baseTags()), id: 123 }
      expect(validateZapRequest(event, EXPECT, NOW).ok).toBe(false)
    })

    it('rejects a missing tags array', () => {
      const event: Record<string, unknown> = { ...signWith(baseTags()) }
      delete event.tags
      expect(validateZapRequest(event, EXPECT, NOW)).toEqual({ ok: false, reason: 'zap request tags are malformed' })
    })

    it('rejects a tag with a numeric value', () => {
      const event = { ...signWith(baseTags()), tags: [...baseTags(), ['amount', 21000000]] }
      expect(validateZapRequest(event, EXPECT, NOW).ok).toBe(false)
    })

    it('rejects an empty tag array element', () => {
      const event = { ...signWith(baseTags()), tags: [...baseTags(), []] }
      expect(validateZapRequest(event, EXPECT, NOW).ok).toBe(false)
    })

    it('rejects a null tag element without throwing', () => {
      const event = { ...signWith(baseTags()), tags: [...baseTags(), null] }
      expect(() => validateZapRequest(event, EXPECT, NOW)).not.toThrow()
      expect(validateZapRequest(event, EXPECT, NOW).ok).toBe(false)
    })

    it('rejects an empty-string tag name', () => {
      expect(validateZapRequest(withTags((t) => [...t, ['', 'x']]), EXPECT, NOW).ok).toBe(false)
    })

    it('rejects an unknown tag name', () => {
      expect(validateZapRequest(withTags((t) => [...t, ['expiration', '1']]), EXPECT, NOW).ok).toBe(false)
    })

    it.each(['client', 'lnurl'])('accepts the allowed optional tag %s', (name) => {
      const event = withTags((t) => [...t, [name, 'value']])
      expect(validateZapRequest(event, EXPECT, NOW).ok).toBe(true)
    })

    it('rejects a p tag with an extra element (payee plus marker)', () => {
      const event = withTags((t) => t.map((tag) => (tag[0] === 'p' ? ['p', payeePk, 'extra'] : tag)))
      expect(validateZapRequest(event, EXPECT, NOW)).toEqual({ ok: false, reason: 'zap request payee mismatch' })
    })

    it('rejects a p tag with a bare name and no value', () => {
      const event = withTags((t) => t.map((tag) => (tag[0] === 'p' ? ['p'] : tag)))
      expect(validateZapRequest(event, EXPECT, NOW).ok).toBe(false)
    })
  })

  describe('p tag (payee)', () => {
    it('rejects two p tags even when both name the payee', () => {
      expect(validateZapRequest(withTags((t) => [...t, ['p', payeePk]]), EXPECT, NOW).ok).toBe(false)
    })

    it('rejects an uppercase-hex p tag when the expected payee is lowercase', () => {
      const event = withTags((t) => t.map((tag) => (tag[0] === 'p' ? ['p', payeePk.toUpperCase()] : tag)))
      expect(validateZapRequest(event, EXPECT, NOW).ok).toBe(false)
    })

    it('rejects a non-hex p tag that is not the expected payee', () => {
      const event = withTags((t) => t.map((tag) => (tag[0] === 'p' ? ['p', 'z'.repeat(64)] : tag)))
      expect(validateZapRequest(event, EXPECT, NOW).ok).toBe(false)
    })

    it('rejects a 63-char p tag that is not the expected payee', () => {
      const event = withTags((t) => t.map((tag) => (tag[0] === 'p' ? ['p', payeePk.slice(0, 63)] : tag)))
      expect(validateZapRequest(event, EXPECT, NOW).ok).toBe(false)
    })

    it('rejects a payee mismatch by one character', () => {
      const event = withTags((t) => t.map((tag) => (tag[0] === 'p' ? ['p', flipFirstHexChar(payeePk)] : tag)))
      expect(validateZapRequest(event, EXPECT, NOW).ok).toBe(false)
    })

    it('rejects a zap request whose author is the payee rather than the buyer', () => {
      const payeeSk = generateSecretKey()
      const event = finalizeEvent({ kind: 9734, created_at: NOW, tags: baseTags(), content: '' }, payeeSk)
      expect(validateZapRequest(event, { ...EXPECT, buyerPubkey: getPublicKey(payeeSk) }, NOW).ok).toBe(true)
      expect(validateZapRequest(event, EXPECT, NOW).ok).toBe(false)
    })
  })

  describe('amount tag', () => {
    it.each([
      ['missing', null],
      ['non-numeric', 'abc'],
      ['fractional msat', '1000.5'],
      ['negative', '-21000000'],
      ['one msat low', '20999999'],
      ['one msat high', '21000001'],
      ['leading zero', '021000000'],
      ['with plus', '+21000000'],
    ])('rejects amount tag: %s', (_label, value) => {
      const event = withTags((t) => (value === null ? t.filter((tag) => tag[0] !== 'amount') : t.map((tag) => (tag[0] === 'amount' ? ['amount', value] : tag))))
      expect(validateZapRequest(event, EXPECT, NOW).ok).toBe(false)
    })

    it('rejects an amount tag with a numeric (non-string) value', () => {
      // finalizeEvent refuses non-string tags, so build the malformed event unsigned.
      const signed = signWith(baseTags())
      const event = { ...signed, tags: baseTags().map((tag) => (tag[0] === 'amount' ? ['amount', 21000000 as unknown as string] : tag)) }
      expect(validateZapRequest(event, EXPECT, NOW)).toEqual({ ok: false, reason: 'zap request tags are malformed' })
    })
  })

  describe('a tag (listing)', () => {
    it('rejects a missing a tag', () => {
      expect(validateZapRequest(withTags((t) => t.filter((tag) => tag[0] !== 'a')), EXPECT, NOW).ok).toBe(false)
    })

    it('rejects a duplicate a tag with the correct value', () => {
      expect(validateZapRequest(withTags((t) => [...t, ['a', LISTING]]), EXPECT, NOW).ok).toBe(false)
    })

    it('rejects an a tag whose kind differs (30403 vs 30402)', () => {
      const event = withTags((t) => t.map((tag) => (tag[0] === 'a' ? ['a', LISTING.replace('30402:', '30403:')] : tag)))
      expect(validateZapRequest(event, EXPECT, NOW).ok).toBe(false)
    })
  })

  describe('relays tag', () => {
    it('accepts exactly 10 relays', () => {
      const relays = Array.from({ length: 10 }, (_, i) => `wss://relay${i}.example.com`)
      expect(validateZapRequest(withTags((t) => t.map((tag) => (tag[0] === 'relays' ? ['relays', ...relays] : tag))), EXPECT, NOW).ok).toBe(true)
    })

    it('rejects 11 relays', () => {
      const relays = Array.from({ length: 11 }, (_, i) => `wss://relay${i}.example.com`)
      expect(validateZapRequest(withTags((t) => t.map((tag) => (tag[0] === 'relays' ? ['relays', ...relays] : tag))), EXPECT, NOW).ok).toBe(false)
    })

    it('rejects an empty relays tag (no URLs)', () => {
      expect(validateZapRequest(withTags((t) => t.map((tag) => (tag[0] === 'relays' ? ['relays'] : tag))), EXPECT, NOW).ok).toBe(false)
    })

    it('rejects a relay list where one entry is not a websocket URL', () => {
      const event = withTags((t) => t.map((tag) => (tag[0] === 'relays' ? ['relays', 'wss://ok.example.com', 'not a url'] : tag)))
      expect(validateZapRequest(event, EXPECT, NOW).ok).toBe(false)
    })

    // 'ws:/broken' is deliberately NOT here: WHATWG parses it as ws://broken/ (accepted, see below).
    it.each(['wss://', 'javascript:alert(1)', 'https://relay.example.com'])('rejects relay %j', (url) => {
      expect(validateZapRequest(withTags((t) => t.map((tag) => (tag[0] === 'relays' ? ['relays', url] : tag))), EXPECT, NOW).ok).toBe(false)
    })

    // Surprising, asserted as current behaviour: the WHATWG URL parser normalises 'ws:/broken' to ws://broken/.
    it('accepts the non-canonical relay URL "ws:/broken" (WHATWG normalisation)', () => {
      expect(validateZapRequest(withTags((t) => t.map((tag) => (tag[0] === 'relays' ? ['relays', 'ws:/broken'] : tag))), EXPECT, NOW).ok).toBe(true)
    })

    it('accepts a plain ws:// relay URL', () => {
      expect(validateZapRequest(withTags((t) => t.map((tag) => (tag[0] === 'relays' ? ['relays', 'ws://127.0.0.1:4001'] : tag))), EXPECT, NOW).ok).toBe(true)
    })

    it('accepts a relay URL of exactly 200 characters', () => {
      const base = 'wss://r.example/'
      const url = base + 'a'.repeat(200 - base.length)
      expect(url.length).toBe(200)
      expect(validateZapRequest(withTags((t) => t.map((tag) => (tag[0] === 'relays' ? ['relays', url] : tag))), EXPECT, NOW).ok).toBe(true)
    })

    it('rejects a relay URL of 201 characters', () => {
      const base = 'wss://r.example/'
      const url = base + 'a'.repeat(201 - base.length)
      expect(url.length).toBe(201)
      expect(validateZapRequest(withTags((t) => t.map((tag) => (tag[0] === 'relays' ? ['relays', url] : tag))), EXPECT, NOW).ok).toBe(false)
    })
  })

  describe('content length', () => {
    it('accepts content of exactly 280 UTF-16 units', () => {
      expect(validateZapRequest(signWith(baseTags(), { content: 'x'.repeat(280) }), EXPECT, NOW).ok).toBe(true)
    })

    it('rejects content of 281 UTF-16 units', () => {
      expect(validateZapRequest(signWith(baseTags(), { content: 'x'.repeat(281) }), EXPECT, NOW).ok).toBe(false)
    })

    it('counts astral emoji as two UTF-16 units: 141 emoji (282 units) is rejected', () => {
      // Surprising, asserted as current behaviour: the limit is JS string length, not code points.
      const content = '\u{1F600}'.repeat(141)
      expect(content.length).toBe(282)
      expect(validateZapRequest(signWith(baseTags(), { content }), EXPECT, NOW).ok).toBe(false)
    })
  })

  describe('created_at window (+/- 600 s)', () => {
    it.each([
      [NOW + 600, true],
      [NOW - 600, true],
      [NOW + 601, false],
      [NOW - 601, false],
    ])('created_at offset → accepted=%s', (createdAt, accepted) => {
      expect(validateZapRequest(signWith(baseTags(), { created_at: createdAt }), EXPECT, NOW).ok).toBe(accepted)
    })

    it('rejects a non-integer created_at', () => {
      const event = { ...signWith(baseTags()), created_at: NOW + 0.5 }
      expect(validateZapRequest(event, EXPECT, NOW).ok).toBe(false)
    })

    it('rejects a string created_at', () => {
      const event = { ...signWith(baseTags()), created_at: String(NOW) }
      expect(validateZapRequest(event, EXPECT, NOW)).toEqual({ ok: false, reason: 'zap request created_at is not an integer' })
    })
  })

  describe('prototype and extra-field handling', () => {
    it('does not pollute Object.prototype when the event carries an own __proto__ key', () => {
      const signed = signWith(baseTags())
      const json = JSON.stringify(signed).replace('{', '{"__proto__":{"polluted":"yes"},')
      const event = JSON.parse(json) as Record<string, unknown>
      expect(() => validateZapRequest(event, EXPECT, NOW)).not.toThrow()
      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })

    it('does not throw on an event with an own constructor key', () => {
      const event = { ...signWith(baseTags()), constructor: 'x' }
      expect(() => validateZapRequest(event, EXPECT, NOW)).not.toThrow()
    })

    it('accepts a null-prototype object carrying valid fields', () => {
      const signed = signWith(baseTags())
      const event = Object.assign(Object.create(null), signed) as unknown
      expect(validateZapRequest(event, EXPECT, NOW).ok).toBe(true)
    })

    // Surprising, asserted as current behaviour: fields outside the NIP-01 id/sig set are not
    // rejected and are forwarded verbatim in the description JSON that the LNURL provider hashes.
    it('drops unsigned extra top-level fields from the forwarded JSON', () => {
      const event = { ...signWith(baseTags()), extra: 'unsigned' }
      const r = validateZapRequest(event, EXPECT, NOW)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(JSON.parse(r.json).extra).toBeUndefined()
      expect(Object.keys(JSON.parse(r.json)).sort()).toEqual(
        ['content', 'created_at', 'id', 'kind', 'pubkey', 'sig', 'tags'],
      )
    })
  })

  it('returns the exact JSON and id of the validated event for the LNURL callback', () => {
    const event = signWith(baseTags(), { content: 'hi' })
    const r = validateZapRequest(event, EXPECT, NOW)
    expect(r).toEqual({ ok: true, json: JSON.stringify(event), id: event.id })
  })
})

describe('zapDescriptionHash edge cases', () => {
  it('hashes multi-byte UTF-8 as bytes, not as UTF-16 code units', () => {
    const json = '{"content":"café \u{1F600}"}'
    expect(zapDescriptionHash(json)).toBe(createHash('sha256').update(Buffer.from(json, 'utf8')).digest('hex'))
  })

  it('returns 64 lowercase hex characters for the empty string', () => {
    expect(zapDescriptionHash('')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('differs for a single changed character (whitespace matters)', () => {
    expect(zapDescriptionHash('{"a":1}')).not.toBe(zapDescriptionHash('{"a": 1}'))
  })
})
