/**
 * Nostr Relay Configuration (ADR-153 §4 — NIP-42 AUTH + Public Relays)
 *
 * Centralizes relay selection and the configured SimplePool so all callers
 * (chat, ticket signing, gift wrap) share the same NIP-42 AUTH context.
 *
 * Defaults:
 *   Production: wss://relay.damus.io + wss://nos.lol + wss://relay.primal.net
 *   Dev (Vite): ws://<host>:4001 (in-process mock relay) for offline testing
 *
 * Override via VITE_NOSTR_RELAY_URLS (comma-separated).
 *
 * Note (2026-07-18): the previous defaults `wss://inbox.nostr.wine` (paid —
 * rejects unpaid writes with "restricted: user unauthorized") and
 * `wss://relay.nostr.bg` (intermittent WebSocket failures) were replaced with
 * the same free, gift-wrap-accepting relays the server already uses for
 * general events (apps/server/services/nostr-relay.ts:60).
 */

import { SimplePool, finalizeEvent, type EventTemplate, type VerifiedEvent } from 'nostr-tools'
import { nip42 } from 'nostr-tools'
import { getPrivkeyHex, getMyPubkey } from './nostr-identity'

const DEFAULT_DM_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
]

function getMockRelayUrl(): string | null {
  if (typeof window === 'undefined') return null
  const env = (import.meta as { env?: Record<string, string> }).env
  if (env?.DEV) {
    return `ws://${window.location.hostname}:4001`
  }
  return null
}

/** Returns the list of relays to use for DM publishing + subscription. */
export function getRelays(): string[] {
  const env = (import.meta as { env?: Record<string, string> }).env
  const fromEnv = env?.VITE_NOSTR_RELAY_URLS
  if (fromEnv) {
    return fromEnv.split(',').map(u => u.trim()).filter(Boolean)
  }
  const relays = [...DEFAULT_DM_RELAYS]
  const mock = getMockRelayUrl()
  if (mock) relays.unshift(mock)
  return relays
}

/**
 * Build a NIP-42 AUTH event template (kind 22242) for a relay challenge.
 * The caller signs it with the user's burner privkey.
 */
export function makeAuthEvent(relayUrl: string, challenge: string): EventTemplate {
  return nip42.makeAuthEvent(relayUrl, challenge)
}

// Single shared pool, configured for NIP-42 AUTH using the burner privkey.
// The auth signer must return a signed kind-22242 event in response to a challenge.
function buildAuthSigner() {
  return (_relayUrl: string) => async (template: EventTemplate): Promise<VerifiedEvent> => {
    const skHex = getPrivkeyHex()
    const sk = new Uint8Array(skHex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)))
    // finalizeEvent returns a VerifiedEvent when the signature verifies
    return finalizeEvent({ ...template, created_at: template.created_at ?? Math.floor(Date.now() / 1000) }, sk)
  }
}

let _pool: SimplePool | null = null

/**
 * Returns the shared SimplePool configured for NIP-42 AUTH. Re-using one
 * pool means connections are cached across subscribe/publish calls.
 *
 * Note: nostr-tools SimplePool's constructor type only allows enablePing |
 * enableReconnect, so we set `automaticallyAuth` on the instance after
 * construction. The property is defined on the underlying AbstractSimplePool
 * class and is what `ensureRelay` actually reads.
 */
export function getPool(): SimplePool {
  if (_pool) return _pool
  _pool = new SimplePool()
  ;(_pool as unknown as { automaticallyAuth: (url: string) => null | ((evt: EventTemplate) => Promise<VerifiedEvent>) }).automaticallyAuth = buildAuthSigner()
  return _pool
}

/** Release all relay connections. Call before full page teardown. */
export function closePool(): void {
  if (_pool) {
    _pool.close(getRelays())
    _pool = null
  }
}

// Re-export identity helpers so callers can use one import path.
export { getPrivkeyHex, getMyPubkey }
