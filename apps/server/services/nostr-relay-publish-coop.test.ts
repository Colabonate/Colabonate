/**
 * NostrRelayService.publishCooperationProposal() + publishMilestoneEvent() —
 * visibility filter (ADR-152 / Plan Phase 3.2 + 3.3).
 *
 * Verifies that PRIVATE cooperations + their milestones are SKIPPED (return
 * null, no public Kind 30414 / 30415 published) while PUBLIC ones publish
 * normally. Mirrors nostr-relay-publish-offer.test.ts.
 *
 * Run with:
 *   ./node_modules/.bin/vitest run apps/server/services/nostr-relay-publish-coop.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NostrRelayService } from './nostr-relay.js'

describe('NostrRelayService — ADR-152 cooperation/milestone visibility filter', () => {
  let svc: NostrRelayService
  let publishSpy: ReturnType<typeof vi.spyOn>
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    svc = new NostrRelayService()
    publishSpy = vi.spyOn(svc.getPool(), 'publish').mockReturnValue([Promise.resolve(true)] as any)
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const baseCoop = {
    id: 'coop-test-1',
    type: 'proposal' as const,
    initiatorPubkey: 'a'.repeat(64),
    partnerPubkey: 'b'.repeat(64),
    title: 'Test Coop',
    budgetSats: 10000,
    status: 'OPEN',
  }

  const baseMilestone = {
    id: 'ms-test-1',
    cooperationId: 'coop-test-1',
    milestoneIndex: 1,
    initiatorPubkey: 'a'.repeat(64),
    partnerPubkey: 'b'.repeat(64),
    title: 'Milestone 1',
    status: 'COMPLETED',
    amountSats: 5000,
  }

  // ── Cooperation proposal ──────────────────────────────────────────────────

  it('coop: returns null and does NOT publish when visibility=PRIVATE', async () => {
    const result = await svc.publishCooperationProposal({ ...baseCoop, visibility: 'PRIVATE' })
    expect(result).toBeNull()
    expect(publishSpy).not.toHaveBeenCalled()
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipping publish for PRIVATE cooperation'),
    )
  })

  it('coop: publishes when visibility=PUBLIC', async () => {
    const result = await svc.publishCooperationProposal({ ...baseCoop, visibility: 'PUBLIC' })
    expect(result).not.toBeNull()
    // dual-publish (legacy + new kind) = 2 publish calls
    expect(publishSpy).toHaveBeenCalledTimes(2)
  })

  it('coop: publishes when visibility is undefined (backward compat)', async () => {
    const result = await svc.publishCooperationProposal({ ...baseCoop })
    expect(result).not.toBeNull()
    expect(publishSpy).toHaveBeenCalledTimes(2)
  })

  // ── Milestone event ───────────────────────────────────────────────────────

  it('milestone: returns null and does NOT publish when visibility=PRIVATE', async () => {
    const result = await svc.publishMilestoneEvent({ ...baseMilestone, visibility: 'PRIVATE' })
    expect(result).toBeNull()
    expect(publishSpy).not.toHaveBeenCalled()
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipping publish for PRIVATE milestone'),
    )
  })

  it('milestone: publishes when visibility=PUBLIC', async () => {
    const result = await svc.publishMilestoneEvent({ ...baseMilestone, visibility: 'PUBLIC' })
    expect(result).not.toBeNull()
    expect(publishSpy).toHaveBeenCalled()
  })

  it('milestone: publishes when visibility is undefined (backward compat)', async () => {
    const result = await svc.publishMilestoneEvent({ ...baseMilestone })
    expect(result).not.toBeNull()
    expect(publishSpy).toHaveBeenCalled()
  })
})
