/**
 * ADR-417 / FU-1000: after paying a remote seller over Lightning, the buyer can send the delivery
 * details privately. A Lightning payment carries no address, and the seller's marketplace shows
 * nothing about the buyer, so without this the buyer cannot actually receive the goods.
 *
 * The message is a standard NIP-17 direct message (Kind 14 rumor, NIP-44 seal, NIP-59 gift wrap),
 * readable by any NIP-17 client the seller uses, published ONLY to the relays the seller named in
 * their Kind-10050 inbox list. A seller without such a list cannot be reached privately: the caller
 * then offers the text for copying instead of guessing relays (NIP-17 forbids that).
 *
 * All I/O is injected so the flow is unit-testable; delivery details are never logged.
 */
import { nip17, type Event } from 'nostr-tools'

export const DELIVERY_MIN_LENGTH = 10
export const DELIVERY_MAX_LENGTH = 1000
const MAX_DM_RELAYS = 5
const HEX64 = /^[0-9a-f]{64}$/i

export interface DeliveryDeps {
  /** Newest Kind-10050 event of the seller (relays are read by the caller; may be unverified). */
  fetchInboxEvent(sellerPubkey: string): Promise<Event | null>
  /** Publishes to the given relays, resolves with the number that accepted it. */
  publish(relays: string[], event: Event): Promise<number>
  /** Sender key for the seal (device key; the buyer's login identity is named in the text). */
  senderKey(): Uint8Array
  verifyEvent(event: Event): boolean
  /**
   * Best effort: make sure the sender key itself has a published DM inbox, so a seller's client
   * has somewhere to answer. Never throws into the send path; omitted in tests.
   */
  ensureOwnInbox?(): Promise<void>
}

export type DeliveryResult =
  | { kind: 'sent'; relayCount: number }
  | { kind: 'no-inbox' }
  | { kind: 'failed'; reason: 'invalid-input' | 'no-relay-accepted' | 'error' }

/** wss:// only (a browser must not be pointed at ws:// or local hosts), deduplicated, capped. */
export function parseInboxRelays(event: Pick<Event, 'tags'> | null): string[] {
  if (!event || !Array.isArray(event.tags)) return []
  const relays: string[] = []
  for (const tag of event.tags) {
    if (!Array.isArray(tag) || tag[0] !== 'relay' || typeof tag[1] !== 'string') continue
    let url: URL
    try {
      url = new URL(tag[1].trim())
    } catch {
      continue
    }
    if (url.protocol !== 'wss:' || url.username || url.password) continue
    const host = url.hostname.toLowerCase()
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || /^[\d.]+$/.test(host) || host.includes(':') || !host.includes('.')) {
      continue
    }
    const normalized = url.toString().replace(/\/$/, '')
    if (!relays.includes(normalized)) relays.push(normalized)
    if (relays.length >= MAX_DM_RELAYS) break
  }
  return relays
}

export interface DeliveryMessageInput {
  orderId: string
  amountSats: number
  payeeLud16: string
  listingAddress: string
  /** Free text from the buyer: name, address, a way to reach them. */
  details: string
  /** The buyer's Nostr identity (hex), named so the seller can match the public zap. */
  buyerPubkey: string
}

export function validateDeliveryDetails(details: string): boolean {
  const trimmed = details.trim()
  return trimmed.length >= DELIVERY_MIN_LENGTH && trimmed.length <= DELIVERY_MAX_LENGTH
}

/** Plain-text body; deliberately without the preimage or any payment secret. */
export function buildDeliveryMessage(input: DeliveryMessageInput): string {
  return [
    `Order ${input.orderId.slice(0, 8)}: I paid ${input.amountSats} sats by Lightning to ${input.payeeLud16} for this listing: ${input.listingAddress}`,
    `Paid from Nostr identity: ${input.buyerPubkey}`,
    '',
    'Delivery details:',
    input.details.trim(),
  ].join('\n')
}

/**
 * Wraps `text` as NIP-17 and publishes it to the seller's own Kind-10050 relays. Shared by the
 * delivery message and the order notice; `text` must never contain a payment secret.
 */
export async function sendPrivateMessage(
  deps: DeliveryDeps,
  input: { sellerPubkey: string; text: string },
): Promise<DeliveryResult> {
  try {
    const inbox = await deps.fetchInboxEvent(input.sellerPubkey)
    // The list must be the seller's own, correctly signed.
    const trusted = inbox && inbox.kind === 10050 && inbox.pubkey === input.sellerPubkey && deps.verifyEvent(inbox) ? inbox : null
    const relays = parseInboxRelays(trusted)
    if (relays.length === 0) return { kind: 'no-inbox' }

    // Fire and forget: a failure here must not block or fail the message itself.
    try {
      void deps.ensureOwnInbox?.().catch(() => undefined)
    } catch {
      // Synchronous failure of the best-effort step: ignored.
    }
    const wrapped = nip17.wrapEvent(deps.senderKey(), { publicKey: input.sellerPubkey }, input.text)
    const accepted = await deps.publish(relays, wrapped)
    return accepted > 0 ? { kind: 'sent', relayCount: accepted } : { kind: 'failed', reason: 'no-relay-accepted' }
  } catch {
    return { kind: 'failed', reason: 'error' }
  }
}

export async function sendDeliveryMessage(
  deps: DeliveryDeps,
  input: DeliveryMessageInput & { sellerPubkey: string },
): Promise<DeliveryResult> {
  if (!HEX64.test(input.sellerPubkey) || !HEX64.test(input.buyerPubkey) || !validateDeliveryDetails(input.details)) {
    return { kind: 'failed', reason: 'invalid-input' }
  }
  return sendPrivateMessage(deps, { sellerPubkey: input.sellerPubkey, text: buildDeliveryMessage(input) })
}
