import { describe, it, expect } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { verifyL1Ownership } from '../routes/identity.js'

// ADR-379: an existing Kind-0 published by the signer is accepted as the L1 profile proof.
// The legacy `colabonate_pubkey` binding is no longer required, so importing a profile does
// not force a re-publish. The Kind-30021/30410 credential remains mandatory (ADR-141 Issue 3).

const colabPubkey = 'a'.repeat(64)
const secretKey = generateSecretKey()
const nostrPubkey = getPublicKey(secretKey)

type SignedEvent = {
  kind: number
  pubkey: string
  content: string
  tags: string[][]
  created_at: number
  id: string
  sig: string
}

function sign(kind: number, content: string, tags: string[][] = []): SignedEvent {
  return finalizeEvent(
    { kind, tags, content, created_at: Math.floor(Date.now() / 1000) },
    secretKey,
  ) as unknown as SignedEvent
}

const kind0 = (content: Record<string, string>) => sign(0, JSON.stringify(content))
const credential = (dTag: string, kind = 30410) => sign(kind, '{}', [['d', dTag]])

const expectedDTag = `identity-l1-${colabPubkey}`

describe('verifyL1Ownership (ADR-379)', () => {
  it('accepts an existing Kind-0 without the colabonate_pubkey binding', async () => {
    const fetcher = async (filter: { kinds: number[] }) =>
      filter.kinds.includes(0)
        ? [kind0({ name: 'Alice', picture: 'https://example.com/a.png' })]
        : [credential(expectedDTag)]

    await expect(verifyL1Ownership(colabPubkey, nostrPubkey, fetcher)).resolves.toEqual({ verified: true })
  })

  it('still accepts a Kind-0 that carries the legacy binding', async () => {
    const fetcher = async (filter: { kinds: number[] }) =>
      filter.kinds.includes(0)
        ? [kind0({ name: 'Alice', colabonate_pubkey: colabPubkey })]
        : [credential(expectedDTag, 30021)]

    await expect(verifyL1Ownership(colabPubkey, nostrPubkey, fetcher)).resolves.toEqual({ verified: true })
  })

  it('reports kind0_missing when no Kind-0 exists', async () => {
    const fetcher = async (filter: { kinds: number[] }) =>
      filter.kinds.includes(0) ? [] : [credential(expectedDTag)]

    await expect(verifyL1Ownership(colabPubkey, nostrPubkey, fetcher)).resolves.toEqual({
      verified: false,
      reason: 'kind0_missing',
    })
  })

  it('reports credential_missing when the credential is absent', async () => {
    const fetcher = async (filter: { kinds: number[] }) =>
      filter.kinds.includes(0) ? [kind0({ name: 'Alice' })] : []

    await expect(verifyL1Ownership(colabPubkey, nostrPubkey, fetcher)).resolves.toEqual({
      verified: false,
      reason: 'credential_missing',
    })
  })

  it('rejects a Kind-0 whose signature does not verify', async () => {
    const tampered = { ...kind0({ name: 'Alice' }), content: JSON.stringify({ name: 'Mallory' }) }
    const fetcher = async (filter: { kinds: number[] }) =>
      filter.kinds.includes(0) ? [tampered] : [credential(expectedDTag)]

    await expect(verifyL1Ownership(colabPubkey, nostrPubkey, fetcher)).resolves.toEqual({
      verified: false,
      reason: 'kind0_missing',
    })
  })

  it('rejects a credential signed for a different d-tag', async () => {
    const fetcher = async (filter: { kinds: number[] }) =>
      filter.kinds.includes(0) ? [kind0({ name: 'Alice' })] : [credential('identity-l1-other')]

    await expect(verifyL1Ownership(colabPubkey, nostrPubkey, fetcher)).resolves.toEqual({
      verified: false,
      reason: 'credential_missing',
    })
  })
})
