/**
 * NIP-10050 DM-Relay-Liste (ADR-153 §5 — Onboarding + Settings edit)
 *
 * Publishes a Kind 10050 event listing the user's preferred DM relays.
 * Peers fetch this list to know where to publish Gift Wraps for us.
 * Per NIP-17, kind 10050 is replaceable (one event per pubkey, latest wins).
 *
 * This is the Kind 10050 helper extracted from nostr.ts so it can be reused
 * by the Settings UI (edit + republish) and the chat send-path (lazy
 * onboarding).
 */

import { finalizeEvent, type EventTemplate } from 'nostr-tools'
import { getPool, getRelays } from './nostr-relay-config'
import { getPrivkeyBytes } from './nostr-identity'

const DM_RELAY_LIST_STORAGE_KEY = 'colabonate:dm_relay_list'

export const DEFAULT_DM_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
]

/** Returns the user's locally-cached DM relay list, or the defaults. */
export function getDmRelayList(): string[] {
  if (typeof localStorage === 'undefined') return [...DEFAULT_DM_RELAYS]
  const raw = localStorage.getItem(DM_RELAY_LIST_STORAGE_KEY)
  if (!raw) return [...DEFAULT_DM_RELAYS]
  try {
    const parsed = JSON.parse(raw) as string[]
    if (Array.isArray(parsed) && parsed.length > 0) return parsed
  } catch {
    // fall through to defaults
  }
  return [...DEFAULT_DM_RELAYS]
}

/** Persist the DM relay list locally (does not publish). */
export function setDmRelayListLocal(relayUrls: string[]): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(DM_RELAY_LIST_STORAGE_KEY, JSON.stringify(relayUrls))
}

/**
 * Publishes a Kind 10050 event listing the user's preferred DM relays.
 * Throws on invalid input or no relay accepting the event.
 */
export async function publishDmRelayList(relayUrls: string[]): Promise<{ id: string }> {
  if (!Array.isArray(relayUrls) || relayUrls.length === 0) {
    throw new Error('publishDmRelayList: at least one relay URL is required')
  }
  for (const url of relayUrls) {
    if (!/^wss?:\/\/.+/.test(url)) {
      throw new Error(`publishDmRelayList: invalid relay URL: ${url}`)
    }
  }

  const sk = getPrivkeyBytes()
  const template: EventTemplate = {
    kind: 10050,
    created_at: Math.floor(Date.now() / 1000),
    tags: relayUrls.map(url => ['relay', url]),
    content: '',
  }
  const event = finalizeEvent(template, sk)

  const pool = getPool()
  const pubs = pool.publish(getRelays(), event)
  const results = await Promise.allSettled(pubs)
  const succeeded = results.filter(r => r.status === 'fulfilled').length
  if (succeeded === 0) {
    throw new Error('Failed to publish DM relay list to any relay')
  }
  return { id: event.id }
}

/**
 * Idempotent onboarding helper: if the user has no localStorage record of
 * a published DM relay list, publish one with sensible defaults.
 * Returns the list actually used.
 */
export async function ensureDmRelayList(): Promise<string[]> {
  if (typeof localStorage === 'undefined') return getDmRelayList()
  const existing = localStorage.getItem(DM_RELAY_LIST_STORAGE_KEY)
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as string[]
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    } catch {
      // fall through
    }
  }
  const list = getDmRelayList()
  await publishDmRelayList(list)
  setDmRelayListLocal(list)
  return list
}
