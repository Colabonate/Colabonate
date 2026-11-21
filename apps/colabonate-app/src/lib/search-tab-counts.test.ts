import { describe, it, expect } from 'vitest'
import { coopItemMatchesTab, pickBestTab } from './search-tab-counts'
import type { CoopItem } from '../routes/coop/coop-cards'

const item = (itemType: CoopItem['itemType']): CoopItem => ({
  id: `id-${itemType}`,
  title: 'x',
  itemType,
})

describe('coopItemMatchesTab', () => {
  it('maps each item type onto its own subtab', () => {
    expect(coopItemMatchesTab(item('tender'), 'tenders')).toBe(true)
    expect(coopItemMatchesTab(item('project'), 'projects')).toBe(true)
    expect(coopItemMatchesTab(item('network'), 'network')).toBe(true)
    expect(coopItemMatchesTab(item('bounty'), 'bounties')).toBe(true)
    expect(coopItemMatchesTab(item('agent'), 'agents')).toBe(true)
    expect(coopItemMatchesTab(item('service'), 'services')).toBe(true)
    expect(coopItemMatchesTab(item('bundle'), 'services')).toBe(true)
    expect(coopItemMatchesTab(item('vendor'), 'partners')).toBe(true)
    expect(coopItemMatchesTab(item('partner'), 'partners')).toBe(true)
  })

  it('includes type items on All but excludes vendor/partner/bounty', () => {
    expect(coopItemMatchesTab(item('tender'), 'all')).toBe(true)
    expect(coopItemMatchesTab(item('agent'), 'all')).toBe(true)
    expect(coopItemMatchesTab(item('service'), 'all')).toBe(true)
    expect(coopItemMatchesTab(item('vendor'), 'all')).toBe(false)
    expect(coopItemMatchesTab(item('partner'), 'all')).toBe(false)
    expect(coopItemMatchesTab(item('bounty'), 'all')).toBe(false)
  })

  it('does not cross-match unrelated type tabs', () => {
    expect(coopItemMatchesTab(item('agent'), 'services')).toBe(false)
    expect(coopItemMatchesTab(item('service'), 'agents')).toBe(false)
    expect(coopItemMatchesTab(item('tender'), 'projects')).toBe(false)
  })
})

describe('pickBestTab', () => {
  const order = ['all', 'tenders', 'projects', 'network'] as const

  it('returns null when the current tab already has matches', () => {
    const counts = { all: 5, tenders: 2, projects: 3, network: 0 }
    expect(pickBestTab(counts, 'tenders', order, 'all')).toBeNull()
  })

  it('switches to the specific tab with the most matches', () => {
    const counts = { all: 5, tenders: 0, projects: 4, network: 2 }
    expect(pickBestTab(counts, 'tenders', order, 'all')).toBe('projects')
  })

  it('falls back to All when only the superset has matches', () => {
    const counts = { all: 3, tenders: 0, projects: 0, network: 0 }
    expect(pickBestTab(counts, 'network', order, 'all')).toBe('all')
  })

  it('returns null when nothing matches anywhere', () => {
    const counts = { all: 0, tenders: 0, projects: 0, network: 0 }
    expect(pickBestTab(counts, 'all', order, 'all')).toBeNull()
  })

  it('switches off All when only a specific tab has matches', () => {
    const counts = { all: 0, tenders: 2, projects: 0, network: 0 }
    expect(pickBestTab(counts, 'all', order, 'all')).toBe('tenders')
  })
})
