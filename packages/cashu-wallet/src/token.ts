// @col/cashu — Cashu token encode/decode (ADR-187).
//
// This is the only place besides mint.ts that touches the cashu-ts Amount
// class. We accept/return StoredProof (number sats) and convert at the seam.
// `getEncodedToken` (v4) emits the `cashuB…` (CBOR) format.

import { getEncodedToken, getDecodedToken, Amount } from '@cashu/cashu-ts'
import type { StoredProof } from './types.js'

export interface DecodedToken {
  mintUrl: string
  proofs: StoredProof[]
  unit?: string
  memo?: string
}

/** Defensive: cashu-ts decode returns `Amount`; tolerate plain numbers too. */
function amountToSats(a: unknown): number {
  if (typeof a === 'number') return a
  if (a && typeof (a as { toNumber?: () => number }).toNumber === 'function') {
    return (a as { toNumber: () => number }).toNumber()
  }
  return Number(a)
}

/** Encode a single-mint proof set into a `cashuB…` token string. */
export function encodeToken(
  mintUrl: string,
  proofs: readonly StoredProof[],
  opts: { unit?: string; memo?: string } = {},
): string {
  const token = {
    mint: mintUrl,
    unit: opts.unit ?? 'sat',
    memo: opts.memo,
    proofs: proofs.map((p) => ({
      id: p.id,
      amount: Amount.from(p.amount),
      secret: p.secret,
      C: p.C,
      ...(p.witness ? { witness: p.witness } : {}),
    })),
  }
  // cashu-ts Token types `amount` as Amount; the cast keeps our number-first
  // public surface without re-declaring the whole Token type.
  return getEncodedToken(token as unknown as Parameters<typeof getEncodedToken>[0])
}

/**
 * Decode a `cashuA…` / `cashuB…` token string back into StoredProof form.
 * `knownKeysetIds` is optional — cashu-ts uses it for validation only; an empty
 * array still decodes (ids are carried inside each proof).
 */
export function decodeToken(tokenString: string, knownKeysetIds: readonly string[] = []): DecodedToken {
  const decoded = getDecodedToken(tokenString, knownKeysetIds)
  return {
    mintUrl: decoded.mint,
    unit: decoded.unit,
    memo: decoded.memo,
    proofs: decoded.proofs.map((p) => ({
      id: p.id,
      amount: amountToSats(p.amount),
      secret: p.secret,
      C: p.C,
      ...((p as { witness?: string }).witness ? { witness: (p as { witness?: string }).witness } : {}),
    })),
  }
}
