// ADR-384 D11 — MCP access monetization: a one-time 30 minute trial, then paid
// passes direct to Colabonate (same non-custodial rail as the AI credit packs).
// ADR-410 (2026-09-29, owner) replaces the Day/Week/Month ladder with a single
// `lifetime` tier at the lowest tier price — one payment, never expires, framed
// as supporting Colabonate's development and the open protocol. The pre-switch
// ladder stays resolvable (LEGACY_MCP_PASS_TIERS) so existing rows — pending
// purchases confirming after the switch, admin grants by tier label — never
// break; legacy ids are never sold. `MCP_PASS_TIERS` still overrides the sale
// ladder for self-hosters (a dated ladder stays expressible); the real
// infra/cost audit stays FU-786, re-scoped by ADR-410's supporter economics.
import type { Prisma } from '@prisma/client'
import { isBetaMode } from '../services/betaMode.js'
import { PLATFORM_MIN_PAYMENT_SATS } from './platformPaymentLimits.js'

export const MCP_TRIAL_MS = 30 * 60 * 1000

export const LIFETIME_TIER_ID = 'lifetime'

/** Default bounded connection TTL for lifetime pass holders (ADR-410 D3). */
const DEFAULT_LIFETIME_CONNECTION_TTL_MS = 366 * 24 * 3600_000

export interface McpPassTier {
  id: string
  /** null = lifetime: the pass never expires. */
  hours: number | null
  priceSats: number
  /** Frozen pre-ADR-410 tiers are resolvable but never offered for sale. */
  legacy?: true
}

export const DEFAULT_MCP_PASS_TIERS: readonly McpPassTier[] = [
  { id: LIFETIME_TIER_ID, hours: null, priceSats: PLATFORM_MIN_PAYMENT_SATS },
]

/** ADR-410 D4 — the frozen Day/Week/Month ladder (2026-09-23 calibration). */
export const LEGACY_MCP_PASS_TIERS: readonly McpPassTier[] = [
  { id: 'day', hours: 24, priceSats: PLATFORM_MIN_PAYMENT_SATS, legacy: true },
  { id: 'week', hours: 24 * 7, priceSats: 7000, legacy: true },
  { id: 'month', hours: 24 * 30, priceSats: 21000, legacy: true },
]

function isValidTier(t: unknown): t is McpPassTier {
  if (!t || typeof t !== 'object') return false
  const { id, hours, priceSats } = t as Record<string, unknown>
  const hoursOk = hours === null || (Number.isInteger(hours) && (hours as number) > 0 && (hours as number) <= 24 * 366)
  return (
    typeof id === 'string' && /^[a-z0-9_-]{1,32}$/.test(id) &&
    hoursOk &&
    Number.isInteger(priceSats) && (priceSats as number) >= PLATFORM_MIN_PAYMENT_SATS && (priceSats as number) <= 10_000_000
  )
}

/** Parses MCP_PASS_TIERS; any malformed value falls back to the defaults. */
export function getMcpPassTiers(raw: string | undefined = process.env.MCP_PASS_TIERS): readonly McpPassTier[] {
  if (!raw?.trim()) return DEFAULT_MCP_PASS_TIERS
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(isValidTier) && new Set(parsed.map((t) => t.id)).size === parsed.length) {
      return parsed
    }
  } catch {
    // fall through
  }
  return DEFAULT_MCP_PASS_TIERS
}

/** Sale tiers only (purchase route): legacy ids are deliberately not findable here. */
export function findMcpPassTier(id: unknown): McpPassTier | undefined {
  return typeof id === 'string' ? getMcpPassTiers().find((t) => t.id === id) : undefined
}

/**
 * ADR-410 D4 — resolves sale tiers ∪ frozen legacy tiers. Used wherever an
 * existing row's tier id must resolve: pass confirmation (a pending Day/Week/
 * Month purchase minted before the switch must still confirm, never 500) and
 * admin grants by tier label.
 */
export function findAnyMcpPassTier(id: unknown): McpPassTier | undefined {
  if (typeof id !== 'string') return undefined
  return findMcpPassTier(id) ?? LEGACY_MCP_PASS_TIERS.find((t) => t.id === id)
}

/**
 * Passes extend rather than overlap: buying while one is active starts the new
 * period when the current one ends, so nobody loses paid time. Lifetime tiers
 * never call this — their expiry is null by construction.
 */
export function computePassExpiry(now: Date, currentActiveExpiry: Date | null, hours: number): Date {
  const start = currentActiveExpiry && currentActiveExpiry > now ? currentActiveExpiry : now
  return new Date(start.getTime() + hours * 3600_000)
}

/**
 * ADR-410 D3 — no never-expiring bearer tokens: lifetime pass holders mint
 * connections with a long but bounded TTL instead of pass-expiry-minus-now.
 * Clamp 1 hour .. 5 years so a typo'd env cannot mint seconds- or decades-long
 * credentials.
 */
export function mcpLifetimeConnectionTtlMs(): number {
  const raw = Number(process.env.MCP_LIFETIME_CONNECTION_TTL_MS)
  const min = 3600_000
  const max = 5 * 366 * 24 * 3600_000
  if (Number.isFinite(raw)) return Math.min(Math.max(Math.trunc(raw), min), max)
  return DEFAULT_LIFETIME_CONNECTION_TTL_MS
}

/** ADR-410 D2 — lifetime rows (expiresAt null) count as active. */
export function activeMcpPassWhere(extra: Prisma.McpAccessPassWhereInput = {}): Prisma.McpAccessPassWhereInput {
  return { status: 'PAID', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], ...extra }
}

/**
 * ADR-410 D2 — lifetime wins over dated: Postgres sorts NULLS FIRST on DESC by
 * default, but Prisma does not promise that ordering across drivers, so the
 * nulls placement is pinned explicitly.
 */
export const ACTIVE_MCP_PASS_ORDER: Prisma.McpAccessPassOrderByWithRelationInput[] = [
  { expiresAt: { sort: 'desc', nulls: 'first' } },
]

/**
 * The paywall only applies where a user can actually pay: a Beta stack (DEMO
 * rail) or a production stack with ANY platform receiving rail — the hub
 * (PLATFORM_NWC_URI, ADR-387 preferred) or the external address
 * (PLATFORM_LN_ADDRESS). Otherwise the legacy free 24 h connection stays, so
 * nobody is locked out of MCP access they have no way to buy.
 * MCP_PAYWALL_ENABLED=false switches it off explicitly.
 */
export function mcpPaywallActive(): boolean {
  if (process.env.MCP_PAYWALL_ENABLED === 'false') return false
  return (
    isBetaMode() ||
    Boolean(process.env.PLATFORM_NWC_URI?.trim() || process.env.PLATFORM_LN_ADDRESS?.trim())
  )
}
