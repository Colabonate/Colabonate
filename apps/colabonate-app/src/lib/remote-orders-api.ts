import { apiCall, ApiError } from './api'
import type { ZapTemplate } from './zap-request'
import type { VerifiedEvent } from 'nostr-tools'

/** ADR-417 API contract: client types for /api/remote-orders. */
export type RemoteOrderReason =
  | 'NOT_REMOTE'
  | 'OFFER_NOT_ACTIVE'
  | 'NO_PAYEE'
  | 'NO_LIGHTNING_ADDRESS'
  | 'LNURL_UNREACHABLE'
  | 'PRICE_NOT_CONVERTIBLE'
  | 'AMOUNT_OUT_OF_RANGE'
  | 'ABOVE_LAUNCH_CAP'

export interface RemotePayee {
  pubkey: string
  role: 'seller' | 'author'
  name?: string
  lud16: string
  zap: boolean
  minSats: number
  maxSats: number
}

export interface RemoteQuote {
  amountSats: number
  basis: 'sats' | 'exact-btc' | 'rate' | 'stablecoin-as-usd'
  priceAmount?: string
  priceCurrency?: string
  quantity: number
}

export interface RemoteOrderView {
  id: string
  offerId: string
  quantity: number
  status: 'QUOTED' | 'INVOICED' | 'PAID' | 'EXPIRED' | 'FAILED'
  payee: RemotePayee
  amountSats: number
  quoteExpiresAt: string
  bolt11?: string
  paymentHash?: string
  invoiceExpiresAt?: string
  paidAt?: string
  createdAt: string
}

export interface RemotePayeeResponse {
  orderable: boolean
  reason?: RemoteOrderReason
  payee?: RemotePayee
  quote?: RemoteQuote
}

export interface CreateRemoteOrderResponse {
  order: RemoteOrderView
  zapRequestTemplate?: ZapTemplate
}

export interface RemoteInvoiceResponse {
  bolt11: string
  paymentHash: string
  expiresAt?: string
  order: RemoteOrderView
}

const FALLBACK_ERROR_MESSAGE = 'Something went wrong, please try again.'

export async function fetchRemotePayee(offerId: string, quantity = 1): Promise<RemotePayeeResponse> {
  const res = await apiCall(`/api/remote-orders/payee/${encodeURIComponent(offerId)}?quantity=${quantity}`)
  return res.json()
}

export async function createRemoteOrder(offerId: string, quantity = 1): Promise<CreateRemoteOrderResponse> {
  const res = await apiCall('/api/remote-orders', {
    method: 'POST',
    body: JSON.stringify({ offerId, quantity }),
  })
  return res.json()
}

export async function requestRemoteInvoice(orderId: string, zapRequest?: VerifiedEvent): Promise<RemoteInvoiceResponse> {
  const body = zapRequest === undefined ? {} : { zapRequest }
  const res = await apiCall(`/api/remote-orders/${encodeURIComponent(orderId)}/invoice`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return res.json()
}

export async function confirmRemoteOrder(orderId: string, preimage: string): Promise<{ order: RemoteOrderView }> {
  const res = await apiCall(`/api/remote-orders/${encodeURIComponent(orderId)}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ preimage }),
  })
  return res.json()
}

export async function fetchRemoteOrder(orderId: string): Promise<{ order: RemoteOrderView }> {
  const res = await apiCall(`/api/remote-orders/${encodeURIComponent(orderId)}`)
  return res.json()
}

export async function fetchMyRemoteOrders(offerId?: string): Promise<{ orders: RemoteOrderView[] }> {
  const query = offerId ? `?offerId=${encodeURIComponent(offerId)}` : ''
  const res = await apiCall(`/api/remote-orders${query}`)
  return res.json()
}

function errorData(err: unknown): Record<string, unknown> | null {
  if (!(err instanceof ApiError)) return null
  return err.data && typeof err.data === 'object' ? (err.data as Record<string, unknown>) : null
}

/** Server error code (`code`, else `error`) from an ApiError; null otherwise. */
export function remoteOrderErrorCode(err: unknown): string | null {
  const data = errorData(err)
  if (!data) return null
  if (typeof data.code === 'string' && data.code) return data.code
  if (typeof data.error === 'string' && data.error) return data.error
  return null
}

const CODE_MESSAGES: Record<string, string> = {
  OFFER_NOT_FOUND: 'This listing is no longer available.',
  NOT_REMOTE: 'This listing cannot be paid this way.',
  QUOTE_EXPIRED: 'The amount expired. Start again to get a new amount.',
  ZAP_REQUEST_INVALID: 'Your wallet signature could not be used. Please try again.',
  INVALID_STATE: 'This payment can no longer continue. Start again.',
  PREIMAGE_MISMATCH: 'That payment proof does not match this invoice.',
  UPSTREAM_ERROR: "The seller's Lightning provider did not answer. Please try again later.",
  FORBIDDEN: 'This payment belongs to another account.',
  UNAUTHORIZED: 'Please sign in to continue.',
  BAD_REQUEST: 'The request was not valid. Please try again.',
  INTERNAL_ERROR: FALLBACK_ERROR_MESSAGE,
}

const NOT_ORDERABLE_MESSAGES: Record<string, string> = {
  NOT_REMOTE: 'This listing cannot be paid this way.',
  OFFER_NOT_ACTIVE: 'This listing is no longer active.',
  NO_PAYEE: 'The seller cannot be paid over Lightning from here.',
  NO_LIGHTNING_ADDRESS: 'The seller has no Lightning address.',
  LNURL_UNREACHABLE: "The seller's Lightning address is not reachable right now.",
  PRICE_NOT_CONVERTIBLE: 'The price cannot be converted to sats right now.',
  AMOUNT_OUT_OF_RANGE: "The amount is outside what the seller's wallet accepts.",
  ABOVE_LAUNCH_CAP: 'This amount is above the current per-payment limit.',
}

/** Server codes are SCREAMING_SNAKE; such a value is never shown to a person. */
const CODE_SHAPED = /^[A-Z][A-Z0-9_]*$/

/**
 * Best human-readable message from an ApiError, else a generic fallback. The server sends
 * `{ error: CODE, code: CODE }` without a text, so codes are mapped here and never shown raw.
 */
export function remoteOrderErrorMessage(err: unknown): string {
  const data = errorData(err)
  if (data && typeof data.message === 'string' && data.message && !CODE_SHAPED.test(data.message)) {
    return data.message
  }
  const code = remoteOrderErrorCode(err)
  if (code === 'NOT_ORDERABLE') {
    const reason = data && typeof data.reason === 'string' ? data.reason : ''
    return NOT_ORDERABLE_MESSAGES[reason] ?? 'This listing cannot be paid this way.'
  }
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code]
  if (data && typeof data.error === 'string' && data.error && !CODE_SHAPED.test(data.error)) return data.error
  if (err instanceof ApiError && err.message && !CODE_SHAPED.test(err.message)) return err.message
  return FALLBACK_ERROR_MESSAGE
}
