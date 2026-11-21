// @col/cashu — pure wallet-state reducer (ADR-187).
//
// All functions are immutable: they return a new state and never mutate the
// input. The authoritative copy of this state lives in NIP-60 events on relays
// (see nip60.ts); this reducer is what the app holds in memory / IndexedDB.

import type { CashuWalletState, MintBucket, StoredProof } from './types.js'
import { sumProofsSats } from './proofs.js'

/** Strip a trailing slash and lowercase the origin so mint urls compare equal. */
export function normalizeMintUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  try {
    const u = new URL(trimmed)
    u.hostname = u.hostname.toLowerCase()
    return u.toString().replace(/\/+$/, '')
  } catch {
    return trimmed
  }
}

export function createState(mints: string[] = []): CashuWalletState {
  return { mints: dedupe(mints.map(normalizeMintUrl)), buckets: [] }
}

export function addMint(state: CashuWalletState, url: string): CashuWalletState {
  const mint = normalizeMintUrl(url)
  if (state.mints.includes(mint)) return state
  return { ...state, mints: [...state.mints, mint] }
}

export function removeMint(state: CashuWalletState, url: string): CashuWalletState {
  const mint = normalizeMintUrl(url)
  return {
    mints: state.mints.filter((m) => m !== mint),
    buckets: state.buckets.filter((b) => b.mintUrl !== mint),
  }
}

/**
 * Add proofs for a mint. The mint is auto-trusted if not already in `mints`.
 * Proofs are de-duplicated by `secret` so re-applying the same kind-7375 event
 * is idempotent (guards against double-counting on relay re-delivery).
 */
export function addProofs(
  state: CashuWalletState,
  mintUrl: string,
  proofs: readonly StoredProof[],
): CashuWalletState {
  const mint = normalizeMintUrl(mintUrl)
  const withMint = state.mints.includes(mint) ? state : addMint(state, mint)

  const existing = bucketFor(withMint, mint)
  const seen = new Set(existing.map((p) => p.secret))
  const merged = [...existing]
  for (const p of proofs) {
    if (!seen.has(p.secret)) {
      merged.push(p)
      seen.add(p.secret)
    }
  }
  return writeBucket(withMint, mint, merged)
}

/** Remove (spent) proofs from a mint bucket, identified by secret. */
export function removeProofs(
  state: CashuWalletState,
  mintUrl: string,
  secrets: readonly string[],
): CashuWalletState {
  const mint = normalizeMintUrl(mintUrl)
  const drop = new Set(secrets)
  const next = bucketFor(state, mint).filter((p) => !drop.has(p.secret))
  return writeBucket(state, mint, next)
}

export function balanceByMint(state: CashuWalletState, mintUrl: string): number {
  return sumProofsSats(bucketFor(state, normalizeMintUrl(mintUrl)))
}

export function totalBalanceSats(state: CashuWalletState): number {
  return state.buckets.reduce((acc, b) => acc + sumProofsSats(b.proofs), 0)
}

// — internal helpers —

function bucketFor(state: CashuWalletState, mint: string): StoredProof[] {
  return state.buckets.find((b) => b.mintUrl === mint)?.proofs ?? []
}

function writeBucket(state: CashuWalletState, mint: string, proofs: StoredProof[]): CashuWalletState {
  const others = state.buckets.filter((b) => b.mintUrl !== mint)
  const buckets: MintBucket[] = proofs.length > 0 ? [...others, { mintUrl: mint, proofs }] : others
  return { ...state, buckets }
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}
