import type { Request, Response } from 'express'

// ADR-253 FU-253-J: permanent, PAYMENTS_PAUSED-independent kill switch for the
// custodial hold-invoice escrow path (ADR-193/184/124). ADR-253 v3 mandates
// this stack stay in the codebase behind a flag but never go public — before
// this gate, `useEscrow` was read unvalidated from the request body in
// routes/catalog.ts and index.ts, so anyone hitting offer-creation could set
// `useEscrow: true` in production with nothing stopping it.
//
// Unlike PAYMENTS_PAUSED (an all-or-nothing incident switch for every new
// payment), this only rejects the escrow opt-in specifically; direct-pay
// offer creation is unaffected. CI's `escrow-load-test` job sets
// ESCROW_ENABLED=1 so the legacy path keeps being exercised (FU-253-K) —
// production must never set it.
export function isEscrowEnabled(): boolean {
  return process.env.ESCROW_ENABLED === 'true' || process.env.ESCROW_ENABLED === '1'
}

// Returns true (and writes the 403 response) if the request tried to opt in
// to escrow while the gate is closed — caller must stop handling the request
// when this returns true.
export function rejectEscrowIfDisabled(req: Request, res: Response): boolean {
  if (req.body?.useEscrow && !isEscrowEnabled()) {
    res.status(403).json({
      error: 'ESCROW_DISABLED',
      message: 'Escrow is currently unavailable. Please create the offer without the escrow option.',
    })
    return true
  }
  return false
}
