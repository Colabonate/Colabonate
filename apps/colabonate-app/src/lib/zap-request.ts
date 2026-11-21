import type { EventTemplate, VerifiedEvent } from 'nostr-tools'
import { signOrDelegate } from './nostr-identity'

/** ADR-417 D3: the parameters the server hands out for a NIP-57 zap request. */
export interface ZapTemplate {
  payeePubkey: string
  amountMsats: number
  lnurl: string
  relays: string[]
  listingAddress: string
}

const MAX_RELAYS = 10
const MAX_CONTENT_LENGTH = 280

/**
 * Builds the unsigned Kind-9734 zap request for a remote listing.
 * Tag order is part of the contract: relays, amount, lnurl, p, a.
 * No `client` or `e` tags are ever added.
 */
export function buildZapRequestTemplate(t: ZapTemplate, content?: string, createdAt?: number): EventTemplate {
  const relays = t.relays
    .filter((r) => r.startsWith('wss://') || r.startsWith('ws://'))
    .slice(0, MAX_RELAYS)

  return {
    kind: 9734,
    created_at: createdAt ?? Math.floor(Date.now() / 1000),
    content: (content ?? '').slice(0, MAX_CONTENT_LENGTH),
    tags: [
      ['relays', ...relays],
      ['amount', String(t.amountMsats)],
      ['lnurl', t.lnurl],
      ['p', t.payeePubkey],
      ['a', t.listingAddress],
    ],
  }
}

/** Signs the zap request with the buyer's identity (NIP-07 / NIP-46 / device key). */
export async function signZapRequest(t: ZapTemplate, content?: string): Promise<VerifiedEvent> {
  return signOrDelegate(buildZapRequestTemplate(t, content))
}
