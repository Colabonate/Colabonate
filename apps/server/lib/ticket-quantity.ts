/**
 * ADR-394: server-authoritative purchase quantity.
 *
 * The cart has always carried a `quantity` (with +/- steppers and a stock
 * cap) and displayed `priceSats × quantity` as the total, but the checkout
 * payload never sent it — a quantity-3 line created a single 1-unit ticket at
 * the unit price. This helper centralises the validation and the total so the
 * route (and its tests) cannot drift: `amountSats` is always
 * `unitPriceSats × quantity + shippingSats`, never trusted from the client.
 */
export interface TicketQuantityInput {
  /** Raw `quantity` from the request body (undefined/null ⇒ 1). */
  rawQuantity: unknown
  /** Offer unit price in sats. */
  unitPriceSats: number
  /** Offer stock; null/undefined ⇒ unlimited. */
  stock: number | null | undefined
  /** Shipping charged once per ticket (see resolveShippingSats). Default 0. */
  shippingSats?: number
}

export type TicketQuantityResult =
  | { ok: true; quantity: number; amountSats: number; shippingSats: number }
  | { ok: false; reason: 'INVALID_QUANTITY' }
  | { ok: false; reason: 'INSUFFICIENT_STOCK'; availableStock: number }

/**
 * ADR-394 FU-840: a cart checkout groups its tickets under one random,
 * client-generated key (e.g. crypto.randomUUID()). Deliberately not an `Order`
 * table: a separate row keyed by buyerPubkey would be a new PII link the GDPR
 * anonymisation (ADR-156) would have to chase; a random key on the ticket
 * carries no identity and is anonymised together with the ticket.
 */
export function isValidCheckoutId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(value)
}

/** Hard ceiling for one ticket, independent of `stock` (unlimited offers). */
export const MAX_TICKET_QUANTITY = 1000
/** `Ticket.amountSats` is a Postgres INT4 column. */
const MAX_AMOUNT_SATS = 2_147_483_647

function parseQuantity(raw: unknown): number {
  if (raw === undefined || raw === null) return 1
  // Only a JSON number or a plain digit string — `Number()` alone would also
  // coerce `true`, `[3]` or `' 2 '` into valid-looking quantities.
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw)
  return NaN
}

/**
 * ADR-394 (FU-842): shipping is charged once per ticket, derived from the
 * OFFER (never from the request body), and only for physical goods — ITEM or
 * PRODUCT whose `physicalType` is not `digital`. Services, agent setups and
 * cooperation listings never ship.
 */
export function resolveShippingSats(offer: {
  offerType: string | null | undefined
  physicalType?: string | null
  deliveryCostSats?: number | null
}): number {
  if (offer.offerType !== 'ITEM' && offer.offerType !== 'PRODUCT') return 0
  if (offer.physicalType === 'digital') return 0
  const cost = offer.deliveryCostSats ?? 0
  return Number.isInteger(cost) && cost > 0 ? cost : 0
}

export function resolveTicketQuantity({
  rawQuantity,
  unitPriceSats,
  stock,
  shippingSats = 0,
}: TicketQuantityInput): TicketQuantityResult {
  const quantity = parseQuantity(rawQuantity)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_TICKET_QUANTITY) {
    return { ok: false, reason: 'INVALID_QUANTITY' }
  }
  if (stock != null && quantity > stock) {
    return { ok: false, reason: 'INSUFFICIENT_STOCK', availableStock: stock }
  }
  const amountSats = unitPriceSats * quantity + shippingSats
  // The launch cap normally rejects far below this, but it can be disabled
  // (LAUNCH_MAX_TX_SATS=0) — never let an oversized total reach the DB as a 500.
  if (amountSats > MAX_AMOUNT_SATS) {
    return { ok: false, reason: 'INVALID_QUANTITY' }
  }
  return { ok: true, quantity, amountSats, shippingSats }
}
