/**
 * ADR-417 / FU-1011: after a remote order is PAID, the buyer's browser sends the seller a minimal,
 * encrypted "order notice" (NIP-17, same transport as the delivery message). It names the order
 * reference, amount, payee address, listing and the buyer's Nostr identity: no address, no contact
 * data, never a payment secret. Colabonate has no key of its own here, so it only happens while the
 * buyer's browser sees the payment.
 *
 * Automatic only when the payee is the listing's named `seller`: the author is often an
 * organisation or bridge account that is not the seller, and nothing is sent to it unprompted.
 */
import {
  sendPrivateMessage,
  type DeliveryDeps,
  type DeliveryMessageInput,
  type DeliveryResult,
} from './remote-delivery'

const HEX64 = /^[0-9a-f]{64}$/i
const SENT_KEY_PREFIX = 'colabonate:remoteOrderNotice:sent:'

export type OrderNoticeInput = Omit<DeliveryMessageInput, 'details'>

/** Plain-text body; deliberately without the preimage, invoice or any contact data. */
export function buildOrderNotice(input: OrderNoticeInput): string {
  return [
    `Order notice ${input.orderId.slice(0, 8)}: I paid ${input.amountSats} sats by Lightning to ${input.payeeLud16} for this listing: ${input.listingAddress}`,
    `Paid from Nostr identity: ${input.buyerPubkey}`,
    '',
    'This notice was sent from the Colabonate app when the payment completed. It contains no address or payment secret. Delivery details may follow in a separate message from this sender.',
  ].join('\n')
}

/** The automatic send rule: named seller, buyer did not opt out, not sent before. */
export function shouldAutoSendNotice(input: {
  payeeRole: 'seller' | 'author'
  optIn: boolean
  alreadySent: boolean
}): boolean {
  return input.payeeRole === 'seller' && input.optIn && !input.alreadySent
}

export function hasNoticeBeenSent(orderId: string): boolean {
  try {
    return localStorage.getItem(SENT_KEY_PREFIX + orderId) === '1'
  } catch {
    return false
  }
}

export function markNoticeSent(orderId: string): void {
  try {
    localStorage.setItem(SENT_KEY_PREFIX + orderId, '1')
  } catch {
    // Storage unavailable: worst case the notice can be re-sent by the buyer's click.
  }
}

export async function sendOrderNotice(
  deps: DeliveryDeps,
  input: OrderNoticeInput & { sellerPubkey: string },
): Promise<DeliveryResult> {
  if (!HEX64.test(input.sellerPubkey) || !HEX64.test(input.buyerPubkey) || !input.orderId) {
    return { kind: 'failed', reason: 'invalid-input' }
  }
  return sendPrivateMessage(deps, { sellerPubkey: input.sellerPubkey, text: buildOrderNotice(input) })
}
