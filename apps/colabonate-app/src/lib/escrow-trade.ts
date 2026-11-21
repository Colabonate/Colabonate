import { apiCall } from './api'
import type { EscrowAuthEventWire } from './escrow-auth-events'

// ADR-362: client-side types + fetch helpers for the escrow trade surface.
// The server mirror is a cache; the canister is the source of truth. The
// detail endpoint returns the mirror + a fresh (uncertified until FU-619)
// canister read + a drift flag — never silently reconciled.

export type EscrowTradeState =
  | 'PENDING_FUNDING'
  | 'FUNDED'
  | 'RELEASED'
  | 'REFUNDED'
  | 'DISPUTED'
  | 'DISPUTE_SETTLED'

export interface EscrowMilestone {
  pctBps: number
  released: boolean
}

/** Frozen identity/contact snapshot for a party (ADR-357 D2 + dispute position). */
export interface EscrowIdentitySnapshot {
  name: string | null
  nip05: string | null
  picture: string | null
  banner: string | null
  lnAddress: string | null
  about: string | null
  capturedAt: string
}

export interface EscrowTrade {
  id: string
  canisterTradeId: string
  canisterId: string
  network: string
  btcAddress: string
  buyerPubkey: string
  sellerPubkey: string
  buyerRefundAddress: string
  sellerPayoutAddress: string
  expectedAmountSats: number
  milestones: EscrowMilestone[]
  state: EscrowTradeState
  settledBuyerBps: number | null
  settledSellerBps: number | null
  timeoutAt: string | null
  fundedAt: string | null
  tradeTermsHash: string | null
  moduleHashAtCreation: string | null
  ticketId: string | null
  cooperationId: string | null
  endToEndId: string | null
  buyerIdentitySnapshot: EscrowIdentitySnapshot | null
  sellerIdentitySnapshot: EscrowIdentitySnapshot | null
  createdAt: string
  updatedAt: string
}

export type EscrowTradeEventKind = 'STATE_TRANSITION' | 'CANISTER_CALL' | 'CHAIN_OBSERVATION' | 'DRIFT_DETECTED'

export interface EscrowTradeEvent {
  id: string
  tradeId: string
  kind: EscrowTradeEventKind
  detail: unknown
  message: string | null
  createdAt: string
}

export interface EscrowTradeDetail {
  trade: EscrowTrade
  canisterState: EscrowTradeState | null
  drift: boolean
  events: EscrowTradeEvent[]
}

export async function fetchEscrowTrades(limit = 50): Promise<EscrowTrade[]> {
  const res = await apiCall(`/api/escrow-trades?limit=${limit}`)
  const data = (await res.json()) as { trades: EscrowTrade[] }
  return data.trades
}

export async function fetchEscrowTrade(id: string): Promise<EscrowTradeDetail> {
  const res = await apiCall(`/api/escrow-trades/${id}`)
  return res.json() as Promise<EscrowTradeDetail>
}

/** nat64 nanoseconds-since-epoch (canister `ic_cdk::api::time()`) → JS Date. */
export function nanosToDate(ns: string): Date {
  return new Date(Number(BigInt(ns) / 1_000_000n))
}

export function shortPubkey(pubkey: string): string {
  return pubkey.length <= 16 ? pubkey : `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}`
}

/** The counterparty pubkey relative to the viewing party. */
export function counterpartyOf(trade: Pick<EscrowTrade, 'buyerPubkey' | 'sellerPubkey'>, viewerPubkey: string | null): string {
  if (viewerPubkey && trade.sellerPubkey === viewerPubkey) return trade.buyerPubkey
  return trade.sellerPubkey
}

// ── Mutations (ADR-362 D5) ──────────────────────────────────────────────────
// Every money-moving call relays a signature the CLIENT produced; the server
// never signs (ADR-254 §2). apiCall throws ApiError with the server's message
// (human-readable) so callers surface it directly.

export interface CreateEscrowTradeInput {
  expectedAmountSats: number
  buyerRefundAddress: string
  sellerPayoutAddress: string
  buyerPubkey: string
  sellerPubkey: string
  milestoneBps: number[]
  timeoutAt: string
  buyerTermsEvent: EscrowAuthEventWire
  sellerTermsEvent: EscrowAuthEventWire
  ticketId?: string | null
  cooperationId?: string | null
}

export async function createEscrowTrade(input: CreateEscrowTradeInput): Promise<EscrowTrade> {
  const res = await apiCall('/api/escrow-trades', { method: 'POST', body: JSON.stringify(input) })
  const data = (await res.json()) as { trade: EscrowTrade }
  return data.trade
}

export async function checkEscrowTradeFunding(id: string): Promise<{ state: EscrowTradeState }> {
  const res = await apiCall(`/api/escrow-trades/${id}/check-funding`, { method: 'POST', body: '{}' })
  return res.json() as Promise<{ state: EscrowTradeState }>
}

export async function releaseEscrowMilestone(id: string, milestoneIndex: number, event: EscrowAuthEventWire): Promise<{ state: EscrowTradeState }> {
  const res = await apiCall(`/api/escrow-trades/${id}/release`, { method: 'POST', body: JSON.stringify({ milestoneIndex, event }) })
  return res.json() as Promise<{ state: EscrowTradeState }>
}

export async function openEscrowDispute(id: string, event: EscrowAuthEventWire): Promise<{ state: EscrowTradeState }> {
  const res = await apiCall(`/api/escrow-trades/${id}/dispute`, { method: 'POST', body: JSON.stringify({ event }) })
  return res.json() as Promise<{ state: EscrowTradeState }>
}

export async function claimEscrowTimeoutRefund(id: string): Promise<{ state: EscrowTradeState }> {
  const res = await apiCall(`/api/escrow-trades/${id}/timeout-refund`, { method: 'POST', body: '{}' })
  return res.json() as Promise<{ state: EscrowTradeState }>
}
