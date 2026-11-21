// @vitest-environment jsdom
// useCoopExploreData.ts transitively imports richTextToPlainText from
// components/offers, whose barrel pulls in RichText.tsx's module-level
// DOMPurify.addHook() — same jsdom requirement as RichText.test.ts.
import { describe, it, expect } from 'vitest'
import { mergeCoopExploreSources, type CoopExploreSources } from './useCoopExploreData'
import type { CoopItem } from '../routes/coop/coop-cards'
import type { Company } from '../types/api'
import type { PartnerUser } from './useEntityQueries'
import type { AgentTask } from './useAgentTaskQueries'

// ADR-376 D1 / FU-699: mergeCoopExploreSources is the pure composition step
// useCoopExploreData's useMemo now delegates to — extracted specifically so
// the merge/dedup behaviour that used to live inside an 8-endpoint
// Promise.all can be asserted without rendering a hook tree or mocking eight
// TanStack queries.

function coop(id: string, title = 'coop'): CoopItem {
  return { id, title, itemType: 'project' }
}

function emptySources(): CoopExploreSources {
  return {
    cooperations: [],
    networkOffers: [],
    serviceOffers: [],
    agentOffers: [],
    companies: [],
    partners: [],
    bounties: [],
  }
}

function offer(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, title: `offer-${id}`, status: 'ACTIVE', ...extra }
}

function company(id: string, ownerPubkey = `npub-${id}`): Company {
  return {
    id,
    name: `Company ${id}`,
    ownerPubkey,
    createdAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Company
}

function partner(pubkey: string): PartnerUser {
  return {
    pubkey,
    lnAddress: null,
    picture: null,
    offerCount: 0,
    firstOfferAt: null,
    categories: [],
  }
}

function bounty(id: string): AgentTask {
  return {
    id,
    creatorPubkey: `npub-${id}`,
    title: `Bounty ${id}`,
    description: '',
    requiredCapabilities: [],
    budgetSats: 1000,
    images: null,
    deadline: null,
    acceptanceCriteria: null,
    status: 'OPEN',
    selectedAgentProfileId: null,
    selectedOfferId: null,
    preferredSupervision: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('mergeCoopExploreSources (ADR-376 D1)', () => {
  it('returns an empty list when every source is empty', () => {
    expect(mergeCoopExploreSources(emptySources())).toEqual([])
  })

  it('merges every source into one CoopItem list, each mapped to its own itemType', () => {
    const out = mergeCoopExploreSources({
      cooperations: [coop('coop-1')],
      networkOffers: [offer('net-1', { offerType: 'COOP' })],
      serviceOffers: [offer('svc-1', { offerType: 'SERVICE' })],
      agentOffers: [offer('agt-1', { offerType: 'AGENT_SETUP' })],
      companies: [company('co-1')],
      partners: [partner('npub-partner')],
      bounties: [bounty('bounty-1')],
    })

    const byId = new Map(out.map(i => [i.id, i.itemType]))
    expect(byId.get('coop-1')).toBe('project')
    expect(byId.get('net-1')).toBe('network')
    expect(byId.get('svc-1')).toBe('service')
    expect(byId.get('agt-1')).toBe('agent')
    expect(byId.get('co-1')).toBe('vendor')
    expect(byId.get('npub-partner')).toBe('partner')
    expect(byId.get('bounty-1')).toBe('bounty')
    expect(out).toHaveLength(7)
  })

  it('runs the merged pool through dedupeCoopItems (vendor/network collapse)', () => {
    // Same collapse rule ADR-363 D3 already unit-tests directly on
    // dedupeCoopItems — asserted again here at the composition boundary so a
    // future change to mergeCoopExploreSources can't silently bypass it by
    // forgetting to call dedupeCoopItems.
    const out = mergeCoopExploreSources({
      ...emptySources(),
      companies: [company('co-1', 'npub-acme')],
      networkOffers: [offer('net-1', { company: { id: 'co-1' } })],
    })
    expect(out.map(i => i.itemType)).toEqual(['vendor'])
  })

  it('a slow/failing source (empty array) never blanks the other sources', () => {
    const out = mergeCoopExploreSources({
      ...emptySources(),
      cooperations: [coop('coop-1')],
      // networkOffers/serviceOffers/agentOffers/companies/partners/bounties
      // all stay empty, simulating a still-loading or degraded source.
    })
    expect(out).toEqual([coop('coop-1')])
  })
})
