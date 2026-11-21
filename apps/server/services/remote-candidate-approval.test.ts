import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('../middleware/cache.js', () => ({ invalidateListCache: vi.fn(async () => {}) }))

import { approvePendingCandidates, runRemoteAutoApproveTick, SYSTEM_REVIEWER } from './remote-candidate-approval.js'
import { invalidateListCache } from '../middleware/cache.js'

// Minimal valid kind 30402 event that passes normalizeOfferEvent (title +
// sats price). `sig` is never verified here (that is the subscriber's job).
const RAW_EVENT = {
  id: 'evt-1',
  pubkey: 'a'.repeat(64),
  created_at: 1700000000,
  kind: 30402,
  tags: [['d', 'listing-1'], ['title', 'Test Listing'], ['price', '1000', 'sats']],
  content: 'A test listing',
  sig: 'b'.repeat(64),
}

function makeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cand-1',
    remoteEventId: 'evt-1',
    remoteRelay: 'wss://relay.example',
    remoteAuthor: 'a'.repeat(64),
    remoteDTag: 'listing-1',
    rawEvent: RAW_EVENT,
    normalized: {},
    status: 'PENDING_REVIEW',
    reviewedBy: null,
    reviewedAt: null,
    rejectedReason: null,
    promotedOfferId: null,
    fetchedAt: new Date('2026-11-01T00:00:00Z'),
    expiresAt: new Date('2026-12-01T00:00:00Z'),
    ...overrides,
  }
}

function makePrisma(settingsRow: Record<string, unknown> | null = null) {
  const tx = {
    user: { upsert: vi.fn(async () => ({})) },
    offer: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'offer-1' })),
      update: vi.fn(async () => ({ id: 'offer-1' })),
    },
    outboxEvent: { create: vi.fn(async () => ({})) },
    remoteOfferCandidate: { update: vi.fn(async () => ({})) },
  }
  const findMany = vi.fn(async () => [] as unknown[])
  const count = vi.fn(async () => 0)
  const candidateUpdate = vi.fn(async () => ({}))
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    foundationSettings: { findUnique: vi.fn(async () => settingsRow) },
    remoteOfferCandidate: { findMany, count, update: candidateUpdate },
  } as unknown as PrismaClient
  return { prisma, tx, findMany, count, candidateUpdate }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('approvePendingCandidates', () => {
  it('approves a valid candidate end-to-end with the given reviewer', async () => {
    const { prisma, tx, findMany, count } = makePrisma()
    findMany.mockImplementation(async () => [makeCandidate() as never])
    count.mockImplementation(async () => 0)

    const result = await approvePendingCandidates(prisma, { limit: 50, reviewerPubkey: 'admin-pk' })

    expect(result).toEqual({ approved: 1, failed: 0, failures: [], remainingPending: 0 })
    expect(tx.user.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { pubkey: 'a'.repeat(64) } }))
    expect(tx.offer.create).toHaveBeenCalledTimes(1)
    expect(tx.offer.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ title: 'Test Listing', priceSats: 1000, source: 'REMOTE', remoteDTag: 'listing-1' }),
    }))
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ aggregate: 'offer', aggregateId: 'offer-1', eventType: 'upsert' }),
    }))
    expect(tx.remoteOfferCandidate.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'APPROVED', reviewedBy: 'admin-pk', promotedOfferId: 'offer-1' }),
    }))
  })

  it('auto-rejects a candidate that no longer passes normalization', async () => {
    const { prisma, tx, findMany, candidateUpdate } = makePrisma()
    findMany.mockImplementation(async () => [makeCandidate({ rawEvent: { ...RAW_EVENT, kind: 30000 } }) as never])

    const result = await approvePendingCandidates(prisma, { limit: 50, reviewerPubkey: 'admin-pk' })

    expect(result.approved).toBe(0)
    expect(result.failed).toBe(1)
    expect(tx.offer.create).not.toHaveBeenCalled()
    expect(candidateUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REJECTED', rejectedReason: 'auto-rejected: failed normalization' }),
    }))
  })

  it('passes the pendingSince cutoff into both query and remaining count', async () => {
    const { prisma, findMany, count } = makePrisma()
    const since = new Date('2026-11-13T12:00:00Z')

    await approvePendingCandidates(prisma, { limit: 50, reviewerPubkey: 'admin-pk', pendingSince: since })

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'PENDING_REVIEW', fetchedAt: { lt: since } },
    }))
    expect(count).toHaveBeenCalledWith({ where: { status: 'PENDING_REVIEW', fetchedAt: { lt: since } } })
  })

  it('records a custom rejectReason when provided', async () => {
    const { prisma, findMany, candidateUpdate } = makePrisma()
    findMany.mockImplementation(async () => [makeCandidate({ rawEvent: { ...RAW_EVENT, kind: 30000 } }) as never])

    await approvePendingCandidates(prisma, {
      limit: 50,
      reviewerPubkey: 'admin-pk',
      rejectReason: 'auto-rejected by approve-all: failed normalization',
    })

    expect(candidateUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ rejectedReason: 'auto-rejected by approve-all: failed normalization' }),
    }))
  })
})

describe('runRemoteAutoApproveTick', () => {
  it('is a no-op when both modes are off (defaults)', async () => {
    const { prisma, findMany } = makePrisma(null)
    await runRemoteAutoApproveTick(prisma)
    expect(findMany).not.toHaveBeenCalled()
    expect(invalidateListCache).not.toHaveBeenCalled()
  })

  it('timer mode only selects candidates older than N days', async () => {
    const { prisma, findMany } = makePrisma({ remoteCandidatesAutoApprove: false, remoteCandidatesAutoApproveDays: 7 })
    const now = new Date('2026-11-20T12:00:00Z')

    await runRemoteAutoApproveTick(prisma, now)

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'PENDING_REVIEW', fetchedAt: { lt: new Date('2026-11-13T12:00:00Z') } },
    }))
  })

  it('timer mode with no aged candidates does not invalidate the cache', async () => {
    const { prisma } = makePrisma({ remoteCandidatesAutoApprove: false, remoteCandidatesAutoApproveDays: 7 })
    await runRemoteAutoApproveTick(prisma, new Date('2026-11-20T12:00:00Z'))
    expect(invalidateListCache).not.toHaveBeenCalled()
  })

  it('immediate mode drains the queue in looped batches and invalidates once', async () => {
    const { prisma, findMany, count, tx } = makePrisma({ remoteCandidatesAutoApprove: true, remoteCandidatesAutoApproveDays: 7 })
    // Batch 1 has one candidate and one remaining; batch 2 is empty.
    findMany.mockImplementation(async () => [makeCandidate() as never])
    count.mockImplementationOnce(async () => 1).mockImplementation(async () => 0)

    await runRemoteAutoApproveTick(prisma)

    expect(findMany).toHaveBeenCalledTimes(2)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'PENDING_REVIEW' } }))
    expect(tx.remoteOfferCandidate.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'APPROVED', reviewedBy: SYSTEM_REVIEWER }),
    }))
    expect(invalidateListCache).toHaveBeenCalledTimes(1)
    expect(invalidateListCache).toHaveBeenCalledWith('offers')
  })

  it('immediate mode takes precedence over the timer (no cutoff filter)', async () => {
    const { prisma, findMany } = makePrisma({ remoteCandidatesAutoApprove: true, remoteCandidatesAutoApproveDays: 7 })
    await runRemoteAutoApproveTick(prisma, new Date('2026-11-20T12:00:00Z'))
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'PENDING_REVIEW' } }))
  })
})
