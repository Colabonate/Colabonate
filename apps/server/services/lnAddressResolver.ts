// ADR-240 D2 — mint an inbound invoice for the owner of a self-serve Lightning
// Address. This is the receiving analogue of sellerPaymentResolver.ts: the
// invoice is created on the USER'S OWN rail (external LUD-16 address or their
// connected NWC wallet). Colabonate never holds funds and never sees a key.
import type { PrismaClient } from '@prisma/client'
import { resolveLnAddressInvoice } from '../lib/lnAddressInvoice.js'
import { decrypt } from '../lib/secretbox.js'
import { isRoutableLnAddress } from './sellerPaymentResolver.js'
import { NwcClient } from './nwcClient.js'

/** Expected-shape failure that maps to an LNURL `{status:'ERROR'}` response. */
export class LnurlpError extends Error {
  constructor(public readonly reason: string) {
    super(reason)
    this.name = 'LnurlpError'
  }
}

export interface ResolvedUserInvoice {
  bolt11: string
  paymentHash: string
}

export async function resolveUserLnAddressInvoice(
  prisma: PrismaClient,
  userId: string,
  amountSats: number,
  memo: string,
): Promise<ResolvedUserInvoice> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      lnAddress: true,
      lnAddressMode: true,
      wallets: {
        where: { provider: 'NWC' },
        select: { nwcConnectionUriEnc: true, status: true },
      },
    },
  })

  if (!user?.lnAddressMode) {
    throw new LnurlpError('No Lightning Address configured for this account')
  }

  if (user.lnAddressMode === 'EXTERNAL') {
    if (!isRoutableLnAddress(user.lnAddress)) {
      // Same predicate the publish gate and PUT /api/wallet/ln-address use —
      // a synthetic `@demo.local`/`@metamask.local` placeholder is not a rail.
      throw new LnurlpError('No routable Lightning address saved — add one in Settings → Wallet')
    }
    return resolveLnAddressInvoice(user.lnAddress!, amountSats, memo)
  }

  if (user.lnAddressMode === 'NWC') {
    const uriEnc = user.wallets.find(w => w.status === 'ACTIVE')?.nwcConnectionUriEnc
      ?? user.wallets[0]?.nwcConnectionUriEnc
    if (!uriEnc) {
      throw new LnurlpError('NWC wallet not connected — connect one in Settings → Wallet')
    }
    const client = new NwcClient(decrypt(uriEnc))
    try {
      const invoice = await client.makeInvoice(amountSats, memo)
      return { bolt11: invoice.bolt11, paymentHash: invoice.paymentHash }
    } finally {
      client.close()
    }
  }

  // CASHU is reserved in the enum (FU-240-C) but not served yet.
  throw new LnurlpError('Cashu receiving is not available yet')
}
