// ADR-417 — edge-case tests for the remote-order (Zap Out) router. Complements
// remote-orders.test.ts (not imported from it). Same harness: in-memory Prisma fake
// whose updateMany/create/findUnique apply `where`, and the real requireAuth middleware
// against a fake session table.
import express from 'express'
import request from 'supertest'
import { createHash } from 'node:crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { createRemoteOrdersRouter, type RemoteOrderDeps } from './remote-orders'
import type { PayeeResult, ResolvedPayee } from '../services/remote-payee'
import type { fetchRemoteInvoice } from '../services/remote-zap-invoice'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const BUYER_SK = generateSecretKey()
const BUYER = getPublicKey(BUYER_SK)
const SELLER = 'd'.repeat(64)
const AUTHOR = 'c'.repeat(64)
const OTHER = 'e'.repeat(64)
const PREIMAGE = 'ab'.repeat(32)
const HASH = createHash('sha256').update(Buffer.from(PREIMAGE, 'hex')).digest('hex')
const FUTURE = () => new Date(Date.now() + 60 * 60 * 1000)
const T0 = new Date('2026-11-12T12:00:00.000Z')

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

/** A correctly signed zap request by the buyer; tags default to a valid purchase of 21 sats. */
function zapEvent(opts: { tags?: string[][]; content?: string; createdAt?: number } = {}) {
  return finalizeEvent(
    {
      kind: 9734,
      created_at: opts.createdAt ?? Math.floor(Date.now() / 1000),
      tags: opts.tags ?? [
        ['p', SELLER],
        ['amount', '21000000'],
        ['a', `30402:${AUTHOR}:mercasats-187`],
        ['relays', 'wss://relay.example'],
      ],
      content: opts.content ?? '',
    },
    BUYER_SK,
  )
}

describe('ADR-417 remote-orders router — edge cases', () => {
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

  /** Inserts an order directly, for list tests that need controlled createdAt values. */
  async function seed(over: Row = {}): Promise<Row> {
    const created = await store.prisma.remoteOrder.create({
      data: {
        buyerPubkey: BUYER,
        offerId: 'off_1',
        quantity: 1,
        payeePubkey: SELLER,
        payeeRole: 'seller',
        payeeLud16: 'seller@example.com',
        zap: false,
        amountSats: 21000,
        amountBasis: 'sats',
        status: 'QUOTED',
        quoteExpiresAt: FUTURE(),
        ...over,
      },
    })
    if (!created) throw new Error("seed failed")
    return created
  }

  async function createOrder(app: express.Express, body: Row = { offerId: 'off_1' }, token = 't-buyer') {
    return request(app).post('/api/remote-orders').set('Authorization', `Bearer ${token}`).send(body)
  }

  async function invoiceFor(app: express.Express, id: string, body: Row = {}, token = 't-buyer') {
    return request(app).post(`/api/remote-orders/${id}/invoice`).set('Authorization', `Bearer ${token}`).send(body)
  }

  function confirm(app: express.Express, id: string, body: Row, token = 't-buyer') {
    return request(app).post(`/api/remote-orders/${id}/confirm`).set('Authorization', `Bearer ${token}`).send(body)
  }

  function getOrder(app: express.Express, id: string, token = 't-buyer') {
    return request(app).get(`/api/remote-orders/${id}`).set('Authorization', `Bearer ${token}`)
  }

  async function quotedId(app: express.Express): Promise<string> {
    const created = await createOrder(app)
    return created.body.order.id as string
  }

  /** Quoted, invoiced (zap), and carries a LUD-21 verify URL. */
  async function invoiced(app: express.Express, verifyUrl = 'https://example.com/verify/abc'): Promise<string> {
    const id = await quotedId(app)
    await invoiceFor(app, id, { zapRequest: zapEvent() })
    row(id).verifyUrl = verifyUrl
    return id
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

  describe('POST / input validation', () => {
    it.each([
      ['zero', 0],
      ['negative', -1],
      ['fractional', 1.5],
      ['above the max of 100', 1e9],
      ['NaN-like string', 'NaN'],
      ['non-numeric string', 'abc'],
      ['boolean', true],
    ])('rejects quantity %s with 400 BAD_REQUEST and creates nothing', async (_label, quantity) => {
      const res = await createOrder(makeApp(), { offerId: 'off_1', quantity })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('BAD_REQUEST')
      expect(store.orders.size).toBe(0)
    })

    it('accepts the numeric string "2" as quantity 2 and quotes twice the unit price', async () => {
      const res = await createOrder(makeApp(), { offerId: 'off_1', quantity: '2' })
      expect(res.status).toBe(201)
      expect(res.body.order.quantity).toBe(2)
      expect(res.body.order.amountSats).toBe(42000)
    })

    it('treats quantity null as the default of 1 (documented parseQuantity fallback)', async () => {
      const res = await createOrder(makeApp(), { offerId: 'off_1', quantity: null })
      expect(res.status).toBe(201)
      expect(res.body.order.quantity).toBe(1)
    })

    it.each([
      ['missing', {}],
      ['a number', { offerId: 123 }],
      ['an empty string', { offerId: '' }],
      ['null', { offerId: null }],
    ])('rejects an offerId that is %s with 400 BAD_REQUEST', async (_label, body) => {
      const res = await createOrder(makeApp(), body)
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('BAD_REQUEST')
      expect(store.orders.size).toBe(0)
    })

    it('rejects a request without any body with 400 BAD_REQUEST', async () => {
      const res = await request(makeApp())
        .post('/api/remote-orders')
        .set('Authorization', 'Bearer t-buyer')
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('BAD_REQUEST')
    })

    it('answers 401 without a session and creates nothing', async () => {
      const res = await request(makeApp()).post('/api/remote-orders').send({ offerId: 'off_1' })
      expect(res.status).toBe(401)
      expect(res.body.error).toBe('UNAUTHORIZED')
      expect(store.orders.size).toBe(0)
    })
  })

  describe('amount guards', () => {
    it('reports ABOVE_LAUNCH_CAP on the preview when the amount exceeds the cap by one sat', async () => {
      const res = await request(makeApp({ maxTxSats: () => 20_999 })).get('/api/remote-orders/payee/off_1')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ orderable: false, reason: 'ABOVE_LAUNCH_CAP' })
    })

    it('accepts an amount exactly equal to the launch cap', async () => {
      const res = await createOrder(makeApp({ maxTxSats: () => 21_000 }))
      expect(res.status).toBe(201)
      expect(res.body.order.amountSats).toBe(21000)
    })

    it('rejects an amount below the payee minSats with NOT_ORDERABLE AMOUNT_OUT_OF_RANGE', async () => {
      resolvePayee.mockResolvedValue(payeeOk({ minSats: 30_000 }))
      const res = await createOrder(makeApp())
      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({ code: 'NOT_ORDERABLE', reason: 'AMOUNT_OUT_OF_RANGE' })
      expect(store.orders.size).toBe(0)
    })

    it('rejects an amount above the payee maxSats with NOT_ORDERABLE AMOUNT_OUT_OF_RANGE', async () => {
      resolvePayee.mockResolvedValue(payeeOk({ maxSats: 20_000 }))
      const res = await createOrder(makeApp())
      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({ code: 'NOT_ORDERABLE', reason: 'AMOUNT_OUT_OF_RANGE' })
      expect(store.orders.size).toBe(0)
    })

    it('accepts amounts exactly at the payee minSats and maxSats bounds', async () => {
      resolvePayee.mockResolvedValue(payeeOk({ minSats: 21_000, maxSats: 21_000 }))
      const res = await createOrder(makeApp())
      expect(res.status).toBe(201)
    })

    it('reports AMOUNT_OUT_OF_RANGE on the preview for an amount below minSats', async () => {
      resolvePayee.mockResolvedValue(payeeOk({ minSats: 30_000 }))
      const res = await request(makeApp()).get('/api/remote-orders/payee/off_1')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ orderable: false, reason: 'AMOUNT_OUT_OF_RANGE' })
    })

    it('quotes a very large amount when the launch cap is disabled', async () => {
      store.offers.set('off_1', offerRow({ priceSats: 10_000_000 }))
      resolvePayee.mockResolvedValue(payeeOk({ maxSats: Number.MAX_SAFE_INTEGER }))
      const res = await createOrder(makeApp({ maxTxSats: () => Number.MAX_SAFE_INTEGER }), {
        offerId: 'off_1',
        quantity: 100,
      })
      expect(res.status).toBe(201)
      expect(res.body.order.amountSats).toBe(1_000_000_000)
      expect(res.body.order.quantity).toBe(100)
    })
  })

  describe('POST /:id/invoice', () => {
    it('stays idempotent over three sequential calls: one upstream request, identical bolt11', async () => {
      const app = makeApp()
      const id = await quotedId(app)
      const first = await invoiceFor(app, id, { zapRequest: zapEvent() })
      const second = await invoiceFor(app, id, {})
      const third = await invoiceFor(app, id, {})
      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(third.status).toBe(200)
      expect(new Set([first.body.bolt11, second.body.bolt11, third.body.bolt11]).size).toBe(1)
      expect(fetchInvoice).toHaveBeenCalledTimes(1)
    })

    it('under parallel calls stores exactly one invoice, returns it to the winner, and never corrupts the order', async () => {
      let counter = 0
      fetchInvoice.mockImplementation(async () => {
        counter++
        await new Promise((resolve) => setTimeout(resolve, 5))
        return { bolt11: `lnbc_invoice_${counter}`, paymentHash: HASH, expiresAt: FUTURE() }
      })
      const app = makeApp()
      const id = await quotedId(app)
      const zapRequest = zapEvent()
      const [a, b] = await Promise.all([
        invoiceFor(app, id, { zapRequest }),
        invoiceFor(app, id, { zapRequest }),
      ])
      const statuses = [a.status, b.status].sort()
      expect(statuses).toEqual([200, 409])
      const winner = a.status === 200 ? a : b
      const loser = a.status === 200 ? b : a
      expect(loser.body.code).toBe('INVALID_STATE')
      expect(row(id).status).toBe('INVOICED')
      expect(row(id).bolt11).toBe(winner.body.bolt11)
      expect(row(id).paymentHash).toBe(HASH)
    })

    it('treats quoteExpiresAt exactly equal to now as expired (409 QUOTE_EXPIRED)', async () => {
      const app = makeApp({ now: () => T0 })
      const id = await quotedId(app)
      row(id).quoteExpiresAt = new Date(T0.getTime())
      const res = await invoiceFor(app, id, { zapRequest: zapEvent() })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('QUOTE_EXPIRED')
      expect(row(id).status).toBe('EXPIRED')
      expect(fetchInvoice).not.toHaveBeenCalled()
    })

    it('treats quoteExpiresAt 1 ms in the past as expired (409 QUOTE_EXPIRED)', async () => {
      const app = makeApp({ now: () => T0 })
      const id = await quotedId(app)
      row(id).quoteExpiresAt = new Date(T0.getTime() - 1)
      const res = await invoiceFor(app, id, { zapRequest: zapEvent() })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('QUOTE_EXPIRED')
      expect(row(id).status).toBe('EXPIRED')
    })

    it('still invoices when quoteExpiresAt is 1 ms in the future', async () => {
      const app = makeApp({ now: () => T0 })
      const id = await quotedId(app)
      row(id).quoteExpiresAt = new Date(T0.getTime() + 1)
      const res = await invoiceFor(app, id, { zapRequest: zapEvent() })
      expect(res.status).toBe(200)
      expect(res.body.order.status).toBe('INVOICED')
    })

    it.each([
      ['paused', { status: 'PAUSED' }],
      ['blocked', { blockedAt: new Date() }],
    ])('refuses to invoice when the offer was %s after the quote (409 INVALID_STATE)', async (_label, change) => {
      const app = makeApp()
      const id = await quotedId(app)
      store.offers.set('off_1', offerRow(change))
      const res = await invoiceFor(app, id, { zapRequest: zapEvent() })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('INVALID_STATE')
      expect(fetchInvoice).not.toHaveBeenCalled()
      expect(row(id).status).toBe('QUOTED')
    })

    it('refuses to invoice when the offer was deleted after the quote (409 INVALID_STATE)', async () => {
      const app = makeApp()
      const id = await quotedId(app)
      store.offers.delete('off_1')
      const res = await invoiceFor(app, id, { zapRequest: zapEvent() })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('INVALID_STATE')
      expect(fetchInvoice).not.toHaveBeenCalled()
    })

    it('refuses to invoice when the payee pubkey changed after the quote (409 INVALID_STATE)', async () => {
      const app = makeApp()
      const id = await quotedId(app)
      resolvePayee.mockResolvedValue(payeeOk({ pubkey: OTHER }))
      const res = await invoiceFor(app, id, { zapRequest: zapEvent() })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('INVALID_STATE')
      expect(fetchInvoice).not.toHaveBeenCalled()
    })

    it('refuses to invoice when the payee lightning address changed after the quote (409 INVALID_STATE)', async () => {
      const app = makeApp()
      const id = await quotedId(app)
      resolvePayee.mockResolvedValue(payeeOk({ lud16: 'attacker@example.com' }))
      const res = await invoiceFor(app, id, { zapRequest: zapEvent() })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('INVALID_STATE')
      expect(fetchInvoice).not.toHaveBeenCalled()
      expect(row(id).bolt11).toBeNull()
    })

    it('refuses to invoice when a zap order lost NIP-57 support at the payee (409 INVALID_STATE)', async () => {
      const app = makeApp()
      const id = await quotedId(app)
      expect(row(id).zap).toBe(true)
      resolvePayee.mockResolvedValue(payeeOk({ zap: false }))
      const res = await invoiceFor(app, id, { zapRequest: zapEvent() })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('INVALID_STATE')
      expect(fetchInvoice).not.toHaveBeenCalled()
    })

    it('forbids another buyer with 403 and does not touch the order', async () => {
      const app = makeApp()
      const id = await quotedId(app)
      const res = await invoiceFor(app, id, { zapRequest: zapEvent() }, 't-other')
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('FORBIDDEN')
      expect(fetchInvoice).not.toHaveBeenCalled()
      expect(row(id).status).toBe('QUOTED')
    })

    it('returns 404 NOT_FOUND for an unknown order id', async () => {
      const res = await invoiceFor(makeApp(), 'ro_does_not_exist', { zapRequest: zapEvent() })
      expect(res.status).toBe(404)
      expect(res.body.code).toBe('NOT_FOUND')
    })

    it('answers 401 without a session', async () => {
      const app = makeApp()
      const id = await quotedId(app)
      const res = await request(app).post(`/api/remote-orders/${id}/invoice`).send({ zapRequest: zapEvent() })
      expect(res.status).toBe(401)
      expect(fetchInvoice).not.toHaveBeenCalled()
    })

    it('rejects a zap order that has no zapRequest in the body with 400 ZAP_REQUEST_INVALID', async () => {
      const app = makeApp()
      const id = await quotedId(app)
      const res = await invoiceFor(app, id, {})
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('ZAP_REQUEST_INVALID')
      expect(fetchInvoice).not.toHaveBeenCalled()
      expect(row(id).status).toBe('QUOTED')
    })

    describe('malformed or forged zap requests (400 ZAP_REQUEST_INVALID, nothing fetched, order stays QUOTED)', () => {
      const cases: Array<[string, () => unknown]> = [
        ['a wrong payee p tag', () => zapEvent({ tags: [['p', OTHER], ['amount', '21000000'], ['a', `30402:${AUTHOR}:mercasats-187`], ['relays', 'wss://relay.example']] })],
        ['a listing a tag for another d-tag', () => zapEvent({ tags: [['p', SELLER], ['amount', '21000000'], ['a', `30402:${AUTHOR}:other-listing`], ['relays', 'wss://relay.example']] })],
        ['content over 280 characters', () => zapEvent({ content: 'x'.repeat(281) })],
        ['a tampered signature', () => {
          const evt = zapEvent()
          return { ...evt, sig: (evt.sig[0] === '0' ? '1' : '0') + evt.sig.slice(1) }
        }],
        ['a forged event id', () => ({ ...zapEvent(), id: 'ab'.repeat(32) })],
        ['created_at 11 minutes in the future', () => zapEvent({ createdAt: Math.floor(Date.now() / 1000) + 660 })],
        ['an array instead of an object', () => [zapEvent()]],
        ['a string instead of an object', () => 'not-an-event'],
        ['null', () => null],
      ]

      it.each(cases)('rejects %s', async (_label, build) => {
        const app = makeApp()
        const id = await quotedId(app)
        const res = await invoiceFor(app, id, { zapRequest: build() })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('ZAP_REQUEST_INVALID')
        expect(fetchInvoice).not.toHaveBeenCalled()
        expect(row(id).status).toBe('QUOTED')
      })

      it('accepts content of exactly 280 characters (boundary)', async () => {
        const app = makeApp()
        const id = await quotedId(app)
        const res = await invoiceFor(app, id, { zapRequest: zapEvent({ content: 'x'.repeat(280) }) })
        expect(res.status).toBe(200)
      })
    })

    it('keeps the order QUOTED after an upstream failure and allows a successful retry', async () => {
      fetchInvoice
        .mockRejectedValueOnce(new Error('LNURL callback HTTP 503'))
        .mockResolvedValueOnce({ bolt11: 'lnbc_retry', paymentHash: HASH, expiresAt: FUTURE() })
      const app = makeApp()
      const id = await quotedId(app)
      const failed = await invoiceFor(app, id, { zapRequest: zapEvent() })
      expect(failed.status).toBe(502)
      expect(failed.body.code).toBe('UPSTREAM_ERROR')
      expect(row(id).status).toBe('QUOTED')
      const retried = await invoiceFor(app, id, { zapRequest: zapEvent() })
      expect(retried.status).toBe(200)
      expect(retried.body.bolt11).toBe('lnbc_retry')
      expect(row(id).status).toBe('INVOICED')
      expect(fetchInvoice).toHaveBeenCalledTimes(2)
    })
  })

  describe('POST /:id/confirm', () => {
    it('accepts an uppercase preimage, normalizes it to lowercase and marks PAID', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      const res = await confirm(app, id, { preimage: PREIMAGE.toUpperCase() })
      expect(res.status).toBe(200)
      expect(res.body.order.status).toBe('PAID')
      expect(row(id).preimage).toBe(PREIMAGE)
    })

    it.each([
      ['with surrounding spaces', ` ${PREIMAGE} `],
      ['63 characters', PREIMAGE.slice(0, 63)],
      ['65 characters', `${PREIMAGE}a`],
      ['non-hex characters', 'zz'.repeat(32)],
      ['missing', undefined],
      ['a number', 12345],
    ])('rejects a preimage %s with 400 BAD_REQUEST and leaves the order INVOICED', async (_label, preimage) => {
      const app = makeApp()
      const id = await invoiced(app)
      const res = await confirm(app, id, { preimage })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('BAD_REQUEST')
      expect(row(id).status).toBe('INVOICED')
      expect(row(id).preimage).toBeNull()
    })

    it('rejects a wrong preimage with 400 PREIMAGE_MISMATCH and keeps the status unchanged', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      const res = await confirm(app, id, { preimage: 'cd'.repeat(32) })
      expect(res.status).toBe(400)
      expect(res.body.code).toBe('PREIMAGE_MISMATCH')
      expect(row(id).status).toBe('INVOICED')
      expect(row(id).paidAt).toBeNull()
    })

    it('forbids another buyer with 403 even when the preimage is correct', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      const res = await confirm(app, id, { preimage: PREIMAGE }, 't-other')
      expect(res.status).toBe(403)
      expect(row(id).status).toBe('INVOICED')
    })

    it('answers 401 without a session', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      const res = await request(app).post(`/api/remote-orders/${id}/confirm`).send({ preimage: PREIMAGE })
      expect(res.status).toBe(401)
      expect(row(id).status).toBe('INVOICED')
    })

    it('answers 200 idempotently for a PAID order with the right preimage and keeps the stored one', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      await confirm(app, id, { preimage: PREIMAGE })
      const again = await confirm(app, id, { preimage: PREIMAGE.toUpperCase() })
      expect(again.status).toBe(200)
      expect(again.body.order.status).toBe('PAID')
      expect(row(id).preimage).toBe(PREIMAGE)
    })

    it('answers 400 PREIMAGE_MISMATCH for a PAID order with a wrong preimage and never overwrites the stored one', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      await confirm(app, id, { preimage: PREIMAGE })
      const again = await confirm(app, id, { preimage: 'cd'.repeat(32) })
      expect(again.status).toBe(400)
      expect(again.body.code).toBe('PREIMAGE_MISMATCH')
      expect(row(id).preimage).toBe(PREIMAGE)
      expect(row(id).status).toBe('PAID')
    })

    it('answers 409 INVALID_STATE for a QUOTED order (never invoiced) even with a plausible preimage', async () => {
      const app = makeApp()
      const id = await quotedId(app)
      const res = await confirm(app, id, { preimage: PREIMAGE })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('INVALID_STATE')
      expect(row(id).status).toBe('QUOTED')
    })

    it('answers 409 for an EXPIRED order that never had an invoice, whatever the preimage', async () => {
      const app = makeApp()
      const id = await quotedId(app)
      row(id).quoteExpiresAt = new Date(Date.now() - 1000)
      await getOrder(app, id)
      expect(row(id).status).toBe('EXPIRED')
      const res = await confirm(app, id, { preimage: PREIMAGE })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('INVALID_STATE')
      expect(row(id).status).toBe('EXPIRED')
    })

    it('marks an EXPIRED order with an invoice PAID when the preimage matches the payment hash', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      row(id).invoiceExpiresAt = new Date(Date.now() - 1000)
      await getOrder(app, id)
      expect(row(id).status).toBe('EXPIRED')
      const res = await confirm(app, id, { preimage: PREIMAGE })
      expect(res.status).toBe(200)
      expect(res.body.order.status).toBe('PAID')
    })

    it('answers 409 INVALID_STATE for a FAILED order even when the preimage matches', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      row(id).status = 'FAILED'
      const res = await confirm(app, id, { preimage: PREIMAGE })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('INVALID_STATE')
      expect(row(id).status).toBe('FAILED')
    })
  })

  describe('GET /:id', () => {
    it('forbids another buyer with 403 and 404s an unknown id', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      const forbidden = await getOrder(app, id, 't-other')
      expect(forbidden.status).toBe(403)
      const missing = await getOrder(app, 'ro_nope')
      expect(missing.status).toBe(404)
      expect(missing.body.code).toBe('NOT_FOUND')
    })

    it('never leaks preimage, verifyUrl, rateSnapshot, zapRequestId or the buyer pubkey for a PAID order', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      row(id).rateSnapshot = { currency: 'usd', btcPrice: 60000, fetchedAt: T0.toISOString() }
      row(id).zapRequestId = 'zr_secret_marker'
      await confirm(app, id, { preimage: PREIMAGE })
      const res = await getOrder(app, id)
      expect(res.status).toBe(200)
      expect(res.body.order.status).toBe('PAID')
      const serialized = JSON.stringify(res.body)
      expect(serialized).not.toContain(PREIMAGE)
      expect(serialized).not.toContain('"preimage"')
      expect(serialized).not.toContain('"verifyUrl"')
      expect(serialized).not.toContain('"rateSnapshot"')
      expect(serialized).not.toContain('"zapRequestId"')
      expect(serialized).not.toContain('zr_secret_marker')
      expect(serialized).not.toContain('"buyerPubkey"')
      expect(serialized).not.toContain(BUYER)
    })

    it('moves an INVOICED order to EXPIRED when the invoice lapsed and LUD-21 reports nothing settled', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      row(id).invoiceExpiresAt = new Date(Date.now() - 1000)
      const res = await getOrder(app, id)
      expect(res.body.order.status).toBe('EXPIRED')
      expect(row(id).status).toBe('EXPIRED')
    })

    it('reports PAID instead of EXPIRED when LUD-21 says settled at the moment of expiry', async () => {
      verifySettlement.mockResolvedValue({ settled: true, preimage: PREIMAGE })
      const app = makeApp()
      const id = await invoiced(app)
      row(id).invoiceExpiresAt = new Date(Date.now() - 1000)
      const res = await getOrder(app, id)
      expect(res.body.order.status).toBe('PAID')
      expect(row(id).status).toBe('PAID')
    })

    it('does not call LUD-21 verify or the receipt lookup for a PAID order', async () => {
      const app = makeApp()
      const id = await invoiced(app)
      await confirm(app, id, { preimage: PREIMAGE })
      verifySettlement.mockClear()
      findZapReceiptPreimage.mockClear()
      const res = await getOrder(app, id)
      expect(res.body.order.status).toBe('PAID')
      expect(verifySettlement).toHaveBeenCalledTimes(0)
      expect(findZapReceiptPreimage).toHaveBeenCalledTimes(0)
    })

    it('does not call LUD-21 verify or the receipt lookup for a QUOTED order', async () => {
      const app = makeApp()
      const id = await quotedId(app)
      const res = await getOrder(app, id)
      expect(res.body.order.status).toBe('QUOTED')
      expect(verifySettlement).toHaveBeenCalledTimes(0)
      expect(findZapReceiptPreimage).toHaveBeenCalledTimes(0)
    })

    it('still answers 200 and keeps the order INVOICED when verifySettlement throws', async () => {
      verifySettlement.mockRejectedValue(new Error('verify endpoint exploded'))
      const app = makeApp()
      const id = await invoiced(app)
      const res = await getOrder(app, id)
      expect(res.status).toBe(200)
      expect(res.body.order.status).toBe('INVOICED')
      expect(verifySettlement).toHaveBeenCalledTimes(1)
    })
  })

  describe('GET / (own orders)', () => {
    it('returns only the caller orders, never another buyer', async () => {
      const mine = await seed({ offerId: 'off_1' })
      await seed({ buyerPubkey: OTHER, offerId: 'off_1' })
      const res = await request(makeApp()).get('/api/remote-orders').set('Authorization', 'Bearer t-buyer')
      expect(res.status).toBe(200)
      expect(res.body.orders.map((o: Row) => o.id)).toEqual([mine.id])
      expect(JSON.stringify(res.body)).not.toContain(OTHER)
    })

    it('filters by offerId', async () => {
      const a = await seed({ offerId: 'off_1' })
      const b = await seed({ offerId: 'off_2' })
      const res = await request(makeApp())
        .get('/api/remote-orders?offerId=off_2')
        .set('Authorization', 'Bearer t-buyer')
      expect(res.body.orders.map((o: Row) => o.id)).toEqual([b.id])
      expect(res.body.orders.map((o: Row) => o.id)).not.toContain(a.id)
    })

    it('ignores an empty offerId filter and returns all own orders', async () => {
      await seed({ offerId: 'off_1' })
      await seed({ offerId: 'off_2' })
      const res = await request(makeApp()).get('/api/remote-orders?offerId=').set('Authorization', 'Bearer t-buyer')
      expect(res.body.orders).toHaveLength(2)
    })

    it('returns at most 50 orders, newest first', async () => {
      const base = Date.parse('2026-11-01T00:00:00.000Z')
      const seeded: Row[] = []
      for (let i = 0; i < 55; i++) {
        seeded.push(await seed({ createdAt: new Date(base + i * 1000) }))
      }
      const res = await request(makeApp()).get('/api/remote-orders').set('Authorization', 'Bearer t-buyer')
      expect(res.status).toBe(200)
      expect(res.body.orders).toHaveLength(50)
      const ids = res.body.orders.map((o: Row) => o.id as string)
      expect(ids[0]).toBe(seeded[54].id)
      const oldestFive = seeded.slice(0, 5).map((o) => o.id)
      for (const id of oldestFive) expect(ids).not.toContain(id)
      const times = res.body.orders.map((o: Row) => Date.parse(o.createdAt))
      for (let i = 1; i < times.length; i++) expect(times[i - 1]).toBeGreaterThanOrEqual(times[i])
    })
  })

  describe('receipt and verify refresh', () => {
    it('does not call verifySettlement or findZapReceiptPreimage on a QUOTED order (no invoice yet)', async () => {
      const app = makeApp()
      await quotedId(app)
      await getOrder(app, (store.orders.keys().next().value as string))
      expect(verifySettlement).toHaveBeenCalledTimes(0)
      expect(findZapReceiptPreimage).toHaveBeenCalledTimes(0)
    })

    it('still answers 200 for an INVOICED order when the receipt lookup throws as well', async () => {
      findZapReceiptPreimage.mockRejectedValue(new Error('relay down'))
      verifySettlement.mockRejectedValue(new Error('verify down'))
      const app = makeApp()
      const id = await invoiced(app)
      const res = await getOrder(app, id)
      expect(res.status).toBe(200)
      expect(res.body.order.status).toBe('INVOICED')
    })
  })
})
