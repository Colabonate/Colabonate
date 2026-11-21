// ADR-417 — Zap Out purchase of REMOTE offers. Buyer-side RemoteOrder rail:
// quote (server-fixed sats amount) -> LNURL invoice (NIP-57 zap when the payee
// supports it) -> buyer pays -> preimage or LUD-21 verify marks PAID. No escrow,
// no ticket, no reputation; the platform never holds funds.
import { createHash } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import type { PrismaClient, RemoteOrder, Prisma } from '@prisma/client'
import { requireAuth } from '../middleware/require-auth.js'
import { blockIfPaymentsPaused } from '../middleware/payments-paused.js'
import {
  resolveRemotePayee,
  createDefaultPayeeDeps,
  type PayeeResult,
  type ResolvedPayee,
} from '../services/remote-payee.js'
import {
  computeRemoteQuote,
  quoteExpiry,
  MAX_REMOTE_QUANTITY,
  type RemoteQuote,
} from '../services/remote-order-quote.js'
import { fetchRemoteInvoice, type RemoteInvoice } from '../services/remote-zap-invoice.js'
import { validateZapRequest } from '../lib/zap-request.js'
import { resolveLaunchMaxTxSats } from '../lib/launch-tx-cap.js'
import { getExchangeRates } from '../services/exchangeRates.js'
import { pinnedFetchJson } from '../lib/pinned-fetch.js'
import { findZapReceiptPreimage, type ReceiptLookup } from '../services/remote-zap-receipt.js'

export type OrderReason =
  | 'NOT_REMOTE'
  | 'OFFER_NOT_ACTIVE'
  | 'NO_PAYEE'
  | 'NO_LIGHTNING_ADDRESS'
  | 'LNURL_UNREACHABLE'
  | 'PRICE_NOT_CONVERTIBLE'
  | 'AMOUNT_OUT_OF_RANGE'
  | 'ABOVE_LAUNCH_CAP'

export interface RemoteOrderDeps {
  resolvePayee(offer: { creatorPubkey: string; remoteSellerPubkey?: string | null }): Promise<PayeeResult>
  getRates(): Promise<Record<string, { price: number }>>
  fetchInvoice: typeof fetchRemoteInvoice
  verifySettlement(verifyUrl: string): Promise<{ settled: boolean; preimage?: string } | null>
  /** FU-1003: preimage taken from a public NIP-57 zap receipt for this invoice, if any. */
  findZapReceiptPreimage(lookup: ReceiptLookup): Promise<string | null>
  now(): Date
  maxTxSats(): number
  relays(): string[]
}

export interface Payee {
  pubkey: string
  role: 'seller' | 'author'
  name?: string
  lud16: string
  zap: boolean
  minSats: number
  maxSats: number
}

export interface OrderView {
  id: string
  offerId: string
  quantity: number
  status: string
  payee: Payee
  amountSats: number
  amountBasis: string
  priceAmount?: string
  priceCurrency?: string
  quoteExpiresAt: string
  bolt11?: string
  paymentHash?: string
  invoiceExpiresAt?: string
  paidAt?: string
  createdAt: string
}

interface OfferRow {
  id: string
  source: string
  status: string
  blockedAt: Date | null
  creatorPubkey: string
  remoteSellerPubkey: string | null
  remoteDTag: string | null
  priceSats: number
  priceAmount: string | null
  priceCurrency: string | null
}

const OFFER_SELECT = {
  id: true,
  source: true,
  status: true,
  blockedAt: true,
  creatorPubkey: true,
  remoteSellerPubkey: true,
  remoteDTag: true,
  priceSats: true,
  priceAmount: true,
  priceCurrency: true,
} as const

const HEX64 = /^[0-9a-f]{64}$/i
const VERIFY_TIMEOUT_MS = 8_000
const VERIFY_MAX_BYTES = 16 * 1024
const VERIFY_THROTTLE_MS = 10_000
const VERIFY_THROTTLE_MAX_ENTRIES = 1_000
const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']

type Evaluation =
  | { ok: true; payee: ResolvedPayee; quote: RemoteQuote; zap: boolean }
  | { ok: false; reason: OrderReason }

/** LUD-21 verify: any failure resolves to null, never throws. */
async function defaultVerifySettlement(verifyUrl: string): Promise<{ settled: boolean; preimage?: string } | null> {
  try {
    // Pinned to the addresses that passed the private-range check (FU-1004).
    const body = await pinnedFetchJson(verifyUrl, { timeoutMs: VERIFY_TIMEOUT_MS, maxBytes: VERIFY_MAX_BYTES })
    if (typeof body !== 'object' || body === null) return null
    const record = body as Record<string, unknown>
    if (typeof record.settled !== 'boolean') return null
    return {
      settled: record.settled,
      preimage: typeof record.preimage === 'string' ? record.preimage : undefined,
    }
  } catch {
    return null
  }
}

async function defaultGetRates(): Promise<Record<string, { price: number }>> {
  try {
    return (await getExchangeRates()).rates
  } catch {
    return {}
  }
}

function defaultRelays(): string[] {
  const list = (process.env.NOSTR_INGEST_RELAY_URLS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 5)
  return list.length > 0 ? list : DEFAULT_RELAYS
}

function buildDefaultDeps(): RemoteOrderDeps {
  const payeeDeps = createDefaultPayeeDeps()
  return {
    resolvePayee: (offer) => resolveRemotePayee(offer, payeeDeps),
    getRates: defaultGetRates,
    fetchInvoice: fetchRemoteInvoice,
    verifySettlement: defaultVerifySettlement,
    findZapReceiptPreimage,
    now: () => new Date(),
    // A disabled launch cap (LAUNCH_MAX_TX_SATS=0) means no upper bound.
    maxTxSats: () => resolveLaunchMaxTxSats(process.env) ?? Number.MAX_SAFE_INTEGER,
    relays: defaultRelays,
  }
}

/** Single-segment route params are always strings; an empty value simply matches nothing. */
function routeParam(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : ''
}

function authOf(req: Request): string | undefined {
  return (req as Request & { authPubkey?: string }).authPubkey
}

function sendError(res: Response, status: number, code: string, extra: Record<string, unknown> = {}): void {
  res.status(status).json({ error: code, code, ...extra })
}

/** Wraps a handler so no exception escapes; logs a fixed message only. */
function safe(handler: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      await handler(req, res)
    } catch {
      console.error('[remote-orders] unexpected error')
      if (!res.headersSent) sendError(res, 500, 'INTERNAL_ERROR')
    }
  }
}

function parseQuantity(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return 1
  const value = typeof raw === 'string' ? Number(raw) : raw
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_REMOTE_QUANTITY) return null
  return value
}

function listingAddressOf(offer: { creatorPubkey: string; remoteDTag: string | null }): string {
  return `30402:${offer.creatorPubkey}:${offer.remoteDTag ?? ''}`
}

function sha256Hex(hex: string): string {
  return createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex')
}

function preimageMatches(preimage: string, paymentHash: string | null): boolean {
  if (!paymentHash || !HEX64.test(preimage)) return false
  return sha256Hex(preimage.toLowerCase()) === paymentHash.toLowerCase()
}

function toView(row: RemoteOrder): OrderView {
  const view: OrderView = {
    id: row.id,
    offerId: row.offerId,
    quantity: row.quantity,
    status: row.status,
    // Stored orders carry no LNURL bounds, so min/max are reported as 0 here;
    // the bounds are only meaningful on the pre-order preview.
    payee: {
      pubkey: row.payeePubkey,
      role: row.payeeRole === 'author' ? 'author' : 'seller',
      lud16: row.payeeLud16,
      zap: row.zap,
      minSats: 0,
      maxSats: 0,
    },
    amountSats: row.amountSats,
    amountBasis: row.amountBasis,
    quoteExpiresAt: row.quoteExpiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }
  if (row.priceAmount !== null) view.priceAmount = row.priceAmount
  if (row.priceCurrency !== null) view.priceCurrency = row.priceCurrency
  if (row.bolt11) view.bolt11 = row.bolt11
  if (row.paymentHash) view.paymentHash = row.paymentHash
  if (row.invoiceExpiresAt) view.invoiceExpiresAt = row.invoiceExpiresAt.toISOString()
  if (row.paidAt) view.paidAt = row.paidAt.toISOString()
  return view
}

export function createRemoteOrdersRouter(prisma: PrismaClient, overrides: Partial<RemoteOrderDeps> = {}): Router {
  const deps: RemoteOrderDeps = { ...buildDefaultDeps(), ...overrides }
  // Per-router throttle state for LUD-21 refreshes (one router per app instance).
  const lastVerifyAt = new Map<string, number>()
  const router = Router()

  async function loadOffer(offerId: string): Promise<OfferRow | null> {
    return (await prisma.offer.findUnique({ where: { id: offerId }, select: OFFER_SELECT })) as OfferRow | null
  }

  async function reloadOrder(id: string): Promise<RemoteOrder> {
    const row = await prisma.remoteOrder.findUnique({ where: { id } })
    if (!row) throw new Error('remote order vanished')
    return row
  }

  async function markPaid(id: string, preimage: string, paidAt: Date): Promise<boolean> {
    const data = { status: 'PAID', preimage, paidAt }
    const result = await prisma.remoteOrder.updateMany({ where: { id, status: 'INVOICED' }, data })
    if (result.count > 0) return true
    // An invoice that lapsed before the payment was seen: callers only get here with a preimage that
    // hashes to the stored payment hash, which proves the invoice was paid, so EXPIRED -> PAID is safe.
    const late = await prisma.remoteOrder.updateMany({ where: { id, status: 'EXPIRED' }, data })
    return late.count > 0
  }

  // An unpaid invoice past its expiry can no longer be paid: stop offering it (the buyer starts a new order).
  async function expireLapsedInvoice(id: string): Promise<void> {
    await prisma.remoteOrder.updateMany({ where: { id, status: 'INVOICED' }, data: { status: 'EXPIRED' } })
  }

  async function evaluate(offer: OfferRow, quantity: number): Promise<Evaluation> {
    if (offer.source !== 'REMOTE') return { ok: false, reason: 'NOT_REMOTE' }
    if (offer.status !== 'ACTIVE' || offer.blockedAt) return { ok: false, reason: 'OFFER_NOT_ACTIVE' }

    const payeeResult = await deps.resolvePayee({
      creatorPubkey: offer.creatorPubkey,
      remoteSellerPubkey: offer.remoteSellerPubkey,
    })
    if (!payeeResult.ok) return { ok: false, reason: payeeResult.reason }
    const payee = payeeResult.payee

    const rates = await deps.getRates().catch(() => ({}) as Record<string, { price: number }>)
    const quoted = computeRemoteQuote({
      offer: { priceSats: offer.priceSats, priceAmount: offer.priceAmount, priceCurrency: offer.priceCurrency },
      quantity,
      rates,
      maxTxSats: deps.maxTxSats(),
    })
    if (!quoted.ok) {
      return { ok: false, reason: quoted.reason === 'ABOVE_LAUNCH_CAP' ? 'ABOVE_LAUNCH_CAP' : 'PRICE_NOT_CONVERTIBLE' }
    }

    const { amountSats } = quoted.quote
    if (amountSats < payee.minSats || amountSats > payee.maxSats) {
      return { ok: false, reason: 'AMOUNT_OUT_OF_RANGE' }
    }

    return {
      ok: true,
      payee,
      quote: quoted.quote,
      zap: payee.zap && Boolean(offer.remoteDTag),
    }
  }

  // GET /payee/:offerId — public pre-order preview. Never exposes LNURL internals.
  router.get(
    '/payee/:offerId',
    safe(async (req, res) => {
      const quantity = parseQuantity(req.query.quantity)
      if (quantity === null) return sendError(res, 400, 'BAD_REQUEST')

      const offer = await loadOffer(routeParam(req.params.offerId))
      if (!offer) return sendError(res, 404, 'OFFER_NOT_FOUND')

      const evaluation = await evaluate(offer, quantity)
      if (!evaluation.ok) {
        res.json({ orderable: false, reason: evaluation.reason })
        return
      }

      const { payee, quote } = evaluation
      const quoteView: Record<string, unknown> = {
        amountSats: quote.amountSats,
        basis: quote.basis,
        quantity: quote.quantity,
      }
      if (quote.priceAmount !== undefined) quoteView.priceAmount = quote.priceAmount
      if (quote.priceCurrency !== undefined) quoteView.priceCurrency = quote.priceCurrency

      res.json({
        orderable: true,
        payee: {
          pubkey: payee.pubkey,
          role: payee.role,
          name: payee.name,
          lud16: payee.lud16,
          zap: evaluation.zap,
          minSats: payee.minSats,
          maxSats: payee.maxSats,
        },
        quote: quoteView,
      })
    }),
  )

  // POST / — create a QUOTED order.
  router.post(
    '/',
    requireAuth(prisma),
    blockIfPaymentsPaused,
    safe(async (req, res) => {
      const buyer = authOf(req)
      if (!buyer) return sendError(res, 401, 'UNAUTHORIZED')

      const body = (req.body ?? {}) as { offerId?: unknown; quantity?: unknown }
      if (typeof body.offerId !== 'string' || body.offerId.length === 0) return sendError(res, 400, 'BAD_REQUEST')
      const quantity = parseQuantity(body.quantity)
      if (quantity === null) return sendError(res, 400, 'BAD_REQUEST')

      const offer = await loadOffer(body.offerId)
      if (!offer) return sendError(res, 404, 'OFFER_NOT_FOUND')

      const evaluation = await evaluate(offer, quantity)
      if (!evaluation.ok) return sendError(res, 400, 'NOT_ORDERABLE', { reason: evaluation.reason })
      const { payee, quote, zap } = evaluation
      if (payee.pubkey === buyer) return sendError(res, 400, 'NOT_ORDERABLE', { reason: 'NO_PAYEE' })

      const now = deps.now()
      const rateSnapshot: Prisma.InputJsonValue | undefined = quote.rate
        ? { currency: quote.rate.currency, btcPrice: quote.rate.btcPrice, fetchedAt: now.toISOString() }
        : undefined

      const row = await prisma.remoteOrder.create({
        data: {
          buyerPubkey: buyer,
          offerId: offer.id,
          quantity,
          payeePubkey: payee.pubkey,
          payeeRole: payee.role,
          payeeLud16: payee.lud16,
          zap,
          amountSats: quote.amountSats,
          amountBasis: quote.basis,
          ...(quote.priceAmount !== undefined ? { priceAmount: quote.priceAmount } : {}),
          ...(quote.priceCurrency !== undefined ? { priceCurrency: quote.priceCurrency } : {}),
          ...(rateSnapshot !== undefined ? { rateSnapshot } : {}),
          status: 'QUOTED',
          quoteExpiresAt: quoteExpiry(now),
        },
      })

      const responseBody: { order: OrderView; zapRequestTemplate?: Record<string, unknown> } = { order: toView(row) }
      if (zap) {
        responseBody.zapRequestTemplate = {
          payeePubkey: payee.pubkey,
          amountMsats: quote.amountSats * 1000,
          lnurl: payee.lnurl.lnurl,
          relays: deps.relays(),
          listingAddress: listingAddressOf(offer),
        }
      }
      res.status(201).json(responseBody)
    }),
  )

  // POST /:id/invoice — fetch (or return the stored) bolt11 for a QUOTED order.
  router.post(
    '/:id/invoice',
    requireAuth(prisma),
    safe(async (req, res) => {
      const buyer = authOf(req)
      if (!buyer) return sendError(res, 401, 'UNAUTHORIZED')

      const order = await prisma.remoteOrder.findUnique({ where: { id: routeParam(req.params.id) } })
      if (!order) return sendError(res, 404, 'NOT_FOUND')
      if (order.buyerPubkey !== buyer) return sendError(res, 403, 'FORBIDDEN')

      const now = deps.now()
      if (
        order.status === 'INVOICED' &&
        order.bolt11 &&
        (!order.invoiceExpiresAt || order.invoiceExpiresAt > now)
      ) {
        res.json({
          bolt11: order.bolt11,
          paymentHash: order.paymentHash,
          expiresAt: order.invoiceExpiresAt?.toISOString(),
          order: toView(order),
        })
        return
      }

      if (order.status === 'INVOICED' && order.invoiceExpiresAt && order.invoiceExpiresAt <= now) {
        await expireLapsedInvoice(order.id)
        return sendError(res, 409, 'QUOTE_EXPIRED')
      }

      if (order.status !== 'QUOTED') return sendError(res, 409, 'INVALID_STATE')

      if (order.quoteExpiresAt <= now) {
        await prisma.remoteOrder.updateMany({ where: { id: order.id, status: 'QUOTED' }, data: { status: 'EXPIRED' } })
        return sendError(res, 409, 'QUOTE_EXPIRED')
      }

      // Re-resolve the payee: never pay a different address than the one disclosed.
      const offer = await loadOffer(order.offerId)
      if (!offer || offer.source !== 'REMOTE' || offer.status !== 'ACTIVE' || offer.blockedAt) {
        return sendError(res, 409, 'INVALID_STATE')
      }
      const resolved = await deps.resolvePayee({
        creatorPubkey: offer.creatorPubkey,
        remoteSellerPubkey: offer.remoteSellerPubkey,
      })
      if (
        !resolved.ok ||
        resolved.payee.pubkey !== order.payeePubkey ||
        resolved.payee.lud16 !== order.payeeLud16 ||
        (order.zap && !resolved.payee.zap)
      ) {
        return sendError(res, 409, 'INVALID_STATE')
      }

      let zapRequestJson: string | undefined
      let zapRequestId: string | undefined
      if (order.zap) {
        const zapRequest = (req.body ?? {}).zapRequest
        if (zapRequest === undefined) return sendError(res, 400, 'ZAP_REQUEST_INVALID')
        const validation = validateZapRequest(zapRequest, {
          buyerPubkey: buyer,
          payeePubkey: order.payeePubkey,
          amountMsats: order.amountSats * 1000,
          listingAddress: listingAddressOf(offer),
        })
        if (!validation.ok) return sendError(res, 400, 'ZAP_REQUEST_INVALID', { reason: validation.reason })
        zapRequestJson = validation.json
        zapRequestId = validation.id
      }

      let invoice: RemoteInvoice
      try {
        invoice = await deps.fetchInvoice({
          callback: resolved.payee.lnurl.callback,
          lnurl: resolved.payee.lnurl.lnurl,
          amountSats: order.amountSats,
          metadataHash: resolved.payee.lnurl.metadataHash,
          zapRequestJson,
        })
      } catch {
        await prisma.remoteOrder
          .updateMany({ where: { id: order.id, status: 'QUOTED' }, data: { lastError: 'invoice request failed' } })
          .catch(() => {})
        return sendError(res, 502, 'UPSTREAM_ERROR')
      }

      const claimed = await prisma.remoteOrder.updateMany({
        where: { id: order.id, status: 'QUOTED' },
        data: {
          status: 'INVOICED',
          bolt11: invoice.bolt11,
          paymentHash: invoice.paymentHash,
          verifyUrl: invoice.verifyUrl ?? null,
          invoiceExpiresAt: invoice.expiresAt ?? null,
          zapRequestId: zapRequestId ?? null,
        },
      })
      if (claimed.count === 0) return sendError(res, 409, 'INVALID_STATE')

      const updated = await reloadOrder(order.id)
      res.json({
        bolt11: invoice.bolt11,
        paymentHash: invoice.paymentHash,
        expiresAt: invoice.expiresAt?.toISOString(),
        order: toView(updated),
      })
    }),
  )

  // POST /:id/confirm — buyer proves payment with the preimage.
  router.post(
    '/:id/confirm',
    requireAuth(prisma),
    safe(async (req, res) => {
      const buyer = authOf(req)
      if (!buyer) return sendError(res, 401, 'UNAUTHORIZED')

      const order = await prisma.remoteOrder.findUnique({ where: { id: routeParam(req.params.id) } })
      if (!order) return sendError(res, 404, 'NOT_FOUND')
      if (order.buyerPubkey !== buyer) return sendError(res, 403, 'FORBIDDEN')

      const preimageRaw = (req.body ?? {}).preimage
      if (typeof preimageRaw !== 'string' || !HEX64.test(preimageRaw)) return sendError(res, 400, 'BAD_REQUEST')
      const preimage = preimageRaw.toLowerCase()

      if (order.status === 'PAID') {
        // Idempotent for the right proof only: a wrong preimage is never answered with success.
        if (!preimageMatches(preimage, order.paymentHash)) return sendError(res, 400, 'PREIMAGE_MISMATCH')
        res.json({ order: toView(order) })
        return
      }
      const lateProof = order.status === 'EXPIRED' && Boolean(order.paymentHash)
      if (order.status !== 'INVOICED' && !lateProof) return sendError(res, 409, 'INVALID_STATE')
      if (!preimageMatches(preimage, order.paymentHash)) return sendError(res, 400, 'PREIMAGE_MISMATCH')

      const paid = await markPaid(order.id, preimage, deps.now())
      if (!paid) return sendError(res, 409, 'INVALID_STATE')

      res.json({ order: toView(await reloadOrder(order.id)) })
    }),
  )

  // GET /:id — buyer-only status; lazily expires quotes and refreshes via LUD-21.
  router.get(
    '/:id',
    requireAuth(prisma),
    safe(async (req, res) => {
      const buyer = authOf(req)
      if (!buyer) return sendError(res, 401, 'UNAUTHORIZED')

      let order = await prisma.remoteOrder.findUnique({ where: { id: routeParam(req.params.id) } })
      if (!order) return sendError(res, 404, 'NOT_FOUND')
      if (order.buyerPubkey !== buyer) return sendError(res, 403, 'FORBIDDEN')

      const now = deps.now()
      if (order.status === 'QUOTED' && order.quoteExpiresAt <= now) {
        await prisma.remoteOrder.updateMany({ where: { id: order.id, status: 'QUOTED' }, data: { status: 'EXPIRED' } })
        order = await reloadOrder(order.id)
      }

      const invoiceLive = order.status === 'INVOICED' || (order.status === 'EXPIRED' && Boolean(order.paymentHash))
      if (invoiceLive && (order.verifyUrl || order.zap) && shouldVerify(order.id, now.getTime())) {
        // 1. LUD-21 verify, 2. a public zap receipt carrying the preimage. Both need a preimage that
        // hashes to the payment hash; neither can mark an order paid on an assertion alone.
        let preimage: string | null = null
        if (order.verifyUrl) {
          const result = await deps.verifySettlement(order.verifyUrl).catch(() => null)
          if (result?.settled && result.preimage && preimageMatches(result.preimage, order.paymentHash)) {
            preimage = result.preimage.toLowerCase()
          }
        }
        if (!preimage && order.zap && order.bolt11 && order.paymentHash) {
          const offer = await loadOffer(order.offerId)
          if (offer) {
            const found = await deps
              .findZapReceiptPreimage({
                payeePubkey: order.payeePubkey,
                listingAddress: listingAddressOf(offer),
                bolt11: order.bolt11,
                paymentHash: order.paymentHash,
                since: order.createdAt,
              })
              .catch(() => null)
            if (found && preimageMatches(found, order.paymentHash)) preimage = found.toLowerCase()
          }
        }
        if (preimage) {
          await markPaid(order.id, preimage, now)
          order = await reloadOrder(order.id)
        }
      }

      // Only after the settlement check above, so a payment made just before expiry is not hidden.
      if (order.status === 'INVOICED' && order.invoiceExpiresAt && order.invoiceExpiresAt <= now) {
        await expireLapsedInvoice(order.id)
        order = await reloadOrder(order.id)
      }

      res.json({ order: toView(order) })
    }),
  )

  function shouldVerify(id: string, nowMs: number): boolean {
    const last = lastVerifyAt.get(id)
    if (last !== undefined && nowMs - last < VERIFY_THROTTLE_MS) return false
    lastVerifyAt.delete(id)
    lastVerifyAt.set(id, nowMs)
    if (lastVerifyAt.size > VERIFY_THROTTLE_MAX_ENTRIES) {
      const oldest = lastVerifyAt.keys().next().value
      if (oldest !== undefined) lastVerifyAt.delete(oldest)
    }
    return true
  }

  // GET / — the caller's own orders, newest first.
  router.get(
    '/',
    requireAuth(prisma),
    safe(async (req, res) => {
      const buyer = authOf(req)
      if (!buyer) return sendError(res, 401, 'UNAUTHORIZED')

      const offerId = typeof req.query.offerId === 'string' && req.query.offerId ? req.query.offerId : undefined
      const rows = await prisma.remoteOrder.findMany({
        where: { buyerPubkey: buyer, ...(offerId ? { offerId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
      res.json({ orders: rows.map(toView) })
    }),
  )

  return router
}
