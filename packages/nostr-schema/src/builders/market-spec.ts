// Market-spec Kind 16/17 tag builders for co-emission (ADR-154).
//
// Builds tags for Gamma-compatible order (Kind 16) and payment receipt (Kind 17)
// events. Uses the status vocabulary bridge (ADR-153) for lowercase mapping.
// Vocabulary aligned per ADR-143.

import { toMarketSpecStatus } from '../status-bridge.js'

export interface MarketSpecOrderInput {
  ticketId: string
  status: string
  sellerPubkey: string
  buyerPubkey: string
  offerId?: string
  amountSats?: number
  subject?: string
}

export interface MarketSpecReceiptInput {
  ticketId: string
  sellerPubkey: string
  buyerPubkey: string
  paymentType?: string
  proof: string
  amountSats?: number
  unit?: string
}

export function buildMarketSpecOrderTags(input: MarketSpecOrderInput): string[][] | null {
  const lowerStatus = toMarketSpecStatus(input.status)
  if (!lowerStatus) return null

  const tags: string[][] = [
    ['order', input.ticketId],
    ['status', lowerStatus],
    ['p', input.sellerPubkey],
    ['subject', input.subject ?? 'order-info'],
  ]

  if (input.offerId) {
    tags.push(['a', `30402:${input.sellerPubkey}:${input.offerId}`])
    tags.push(['item', `30402:${input.sellerPubkey}:${input.offerId}`, '1'])
  }

  if (input.amountSats != null) {
    tags.push(['amount', String(input.amountSats), 'sat'])
  }

  return tags
}

export function buildMarketSpecReceiptTags(input: MarketSpecReceiptInput): string[][] {
  const tags: string[][] = [
    ['order', input.ticketId],
    ['payment', input.paymentType ?? 'lightning', input.proof],
    ['p', input.sellerPubkey],
    ['subject', 'order-payment'],
  ]

  if (input.amountSats != null) {
    tags.push(['amount', String(input.amountSats), input.unit ?? 'sat'])
  }

  return tags
}
