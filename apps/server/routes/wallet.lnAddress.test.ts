// ADR-240 addendum — HTTP contract for the self-serve Lightning-address
// settings write. Focused on the concurrency edge: the findFirst pre-check
// races a second claim, so the DB unique constraint (Prisma P2002) must surface
// as the same 409 HANDLE_TAKEN response, never a 500.
import express from 'express'
import request from 'supertest'
import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createWalletRouter } from './wallet'

function makePrisma(update: ReturnType<typeof vi.fn>) {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'u1',
        pubkey: 'pk1',
        lnAddressHandle: null,
        lnAddressMode: null,
        lnAddress: 'alice@getalby.com',
      }),
      // Pre-check sees the handle as free — the race happens at update().
      findFirst: vi.fn().mockResolvedValue(null),
      update,
    },
    wallet: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
  }
}

function makeApp(prisma: ReturnType<typeof makePrisma>) {
  const app = express()
  app.use(express.json())
  app.use(
    '/api/wallet',
    (req, _res, next) => {
      ;(req as express.Request & { authPubkey?: string }).authPubkey = 'pk1'
      next()
    },
    createWalletRouter(prisma as unknown as PrismaClient),
  )
  return app
}

describe('PUT /api/wallet/ln-address (ADR-240)', () => {
  it('maps a unique-constraint race (P2002) to 409 HANDLE_TAKEN', async () => {
    const update = vi.fn().mockRejectedValue(Object.assign(new Error('Unique constraint'), { code: 'P2002' }))
    const res = await request(makeApp(makePrisma(update)))
      .put('/api/wallet/ln-address')
      .send({ handle: 'alice', mode: 'EXTERNAL' })

    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'HANDLE_TAKEN', message: 'This handle is already taken' })
  })

  it('still surfaces an unexpected update failure as 500', async () => {
    const update = vi.fn().mockRejectedValue(new Error('connection reset'))
    const res = await request(makeApp(makePrisma(update)))
      .put('/api/wallet/ln-address')
      .send({ handle: 'alice', mode: 'EXTERNAL' })

    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Failed to save Lightning address settings')
  })
})
