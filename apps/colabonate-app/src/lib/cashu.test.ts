/**
 * lib/cashu tests (ADR-187 Phase 2 headless foundation).
 *
 * Covers the pure seam between @col/cashu and this app's NIP-44 plumbing:
 * the self-encryption codec, the P2PK key helpers, default-mint seeding,
 * proof merge from decrypted NIP-60 events, and latest-per-mint selection.
 * No network / no DOM — everything here is deterministic in node.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createNip44Codec,
  generateWalletPrivkey,
  getWalletPubkey,
  hydrateStateFromEvents,
  isCashuEnabled,
  getMintTrust,
  latestTokenEventPerMint,
  DEFAULT_CASHU_MINTS,
  DEFAULT_VETTED_MINTS,
  DEFAULT_TEST_MINTS,
} from './cashu'
import { totalBalanceSats } from '@col/cashu'
import type { StoredProof } from '@col/cashu'

function proof(secret: string, amount: number, id = '00'): StoredProof {
  return { id, amount, secret, C: '02' + '00'.repeat(32) }
}

beforeEach(() => {
  vi.unstubAllEnvs()
})

// — Codec bridge ——————————————————————————————————————————————

describe('createNip44Codec', () => {
  it('round-trips encrypt -> decrypt to self', async () => {
    const codec = createNip44Codec(generateWalletPrivkey())
    const plaintext = '{"mint":"https://testnut.cashu.space"}'
    const ciphertext = await codec.encrypt(plaintext)
    expect(ciphertext).not.toBe(plaintext)
    expect(await codec.decrypt(ciphertext)).toBe(plaintext)
  })

  it('produces ciphertext that another key cannot decrypt', async () => {
    const a = createNip44Codec(generateWalletPrivkey())
    const b = createNip44Codec(generateWalletPrivkey())
    const ciphertext = await a.encrypt('secret wallet state')
    await expect(async () => b.decrypt(ciphertext)).rejects.toThrow()
  })

  it('is stable: the same key + plaintext decrypt to themselves independently', async () => {
    const codec = createNip44Codec(generateWalletPrivkey())
    const msg = 'hello cashu'
    expect(await codec.decrypt(await codec.encrypt(msg))).toBe(msg)
    expect(await codec.decrypt(await codec.encrypt(msg))).toBe(msg)
  })
})

// — P2PK key helpers ———————————————————————————————————————————

describe('wallet key helpers', () => {
  it('generates a 64-char hex privkey', () => {
    const sk = generateWalletPrivkey()
    expect(sk).toMatch(/^[0-9a-f]{64}$/)
  })

  it('derives the same pubkey for the same privkey', () => {
    const sk = generateWalletPrivkey()
    expect(getWalletPubkey(sk)).toBe(getWalletPubkey(sk))
    expect(getWalletPubkey(sk)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates distinct keys', () => {
    expect(generateWalletPrivkey()).not.toBe(generateWalletPrivkey())
  })
})

// — hydrateStateFromEvents ————————————————————————————————————

describe('hydrateStateFromEvents', () => {
  it('seeds the curated default mints when no wallet event exists', () => {
    const { state, walletPrivkeyHex } = hydrateStateFromEvents(null, [])
    expect(state.mints).toEqual([...DEFAULT_CASHU_MINTS])
    expect(state.buckets).toEqual([])
    expect(walletPrivkeyHex).toBeUndefined()
    expect(totalBalanceSats(state)).toBe(0)
  })

  it('uses the wallet event mint list when present (even if empty)', () => {
    const { state, walletPrivkeyHex } = hydrateStateFromEvents(
      { mints: ['https://mint.example'], walletPrivkeyHex: 'a'.repeat(64) },
      [],
    )
    expect(state.mints).toEqual(['https://mint.example'])
    expect(walletPrivkeyHex).toBe('a'.repeat(64))
  })

  it('merges proofs from token events per mint', () => {
    const tokens = [
      { mintUrl: 'https://mint.example', proofs: [proof('s1', 5), proof('s2', 2)], createdAt: 1 },
      { mintUrl: 'https://other.example', proofs: [proof('s3', 8)], createdAt: 2 },
    ]
    const { state } = hydrateStateFromEvents({ mints: ['https://mint.example'] }, tokens)
    expect(totalBalanceSats(state)).toBe(15)
    expect(state.buckets).toHaveLength(2)
  })

  it('auto-trusts a mint seen only in a token event', () => {
    const { state } = hydrateStateFromEvents(
      null,
      [{ mintUrl: 'https://unknown.example', proofs: [proof('s1', 3)], createdAt: 1 }],
    )
    expect(state.mints).toContain('https://unknown.example')
    expect(totalBalanceSats(state)).toBe(3)
  })

  it('de-duplicates proofs by secret across token events', () => {
    const dup = proof('shared', 7)
    const tokens = [
      { mintUrl: 'https://mint.example', proofs: [dup], createdAt: 1 },
      { mintUrl: 'https://mint.example', proofs: [dup, proof('other', 4)], createdAt: 2 },
    ]
    const { state } = hydrateStateFromEvents({ mints: ['https://mint.example'] }, tokens)
    expect(totalBalanceSats(state)).toBe(11) // 7 once + 4, not 7 twice
  })
})

// — latestTokenEventPerMint ————————————————————————————————————

describe('latestTokenEventPerMint', () => {
  it('keeps only the newest event per mint', () => {
    const events = [
      { mintUrl: 'https://a.example', proofs: [proof('a1', 1)], createdAt: 10 },
      { mintUrl: 'https://a.example', proofs: [proof('a2', 9)], createdAt: 20 },
      { mintUrl: 'https://b.example', proofs: [proof('b1', 5)], createdAt: 5 },
      { mintUrl: 'https://b.example', proofs: [proof('b2', 3)], createdAt: 15 },
    ]
    const latest = latestTokenEventPerMint(events)
    expect(latest).toHaveLength(2)
    const a = latest.find((e) => e.mintUrl === 'https://a.example')!
    const b = latest.find((e) => e.mintUrl === 'https://b.example')!
    expect(a.proofs[0].secret).toBe('a2')
    expect(b.proofs[0].secret).toBe('b2')
  })

  it('returns an empty array for no events', () => {
    expect(latestTokenEventPerMint([])).toEqual([])
  })
})

// — feature flag ——————————————————————————————————————————————

describe('isCashuEnabled', () => {
  it('is off by default', () => {
    vi.stubEnv('VITE_CASHU_ENABLED', '')
    expect(isCashuEnabled()).toBe(false)
  })

  it('is on only when VITE_CASHU_ENABLED === "true"', () => {
    vi.stubEnv('VITE_CASHU_ENABLED', 'true')
    expect(isCashuEnabled()).toBe(true)
    vi.stubEnv('VITE_CASHU_ENABLED', '1')
    expect(isCashuEnabled()).toBe(false)
  })
})

describe('getMintTrust', () => {
  it('flags the vetted default mint as vetted', () => {
    expect(getMintTrust(DEFAULT_VETTED_MINTS[0])).toBe('vetted')
  })

  it('flags the shipped test mint as test', () => {
    expect(getMintTrust(DEFAULT_TEST_MINTS[0])).toBe('test')
  })

  it('flags a user-added mint as unvetted', () => {
    expect(getMintTrust('https://mint.example.com')).toBe('unvetted')
  })
})
