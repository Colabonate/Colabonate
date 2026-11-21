// ADR-253 ("no custodial launch, ever") / Product-Launch Sub-Plan 01 §1.3.
// Pure boot-time predicate: on a real production host, neither custodial
// escrow flag may be on. Beta is deliberately exempt — it runs
// NODE_ENV=production too, but opts in explicitly via BETA_MODE=true +
// BETA_MODE_ALLOW_PRODUCTION=true (the same pair betaMode.ts already
// requires) and sets COOP_ESCROW_ENABLED=1 on purpose for Demo-Wallet
// Cooperation testing. A host that is NODE_ENV=production and NOT a
// declared beta deployment must never have either flag on — that combination
// means custodial money-movement code (ADR-193/184/124, the legacy
// hold-invoice stack) would run against real funds with no non-custodial
// replacement wired in (Stage 2 is the ICP canister, ADR-254, not this path).
export interface ProductionEscrowGuardInput {
  nodeEnv: string | undefined
  isBetaMode: boolean
  escrowEnabled: boolean
  coopEscrowEnabled: boolean
}

export interface ProductionEscrowViolation {
  violatingFlags: string[]
  message: string
}

export function checkProductionEscrowGuard(input: ProductionEscrowGuardInput): ProductionEscrowViolation | null {
  if (input.nodeEnv !== 'production' || input.isBetaMode) return null

  const violatingFlags: string[] = []
  if (input.escrowEnabled) violatingFlags.push('ESCROW_ENABLED')
  if (input.coopEscrowEnabled) violatingFlags.push('COOP_ESCROW_ENABLED')
  if (violatingFlags.length === 0) return null

  return {
    violatingFlags,
    message:
      `Refusing to start: ${violatingFlags.join(' and ')} is set on a NODE_ENV=production host that is not a ` +
      'declared beta deployment (BETA_MODE=true + BETA_MODE_ALLOW_PRODUCTION=true). ADR-253: no custodial launch, ' +
      'ever. Unset the flag, or if this genuinely is the beta stack, set BETA_MODE=true and BETA_MODE_ALLOW_PRODUCTION=true.',
  }
}
