import { nip19 } from 'nostr-tools'

/**
 * Links that open a Nostr listing (kind 30402) in any other Nostr client.
 */

export interface RemoteListingRef {
  pubkey: string
  dTag: string
  relays?: string[]
}

const LISTING_KIND = 30402
const MAX_RELAYS = 3
const PUBKEY_RE = /^[0-9a-f]{64}$/

function normalizeRelays(relays: string[] | undefined): string[] {
  if (!Array.isArray(relays)) return []
  const out: string[] = []
  for (const raw of relays) {
    if (typeof raw !== 'string') continue
    const relay = raw.trim()
    if (!(relay.startsWith('wss://') || relay.startsWith('ws://'))) continue
    if (out.includes(relay)) continue
    out.push(relay)
    if (out.length === MAX_RELAYS) break
  }
  return out
}

export function buildListingNaddr(ref: RemoteListingRef): string | null {
  try {
    if (!ref || typeof ref.pubkey !== 'string' || !PUBKEY_RE.test(ref.pubkey)) return null
    if (typeof ref.dTag !== 'string' || ref.dTag.length === 0) return null
    return nip19.naddrEncode({
      kind: LISTING_KIND,
      pubkey: ref.pubkey,
      identifier: ref.dTag,
      relays: normalizeRelays(ref.relays),
    })
  } catch {
    return null
  }
}

export function buildNostrUri(ref: RemoteListingRef): string | null {
  const naddr = buildListingNaddr(ref)
  return naddr === null ? null : `nostr:${naddr}`
}

export function buildNjumpUrl(ref: RemoteListingRef): string | null {
  const naddr = buildListingNaddr(ref)
  return naddr === null ? null : `https://njump.me/${naddr}`
}
