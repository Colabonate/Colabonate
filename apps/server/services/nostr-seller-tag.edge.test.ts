// Edge-case tests for extractSellerPubkey (ADR-417 D1). Complements the seller block in nostr-normalizer.test.ts.

import { describe, expect, it } from 'vitest'
import type { Event } from 'nostr-tools'

import { extractSellerPubkey, normalizeOfferEvent } from './nostr-normalizer.js'

const SELLER = '9a43f3ee53d67c6cc24aeeda2f575548db352f60f8b9d997ce32a995bd353e59'
const OTHER = '1111111111111111111111111111111111111111111111111111111111111111'
const AUTHOR = '2222222222222222222222222222222222222222222222222222222222222222'

function listing(tags: string[][], pubkey = AUTHOR): Event {
  return {
    kind: 30402,
    tags: [['d', 'edge-1'], ['title', 'Widget'], ['price', '1000', 'sats'], ...tags],
    content: 'A listing',
    created_at: 1_700_000_000,
    pubkey,
    id: 'edge-event-id',
    sig: 'sig',
  }
}

describe('extractSellerPubkey edge cases', () => {
  describe('role marker', () => {
    it('ignores a role marker that differs only in case ("Seller")', () => {
      // Surprising, asserted as current behaviour: the role comparison is exact and case-sensitive.
      expect(extractSellerPubkey([['p', SELLER, '', 'Seller']])).toBeNull()
    })

    it('ignores a p tag with no role element at all', () => {
      expect(extractSellerPubkey([['p', SELLER]])).toBeNull()
      expect(extractSellerPubkey([['p', SELLER, '']])).toBeNull()
    })

    it('ignores the buyer role', () => {
      expect(extractSellerPubkey([['p', SELLER, '', 'buyer']])).toBeNull()
    })

    it('ignores "seller" placed in the relay-hint position instead of the role position', () => {
      expect(extractSellerPubkey([['p', SELLER, 'seller']])).toBeNull()
    })

    it('accepts a non-empty relay hint in position 2 when the role is in position 3', () => {
      expect(extractSellerPubkey([['p', SELLER, 'wss://relay.example', 'seller']])).toBe(SELLER)
    })
  })

  describe('pubkey format', () => {
    it('lowercases a mixed-case valid pubkey', () => {
      const mixed = SELLER.slice(0, 20).toUpperCase() + SELLER.slice(20)
      expect(extractSellerPubkey([['p', mixed, '', 'seller']])).toBe(SELLER)
    })

    it.each([63, 65])('rejects a %i-character pubkey', (length) => {
      const value = length === 63 ? SELLER.slice(0, 63) : `${SELLER}a`
      expect(extractSellerPubkey([['p', value, '', 'seller']])).toBeNull()
    })

    it('rejects a 64-character non-hex pubkey', () => {
      expect(extractSellerPubkey([['p', 'g'.repeat(64), '', 'seller']])).toBeNull()
    })

    it('rejects a pubkey with surrounding whitespace (no trimming)', () => {
      expect(extractSellerPubkey([['p', ` ${SELLER} `, '', 'seller']])).toBeNull()
    })

    it('rejects an npub-encoded value', () => {
      expect(extractSellerPubkey([['p', 'npub1' + 'q'.repeat(58), '', 'seller']])).toBeNull()
    })
  })

  describe('multiple and positioned tags', () => {
    it('finds the seller tag when it comes after several other p tags', () => {
      expect(
        extractSellerPubkey([
          ['p', OTHER],
          ['p', OTHER, '', 'mention'],
          ['p', SELLER, '', 'seller'],
        ]),
      ).toBe(SELLER)
    })

    it('uses a later valid seller tag when the first seller tag is malformed', () => {
      expect(extractSellerPubkey([['p', 'short', '', 'seller'], ['p', SELLER, '', 'seller']])).toBe(SELLER)
    })

    it('returns the same key when two seller tags carry the same pubkey in different cases', () => {
      expect(extractSellerPubkey([['p', SELLER.toUpperCase(), '', 'seller'], ['p', SELLER, '', 'seller']])).toBe(SELLER)
    })

    it('ignores non-p tags that happen to carry the seller marker', () => {
      expect(extractSellerPubkey([['e', SELLER, '', 'seller'], ['a', SELLER, '', 'seller']])).toBeNull()
    })
  })

  describe('malformed tag arrays (must not throw)', () => {
    it('returns null for an empty tag array', () => {
      expect(extractSellerPubkey([])).toBeNull()
    })

    it('returns null for a bare ["p"] tag', () => {
      expect(() => extractSellerPubkey([['p']])).not.toThrow()
      expect(extractSellerPubkey([['p']])).toBeNull()
    })

    it('returns null for a string element whose first character is "p" (no false match)', () => {
      // A string tag 'pseller' has tag[0] === 'p' and tag[3] === 'e', never the whole word 'seller'.
      const malformed = ['pseller'] as unknown as string[][]
      expect(() => extractSellerPubkey(malformed)).not.toThrow()
      expect(extractSellerPubkey(malformed)).toBeNull()
    })

    it('returns null for a numeric pubkey value', () => {
      expect(extractSellerPubkey([['p', 123 as unknown as string, '', 'seller']])).toBeNull()
    })

    // Regression: a null element in the tags array makes `tag[0]` throw. Nothing before the
    // throw is caught, so a valid seller tag after the null element is never reached.
    it('a null tag element does not prevent finding a later seller tag', () => {
      const tags = [null, ['p', SELLER, '', 'seller']] as unknown as string[][]
      expect(() => extractSellerPubkey(tags)).not.toThrow()
      expect(extractSellerPubkey(tags)).toBe(SELLER)
    })
  })

  describe('interaction with the author pubkey', () => {
    it('returns a seller that equals the event author without special-casing it (self-listing)', () => {
      const result = normalizeOfferEvent(listing([['p', SELLER, '', 'seller']], SELLER), 'wss://relay.example')
      expect(result?.remoteAuthor).toBe(SELLER)
      expect(result?.remoteSellerPubkey).toBe(SELLER)
    })

    it('keeps the seller distinct from the author when they differ', () => {
      const result = normalizeOfferEvent(listing([['p', SELLER, '', 'seller']], AUTHOR), 'wss://relay.example')
      expect(result?.remoteAuthor).toBe(AUTHOR)
      expect(result?.remoteSellerPubkey).toBe(SELLER)
    })
  })
})
