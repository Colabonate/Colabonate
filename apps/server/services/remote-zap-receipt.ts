/**
 * ADR-417 / FU-1003: zap receipts (NIP-57 Kind 9735) as an additional settlement signal for
 * buyers who paid the invoice outside the browser and whose LNURL provider offers no LUD-21
 * verify URL. A receipt counts only when its `preimage` tag hashes to the order's payment hash:
 * that is the same cryptographic proof as the buyer's own preimage (D5), so a forged or foreign
 * receipt can never flip an order to PAID. Receipts without a preimage tag are ignored.
 */
import { createHash } from 'node:crypto'
import { verifyEvent, type Event } from 'nostr-tools'
import { nostrService } from './nostr-relay.js'

const HEX64 = /^[0-9a-f]{64}$/i
const RECEIPT_LOOKUP_TIMEOUT_MS = 4_000
const RECEIPT_LIMIT = 50
/** Receipts are created right after payment; allow some clock skew against the order. */
const SINCE_SKEW_SECONDS = 120

export interface ReceiptLookup {
  /** Payee pubkey (the zap recipient; the receipt `p` tag). */
  payeePubkey: string
  /** NIP-33 address of the listing; the receipt copies the zap request's `a` tag. */
  listingAddress: string
  bolt11: string
  paymentHash: string
  /** Order creation time. */
  since: Date
}

// Relay data is untrusted: a malformed tag must be skipped, never throw and hide a valid receipt.
function tagValue(event: Event, name: string): string | undefined {
  if (!Array.isArray(event.tags)) return undefined
  for (const tag of event.tags) {
    if (Array.isArray(tag) && tag[0] === name && typeof tag[1] === 'string') return tag[1]
  }
  return undefined
}

/** Pure selection: first valid receipt for this invoice that carries a matching preimage. */
export function selectReceiptPreimage(events: Event[], lookup: Pick<ReceiptLookup, 'bolt11' | 'paymentHash'>): string | null {
  const wantedBolt11 = lookup.bolt11.toLowerCase()
  const wantedHash = lookup.paymentHash.toLowerCase()
  for (const event of events) {
    if (event.kind !== 9735) continue
    if (tagValue(event, 'bolt11')?.toLowerCase() !== wantedBolt11) continue
    const preimage = tagValue(event, 'preimage')
    if (!preimage || !HEX64.test(preimage)) continue
    if (createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex') !== wantedHash) continue
    // Signature check last (the preimage already proves payment; this drops malformed noise).
    if (!verifyEvent(structuredClone(event))) continue
    return preimage.toLowerCase()
  }
  return null
}

export async function findZapReceiptPreimage(lookup: ReceiptLookup): Promise<string | null> {
  try {
    const events = await nostrService.getEvents(
      {
        kinds: [9735],
        '#p': [lookup.payeePubkey],
        '#a': [lookup.listingAddress],
        since: Math.floor(lookup.since.getTime() / 1000) - SINCE_SKEW_SECONDS,
        limit: RECEIPT_LIMIT,
      },
      RECEIPT_LOOKUP_TIMEOUT_MS,
    )
    return selectReceiptPreimage(events, lookup)
  } catch {
    return null
  }
}
