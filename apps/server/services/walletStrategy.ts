/**
 * Wallet-Mode Strategy Service (ADR-160 / PROB-003 B-γ)
 *
 * The single decision function that maps a user's wallet-mode strategy +
 * a trade's visibility to the concrete `WalletMode` the trade should use.
 *
 * This is the "Hybrid" pattern from PROB-003 §B.2 (B-γ), exposed as a
 * user-configurable strategy so users can pick their privacy/sovereignty
 * trade-off once instead of per-trade.
 *
 *   HYBRID            (default) PRIVATE → CUSTODIAL (isolated sub-wallet, B-α)
 *                                PUBLIC  → NON_CUSTODIAL (WebLN, self-sovereign)
 *   CUSTODIAL_ONLY    always CUSTODIAL (most accessible; server holds keys)
 *   NONCUSTODIAL_ONLY always NON_CUSTODIAL (self-sovereignty; in PRIVATE mode
 *                     this sacrifices the B-α sub-wallet isolation guarantee —
 *                     callers MUST surface the warning from explainStrategy)
 *
 * Enforcement sites (call resolveWalletMode):
 *   - Primary wallet provisioning  — apps/server/routes/wallet.ts
 *   - (Future) trade-time sub-wallet selection — see ADR-160 §"Enforcement"
 */

import type { WalletMode, WalletModeStrategy } from '@prisma/client'
import type { TradeVisibility } from '@prisma/client'

export const WALLET_MODE_STRATEGIES = [
  'HYBRID',
  'CUSTODIAL_ONLY',
  'NONCUSTODIAL_ONLY',
] as const

export function isWalletModeStrategy(v: unknown): v is WalletModeStrategy {
  return typeof v === 'string' && (WALLET_MODE_STRATEGIES as readonly string[]).includes(v)
}

/**
 * Core decision function. Pure + total: always returns a WalletMode.
 *
 * @param strategy  the user's chosen strategy (User.walletModeStrategy)
 * @param visibility the trade context (PUBLIC | PRIVATE). Defaults to PUBLIC
 *                   for non-trade contexts (e.g. provisioning a primary wallet).
 */
export function resolveWalletMode(
  strategy: WalletModeStrategy,
  visibility: TradeVisibility = 'PUBLIC',
): WalletMode {
  switch (strategy) {
    case 'CUSTODIAL_ONLY':
      return 'CUSTODIAL'
    case 'NONCUSTODIAL_ONLY':
      return 'NON_CUSTODIAL'
    case 'HYBRID':
    default:
      // B-γ hybrid mapping: PRIVATE isolates via custodial sub-wallet (B-α),
      // PUBLIC prefers self-sovereign non-custodial (WebLN).
      return visibility === 'PRIVATE' ? 'CUSTODIAL' : 'NON_CUSTODIAL'
  }
}

export interface StrategyExplanation {
  strategy: WalletModeStrategy
  /** Human-readable label for the settings radio. */
  label: string
  /** One-line summary. */
  summary: string
  /** Concrete mapping the user is choosing. */
  publicMode: WalletMode
  privateMode: WalletMode
  /** Caveat to surface in UI (e.g. NONCUSTODIAL_ONLY + PRIVATE loses isolation). */
  caveat: string | null
}

/**
 * UI-facing explanation of a strategy. Used by the settings screen and the
 * GET /api/user/wallet-strategy route.
 */
export function explainStrategy(strategy: WalletModeStrategy): StrategyExplanation {
  const base: Omit<StrategyExplanation, 'caveat'> = {
    strategy,
    publicMode: resolveWalletMode(strategy, 'PUBLIC'),
    privateMode: resolveWalletMode(strategy, 'PRIVATE'),
    label: '',
    summary: '',
  }
  switch (strategy) {
    case 'CUSTODIAL_ONLY':
      return {
        ...base,
        label: 'Custodial (always)',
        summary: 'Server-managed wallets for every trade. Most accessible; no browser extension needed.',
        caveat: 'The server operator holds the keys. Lower self-sovereignty.',
      }
    case 'NONCUSTODIAL_ONLY':
      return {
        ...base,
        label: 'Non-custodial (always)',
        summary: 'Your keys, your coins (WebLN/Alby) for every trade. Full self-sovereignty.',
        caveat:
          'Private trades will NOT use an isolated sub-wallet — the wallet operator can correlate them. ' +
          'Requires a WebLN-capable wallet.',
      }
    case 'HYBRID':
    default:
      return {
        ...base,
        label: 'Hybrid (recommended)',
        summary:
          'Public trades use your own wallet (non-custodial); private trades use an isolated custodial sub-wallet for anonymity.',
        caveat: null,
      }
  }
}

export const ALL_STRATEGY_EXPLANATIONS: StrategyExplanation[] = WALLET_MODE_STRATEGIES.map(explainStrategy)

/**
 * Stage-1 Direct-Pay equivalent for a real production host (ADR-253). There is
 * no LNBits/LND node there, so neither the custodial "always" mode nor HYBRID's
 * isolated private sub-wallet can be honored — the only truthful strategy is
 * non-custodial everywhere. Kept separate from `explainStrategy` so the pure
 * three-strategy matrix (and its unit tests) stays intact for beta/dev.
 */
export const DIRECT_PAY_STRATEGY_EXPLANATIONS: StrategyExplanation[] = [
  {
    strategy: 'NONCUSTODIAL_ONLY',
    label: 'Non-custodial (Direct-Pay)',
    summary:
      'Every trade pays your own wallet — Lightning address, NWC, Alby, or Cashu. Colabonate never holds your funds.',
    publicMode: 'NON_CUSTODIAL',
    privateMode: 'NON_CUSTODIAL',
    caveat: null,
  },
]

/**
 * Strategy list for the settings API. On a real production host only the
 * Direct-Pay option is offered; beta and dev keep all three. The client renders
 * this list verbatim (ADR-160: the UI must not duplicate the decision logic).
 */
export function getStrategyExplanations(directPayOnly: boolean): StrategyExplanation[] {
  return directPayOnly ? DIRECT_PAY_STRATEGY_EXPLANATIONS : ALL_STRATEGY_EXPLANATIONS
}

/** The effective strategy stored/shown for a user, given the host's capabilities. */
export function getEffectiveStrategy(
  strategy: WalletModeStrategy,
  directPayOnly: boolean,
): WalletModeStrategy {
  return directPayOnly ? 'NONCUSTODIAL_ONLY' : strategy
}
