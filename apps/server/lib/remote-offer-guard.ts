import { resolvePurchasePath } from '@col/nostr-schema'

// ADR-415: remote offers have no seller payment rail with Colabonate. Refuse them early and
// explicitly instead of letting ticket creation fail with an opaque downstream error.
export interface RemoteOfferGuardBody {
  error: string
  code: 'BAD_REQUEST'
  reason: 'REMOTE_OFFER_NOT_ORDERABLE'
  purchasePath: string
  externalUrl?: string
}

export interface RemoteOfferGuardBlock {
  status: 400
  body: RemoteOfferGuardBody
}

const REMOTE_NOT_ORDERABLE_ERROR =
  'This listing was published on another Nostr marketplace and cannot be ordered through Colabonate yet. Use the link on the offer page to order at the merchant.'

export function remoteOfferPurchaseBlock(offer: {
  source?: string | null
  priceCurrency?: string | null
  originUrl?: string | null
}): RemoteOfferGuardBlock | null {
  const result = resolvePurchasePath(offer)
  if (result.path === 'in-app-native') return null

  const body: RemoteOfferGuardBody = {
    error: REMOTE_NOT_ORDERABLE_ERROR,
    code: 'BAD_REQUEST',
    reason: 'REMOTE_OFFER_NOT_ORDERABLE',
    purchasePath: result.path,
  }
  if (result.externalUrl !== undefined) body.externalUrl = result.externalUrl
  return { status: 400, body }
}
