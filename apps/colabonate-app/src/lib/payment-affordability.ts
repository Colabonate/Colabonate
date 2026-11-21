/**
 * ADR-413 D3: can the connected wallet actually cover a payment?
 *
 * The platform only knows a balance for the rails it syncs itself (custodial
 * providers, Alby OAuth, NWC). A WebLN extension keeps its balance private —
 * the honest answer there is "unknown", never "0 sats". A check that reports a
 * fake zero would block paying buyers who do have funds, so the rail decides
 * whether a balance claim is made at all.
 */

import { formatLocaleNumber } from '../contexts/LocaleContext'

export interface WalletBalanceLike {
  provider?: string | null
  balanceSats?: number | null
  balance?: { confirmedSats?: number | null } | null
  lastSyncedAt?: string | null
}

/** Rails whose balance the platform reads itself (server-side sync). */
export const BALANCE_KNOWN_PROVIDERS = ['LNBITS', 'LIGHTSPARK', 'MOCK', 'ALBY_OAUTH', 'NWC']

/**
 * A synced balance older than this is not trusted for a hard block — the buyer
 * may have topped up in another tab since. It still drives a warning.
 */
export const BALANCE_FRESH_WINDOW_MS = 2 * 60_000

export interface AffordabilityCheck {
  /** False when the rail does not expose a platform-known balance (WebLN). */
  known: boolean
  /** True when the known balance was synced within the freshness window. */
  fresh: boolean
  balanceSats: number
  requiredSats: number
  sufficient: boolean
  shortfallSats: number
  provider?: string | null
}

/**
 * @param wallet the active wallet row (null when the account has none)
 * @param requiredSats the amount the payment needs (price + fee)
 */
export function checkAffordability(
  wallet: WalletBalanceLike | null | undefined,
  requiredSats: number,
  now: number = Date.now(),
): AffordabilityCheck {
  const required = Math.max(0, Math.round(requiredSats || 0))
  const provider = wallet?.provider ?? null
  const known = Boolean(wallet) && BALANCE_KNOWN_PROVIDERS.includes(provider ?? '')
  const balanceSats = known ? Math.max(0, Math.round(wallet?.balance?.confirmedSats ?? wallet?.balanceSats ?? 0)) : 0
  const lastSynced = wallet?.lastSyncedAt ? Date.parse(wallet.lastSyncedAt) : NaN
  const fresh = known && Number.isFinite(lastSynced) && now - lastSynced <= BALANCE_FRESH_WINDOW_MS
  const sufficient = known ? balanceSats >= required : true

  return {
    known,
    fresh,
    balanceSats,
    requiredSats: required,
    sufficient,
    shortfallSats: sufficient ? 0 : Math.max(0, required - balanceSats),
    provider,
  }
}

/**
 * Wallet error strings differ per provider ("insufficient balance",
 * "not enough funds", "Could not pay"). All of them mean the same thing for
 * the buyer: the wallet cannot cover this payment right now.
 */
export function isInsufficientFundsError(message: string | undefined | null): boolean {
  if (!message) return false
  return /insufficient|not enough funds|balance (is )?too low|could not pay/i.test(message)
}

/** Buyer-facing shortfall message with the exact numbers. */
export function shortfallMessage(check: AffordabilityCheck, subject = 'This payment'): string {
  const balance = `${formatLocaleNumber(check.balanceSats)} sats`
  const need = `${formatLocaleNumber(check.requiredSats)} sats`
  return `Your wallet holds ${balance}, ${subject} needs ${need}. Top up in Settings → Wallet and try again.`
}
