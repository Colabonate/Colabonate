/**
 * @file disputes/index.ts
 *
 * Phase 2.7 + 2.8 — Mutual-Arbiter UI exports.
 *
 * Re-exports for the mutual-arbiter feature so consumers can write:
 *   import {
 *     MutualArbiterPanel,
 *     NominateArbiterModal,
 *     PrivateVerdictCard,
 *   } from '../../components/disputes'
 */

export { MutualArbiterPanel } from './MutualArbiterPanel'
export type { MutualArbiterPanelProps } from './MutualArbiterPanel'

export { NominateArbiterModal } from './NominateArbiterModal'
export type { NominateArbiterModalProps } from './NominateArbiterModal'

export { PrivateVerdictCard } from './PrivateVerdictCard'
export type { PrivateVerdictCardProps } from './PrivateVerdictCard'
