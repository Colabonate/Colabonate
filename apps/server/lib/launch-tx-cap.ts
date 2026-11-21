import type { Response } from 'express'
import { recordLaunchCapReject } from './launch-readiness-metrics.js'

// ADR-252 D2 / FU-655: launch-phase per-transaction cap. The cutover runbook
// decided a per-transaction launch cap (25,000 sats originally, 210,000 since
// 2026-09-05) — until this
// module existed that decision had no enforcement anywhere in the code.
//
// Semantics of LAUNCH_MAX_TX_SATS (env + restart, same operational pattern as
// PAYMENTS_PAUSED / BETA_MODE):
//   unset / empty        → DEFAULT_LAUNCH_MAX_TX_SATS (fail-safe default)
//   positive integer     → that cap
//   "0"                  → cap disabled (explicit opt-out, e.g. dev/load-test
//                          stacks; logged loudly at boot)
//   anything else        → DEFAULT (never "no cap" by accident)
//
// This is a SERVER-side money boundary. Client hints exist only as UX.
// 210,000 sats (~145 EUR at the 2026-09-05 rate): founder decision 2026-09-05,
// replacing the original 25,000 (~17 EUR) — see ADR-252 D2 addendum. 25k left
// the seed catalog (32k–120k) unpurchasable and proved nothing about real
// trade; 210k covers real services/products, stays Lightning-routable, and
// keeps a single-incident loss in support-ticket territory.
export const DEFAULT_LAUNCH_MAX_TX_SATS = 210_000

export const LAUNCH_CAP_ERROR_CODE = 'TX_ABOVE_LAUNCH_CAP' as const

export function resolveLaunchMaxTxSats(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.LAUNCH_MAX_TX_SATS
  if (raw === undefined || raw.trim() === '') return DEFAULT_LAUNCH_MAX_TX_SATS
  if (!/^\d+$/.test(raw.trim())) return DEFAULT_LAUNCH_MAX_TX_SATS
  const parsed = Number(raw.trim())
  if (parsed === 0) return null
  if (!Number.isSafeInteger(parsed) || parsed < 0) return DEFAULT_LAUNCH_MAX_TX_SATS
  return parsed
}

export function exceedsLaunchCap(amountSats: number, cap: number | null = resolveLaunchMaxTxSats()): boolean {
  if (cap === null) return false
  if (!Number.isFinite(amountSats)) return true
  return amountSats > cap
}

// Returns true (and writes the 400 response) when the amount is above the cap —
// caller must stop handling the request when this returns true. Same contract
// as rejectCoopEscrowIfDisabled() (lib/coop-escrow-gate.ts). The body carries
// both `error` and `code` so every existing client branch style works
// (ADR-179: branch on the code, never on the message text).
export function launchCapErrorBody(amountSats: number, cap: number) {
  return {
    error: LAUNCH_CAP_ERROR_CODE,
    code: LAUNCH_CAP_ERROR_CODE,
    message: `Transactions above ${cap} sats are not available during the launch phase.`,
    capSats: cap,
    amountSats,
  }
}

export function rejectIfAboveLaunchCap(res: Response, amountSats: number, cap: number | null = resolveLaunchMaxTxSats()): boolean {
  if (cap === null || !exceedsLaunchCap(amountSats, cap)) return false
  recordLaunchCapReject() // FU-681: visible in Admin > Launch Readiness
  res.status(400).json(launchCapErrorBody(amountSats, cap))
  return true
}
