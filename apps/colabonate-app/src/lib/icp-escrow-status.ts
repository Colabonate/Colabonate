// ADR-357 D4: the ICP escrow state surface is generated from STATE-MODEL.md's
// canonical matrix, not hand-written per screen. The canister state machine is
//
//   PendingFunding → Funded → Released | Refunded | Disputed → DisputeSettled{buyer_bps, seller_bps}
//
// This module maps that state (plus the settled bps split) to a per-actor display
// view. A missing (state × actor) combination is a test failure, not a blank screen.
//
// This deliberately REPLACES the custodial three-phase vocabulary in
// `lib/escrow-utils.ts` (ADR-124/184/193, a mechanism ADR-253 decided never ships)
// — rendering the canister's states through that vocabulary would be misleading.

import type { EscrowTradeState } from './escrow-trade'

export type EscrowActor = 'buyer' | 'seller' | 'arbitrator' | 'external'

/** A canister action from STATE-MODEL §4's authorization matrix. */
export type EscrowAction =
  | 'check_funding'
  | 'release_milestone'
  | 'open_dispute'
  | 'submit_verdict'
  | 'timeout_refund'

export interface EscrowStateBadge {
  label: string
  /** Design-token role (resolved to a real token by the consumer, never raw CSS). */
  colorToken: string
  terminal: boolean
}

export interface EscrowStateView {
  badge: EscrowStateBadge
  /** Every canister action this actor is authorized for in this state (§4). */
  authorizedActions: EscrowAction[]
  /** The ONE action the D6 action bar leads with (null = none/read-only). */
  primaryAction: EscrowAction | null
  /** Honest consequence / disclosure the UI must surface alongside the badge. */
  notice: string | null
}

type Settled = { buyerBps: number; sellerBps: number } | null

function badge(state: EscrowTradeState, settled: Settled): EscrowStateBadge {
  switch (state) {
    case 'PENDING_FUNDING':
      return { label: 'Awaiting deposit', colorToken: '--theme-text-muted', terminal: false }
    case 'FUNDED':
      return { label: 'Funded', colorToken: '--color-status-success', terminal: false }
    case 'RELEASED':
      return { label: 'Released', colorToken: '--color-status-success', terminal: true }
    case 'REFUNDED':
      return { label: 'Refunded', colorToken: '--color-status-warning', terminal: true }
    case 'DISPUTED':
      return { label: 'Disputed', colorToken: '--color-status-error', terminal: false }
    case 'DISPUTE_SETTLED': {
      const buyerPct = settled ? settled.buyerBps / 100 : 0
      const sellerPct = settled ? settled.sellerBps / 100 : 0
      return { label: `Settled ${buyerPct}% / ${sellerPct}%`, colorToken: '--color-status-success', terminal: true }
    }
  }
}

// STATE-MODEL §4: check_funding + timeout_refund are permissionless (anyone);
// release_milestone is buyer-only; open_dispute is buyer-or-seller; submit_verdict
// is the DAO key (arbitrator surface). Terminal states authorize nothing.
function authorizedActions(state: EscrowTradeState, actor: EscrowActor): EscrowAction[] {
  switch (state) {
    case 'PENDING_FUNDING':
      return ['check_funding']
    case 'FUNDED':
      if (actor === 'buyer') return ['release_milestone', 'open_dispute', 'timeout_refund']
      if (actor === 'seller') return ['open_dispute', 'timeout_refund']
      return ['check_funding', 'timeout_refund']
    case 'DISPUTED':
      return actor === 'arbitrator' ? ['submit_verdict'] : []
    default:
      return []
  }
}

function primaryAction(state: EscrowTradeState, actor: EscrowActor): EscrowAction | null {
  if (state === 'FUNDED' && actor === 'buyer') return 'release_milestone'
  if (state === 'FUNDED' && actor === 'seller') return 'open_dispute'
  if (state === 'DISPUTED' && actor === 'arbitrator') return 'submit_verdict'
  return null
}

function notice(state: EscrowTradeState, actor: EscrowActor): string | null {
  switch (state) {
    case 'PENDING_FUNDING':
      return actor === 'buyer' ? 'Deposit to the derived BTC address to fund the trade.' : null
    case 'FUNDED':
      return actor === 'buyer'
        ? 'Release only after delivery is confirmed. Timeout refund is permissionless — anyone may claim it.'
        : actor === 'seller'
          ? 'You may open a dispute. Timeout refund is permissionless — anyone may claim it.'
          : 'Timeout refund is permissionless — anyone may claim it.'
    case 'DISPUTED':
      return 'Who opened the dispute is an app record, not on-chain.'
    case 'DISPUTE_SETTLED':
      return 'DAO verdict applied; split payout signed.'
    default:
      return null
  }
}

export function icpTradeStateView(
  state: EscrowTradeState,
  actor: EscrowActor,
  settled: Settled = null,
): EscrowStateView {
  const actions = authorizedActions(state, actor)
  const primary = primaryAction(state, actor)
  return {
    badge: badge(state, settled),
    authorizedActions: actions,
    primaryAction: primary && actions.includes(primary) ? primary : null,
    notice: notice(state, actor),
  }
}

export const ESCROW_ACTORS: readonly EscrowActor[] = ['buyer', 'seller', 'arbitrator', 'external']
export const ESCROW_STATES: readonly EscrowTradeState[] = [
  'PENDING_FUNDING',
  'FUNDED',
  'RELEASED',
  'REFUNDED',
  'DISPUTED',
  'DISPUTE_SETTLED',
]
