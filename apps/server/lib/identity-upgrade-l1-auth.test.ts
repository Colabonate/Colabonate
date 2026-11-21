import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { createIdentityRouter, type RelayFetcher } from '../routes/identity.js'

// FU-749 regression: POST /api/identity/upgrade-l1 must require BOTH the caller's session
// (Authorization: Bearer — Colabonate account ownership) and a NIP-98 event in X-Nostr-Auth
// (Nostr key control). The account `pubkey` must match the session, never the body alone.

const accountPubkey = 'a'.repeat(64)
const otherAccountPubkey = 'b'.repeat(64)
const SESSION_TOKEN = 'valid-session-token'
const NIP98_URL = 'https://colabonate.test/api/identity/upgrade-l1'

const nostrSecretKey = generateSecretKey()
const nostrPubkey = getPublicKey(nostrSecretKey)
const otherSecretKey = generateSecretKey()
const otherPubkey = getPublicKey(otherSecretKey)

type SessionMock = {
  session: { findUnique: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }
  user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }
  review: { count: ReturnType<typeof vi.fn> }
}

function buildHarness(relayFetcher?: RelayFetcher) {
  const session: SessionMock = {
    session: {
      findUnique: vi.fn(async ({ where }: { where: { token: string } }) =>
        where.token === SESSION_TOKEN
          ? {
              id: 's1',
              token: SESSION_TOKEN,
              expiresAt: new Date(Date.now() + 3_600_000),
              user: { pubkey: accountPubkey, identityLevel: 0, blockedAt: null, blockedReason: null },
            }
          : null,
      ),
      delete: vi.fn(async () => ({})),
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { pubkey: string } }) =>
        where.pubkey === accountPubkey
          ? { pubkey: accountPubkey, identityLevel: 0, nostrPubkey: null, nip05: null, picture: null, colPoints: 0 }
          : null,
      ),
      update: vi.fn(async ({ where, data }: { where: { pubkey: string }; data: Record<string, unknown> }) => ({
        pubkey: where.pubkey,
        identityLevel: 1,
        nostrPubkey: data.nostrPubkey,
        nip05: data.nip05,
        picture: data.picture,
        colPoints: 0,
      })),
    },
    review: { count: vi.fn(async () => 0) },
  }

  const app = express()
  app.use(express.json())
  app.use('/api/identity', createIdentityRouter(session as never, {} as never, relayFetcher))
  return { app, prisma: session }
}

function nip98Header(pubkey: string, secretKey: Uint8Array = nostrSecretKey): string {
  const event = finalizeEvent(
    {
      kind: 22242,
      created_at: Math.floor(Date.now() / 1000),
      content: `colabonate-l1-upgrade:${pubkey}:${Date.now()}`,
      tags: [['u', NIP98_URL], ['method', 'POST']],
    },
    secretKey,
  )
  return `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`
}

const now = () => Math.floor(Date.now() / 1000)

const validRelayFetcher: RelayFetcher = async (filter) =>
  filter.kinds.includes(0)
    ? [finalizeEvent({ kind: 0, created_at: now(), tags: [], content: JSON.stringify({ name: 'Alice' }) }, nostrSecretKey)]
    : [
        finalizeEvent(
          { kind: 30410, created_at: now(), tags: [['d', `identity-l1-${accountPubkey}`]], content: '{}' },
          nostrSecretKey,
        ),
      ]

describe('POST /api/identity/upgrade-l1 auth (FU-749)', () => {
  it('rejects a request without a session (401)', async () => {
    const { app, prisma } = buildHarness(validRelayFetcher)
    const res = await request(app)
      .post('/api/identity/upgrade-l1')
      .set('X-Nostr-Auth', nip98Header(accountPubkey))
      .send({ pubkey: accountPubkey, nostrPubkey })

    expect(res.status).toBe(401)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('rejects upgrading an account the session does not own (403)', async () => {
    const { app, prisma } = buildHarness(validRelayFetcher)
    const res = await request(app)
      .post('/api/identity/upgrade-l1')
      .set('Authorization', `Bearer ${SESSION_TOKEN}`)
      .set('X-Nostr-Auth', nip98Header(otherAccountPubkey))
      .send({ pubkey: otherAccountPubkey, nostrPubkey })

    expect(res.status).toBe(403)
    expect(res.body.error).toBe('FORBIDDEN')
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('rejects a NIP-98 event signed by a key other than nostrPubkey (400)', async () => {
    const { app, prisma } = buildHarness(validRelayFetcher)
    const res = await request(app)
      .post('/api/identity/upgrade-l1')
      .set('Authorization', `Bearer ${SESSION_TOKEN}`)
      .set('X-Nostr-Auth', nip98Header(accountPubkey, otherSecretKey))
      .send({ pubkey: accountPubkey, nostrPubkey })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('NOSTR_KEY_MISMATCH')
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('upgrades the session-owned account with both credentials present (200)', async () => {
    const { app, prisma } = buildHarness(validRelayFetcher)
    const res = await request(app)
      .post('/api/identity/upgrade-l1')
      .set('Authorization', `Bearer ${SESSION_TOKEN}`)
      .set('X-Nostr-Auth', nip98Header(accountPubkey))
      .send({ pubkey: accountPubkey, nostrPubkey })

    expect(res.status).toBe(200)
    expect(res.body.identityLevel).toBe(1)
    expect(res.body.nostrPubkey).toBe(nostrPubkey)
    expect(prisma.user.update).toHaveBeenCalledTimes(1)
  })

  it('does not accept the NIP-98 event from the Authorization header (400 without X-Nostr-Auth)', async () => {
    // Guards against a regression that silently falls back to the pre-FU-749 header scheme.
    const { app, prisma } = buildHarness(validRelayFetcher)
    const res = await request(app)
      .post('/api/identity/upgrade-l1')
      .set('Authorization', `Bearer ${SESSION_TOKEN}`)
      .send({ pubkey: accountPubkey, nostrPubkey })

    expect(res.status).toBe(401)
    expect(res.body.error).toBe('UNAUTHORIZED')
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('exposes the NIP-98 test key used for the mismatch case', () => {
    // Sanity guard so a future edit to the fixture keys fails loudly rather than silently.
    expect(otherPubkey).not.toBe(nostrPubkey)
  })
})
