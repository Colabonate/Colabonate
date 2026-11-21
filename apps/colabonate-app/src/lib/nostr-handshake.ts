/**
 * NIP-17 Burner-Pubkey Handshake Pattern (ADR-153 §1)
 *
 * Solves the "Burner-Pubkey-Problem" for NIP-44 ECDH:
 * - NIP-44 Conversation Key = ECDH(myBurnerPrivkey, peerBurnerPubkey)
 * - The peer's burner pubkey is needed for encryption but is never published
 * - Without a key exchange, sender cannot encrypt for unknown recipient
 *
 * Solution: At first chat open, publish a plaintext Kind-14 "handshake" event
 * with a `t=colabonate-handshake` tag and a `chat_pubkey` tag carrying the
 * sender's burner pubkey. The peer reads it, caches the pubkey in localStorage,
 * and replies with their own handshake.
 *
 * Backwards-compatible: existing Kind-14 messages from the legacy plaintext
 * system (ADR-061) carry the `sender_chat_pubkey` tag — that path still works
 * for old events, this file is the new Gift-Wrap-aware handshake.
 *
 * Cache storage:
 *   localStorage['colabonate:handshake:<peerLoginPubkey>'] = peerChatPubkey
 *   localStorage['colabonate:handshake-ts:<peerLoginPubkey>'] = unixSeconds
 */

import { finalizeEvent, getPublicKey, type EventTemplate } from 'nostr-tools'
import { getPrivkeyHex, getRelays, getPool } from './nostr-relay-config'

const HANDSHAKE_TAG = 'colabonate-handshake'
const HANDSHAKE_KEY_PREFIX = 'colabonate:handshake:'
const HANDSHAKE_TS_KEY_PREFIX = 'colabonate:handshake-ts:'
const HANDSHAKE_TIMEOUT_SECONDS = 24 * 60 * 60 // 24h

export interface HandshakeRecord {
  peerChatPubkey: string
  establishedAt: number
}

function tsKey(peerLoginPubkey: string): string {
  return `${HANDSHAKE_TS_KEY_PREFIX}${peerLoginPubkey}`
}

function valueKey(peerLoginPubkey: string): string {
  return `${HANDSHAKE_KEY_PREFIX}${peerLoginPubkey}`
}

/** Read cached peer chat pubkey. Returns null if no handshake completed yet. */
export function getPeerChatPubkey(peerLoginPubkey: string): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(valueKey(peerLoginPubkey))
}

/** Returns the full handshake record (peer pubkey + timestamp), or null. */
export function getHandshake(peerLoginPubkey: string): HandshakeRecord | null {
  const peerChatPubkey = getPeerChatPubkey(peerLoginPubkey)
  if (!peerChatPubkey) return null
  const tsRaw = typeof localStorage !== 'undefined' ? localStorage.getItem(tsKey(peerLoginPubkey)) : null
  return {
    peerChatPubkey,
    establishedAt: tsRaw ? parseInt(tsRaw, 10) : 0,
  }
}

function storeHandshake(peerLoginPubkey: string, peerChatPubkey: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(valueKey(peerLoginPubkey), peerChatPubkey)
  localStorage.setItem(tsKey(peerLoginPubkey), Math.floor(Date.now() / 1000).toString())
}

/** Clear cached handshake for one peer (used on burner-key rotation). */
export function clearHandshake(peerLoginPubkey: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(valueKey(peerLoginPubkey))
  localStorage.removeItem(tsKey(peerLoginPubkey))
}

/** Clear all cached handshakes (used on burner-key reset). */
export function clearAllHandshakes(): void {
  if (typeof localStorage === 'undefined') return
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && (k.startsWith(HANDSHAKE_KEY_PREFIX) || k.startsWith(HANDSHAKE_TS_KEY_PREFIX))) keys.push(k)
  }
  keys.forEach(k => localStorage.removeItem(k))
}

/** Returns true if a cached handshake is older than the timeout. */
export function isHandshakeExpired(peerLoginPubkey: string): boolean {
  const record = getHandshake(peerLoginPubkey)
  if (!record) return true
  const now = Math.floor(Date.now() / 1000)
  return now - record.establishedAt > HANDSHAKE_TIMEOUT_SECONDS
}

/**
 * Build (and publish) a plaintext Kind-14 handshake event for the peer.
 *
 * The event is NOT Gift-Wrapped because the recipient does not yet have our
 * burner pubkey. This is the single permitted unencrypted DM in the system
 * per ADR-153 §1.
 */
export async function publishHandshake(peerLoginPubkey: string): Promise<{ id: string; createdAt: number }> {
  if (!peerLoginPubkey) throw new Error('No peer pubkey provided for handshake')

  const skHex = getPrivkeyHex()
  const sk = new Uint8Array(skHex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)))
  const myChatPubkey = getPublicKey(sk)

  const template: EventTemplate = {
    kind: 14,
    tags: [
      ['p', peerLoginPubkey],
      ['t', HANDSHAKE_TAG],
      ['chat_pubkey', myChatPubkey],
      ['protocol', 'nip44-v2'],
    ],
    content: '',
    created_at: Math.floor(Date.now() / 1000),
  }

  const event = finalizeEvent(template, sk)

  const pool = getPool()
  const pubs = pool.publish(getRelays(), event)
  const results = await Promise.allSettled(pubs)
  const succeeded = results.filter(r => r.status === 'fulfilled').length
  if (succeeded === 0) {
    throw new Error('Failed to publish handshake to any relay')
  }
  return { id: event.id, createdAt: event.created_at }
}

/** True if the event is a plaintext Kind-14 handshake ping (not real chat content). */
export function isHandshakeEvent(event: { kind: number; tags: string[][] }): boolean {
  return event.kind === 14 && event.tags.some(x => x[0] === 't' && x[1] === HANDSHAKE_TAG)
}

/**
 * Process an incoming handshake event: cache the sender's chat pubkey under
 * the sender's known LOGIN pubkey, so a later `getPeerChatPubkey(peerLoginPubkey)`
 * lookup can find it. `peerLoginPubkey` must be supplied by the caller (e.g.
 * `ticket.buyerPubkey`/`sellerPubkey`) — the handshake event itself only
 * carries the sender's *chat* pubkey (`event.pubkey` and the `chat_pubkey`
 * tag are the same burner key), never their login identity, so there is no
 * way to derive the correct cache key from the event alone.
 *
 * Returns the cached peerChatPubkey if newly recorded, or null if the event
 * was not a valid handshake.
 */
export function acceptHandshakeEvent(
  event: { kind: number; tags: string[][] },
  peerLoginPubkey: string,
): string | null {
  if (!isHandshakeEvent(event)) return null
  const chatPubkey = event.tags.find(x => x[0] === 'chat_pubkey')?.[1]
  if (!chatPubkey || chatPubkey.length !== 64) return null
  storeHandshake(peerLoginPubkey, chatPubkey)
  return chatPubkey
}

/**
 * Ensure a handshake exists with the given peer. If we have no cached
 * chat pubkey for the peer, publishes a handshake event so the peer
 * can learn our burner pubkey. Safe to call repeatedly.
 *
 * Returns true if a handshake already existed (or was just initiated
 * successfully), false if the publish failed.
 */
export async function ensureHandshake(peerLoginPubkey: string): Promise<boolean> {
  const existing = getPeerChatPubkey(peerLoginPubkey)
  if (existing) return true
  try {
    await publishHandshake(peerLoginPubkey)
    return true
  } catch (e) {
    console.warn('[nostr-handshake] Failed to publish handshake:', e)
    return false
  }
}

// Re-export relay config for callers that want the same pool/relay list
export { getRelays }
