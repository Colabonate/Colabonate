const inFlight = new Map<string, number>()

const DEFAULT_TTL_MS = 30_000

/**
 * Best-effort, single-process duplicate-dispatch guard for fire-and-forget
 * hold-invoice payment dispatch (ADR-209). These endpoints respond
 * immediately after starting the payment (they don't await settlement), so
 * a client that times out on the network round-trip and retries would
 * otherwise re-trigger `payments.payInvoice()` for the same invoice with no
 * server-side guard at all.
 *
 * Returns true if the lock was acquired (caller should proceed), false if a
 * dispatch for this exact key is already in flight / was acquired within
 * the last `ttlMs`.
 *
 * NOT a distributed lock — it only protects a single server process. That
 * matches the current single-instance deployment (see FOLLOWUPS.md FU-35);
 * a DB-backed lock is the correct upgrade if/when the server scales
 * horizontally.
 */
export function acquireDispatchLock(key: string, ttlMs = DEFAULT_TTL_MS): boolean {
  const now = Date.now()
  const expiry = inFlight.get(key)
  if (expiry && expiry > now) return false
  inFlight.set(key, now + ttlMs)
  return true
}
