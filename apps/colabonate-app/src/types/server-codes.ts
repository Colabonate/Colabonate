// Keep in sync with TicketErrorCode in apps/server/routes/tickets.ts.
// Centralising the literals so a server rename surfaces as a single client edit;
// any missed client usage becomes a type error against TicketErrorCode.
export const TICKET_ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  WALLET_REQUIRED: 'WALLET_REQUIRED',
  TX_ABOVE_LAUNCH_CAP: 'TX_ABOVE_LAUNCH_CAP',
  SELLER_PAYMENT_NOT_CONFIGURED: 'SELLER_PAYMENT_NOT_CONFIGURED',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  FORBIDDEN: 'FORBIDDEN',
  PAYMENT_UPSTREAM_ERROR: 'PAYMENT_UPSTREAM_ERROR',
  DB_ERROR: 'DB_ERROR',
  UNKNOWN: 'UNKNOWN',
} as const
export type TicketErrorCode = keyof typeof TICKET_ERROR_CODES
