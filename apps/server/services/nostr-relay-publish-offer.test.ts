/**
 * NostrRelayService.publishOffer() — visibility filter (ADR-152).
 *
 * Verifies that:
 * - PRIVATE offers are SKIPPED (return null, no Kind 30402 / 30017 published)
 * - PUBLIC offers publish normally
 * - undefined visibility (legacy / backward compat) publishes normally
 * - The skip log is emitted for PRIVATE offers
 *
 * Run with:
 *   ./node_modules/.bin/vitest run apps/server/services/nostr-relay-publish-offer.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NostrRelayService } from './nostr-relay.js'
import { NOSTR_KINDS, NOSTR_CLIENT_TAG } from './kind-mapping.js'
import type { Event } from 'nostr-tools'

describe('NostrRelayService.publishOffer() — ADR-152 visibility filter', () => {
  let svc: NostrRelayService
  let publishSpy: ReturnType<typeof vi.spyOn>
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    svc = new NostrRelayService()
    // Mock pool.publish — SimplePool.publish returns Promise<void>[] synchronously
    // (not a Promise<array>), matching publishBounded's expectation.
    publishSpy = vi.spyOn(svc.getPool(), 'publish').mockReturnValue([Promise.resolve(true)] as any)
    // Spy on console.log to assert skip message
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const baseOffer = {
    id: 'offer-test-1',
    title: 'Test Offer',
    description: 'Test description',
    priceSats: 1000,
    creatorPubkey: 'a'.repeat(64),
    categoryCode: 'goods',
  }

  it('returns null and does NOT publish when visibility=PRIVATE', async () => {
    const result = await svc.publishOffer({
      ...baseOffer,
      visibility: 'PRIVATE',
    })

    expect(result).toBeNull()
    expect(publishSpy).not.toHaveBeenCalled()
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Nostr] Skipping publish for PRIVATE offer'),
    )
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('ADR-152'),
    )
  })

  it('publishes when visibility=PUBLIC', async () => {
    const result = await svc.publishOffer({
      ...baseOffer,
      visibility: 'PUBLIC',
    })

    expect(result).not.toBeNull()
    expect(result?.kind).toBe(NOSTR_KINDS.OFFER_NIP99) // 30402
    // Dual-publish: 1× legacy (30017) + 1× NIP-99 (30402) = 2 publish calls
    expect(publishSpy).toHaveBeenCalledTimes(2)
    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Skipping publish for PRIVATE offer'),
    )
  })

  it('publishes when visibility is undefined (backward compat)', async () => {
    const result = await svc.publishOffer({
      ...baseOffer,
      // visibility intentionally omitted
    })

    expect(result).not.toBeNull()
    expect(result?.kind).toBe(NOSTR_KINDS.OFFER_NIP99)
    expect(publishSpy).toHaveBeenCalledTimes(2)
  })

  it('does NOT call pool.publish at all when visibility=PRIVATE (zero network side effects)', async () => {
    await svc.publishOffer({
      ...baseOffer,
      id: 'private-offer-xyz',
      visibility: 'PRIVATE',
    })

    // Pool.publish must NOT be called — the skip is a complete bypass
    expect(publishSpy).toHaveBeenCalledTimes(0)
  })

  it('returns a valid Nostr event when visibility=PUBLIC', async () => {
    const result = await svc.publishOffer({
      ...baseOffer,
      visibility: 'PUBLIC',
    })

    expect(result).toMatchObject({
      kind: NOSTR_KINDS.OFFER_NIP99,
      tags: expect.arrayContaining([
        expect.arrayContaining(['d', baseOffer.id]),
        expect.arrayContaining(['title', baseOffer.title]),
        expect.arrayContaining(['price', '1000', 'sats']),
      ]),
      content: baseOffer.description,
    })
  })
})

describe('NostrRelayService.publishOffer() — ADR-277 D6 Gamma `t` tags', () => {
  let svc: NostrRelayService

  beforeEach(() => {
    svc = new NostrRelayService()
    vi.spyOn(svc.getPool(), 'publish').mockReturnValue([Promise.resolve(true)] as any)
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const baseOffer = {
    id: 'offer-gamma-test-1',
    title: 'Test Offer',
    description: 'Test description',
    priceSats: 1000,
    creatorPubkey: 'a'.repeat(64),
    categoryCode: 'goods',
  }

  it('emits one `t` tag per explicit gammaTags entry', async () => {
    const result = await svc.publishOffer({ ...baseOffer, gammaTags: ['electronics', 'refurbished'] })
    const tTags = result!.tags.filter(t => t[0] === 't')
    expect(tTags).toEqual([['t', 'electronics'], ['t', 'refurbished']])
  })

  it('falls back to the D3 seed map keyed off categoryCode when gammaTags is omitted', async () => {
    const result = await svc.publishOffer({ ...baseOffer })
    const tTags = result!.tags.filter(t => t[0] === 't')
    expect(tTags.length).toBeGreaterThan(0)
    expect(tTags).toEqual([['t', 'goods'], ['t', 'merchandise'], ['t', 'physical-goods']])
  })

  it('emits no `t` tag when neither gammaTags nor categoryCode is set', async () => {
    const result = await svc.publishOffer({ ...baseOffer, categoryCode: undefined })
    const tTags = result!.tags.filter(t => t[0] === 't')
    expect(tTags).toEqual([])
  })
})

describe('NostrRelayService.publishOffer() — ADR-156/172/173/270 enrichment wiring', () => {
  let svc: NostrRelayService

  beforeEach(() => {
    svc = new NostrRelayService()
    vi.spyOn(svc.getPool(), 'publish').mockReturnValue([Promise.resolve(true)] as any)
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const baseOffer = {
    id: 'offer-enrichment-test-1',
    title: 'Test Offer',
    description: 'Test description',
    priceSats: 1000,
    creatorPubkey: 'a'.repeat(64),
  }

  it('emits `type` when productType + physicalType are set', async () => {
    const result = await svc.publishOffer({ ...baseOffer, productType: 'simple', physicalType: 'physical' })
    expect(result!.tags.filter(t => t[0] === 'type')).toEqual([['type', 'simple', 'physical']])
  })

  it('omits `type` when only one of productType/physicalType is set', async () => {
    const result = await svc.publishOffer({ ...baseOffer, productType: 'simple' })
    expect(result!.tags.filter(t => t[0] === 'type')).toEqual([])
  })

  it('ignores an invalid productType instead of publishing a malformed `type` tag', async () => {
    const result = await svc.publishOffer({ ...baseOffer, productType: 'not-a-real-type', physicalType: 'physical' })
    expect(result!.tags.filter(t => t[0] === 'type')).toEqual([])
  })

  it('emits the `a` parent-ref for a variation child, pointing at the same seller', async () => {
    const result = await svc.publishOffer({ ...baseOffer, parentOfferId: 'parent-offer-id' })
    expect(result!.tags.filter(t => t[0] === 'a')).toEqual([['a', `30402:${baseOffer.creatorPubkey}:parent-offer-id`]])
  })

  it('emits `spec` tags from specs and variantValues, and `stock`/`weight`/`dim`/`visibility`', async () => {
    const result = await svc.publishOffer({
      ...baseOffer,
      specs: [{ key: 'Material', value: 'Wood' }],
      variantValues: { Size: 'M', Colour: 'Blue' },
      stock: 5,
      weight: '0.25',
      weightUnit: 'kg',
      dimensions: '30x25x2',
      dimensionsUnit: 'cm',
      listingVisibility: 'pre-order',
    })
    expect(result!.tags.filter(t => t[0] === 'spec')).toEqual([
      ['spec', 'Material', 'Wood'],
      ['spec', 'Size', 'M'],
      ['spec', 'Colour', 'Blue'],
    ])
    expect(result!.tags.filter(t => t[0] === 'stock')).toEqual([['stock', '5']])
    expect(result!.tags.filter(t => t[0] === 'weight')).toEqual([['weight', '0.25', 'kg']])
    expect(result!.tags.filter(t => t[0] === 'dim')).toEqual([['dim', '30x25x2', 'cm']])
    expect(result!.tags.filter(t => t[0] === 'visibility')).toEqual([['visibility', 'pre-order']])
  })

  it('never duplicates d/title/price — the enrichment builder also builds them internally', async () => {
    const result = await svc.publishOffer({ ...baseOffer, productType: 'simple', physicalType: 'physical', stock: 3 })
    expect(result!.tags.filter(t => t[0] === 'd')).toHaveLength(1)
    expect(result!.tags.filter(t => t[0] === 'title')).toHaveLength(1)
    expect(result!.tags.filter(t => t[0] === 'price')).toHaveLength(1)
  })

  it('emits none of the enrichment tags when no enrichment fields are set (backward compatible)', async () => {
    const result = await svc.publishOffer({ ...baseOffer })
    for (const key of ['type', 'a', 'spec', 'stock', 'weight', 'dim', 'visibility']) {
      expect(result!.tags.filter(t => t[0] === key)).toEqual([])
    }
  })
})

describe('NostrRelayService.publishOffer() — ADR-412 amendment: client tag', () => {
  let svc: NostrRelayService
  let publishSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    svc = new NostrRelayService()
    // pool.publish(target, event) — mock.calls[i][1] is the event
    publishSpy = vi.spyOn(svc.getPool(), 'publish').mockReturnValue([Promise.resolve(true)] as any)
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const baseOffer = {
    id: 'offer-client-tag-test-1',
    title: 'Test Offer',
    description: 'Test description',
    priceSats: 1000,
    creatorPubkey: 'a'.repeat(64),
  }

  it('carries ["client", NOSTR_CLIENT_TAG] on BOTH dual-published kinds (30017 + 30402)', async () => {
    await svc.publishOffer({ ...baseOffer, visibility: 'PUBLIC' })

    expect(publishSpy).toHaveBeenCalledTimes(2)
    const calls = publishSpy.mock.calls as unknown as [unknown, Event][]
    const publishedEvents = calls.map(call => call[1])
    expect(publishedEvents.map(event => event.kind)).toEqual([NOSTR_KINDS.OFFER_LEGACY, NOSTR_KINDS.OFFER_NIP99])
    for (const event of publishedEvents) {
      expect(event.tags).toContainEqual(['client', NOSTR_CLIENT_TAG])
    }
  })

  it('emits exactly one client tag', async () => {
    const result = await svc.publishOffer({ ...baseOffer })
    expect(result!.tags.filter(t => t[0] === 'client')).toEqual([['client', NOSTR_CLIENT_TAG]])
  })
})
