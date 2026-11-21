import type { TicketStatus } from './status.js'

export type MarketSpecStatus = 'pending' | 'confirmed' | 'processing' | 'completed' | 'cancelled'

const UPPER_TO_MARKET: ReadonlyMap<TicketStatus, MarketSpecStatus> = new Map([
  ['PENDING', 'pending'],
  ['ACCEPTED', 'confirmed'],
  ['PAID', 'processing'],
  ['IN_PROGRESS', 'processing'],
  ['COMPLETED', 'completed'],
  ['CANCELLED', 'cancelled'],
])

const MARKET_TO_UPPER: ReadonlyMap<string, TicketStatus> = new Map([
  ['pending', 'PENDING'],
  ['confirmed', 'ACCEPTED'],
  ['processing', 'IN_PROGRESS'],
  ['completed', 'COMPLETED'],
  ['cancelled', 'CANCELLED'],
])

export function toMarketSpecStatus(upper: string): MarketSpecStatus | null {
  return UPPER_TO_MARKET.get(upper as TicketStatus) ?? null
}

export function fromMarketSpecStatus(lower: string): TicketStatus | null {
  return MARKET_TO_UPPER.get(lower) ?? null
}
