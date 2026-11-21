// @col/cashu — proof selection + arithmetic (ADR-187).
//
// Pure, deterministic, no network. These helpers operate on StoredProof
// (number sats) so they are trivially unit-testable; the cashu-ts seam in
// mint.ts converts to/from the Amount class.

import type { StoredProof } from './types.js'

/** Sum proof amounts in sats. */
export function sumProofsSats(proofs: readonly StoredProof[]): number {
  return proofs.reduce((acc, p) => acc + p.amount, 0)
}

/**
 * Greedily select proofs to cover `targetSats` from a single mint's proofs.
 *
 * Returns the chosen proofs and the remaining (unselected) proofs. Selection is
 * largest-first to minimise proof count; the caller swaps the selection at the
 * mint to make exact change. `null` when the proofs cannot cover the target.
 */
export function selectProofsToSend(
  proofs: readonly StoredProof[],
  targetSats: number,
): { selected: StoredProof[]; remaining: StoredProof[] } | null {
  if (targetSats <= 0) return { selected: [], remaining: [...proofs] }
  if (sumProofsSats(proofs) < targetSats) return null

  // Sort a copy largest-first; keep original order stable for the remainder.
  const byDesc = [...proofs].sort((a, b) => b.amount - a.amount)
  const selected: StoredProof[] = []
  let acc = 0
  for (const p of byDesc) {
    if (acc >= targetSats) break
    selected.push(p)
    acc += p.amount
  }

  const selectedSecrets = new Set(selected.map((p) => p.secret))
  const remaining = proofs.filter((p) => !selectedSecrets.has(p.secret))
  return { selected, remaining }
}

/** Group a flat proof list by mint url (used when state is rebuilt from events). */
export function groupByMint(
  entries: ReadonlyArray<{ mintUrl: string; proof: StoredProof }>,
): Map<string, StoredProof[]> {
  const out = new Map<string, StoredProof[]>()
  for (const { mintUrl, proof } of entries) {
    const list = out.get(mintUrl) ?? []
    list.push(proof)
    out.set(mintUrl, list)
  }
  return out
}
