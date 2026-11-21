import { verifyEvent, type Event } from 'nostr-tools'
import { getPool } from './nostr-relay-config'
import { DEFAULT_DM_RELAYS, ensureDmRelayList } from './nostr-dm-relays'
import { getPrivkeyBytes } from './nostr-identity'
import type { DeliveryDeps } from './remote-delivery'

const INBOX_LOOKUP_WAIT_MS = 5_000
// Kind-10050 lists mostly live on index relays, not on the usual DM relays: checked live
// 2026-11-12, two real sellers had a list on purplepag.es / relay.nostr.band and none elsewhere.
const INBOX_LOOKUP_RELAYS = [
  'wss://purplepag.es',
  'wss://relay.nostr.band',
  'wss://indexer.coracle.social',
  ...DEFAULT_DM_RELAYS,
]
const PUBLISH_WAIT_MS = 6_000

/** Browser implementation of the delivery dependencies (shared relay pool, device key). */
export function createDefaultDeliveryDeps(): DeliveryDeps {
  return {
    async fetchInboxEvent(sellerPubkey) {
      const events = await getPool().querySync(
        INBOX_LOOKUP_RELAYS,
        { kinds: [10050], authors: [sellerPubkey], limit: 5 },
        { maxWait: INBOX_LOOKUP_WAIT_MS },
      )
      return events.sort((a: Event, b: Event) => b.created_at - a.created_at)[0] ?? null
    },
    async publish(relays, event) {
      const results = await Promise.allSettled(
        getPool()
          .publish(relays, event)
          .map((p) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), PUBLISH_WAIT_MS))])),
      )
      return results.filter((r) => r.status === 'fulfilled').length
    },
    senderKey: getPrivkeyBytes,
    verifyEvent,
    async ensureOwnInbox() {
      await ensureDmRelayList()
    },
  }
}
