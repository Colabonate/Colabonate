/**
 * ADR-156 / NIP-09 — client-side account-deletion request.
 *
 * Builds, signs, and publishes a Kind 5 (deletion request) event for the
 * given Nostr event ids. Per ADR-141 the privkey NEVER leaves the user's
 * NIP-07 extension (or the persisted burner key as fallback), so signing
 * happens HERE in the client — the server only collects the event ids
 * (collectEventIdsForUser) and never publishes on the user's behalf.
 *
 * The result is passed back into `POST /api/gdpr/delete-account` so the
 * AccountDeletionLog audit trail captures the Kind 5 id + per-relay outcomes
 * atomically with the DB cascade.
 *
 * NIP-09 is a REQUEST, not a guarantee — relays decide whether to honour it.
 * Gift Wraps (Kind 1059) cannot be deleted this way (their author is a random
 * one-time key); their content becomes permanently unreadable once the user
 * discards the login key. The UI communicates both limitations.
 */

import { finalizeEvent, type EventTemplate, type Event } from 'nostr-tools'
import { getPool, getRelays } from './nostr-relay-config'
import { getPrivkeyBytes, isNip07Available } from './nostr-identity'
import { getDmRelayList } from './nostr-dm-relays'

export interface Nip09RelayResult {
  success: boolean
  error?: string
}

export interface Nip09PublishResult {
  /** Signed Kind 5 event id, or null if there was nothing to delete. */
  kind5EventId: string | null
  /** Per-relay outcome, for the AccountDeletionLog audit trail. */
  relayResponses: Record<string, Nip09RelayResult>
  /** Number of relays that accepted the Kind 5. */
  relaysOk: number
}

function dedupe(relays: string[]): string[] {
  return [...new Set(relays)]
}

/**
 * Sign + publish a Kind 5 deletion request for `eventIds`.
 *
 * - Empty `eventIds` → no-op success (nothing on relays to delete).
 * - Prefers NIP-07 `window.nostr.signEvent` (real identity); falls back to the
 *   persisted burner key via `finalizeEvent` when no extension is present.
 * - Publishes to the union of the user's DM relay list (Kind 10050) and the
 *   configured write relays, so both DM-focused and general relays receive it.
 * - Never throws on relay failure — relays are best-effort. Returns per-relay
 *   results so the caller (and the audit log) can see what happened.
 */
export async function publishDeletionRequest(
  eventIds: string[],
  reason = 'GDPR Art. 17 – Right to Erasure',
): Promise<Nip09PublishResult> {
  if (!Array.isArray(eventIds) || eventIds.length === 0) {
    return { kind5EventId: null, relayResponses: {}, relaysOk: 0 }
  }

  // pubkey is derived during signing (finalizeEvent / NIP-07 signEvent),
  // so it is NOT part of the EventTemplate.
  const template: EventTemplate = {
    kind: 5,
    created_at: Math.floor(Date.now() / 1000),
    tags: eventIds.map(id => ['e', id]),
    content: reason,
  }

  // Prefer the NIP-07 extension (real identity key); fall back to burner.
  let event: Event
  const win = window as Window & {
    nostr?: { signEvent(t: EventTemplate): Promise<Event> }
  }
  if (isNip07Available() && win.nostr?.signEvent) {
    event = await win.nostr.signEvent(template)
  } else {
    event = finalizeEvent(template, getPrivkeyBytes())
  }

  const targetRelays = dedupe([...getDmRelayList(), ...getRelays()])
  const pool = getPool()

  const relayResponses: Record<string, Nip09RelayResult> = {}
  let relaysOk = 0
  // Publish one relay at a time so we can attribute success/failure precisely
  // (pool.publish returns a Promise<void> per relay but without a stable
  // index→relay mapping across versions).
  for (const relay of targetRelays) {
    try {
      await pool.publish([relay], event)
      relayResponses[relay] = { success: true }
      relaysOk++
    } catch (e) {
      relayResponses[relay] = {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  }

  return { kind5EventId: event.id, relayResponses, relaysOk }
}
