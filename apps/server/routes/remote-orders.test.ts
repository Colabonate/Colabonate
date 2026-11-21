// ADR-417 — HTTP contract tests for the remote-order (Zap Out) router.
// Prisma is an in-memory fake whose updateMany/create/findUnique really apply the
// `where` filters, so the compare-and-swap semantics are exercised. Auth goes
// through the real requireAuth middleware against a fake session table.
import express from 'express'
import request from 'supertest'
import { createHash } from 'node:crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { createRemoteOrdersRouter, type RemoteOrderDeps } from './remote-orders'
import type { PayeeResult, ResolvedPayee } from '../services/remote-payee'
import type { fetchRemoteInvoice } from '../services/remote-zap-invoice'

// Fake rows are loosely typed on purpose: they mirror Prisma rows for the fields the router touches.
type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const BUYER_SK = generateSecretKey()
const BUYER = getPublicKey(BUYER_SK)
const SELLER = 'd'.repeat(64)
const AUTHOR = 'c'.repeat(64)
const OTHER = 'e'.repeat(64)
const PREIMAGE = 'ab'.repeat(32)
const HASH = createHash('sha256').update(Buffer.from(PREIMAGE, 'hex')).digest('hex')
const FUTURE = () => new Date(Date.now() + 60 * 60 * 1000)

function makePrisma() {
  const offers = new Map<string, Row>()
  const orders = new Map<string, Row>()
  const sessions = new Map<string, string>()
  let seq = 0
  const clone = (row: Row | undefined | null): Row | null => (row ? { ...row } : null)
  const matches = (row: Row, where: Row): boolean => Object.entries(where).every(([k, v]) => row[k] === v)

  const prisma = {
    offer: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => clone(offers.get(where.id))),
    },
    remoteOrder: {
      create: vi.fn(async ({ data }: { data: Row }) => {
        const id = `ro_${++seq}`
        const now = new Date()
        const row: Row = {
          id,
          quantity: 1,
          zap: true,
          priceAmount: null,
          priceCurrency: null,
          rateSnapshot: null,
          bolt11: null,
          paymentHash: null,
          verifyUrl: null,
          invoiceExpiresAt: null,
          zapRequestId: null,
          preimage: null,
          paidAt: null,
          lastError: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        }
        orders.set(id, row)
        return clone(row)
      }),
      findUnique: vi.fn(async ({ where }: { where: Row }) => clone(orders.get(where.id))),
      findMany: vi.fn(async ({ where, take }: { where: Row; take?: number }) =>
        [...orders.values()]
          .filter((row) => matches(row, where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, take)
          .map((row) => clone(row)),
      ),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        let count = 0
        for (const row of orders.values()) {
          if (matches(row, where)) {
            Object.assign(row, data, { updatedAt: new Date() })
            count++
          }
        }
        return { count }
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = orders.get(where.id)
        if (!row) throw new Error('not found')
        Object.assign(row, data)
        return clone(row)
      }),
    },
    session: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        const pubkey = sessions.get(where.token)
        if (!pubkey) return null
        return {
          id: where.token,
          token: where.token,
          expiresAt: FUTURE(),
          user: { pubkey, identityLevel: 1, blockedAt: null, blockedReason: null },
        }
      }),
      delete: vi.fn(async () => ({})),
    },
  }

  sessions.set('t-buyer', BUYER)
  sessions.set('t-seller', SELLER)
  sessions.set('t-other', OTHER)

  return { prisma, offers, orders, sessions }
}

function offerRow(over: Row = {}): Row {
  return {
    id: 'off_1',
    source: 'REMOTE',
    status: 'ACTIVE',
    blockedAt: null,
    creatorPubkey: AUTHOR,
    remoteSellerPubkey: SELLER,
    remoteDTag: 'mercasats-187',
    priceSats: 21000,
    priceAmount: null,
    priceCurrency: null,
    ...over,
  }
}

function payeeOk(over: Partial<ResolvedPayee> = {}): PayeeResult {
  return {
    ok: true,
    payee: {
      pubkey: SELLER,
      role: 'seller',
      name: 'Seller',
      lud16: 'seller@example.com',
      zap: true,
      minSats: 1,
      maxSats: 1_000_000,
      lnurl: {
        callback: 'https://example.com/cb',
        lnurl: 'lnurl1xyz',
        minSendableMsats: 1000,
        maxSendableMsats: 1_000_000_000,
        metadataHash: 'ff'.repeat(32),
        allowsNostr: true,
        nostrPubkey: 'e'.repeat(64),
      },
      ...over,
    },
  }
}

function makeZapRequest(amountMsats = 21_000_000, offerDTag = 'mercasats-187') {
  return finalizeEvent(
    {
      kind: 9734,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', SELLER],
        ['amount', String(amountMsats)],
        ['a', `30402:${AUTHOR}:${offerDTag}`],
        ['relays', 'wss://relay.example'],
      ],
      content: '',
    },
    BUYER_SK,
  )
}

describe('ADR-417 remote-orders router', () => {
  let store: ReturnType<typeof makePrisma>
  let overrides: Partial<RemoteOrderDeps>
  let resolvePayee: ReturnType<typeof vi.fn>
  let fetchInvoice: ReturnType<typeof vi.fn>
  let verifySettlement: ReturnType<typeof vi.fn>
  let findZapReceiptPreimage: ReturnType<typeof vi.fn>

  function makeApp(extra: Partial<RemoteOrderDeps> = {}) {
    const app = express()
    app.use(express.json())
    app.use('/api/remote-orders', createRemoteOrdersRouter(store.prisma as unknown as PrismaClient, { ...overrides, ...extra }))
    return app
  }

  function row(id: string): Row {
    const found = store.orders.get(id)
    if (!found) throw new Error(`no order ${id}`)
    return found
  }

  async function createOrder(app: express.Express, body: Row = { offerId: 'off_1' }, token = 't-buyer') {
    return request(app).post('/api/remote-orders').set('Authorization', `Bearer ${token}`).send(body)
  }

  async function invoiceFor(app: express.Express, id: string, body: Row = {}, token = 't-buyer') {
    return request(app).post(`/api/remote-orders/${id}/invoice`).set('Authorization', `Bearer ${token}`).send(body)
  }

  beforeEach(() => {
    store = makePrisma()
    store.offers.set('off_1', offerRow())
    resolvePayee = vi.fn(async () => payeeOk())
    fetchInvoice = vi.fn(async () => ({
      bolt11: 'lnbc210n1testinvoice',
      paymentHash: HASH,
      expiresAt: FUTURE(),
    }))
    verifySettlement = vi.fn(async () => null)
    findZapReceiptPreimage = vi.fn(async () => null)
    overrides = {
      resolvePayee: resolvePayee as unknown as RemoteOrderDeps['resolvePayee'],
      getRates: vi.fn(async () => ({})),
      fetchInvoice: fetchInvoice as unknown as typeof fetchRemoteInvoice,
      verifySettlement: verifySettlement as unknown as RemoteOrderDeps['verifySettlement'],
      findZapReceiptPreimage: findZapReceiptPreimage as unknown as RemoteOrderDeps['findZapReceiptPreimage'],
      now: () => new Date(),
      maxTxSats: () => 210_000,
      relays: () => ['wss://relay.example'],
    }
  })

  describe('GET /payee/:offerId (public preview)', () => {
    it('reports NOT_REMOTE for a non-remote offer', async () => {
      store.offers.set('off_1', offerRow({ source: 'LOCAL' }))
      const res = await request(makeApp()).get('/api/remote-orders/payee/off_1')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ orderable: false, reason: 'NOT_REMOTE' })
    })

    it('returns the payee and quote for an orderable offer without any LNURL internals', async () => {
      const res = await request(makeApp()).get('/api/remote-orders/payee/off_1')
      expect(res.status).toBe(200)
      expect(res.body.orderable).toBe(true)
      expect(res.body.payee).toMatchObject({
        pubkey: SELLER,
        role: 'seller',
        lud16: 'seller@example.com',
        zap: true,
        minSats: 1,
        maxSats: 1_000_000,
      })
      expect('lnurl' in res.body.payee).toBe(false)
      expect(res.body.quote).toEqual({ amountSats: 21000, basis: 'sats', quantity: 1 })
      expect(JSON.stringify(res.body)).not.toContain('lnurl1xyz')
      expect(JSON.stringify(res.body)).not.toContain('callback')
    })

    it('returns 404 OFFER_NOT_FOUND for an unknown offer', async () => {
      const res = await request(makeApp()).get('/api/remote-orders/payee/missing')
      expect(res.status).toBe(404)
      expect(res.body.code).toBe('OFFER_NOT_FOUND')
    })

    it.each(['NO_PAYEE', 'NO_LIGHTNING_ADDRESS', 'LNURL_UNREACHABLE'] as const)(
      'maps a payee failure %s to orderable:false',
      async (reason) => {
        resolvePayee.mockResolvedValue({ ok: false, reason })
        const res = await request(makeApp()).get('/api/remote-orders/payee/off_1')
        expect(res.body).toEqual({ orderable: false, reason })
      },
    )

    it('maps an unconvertible currency to PRICE_NOT_CONVERTIBLE', async () => {
      store.offers.set('off_1', offerRow({ priceCurrency: 'xyz', priceAmount: '10' }))
      const res = await request(makeApp()).get('/api/remote-orders/payee/off_1')
      expect(res.body).toEqual({ orderable: false, reason: 'PRICE_NOT_CONVERTIBLE' })
    })

    it('maps an amount above the launch cap to ABOVE_LAUNCH_CAP', async () => {
      const res = await request(makeApp({ maxTxSats: () => 1000 })).get('/api/remote-orders/payee/off_1')
      expect(res.body).toEqual({ orderable: false, reason: 'ABOVE_LAUNCH_CAP' })
    })

    it('maps an amount outside the payee bounds to AMOUNT_OUT_OF_RANGE', async () => {
      resolvePayee.mockResolvedValue(payeeOk({ maxSats: 100 }))
      const res = await request(makeApp()).get('/api/remote-orders/payee/off_1')
      expect(res.body).toEqual({ orderable: false, reason: 'AMOUNT_OUT_OF_RANGE' })
    })

    it('converts a fiat price with the rate proxy and reports the basis', async () => {
      store.offers.set('off_1', offerRow({ priceCurrency: 'eur', priceAmount: '10', priceSats: 0 }))
      overrides.getRates = vi.fn(async () => ({ eur: { price: 50_000 } }))
      const res = await request(makeApp()).get('/api/remote-orders/payee/off_1')
      expect(res.body.orderable).toBe(true)
      expect(res.body.quote).toMatchObject({ amountSats: 20000, basis: 'rate', priceAmount: '10', priceCurrency: 'eur' })
    })

    it('reports zap:false when the listing has no d-tag', async () => {
      store.offers.set('off_1', offerRow({ remoteDTag: null }))
      const res = await request(makeApp()).get('/api/remote-orders/payee/off_1')
      expect(res.body.payee.zap).toBe(false)
    })

    it.each(['0', '101', 'abc'])('rejects quantity %s with 400 BAD_REQUEST', async (quantity) => {
      const res = await request(makeApp()).get(`/api/remote-orders/payee/off_1?quantity=${quantity}`)
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('BAD_REQUEST')
    })
  })

  describe('POST / (create QUOTED order)', () => {
    it('rejects an unauthenticated request with 401', async () => {
      const res = await request(makeApp()).post('/api/remote-orders').send({ offerId: 'off_1' })
      expect(res.status).toBe(401)
    })

    it('creates a QUOTED order with a 10 minute quote window and no LNURL internals', async () => {
      const before = Date.now()
      const res = await createOrder(makeApp())
      expect(res.status).toBe(201)
      expect(res.body.order.status).toBe('QUOTED')
      expect(res.body.order.amountSats).toBe(21000)
      expect(res.body.order.payee).toMatchObject({ pubkey: SELLER, role: 'seller', zap: true })
      expect('lnurl' in res.body.order.payee).toBe(false)
      const expiresAt = new Date(res.body.order.quoteExpiresAt).getTime()
      expect(expiresAt - before).toBeGreaterThanOrEqual(10 * 60 * 1000 - 1000)
      expect(expiresAt - before).toBeLessThanOrEqual(10 * 60 * 1000 + 5000)
    })

    it('returns a zap request template only when the order is a zap', async () => {
      const res = await createOrder(makeApp())
      expect(res.body.zapRequestTemplate).toEqual({
        payeePubkey: SELLER,
        amountMsats: 21_000_000,
        lnurl: 'lnurl1xyz',
        relays: ['wss://relay.example'],
        listingAddress: `30402:${AUTHOR}:mercasats-187`,
      })
    })

    it('omits the template and stores zap:false for a payee without NIP-57 support', async () => {
      resolvePayee.mockResolvedValue(payeeOk({ zap: false }))
      const res = await createOrder(makeApp())
      expect(res.status).toBe(201)
      expect(res.body.zapRequestTemplate).toBeUndefined()
      expect(res.body.order.payee.zap).toBe(false)
    })

    it('stores the rate snapshot when the quote used a rate', async () => {
      store.offers.set('off_1', offerRow({ priceCurrency: 'eur', priceAmount: '10', priceSats: 0 }))
      overrides.getRates = vi.fn(async () => ({ eur: { price: 50_000 } }))
      const res = await createOrder(makeApp())
      expect(res.status).toBe(201)
      const stored = row(res.body.order.id)
      expect(stored.rateSnapshot).toMatchObject({ currency: 'eur', btcPrice: 50_000 })
      expect(stored.priceAmount).toBe('10')
      expect(stored.priceCurrency).toBe('eur')
    })

    it('rejects a buyer who is the payee with NOT_ORDERABLE NO_PAYEE', async () => {
      const res = await createOrder(makeApp(), { offerId: 'off_1' }, 't-seller')
      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({ code: 'NOT_ORDERABLE', reason: 'NO_PAYEE' })
      expect(store.orders.size).toBe(0)
    })

    it('rejects an amount above the launch cap with NOT_ORDERABLE and creates nothing', async () => {
      const res = await createOrder(makeApp({ maxTxSats: () => 1000 }))
      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({ code: 'NOT_ORDERABLE', reason: 'ABOVE_LAUNCH_CAP' })
      expect(store.orders.size).toBe(0)
    })

    it('returns 404 for an unknown offer and 400 for a bad body', async () => {
      const missing = await createOrder(makeApp(), { offerId: 'nope' })
      expect(missing.status).toBe(404)
      const bad = await createOrder(makeApp(), { offerId: 'off_1', quantity: 0 })
      expect(bad.status).toBe(400)
      expect(bad.body.code).toBe('BAD_REQUEST')
    })
  })

  describe('POST /:id/invoice', () => {
    async function quoted(app: express.Express) {
      const created = await createOrder(app)
      return created.body.order.id as string
    }

    it('fetches the invoice with the zap request and stores it as INVOICED', async () => {
      const app = makeApp()
      const id = await quoted(app)
      const zapRequest = makeZapRequest()
      const res = await invoiceFor(app, id, { zapRequest })
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ bolt11: 'lnbc210n1testinvoice', paymentHash: HASH })
      expect(res.body.order.status).toBe('INVOICED')
      expect(res.body.order.bolt11).toBe('lnbc210n1testinvoice')
      expect(fetchInvoice).toHaveBeenCalledTimes(1)
      const input = fetchInvoice.mock.calls[0][0]
      expect(input).toMatchObject({ callback: 'https://example.com/cb', lnurl: 'lnurl1xyz', amountSats: 21000 })
      expect(input.zapRequestJson).toBe(JSON.stringify(zapRequest))
    })

    it('returns the stored invoice on a second call without another upstream request', async () => {
      const app = makeApp()
      const id = await quoted(app)
      const first = await invoiceFor(app, id, { zapRequest: makeZapRequest() })
      const second = await invoiceFor(app, id, {})
      expect(second.status).toBe(200)
      expect(second.body.bolt11).toBe(first.body.bolt11)
      expect(fetchInvoice).toHaveBeenCalledTimes(1)
    })

    it('does not expose the zap request id, verify url or preimage in the order view', async () => {
      const app = makeApp()
      const id = await quoted(app)
      const res = await invoiceFor(app, id, { zapRequest: makeZapRequest() })
      expect(res.body.order.zapRequestId).toBeUndefined()
      expect(res.body.order.verifyUrl).toBeUndefined()
      expect(res.body.order.preimage).toBeUndefined()
      expect(res.body.order.rateSnapshot).toBeUndefined()
    })

    it('forbids a caller who is not the buyer', async () => {
      const app = makeApp()
      const id = await quoted(app)
      const res = await invoiceFor(app, id, { zapRequest: makeZapRequest() }, 't-other')
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('FORBIDDEN')
    })

    it('returns 404 for an unknown order', async () => {
      const res = await invoiceFor(makeApp(), 'ro_missing', {})
      expect(res.status).toBe(404)
    })

    it('expires an overdue quote and returns 409 QUOTE_EXPIRED', async () => {
      const app = makeApp()
      const id = await quoted(app)
      row(id).quoteExpiresAt = new Date(Date.now() - 1000)
      const res = await invoiceFor(app, id, { zapRequest: makeZapRequest() })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('QUOTE_EXPIRED')
      expect(row(id).status).toBe('EXPIRED')
      expect(fetchInvoice).not.toHaveBeenCalled()
    })

    it('requires a zap request for a zap order', async () => {
      const app = makeApp()
      const id = await quoted(app)
      const res = await invoiceFor(app, id, {})
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('ZAP_REQUEST_INVALID')
      expect(fetchInvoice).not.toHaveBeenCalled()
    })

    it('rejects a zap request with the wrong amount', async () => {
      const app = makeApp()
      const id = await quoted(app)
      const res = await invoiceFor(app, id, { zapRequest: makeZapRequest(1_000_000) })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('ZAP_REQUEST_INVALID')
      expect(fetchInvoice).not.toHaveBeenCalled()
    })

    it('refuses to invoice when the payee address changed since the quote', async () => {
      const app = makeApp()
      const id = await quoted(app)
      resolvePayee.mockResolvedValue(payeeOk({ lud16: 'other@example.com' }))
      const res = await invoiceFor(app, id, { zapRequest: makeZapRequest() })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('INVALID_STATE')
      expect(fetchInvoice).not.toHaveBeenCalled()
    })

    it('keeps the order QUOTED and returns 502 when the upstream invoice request fails', async () => {
      fetchInvoice.mockRejectedValue(new Error('LNURL callback HTTP 500'))
      const app = makeApp()
      const id = await quoted(app)
      const res = await invoiceFor(app, id, { zapRequest: makeZapRequest() })
      expect(res.status).toBe(502)
      expect(res.body.code).toBe('UPSTREAM_ERROR')
      expect(row(id).status).toBe('QUOTED')
      expect(row(id).lastError).toBe('invoice request failed')
    })

    it('returns 409 when the order left QUOTED while the invoice was being fetched', async () => {
      const app = makeApp()
      const id = await quoted(app)
      fetchInvoice.mockImplementation(async () => {
        row(id).status = 'EXPIRED' // simulates a concurrent transition during the upstream call
        return { bolt11: 'lnbc1raced', paymentHash: HASH, expiresAt: FUTURE() }
      })
      const res = await invoiceFor(app, id, { zapRequest: makeZapRequest() })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('INVALID_STATE')
      expect(row(id).bolt11).toBeNull()
    })

    it('ignores a supplied zap request for a plain (non-zap) order', async () => {
      store.offers.set('off_1', offerRow({ remoteDTag: null }))
      const app = makeApp()
      const id = await quoted(app)
      const res = await invoiceFor(app, id, { zapRequest: 'not-an-event' })
      expect(res.status).toBe(200)
      expect(fetchInvoice.mock.calls[0][0].zapRequestJson).toBeUndefined()
    })
  })

  describe('POST /:id/confirm', () => {
    async function invoiced(app: express.Express) {
      const created = await createOrder(app)
      const id = created.body.order.id as string
      await invoiceFor(app, id, { zapRequest: makeZapRequest() })
      return id
    }

    function confirm(app: express.Express, id: string, body: Row, token = 't-buyer') {
      return request(app).post(`/api/remote-orders/${id}/confirm`).set('Authorization', `Bearer ${token}`).send(body)
    }

    it('marks the order PAID for the correct preimage and never returns the preimage', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      const res = await confirm(app, id, { preimage: PREIMAGE })
      expect(res.status).toBe(200)
      expect(res.body.order.status).toBe('PAID')
      expect(res.body.order.paidAt).toBeDefined()
      expect(JSON.stringify(res.body)).not.toContain(PREIMAGE)
      expect(row(id).preimage).toBe(PREIMAGE)
    })

    it('rejects a wrong preimage and leaves the order INVOICED', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      const res = await confirm(app, id, { preimage: 'cd'.repeat(32) })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('PREIMAGE_MISMATCH')
      expect(row(id).status).toBe('INVOICED')
    })

    it('rejects a non-hex or wrong-length preimage with 400 BAD_REQUEST', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      const res = await confirm(app, id, { preimage: 'zz'.repeat(32) })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('BAD_REQUEST')
      const short = await confirm(app, id, { preimage: 'ab'.repeat(16) })
      expect(short.status).toBe(400)
    })

    it('is idempotent once the order is PAID', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      await confirm(app, id, { preimage: PREIMAGE })
      const again = await confirm(app, id, { preimage: PREIMAGE })
      expect(again.status).toBe(200)
      expect(again.body.order.status).toBe('PAID')
    })

    it('forbids a caller who is not the buyer', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      const res = await confirm(app, id, { preimage: PREIMAGE }, 't-other')
      expect(res.status).toBe(403)
    })

    it('returns 409 for an order that was never invoiced', async () => {
      const app = makeApp()
      const created = await createOrder(app)
      const res = await confirm(app, created.body.order.id, { preimage: PREIMAGE })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('INVALID_STATE')
    })
  })

  describe('GET /:id (buyer status and LUD-21 refresh)', () => {
    async function invoiced(app: express.Express, verifyUrl = 'https://example.com/verify/abc') {
      const created = await createOrder(app)
      const id = created.body.order.id as string
      await invoiceFor(app, id, { zapRequest: makeZapRequest() })
      row(id).verifyUrl = verifyUrl
      return id
    }

    function get(app: express.Express, id: string, token = 't-buyer') {
      return request(app).get(`/api/remote-orders/${id}`).set('Authorization', `Bearer ${token}`)
    }

    it('marks PAID when LUD-21 verify reports settled with the matching preimage', async () => {
      verifySettlement.mockResolvedValue({ settled: true, preimage: PREIMAGE })
      const app = makeApp()
      const id = await invoiced(app)
      const res = await get(app, id)
      expect(res.status).toBe(200)
      expect(res.body.order.status).toBe('PAID')
      expect(verifySettlement).toHaveBeenCalledWith('https://example.com/verify/abc')
    })

    it('does not mark PAID when settled comes without a preimage', async () => {
      verifySettlement.mockResolvedValue({ settled: true })
      const app = makeApp()
      const id = await invoiced(app)
      const res = await get(app, id)
      expect(res.body.order.status).toBe('INVOICED')
    })

    it('does not mark PAID when the verify preimage does not hash to the payment hash', async () => {
      verifySettlement.mockResolvedValue({ settled: true, preimage: 'cd'.repeat(32) })
      const app = makeApp()
      const id = await invoiced(app)
      const res = await get(app, id)
      expect(res.body.order.status).toBe('INVOICED')
      expect(row(id).status).toBe('INVOICED')
    })

    it('throttles LUD-21 refreshes to one call per 10 seconds per order', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      await get(app, id)
      await get(app, id)
      expect(verifySettlement).toHaveBeenCalledTimes(1)
    })

    describe('zap receipt signal (FU-1003)', () => {
      it('marks PAID from a zap receipt preimage when the provider has no LUD-21 verify URL', async () => {
        findZapReceiptPreimage.mockResolvedValue(PREIMAGE)
        const app = makeApp()
        const id = await invoiced(app)
        row(id).verifyUrl = null
        const res = await get(app, id)
        expect(res.body.order.status).toBe('PAID')
        expect(verifySettlement).not.toHaveBeenCalled()
        expect(findZapReceiptPreimage).toHaveBeenCalledWith(
          expect.objectContaining({ payeePubkey: SELLER, bolt11: 'lnbc210n1testinvoice', paymentHash: HASH }),
        )
      })

      it('falls back to the receipt when LUD-21 verify reports nothing settled', async () => {
        verifySettlement.mockResolvedValue({ settled: false })
        findZapReceiptPreimage.mockResolvedValue(PREIMAGE)
        const app = makeApp()
        const id = await invoiced(app)
        const res = await get(app, id)
        expect(res.body.order.status).toBe('PAID')
      })

      it('does not mark PAID when the receipt preimage does not hash to the payment hash', async () => {
        findZapReceiptPreimage.mockResolvedValue('cd'.repeat(32))
        const app = makeApp()
        const id = await invoiced(app)
        row(id).verifyUrl = null
        const res = await get(app, id)
        expect(res.body.order.status).toBe('INVOICED')
      })

      it('does not look up receipts when the order has no zap (plain LNURL-pay)', async () => {
        const app = makeApp()
        const id = await invoiced(app)
        row(id).verifyUrl = null
        row(id).zap = false
        await get(app, id)
        expect(findZapReceiptPreimage).not.toHaveBeenCalled()
      })

      it('survives a failing receipt lookup and shares the refresh throttle', async () => {
        findZapReceiptPreimage.mockRejectedValue(new Error('relay down'))
        const app = makeApp()
        const id = await invoiced(app)
        row(id).verifyUrl = null
        const first = await get(app, id)
        expect(first.status).toBe(200)
        expect(first.body.order.status).toBe('INVOICED')
        await get(app, id)
        expect(findZapReceiptPreimage).toHaveBeenCalledTimes(1)
      })
    })


    it('never returns the preimage after payment', async () => {
      verifySettlement.mockResolvedValue({ settled: true, preimage: PREIMAGE })
      const app = makeApp()
      const id = await invoiced(app)
      const res = await get(app, id)
      expect(res.body.order.status).toBe('PAID')
      expect(JSON.stringify(res.body)).not.toContain(PREIMAGE)
    })

    it('lazily expires an unpaid quote that is past its window', async () => {
      const app = makeApp()
      const created = await createOrder(app)
      const id = created.body.order.id as string
      row(id).quoteExpiresAt = new Date(Date.now() - 1000)
      const res = await get(app, id)
      expect(res.body.order.status).toBe('EXPIRED')
    })

    it('forbids a caller who is not the buyer and 404s an unknown id', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      expect((await get(app, id, 't-other')).status).toBe(403)
      expect((await get(app, 'ro_missing')).status).toBe(404)
    })
  })

  describe('GET / (own orders)', () => {
    it('lists only the caller orders, newest first, without internal fields', async () => {
      const app = makeApp()
      const first = await createOrder(app)
      const second = await createOrder(app)
      await createOrder(app, { offerId: 'off_1' }, 't-other')
      // Make ordering deterministic regardless of clock resolution.
      row(first.body.order.id).createdAt = new Date(Date.now() - 5000)
      const res = await request(app).get('/api/remote-orders').set('Authorization', 'Bearer t-buyer')
      expect(res.status).toBe(200)
      expect(res.body.orders.map((o: Row) => o.id)).toEqual([second.body.order.id, first.body.order.id])
      expect(JSON.stringify(res.body)).not.toContain('preimage')
      expect(JSON.stringify(res.body)).not.toContain('zapRequestId')
    })

    it('filters by offerId', async () => {
      const app = makeApp()
      await createOrder(app)
      store.offers.set('off_2', offerRow({ id: 'off_2' }))
      await createOrder(app, { offerId: 'off_2' })
      const res = await request(app).get('/api/remote-orders?offerId=off_2').set('Authorization', 'Bearer t-buyer')
      expect(res.body.orders).toHaveLength(1)
      expect(res.body.orders[0].offerId).toBe('off_2')
    })

    it('requires authentication', async () => {
      const res = await request(makeApp()).get('/api/remote-orders')
      expect(res.status).toBe(401)
    })
  })

  describe('lapsed invoices', () => {
    async function invoiced(app: express.Express, verifyUrl = 'https://example.com/verify/abc') {
      const created = await createOrder(app)
      const id = created.body.order.id as string
      await invoiceFor(app, id, { zapRequest: makeZapRequest() })
      row(id).verifyUrl = verifyUrl
      return id
    }
    const getOrder = (app: express.Express, id: string) =>
      request(app).get(`/api/remote-orders/${id}`).set('Authorization', 'Bearer t-buyer')
    const lapse = (id: string) => { row(id).invoiceExpiresAt = new Date(Date.now() - 1000) }

    it('moves an unpaid INVOICED order to EXPIRED once its invoice has lapsed', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      lapse(id)
      const res = await getOrder(app, id)
      expect(res.body.order.status).toBe('EXPIRED')
      expect(row(id).status).toBe('EXPIRED')
    })

    it('still honours a settled payment found by LUD-21 verify at the moment of expiry', async () => {
      verifySettlement.mockResolvedValue({ settled: true, preimage: PREIMAGE })
      const app = makeApp()
      const id = await invoiced(app)
      lapse(id)
      const res = await getOrder(app, id)
      expect(res.body.order.status).toBe('PAID')
    })

    it('answers 409 QUOTE_EXPIRED and expires the order when a lapsed invoice is requested again', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      lapse(id)
      const res = await invoiceFor(app, id, { zapRequest: makeZapRequest() })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('QUOTE_EXPIRED')
      expect(row(id).status).toBe('EXPIRED')
    })

    it('accepts a matching preimage for an EXPIRED order that had an invoice (proof of payment)', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      lapse(id)
      await getOrder(app, id)
      const res = await request(app)
        .post(`/api/remote-orders/${id}/confirm`)
        .set('Authorization', 'Bearer t-buyer')
        .send({ preimage: PREIMAGE })
      expect(res.status).toBe(200)
      expect(res.body.order.status).toBe('PAID')
      expect(JSON.stringify(res.body)).not.toContain(PREIMAGE)
    })

    it('rejects a wrong preimage for an EXPIRED order and keeps it EXPIRED', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      lapse(id)
      await getOrder(app, id)
      const res = await request(app)
        .post(`/api/remote-orders/${id}/confirm`)
        .set('Authorization', 'Bearer t-buyer')
        .send({ preimage: 'cd'.repeat(32) })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('PREIMAGE_MISMATCH')
      expect(row(id).status).toBe('EXPIRED')
    })

    it('never turns a quote that expired before any invoice into PAID', async () => {
      const app = makeApp()
      const created = await createOrder(app)
      const id = created.body.order.id as string
      row(id).quoteExpiresAt = new Date(Date.now() - 1000)
      await getOrder(app, id)
      const res = await request(app)
        .post(`/api/remote-orders/${id}/confirm`)
        .set('Authorization', 'Bearer t-buyer')
        .send({ preimage: PREIMAGE })
      expect(res.status).toBe(409)
      expect(row(id).status).toBe('EXPIRED')
    })
  })

  it('returns 500 INTERNAL_ERROR without leaking details when a dependency throws', async () => {
    store.prisma.offer.findUnique.mockRejectedValueOnce(new Error('db down'))
    const res = await request(makeApp()).get('/api/remote-orders/payee/off_1')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'INTERNAL_ERROR', code: 'INTERNAL_ERROR' })
  })
})
