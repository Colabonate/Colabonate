import { describe, it, expect } from 'vitest'
import { mergeProximityPool } from './proximity-pool'

const o = (id: string, publishedAt: string | null, createdAt = '2026-01-01T00:00:00Z') => ({ id, publishedAt, createdAt })

describe('mergeProximityPool (ADR-421)', () => {
  it('returns the global pool untouched when there is no country pool', () => {
    const global = [o('a', '2026-11-02T00:00:00Z')]
    expect(mergeProximityPool([], global)).toBe(global)
  })
  it('adds older in-country offers that the global newest-N window misses', () => {
    const global = [o('g1', '2026-11-10T00:00:00Z'), o('g2', '2026-11-09T00:00:00Z')]
    const country = [o('de1', '2026-09-19T00:00:00Z')]
    expect(mergeProximityPool(country, global).map(x => x.id)).toEqual(['g1', 'g2', 'de1'])
  })
  it('dedupes by id and keeps newest first', () => {
    const shared = o('x', '2026-11-05T00:00:00Z')
    const merged = mergeProximityPool([shared, o('de2', '2026-11-08T00:00:00Z')], [o('g1', '2026-11-10T00:00:00Z'), shared])
    expect(merged.map(x => x.id)).toEqual(['g1', 'de2', 'x'])
  })
  it('falls back to createdAt when publishedAt is missing', () => {
    const merged = mergeProximityPool([o('old', null, '2026-01-01T00:00:00Z')], [o('new', null, '2026-06-01T00:00:00Z')])
    expect(merged.map(x => x.id)).toEqual(['new', 'old'])
  })
})
