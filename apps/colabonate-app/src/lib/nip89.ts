/**
 * ADR-161 / NIP-89 — App Handler publication (Phase 5, C-T5).
 *
 * Publishes Colabonate's `kind:31990` "handler information" event declaring
 * which Nostr kinds this client can open, so that a private offer shared as a
 * `nostr:` URI (NIP-21) can be opened in any cooperating client (Damus,
 * Amethyst, Primal, Coracle, …). Per NIP-89 a recommending client may also
 * publish `kind:31989` pointing at this handler.
 *
 * The handler event is addressable (`d: colabonate`), so re-publishing replaces
 * the prior version instead of stacking duplicates. Per ADR-141 the privkey
 * never leaves the NIP-07 extension (burner fallback) — signing happens here.
 *
 * This is best-effort publishing like the other NIP helpers (nip09.ts,
 * nostr-dm-relays.ts): relay failures are collected per-relay but never throw.
 */

import { finalizeEvent, type EventTemplate, type Event } from 'nostr-tools'
import { getPool, getRelays } from './nostr-relay-config'
import { getPrivkeyBytes, isNip07Available } from './nostr-identity'
import { getDmRelayList } from './nostr-dm-relays'

/** Kinds Colabonate can handle (see docs/nip-publications/NIP-P-private-commerce.md). */
export const COLABONATE_SUPPORTED_KINDS = [
  '14',    // NIP-17 DM content (NIP-P private-commerce envelopes)
  '1059',  // NIP-59 gift wrap
  '10050', // DM relay list
  '30402', // NIP-A public offer
  '30414', // NIP-C public cooperation
] as const

export interface Nip89HandlerConfig {
  /** The app name shown by recommending clients. */
  name?: string
  /** Web redirect base, e.g. https://app.colabonate.org */
  web?: string
  /** Square app logo URL. */
  picture?: string
  /** Optional free-form description. */
  about?: string
  /** Kinds to declare in `supports` tags (defaults to the Colabonate set). */
  supports?: readonly string[]
}

export interface Nip89RelayResult {
  success: boolean
  error?: string
}

export interface Nip89PublishResult {
  /** Signed kind:31990 event id. */
  handlerEventId: string
  /** Per-relay outcome. */
  relayResponses: Record<string, Nip89RelayResult>
  /** Number of relays that accepted the event. */
  relaysOk: number
}

/**
 * Build the kind:31990 handler-information event template (unsigned).
 * Exported so it can be inspected / tested without publishing.
 */
export function buildAppHandlerTemplate(cfg: Nip89HandlerConfig = {}): EventTemplate {
  const supports = cfg.supports ?? COLABONATE_SUPPORTED_KINDS
  const tags: string[][] = [
    ['d', 'colabonate'],
    ['name', cfg.name ?? 'Colabonate'],
  ]
  if (cfg.web) tags.push(['web', cfg.web])
  if (cfg.picture) tags.push(['picture', cfg.picture])
  if (cfg.about) tags.push(['about', cfg.about])
  for (const k of supports) tags.push(['supports', k])
  return {
    kind: 31990,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  }
}

/**
 * Sign + publish the kind:31990 handler-information event. Prefers NIP-07
 * (real identity); falls back to the persisted burner key.
 *
 * Addressable (`d: colabonate`) ⇒ re-publishing replaces, never duplicates.
 */
export async function publishAppHandler(
  cfg: Nip89HandlerConfig = {},
): Promise<Nip89PublishResult> {
  const template = buildAppHandlerTemplate(cfg)

  let event: Event
  const win = window as Window & {
    nostr?: { signEvent(t: EventTemplate): Promise<Event> }
  }
  if (isNip07Available() && win.nostr?.signEvent) {
    event = await win.nostr.signEvent(template)
  } else {
    event = finalizeEvent(template, getPrivkeyBytes())
  }

  const targetRelays = [...new Set([...getDmRelayList(), ...getRelays()])]
  const pool = getPool()

  const relayResponses: Record<string, Nip89RelayResult> = {}
  let relaysOk = 0
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

  return { handlerEventId: event.id, relayResponses, relaysOk }
}
