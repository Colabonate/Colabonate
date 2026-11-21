import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'

/**
 * ADR-358 D3: rolling transcript fingerprint over the ordered event ids of a
 * trade's message thread.
 *
 *   H(0) = sha256(trade_id)
 *   H(n) = sha256(H(n-1) || event_id(n))
 *
 * Two parties comparing fingerprints get a single yes/no on "do we have the
 * same conversation". Divergence localises to the first differing link.
 *
 * Honest limit (stated, not hidden): a fingerprint proves these messages are
 * authentic and ordered — it cannot prove nothing was withheld, because either
 * party could omit messages.
 */

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

export function transcriptFingerprint(tradeId: string, eventIds: string[]): string {
  let acc = sha256(new TextEncoder().encode(tradeId))
  for (const id of eventIds) {
    acc = sha256(concatBytes(acc, new TextEncoder().encode(id)))
  }
  return bytesToHex(acc)
}
