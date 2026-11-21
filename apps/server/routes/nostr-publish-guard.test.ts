/**
 * publishAndSyncOffer() — LOCAL-only source guard (incident 2026-11-20).
 *
 * The first run of `backfill-offer-nostr-publish.ts --all` had no source
 * filter and re-published REMOTE (foreign, ingested) listings under
 * Colabonate-custodied signing keys, with our `client` tag attached. The
 * choke-point guard in publishAndSyncOffer must keep every caller (create/edit
 * wiring, manual route, backfill scripts) from ever publishing a REMOTE offer.
 *
 * Run with:
 *   ./node_modules/.bin/vitest run apps/server/routes/nostr-publish-guard.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('../services/nostr-relay.js', () => ({
  nostrService: {
    connect: vi.fn(),
    publishOffer: vi.fn(),
    publishEntityProfile: vi.fn(),
  },
}))
vi.mock('../services/nostr-signing-identity.js', () => ({
  resolveOfferSigningKey: vi.fn(),
  hasSigningIdentityKey: vi.fn(() => false),
}))
vi.mock('../services/gamma-category-map.js', () => ({ syncProductGammaTags: vi.fn() }))

import { publishAndSyncOffer } from './nostr.js'
import { nostrService } from '../services/nostr-relay.js'

const publishOfferMock = nostrService.publishOffer as unknown as ReturnType<typeof vi.fn>

function makePrisma(offer: Record<string, unknown> | null): PrismaClient {
  return {
    offer: {
      findUnique: vi.fn().mockResolvedValue(offer),
      update: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient
}

const baseOffer = {
  id: 'offer-guard-test-1',
  title: 'Test Offer',
  description: 'Test description',
  priceSats: 1000,
  creatorPubkey: 'a'.repeat(64),
  images: [],
  gammaTags: [],
  offerMilestones: [],
  publishedAt: null,
  productId: null,
  visibility: 'PUBLIC',
}

describe('publishAndSyncOffer() — LOCAL-only source guard (incident 2026-11-20)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('returns null and never publishes for a REMOTE offer', async () => {
    const prisma = makePrisma({ ...baseOffer, source: 'REMOTE' })

    const result = await publishAndSyncOffer(prisma, baseOffer.id)

    expect(result).toBeNull()
    expect(publishOfferMock).not.toHaveBeenCalled()
    expect(prisma.offer.update).not.toHaveBeenCalled()
  })

  it('still skips PRIVATE offers (ADR-152, unchanged)', async () => {
    const prisma = makePrisma({ ...baseOffer, source: 'LOCAL', visibility: 'PRIVATE' })

    const result = await publishAndSyncOffer(prisma, baseOffer.id)

    expect(result).toBeNull()
    expect(publishOfferMock).not.toHaveBeenCalled()
  })

  it('publishes a LOCAL PUBLIC offer and syncs nostrEventId', async () => {
    publishOfferMock.mockResolvedValueOnce({ id: 'evt-1', kind: 30402, tags: [] })
    const prisma = makePrisma({ ...baseOffer, source: 'LOCAL' })

    const result = await publishAndSyncOffer(prisma, baseOffer.id)

    expect(result).toBe('evt-1')
    expect(publishOfferMock).toHaveBeenCalledTimes(1)
    expect(prisma.offer.update).toHaveBeenCalledWith({ where: { id: baseOffer.id }, data: { nostrEventId: 'evt-1' } })
  })

  it('returns null for an unknown offer id', async () => {
    const prisma = makePrisma(null)

    const result = await publishAndSyncOffer(prisma, 'missing')

    expect(result).toBeNull()
    expect(publishOfferMock).not.toHaveBeenCalled()
  })
})
