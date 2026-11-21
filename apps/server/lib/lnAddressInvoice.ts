import { LightningAddress } from '@getalby/lightning-tools'
import { assertInvoiceMatchesLnurlMetadata, readInvoiceDescriptionHash } from './bolt11-tags.js'
import { readLnurlpDomain } from './lnAddressHandle.js'

function isOwnLnurlpAddress(lnAddress: string): boolean {
  const domain = lnAddress.split('@')[1]?.trim().toLowerCase()
  return Boolean(domain) && domain === readLnurlpDomain().trim().toLowerCase()
}

export interface LnAddressInvoice {
  bolt11: string
  paymentHash: string
  /**
   * LUD-21 verify URL, when the LNURL-pay provider returns one. Lets the
   * server check settlement itself (ADR-394 FU-838) instead of relying on the
   * payer to report the preimage.
   */
  verifyUrl?: string
}

// ADR-351: shared LUD-16/LNURL-pay invoice resolution — extracted out of
// sellerPaymentResolver.ts (ADR-253 FU-253-A) so platformPaymentResolver.ts
// can reuse the exact same, already-reviewed mechanism instead of a second
// copy. `proxy: false` is required: LightningAddress defaults to routing
// every lookup through Alby's own proxy (api.getalby.com/lnurl), which would
// leak the recipient address and trade amount to a third party on every call.
export async function resolveLnAddressInvoice(lnAddress: string, amountSats: number, memo: string): Promise<LnAddressInvoice> {
  const ln = new LightningAddress(lnAddress, { proxy: false })
  await ln.fetch()
  let invoice = await ln.requestInvoice({ satoshi: amountSats, comment: memo })
  // ADR-394 FU-839: LUD-06 — the invoice must commit to this LNURL's metadata,
  // otherwise the callback could return an invoice paying anyone. Exempt:
  // addresses on our OWN lnurlp domain (ADR-240/387) — those invoices are
  // minted by this server's own code (no untrusted callback), and that endpoint
  // does not yet set description_hash (FU-844). A proxied external address is
  // still checked, because its own resolution runs through this function too.
  if (!isOwnLnurlpAddress(lnAddress)) {
    const metadataHash = ln.lnurlpData?.metadataHash ?? ''
    // FU-881: some providers (getalby.com) put a LUD-12 comment into the `d`
    // tag and drop `h` entirely. Retry once without the comment; the strict
    // check below still applies to the invoice we actually hand out, and a
    // wrong `h` is never retried.
    if (memo && !readInvoiceDescriptionHash(invoice.paymentRequest)) {
      invoice = await ln.requestInvoice({ satoshi: amountSats })
    }
    assertInvoiceMatchesLnurlMetadata(invoice.paymentRequest, metadataHash)
  }
  return {
    bolt11: invoice.paymentRequest,
    paymentHash: invoice.paymentHash,
    ...(invoice.verify ? { verifyUrl: invoice.verify } : {}),
  }
}
