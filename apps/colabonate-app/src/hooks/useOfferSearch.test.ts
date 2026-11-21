import { describe, it, expect } from 'vitest'
import { dedupeHits } from './useOfferSearch'
import type { Offer } from '../types/api'

function offer(id: string): Offer {
  return { id } as Offer
}

describe('dedupeHits (ADR-363 D2)', () => {
  it('keeps unique hits in order', () => {
    const hits = [offer('a'), offer('b'), offer('c')]
    expect(dedupeHits(hits).map(h => h.id)).toEqual(['a', 'b', 'c'])
  })

  it('drops a duplicate id that spans a page boundary (offset-cursor shift)', () => {
    const hits = [offer('x'), offer('y'), offer('x'), offer('z')]
    expect(dedupeHits(hits).map(h => h.id)).toEqual(['x', 'y', 'z'])
  })

  it('keeps the first occurrence of a repeated id (newest row wins)', () => {
    const hits = [offer('a'), offer('b'), offer('a')]
    const out = dedupeHits(hits)
    expect(out).toHaveLength(2)
    expect(out[0]).toBe(hits[0])
  })

  it('handles an empty list', () => {
    expect(dedupeHits([])).toEqual([])
  })
})
