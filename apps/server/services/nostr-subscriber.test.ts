import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type { Event } from 'nostr-tools'
import { persistRemoteCandidate } from './nostr-subscriber.js'
import type { NormalizedRemoteOffer } from './nostr-normalizer.js'

const EVENT = {
  id: 'evt-1',
  pubkey: 'a'.repeat(64),
  created_at: 1700000000,
  kind: 30402,
  tags: [['d', 'listing-1'], ['title', 'Test Listing'], ['price', '1000', 'sats']],
  content: 'A test listing',
  sig: 'b'.repeat(64),
} as unknown as Event

const NORMALIZED = {
  remoteAuthor: 'a'.repeat(64),
  remoteRelay: 'wss://relay.example',
} as unknown as NormalizedRemoteOffer

function makePrisma(returnedRow: { id: string; status: string }) {
  const upsert = vi.fn(async () => returnedRow)
  const updateMany = vi.fn(async () => ({ count: 1 }))
  const prisma = {
    remoteOfferCandidate: { upsert, updateMany },
  } as unknown as PrismaClient
  return { prisma, upsert, updateMany }
}

describe('persistRemoteCandidate (ADR-423 re-queue fix)', () => {
  it('re-queues an EXPIRED candidate to PENDING_REVIEW on re-publish (CAS on status)', async () => {
    const { prisma, upsert, updateMany } = makePrisma({ id: 'cand-1', status: 'EXPIRED' })

    await persistRemoteCandidate(prisma, EVENT, NORMALIZED, 'listing-1')

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { remoteAuthor_remoteDTag: { remoteAuthor: 'a'.repeat(64), remoteDTag: 'listing-1' } },
    }))
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'cand-1', status: 'EXPIRED' },
      data: { status: 'PENDING_REVIEW' },
    })
  })

  it('leaves a REJECTED candidate terminal — a human decision is not resurrected', async () => {
    const { prisma, updateMany } = makePrisma({ id: 'cand-1', status: 'REJECTED' })

    await persistRemoteCandidate(prisma, EVENT, NORMALIZED, 'listing-1')

    expect(updateMany).not.toHaveBeenCalled()
  })

  it('does not touch a candidate that is still PENDING_REVIEW', async () => {
    const { prisma, updateMany } = makePrisma({ id: 'cand-1', status: 'PENDING_REVIEW' })

    await persistRemoteCandidate(prisma, EVENT, NORMALIZED, 'listing-1')

    expect(updateMany).not.toHaveBeenCalled()
  })

  it('falls back to remoteEventId identity for non-addressable events', async () => {
    const { prisma, upsert } = makePrisma({ id: 'cand-2', status: 'PENDING_REVIEW' })

    await persistRemoteCandidate(prisma, EVENT, NORMALIZED, null)

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { remoteEventId: 'evt-1' },
    }))
  })
})
