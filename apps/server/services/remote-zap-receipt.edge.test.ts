// Edge-case tests for selectReceiptPreimage (ADR-417 / FU-1003). Complements remote-zap-receipt.test.ts.

import { createHash } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, type Event } from 'nostr-tools'

vi.mock('./nostr-relay.js', () => ({ nostrService: { getEvents: vi.fn(async () => []) } }))

import { selectReceiptPreimage } from './remote-zap-receipt.js'

const PREIMAGE = 'ab'.repeat(32)
const HASH = createHash('sha256').update(Buffer.from(PREIMAGE, 'hex')).digest('hex')
const BOLT11 = 'lnbc210n1edgeinvoice'
const lookup = { bolt11: BOLT11, paymentHash: HASH }

function receipt(tags: string[][], createdAt = Math.floor(Date.now() / 1000)): Event {
  return finalizeEvent({ kind: 9735, created_at: createdAt, content: '', tags }, generateSecretKey())
}

const GOOD_TAGS = [
  ['bolt11', BOLT11],
  ['preimage', PREIMAGE],
]

describe('selectReceiptPreimage edge cases', () => {
  it('returns null for an empty event list', () => {
    expect(selectReceiptPreimage([], lookup)).toBeNull()
  })

  it('accepts an old receipt (created_at in 1970) because the preimage itself proves payment', () => {
    // The time window is applied in the relay query, not in this pure selector.
    expect(selectReceiptPreimage([receipt(GOOD_TAGS, 0)], lookup)).toBe(PREIMAGE)
  })

  it('ignores a receipt whose id was tampered (verifyEvent rejects it)', () => {
    const event = receipt(GOOD_TAGS)
    expect(selectReceiptPreimage([{ ...event, id: 'f'.repeat(64) }], lookup)).toBeNull()
  })

  it.each([63, 65])('ignores a preimage of %i hex characters', (length) => {
    const preimage = 'ab'.repeat(32).slice(0, length) + (length === 65 ? 'a' : '')
    const event = receipt([['bolt11', BOLT11], ['preimage', preimage]])
    expect(selectReceiptPreimage([event], lookup)).toBeNull()
  })

  it('ignores a preimage with a 0x prefix', () => {
    expect(selectReceiptPreimage([receipt([['bolt11', BOLT11], ['preimage', `0x${PREIMAGE}`]])], lookup)).toBeNull()
  })

  it('first bolt11 tag wins: a receipt whose first bolt11 names another invoice is ignored', () => {
    // Surprising, asserted as current behaviour: a second, matching bolt11 tag is never consulted.
    const event = receipt([['bolt11', 'lnbc1other'], ['bolt11', BOLT11], ['preimage', PREIMAGE]])
    expect(selectReceiptPreimage([event], lookup)).toBeNull()
  })

  it('first preimage tag wins: a valid second preimage is ignored when the first is malformed', () => {
    // Surprising, asserted as current behaviour: tagValue returns only the first preimage tag.
    const event = receipt([['bolt11', BOLT11], ['preimage', 'zz'], ['preimage', PREIMAGE]])
    expect(selectReceiptPreimage([event], lookup)).toBeNull()
  })

  it('skips a noisy batch of 60 non-matching receipts and returns the valid one at the end', () => {
    const noise = Array.from({ length: 60 }, (_, i) =>
      receipt([['bolt11', `lnbc1noise${i}`], ['preimage', 'cd'.repeat(32)]]),
    )
    const good = receipt(GOOD_TAGS)
    expect(selectReceiptPreimage([...noise, good], lookup)).toBe(PREIMAGE)
  })

  it('a receipt with a matching hash but a forged signature is ignored, a later valid one is used', () => {
    const forged = { ...receipt(GOOD_TAGS), sig: '1'.repeat(128) }
    const good = receipt(GOOD_TAGS)
    expect(selectReceiptPreimage([forged, good], lookup)).toBe(PREIMAGE)
  })

  // Regression: a single relay event whose tag value is not a string makes `toLowerCase()` throw
  // (tagValue returns 5, and 5.toLowerCase is not a function). selectReceiptPreimage has no
  // try/catch; findZapReceiptPreimage's catch then returns null, dropping the valid receipt
  // that follows in the same batch. The signature check runs after the throw, so it cannot help.
  it('a malformed noise event with a numeric bolt11 value does not hide a valid receipt', () => {
    const malformed = { ...receipt([['bolt11', BOLT11]]), tags: [['bolt11', 5 as unknown as string]] } as Event
    const good = receipt(GOOD_TAGS)
    expect(() => selectReceiptPreimage([malformed, good], lookup)).not.toThrow()
    expect(selectReceiptPreimage([malformed, good], lookup)).toBe(PREIMAGE)
  })

  // Regression: same class. A null tag element makes tagValue's `tag[0]` throw.
  it('a null tag element in a noise event does not hide a valid receipt', () => {
    const malformed = { ...receipt([['bolt11', BOLT11]]), tags: [null as unknown as string[]] } as Event
    const good = receipt(GOOD_TAGS)
    expect(selectReceiptPreimage([malformed, good], lookup)).toBe(PREIMAGE)
  })

  it('an event of kind 9735 with the preimage in a non-first tag position still matches', () => {
    const event = receipt([['p', 'a'.repeat(64)], ['a', '30402:x:y'], ['bolt11', BOLT11], ['preimage', PREIMAGE]])
    expect(selectReceiptPreimage([event], lookup)).toBe(PREIMAGE)
  })

  it('does not match when the lookup bolt11 is a prefix of the receipt bolt11', () => {
    const event = receipt([['bolt11', `${BOLT11}extra`], ['preimage', PREIMAGE]])
    expect(selectReceiptPreimage([event], lookup)).toBeNull()
  })
})
