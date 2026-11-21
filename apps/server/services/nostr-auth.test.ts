/**
 * verifyChallenge — ADR-401 D7.4 account resolution order.
 *
 * An exact `pubkey` match always wins; sovereign-key recovery via
 * `nostrPubkey` only applies when no account is keyed by the signing key, and
 * only on an unambiguous match. Prisma is an in-memory mock; signatures are
 * real (nostr-tools finalizeEvent / verifyEvent).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import type { PrismaClient } from '@prisma/client'
import { verifyChallenge } from './nostr-auth'

type UserRow = { pubkey: string; nostrPubkey: string | null; blockedAt: Date | null }

function makePrisma(users: UserRow[]) {
  const challenges = new Map<string, { nonce: string; issuedFor: string | null; createdAt: Date; consumedAt: Date | null }>()
  const sessions: { pubkey: string; token: string }[] = []
  const prisma = {
    nostrAuthChallenge: {
      findUnique: vi.fn(async ({ where }: { where: { nonce: string } }) => challenges.get(where.nonce) ?? null),
      updateMany: vi.fn(async ({ where, data }: { where: { nonce: string }; data: { consumedAt: Date } }) => {
        const c = challenges.get(where.nonce)
        if (!c || c.consumedAt) return { count: 0 }
        c.consumedAt = data.consumedAt
        return { count: 1 }
      }),
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { pubkey: string } }) =>
        users.find(u => u.pubkey === where.pubkey) ?? null),
      findMany: vi.fn(async ({ where, take }: { where: { nostrPubkey: string }; take: number }) =>
        users.filter(u => u.nostrPubkey === where.nostrPubkey).slice(0, take)),
      upsert: vi.fn(async ({ where, create }: { where: { pubkey: string }; create: UserRow }) => {
        const existing = users.find(u => u.pubkey === where.pubkey)
        if (existing) return existing
        const row = { ...create, blockedAt: null }
        users.push(row)
        return row
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    session: {
      create: vi.fn(async ({ data }: { data: { pubkey: string; token: string } }) => {
        sessions.push(data)
        return data
      }),
    },
  }
  const issue = (nonce: string) =>
    challenges.set(nonce, { nonce, issuedFor: null, createdAt: new Date(), consumedAt: null })
  return { prisma: prisma as unknown as PrismaClient, mock: prisma, issue, sessions, users }
}

function signChallenge(sk: Uint8Array, nonce: string) {
  return finalizeEvent(
    { kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['challenge', nonce]], content: '' },
    sk,
  )
}

let sovereignSk: Uint8Array
let sovereign: string
let deviceAccount: string

beforeEach(() => {
  sovereignSk = generateSecretKey()
  sovereign = getPublicKey(sovereignSk)
  deviceAccount = getPublicKey(generateSecretKey())
})

describe('verifyChallenge — ADR-401 D7.4 resolution order', () => {
  it('creates a new account keyed by the signer for an unknown key', async () => {
    const { prisma, issue, users } = makePrisma([])
    issue('n1')
    const result = await verifyChallenge(prisma, signChallenge(sovereignSk, 'n1'))
    expect(result?.pubkey).toBe(sovereign)
    expect(users.map(u => u.pubkey)).toEqual([sovereign])
  })

  it('recovers the account that bound the key as nostrPubkey when none is keyed by it', async () => {
    const { prisma, issue, sessions } = makePrisma([{ pubkey: deviceAccount, nostrPubkey: sovereign, blockedAt: null }])
    issue('n2')
    const result = await verifyChallenge(prisma, signChallenge(sovereignSk, 'n2'))
    expect(result?.pubkey).toBe(deviceAccount)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].pubkey).toBe(deviceAccount)
  })

  it('prefers the account keyed by the signer over one that bound it as nostrPubkey', async () => {
    const other = getPublicKey(generateSecretKey())
    const { prisma, issue, mock } = makePrisma([
      { pubkey: sovereign, nostrPubkey: other, blockedAt: null },
      { pubkey: deviceAccount, nostrPubkey: sovereign, blockedAt: null },
    ])
    issue('n3')
    const result = await verifyChallenge(prisma, signChallenge(sovereignSk, 'n3'))
    expect(result?.pubkey).toBe(sovereign)
    expect(mock.user.findMany).not.toHaveBeenCalled()
  })

  it('falls through to the signer account when the nostrPubkey binding is ambiguous', async () => {
    const second = getPublicKey(generateSecretKey())
    const { prisma, issue } = makePrisma([
      { pubkey: deviceAccount, nostrPubkey: sovereign, blockedAt: null },
      { pubkey: second, nostrPubkey: sovereign, blockedAt: null },
    ])
    issue('n4')
    const result = await verifyChallenge(prisma, signChallenge(sovereignSk, 'n4'))
    expect(result?.pubkey).toBe(sovereign)
  })

  it('refuses to recover a blocked account', async () => {
    const { prisma, issue, sessions } = makePrisma([{ pubkey: deviceAccount, nostrPubkey: sovereign, blockedAt: new Date() }])
    issue('n5')
    const result = await verifyChallenge(prisma, signChallenge(sovereignSk, 'n5'))
    expect(result).toBeNull()
    expect(sessions).toHaveLength(0)
  })

  it('rejects a replayed challenge before any account lookup', async () => {
    const { prisma, issue, mock } = makePrisma([{ pubkey: deviceAccount, nostrPubkey: sovereign, blockedAt: null }])
    issue('n6')
    const event = signChallenge(sovereignSk, 'n6')
    expect(await verifyChallenge(prisma, event)).not.toBeNull()
    mock.user.findUnique.mockClear()
    expect(await verifyChallenge(prisma, event)).toBeNull()
    expect(mock.user.findUnique).not.toHaveBeenCalled()
  })
})
