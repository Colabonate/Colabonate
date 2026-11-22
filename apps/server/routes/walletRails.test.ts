// Wallet-rail contract tests (ADR-179/187/208/228/253).
//
// One HTTP-boundary test per payment rail the app can use, with mocked
// Prisma/NWC/Alby/provider seams — the counterpart to the beta-mode-only
// browser journeys. Together with wallet.prodGuard.test.ts this is the
// "every wallet payment option" contract for the server.
import express from 'express'
import request from 'supertest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createHash } from 'crypto'
import { createWalletRouter } from './wallet'

// --- seams -----------------------------------------------------------------
const mockPayInvoice = vi.fn()
const mockMakeInvoice = vi.fn()
const mockClose = vi.fn()
const mockGetInfo = vi.fn()

vi.mock('../services/nwcClient.js', () => {
  class NwcClient {
    constructor(public readonly uri: string) {}
    payInvoice = (...args: unknown[]) => mockPayInvoice(...args)
    makeInvoice = (...args: unknown[]) => mockMakeInvoice(...args)
    getInfo = (...args: unknown[]) => mockGetInfo(...args)
    close = () => mockClose()
  }
  return { NwcClient, parseNwcUri: vi.fn((uri: string) => ({ uri })) }
})

const mockDecrypt = vi.fn()
vi.mock('../lib/secretbox.js', () => ({
  encrypt: vi.fn((v: string) => `enc:${v}`),
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
  hasSecretKey: () => true,
}))

const mockCreateAlbyProvider = vi.fn()
vi.mock('../services/albyOauthProvider.js', () => ({
  createAlbyOauthProviderForUser: (...args: unknown[]) => mockCreateAlbyProvider(...args),
}))

const NWC_URI = 'nostr+walletconnect://abc?relay=wss%3A%2F%2Frelay.example&secret=deadbeef'
const PREIMAGE = 'aa'.repeat(32)
const PREIMAGE_HASH = createHash('sha256').update(Buffer.from(PREIMAGE, 'hex')).digest('hex')

// --- harness ---------------------------------------------------------------
function makePrisma(overrides: { wallet?: Record<string, unknown> | null; walletRows?: Record<string, unknown>[] } = {}) {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: 'u1', pubkey: 'pk1' }),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ lnAddressHandle: 'alice', lnAddressMode: 'EXTERNAL' }),
    },
    wallet: {
      findFirst: vi.fn().mockResolvedValue(overrides.wallet ?? null),
      findMany: vi.fn().mockResolvedValue(overrides.walletRows ?? []),
      create: vi.fn().mockResolvedValue({ id: 'w-new' }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue({ id: 'w-upserted', provider: 'WEBLN', mode: 'NON_CUSTODIAL' }),
    },
    ticket: { findMany: vi.fn().mockResolvedValue([]) },
    aiCreditPurchase: { findMany: vi.fn().mockResolvedValue([]) },
    mcpAccessPass: { findMany: vi.fn().mockResolvedValue([]) },
    workspaceRecharge: { findMany: vi.fn().mockResolvedValue([]) },
    supportTip: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn().mockResolvedValue([]),
  }
}

function makeApp(prisma: ReturnType<typeof makePrisma>, payments?: Record<string, unknown>) {
  const app = express()
  app.use(express.json())
  app.use(
    '/api/wallet',
    (req, _res, next) => {
      ;(req as express.Request & { authPubkey?: string }).authPubkey = 'pk1'
      next()
    },
    createWalletRouter(prisma as unknown as PrismaClient, payments as never),
  )
  return app
}

beforeEach(() => {
  vi.stubEnv('NWC_ENABLED', '1')
  mockPayInvoice.mockReset()
  mockMakeInvoice.mockReset()
  mockClose.mockReset()
  mockDecrypt.mockReset().mockReturnValue(NWC_URI)
  mockCreateAlbyProvider.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// --- custodial provider rail ----------------------------------------------
describe('POST /api/wallet/payments/send (custodial provider rail)', () => {
  it('400 without a bolt11', async () => {
    const res = await request(makeApp(makePrisma(), { payInvoice: mockPayInvoice })).post('/api/wallet/payments/send').send({})
    expect(res.status).toBe(400)
  })

  it('404 when the user has no active custodial wallet', async () => {
    const prisma = makePrisma({ wallet: null })
    const res = await request(makeApp(prisma, { payInvoice: mockPayInvoice }))
      .post('/api/wallet/payments/send')
      .send({ bolt11: 'lnbc1x' })
    expect(res.status).toBe(404)
  })

  it('settles a normal invoice through the provider', async () => {
    const prisma = makePrisma({ wallet: { id: 'w1', mode: 'CUSTODIAL', status: 'ACTIVE' } })
    mockPayInvoice.mockResolvedValue({ paymentHash: 'h1', status: 'SUCCESS', feeSats: 1 })
    const res = await request(makeApp(prisma, { payInvoice: mockPayInvoice }))
      .post('/api/wallet/payments/send')
      .send({ bolt11: 'lnbc1x' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true, paymentHash: 'h1', status: 'SUCCESS' })
  })

  it('dispatches an escrow hold invoice and rejects a duplicate dispatch', async () => {
    const prisma = makePrisma({ wallet: { id: 'w1', mode: 'CUSTODIAL', status: 'ACTIVE' } })
    mockPayInvoice.mockResolvedValue({ paymentHash: 'h', status: 'SUCCESS' })
    const app = makeApp(prisma, { payInvoice: mockPayInvoice })
    const bolt11 = 'lnbc-escrow-lock-1'

    const first = await request(app).post('/api/wallet/payments/send').send({ bolt11, escrow: true })
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ ok: true, dispatched: true, status: 'DISPATCHED' })

    const second = await request(app).post('/api/wallet/payments/send').send({ bolt11, escrow: true })
    expect(second.status).toBe(409)
    expect(second.body.error).toBe('DISPATCH_IN_PROGRESS')
  })
})

// --- NWC rail --------------------------------------------------------------
describe('POST /api/wallet/nwc/pay (NWC rail)', () => {
  it('503 when NWC is disabled on the server', async () => {
    vi.stubEnv('NWC_ENABLED', '0')
    const res = await request(makeApp(makePrisma())).post('/api/wallet/nwc/pay').send({ bolt11: 'lnbc1x' })
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('NWC_NOT_ENABLED')
  })

  it('400 without a bolt11', async () => {
    const res = await request(makeApp(makePrisma())).post('/api/wallet/nwc/pay').send({})
    expect(res.status).toBe(400)
  })

  it('400 WALLET_NOT_CONNECTED when no NWC row exists', async () => {
    const res = await request(makeApp(makePrisma({ wallet: null }))).post('/api/wallet/nwc/pay').send({ bolt11: 'lnbc1x' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('WALLET_NOT_CONNECTED')
  })

  it('500 NWC_DECRYPT_FAILED when the stored URI cannot be decrypted', async () => {
    mockDecrypt.mockImplementation(() => { throw new Error('bad key') })
    const prisma = makePrisma({ wallet: { id: 'w1', provider: 'NWC', nwcConnectionUriEnc: 'enc' } })
    const res = await request(makeApp(prisma)).post('/api/wallet/nwc/pay').send({ bolt11: 'lnbc1x' })
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('NWC_DECRYPT_FAILED')
  })

  it('returns the preimage + sha256 payment hash for a normal invoice (FU-757/758)', async () => {
    mockPayInvoice.mockResolvedValue({ preimage: PREIMAGE, feesPaidSats: 3 })
    const prisma = makePrisma({ wallet: { id: 'w1', provider: 'NWC', nwcConnectionUriEnc: 'enc' } })
    const res = await request(makeApp(prisma)).post('/api/wallet/nwc/pay').send({ bolt11: 'lnbc1x' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      ok: true,
      preimage: PREIMAGE,
      paymentHash: PREIMAGE_HASH,
      feesPaidSats: 3,
      status: 'SUCCESS',
    })
    expect(mockClose).toHaveBeenCalled()
    // never log/return the connection URI
    expect(JSON.stringify(res.body)).not.toContain('walletconnect')
  })

  it('dispatches an escrow hold invoice without blocking', async () => {
    mockPayInvoice.mockResolvedValue({ preimage: PREIMAGE })
    const prisma = makePrisma({ wallet: { id: 'w1', provider: 'NWC', nwcConnectionUriEnc: 'enc' } })
    const res = await request(makeApp(prisma)).post('/api/wallet/nwc/pay').send({ bolt11: 'lnbc-nwc-escrow-1', escrow: true })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, dispatched: true, status: 'DISPATCHED' })
  })
})

// --- Alby OAuth rail -------------------------------------------------------
describe('POST /api/wallet/alby/pay (Alby OAuth rail)', () => {
  it('rejects escrow invoices explicitly', async () => {
    const res = await request(makeApp(makePrisma())).post('/api/wallet/alby/pay').send({ bolt11: 'lnbc1x', escrow: true })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('NOT_SUPPORTED_BY_ALBY_OAUTH')
  })

  it('400 WALLET_NOT_CONNECTED when the Alby provider cannot be built', async () => {
    mockCreateAlbyProvider.mockRejectedValue(new Error('no alby wallet row'))
    const res = await request(makeApp(makePrisma())).post('/api/wallet/alby/pay').send({ bolt11: 'lnbc1x' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('WALLET_NOT_CONNECTED')
  })

  it('returns the provider result including the preimage (FU-758)', async () => {
    mockCreateAlbyProvider.mockResolvedValue({
      payInvoice: vi.fn().mockResolvedValue({ paymentHash: 'alb-h', status: 'SUCCESS', feeSats: 2, preimage: PREIMAGE }),
    })
    const res = await request(makeApp(makePrisma())).post('/api/wallet/alby/pay').send({ bolt11: 'lnbc1x' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, paymentHash: 'alb-h', status: 'SUCCESS', preimage: PREIMAGE })
  })
})

// --- beta-only DEMO rail ----------------------------------------------------
describe('GET /api/wallet keeps the DEMO rail out of non-beta contexts', () => {
  const demoWallet = {
    id: 'wd', userId: 'u1', provider: 'DEMO', mode: 'CUSTODIAL', status: 'ACTIVE',
    balanceSats: 0, isActive: true, walletId: null, accountId: null,
    lastSyncedAt: null, createdAt: new Date(), updatedAt: new Date(),
  }
  const lnbitsWallet = { ...demoWallet, id: 'wl', provider: 'LNBITS' }

  it('hides a stale DEMO wallet outside beta but keeps a dev LNBITS wallet', async () => {
    vi.stubEnv('BETA_MODE', '')
    vi.stubEnv('BETA_MODE_ALLOW_PRODUCTION', '')
    const prisma = makePrisma({ wallet: demoWallet, walletRows: [demoWallet, lnbitsWallet] })
    const res = await request(makeApp(prisma)).get('/api/wallet')

    expect(res.status).toBe(200)
    expect(res.body.wallet).toBeNull()
    expect(res.body.wallets.map((w: { id: string }) => w.id)).toEqual(['wl'])
  })

  it('still serves the DEMO wallet inside beta', async () => {
    vi.stubEnv('BETA_MODE', 'true')
    vi.stubEnv('BETA_MODE_ALLOW_PRODUCTION', 'true')
    const prisma = makePrisma({ wallet: demoWallet, walletRows: [demoWallet] })
    const res = await request(makeApp(prisma)).get('/api/wallet')

    expect(res.status).toBe(200)
    expect(res.body.wallet).toMatchObject({ id: 'wd', provider: 'DEMO' })
  })
})

// --- self-serve address (EXTERNAL prerequisite) ----------------------------
describe('PUT /api/wallet/ln-address — EXTERNAL needs a routable address', () => {
  it('persists a Lightning address supplied with the handle', async () => {
    const prisma = makePrisma()
    const res = await request(makeApp(prisma))
      .put('/api/wallet/ln-address')
      .send({ handle: 'dezooyi', mode: 'EXTERNAL', address: 'platform@example.com' })

    expect(res.status).toBe(200)
    const arg = prisma.user.update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(arg.data).toMatchObject({
      lnAddressHandle: 'dezooyi',
      lnAddressMode: 'EXTERNAL',
      lnAddress: 'platform@example.com',
    })
  })

  it('rejects a synthetic / non-routable address', async () => {
    const prisma = makePrisma()
    for (const address of ['abcd1234@colabonate.local', 'not-an-address', 'x@host.invalid']) {
      const res = await request(makeApp(prisma))
        .put('/api/wallet/ln-address')
        .send({ handle: 'dezooyi', mode: 'EXTERNAL', address })
      expect(res.status, address).toBe(400)
      expect(res.body.error, address).toBe('VALIDATION_ERROR')
    }
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it('rejects EXTERNAL when neither the body nor the account has an address', async () => {
    const prisma = makePrisma()
    const res = await request(makeApp(prisma))
      .put('/api/wallet/ln-address')
      .send({ handle: 'dezooyi', mode: 'EXTERNAL' })
    expect(res.status).toBe(400)
  })
})

// --- history (ticket-derived) ----------------------------------------------
describe('GET /api/wallet/transactions keeps DEMO-rail history out of non-beta', () => {
  it('excludes directPayRail=DEMO outside beta', async () => {
    vi.stubEnv('BETA_MODE', '')
    vi.stubEnv('BETA_MODE_ALLOW_PRODUCTION', '')
    const prisma = makePrisma()
    const res = await request(makeApp(prisma)).get('/api/wallet/transactions')

    expect(res.status).toBe(200)
    const where = prisma.ticket.findMany.mock.calls[0][0].where as Record<string, unknown>
    expect(where.NOT).toEqual({ directPayRail: 'DEMO' })
  })

  it('keeps DEMO-rail history inside beta', async () => {
    vi.stubEnv('BETA_MODE', 'true')
    vi.stubEnv('BETA_MODE_ALLOW_PRODUCTION', 'true')
    const prisma = makePrisma()
    const res = await request(makeApp(prisma)).get('/api/wallet/transactions')

    expect(res.status).toBe(200)
    const where = prisma.ticket.findMany.mock.calls[0][0].where as Record<string, unknown>
    expect(where).not.toHaveProperty('NOT')
  })

  it('exposes the ticket dimensions the wallet UX relies on', async () => {
    const prisma = makePrisma()
    prisma.ticket.findMany.mockResolvedValue([
      {
        id: 't1',
        buyerPubkey: 'pk1',
        sellerPubkey: 'someone-else',
        amountSats: 5000,
        escrowStatus: 'NONE',
        status: 'PENDING',
        paymentHash: 'ph',
        createdAt: new Date('2026-09-19T00:00:00Z'),
        visibility: 'PUBLIC',
        directPayRail: 'LN',
        escrowEnabled: false,
        offer: { title: 'Logo design', priceSats: 5000 },
      },
    ])
    const res = await request(makeApp(prisma)).get('/api/wallet/transactions')

    expect(res.status).toBe(200)
    expect(res.body.transactions[0]).toMatchObject({
      ticketId: 't1',
      offerTitle: 'Logo design',
      type: 'SENT',
      status: 'PENDING',
      directPayRail: 'LN',
      escrowEnabled: false,
      ticketStatus: 'PENDING',
    })
  })
})

// --- history union (non-ticket platform payments) ---------------------------
describe('GET /api/wallet/transactions unions non-ticket platform payments', () => {
  it('includes paid AI credit packs and MCP passes with ticketId null, newest first', async () => {
    vi.stubEnv('BETA_MODE', '')
    vi.stubEnv('BETA_MODE_ALLOW_PRODUCTION', '')
    const prisma = makePrisma()
    prisma.aiCreditPurchase.findMany.mockResolvedValue([
      {
        id: 'a1', pubkey: 'pk1', tier: 'starter', requests: 100, amountSats: 2600,
        rail: 'LN', paymentHash: 'ph-ai', status: 'PAID',
        createdAt: new Date('2026-09-23T19:40:00Z'),
      },
    ])
    prisma.mcpAccessPass.findMany.mockResolvedValue([
      {
        id: 'm1', pubkey: 'pk1', tier: 'week', amountSats: 7000,
        rail: 'LN', paymentHash: 'ph-mcp', status: 'PAID',
        createdAt: new Date('2026-09-23T19:30:00Z'),
      },
    ])

    const res = await request(makeApp(prisma)).get('/api/wallet/transactions')

    expect(res.status).toBe(200)
    const ai = res.body.transactions.find((t: { source?: string }) => t.source === 'ai-credits')
    expect(ai).toMatchObject({
      type: 'SENT',
      status: 'COMPLETED',
      amountSats: 2600,
      ticketId: null,
      directPayRail: 'LN',
      source: 'ai-credits',
    })
    expect(ai.offerTitle).toContain('100 requests')
    const mcp = res.body.transactions.find((t: { source?: string }) => t.source === 'mcp-pass')
    expect(mcp).toMatchObject({ ticketId: null, amountSats: 7000, directPayRail: 'LN' })
    expect(res.body.transactions[0].source).toBe('ai-credits')
  })

  it('excludes DEMO-rail pack payments outside beta', async () => {
    vi.stubEnv('BETA_MODE', '')
    vi.stubEnv('BETA_MODE_ALLOW_PRODUCTION', '')
    const prisma = makePrisma()
    await request(makeApp(prisma)).get('/api/wallet/transactions')

    const where = prisma.aiCreditPurchase.findMany.mock.calls[0][0].where as Record<string, unknown>
    expect(where.NOT).toEqual({ rail: 'DEMO' })
  })
})

// --- client projection (key material) --------------------------------------
describe('GET /api/wallet never ships key material (ADR-208 D3 / ADR-228 D3)', () => {
  it('omits nwcConnectionUriEnc (spend-capable ciphertext) but keeps display fields', async () => {
    const row = {
      id: 'w1',
      userId: 'u1',
      provider: 'NWC',
      mode: 'NON_CUSTODIAL',
      status: 'ACTIVE',
      balanceSats: 42,
      isActive: true,
      walletId: null,
      accountId: null,
      nwcConnectionUriEnc: 'CIPHERTEXT-MUST-NOT-LEAK',
      nwcWalletPubkey: 'ab'.repeat(32),
      nwcRelayUrls: 'wss://relay.example',
      nwcConnectedAt: new Date(),
      nwcLastSyncedAt: new Date(),
      lastSyncedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      cashuReceivePubkey: 'npub1not-in-client-type',
      cashuReceiveMintUrl: 'https://mint.example',
    }
    const res = await request(makeApp(makePrisma({ wallet: row }))).get('/api/wallet')

    expect(res.status).toBe(200)
    expect(res.body.wallet).not.toHaveProperty('nwcConnectionUriEnc')
    expect(res.body.wallet).not.toHaveProperty('cashuReceivePubkey')
    expect(res.body.wallet).not.toHaveProperty('cashuReceiveMintUrl')
    expect(res.body.wallet).toMatchObject({
      id: 'w1',
      provider: 'NWC',
      mode: 'NON_CUSTODIAL',
      nwcWalletPubkey: 'ab'.repeat(32),
      balance: { confirmedSats: 42 },
    })
    expect(JSON.stringify(res.body)).not.toContain('CIPHERTEXT-MUST-NOT-LEAK')
  })
})

// --- connect + Cashu receive ----------------------------------------------
describe('POST /api/wallet/connect (non-custodial connection)', () => {
  it('400 without a provider', async () => {
    const res = await request(makeApp(makePrisma())).post('/api/wallet/connect').send({})
    expect(res.status).toBe(400)
  })

  it('rejects server-owned / beta-only providers (DEMO, LNBITS, LIGHTSPARK, MOCK)', async () => {
    const app = makeApp(makePrisma())
    for (const provider of ['DEMO', 'LNBITS', 'LIGHTSPARK', 'MOCK']) {
      const res = await request(app).post('/api/wallet/connect').send({ provider })
      expect(res.status, provider).toBe(400)
      expect(res.body.error, provider).toBe('VALIDATION_ERROR')
    }
  })

  it('upserts the provider row and makes it active', async () => {
    const prisma = makePrisma()
    const res = await request(makeApp(prisma)).post('/api/wallet/connect').send({ provider: 'WEBLN' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ success: true, wallet: { id: 'w-upserted' } })
    expect(prisma.$transaction).toHaveBeenCalled()
  })
})

describe('Cashu receive preference (seller rail)', () => {
  it('400 when pubkey or mintUrl is missing', async () => {
    const app = makeApp(makePrisma())
    expect((await request(app).post('/api/wallet/cashu/receive-preference').send({}))).toMatchObject({ status: 400 })
    expect(
      (await request(app).post('/api/wallet/cashu/receive-preference').send({ pubkey: 'npub1x' })),
    ).toMatchObject({ status: 400 })
  })

  it('stores the CASHU row so the seller rail resolves', async () => {
    const prisma = makePrisma()
    const res = await request(makeApp(prisma))
      .post('/api/wallet/cashu/receive-preference')
      .send({ pubkey: 'npub1seller', mintUrl: 'https://mint.example' })

    expect(res.status).toBe(200)
    const arg = prisma.wallet.upsert.mock.calls[0][0] as { create: Record<string, unknown> }
    expect(arg.create).toMatchObject({
      provider: 'CASHU',
      mode: 'NON_CUSTODIAL',
      cashuReceivePubkey: 'npub1seller',
      cashuReceiveMintUrl: 'https://mint.example',
    })
  })

  it('removes the preference on DELETE', async () => {
    const prisma = makePrisma()
    const res = await request(makeApp(prisma)).delete('/api/wallet/cashu/receive-preference')
    expect(res.status).toBe(200)
    expect(prisma.wallet.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', provider: 'CASHU' } })
  })
})
