import { describe, it, expect } from 'vitest'
import { sumProofsSats, selectProofsToSend, groupByMint } from './proofs.js'
import type { StoredProof } from './types.js'

const proof = (secret: string, amount: number): StoredProof => ({
  id: '009a1f29',
  amount,
  secret,
  C: '02' + 'ab'.repeat(32),
})

describe('sumProofsSats', () => {
  it('sums amounts', () => {
    expect(sumProofsSats([proof('a', 8), proof('b', 2), proof('c', 1)])).toBe(11)
  })
  it('is 0 for empty', () => {
    expect(sumProofsSats([])).toBe(0)
  })
})

describe('selectProofsToSend', () => {
  const proofs = [proof('a', 8), proof('b', 4), proof('c', 2), proof('d', 1)]

  it('selects largest-first to cover the target', () => {
    const res = selectProofsToSend(proofs, 5)
    expect(res).not.toBeNull()
    // 8 alone covers 5
    expect(sumProofsSats(res!.selected)).toBe(8)
    expect(res!.selected.map((p) => p.secret)).toEqual(['a'])
    expect(res!.remaining.map((p) => p.secret).sort()).toEqual(['b', 'c', 'd'])
  })

  it('accumulates multiple proofs when one is not enough', () => {
    const res = selectProofsToSend(proofs, 11)
    expect(sumProofsSats(res!.selected)).toBeGreaterThanOrEqual(11)
    expect(sumProofsSats(res!.selected)).toBe(12) // 8 + 4
  })

  it('returns null when proofs cannot cover the target', () => {
    expect(selectProofsToSend(proofs, 100)).toBeNull()
  })

  it('returns empty selection for a zero/negative target', () => {
    const res = selectProofsToSend(proofs, 0)
    expect(res!.selected).toEqual([])
    expect(res!.remaining).toHaveLength(proofs.length)
  })

  it('does not mutate the input', () => {
    const copy = [...proofs]
    selectProofsToSend(proofs, 5)
    expect(proofs).toEqual(copy)
  })
})

describe('groupByMint', () => {
  it('buckets proofs by mint url', () => {
    const m1 = 'https://a.mint'
    const m2 = 'https://b.mint'
    const grouped = groupByMint([
      { mintUrl: m1, proof: proof('a', 1) },
      { mintUrl: m2, proof: proof('b', 2) },
      { mintUrl: m1, proof: proof('c', 3) },
    ])
    expect(grouped.get(m1)!.map((p) => p.secret)).toEqual(['a', 'c'])
    expect(grouped.get(m2)!.map((p) => p.secret)).toEqual(['b'])
  })
})
