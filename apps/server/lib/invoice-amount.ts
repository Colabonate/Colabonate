import { decodeInvoice } from '@getalby/lightning-tools'

/**
 * ADR-394: verify the seller rail actually issued an invoice for the amount we
 * asked for. Without this, a misbehaving/compromised seller endpoint could
 * return an invoice for a different (e.g. tiny) amount and the preimage
 * self-confirm — which only checks `sha256(preimage) === paymentHash`, never
 * the amount — would still flip the ticket PAID, detaching the paid sum from
 * the listing price and the launch-cap/platform-fee accounting.
 *
 * Decoding uses the already-installed `@getalby/lightning-tools` (its decoder
 * is light-bolt11-decoder under the hood) — no new dependency.
 *
 * Throws on a decode failure or a mismatch. The caller
 * (`routes/tickets.ts`) classifies a thrown error whose message carries the
 * `invoice` marker as a 502 `PAYMENT_UPSTREAM_ERROR`, same as any other rail
 * failure.
 */
export function assertSellerInvoiceAmount(bolt11: string, expectedSats: number): void {
  let decoded: ReturnType<typeof decodeInvoice>
  try {
    decoded = decodeInvoice(bolt11)
  } catch (err) {
    throw new Error(`Seller invoice could not be decoded: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!decoded) {
    throw new Error('Seller invoice could not be decoded (not a valid BOLT11 invoice)')
  }
  if (decoded.satoshi !== expectedSats) {
    throw new Error(
      `Seller invoice amount mismatch: expected ${expectedSats} sats, invoice is for ${decoded.satoshi} sats`,
    )
  }
}
