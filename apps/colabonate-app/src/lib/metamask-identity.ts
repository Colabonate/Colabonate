/**
 * Client-side MetaMask identity helpers (ADR-196).
 *
 * - Derives a deterministic Nostr private key from a MetaMask signature.
 * - Caches the derived key in localStorage so returning users only need to sign
 *   the authentication challenge.
 * - NEVER sends the private key to the server.
 */

import {
  buildMetamaskDerivationMessage,
  deriveNostrPrivkeyFromMetamaskSignature,
  deriveNostrPubkeyFromMetamaskSignature,
} from '@col/nostr-schema'
import { getPublicKey, utils } from 'nostr-tools'

const STORAGE_KEY_PREFIX = 'colabonate:metamask:'

function nsecStorageKey(address: string): string {
  return `${STORAGE_KEY_PREFIX}nsec:${address.toLowerCase()}`
}

function signatureStorageKey(address: string): string {
  return `${STORAGE_KEY_PREFIX}derivation-signature:${address.toLowerCase()}`
}

export interface MetamaskDerivedIdentity {
  address: string
  privkey: string
  pubkey: string
  derivationSignature: string
}

/**
 * Load a previously cached derived identity for the given EVM address.
 */
export function loadDerivedIdentity(address: string): MetamaskDerivedIdentity | null {
  try {
    const privkey = localStorage.getItem(nsecStorageKey(address))
    const derivationSignature = localStorage.getItem(signatureStorageKey(address))
    if (!privkey || !derivationSignature) return null
    return {
      address: address.toLowerCase(),
      privkey,
      pubkey: getPublicKey(utils.hexToBytes(privkey)),
      derivationSignature,
    }
  } catch {
    return null
  }
}

/**
 * Derive and cache the Nostr identity for an address.
 *
 * @param signMessage MetaMask personal_sign wrapper: (message) => signature hex.
 */
export async function createDerivedIdentity(
  address: string,
  signMessage: (message: string) => Promise<string>,
): Promise<MetamaskDerivedIdentity> {
  const cached = loadDerivedIdentity(address)
  if (cached) return cached

  const message = buildMetamaskDerivationMessage(address)
  const derivationSignature = await signMessage(message)
  const privkey = deriveNostrPrivkeyFromMetamaskSignature(derivationSignature, address)
  const pubkey = deriveNostrPubkeyFromMetamaskSignature(derivationSignature, address)

  try {
    localStorage.setItem(nsecStorageKey(address), privkey)
    localStorage.setItem(signatureStorageKey(address), derivationSignature)
  } catch {
    // localStorage unavailable (private mode) — derivation still works,
    // but the user will need to sign the derivation message on every login.
  }

  return { address: address.toLowerCase(), privkey, pubkey, derivationSignature }
}

export { buildMetamaskDerivationMessage }
