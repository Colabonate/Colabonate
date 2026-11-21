import { describe, it, expect } from 'vitest'
import { dedupeCoopItems } from '../routes/coop/coop-filters'
import type { CoopItem } from '../routes/coop/coop-cards'

function item(partial: Partial<CoopItem> & Pick<CoopItem, 'id' | 'title' | 'itemType'>): CoopItem {
  return { ...partial }
}

describe('dedupeCoopItems (ADR-363 D3)', () => {
  it('drops a true duplicate with the same itemType:id', () => {
    const items = [item({ id: 'a', title: 'x', itemType: 'network' }), item({ id: 'a', title: 'x', itemType: 'network' })]
    expect(dedupeCoopItems(items)).toHaveLength(1)
  })

  it('collapses a network offer into the vendor card of its own company', () => {
    const items = [
      item({ id: 'co-1', title: 'Acme', itemType: 'vendor' }),
      item({ id: 'off-1', title: 'Network', itemType: 'network', companyId: 'co-1' }),
    ]
    const out = dedupeCoopItems(items)
    expect(out.map(i => i.itemType)).toEqual(['vendor'])
  })

  it('keeps a network offer whose company has no vendor card', () => {
    const items = [
      item({ id: 'off-1', title: 'Network', itemType: 'network', companyId: 'co-missing' }),
    ]
    expect(dedupeCoopItems(items)).toHaveLength(1)
  })

  it('collapses a partner card into the vendor card with the same owner pubkey', () => {
    const items = [
      item({ id: 'co-1', title: 'Acme', itemType: 'vendor', initiatorPubkey: 'npub-acme' }),
      item({ id: 'pub-acme', title: 'acme@getalby.com', itemType: 'partner', initiatorPubkey: 'npub-acme' }),
    ]
    const out = dedupeCoopItems(items)
    expect(out.map(i => i.itemType)).toEqual(['vendor'])
  })

  it('keeps a partner card without a matching vendor', () => {
    const items = [item({ id: 'pub-x', title: 'x', itemType: 'partner', initiatorPubkey: 'npub-x' })]
    expect(dedupeCoopItems(items)).toHaveLength(1)
  })

  it('preserves first-occurrence order', () => {
    const items = [
      item({ id: 'p', title: 'project', itemType: 'project' }),
      item({ id: 'v', title: 'vendor', itemType: 'vendor' }),
      item({ id: 'n', title: 'network', itemType: 'network' }),
      item({ id: 'b', title: 'bounty', itemType: 'bounty' }),
    ]
    expect(dedupeCoopItems(items).map(i => i.itemType)).toEqual(['project', 'vendor', 'network', 'bounty'])
  })

  it('handles an empty list', () => {
    expect(dedupeCoopItems([])).toEqual([])
  })
})
