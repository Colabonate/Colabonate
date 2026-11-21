import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'

process.env.NWC_SECRET_KEY = '0'.repeat(63) + '1' // 32-byte hex, test-only

import {
  getOrCreateCompanySigningKey,
  getOrCreateUserListingSigningKey,
  resolveOfferSigningKey,
  getOrCreatePlatformSigningKey,
} from './nostr-signing-identity.js'

function makeMockPrisma() {
  const companyStore = new Map<string, { nostrListingPubkey: string | null; nostrListingPrivkeyEnc: string | null }>()
  const userStore = new Map<string, { nostrListingPubkey: string | null; nostrListingPrivkeyEnc: string | null }>()
  let foundationSettings: { platformNostrPubkey: string | null; platformNostrPrivkeyEnc: string | null } | null = null

  return {
    company: {
      findUnique: vi.fn(async ({ where: { id } }: { where: { id: string } }) =>
        companyStore.get(id) ?? { nostrListingPubkey: null, nostrListingPrivkeyEnc: null }),
      update: vi.fn(async ({ where: { id }, data }: { where: { id: string }; data: { nostrListingPubkey: string; nostrListingPrivkeyEnc: string } }) => {
        companyStore.set(id, data)
        return { id, ...data }
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where: { pubkey } }: { where: { pubkey: string } }) =>
        userStore.get(pubkey) ?? { nostrListingPubkey: null, nostrListingPrivkeyEnc: null }),
      update: vi.fn(async ({ where: { pubkey }, data }: { where: { pubkey: string }; data: { nostrListingPubkey: string; nostrListingPrivkeyEnc: string } }) => {
        userStore.set(pubkey, data)
        return { pubkey, ...data }
      }),
    },
    foundationSettings: {
      findUnique: vi.fn(async () => foundationSettings ?? { platformNostrPubkey: null, platformNostrPrivkeyEnc: null }),
      upsert: vi.fn(async ({ create, update }: { create: { platformNostrPubkey: string; platformNostrPrivkeyEnc: string }; update: { platformNostrPubkey: string; platformNostrPrivkeyEnc: string } }) => {
        foundationSettings = foundationSettings ? update : create
        return { id: 1, ...foundationSettings }
      }),
    },
  } as unknown as PrismaClient
}

describe('nostr-signing-identity (ADR-412 D2)', () => {
  let prisma: PrismaClient

  beforeEach(() => {
    prisma = makeMockPrisma()
  })

  it('creates a new company signing key on first call, reuses it on subsequent calls', async () => {
    const first = await getOrCreateCompanySigningKey(prisma, 'company-1')
    expect(first.isNew).toBe(true)
    expect(first.pubkey).toMatch(/^[0-9a-f]{64}$/)

    const second = await getOrCreateCompanySigningKey(prisma, 'company-1')
    expect(second.isNew).toBe(false)
    expect(second.pubkey).toBe(first.pubkey)
    expect(Buffer.from(second.sk).toString('hex')).toBe(Buffer.from(first.sk).toString('hex'))
  })

  it('gives different companies different signing keys', async () => {
    const a = await getOrCreateCompanySigningKey(prisma, 'company-a')
    const b = await getOrCreateCompanySigningKey(prisma, 'company-b')
    expect(a.pubkey).not.toBe(b.pubkey)
  })

  it('creates a new user listing signing key on first call, reuses it on subsequent calls', async () => {
    const first = await getOrCreateUserListingSigningKey(prisma, 'user-pubkey-1')
    expect(first.isNew).toBe(true)

    const second = await getOrCreateUserListingSigningKey(prisma, 'user-pubkey-1')
    expect(second.isNew).toBe(false)
    expect(second.pubkey).toBe(first.pubkey)
  })

  it('resolveOfferSigningKey uses the company key when companyId is present', async () => {
    const identity = await resolveOfferSigningKey(prisma, { companyId: 'company-x', creatorPubkey: 'creator-1' })
    expect(prisma.company.findUnique).toHaveBeenCalled()
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    expect(identity.pubkey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('resolveOfferSigningKey falls back to the creator\'s own listing key without a companyId', async () => {
    const identity = await resolveOfferSigningKey(prisma, { companyId: null, creatorPubkey: 'creator-2' })
    expect(prisma.user.findUnique).toHaveBeenCalled()
    expect(prisma.company.findUnique).not.toHaveBeenCalled()
    expect(identity.pubkey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('getOrCreatePlatformSigningKey creates once on the FoundationSettings singleton, reuses it after', async () => {
    const first = await getOrCreatePlatformSigningKey(prisma)
    expect(first.isNew).toBe(true)
    expect(first.pubkey).toMatch(/^[0-9a-f]{64}$/)

    const second = await getOrCreatePlatformSigningKey(prisma)
    expect(second.isNew).toBe(false)
    expect(second.pubkey).toBe(first.pubkey)
    expect(Buffer.from(second.sk).toString('hex')).toBe(Buffer.from(first.sk).toString('hex'))
  })
})
