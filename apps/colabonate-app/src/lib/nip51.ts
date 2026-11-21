/**
 * ADR-162 / NIP-51 — Trusted-Arbiter follow-set (Phase 6, C-T8).
 *
 * Stores the user's curated list of trusted private-arbiter pubkeys as a NIP-51
 * **follow set** (`kind:30000`) parameterized by `d: colabonate:trusted-arbiters`.
 * This is a standard NIP-51 follow-set (a set of `"p"` pubkeys the user curates),
 * so any NIP-51-aware client can read it; the `d`-identifier scopes it to our
 * purpose without colliding with other follow sets.
 *
 * The list feeds the mutual-arbiter nomination UI (PROB-002 §A2): when a user
 * opens a private dispute and must nominate an arbiter, they can pick from this
 * list instead of pasting an npub from memory.
 *
 * Signing is client-side per ADR-141 (NIP-07 preferred, burner fallback); the
 * server only mirrors the list for fast lookup (GET /api/nostr/trusted-arbiters).
 */

import { finalizeEvent, type EventTemplate, type Event } from 'nostr-tools'
import { getPool, getRelays } from './nostr-relay-config'
import { getPrivkeyBytes, isNip07Available, isValidHex64 } from './nostr-identity'

/** The NIP-51 d-identifier that scopes our follow-set. */
export const TRUSTED_ARBITER_SET_D = 'colabonate:trusted-arbiters'
export const TRUSTED_ARBITER_SET_KIND = 30000

export interface TrustedArbiterPublishResult {
  /** Signed kind:30000 event id. */
  listEventId: string
  /** Pubkeys stored in the published list (deduped, validated). */
  pubkeys: string[]
}

/** Validate + de-duplicate a candidate pubkey list. Throws on any invalid entry. */
export function normalizeArbiterList(pubkeys: string[]): string[] {
  if (!Array.isArray(pubkeys)) throw new Error('pubkeys must be an array')
  const seen = new Set<string>()
  const out: string[] = []
  for (const pk of pubkeys) {
    if (!isValidHex64(pk)) throw new Error(`Invalid arbiter pubkey (expected 64-char hex): ${pk}`)
    const lower = pk.toLowerCase()
    if (!seen.has(lower)) {
      seen.add(lower)
      out.push(lower)
    }
  }
  return out
}

/** Build the unsigned kind:30000 follow-set template. Pure + testable. */
export function buildTrustedArbiterListTemplate(pubkeys: string[]): EventTemplate {
  const normalized = normalizeArbiterList(pubkeys)
  return {
    kind: TRUSTED_ARBITER_SET_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', TRUSTED_ARBITER_SET_D],
      ...normalized.map(pk => ['p', pk]),
    ],
    content: '',
  }
}

/**
 * Extract the trusted-arbiter pubkeys from a kind:30000 event whose `d`-tag
 * matches our identifier. Returns `[]` for unrelated follow-sets.
 */
export function parseTrustedArbiterList(event: Event): string[] {
  if (event.kind !== TRUSTED_ARBITER_SET_KIND) return []
  const d = event.tags.find(t => t[0] === 'd')?.[1]
  if (d !== TRUSTED_ARBITER_SET_D) return []
  return event.tags
    .filter(t => t[0] === 'p' && isValidHex64(t[1]))
    .map(t => t[1].toLowerCase())
}

/**
 * Sign + publish the trusted-arbiter follow-set. Addressable (replaceable) ⇒
 * re-publishing replaces the prior version instead of stacking duplicates.
 */
export async function publishTrustedArbiterList(
  pubkeys: string[],
): Promise<TrustedArbiterPublishResult> {
  const normalized = normalizeArbiterList(pubkeys)
  const template = buildTrustedArbiterListTemplate(normalized)

  let event: Event
  const win = window as Window & {
    nostr?: { signEvent(t: EventTemplate): Promise<Event> }
  }
  if (isNip07Available() && win.nostr?.signEvent) {
    event = await win.nostr.signEvent(template)
  } else {
    event = finalizeEvent(template, getPrivkeyBytes())
  }

  const pool = getPool()
  const results = await Promise.allSettled(pool.publish(getRelays(), event))
  const ok = results.filter(r => r.status === 'fulfilled').length
  if (ok === 0) {
    throw new Error('Failed to publish trusted-arbiter list to any relay')
  }
  return { listEventId: event.id, pubkeys: normalized }
}
