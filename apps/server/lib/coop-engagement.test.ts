import { describe, it, expect } from 'vitest'
import { cooperationCanFullEdit, offerCanFullEdit } from './coop-engagement.js'
import type { CooperationEngagementShape, OfferEngagementShape } from './coop-engagement.js'

// ADR-386 — the full-edit gate must be conservative: one engaged signal of any
// kind flips it false. Each case below pins exactly one signal.
function coop(over: Partial<CooperationEngagementShape> = {}): CooperationEngagementShape {
  return {
    status: 'OPEN',
    isAgentOrchestration: false,
    partnerPubkey: null,
    escrowStatus: null,
    lightningInvoice: null,
    paymentHash: null,
    nostrAcceptId: null,
    milestones: [{ status: 'PENDING', steps: [] }],
    _count: { milestoneApplications: 0, tickets: 0, workspaces: 0 },
    ...over,
  }
}

function offer(over: Partial<OfferEngagementShape> = {}): OfferEngagementShape {
  return { status: 'ACTIVE', offerType: 'COOP', _count: { members: 0, tickets: 0 }, ...over }
}

describe('cooperationCanFullEdit', () => {
  it('allows a published cooperation with no engagement', () => {
    expect(cooperationCanFullEdit(coop())).toBe(true)
  })

  it('rejects DRAFT and every non-OPEN status', () => {
    expect(cooperationCanFullEdit(coop({ status: 'DRAFT' }))).toBe(false)
    for (const status of ['ACCEPTED', 'PAID', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DISPUTED']) {
      expect(cooperationCanFullEdit(coop({ status }))).toBe(false)
    }
    expect(cooperationCanFullEdit(coop({ status: undefined }))).toBe(false)
  })

  it('rejects agent-orchestration cooperations', () => {
    expect(cooperationCanFullEdit(coop({ isAgentOrchestration: true }))).toBe(false)
  })

  it('rejects a set partner on the cooperation', () => {
    expect(cooperationCanFullEdit(coop({ partnerPubkey: 'abc' }))).toBe(false)
  })

  it('rejects any escrow / money / accept state', () => {
    expect(cooperationCanFullEdit(coop({ escrowStatus: 'FUNDED' }))).toBe(false)
    expect(cooperationCanFullEdit(coop({ lightningInvoice: 'lnbc' }))).toBe(false)
    expect(cooperationCanFullEdit(coop({ paymentHash: 'deadbeef' }))).toBe(false)
    expect(cooperationCanFullEdit(coop({ nostrAcceptId: 'evt' }))).toBe(false)
    expect(cooperationCanFullEdit(coop({ escrowTrade: { id: 't1' } }))).toBe(false)
  })

  it('rejects any application of any status, incl. DECLINED', () => {
    expect(cooperationCanFullEdit(coop({ _count: { milestoneApplications: 1, tickets: 0, workspaces: 0 } }))).toBe(false)
    expect(cooperationCanFullEdit(coop({ milestoneApplications: [{ status: 'DECLINED' }], _count: undefined }))).toBe(false)
    expect(cooperationCanFullEdit(coop({
      milestones: [{ status: 'PENDING', steps: [], applications: [{ status: 'DECLINED' }] }],
      _count: undefined,
    }))).toBe(false)
  })

  it('rejects tickets and workspaces', () => {
    expect(cooperationCanFullEdit(coop({ _count: { milestoneApplications: 0, tickets: 1, workspaces: 0 } }))).toBe(false)
    expect(cooperationCanFullEdit(coop({ _count: { milestoneApplications: 0, tickets: 0, workspaces: 1 } }))).toBe(false)
  })

  it('rejects any milestone progress, chat, money or step row', () => {
    expect(cooperationCanFullEdit(coop({ milestones: [{ status: 'IN_PROGRESS', steps: [] }] }))).toBe(false)
    expect(cooperationCanFullEdit(coop({ milestones: [{ status: 'PENDING', partnerPubkey: 'p', steps: [] }] }))).toBe(false)
    expect(cooperationCanFullEdit(coop({ milestones: [{ status: 'PENDING', evidence: 'ipfs://x', steps: [] }] }))).toBe(false)
    expect(cooperationCanFullEdit(coop({ milestones: [{ status: 'PENDING', paymentHash: 'h', steps: [] }] }))).toBe(false)
    expect(cooperationCanFullEdit(coop({ milestones: [{ status: 'PENDING', steps: [], _count: { messages: 1 } }] }))).toBe(false)
    // ADR-386 D7: any step row (agent pipeline artifact) excludes full edit —
    // even a still-PENDING one — so the milestone replace can't drop it.
    expect(cooperationCanFullEdit(coop({ milestones: [{ status: 'PENDING', steps: [{ status: 'PENDING' }] }] }))).toBe(false)
    expect(cooperationCanFullEdit(coop({ milestones: [{ status: 'PENDING', steps: [{ status: 'DONE' }] }] }))).toBe(false)
  })

  it('treats a missing status as PENDING (no false engagement)', () => {
    expect(cooperationCanFullEdit(coop({ milestones: [{ steps: [] }] }))).toBe(true)
  })
})

describe('offerCanFullEdit', () => {
  it('allows a published COOP network with no members and no tickets', () => {
    expect(offerCanFullEdit(offer())).toBe(true)
  })

  it('rejects DRAFT networks', () => {
    expect(offerCanFullEdit(offer({ status: 'DRAFT' }))).toBe(false)
  })

  it('rejects non-COOP offers', () => {
    expect(offerCanFullEdit(offer({ offerType: 'SERVICE' }))).toBe(false)
  })

  it('rejects any member of any status', () => {
    expect(offerCanFullEdit(offer({ _count: { members: 1, tickets: 0 } }))).toBe(false)
    expect(offerCanFullEdit(offer({ members: [{ status: 'DECLINED' }], _count: undefined }))).toBe(false)
  })

  it('rejects tickets', () => {
    expect(offerCanFullEdit(offer({ _count: { members: 0, tickets: 1 } }))).toBe(false)
  })
})
