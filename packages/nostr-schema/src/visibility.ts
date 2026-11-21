// Tiered transaction visibility — ADR-151.
//
// Every ticket is decomposed into a public Settlement Skeleton and a
// visibility-tiered Commercial Payload. The seller defines the allowed tiers
// per offer; the buyer picks one per ticket. Default is public (Tier 0).

export const VISIBILITY_TIERS = [0, 1, 2] as const
export type VisibilityTier = (typeof VISIBILITY_TIERS)[number]

export const VISIBILITY_LABELS: Record<VisibilityTier, string> = {
  0: 'PUBLIC',
  1: 'PRIVATE_PAYLOAD',
  2: 'CONFIDENTIAL',
}

export const DEFAULT_VISIBILITY: VisibilityTier = 0

export function isValidVisibilityTier(value: unknown): value is VisibilityTier {
  return typeof value === 'number' && (VISIBILITY_TIERS as readonly number[]).includes(value)
}

export function parseVisibilityTier(value: string | number | undefined): VisibilityTier {
  if (value === undefined) return DEFAULT_VISIBILITY
  const n = typeof value === 'string' ? parseInt(value, 10) : value
  if (isValidVisibilityTier(n)) return n
  return DEFAULT_VISIBILITY
}

export function isTierAllowed(tier: VisibilityTier, allowedTiers: VisibilityTier[]): boolean {
  return allowedTiers.includes(tier)
}
