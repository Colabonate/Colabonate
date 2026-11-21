import { describe, it, expect } from 'vitest'
import {
  icpTradeStateView,
  ESCROW_ACTORS,
  ESCROW_STATES,
  type EscrowStateView,
} from './icp-escrow-status'

// ADR-357 D4: every (state × actor) combination must have a defined rendering —
// a missing combination is a test failure, not a blank screen (STATE-MODEL §4).
describe('icpTradeStateView (ADR-357 D4 state surface)', () => {
  const views: Record<string, EscrowStateView> = {}

  for (const state of ESCROW_STATES) {
    for (const actor of ESCROW_ACTORS) {
      const key = `${state}:${actor}`
      views[key] = icpTradeStateView(state, actor)
    }
  }

  it('defines a non-empty badge + action list for every state × actor combination', () => {
    for (const state of ESCROW_STATES) {
      for (const actor of ESCROW_ACTORS) {
        const view = views[`${state}:${actor}`]
        expect(view.badge.label, `${state} × ${actor} badge label`).not.toBe('')
        expect(view.badge.colorToken, `${state} × ${actor} badge token`).not.toBe('')
        expect(Array.isArray(view.authorizedActions), `${state} × ${actor} actions`).toBe(true)
        // The primary action, when present, must be one the actor is authorized for.
        if (view.primaryAction) {
          expect(view.authorizedActions, `${state} × ${actor} primary ⊆ authorized`).toContain(view.primaryAction)
        }
      }
    }
  })

  it('uses only defined design tokens (no F-10-class undefined tokens)', () => {
    const defined = new Set([
      '--theme-text-muted',
      '--color-status-success',
      '--color-status-warning',
      '--color-status-error',
    ])
    for (const state of ESCROW_STATES) {
      for (const actor of ESCROW_ACTORS) {
        expect(defined.has(views[`${state}:${actor}`].badge.colorToken), `${state} × ${actor} token defined`).toBe(true)
      }
    }
  })

  it('marks only Released / Refunded / DisputeSettled as terminal', () => {
    expect(views['RELEASED:buyer'].badge.terminal).toBe(true)
    expect(views['REFUNDED:buyer'].badge.terminal).toBe(true)
    expect(views['DISPUTE_SETTLED:buyer'].badge.terminal).toBe(true)
    expect(views['PENDING_FUNDING:buyer'].badge.terminal).toBe(false)
    expect(views['FUNDED:buyer'].badge.terminal).toBe(false)
    expect(views['DISPUTED:buyer'].badge.terminal).toBe(false)
  })

  it('authorizes release to the buyer only, dispute to buyer-or-seller (STATE-MODEL §4)', () => {
    expect(views['FUNDED:buyer'].authorizedActions).toContain('release_milestone')
    expect(views['FUNDED:seller'].authorizedActions).not.toContain('release_milestone')
    expect(views['FUNDED:buyer'].authorizedActions).toContain('open_dispute')
    expect(views['FUNDED:seller'].authorizedActions).toContain('open_dispute')
    expect(views['FUNDED:seller'].primaryAction).toBe('open_dispute')
  })

  it('keeps check_funding and timeout_refund permissionless', () => {
    expect(views['PENDING_FUNDING:external'].authorizedActions).toContain('check_funding')
    expect(views['FUNDED:external'].authorizedActions).toContain('timeout_refund')
    expect(views['FUNDED:external'].authorizedActions).toContain('check_funding')
  })

  it('authorizes the verdict only to the arbitrator, and only while disputed', () => {
    expect(views['DISPUTED:arbitrator'].primaryAction).toBe('submit_verdict')
    expect(views['DISPUTED:buyer'].authorizedActions).not.toContain('submit_verdict')
    expect(views['FUNDED:arbitrator'].authorizedActions).not.toContain('submit_verdict')
  })

  it('renders the DisputeSettled split from the settled bps', () => {
    const view = icpTradeStateView('DISPUTE_SETTLED', 'buyer', { buyerBps: 4000, sellerBps: 6000 })
    expect(view.badge.label).toBe('Settled 40% / 60%')
  })
})
