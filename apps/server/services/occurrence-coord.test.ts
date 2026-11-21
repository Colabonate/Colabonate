// Occurrence coordinate resolution — ADR-271 (FIXED) + ADR-369 (OPEN).
// Regression tests for occurrenceCoordFor in bookable-resource.ts.

import { describe, expect, it } from 'vitest'
import { sessionOccurrenceD } from '@col/nostr-schema'
import { occurrenceCoordFor } from '../routes/bookable-resource.js'

const OWNER = 'a'.repeat(64)

const sessionRules = (id: string, startMinute = 14 * 60, endMinute = 17 * 60) => [{
  id,
  ruleKind: 'WEEKLY_WINDOW',
  weekday: 3, // Wednesday (2026-08-05 is a Wednesday)
  startMinute,
  endMinute,
  validFrom: null,
  validUntil: null,
}]

const fixedResource = () => ({
  kind: 'SESSION' as const,
  ownerPubkey: OWNER,
  timezone: 'UTC',
  bookingStyle: 'FIXED',
  rules: sessionRules('rule-fixed'),
})

const openResource = () => ({
  kind: 'SESSION' as const,
  ownerPubkey: OWNER,
  timezone: 'UTC',
  bookingStyle: 'OPEN',
  rules: sessionRules('rule-open'),
})

describe('occurrenceCoordFor', () => {
  it('FIXED sessions address the occurrence only when start matches exactly', () => {
    const exact = occurrenceCoordFor(fixedResource(), {
      start: new Date('2026-08-05T14:00:00Z'),
      end: new Date('2026-08-05T17:00:00Z'),
    })
    expect(exact).toEqual({
      kind: 31923,
      pubkey: OWNER,
      d: sessionOccurrenceD('rule-fixed', '2026-08-05'),
    })
    const midWindow = occurrenceCoordFor(fixedResource(), {
      start: new Date('2026-08-05T15:00:00Z'),
      end: new Date('2026-08-05T17:00:00Z'),
    })
    expect(midWindow).toBeNull()
  })

  it('OPEN sessions address the WEEKLY_WINDOW that contains the block', () => {
    const subBlock = occurrenceCoordFor(openResource(), {
      start: new Date('2026-08-05T15:00:00Z'),
      end: new Date('2026-08-05T16:00:00Z'),
    })
    expect(subBlock).toEqual({
      kind: 31923,
      pubkey: OWNER,
      d: sessionOccurrenceD('rule-open', '2026-08-05'),
    })
    const fullWindow = occurrenceCoordFor(openResource(), {
      start: new Date('2026-08-05T14:00:00Z'),
      end: new Date('2026-08-05T17:00:00Z'),
    })
    expect(fullWindow).toEqual(subBlock)
  })

  it('OPEN sessions return null when the block is outside every window', () => {
    const early = occurrenceCoordFor(openResource(), {
      start: new Date('2026-08-05T13:30:00Z'),
      end: new Date('2026-08-05T15:00:00Z'),
    })
    expect(early).toBeNull()
    const late = occurrenceCoordFor(openResource(), {
      start: new Date('2026-08-05T16:00:00Z'),
      end: new Date('2026-08-05T18:00:00Z'),
    })
    expect(late).toBeNull()
  })
})
