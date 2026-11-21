/**
 * NostrRelayService.publishEvent() — bounded-timeout guarantee (FU-658 / Gate G7).
 *
 * Proves the money-safety-adjacent invariant behind `publishBounded`: a slow or
 * unreachable relay (a hang) must NEVER keep the caller pending beyond the 4 s
 * bound. The observed beta failure mode was public-mainnet TLS handshakes hanging
 * for 60 s+ and stalling webhook / fund-escrow / invoice routes. This test locks
 * the 4 s ceiling in place so a future refactor cannot silently reintroduce an
 * unbounded publish.
 *
 * Run with:
 *   ./node_modules/.bin/vitest run apps/server/services/nostr-relay-timeout.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NostrRelayService } from './nostr-relay.js'
import { NOSTR_KINDS } from './kind-mapping.js'

// Minimal signed-looking Event shape — publishBounded only hands the event to
// pool.publish and never validates it, so a stub is enough to exercise the
// timeout path without a real signature.
const stubEvent = {
  id: '1'.repeat(64),
  pubkey: 'a'.repeat(64),
  created_at: 1,
  kind: NOSTR_KINDS.OFFER_NIP99,
  tags: [['d', 'g7-timeout-test']],
  content: '',
  sig: '2'.repeat(128),
}

describe('NostrRelayService.publishEvent() — bounded timeout (FU-658 / G7)', () => {
  let svc: NostrRelayService

  beforeEach(() => {
    vi.useFakeTimers()
    svc = new NostrRelayService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('resolves false within the 4 s bound when every relay hangs (never settles)', async () => {
    // Simulate a hanging relay: pool.publish returns a promise that never settles.
    vi.spyOn(svc.getPool(), 'publish').mockReturnValue([new Promise(() => {})] as never)

    const promise = svc.publishEvent(stubEvent as never)

    // The 4 s timer is the only thing that can settle it — advance past it.
    await vi.advanceTimersByTimeAsync(4000)

    await expect(promise).resolves.toBe(false)
  })

  it('resolves false when a relay rejects, without waiting for the full timeout', async () => {
    vi.spyOn(svc.getPool(), 'publish').mockReturnValue([Promise.reject(new Error('relay down'))] as never)

    const promise = svc.publishEvent(stubEvent as never)

    // allSettled resolves immediately on rejection — no timer advance needed.
    await expect(promise).resolves.toBe(false)
  })

  it('resolves true immediately when the relay accepts the event', async () => {
    vi.spyOn(svc.getPool(), 'publish').mockReturnValue([Promise.resolve(true)] as never)

    await expect(svc.publishEvent(stubEvent as never)).resolves.toBe(true)
  })
})
