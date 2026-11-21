// ADR-362 D5: ICP escrow trade route surface. The canister is the source of
// truth; this layer relays client-signed authorizations, persists the mirror
// (ADR-355 D4 mirror-not-truth), and announces drift rather than hiding it.
//
// Scope note (P2): this file ships the trade lifecycle — create, list, detail,
// funding check, release, dispute open, timeout refund — plus the unauthenticated
// verification-convenience endpoint. The evidence dossier (`GET /:id/evidence`)
// and the public share read (`GET /api/public/evidence/:shareToken`) belong to
// P5 (ADR-359) and are not wired here yet.
//
// The relay routes carry a signature the client produced; the server never
// holds a party's key and never signs on a party's behalf (ADR-254 §2). The
// client-side signing library is FU-618 (P4) — until then these routes simply
// forward whatever signature blob the client sends, and the canister verifies
// it against the trade's pubkeys.

import { Router, type Request, type Response } from 'express'
import type { Prisma, PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../middleware/require-auth.js'
import { blockIfPaymentsPaused } from '../middleware/payments-paused.js'
import {
  getEscrowCanisterClient,
  EscrowCanisterError,
  type ServerEscrowTradeState,
} from '../services/escrow-canister-client.js'
import { HEX_PUBKEY, NostrAuthEventSchema, decodeEvent } from '../lib/nostr-auth-event.js'

const CreateEscrowTradeSchema = z.object({
  // The mirror column is Postgres Int (prisma/schema.prisma EscrowTrade) — cap here
  // so an over-large amount fails validation instead of creating an orphaned
  // on-chain trade whose mirror insert would overflow afterwards.
  expectedAmountSats: z.number().int().positive().max(2_147_483_647),
  buyerRefundAddress: z.string().min(1),
  sellerPayoutAddress: z.string().min(1),
  buyerPubkey: HEX_PUBKEY,
  sellerPubkey: HEX_PUBKEY,
  milestoneBps: z.array(z.number().int().min(1).max(10_000)).min(1),
  timeoutAt: z.string().regex(/^\d+$/, 'timeoutAt must be nanoseconds since epoch as a decimal string'),
  buyerTermsEvent: NostrAuthEventSchema,
  sellerTermsEvent: NostrAuthEventSchema,
  ticketId: z.string().min(1).nullable().optional(),
  cooperationId: z.string().min(1).nullable().optional(),
})

const ReleaseMilestoneSchema = z.object({
  milestoneIndex: z.number().int().min(0),
  event: NostrAuthEventSchema,
})

const OpenDisputeSchema = z.object({
  event: NostrAuthEventSchema,
})

const LIST_LIMIT_MAX = 50

// Maps a canister TradeError to an HTTP response. Returns null when the error
// is not a canister rejection (i.e. should fall through to a 500).
function canisterErrorResponse(err: unknown): { status: number; body: Record<string, unknown> } | null {
  if (!(err instanceof EscrowCanisterError)) return null
  const e = err.canisterError
  if ('NotFound' in e) return { status: 404, body: { error: 'NOT_FOUND', message: 'trade not found on the canister' } }
  if ('SignatureVerificationFailed' in e) {
    return { status: 401, body: { error: 'SIGNATURE_INVALID', message: e.SignatureVerificationFailed.reason } }
  }
  if ('NotImplemented' in e) {
    return { status: 501, body: { error: 'NOT_IMPLEMENTED', message: e.NotImplemented.pending_followup } }
  }
  if ('MilestoneAlreadyReleased' in e) {
    // REQ-ACTION-06: a concurrent duplicate presents as already-completed.
    return { status: 409, body: { error: 'ALREADY_COMPLETED', message: 'this milestone was already released' } }
  }
  if ('InvalidTransition' in e) {
    return { status: 409, body: { error: 'INVALID_TRANSITION', message: `action ${e.InvalidTransition.action} is not legal from the current state` } }
  }
  if ('TimeoutNotReached' in e) {
    return { status: 409, body: { error: 'TIMEOUT_NOT_REACHED', message: 'the timeout has not elapsed yet' } }
  }
  if ('MilestoneBpsMismatch' in e || 'VerdictBpsMismatch' in e || 'MilestoneIndexOutOfRange' in e || 'EmptyMilestones' in e || 'MilestoneOutOfOrder' in e) {
    return { status: 400, body: { error: 'INVALID_ARGS', message: err.message } }
  }
  if ('FeeExceedsInput' in e || 'BitcoinApiError' in e || 'PayoutInvariantViolation' in e) {
    return { status: 502, body: { error: 'BITCOIN_API_ERROR', message: err.message } }
  }
  return { status: 500, body: { error: 'INTERNAL_ERROR', message: err.message } }
}

// Appends an append-only timeline event (ADR-362 D2 — the dossier's backbone).
async function recordEvent(
  prisma: PrismaClient,
  tradeId: string,
  kind: string,
  message: string,
  detail?: unknown,
): Promise<void> {
  await prisma.escrowTradeEvent.create({
    data: { tradeId, kind, message, detail: detail === undefined ? undefined : (detail as object) },
  }).catch(() => {})
}

// Frozen identity/contact snapshot for a party (ADR-357 D2 + dispute position).
// Captured at trade creation and re-captured when a dispute opens, so the
// partner cards always render WHO is involved even if the party later edits or
// deletes their Nostr profile. Display-only; never mixed back into auth.
async function captureIdentitySnapshot(prisma: PrismaClient, pubkey: string): Promise<Prisma.InputJsonObject> {
  const user = await prisma.user.findUnique({
    where: { pubkey },
    select: { name: true, nip05: true, picture: true, banner: true, lnAddress: true, about: true },
  }).catch(() => null)
  return {
    name: user?.name ?? null,
    nip05: user?.nip05 ?? null,
    picture: user?.picture ?? null,
    banner: user?.banner ?? null,
    lnAddress: user?.lnAddress ?? null,
    about: user?.about ?? null,
    capturedAt: new Date().toISOString(),
  }
}

// Loads a mirror row the caller is a party to (buyer or seller).
async function loadTradeForCaller(
  prisma: PrismaClient,
  callerPubkey: string,
  tradeId: string,
): Promise<{ trade: { id: string; buyerPubkey: string; sellerPubkey: string; state: string; canisterTradeId: string; canisterId: string } } | { error: { status: number; body: Record<string, unknown> } }> {
  const trade = await prisma.escrowTrade.findUnique({ where: { id: tradeId } })
  if (!trade) return { error: { status: 404, body: { error: 'NOT_FOUND', message: 'escrow trade not found' } } }
  if (trade.buyerPubkey !== callerPubkey && trade.sellerPubkey !== callerPubkey) {
    return { error: { status: 403, body: { error: 'FORBIDDEN', message: 'only the trade parties can access this' } } }
  }
  return { trade }
}

export function createEscrowTradeRouter(prisma: PrismaClient): Router {
  const router = Router()

  // ── POST /escrow-trades — create (ADR-362 D5) ──────────────────────────────
  // SECURITY (pentest G3, 2026-09-17): this route was missing
  // blockIfPaymentsPaused — every other money-creating route (tickets,
  // escrow phase1/2/3, cooperation fund-escrow) has it, but new ICP escrow
  // trades could still be created while the kill switch was on.
  router.post('/escrow-trades', requireAuth(prisma), blockIfPaymentsPaused, async (req: Request, res: Response) => {
    let createdOnChainTradeId: string | null = null
    try {
      const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
      if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

      const parsed = CreateEscrowTradeSchema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.message })
      }
      const b = parsed.data
      if (b.buyerPubkey === b.sellerPubkey) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'buyer and seller must differ' })
      }
      if (b.ticketId && b.cooperationId) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'ticketId and cooperationId are mutually exclusive (ADR-204)' })
      }
      // Validate the FK anchors BEFORE burning an on-chain trade id: an insert-time
      // failure after create_trade would strand a real PENDING_FUNDING trade that
      // no list/detail route can ever see (review fix 2026-09-02).
      if (b.ticketId) {
        const ticket = await prisma.ticket.findUnique({ where: { id: b.ticketId }, select: { id: true } })
        if (!ticket) {
          return res.status(400).json({ error: 'VALIDATION_ERROR', message: `ticket ${b.ticketId} does not exist` })
        }
      }
      if (b.cooperationId) {
        const cooperation = await prisma.cooperation.findUnique({ where: { id: b.cooperationId }, select: { id: true } })
        if (!cooperation) {
          return res.status(400).json({ error: 'VALIDATION_ERROR', message: `cooperation ${b.cooperationId} does not exist` })
        }
      }
      const bpsSum = b.milestoneBps.reduce((s, x) => s + x, 0)
      if (bpsSum !== 10_000) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: `milestoneBps must sum to 10000 (got ${bpsSum})` })
      }
      // The caller must be one of the trade parties.
      if (callerPubkey !== b.buyerPubkey && callerPubkey !== b.sellerPubkey) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'only the buyer or seller can create the trade' })
      }

      const client = await getEscrowCanisterClient()
      if (!client) return res.status(409).json({ error: 'NO_CANISTER', message: 'no escrow canister backend configured' })

      const { canisterTradeId } = await client.createTrade({
        expectedAmountSats: BigInt(b.expectedAmountSats),
        buyerRefundAddress: b.buyerRefundAddress,
        sellerPayoutAddress: b.sellerPayoutAddress,
        buyerPubkey: b.buyerPubkey,
        sellerPubkey: b.sellerPubkey,
        buyerTermsEvent: decodeEvent(b.buyerTermsEvent),
        sellerTermsEvent: decodeEvent(b.sellerTermsEvent),
        milestoneBps: b.milestoneBps,
        timeoutAt: BigInt(b.timeoutAt),
      })
      createdOnChainTradeId = canisterTradeId

      // Read the full trade back (btc_address, trade_terms_hash) for the mirror.
      const view = await client.getTrade(canisterTradeId)

      const buyerIdentitySnapshot = await captureIdentitySnapshot(prisma, b.buyerPubkey)
      const sellerIdentitySnapshot = await captureIdentitySnapshot(prisma, b.sellerPubkey)

      const trade = await prisma.escrowTrade.create({
        data: {
          canisterTradeId,
          canisterId: process.env.ICP_ESCROW_CANISTER_ID ?? '',
          network: 'ic',
          btcAddress: view?.btcAddress ?? '',
          buyerPubkey: b.buyerPubkey,
          sellerPubkey: b.sellerPubkey,
          buyerRefundAddress: b.buyerRefundAddress,
          sellerPayoutAddress: b.sellerPayoutAddress,
          expectedAmountSats: b.expectedAmountSats,
          milestones: (view?.milestones ?? b.milestoneBps.map((pctBps) => ({ pctBps, released: false }))) as object,
          state: view?.state ?? 'PENDING_FUNDING',
          settledBuyerBps: view?.settledBuyerBps ?? null,
          settledSellerBps: view?.settledSellerBps ?? null,
          timeoutAt: b.timeoutAt,
          fundedAt: view?.fundedAt ?? null,
          tradeTermsHash: view?.tradeTermsHash ?? null,
          ticketId: b.ticketId ?? null,
          cooperationId: b.cooperationId ?? null,
          buyerIdentitySnapshot,
          sellerIdentitySnapshot,
        },
      })

      // First code path able to set escrowProvider = 'ICP' since ADR-275 (D6).
      if (b.ticketId) {
        await prisma.ticket.update({ where: { id: b.ticketId }, data: { escrowProvider: 'ICP' } }).catch(() => {})
      }

      await recordEvent(prisma, trade.id, 'STATE_TRANSITION', `trade created (canister ${canisterTradeId})`, {
        state: 'PENDING_FUNDING',
      })

      return res.status(201).json({ trade })
    } catch (err) {
      const mapped = canisterErrorResponse(err)
      if (mapped) return res.status(mapped.status).json(mapped.body)
      if (createdOnChainTradeId) {
        // The canister holds a real PENDING_FUNDING trade this mirror never captured.
        console.error(
          `[escrow-trade] mirror insert failed after on-chain create_trade (canister trade ${createdOnChainTradeId}) — trade is orphaned; reconcile before retrying:`,
          err,
        )
      } else {
        console.error('[escrow-trade] POST /escrow-trades error:', err)
      }
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ── GET /escrow-trades — list for the caller, role-filtered ────────────────
  router.get('/escrow-trades', requireAuth(prisma), async (req: Request, res: Response) => {
    try {
      const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
      if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })
      const limit = Math.min(Number(req.query.limit) || 20, LIST_LIMIT_MAX)
      const trades = await prisma.escrowTrade.findMany({
        where: { OR: [{ buyerPubkey: callerPubkey }, { sellerPubkey: callerPubkey }] },
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      return res.json({ trades })
    } catch (err) {
      console.error('[escrow-trade] GET /escrow-trades error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ── GET /escrow-trades/:id — detail + fresh canister read + drift flag ─────
  router.get('/escrow-trades/:id', requireAuth(prisma), async (req: Request, res: Response) => {
    try {
      const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
      if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })

      const loaded = await loadTradeForCaller(prisma, callerPubkey, req.params.id as string)
      if ('error' in loaded) return res.status(loaded.error.status).json(loaded.error.body)
      const { trade } = loaded

      const events = await prisma.escrowTradeEvent.findMany({
        where: { tradeId: trade.id },
        orderBy: { createdAt: 'asc' },
      })

      // Certified canister read (FU-619): trade data plus subnet certificate + Merkle
      // witness, relayed for the client's own verification against the IC root key
      // (ADR-356: the server is a courier, never a trust root). The canister wins on
      // drift.
      let canisterState: ServerEscrowTradeState | null = null
      let drift = false
      let certificate: string | null = null
      let witness: string | null = null
      const client = await getEscrowCanisterClient()
      if (client) {
        const certified = await client.getTradeCertified(trade.canisterTradeId)
        if (certified.trade) {
          canisterState = certified.trade.state
          drift = certified.trade.state !== trade.state
          if (drift) {
            await recordEvent(prisma, trade.id, 'DRIFT_DETECTED', `mirror ${trade.state} diverges from canister ${certified.trade.state}`)
          }
        }
        certificate = certified.certificate ? Buffer.from(certified.certificate).toString('base64') : null
        witness = Buffer.from(certified.witness).toString('base64')
      }

      return res.json({ trade, canisterState, drift, events, certificate, witness })
    } catch (err) {
      console.error('[escrow-trade] GET /escrow-trades/:id error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ── POST /escrow-trades/:id/check-funding — relay permissionless check ─────
  router.post('/escrow-trades/:id/check-funding', requireAuth(prisma), async (req: Request, res: Response) => {
    try {
      const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
      if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })
      const loaded = await loadTradeForCaller(prisma, callerPubkey, req.params.id as string)
      if ('error' in loaded) return res.status(loaded.error.status).json(loaded.error.body)
      const { trade } = loaded

      const client = await getEscrowCanisterClient()
      if (!client) return res.status(409).json({ error: 'NO_CANISTER', message: 'no escrow canister backend configured' })

      const stateView = await client.checkFunding(trade.canisterTradeId)
      await recordEvent(prisma, trade.id, 'CHAIN_OBSERVATION', `check_funding -> ${stateView.state}`, { state: stateView.state })

      // Sync the mirror forward when funding confirmed (never rewritten to hide drift).
      if (stateView.state !== trade.state) {
        await prisma.escrowTrade.update({
          where: { id: trade.id },
          data: { state: stateView.state, settledBuyerBps: stateView.settledBuyerBps, settledSellerBps: stateView.settledSellerBps },
        })
      }
      return res.json({ state: stateView.state })
    } catch (err) {
      const mapped = canisterErrorResponse(err)
      if (mapped) return res.status(mapped.status).json(mapped.body)
      console.error('[escrow-trade] check-funding error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ── POST /escrow-trades/:id/release — relay buyer-signed release_milestone ──
  router.post('/escrow-trades/:id/release', requireAuth(prisma), async (req: Request, res: Response) => {
    try {
      const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
      if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })
      const loaded = await loadTradeForCaller(prisma, callerPubkey, req.params.id as string)
      if ('error' in loaded) return res.status(loaded.error.status).json(loaded.error.body)
      const { trade } = loaded
      // release_milestone is buyer-authorized (ADR-254 §6).
      if (trade.buyerPubkey !== callerPubkey) {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'only the buyer can release a milestone' })
      }

      const parsed = ReleaseMilestoneSchema.safeParse(req.body)
      if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.message })

      const client = await getEscrowCanisterClient()
      if (!client) return res.status(409).json({ error: 'NO_CANISTER', message: 'no escrow canister backend configured' })

      const stateView = await client.releaseMilestone(trade.canisterTradeId, parsed.data.milestoneIndex, decodeEvent(parsed.data.event))
      // Refresh the full canister view so the mirror's `milestones` JSON (release
      // progress) stays in lock-step with state — a partial release leaves state
      // FUNDED and is otherwise invisible to the mirror (review fix 2026-09-02).
      const refreshed = await client.getTrade(trade.canisterTradeId)
      await prisma.escrowTrade.update({
        where: { id: trade.id },
        data: {
          state: stateView.state,
          settledBuyerBps: stateView.settledBuyerBps,
          settledSellerBps: stateView.settledSellerBps,
          ...(refreshed ? { milestones: refreshed.milestones as object } : {}),
        },
      })
      await recordEvent(prisma, trade.id, 'STATE_TRANSITION', `milestone ${parsed.data.milestoneIndex} released -> ${stateView.state}`)
      return res.json({ state: stateView.state })
    } catch (err) {
      const mapped = canisterErrorResponse(err)
      if (mapped) return res.status(mapped.status).json(mapped.body)
      console.error('[escrow-trade] release error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ── POST /escrow-trades/:id/dispute — relay party-signed open_dispute ───────
  // The EscrowDisputeLink (joining this to an app-side Dispute row, GAP F-8) is
  // wired in P5 when the dispute/evidence surface lands; P2 records the canister
  // state transition only.
  router.post('/escrow-trades/:id/dispute', requireAuth(prisma), async (req: Request, res: Response) => {
    try {
      const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
      if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })
      const loaded = await loadTradeForCaller(prisma, callerPubkey, req.params.id as string)
      if ('error' in loaded) return res.status(loaded.error.status).json(loaded.error.body)
      const { trade } = loaded

      const parsed = OpenDisputeSchema.safeParse(req.body)
      if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', message: parsed.error.message })

      const client = await getEscrowCanisterClient()
      if (!client) return res.status(409).json({ error: 'NO_CANISTER', message: 'no escrow canister backend configured' })

      const stateView = await client.openDispute(trade.canisterTradeId, decodeEvent(parsed.data.event))
      // Freeze the identity/contact snapshots at the moment the dispute opens, so
      // the partner cards and the dispute surface render WHO is involved even if a
      // party edits or deletes their Nostr profile afterwards.
      const buyerIdentitySnapshot = await captureIdentitySnapshot(prisma, trade.buyerPubkey)
      const sellerIdentitySnapshot = await captureIdentitySnapshot(prisma, trade.sellerPubkey)
      await prisma.escrowTrade.update({
        where: { id: trade.id },
        data: {
          state: stateView.state,
          settledBuyerBps: stateView.settledBuyerBps,
          settledSellerBps: stateView.settledSellerBps,
          buyerIdentitySnapshot,
          sellerIdentitySnapshot,
        },
      })
      await recordEvent(prisma, trade.id, 'STATE_TRANSITION', `dispute opened -> ${stateView.state}`)
      return res.json({ state: stateView.state })
    } catch (err) {
      const mapped = canisterErrorResponse(err)
      if (mapped) return res.status(mapped.status).json(mapped.body)
      console.error('[escrow-trade] dispute error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ── POST /escrow-trades/:id/timeout-refund — relay permissionless refund ────
  router.post('/escrow-trades/:id/timeout-refund', requireAuth(prisma), async (req: Request, res: Response) => {
    try {
      const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
      if (!callerPubkey) return res.status(401).json({ error: 'UNAUTHORIZED' })
      const loaded = await loadTradeForCaller(prisma, callerPubkey, req.params.id as string)
      if ('error' in loaded) return res.status(loaded.error.status).json(loaded.error.body)
      const { trade } = loaded

      const client = await getEscrowCanisterClient()
      if (!client) return res.status(409).json({ error: 'NO_CANISTER', message: 'no escrow canister backend configured' })

      const stateView = await client.claimTimeoutRefund(trade.canisterTradeId)
      await prisma.escrowTrade.update({
        where: { id: trade.id },
        data: { state: stateView.state, settledBuyerBps: stateView.settledBuyerBps, settledSellerBps: stateView.settledSellerBps },
      })
      await recordEvent(prisma, trade.id, 'STATE_TRANSITION', `timeout refund claimed -> ${stateView.state}`)
      return res.json({ state: stateView.state })
    } catch (err) {
      const mapped = canisterErrorResponse(err)
      if (mapped) return res.status(mapped.status).json(mapped.body)
      console.error('[escrow-trade] timeout-refund error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  // ── GET /escrow-verification/:canisterId — UNAUTHENTICATED convenience ─────
  // ADR-362 D5: last known snapshot + attestation, as a convenience ONLY —
  // never a substitute for the client's own browser-side verification (ADR-356).
  router.get('/escrow-verification/:canisterId', async (req: Request, res: Response) => {
    try {
      const snapshot = await prisma.escrowVerificationSnapshot.findFirst({
        where: { canisterId: req.params.canisterId as string },
        orderBy: { observedAt: 'desc' },
      })
      return res.json({
        // This endpoint is untrusted input to the client; it is a convenience,
        // not a trust root. The client re-verifies against the IC itself.
        snapshot,
        notice: 'Convenience only — verify against the Internet Computer yourself; never trust this response.',
      })
    } catch (err) {
      console.error('[escrow-trade] GET /escrow-verification error:', err)
      return res.status(500).json({ error: 'INTERNAL_ERROR' })
    }
  })

  return router
}
