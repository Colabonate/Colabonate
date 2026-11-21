/**
 * NIP-28 Public Chat Channel (ADR: Contact Community Chat)
 *
 * NIP-28 reserves Kinds 40–44 for public chat channels:
 *   - Kind 40 — channel creation (content = JSON { name, about, picture, relays })
 *   - Kind 42 — channel message (content = plaintext; tags [["e", <kind40_id>, <relay>, "root"]])
 *   - Kind 43/44 — hide/mute moderation (not in MVP — we do client-side moderation instead)
 *
 * Unlike the NIP-17 ticket chat (gift-wrapped, E2E, burner keys), NIP-28
 * messages are **plaintext** and **signed with the user's login identity**
 * via NIP-07 (window.nostr.signEvent). No encryption, no handshakes.
 *
 * Channel creation is a one-time deployment step (see DEPLOYMENT section
 * below). The app reads the resulting event ID from COMMUNITY_CHANNEL_ID.
 *
 * SECURITY: because anyone can publish Kind-42 events to a public relay,
 * all incoming messages are run through `moderateMessage()` before being
 * shown. That enforces a length cap and an operator-managed pubkey
 * blocklist. The feature can also be killed entirely via
 * VITE_COMMUNITY_CHAT_ENABLED without a code change.
 */

import type { Filter, Event } from 'nostr-tools'
import { SimplePool } from 'nostr-tools'

// ---------------------------------------------------------------------------
// Channel Configuration (env-driven, see vite-env.d.ts)
// ---------------------------------------------------------------------------

function readEnv(): Record<string, string | undefined> {
  return (import.meta as { env?: Record<string, string | undefined> }).env ?? {}
}

/**
 * The Kind-40 event ID of the global Colabonate Community channel.
 *
 * Deployed 2026-07-10: a "Colabonate Community" Kind-40 event was published
 * to the relays in COMMUNITY_CHANNEL_RELAYS (verified round-trip: both
 * relays store and serve Kind 40/42 back on query — several other public
 * relays, including the DM-pool defaults in nostr-relay-config.ts, ACK the
 * publish but silently drop these kinds on read, which is a dead end for a
 * persistent public channel).
 *
 * Override with VITE_COMMUNITY_CHANNEL_ID if the channel is ever redeployed.
 */
export const COMMUNITY_CHANNEL_ID =
  readEnv().VITE_COMMUNITY_CHANNEL_ID ?? 'e351719a424fe77046062446d9051c728b47e2b5d3520d9498b485dde796cc7e'

/**
 * Relays the channel lives on. Deliberately separate from the DM relay pool
 * in nostr-relay-config.ts (getRelays()) — that pool is curated for NIP-17
 * gift-wrapped DMs and does not reliably store/serve public Kind 40/42
 * channel events. Override with VITE_COMMUNITY_RELAYS (comma-separated).
 */
export const COMMUNITY_CHANNEL_RELAYS =
  (readEnv().VITE_COMMUNITY_RELAYS ?? 'wss://relay.damus.io,wss://relay.primal.net')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

/** Primary relay, used as the tag hint on published events (NIP-28 convention). */
export const COMMUNITY_CHANNEL_RELAY = COMMUNITY_CHANNEL_RELAYS[0]

// Dedicated pool for the community channel (separate from the DM pool —
// same relay-reuse benefit, different relay list).
let _channelPool: SimplePool | null = null
function getChannelPool(): SimplePool {
  if (!_channelPool) _channelPool = new SimplePool()
  return _channelPool
}

/**
 * Kill switch for the whole community-chat surface. Set
 * VITE_COMMUNITY_CHAT_ENABLED=false to hide the chat without a redeploy.
 * Defaults to true so existing behaviour is preserved.
 */
export const COMMUNITY_CHAT_ENABLED =
  (readEnv().VITE_COMMUNITY_CHAT_ENABLED ?? 'true').toLowerCase() !== 'false'

// ---------------------------------------------------------------------------
// Client-side moderation
// ---------------------------------------------------------------------------

/** Hard cap on message content length (plaintext chars). */
export const MAX_MESSAGE_LENGTH = 500

/** Operator-managed blocklist of pubkeys (64-hex), comma-separated via env. */
const BLOCKED_PUBKEYS = new Set(
  (readEnv().VITE_COMMUNITY_BLOCKED_PUBKEYS ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean),
)

/**
 * Decide whether an incoming message is allowed to be displayed.
 * Returns false for blocked authors or over-length content. This is the
 * minimum viable moderation surface for an unauthenticated public channel.
 */
export function isMessageAllowed(message: { pubkey: string; content: string }): boolean {
  if (BLOCKED_PUBKEYS.has(message.pubkey.toLowerCase())) return false
  if (message.content.length > MAX_MESSAGE_LENGTH) return false
  return true
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChannelMessage {
  id: string
  pubkey: string
  content: string
  createdAt: number
}

// ---------------------------------------------------------------------------
// NIP-07 helpers
// ---------------------------------------------------------------------------

interface Nip07Window {
  nostr?: {
    getPublicKey(): Promise<string>
    signEvent(template: Record<string, unknown>): Promise<Event>
  }
}

function getNip07(): NonNullable<Nip07Window['nostr']> {
  const w = window as unknown as Nip07Window
  if (!w.nostr) {
    throw new Error('A Nostr extension (NIP-07, e.g. Alby) is required to post in the community chat.')
  }
  return w.nostr
}

// ---------------------------------------------------------------------------
// Send (Kind 42)
// ---------------------------------------------------------------------------

/**
 * Publish a Kind-42 channel message, signed via NIP-07.
 *
 * Returns the signed event (with id + created_at) so the caller can add
 * it optimistically to the local message list.
 */
export async function sendChannelMessage(
  channelId: string,
  relayUrl: string,
  content: string,
): Promise<Event> {
  if (content.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`)
  }

  const nostr = getNip07()

  const template = {
    kind: 42,
    content,
    tags: [['e', channelId, relayUrl, 'root']],
  }

  const event = await nostr.signEvent({
    ...template,
    created_at: Math.floor(Date.now() / 1000),
  })

  const pool = getChannelPool()
  const pubs = pool.publish(COMMUNITY_CHANNEL_RELAYS, event)
  const results = await Promise.allSettled(pubs)
  const succeeded = results.filter(r => r.status === 'fulfilled').length
  if (succeeded === 0) {
    throw new Error('Message was rejected by all relays. Make sure the server is running and try again.')
  }

  return event
}

// ---------------------------------------------------------------------------
// Fetch (Kind 42, historical)
// ---------------------------------------------------------------------------

/**
 * Fetch historical Kind-42 messages for a channel, sorted ascending by time.
 *
 * Queries `#e: [channelId]` (root marker) and resolves after relays close
 * or a 5s timeout — same pattern as fetchChatMessages in lib/nostr.ts.
 */
export async function fetchChannelMessages(
  channelId: string,
  options?: { since?: number; limit?: number },
): Promise<ChannelMessage[]> {
  const since = options?.since ?? Math.floor(Date.now() / 1000) - 86400 * 7
  const limit = options?.limit ?? 100

  const filter: Filter = {
    kinds: [42],
    '#e': [channelId],
    since,
    limit,
  }

  const pool = getChannelPool()
  return new Promise((resolve) => {
    const events: ChannelMessage[] = []
    const seen = new Set<string>()

    const sub = pool.subscribe(COMMUNITY_CHANNEL_RELAYS, filter, {
      onevent: (event: Event) => {
        if (seen.has(event.id)) return
        seen.add(event.id)
        events.push({
          id: event.id,
          pubkey: event.pubkey,
          content: event.content,
          createdAt: event.created_at,
        })
      },
    })

    setTimeout(() => {
      sub.close()
      resolve(events.sort((a, b) => a.createdAt - b.createdAt))
    }, 5000)
  })
}

// ---------------------------------------------------------------------------
// Subscribe (Kind 42, live)
// ---------------------------------------------------------------------------

/**
 * Subscribe to live Kind-42 messages for a channel.
 *
 * Returns an unsubscribe function. The callback fires for every new
 * message (including our own, since they are public).
 */
export function subscribeToChannelMessages(
  channelId: string,
  onMessage: (message: ChannelMessage) => void,
  options?: { since?: number },
): () => void {
  const since = options?.since ?? Math.floor(Date.now() / 1000) - 86400 * 7

  const filter: Filter = {
    kinds: [42],
    '#e': [channelId],
    since,
  }

  const pool = getChannelPool()
  const sub = pool.subscribe(COMMUNITY_CHANNEL_RELAYS, filter, {
    onevent: (event: Event) => {
      onMessage({
        id: event.id,
        pubkey: event.pubkey,
        content: event.content,
        createdAt: event.created_at,
      })
    },
  })

  return () => sub.close()
}
