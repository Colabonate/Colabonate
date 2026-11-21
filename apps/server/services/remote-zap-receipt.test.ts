import { createHash } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, type Event } from 'nostr-tools'

vi.mock('./nostr-relay.js', () => ({ nostrService: { getEvents: vi.fn(async () => []) } }))

import { selectReceiptPreimage } from './remote-zap-receipt.js'

const PREIMAGE = 'ab'.repeat(32)
const HASH = createHash('sha256').update(Buffer.from(PREIMAGE, 'hex')).digest('hex')
const BOLT11 = 'lnbc210n1receiptinvoice'
const lookup = { bolt11: BOLT11, paymentHash: HASH }

function receipt(tags: string[][], kind = 9735): Event {
  return finalizeEvent({ kind, created_at: Math.floor(Date.now() / 1000), content: '', tags }, generateSecretKey())
}

describe('selectReceiptPreimage (FU-1003)', () => {
  it('returns the preimage of a signed receipt for this invoice', () => {
    const event = receipt([['bolt11', BOLT11], ['preimage', PREIMAGE]])
    expect(selectReceiptPreimage([event], lookup)).toBe(PREIMAGE)
  })

  it('matches the bolt11 case-insensitively', () => {
    const event = receipt([['bolt11', BOLT11.toUpperCase()], ['preimage', PREIMAGE.toUpperCase()]])
    expect(selectReceiptPreimage([event], lookup)).toBe(PREIMAGE)
  })

  it('ignores a receipt without a preimage tag (provider assertion only, not proof)', () => {
    expect(selectReceiptPreimage([receipt([['bolt11', BOLT11]])], lookup)).toBeNull()
  })

  it('ignores a receipt whose preimage does not hash to the payment hash', () => {
    const event = receipt([['bolt11', BOLT11], ['preimage', 'cd'.repeat(32)]])
    expect(selectReceiptPreimage([event], lookup)).toBeNull()
  })

  it('ignores a receipt for a different invoice even with a valid-looking preimage', () => {
    const event = receipt([['bolt11', 'lnbc1other'], ['preimage', PREIMAGE]])
    expect(selectReceiptPreimage([event], lookup)).toBeNull()
  })

  it('ignores events of another kind', () => {
    const event = receipt([['bolt11', BOLT11], ['preimage', PREIMAGE]], 1)
    expect(selectReceiptPreimage([event], lookup)).toBeNull()
  })

  it('ignores an event with a broken signature', () => {
    const event = receipt([['bolt11', BOLT11], ['preimage', PREIMAGE]])
    const forged = { ...event, sig: '0'.repeat(128) }
    expect(selectReceiptPreimage([forged], lookup)).toBeNull()
  })

  it('ignores a malformed preimage tag', () => {
    expect(selectReceiptPreimage([receipt([['bolt11', BOLT11], ['preimage', 'zz']])], lookup)).toBeNull()
  })

  it('skips noise and finds the matching receipt among several', () => {
    const noise = receipt([['bolt11', 'lnbc1other'], ['preimage', 'cd'.repeat(32)]])
    const good = receipt([['bolt11', BOLT11], ['preimage', PREIMAGE]])
    expect(selectReceiptPreimage([noise, good], lookup)).toBe(PREIMAGE)
  })
})
