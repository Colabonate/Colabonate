// ADR-381 — production guard contract for the wallet routes.
//
// These branches are unreachable in the beta-mode e2e stack (playwright.config
// sets BETA_MODE=true), so they are covered here at the HTTP boundary with a
// mocked Prisma and stubbed env. See ADR-381 D2/D3/D4 + FU-753.
import express from 'express'
import request from 'supertest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createWalletRouter } from './wallet'

function makePrisma(overrides: {
  activeWallet?: Record<string, unknown> | null
  fallbackWallet?: Record<string, unknown> | null
  walletRows?: Record<string, unknown>[]
} = {}) {
  const findFirst = vi
    .fn()
    .mockResolvedValueOnce(overrides.activeWallet ?? null)
    .mockResolvedValueOnce(overrides.fallbackWallet ?? null)
  return {
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', pubkey: 'pk1', walletModeStrategy: 'HYBRID' }) },
    wallet: {
      findFirst,
      findMany: vi.fn().mockResolvedValue(overrides.walletRows ?? []),
      create: vi.fn().mockResolvedValue({ id: 'w-new', provider: 'DEMO' }),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn().mockResolvedValue([]),
  }
}

function makeApp(prisma: ReturnType<typeof makePrisma>) {
  const app = express()
  app.use(express.json())
  app.use(
    '/api/wallet',
    // stand-in for requireAuth(): sets the authenticated pubkey the routes read
    (req, _res, next) => {
      ;(req as express.Request & { authPubkey?: string }).authPubkey = 'pk1'
      next()
    },
    createWalletRouter(prisma as unknown as PrismaClient, undefined),
  )
  return app
}

function stubProduction() {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('BETA_MODE', '')
  vi.stubEnv('BETA_MODE_ALLOW_PRODUCTION', '')
}

function stubBetaProduction() {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('BETA_MODE', 'true')
  vi.stubEnv('BETA_MODE_ALLOW_PRODUCTION', 'true')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/wallet/create on a Direct-Pay-only production host (ADR-381 D3)', () => {
  beforeEach(() => stubProduction())

  it('is an explicit no-op and does not mint a custodial row', async () => {
    const prisma = makePrisma()
    const res = await request(makeApp(prisma)).post('/api/wallet/create').send({})

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, wallet: null, custodialUnavailable: true })
    expect(prisma.wallet.create).not.toHaveBeenCalled()
  })

  it('still returns an existing wallet untouched (idempotent bootstrap)', async () => {
    const existing = { id: 'w1', provider: 'NWC', mode: 'NON_CUSTODIAL', status: 'ACTIVE', isActive: true }
    const prisma = makePrisma({ activeWallet: existing })
    const res = await request(makeApp(prisma)).post('/api/wallet/create').send({})

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, wallet: existing, alreadyExists: true })
    expect(prisma.wallet.create).not.toHaveBeenCalled()
  })
})

describe('POST /api/wallet/create on the beta stack', () => {
  beforeEach(() => stubBetaProduction())

  it('still provisions the DEMO wallet (no regression from the ADR-381 guard)', async () => {
    const prisma = makePrisma()
    const res = await request(makeApp(prisma)).post('/api/wallet/create').send({})

    expect(res.status).toBe(200)
    expect(prisma.wallet.create).toHaveBeenCalledTimes(1)
    const arg = prisma.wallet.create.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(arg.data.provider).toBe('DEMO')
    expect(arg.data.mode).toBe('CUSTODIAL')
  })
})

describe('GET /api/wallet on a Direct-Pay-only production host (ADR-381 D4)', () => {
  beforeEach(() => stubProduction())

  it('hides unusable custodial providers from the active slot and the switcher', async () => {
    const prisma = makePrisma({
      activeWallet: { id: 'w1', provider: 'LNBITS', mode: 'CUSTODIAL', status: 'ACTIVE', isActive: true, userId: 'u1' },
      walletRows: [
        { id: 'w1', provider: 'LNBITS', mode: 'CUSTODIAL', status: 'ACTIVE', isActive: true },
        { id: 'w2', provider: 'NWC', mode: 'NON_CUSTODIAL', status: 'ACTIVE', isActive: false },
      ],
    })
    const res = await request(makeApp(prisma)).get('/api/wallet')

    expect(res.status).toBe(200)
    expect(res.body.wallet).toBeNull()
    expect(res.body.wallets.map((w: { id: string }) => w.id)).toEqual(['w2'])
  })

  it('also hides a DEMO wallet (beta-only rail, must never surface on prod)', async () => {
    const prisma = makePrisma({
      activeWallet: { id: 'wd', provider: 'DEMO', mode: 'CUSTODIAL', status: 'ACTIVE', isActive: true, userId: 'u1' },
      walletRows: [
        { id: 'wd', provider: 'DEMO', mode: 'CUSTODIAL', status: 'ACTIVE', isActive: true },
        { id: 'w2', provider: 'WEBLN', mode: 'NON_CUSTODIAL', status: 'ACTIVE', isActive: false },
      ],
    })
    const res = await request(makeApp(prisma)).get('/api/wallet')

    expect(res.status).toBe(200)
    expect(res.body.wallet).toBeNull()
    expect(res.body.wallets.map((w: { id: string }) => w.id)).toEqual(['w2'])
  })

  it('returns a healthy non-custodial wallet unchanged', async () => {
    const nwc = { id: 'w2', provider: 'NWC', mode: 'NON_CUSTODIAL', status: 'ACTIVE', isActive: true, balanceSats: 123 }
    const prisma = makePrisma({ activeWallet: nwc, walletRows: [nwc] })
    const res = await request(makeApp(prisma)).get('/api/wallet')

    expect(res.status).toBe(200)
    expect(res.body.wallet).toMatchObject({ id: 'w2', provider: 'NWC', balance: { confirmedSats: 123 } })
    expect(res.body.wallets).toHaveLength(1)
  })
})
