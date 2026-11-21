// ADR-253: no rate-limit/circuit-breaker exists for seller-side NWC calls —
// every checkout attempt against an offline/unreachable seller NWC wallet
// pays the full NWC_REQUEST_TIMEOUT_MS (default 30s) before failing. This is
// a bare, single-process, in-memory cooldown: after one failure, further
// attempts for that seller skip the network call for COOLDOWN_MS instead of
// waiting out the timeout again. Deliberately not shared across instances
// (Redis etc.) — the app stays single-instance per ADR-252 D4's accepted
// scale decision; this is a plain Map, not a distributed lock.
const COOLDOWN_MS = 60_000

const cooldownUntil = new Map<string, number>()

export function isNwcCoolingDown(sellerPubkey: string): boolean {
  const until = cooldownUntil.get(sellerPubkey)
  if (until === undefined) return false
  if (Date.now() >= until) {
    cooldownUntil.delete(sellerPubkey)
    return false
  }
  return true
}

export function markNwcFailure(sellerPubkey: string): void {
  cooldownUntil.set(sellerPubkey, Date.now() + COOLDOWN_MS)
}

export function clearNwcCooldown(sellerPubkey: string): void {
  cooldownUntil.delete(sellerPubkey)
}
