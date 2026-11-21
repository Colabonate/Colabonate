import { describe, it, expect } from 'vitest'
import { encodeToken, decodeToken } from './token.js'
import type { StoredProof } from './types.js'

// Deterministic, no network: encode then decode must round-trip.
// C must be valid 33-byte compressed-pubkey hex (cashu-ts validates on encode).
const KEYSET = '009a1f293253e41e'
const proofs: StoredProof[] = [
  { id: KEYSET, amount: 8, secret: 'a'.repeat(64), C: '02' + 'ab'.repeat(32) },
  { id: KEYSET, amount: 2, secret: 'b'.repeat(64), C: '03' + 'cd'.repeat(32) },
]

describe('encodeToken / decodeToken', () => {
  it('produces a cashu token string', () => {
    const enc = encodeToken('https://testnut.cashu.space', proofs, { memo: 'hi' })
    expect(enc.startsWith('cashu')).toBe(true)
  })

  it('round-trips mint, proofs (number amounts), memo and unit', () => {
    const enc = encodeToken('https://testnut.cashu.space', proofs, { memo: 'hi', unit: 'sat' })
    const dec = decodeToken(enc, [KEYSET])
    expect(dec.mintUrl).toBe('https://testnut.cashu.space')
    expect(dec.unit).toBe('sat')
    expect(dec.memo).toBe('hi')
    expect(dec.proofs).toHaveLength(2)
    // amounts come back as plain numbers, not Amount instances
    expect(dec.proofs.map((p) => p.amount).sort((a, b) => a - b)).toEqual([2, 8])
    expect(typeof dec.proofs[0].amount).toBe('number')
    expect(dec.proofs.map((p) => p.secret).sort()).toEqual(['a'.repeat(64), 'b'.repeat(64)])
  })

  it('decodes without known keyset ids (ids are carried in the token)', () => {
    const enc = encodeToken('https://testnut.cashu.space', proofs)
    const dec = decodeToken(enc)
    expect(dec.proofs).toHaveLength(2)
  })
})
