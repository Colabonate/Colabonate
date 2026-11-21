import type { Request, Response } from 'express'

// ADR-255 D4: permanent kill switch for Cooperation escrow money-movement —
// POST /api/cooperations/:id/fund-escrow and .../milestones/:mid/release-
// payment call the platform's custodial payments.createInvoice() unconditionally
// (the legacy hold-invoice stack ADR-193/184/124), and unlike Offer-level
// escrow (ESCROW_ENABLED, escrow-gate.ts / FU-253-J) nothing gated that until
// this ADR — a real, previously-untracked gap against ADR-253's "no custodial
// launch, ever". Deliberately a SEPARATE flag from ESCROW_ENABLED: Offer-escrow
// (ADR-184 hold invoices) and Cooperation-escrow are different code paths with
// different rollout timelines — Cooperations' real non-custodial replacement is
// the ADR-254 ICP canister, not the same legacy stack Offer-escrow points at
// (ADR-255 Rejected Alternative A3).
//
// Unlike rejectEscrowIfDisabled(), there is no req.body opt-in flag to check —
// these two routes ARE the escrow action, not an optional toggle on a larger
// request. Default off; the Beta stack sets COOP_ESCROW_ENABLED=1 explicitly
// (docker-compose.beta.yml) so Cooperation testing via Demo-Wallet is unaffected.
export function isCoopEscrowEnabled(): boolean {
  return process.env.COOP_ESCROW_ENABLED === 'true' || process.env.COOP_ESCROW_ENABLED === '1'
}

// Returns true (and writes the 403 response) if the gate is closed — caller
// must stop handling the request when this returns true.
export function rejectCoopEscrowIfDisabled(req: Request, res: Response): boolean {
  if (!isCoopEscrowEnabled()) {
    res.status(403).json({
      error: 'COOP_ESCROW_DISABLED',
      message: 'Cooperation escrow is currently unavailable.',
    })
    return true
  }
  return false
}
