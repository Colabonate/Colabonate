import { describe, it, expect } from 'vitest'
import {
  normalizeMintUrl,
  createState,
  addMint,
  removeMint,
  addProofs,
  removeProofs,
  balanceByMint,
  totalBalanceSats,
} from './wallet-state.js'
import type { StoredProof } from './types.js'

const MINT = 'https://testnut.cashu.space'
const proof = (secret: string, amount: number): StoredProof => ({
  id: '009a1f29',
  amount,
  secret,
  C: '02' + 'ab'.repeat(32),
})

describe('normalizeMintUrl', () => {
  it('strips trailing slash and lowercases host', () => {
    expect(normalizeMintUrl('https://Mint.Example.com/')).toBe('https://mint.example.com')
    expect(normalizeMintUrl('https://mint.example.com//')).toBe('https://mint.example.com')
  })
  it('treats variants as equal', () => {
    expect(normalizeMintUrl('https://A.com/')).toBe(normalizeMintUrl('https://a.com'))
  })
})

describe('mint list', () => {
  it('adds and dedupes mints', () => {
    let s = createState()
    s = addMint(s, MINT)
    s = addMint(s, MINT + '/') // normalised duplicate
    expect(s.mints).toEqual([MINT])
  })
  it('removes a mint and its bucket', () => {
    let s = addProofs(createState(), MINT, [proof('a', 5)])
    s = removeMint(s, MINT)
    expect(s.mints).toEqual([])
    expect(s.buckets).toEqual([])
  })
})

describe('addProofs', () => {
  it('auto-trusts the mint and stores proofs', () => {
    const s = addProofs(createState(), MINT, [proof('a', 8), proof('b', 2)])
    expect(s.mints).toEqual([MINT])
    expect(balanceByMint(s, MINT)).toBe(10)
  })

  it('is idempotent on duplicate secrets (no double count)', () => {
    let s = addProofs(createState(), MINT, [proof('a', 8)])
    s = addProofs(s, MINT, [proof('a', 8), proof('b', 2)])
    expect(balanceByMint(s, MINT)).toBe(10)
  })

  it('does not mutate the previous state', () => {
    const s0 = createState()
    const s1 = addProofs(s0, MINT, [proof('a', 8)])
    expect(s0.buckets).toEqual([])
    expect(s1).not.toBe(s0)
  })
})

describe('removeProofs', () => {
  it('removes spent proofs by secret', () => {
    let s = addProofs(createState(), MINT, [proof('a', 8), proof('b', 2)])
    s = removeProofs(s, MINT, ['a'])
    expect(balanceByMint(s, MINT)).toBe(2)
  })
  it('drops the bucket when emptied', () => {
    let s = addProofs(createState(), MINT, [proof('a', 8)])
    s = removeProofs(s, MINT, ['a'])
    expect(s.buckets).toEqual([])
    // mint stays trusted even with no proofs
    expect(s.mints).toEqual([MINT])
  })
})

describe('totalBalanceSats', () => {
  it('sums across mints', () => {
    let s = addProofs(createState(), MINT, [proof('a', 8)])
    s = addProofs(s, 'https://other.mint', [proof('b', 5)])
    expect(totalBalanceSats(s)).toBe(13)
  })
})
