/**
 * Deterministic Nostr identity derivation from a MetaMask signature.
 *
 * ADR-196: The user signs a fixed message with their EVM address. The 65-byte
 * ECDSA signature is fed into HKDF-SHA256 to produce 32 bytes that are used as
 * a Nostr (Schnorr) private key. The same message + address + signature always
 * produce the same pubkey, so the identity is reproducible across devices as
 * long as the user controls the same MetaMask seed.
 *
 * IMPORTANT: This derivation must never change. If a v2 is ever needed, use a
 * different version string in the message and a different salt/info so v1
 * identities remain stable.
 */

import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { schnorr } from '@noble/curves/secp256k1'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'

const DERIVATION_VERSION = '1'
const DERIVATION_SALT = 'colabonate-nostr-identity-v1'

/**
 * Build the exact message the user must sign to derive their Nostr identity.
 * The address is normalized to lowercase so derivation is case-insensitive.
 */
export function buildMetamaskDerivationMessage(address: string): string {
  const normalized = address.toLowerCase()
  return `Sign this message to derive your Colabonate Nostr identity.\nThis will not cost any gas.\n\nVersion: ${DERIVATION_VERSION}\nAddress: ${normalized}`
}

/**
 * Derive a Nostr private key (32 bytes, hex) from a MetaMask ECDSA signature.
 *
 * @param signature 65-byte ECDSA signature as a hex string (with or without 0x prefix).
 * @param address   The EVM address that produced the signature (used as HKDF info).
 */
export function deriveNostrPrivkeyFromMetamaskSignature(
  signature: string,
  address: string,
): string {
  const sigHex = signature.startsWith('0x') ? signature.slice(2) : signature
  if (sigHex.length !== 130) {
    throw new Error('Invalid signature length: expected 65 bytes hex')
  }
  const signatureBytes = hexToBytes(sigHex)
  const info = new TextEncoder().encode(address.toLowerCase())
  const okm = hkdf(sha256, signatureBytes, DERIVATION_SALT, info, 32)
  return bytesToHex(okm)
}

/**
 * Derive a Nostr pubkey (32 bytes, hex) from a MetaMask ECDSA signature.
 *
 * @param signature 65-byte ECDSA signature as a hex string (with or without 0x prefix).
 * @param address   The EVM address that produced the signature.
 */
export function deriveNostrPubkeyFromMetamaskSignature(
  signature: string,
  address: string,
): string {
  const privkey = deriveNostrPrivkeyFromMetamaskSignature(signature, address)
  return bytesToHex(schnorr.getPublicKey(privkey))
}
