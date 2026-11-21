// ADR-240 D1 — HTTP contract test for the public LNURL-pay router. The
// resolvers are mocked: this asserts the wire format (LUD-06 payRequest, LUD-06
// error shape, amount bounds, handle normalisation) without a database or a
// Lightning wallet.
import express from 'express'
import request from 'supertest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createLnurlpRouter } from './lnurlp'
import { LnurlpError } from '../services/lnAddressResolver.js'

const mockResolve = vi.fn()
vi.mock('../services/lnAddressResolver.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/lnAddressResolver.js')>()
  return {
    ...actual,
    resolveUserLnAddressInvoice: (...args: unknown[]) => mockResolve(...args),
  }
})

const mockResolvePlatform = vi.fn()
vi.mock('../services/platformPaymentResolver.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/platformPaymentResolver.js')>()
  return {
    ...actual,
    resolvePlatformInvoice: (...args: unknown[]) => mockResolvePlatform(...args),
  }
})

const EXTERNAL_USER = { id: 'u1', lnAddressMode: 'EXTERNAL' as const }

function makeApp(findUnique: ReturnType<typeof vi.fn>) {
  const prisma = { user: { findUnique } } as unknown as PrismaClient
  const app = express()
  app.use('/.well-known/lnurlp', createLnurlpRouter(prisma))
  return app
}

beforeEach(() => {
  mockResolve.mockReset()
  mockResolvePlatform.mockReset()
  vi.stubEnv('LNURLP_DOMAIN', 'colabonate.app')
  vi.stubEnv('LNURLP_BASE_URL', 'https://colabonate.app')
  vi.stubEnv('LNURLP_MAX_SATS', '1000000')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /.well-known/lnurlp/:handle', () => {
  it('returns a LUD-06 payRequest for a configured handle (normalised)', async () => {
    const findUnique = vi.fn().mockResolvedValue(EXTERNAL_USER)
    const res = await request(makeApp(findUnique)).get('/.well-known/lnurlp/Alice')

    expect(res.status).toBe(200)
    expect(res.body.tag).toBe('payRequest')
    expect(res.body.callback).toBe('https://colabonate.app/.well-known/lnurlp/alice/callback')
    expect(res.body.minSendable).toBe(1000)
    expect(res.body.maxSendable).toBe(1_000_000_000)
    expect(res.headers['cache-control']).toBe('no-store')
    // LUD-06 clients read the document cross-origin; helmet's default CORP
    // would block that even with the wildcard CORS origin (index.ts).
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin')
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { lnAddressHandle: 'alice' } }),
    )
  })

  it('404s with the LUD-06 error shape for an unknown handle', async () => {
    const res = await request(makeApp(vi.fn().mockResolvedValue(null))).get('/.well-known/lnurlp/nobody')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ status: 'ERROR', reason: 'Lightning address not found' })
  })
})

describe('GET /.well-known/lnurlp/:handle/callback', () => {
  it('rejects a missing amount with 400 + ERROR', async () => {
    const res = await request(makeApp(vi.fn().mockResolvedValue(EXTERNAL_USER)))
      .get('/.well-known/lnurlp/alice/callback')
    expect(res.status).toBe(400)
    expect(res.body.status).toBe('ERROR')
  })

  it('rejects an amount below minSendable', async () => {
    const res = await request(makeApp(vi.fn().mockResolvedValue(EXTERNAL_USER)))
      .get('/.well-known/lnurlp/alice/callback?amount=999')
    expect(res.status).toBe(400)
    expect(res.body.status).toBe('ERROR')
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it('mints an invoice for a valid amount', async () => {
    mockResolve.mockResolvedValue({ bolt11: 'lnbc1test', paymentHash: 'hash' })
    const res = await request(makeApp(vi.fn().mockResolvedValue(EXTERNAL_USER)))
      .get('/.well-known/lnurlp/alice/callback?amount=21000')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ pr: 'lnbc1test', routes: [] })
    expect(mockResolve).toHaveBeenCalledWith(expect.anything(), 'u1', 21, expect.stringContaining('alice@colabonate.app'))
  })

  it('maps an expected resolver failure to a 400 ERROR', async () => {
    mockResolve.mockRejectedValue(new LnurlpError('NWC wallet not connected — connect one in Settings → Wallet'))
    const res = await request(makeApp(vi.fn().mockResolvedValue(EXTERNAL_USER)))
      .get('/.well-known/lnurlp/alice/callback?amount=21000')

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ status: 'ERROR', reason: 'NWC wallet not connected — connect one in Settings → Wallet' })
  })

  it('maps an unexpected upstream failure to a 502 without leaking detail', async () => {
    mockResolve.mockRejectedValue(new Error('ENOTFOUND alice@private.example'))
    const res = await request(makeApp(vi.fn().mockResolvedValue(EXTERNAL_USER)))
      .get('/.well-known/lnurlp/alice/callback?amount=21000')

    expect(res.status).toBe(502)
    expect(res.body).toEqual({ status: 'ERROR', reason: 'Could not create an invoice right now' })
    expect(JSON.stringify(res.body)).not.toContain('private.example')
  })
})

// ADR-387 D3 — Colabonate's own platform address is served by this same router.
describe('ADR-387 platform address', () => {
  it('serves the LUD-06 payRequest for the platform handle without a user lookup', async () => {
    vi.stubEnv('PLATFORM_NWC_URI', 'nostr+walletconnect://hub')
    const findUnique = vi.fn()

    const res = await request(makeApp(findUnique)).get('/.well-known/lnurlp/pay')

    expect(res.status).toBe(200)
    expect(res.body.tag).toBe('payRequest')
    expect(res.body.callback).toBe('https://colabonate.app/.well-known/lnurlp/pay/callback')
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('mints the platform invoice on our own treasury rail, not a user rail', async () => {
    vi.stubEnv('PLATFORM_NWC_URI', 'nostr+walletconnect://hub')
    mockResolvePlatform.mockResolvedValue({
      ok: true,
      rail: 'LN',
      invoice: { bolt11: 'lnbc1platform', paymentHash: 'hash' },
    })

    const res = await request(makeApp(vi.fn())).get('/.well-known/lnurlp/pay/callback?amount=21000')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ pr: 'lnbc1platform', routes: [] })
    expect(mockResolve).not.toHaveBeenCalled()
    expect(mockResolvePlatform).toHaveBeenCalledWith(21, expect.stringContaining('pay@colabonate.app'))
  })

  it('answers 503 in the LUD-06 shape when the configured rail resolves to not-configured', async () => {
    vi.stubEnv('PLATFORM_NWC_URI', 'nostr+walletconnect://hub')
    mockResolvePlatform.mockResolvedValue({ ok: false, reason: 'PLATFORM_PAYMENT_NOT_CONFIGURED' })

    const res = await request(makeApp(vi.fn())).get('/.well-known/lnurlp/pay/callback?amount=21000')

    expect(res.status).toBe(503)
    expect(res.body).toEqual({ status: 'ERROR', reason: 'Platform payments are not configured' })
  })

  it('enforces the amount bounds before touching the platform rail', async () => {
    vi.stubEnv('PLATFORM_NWC_URI', 'nostr+walletconnect://hub')

    const res = await request(makeApp(vi.fn())).get('/.well-known/lnurlp/pay/callback?amount=999')

    expect(res.status).toBe(400)
    expect(res.body.status).toBe('ERROR')
    expect(mockResolvePlatform).not.toHaveBeenCalled()
  })

  it('does not leak upstream detail when the platform rail fails', async () => {
    vi.stubEnv('PLATFORM_NWC_URI', 'nostr+walletconnect://hub')
    mockResolvePlatform.mockRejectedValue(new Error('relay nostr+walletconnect://secret@relay.example'))

    const res = await request(makeApp(vi.fn())).get('/.well-known/lnurlp/pay/callback?amount=21000')

    expect(res.status).toBe(502)
    expect(JSON.stringify(res.body)).not.toContain('secret')
  })

  it('falls through to the user lookup when no platform rail is configured', async () => {
    vi.stubEnv('PLATFORM_NWC_URI', '')
    vi.stubEnv('PLATFORM_LN_ADDRESS', '')
    const findUnique = vi.fn().mockResolvedValue(null)

    const res = await request(makeApp(findUnique)).get('/.well-known/lnurlp/pay')

    expect(res.status).toBe(404)
    expect(res.body).toEqual({ status: 'ERROR', reason: 'Lightning address not found' })
    expect(findUnique).toHaveBeenCalled()
  })
})
