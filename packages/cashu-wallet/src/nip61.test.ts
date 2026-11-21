import { describe, it, expect } from 'vitest'
import {
  KIND_NUTZAP,
  buildNutzapEvent,
  parseNutzapEvent,
  p2pkSecret,
} from './nip61.js'
import type { Nip44Codec, StoredProof } from './types.js'

// Identity codec stands in for NIP-44: the app injects the real one.
const identityCodec: Nip44Codec = {
  encrypt: (s) => `enc(${s})`,
  decrypt: (s) => s.replace(/^enc\(/, '').replace(/\)$/, ''),
}

const lockedProofs: StoredProof[] = [
  {
    id: '009a1f29',
    amount: 100,
    secret: p2pkSecret('02' + 'ab'.repeat(32)),
    C: '03' + 'cd'.repeat(32),
  },
  {
    id: '009a1f29',
    amount: 50,
    secret: p2pkSecret('02' + 'ab'.repeat(32)),
    C: '02' + 'ef'.repeat(32),
  },
]

describe('p2pkSecret', () => {
  it('produces a NUT-14 P2PK secret (canonical JSON of { pubkey })', () => {
    const s = p2pkSecret('02ab')
    expect(s).toBe('{"pubkey":"02ab"}')
    // The recipient wallet reconstructs the lock by parsing the secret.
    expect(JSON.parse(s)).toEqual({ pubkey: '02ab' })
  })
})

describe('kind 9321 nutzap event', () => {
  it('round-trips a single-recipient nutzap with P2PK-locked proofs', async () => {
    const recipient = '02' + '11'.repeat(32)
    const ev = await buildNutzapEvent({
      recipientPubkeys: [recipient],
      token: { mintUrl: 'https://mint.example', proofs: lockedProofs, memo: 'thanks!' },
      codec: identityCodec,
    })
    expect(ev.kind).toBe(KIND_NUTZAP)
    expect(ev.tags).toEqual([['p', recipient]])

    const parsed = await parseNutzapEvent(ev, identityCodec)
    expect(parsed.recipient).toBe(recipient)
    expect(parsed.content.mint).toBe('https://mint.example')
    expect(parsed.content.proofs).toEqual(lockedProofs)
    expect(parsed.content.memo).toBe('thanks!')
    expect(parsed.content.unit).toBe('sat')
  })

  it('preserves a multi-recipient `p` tag list (first = primary)', async () => {
    const primary = '02' + 'aa'.repeat(32)
    const secondary = '02' + 'bb'.repeat(32)
    const ev = await buildNutzapEvent({
      recipientPubkeys: [primary, secondary],
      token: { mintUrl: 'https://mint.example', proofs: lockedProofs },
      codec: identityCodec,
    })
    expect(ev.tags).toEqual([
      ['p', primary],
      ['p', secondary],
    ])
    const parsed = await parseNutzapEvent(ev, identityCodec)
    expect(parsed.recipient).toBe(primary)
  })

  it('refuses to build with no recipients', async () => {
    await expect(
      buildNutzapEvent({
        recipientPubkeys: [],
        token: { mintUrl: 'https://mint.example', proofs: lockedProofs },
        codec: identityCodec,
      }),
    ).rejects.toThrow(/at least one recipient/)
  })

  it('refuses to parse a non-nutzap event kind', async () => {
    await expect(
      parseNutzapEvent(
        { kind: 1, content: 'enc({"mint":"x","proofs":[]})', tags: [] },
        identityCodec,
      ),
    ).rejects.toThrow(/Expected kind 9321/)
  })

  it('refuses to parse a nutzap missing the `p` recipient tag', async () => {
    await expect(
      parseNutzapEvent(
        { kind: KIND_NUTZAP, content: 'enc({"mint":"x","proofs":[]})', tags: [] },
        identityCodec,
      ),
    ).rejects.toThrow(/missing primary `p` recipient tag/)
  })
})
