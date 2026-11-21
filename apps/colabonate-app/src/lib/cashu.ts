/**
 * Cashu wallet app-layer bridge (ADR-187 Phase 2 — headless foundation).
 *
 * This is the single seam that connects the framework-agnostic `@col/cashu`
 * package to this app's existing NIP-07 / burner-key + NIP-44 v2 plumbing. It
 * owns three things the package deliberately does not know about:
 *
 *   1. The feature flag (`VITE_CASHU_ENABLED`) — off = zero behaviour change.
 *   2. The curated default mint list (FU-39 — vetted real mint + test mint).
 *   3. How to build a NIP-44 codec from the user's key material.
 *
 * The codec is the non-trivial abstraction flagged in the plan: NIP-60 wallet
 * events are encrypted *to self*, and the key material available differs by
 * login type. In this codebase every user has a persisted burner key (used by
 * the whole NIP-17 private layer), so the codec is built from that burner
 * privkey via ECDH-to-self. `createNip44Codec(privkeyHex)` takes the privkey
 * explicitly — keeping it pure and unit-testable — and a future NIP-07/NIP-46
 * path can supply a different codec source; `@col/cashu` never holds a key.
 *
 * Everything here that does not touch the DOM/network is pure and covered by
 * `cashu.test.ts`. The relay/sign orchestration lives in `useCashuWallet()`.
 */

import { generateSecretKey, getPublicKey } from 'nostr-tools'
import * as nip44 from 'nostr-tools/nip44'
import {
  createState,
  addProofs,
  type CashuWalletState,
  type Nip44Codec,
  type StoredProof,
} from '@col/cashu'

// ---------------------------------------------------------------------------
// Feature flag (ADR-187 D4)
// ---------------------------------------------------------------------------

/** True only when VITE_CASHU_ENABLED is explicitly 'true'. Off = inert. */
export function isCashuEnabled(): boolean {
  return (import.meta.env.VITE_CASHU_ENABLED ?? '') === 'true'
}

// ---------------------------------------------------------------------------
// Default mint list (FU-39 — decided 2026-08-03: first vetted real mint)
// ---------------------------------------------------------------------------

/**
 * Colabonate-recommended real-value mint (FU-39, decided 2026-08-03).
 * Minibits: a Cashu wallet built specifically for the Nostr ecash use case
 * (NIP-60/61 identity + messaging native, not Lightning-wallet-plus-Cashu).
 * Honest caveat carried in the UI disclosure text: no mint in the Cashu
 * ecosystem today publishes an audited proof-of-reserves or a disclosed
 * operating jurisdiction — that is an ecosystem-wide gap, not specific to
 * this mint, and is not hidden from users.
 */
export const DEFAULT_VETTED_MINTS = ['https://mint.minibits.cash/Bitcoin'] as const

/** Public test mint (fake sats, no monetary value) — kept for flow verification. */
export const DEFAULT_TEST_MINTS = ['https://testnut.cashu.space'] as const

/** Curated default mints shipped to every new wallet: vetted real mint first, test mint alongside. */
export const DEFAULT_CASHU_MINTS = [...DEFAULT_VETTED_MINTS, ...DEFAULT_TEST_MINTS] as const

export type MintTrust = 'vetted' | 'test' | 'unvetted'

// ADR-253 FU-39: classifies a mint URL so UI can disclose trust level instead
// of leaving it silently ambiguous. Any mint not in the vetted/test sets was
// added by the user themselves (MintManagerModal) and is unvetted by
// Colabonate either way.
export function getMintTrust(mintUrl: string): MintTrust {
  if ((DEFAULT_VETTED_MINTS as readonly string[]).includes(mintUrl)) return 'vetted'
  if ((DEFAULT_TEST_MINTS as readonly string[]).includes(mintUrl)) return 'test'
  return 'unvetted'
}

// ---------------------------------------------------------------------------
// Hex helpers (local, to keep this module self-contained + node-testable)
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array((hex.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)))
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ---------------------------------------------------------------------------
// NIP-44 codec bridge — the NIP-07 / burner abstraction
// ---------------------------------------------------------------------------

/**
 * Build a NIP-44 v2 codec that encrypts/decrypts *to self* (conversation key
 * derived from privkey <-> own-pubkey ECDH). NIP-60 wallet events are always
 * encrypted to the holder, so this is the codec every serialize/parse call in
 * `@col/cashu` receives.
 *
 * Pure: pass the privkey hex explicitly. The hook passes the app's burner key
 * (`getPrivkeyHex()`); the package never sees the key.
 */
export function createNip44Codec(privkeyHex: string): Nip44Codec {
  const sk = hexToBytes(privkeyHex)
  const conversationKey = nip44.getConversationKey(sk, getPublicKey(sk))
  return {
    encrypt: (plaintext: string) => nip44.v2.encrypt(plaintext, conversationKey),
    decrypt: (ciphertext: string) => nip44.v2.decrypt(ciphertext, conversationKey),
  }
}

// ---------------------------------------------------------------------------
// Cashu wallet P2PK key (separate from identity — NIP-60 requirement)
// ---------------------------------------------------------------------------

/** Generate a fresh Cashu wallet privkey as 64-char hex. Pure, testable. */
export function generateWalletPrivkey(): string {
  return bytesToHex(generateSecretKey())
}

/** Derive the wallet pubkey (hex) from a wallet privkey hex. Pure, testable. */
export function getWalletPubkey(privkeyHex: string): string {
  return getPublicKey(hexToBytes(privkeyHex))
}

// ---------------------------------------------------------------------------
// Pure state hydration (merging decrypted NIP-60 events -> CashuWalletState)
// ---------------------------------------------------------------------------

/** Decrypted kind-17375 wallet event (mint list + optional P2PK privkey). */
export interface DecryptedWalletEvent {
  mints: string[]
  walletPrivkeyHex?: string
}

/** A decrypted kind-7375 token event plus its relay timestamp. */
export interface DecryptedTokenEvent {
  mintUrl: string
  proofs: StoredProof[]
  createdAt: number
}

export interface HydratedWallet {
  state: CashuWalletState
  /** Wallet P2PK privkey, if a kind-17375 event carried one. */
  walletPrivkeyHex?: string
}

/**
 * Pick the newest token event per mint. Each published 7375 carries the full
 * current proof bucket for one mint, so the latest per mint is authoritative;
 * older events are stale. (Relay pruning via NIP-09 + `del` is a follow-up —
 * FU note in ADR-187; not required for load correctness.)
 *
 * Pure, testable.
 */
export function latestTokenEventPerMint(
  events: readonly DecryptedTokenEvent[],
): DecryptedTokenEvent[] {
  const byMint = new Map<string, DecryptedTokenEvent>()
  for (const e of events) {
    const cur = byMint.get(e.mintUrl)
    if (!cur || e.createdAt > cur.createdAt) byMint.set(e.mintUrl, e)
  }
  return [...byMint.values()]
}

/**
 * Merge decrypted NIP-60 events into an in-memory `CashuWalletState`.
 *
 * - When no wallet event exists yet, the curated default mints are seeded so a
 *   fresh wallet immediately offers the mint list (FU-39).
 * - When a wallet event exists, its mint list is authoritative (even if empty).
 * - Token events hydrate proofs per mint; `addProofs` auto-trusts any mint and
 *   de-duplicates proofs by secret (idempotent relay re-delivery).
 *
 * Pure, testable. Orchestrates `@col/cashu` reducers; does no IO.
 */
export function hydrateStateFromEvents(
  wallet: DecryptedWalletEvent | null,
  tokens: readonly DecryptedTokenEvent[],
): HydratedWallet {
  const seedMints = wallet ? wallet.mints : [...DEFAULT_CASHU_MINTS]
  let state = createState(seedMints)
  for (const t of tokens) {
    state = addProofs(state, t.mintUrl, t.proofs)
  }
  return { state, walletPrivkeyHex: wallet?.walletPrivkeyHex }
}
