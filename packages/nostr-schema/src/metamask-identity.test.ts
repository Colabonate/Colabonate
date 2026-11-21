import { describe, it, expect } from 'vitest'
import { secp256k1 } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import {
  buildMetamaskDerivationMessage,
  deriveNostrPrivkeyFromMetamaskSignature,
  deriveNostrPubkeyFromMetamaskSignature,
} from './metamask-identity.js'

/**
 * Produce a fake 65-byte ECDSA signature for testing the deterministic
 * derivation path. The derivation does not care whether the signature is valid
 * on-chain — only that it is 65 bytes — but using a real secp256k1 signature
 * keeps the test realistic.
 */
function fakeSign(message: string, privkeyHex: string): string {
  const messageHash = sha256(new TextEncoder().encode(message))
  const key = privkeyHex.startsWith('0x') ? privkeyHex.slice(2) : privkeyHex
  const sig = secp256k1.sign(messageHash, key, { format: 'recovered' })
  // personal_sign returns 65 bytes: recovery id (1) + r (32) + s (32)
  const compact = sig.toCompactRawBytes()
  const recovered = new Uint8Array(65)
  recovered[0] = sig.recovery ?? 0
  recovered.set(compact, 1)
  return bytesToHex(recovered)
}

describe('metamask-identity derivation', () => {
  it('builds a stable derivation message', () => {
    const msg1 = buildMetamaskDerivationMessage('0xAbCdEf')
    const msg2 = buildMetamaskDerivationMessage('0xabcdef')
    expect(msg1).toBe(msg2)
    expect(msg1).toContain('Version: 1')
    expect(msg1).toContain('Address: 0xabcdef')
  })

  it('derives the same Nostr pubkey from the same signature deterministically', () => {
    const address = '0x1234567890123456789012345678901234567890'
    const privkey = bytesToHex(secp256k1.utils.randomPrivateKey())
    const message = buildMetamaskDerivationMessage(address)
    const signature = fakeSign(message, privkey)

    const pubkey1 = deriveNostrPubkeyFromMetamaskSignature(signature, address)
    const pubkey2 = deriveNostrPubkeyFromMetamaskSignature(signature, address)
    expect(pubkey1).toBe(pubkey2)
    expect(pubkey1).toMatch(/^[a-f0-9]{64}$/)
  })

  it('derives different pubkeys for different addresses with the same signature entropy', () => {
    const addressA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const addressB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    const privkey = bytesToHex(secp256k1.utils.randomPrivateKey())

    const sigA = fakeSign(buildMetamaskDerivationMessage(addressA), privkey)
    const sigB = fakeSign(buildMetamaskDerivationMessage(addressB), privkey)

    const pubkeyA = deriveNostrPubkeyFromMetamaskSignature(sigA, addressA)
    const pubkeyB = deriveNostrPubkeyFromMetamaskSignature(sigB, addressB)
    expect(pubkeyA).not.toBe(pubkeyB)
  })

  it('rejects invalid signature lengths', () => {
    expect(() => deriveNostrPrivkeyFromMetamaskSignature('0xdeadbeef', '0x1234')).toThrow('Invalid signature length')
  })
})
