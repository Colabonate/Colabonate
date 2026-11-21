import type { Request, Response, NextFunction } from 'express'

// ADR-252 D2: mainnet-cutover kill switch. Flipping PAYMENTS_PAUSED=true (env
// + restart, same operational pattern as BETA_MODE/PAYMENT_PROVIDER) blocks
// only the routes that create NEW payment obligations — ticket creation,
// escrow phase-1/2/3 hold-invoice creation, cooperation fund-escrow. It must
// NOT be applied to release/cancel/dispute/webhook routes: in-flight escrow
// has to keep settling normally during an incident, or holds would be
// orphaned on Lightning with no way to resolve them.
export function blockIfPaymentsPaused(req: Request, res: Response, next: NextFunction): void {
  if (process.env.PAYMENTS_PAUSED === 'true' || process.env.PAYMENTS_PAUSED === '1') {
    res.status(503).json({
      error: 'PAYMENTS_PAUSED',
      message: process.env.PAYMENTS_PAUSED_REASON || 'New payments are temporarily paused. Existing orders can still be completed. Please try again shortly.',
    })
    return
  }
  next()
}
