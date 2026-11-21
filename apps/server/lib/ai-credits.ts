// ADR-384 D2/D4 — AI credit pack tiers. Recalibrated 2026-09-23 (owner choice):
//   starter  100 @ 2,600 = 26.00 sats/request
//   standard 300 @ 3,200 = 10.67 sats/request   (value / hero tier)
//   power    600 @ 7,000 = 11.67 sats/request
// DeepSeek Flash (V4.1), BTC ≈ $84,311: a heavy turn (4k in / 1.5k out) ≈ 3.6
// sats peak (1.8 off-peak); a pathological 3-tool-round peak turn ≈ 10.7 sats.
// All three tiers stay ≥ that worst-case cost (standard sits exactly at
// break-even in the extreme); the realistic / off-peak / cache-hit mix is
// comfortably profitable. Per-request is intentionally NOT strictly decreasing —
// standard is the hero tier. Overridable via AI_CREDIT_PACK_TIERS (JSON);
// revisit after a real usage audit (FU-775).

import { PLATFORM_MIN_PAYMENT_SATS } from './platformPaymentLimits.js'

export interface AiCreditTier {
  id: string
  requests: number
  priceSats: number
}

export const DEFAULT_AI_CREDIT_TIERS: readonly AiCreditTier[] = [
  { id: 'starter', requests: 100, priceSats: PLATFORM_MIN_PAYMENT_SATS },
  { id: 'standard', requests: 300, priceSats: 3200 },
  { id: 'power', requests: 600, priceSats: 7000 },
]

function isValidTier(t: unknown): t is AiCreditTier {
  if (!t || typeof t !== 'object') return false
  const { id, requests, priceSats } = t as Record<string, unknown>
  return (
    typeof id === 'string' && /^[a-z0-9_-]{1,32}$/.test(id) &&
    Number.isInteger(requests) && (requests as number) > 0 && (requests as number) <= 10_000 &&
    Number.isInteger(priceSats) && (priceSats as number) >= PLATFORM_MIN_PAYMENT_SATS && (priceSats as number) <= 10_000_000
  )
}

/** Parses AI_CREDIT_PACK_TIERS; any malformed value falls back to the defaults (never a half-valid price table). */
export function getAiCreditTiers(raw: string | undefined = process.env.AI_CREDIT_PACK_TIERS): readonly AiCreditTier[] {
  if (!raw?.trim()) return DEFAULT_AI_CREDIT_TIERS
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isValidTier)) {
      const ids = new Set(parsed.map((t) => t.id))
      if (ids.size === parsed.length) return parsed
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULT_AI_CREDIT_TIERS
}

export function findAiCreditTier(id: unknown): AiCreditTier | undefined {
  if (typeof id !== 'string') return undefined
  return getAiCreditTiers().find((t) => t.id === id)
}
