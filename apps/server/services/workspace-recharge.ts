// FU-433 (ADR-311 D3): sats ↔ cycles conversion + amount validation for the
// workspace cycle-reload flow (`POST /api/workspaces/:id/recharge`). Pure
// functions — unit-tested without a replica.

// Policy placeholder (V1): 1 sat = 1M cycles. Not derived from live ICP
// pricing — it fixes a stable, reviewable exchange rate for the beta. At
// this rate 1_000 sats buy 1e9 cycles, roughly one canister HTTPS outcall,
// so a recharge in the low-thousand-sats range maps to a handful of agent
// actions. Revisit against real cycle costs before mainnet.
export const CYCLES_PER_SAT = 1_000_000n

// Abuse/overflow guard: a single recharge is capped at 100M sats (1 BTC).
export const MAX_RECHARGE_SATS = 100_000_000

export function satsToCycles(amountSats: number): bigint {
  return BigInt(amountSats) * CYCLES_PER_SAT
}

// FU-376 (revised 2026-08-29 — corrects the original "Foundation-subsidized
// free quota" premise of ADR-315 D4): there is no subsidy. The Initiator
// (the ticket's buyer) always pre-funds a mandatory minimum at workspace
// initiation, sized to the seller-declared Offer.estimatedWorkspaceHours
// plus a 30% buffer — never a free credit from nowhere.
//
// The hours→sats conversion reuses this file's own documented anchor
// above ("~1000 sats ≈ one HTTPS outcall") and an assumed ~15 outcalls/hour
// for a typical interactive agent session — an estimate, not a measurement.
// Revisit once FU-580's real cost audit lands.
const ASSUMED_OUTCALLS_PER_HOUR = 15
const SATS_PER_OUTCALL = 1_000
const SATS_PER_ESTIMATED_HOUR = ASSUMED_OUTCALLS_PER_HOUR * SATS_PER_OUTCALL

// Explicit founder decision: the mandatory minimum is the declared duration
// plus a 30% margin for overrun, not the bare estimate.
export const MANDATORY_FUNDING_BUFFER_MULTIPLIER = 1.3

// Safety net only for offers created before Offer.estimatedWorkspaceHours
// existed (never declared) — not a policy default meant to be relied upon
// going forward. New Agent-Setup offers are expected to declare a real value.
export const DEFAULT_ESTIMATED_HOURS_FALLBACK = 1

// Returns the mandatory minimum sats a buyer must pay at workspace
// initiation, given the seller's declared estimated work duration in hours.
export function computeMandatoryInitialFundingSats(estimatedHours: number): number {
  const hours = estimatedHours > 0 ? estimatedHours : DEFAULT_ESTIMATED_HOURS_FALLBACK
  return Math.ceil(hours * SATS_PER_ESTIMATED_HOUR * MANDATORY_FUNDING_BUFFER_MULTIPLIER)
}

// Returns the validated amount or null. Integer sats only, 1..MAX_RECHARGE_SATS.
export function validateRechargeAmount(amountSats: unknown): number | null {
  if (typeof amountSats !== 'number' || !Number.isInteger(amountSats)) return null
  if (amountSats <= 0 || amountSats > MAX_RECHARGE_SATS) return null
  return amountSats
}
