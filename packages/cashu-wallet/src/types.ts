// @col/cashu — internal type vocabulary (ADR-187).
//
// The package works internally with plain `number` sat amounts, matching the
// rest of the codebase (`balanceSats`, `amountSats`). cashu-ts v4 models proof
// amounts as an `Amount` class; conversion happens only at the cashu-ts seam
// (mint.ts / token.ts), never leaks into wallet state or NIP-60 events.

/**
 * A Cashu proof as we store and transport it: amount is a plain sat `number`.
 * Shape-compatible with cashu-ts `ProofLike` (amount: AmountLike accepts number)
 * so it can be handed to cashu-ts helpers without conversion.
 */
export interface StoredProof {
  /** Keyset id linking the proof to a mint + its keys. */
  id: string
  /** Amount in sats. */
  amount: number
  /** The secret chosen at proof creation. */
  secret: string
  /** Unblinded signature from the mint. */
  C: string
  /** Optional P2PK / HTLC witness (carried through verbatim). */
  witness?: string
}

/** Unspent proofs grouped under the mint that issued them. */
export interface MintBucket {
  mintUrl: string
  proofs: StoredProof[]
}

/**
 * Full client-side wallet state. Authoritative copy lives in NIP-60 events on
 * relays (kind 17375 + 7375); this is the in-memory / cached projection.
 */
export interface CashuWalletState {
  /** Trusted mint URLs (normalised, no trailing slash). */
  mints: string[]
  /** Unspent proofs bucketed by mint. */
  buckets: MintBucket[]
}

/** A spending-history entry (projected to / from a kind-7376 event). */
export interface HistoryEntry {
  direction: 'in' | 'out'
  amount: number
  /** Unix seconds. */
  createdAt: number
  /** Optional free-text memo. */
  memo?: string
}

/**
 * NIP-44 encrypt/decrypt pair, injected by the caller (the app reuses its
 * existing NIP-07 / NIP-44 plumbing). Keeps this package crypto-agnostic and
 * unit-testable with an identity stub.
 */
export interface Nip44Codec {
  encrypt(plaintext: string): Promise<string> | string
  decrypt(ciphertext: string): Promise<string> | string
}
