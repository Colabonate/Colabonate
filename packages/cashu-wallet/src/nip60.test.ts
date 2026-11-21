import { describe, it, expect } from 'vitest'
import {
  KIND_WALLET,
  KIND_TOKEN,
  KIND_HISTORY,
  serializeWalletEvent,
  parseWalletEvent,
  serializeTokenEvent,
  parseTokenEvent,
  serializeHistoryEvent,
  parseHistoryEvent,
} from './nip60.js'
import type { Nip44Codec, StoredProof } from './types.js'

// Identity codec stands in for NIP-44: the app injects the real one. This lets
// us assert the (de)serialisation contract without crypto, and proves the
// content is opaque to the package (it only encrypts/decrypts via the codec).
const identityCodec: Nip44Codec = {
  encrypt: (s) => `enc(${s})`,
  decrypt: (s) => s.replace(/^enc\(/, '').replace(/\)$/, ''),
}

const proofs: StoredProof[] = [
  { id: '009a1f29', amount: 8, secret: 'a'.repeat(64), C: '02' + 'ab'.repeat(32) },
  { id: '009a1f29', amount: 2, secret: 'b'.repeat(64), C: '03' + 'cd'.repeat(32) },
]

describe('kind 17375 wallet event', () => {
  it('round-trips mint list + wallet privkey', async () => {
    const mints = ['https://a.mint', 'https://b.mint']
    const ev = await serializeWalletEvent({ mints }, 'deadbeef', identityCodec)
    expect(ev.kind).toBe(KIND_WALLET)
    expect(ev.content).toContain('enc(') // went through the codec
    const parsed = await parseWalletEvent(ev.content, identityCodec)
    expect(parsed.mints).toEqual(mints)
    expect(parsed.walletPrivkeyHex).toBe('deadbeef')
  })
})

describe('kind 7375 token event', () => {
  it('round-trips proofs for a mint', async () => {
    const ev = await serializeTokenEvent('https://a.mint', proofs, identityCodec)
    expect(ev.kind).toBe(KIND_TOKEN)
    const parsed = await parseTokenEvent(ev.content, identityCodec)
    expect(parsed.mintUrl).toBe('https://a.mint')
    expect(parsed.proofs).toEqual(proofs)
    expect(parsed.supersedes).toEqual([])
  })

  it('carries the `del` supersede list', async () => {
    const ev = await serializeTokenEvent('https://a.mint', proofs, identityCodec, {
      supersedes: ['evt1', 'evt2'],
    })
    const parsed = await parseTokenEvent(ev.content, identityCodec)
    expect(parsed.supersedes).toEqual(['evt1', 'evt2'])
  })
})

describe('kind 7376 history event', () => {
  it('round-trips a spending-history entry', async () => {
    const entry = { direction: 'out' as const, amount: 21, createdAt: 1_700_000_000, memo: 'coffee' }
    const ev = await serializeHistoryEvent(entry, identityCodec)
    expect(ev.kind).toBe(KIND_HISTORY)
    expect(ev.created_at).toBe(1_700_000_000)
    const parsed = await parseHistoryEvent(ev.content, ev.created_at, identityCodec)
    expect(parsed).toEqual(entry)
  })
})
