import { describe, it, expect } from 'vitest'
import { verifyPreimage } from './preimage.js'

// Known-good pair: sha256(Buffer.from(PREIMAGE, 'hex')) === PAYMENT_HASH
const PREIMAGE = 'cc4e8eccf4c73f2aad8e44149358b0c8ad6f495de9a16a2999918dc670041993'
const PAYMENT_HASH = '2e41e3673d96d410ab42275c3a7e50e08552e988ecffabc5170c8c6ae20f0921'

describe('verifyPreimage', () => {
  it('returns true for a matching preimage/hash pair', () => {
    expect(verifyPreimage(PREIMAGE, PAYMENT_HASH)).toBe(true)
  })

  it('returns false for a mismatched preimage', () => {
    const wrongPreimage = 'a'.repeat(64)
    expect(verifyPreimage(wrongPreimage, PAYMENT_HASH)).toBe(false)
  })

  it('returns false for an empty preimage', () => {
    expect(verifyPreimage('', PAYMENT_HASH)).toBe(false)
  })

  it('returns false for an empty paymentHash', () => {
    expect(verifyPreimage(PREIMAGE, '')).toBe(false)
  })
})
