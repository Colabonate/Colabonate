import { Router, type Request, type Response } from 'express'
import type { PrismaClient } from '@prisma/client'
import type { PaymentProvider } from '@col/payments'
import { LNBitsProvider } from '@col/payments'
import {
  buildTicketCreatedTags,
  nostrService as defaultNostrService,
} from '../services/nostr-relay.js'
import { NOSTR_KINDS } from '../services/kind-mapping.js'
import { computePayloadCommitment, type CommercialPayload, formatVariantLabel } from '@col/nostr-schema'
import type { Filter, Event } from 'nostr-tools'
import { computeEscrowDeadline } from '../services/escrow-timeout.js'
import { registerInvoice } from './lightning.js'
import { blockIfPaymentsPaused } from '../middleware/payments-paused.js'
import { BountyTicketConflictError, resolveBountyTicket, type BountyBrief } from '../services/bounty-ticket.js'
import { rejectIfAboveLaunchCap } from '../lib/launch-tx-cap.js'
import { resolveSellerInvoice } from '../services/sellerPaymentResolver.js'
import { confirmPaymentByHash } from '../services/paymentConfirmation.js'
import { resolvePlatformInvoice } from '../services/platformPaymentResolver.js'
import { debitDemoWallet } from '../services/demoLedger.js'
import { isBetaMode, isProductionDirectPayOnly } from '../services/betaMode.js'
import { getEffectiveStrategy } from '../services/walletStrategy.js'
import { isEscrowEnabled } from '../lib/escrow-gate.js'
import { isValidCheckoutId, resolveShippingSats, resolveTicketQuantity } from '../lib/ticket-quantity.js'
import { InsufficientStockError, reserveOfferStock } from '../services/ticketStock.js'
import { settlePlatformFee } from '../services/platformFeeSettlement.js'
import { verifyPreimage } from '../lib/preimage.js'
import { sanitiseUpstreamError } from '../lib/sanitise-error.js'
import { computeHostedCanvasFeeSats, readCanvasConfig, resolveCanvasHostedFeeBps } from '../lib/canvas-config.js'
import { enqueueProvisioningOnPaid } from '../services/canvas-provisioning.js'
import { createNotification, notifyTicketCreated } from '../services/notifications.js'
import { createHash } from 'node:crypto'
import { remoteOfferPurchaseBlock } from '../lib/remote-offer-guard.js'

/** A P2PK token for one ticket is a handful of proofs; this bounds abuse. */
const CASHU_TOKEN_MAX_LENGTH = 32_000

export interface NostrServiceLike {
  publishTicketCreated: typeof defaultNostrService.publishTicketCreated
  publishTicketStatus: typeof defaultNostrService.publishTicketStatus
  getEvents(filter: Filter, timeoutMs: number): Promise<Event[]>
}

export interface CreateTicketDeps {
  baseUrl: string
}

export type TicketErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'WALLET_REQUIRED'
  | 'TX_ABOVE_LAUNCH_CAP'
  | 'SELLER_PAYMENT_NOT_CONFIGURED'
  | 'INSUFFICIENT_STOCK'
  | 'FORBIDDEN'
  | 'PAYMENT_UPSTREAM_ERROR'
  | 'DB_ERROR'
  | 'UNKNOWN'

function isPrismaErrorLike(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { name?: string }).name
  const code = (err as { code?: string }).code
  return (
    name === 'PrismaClientKnownRequestError' ||
    name === 'PrismaClientUnknownRequestError' ||
    name === 'PrismaClientValidationError' ||
    // Prisma engine codes are `P` + 4 digits. A bare `typeof code === 'string'`
    // also matched Node network errors (ECONNREFUSED, ETIMEDOUT) thrown by the
    // seller rails, which are upstream failures, not DB failures (ADR-394).
    (typeof code === 'string' && /^P\d{4}$/.test(code))
  )
}

// ADR-370 D2 (Phase 1, FU-670): snapshot the offer's collaboration-canvas
// binding onto the Ticket at creation — for EVERY provider (fix G3: doop-local
// was re-derived live from the offer and silently rewrote existing tickets on
// offer edits; doop-hosted was only snapshotted once a Workspace existed).
// Returns the ticket canvas columns to write (spread into prisma.ticket.create
// data). Columns are null/omitted when the offer carries no canvas or provider
// is 'none' (D1: NONE ≡ absent).
function ticketCanvasSnapshotColumns(
  offerType: string,
  agentConfigMeta: unknown,
): {
  canvasProvider?: string
  canvasInstanceUrl?: string
  canvasId?: string
  canvasBuyerAccess?: string
  canvasProvisioningStatus?: string
} {
  if (offerType !== 'AGENT_SETUP') return {}
  const canvas = readCanvasConfig(agentConfigMeta)
  if (!canvas) return {}
  if (canvas.provider === 'doop-local') {
    return {
      canvasProvider: 'doop-local',
      ...(canvas.instanceUrl ? { canvasInstanceUrl: canvas.instanceUrl } : {}),
      ...(canvas.canvasId ? { canvasId: canvas.canvasId } : {}),
    }
  }
  if (canvas.provider === 'doop-hosted') {
    return {
      canvasProvider: 'doop-hosted',
      ...(canvas.canvasId ? { canvasId: canvas.canvasId } : {}),
      canvasBuyerAccess: canvas.buyerAccess ?? 'edit',
      // canvasProvisioningStatus is set to 'pending' at the first transition
      // to PAID (auto-enqueue, fix G2); null = created, not yet paid.
    }
  }
  return {}
}

export function createTicketRouter(
  prisma: PrismaClient,
  payments: PaymentProvider,
  deps: CreateTicketDeps,
  nostrService: NostrServiceLike = defaultNostrService,
) {
  const router = Router()

  router.post('/', blockIfPaymentsPaused, async (req: Request, res: Response) => {
    // FU-842: deliveryTimeDays / deliveryCostSats / deliveryNotes are no longer
    // read from the body — they are the offer's terms and are derived below.
    const { offerId, deliveryAddress, visibility, variantLabel, quantity: rawQuantity, checkoutId, agentTaskApplicationId } = req.body as {
      offerId?: string
      // ADR-397 D3: set when the poster tickets a bounty winner — the ticket
      // then charges the application's agreed price and links to the bounty.
      agentTaskApplicationId?: string
      // FU-840: random key grouping the tickets of one cart checkout.
      checkoutId?: string
      deliveryAddress?: string
      visibility?: number
      variantLabel?: string
      // ADR-394: purchased unit count (default 1). amountSats becomes the total.
      quantity?: number
    }

    if (!offerId) {
      return res.status(400).json({ error: 'offerId is required', code: 'BAD_REQUEST' as TicketErrorCode })
    }
    if (checkoutId !== undefined && checkoutId !== null && !isValidCheckoutId(checkoutId)) {
      return res.status(400).json({ error: 'checkoutId must be 8-64 URL-safe characters', code: 'BAD_REQUEST' as TicketErrorCode })
    }

    const buyerPubkey = (req as Request & { authPubkey?: string }).authPubkey
    if (!buyerPubkey) {
      return res.status(401).json({ error: 'UNAUTHORIZED', code: 'BAD_REQUEST' as TicketErrorCode })
    }

    try {
      // ADR-396 D3: opt into the sealed config so an AGENT_SETUP booking can pin it.
      const offer = await prisma.offer.findUnique({ where: { id: offerId }, omit: { agentConfigSealed: false } })
      if (!offer) {
        return res.status(404).json({ error: 'Offer not found', code: 'NOT_FOUND' as TicketErrorCode })
      }
      // ADR-284 D2: a blocked offer is not purchasable — belt-and-suspenders
      // against a stale client-side offer cache bypassing the detail-page 404.
      if (offer.blockedAt) {
        return res.status(404).json({ error: 'Offer not found', code: 'NOT_FOUND' as TicketErrorCode })
      }
      // ADR-415: remote offers have no seller rail with us — refuse early and explicitly.
      const remoteBlock = remoteOfferPurchaseBlock(offer)
      if (remoteBlock) return res.status(remoteBlock.status).json(remoteBlock.body)

      // ADR-277 D9.1/R6: non-sats foreign listings store priceSats=0 as a display sentinel —
      // proceeding here would create a "free" order. Refuse explicitly until ADR-176 lands a
      // settlement-time conversion policy (FU-277-G).
      if (offer.priceCurrency) {
        return res.status(400).json({
          error: `This listing is priced in ${offer.priceCurrency.toUpperCase()}, not sats, and is not yet purchasable on Colabonate.`,
          code: 'BAD_REQUEST' as TicketErrorCode,
        })
      }

      const allowedTiers: number[] = Array.isArray(offer.allowedVisibility)
        ? (offer.allowedVisibility as unknown[]).filter((v): v is number => typeof v === 'number')
        : [0]
      const requestedTier = typeof visibility === 'number' ? visibility : 0
      if (!allowedTiers.includes(requestedTier)) {
        return res.status(400).json({
          error: 'Visibility tier not allowed by this offer',
          code: 'BAD_REQUEST' as TicketErrorCode,
          allowedTiers,
          requestedTier,
        })
      }

      // ADR-397 D3: a bounty ticket charges the ACCEPTED application's agreed
      // price (verified server-side: this bounty, this offer, caller = poster),
      // one unit, and is linked to the bounty inside the create transaction.
      let bounty: { agentTaskId: string; unlinkTicketId: string | null; brief?: BountyBrief } | undefined
      let unitPriceSats = offer.priceSats
      if (agentTaskApplicationId !== undefined) {
        if (typeof agentTaskApplicationId !== 'string' || !agentTaskApplicationId) {
          return res.status(400).json({ error: 'agentTaskApplicationId must be a non-empty string', code: 'BAD_REQUEST' as TicketErrorCode })
        }
        const decision = await resolveBountyTicket(prisma, { applicationId: agentTaskApplicationId, offerId, buyerPubkey })
        if (!decision.ok) {
          return res.status(decision.status).json({
            error: decision.code,
            code: 'BAD_REQUEST' as TicketErrorCode,
            message: decision.message,
            ...(decision.ticketId ? { ticketId: decision.ticketId } : {}),
          })
        }
        bounty = { agentTaskId: decision.agentTaskId, unlinkTicketId: decision.unlinkTicketId, brief: decision.brief }
        if (decision.priceSats !== null) unitPriceSats = decision.priceSats
      }

      // ADR-394: validate the purchased unit count before any invoice exists.
      // The helper keeps the total (unitPrice × quantity) server-authoritative.
      // FU-842: shipping comes from the OFFER (never the request body) and is
      // part of the server-computed total — once per ticket, physical goods only.
      const shippingSats = resolveShippingSats(offer)
      const quantityResult = resolveTicketQuantity({
        rawQuantity: bounty ? 1 : rawQuantity,
        unitPriceSats,
        stock: offer.stock,
        shippingSats,
      })
      if (!quantityResult.ok) {
        if (quantityResult.reason === 'INVALID_QUANTITY') {
          return res.status(400).json({
            error: 'quantity must be a positive integer',
            code: 'BAD_REQUEST' as TicketErrorCode,
          })
        }
        return res.status(409).json({
          error: `Only ${quantityResult.availableStock} unit(s) of this offer are available`,
          code: 'INSUFFICIENT_STOCK' as TicketErrorCode,
          availableStock: quantityResult.availableStock,
          requestedQuantity: Number(rawQuantity),
        })
      }
      const quantity = quantityResult.quantity

      // Pre-flight wallet check (ADR-179 Fix A):
      // A Nostr-only user has no Wallet row → fail fast with WALLET_REQUIRED 400,
      // not as a swallowed 500 from the invoice-creation path.
      const buyer = await prisma.user.findUnique({
        where: { pubkey: buyerPubkey },
        select: {
          id: true,
          walletModeStrategy: true,
          wallets: { where: { isActive: true }, take: 1, select: { id: true } },
        },
      })
      // ADR-394 / ADR-381: use the EFFECTIVE strategy for this host, not the
      // raw stored value. On a Direct-Pay-only production host the effective
      // strategy is NONCUSTODIAL_ONLY for every user (getEffectiveStrategy),
      // while the DB column still carries the HYBRID default for anyone who
      // never opened Settings — reading it raw wrongly returned
      // WALLET_REQUIRED for buyers who need no platform Wallet row at all.
      const strategy = getEffectiveStrategy(
        buyer?.walletModeStrategy ?? 'HYBRID',
        isProductionDirectPayOnly(),
      )
      const hasCustodialPath = Boolean(buyer?.wallets[0]?.id)
      const isNonCustodialOnly = strategy === 'NONCUSTODIAL_ONLY'
      if (!hasCustodialPath && !isNonCustodialOnly) {
        return res.status(400).json({
          error: 'Wallet required',
          code: 'WALLET_REQUIRED' as TicketErrorCode,
          details:
            'Sign in with Lightning, or create a wallet in Settings → Wallet before placing orders.',
        })
      }

      const sellerPubkey = offer.creatorPubkey
      // ADR-394: server-authoritative total = unit price × quantity + shipping
      // (validated against `stock` by resolveTicketQuantity above; the stock
      // itself is reserved atomically together with the ticket row below).
      const amountSats = quantityResult.amountSats
      // Physical goods carry the offer's own delivery terms onto the ticket.
      const isShippable = offer.offerType === 'ITEM' || offer.offerType === 'PRODUCT'

      // ADR-372 D1/D3: hosted-canvas service fee. Only doop-hosted AGENT_SETUP
      // tickets carry a fee (doop-local + agentInCanvas stay free, D6). The fee
      // is a SEPARATE buyer→Colabonate payment — never a deduction from the
      // seller's Direct-Pay invoice (ADR-253). Computed + rate-resolved up
      // front so the launch-cap check and the platform-invoice resolution below
      // run before the seller invoice is issued (no half-paid state, D3/Q4).
      const offerCanvas = readCanvasConfig(offer.agentConfigMeta)
      const isHostedCanvasTicket = offer.offerType === 'AGENT_SETUP' && offerCanvas?.provider === 'doop-hosted'
      const hostedCanvasFeeBps = isHostedCanvasTicket ? resolveCanvasHostedFeeBps() : undefined
      const hostedCanvasFeeSats = isHostedCanvasTicket ? computeHostedCanvasFeeSats() : undefined
      const feeMemo = isHostedCanvasTicket
        ? `Colabonate hosted-canvas service fee — ${offer.title}`
        : ''

      // ADR-252 D2 / FU-655: launch-phase per-transaction cap, enforced before
      // any invoice/hold is created on any rail (escrow or direct-pay). ADR-372
      // D3: price + fee count as ONE transaction for the cap.
      if (rejectIfAboveLaunchCap(res, amountSats + (hostedCanvasFeeSats ?? 0))) return

      // ADR-372 D1/D7.1: resolve the platform fee invoice BEFORE the seller
      // invoice — a 503 (PLATFORM_LN_ADDRESS unset outside beta) must fail the
      // purchase before any seller-side invoice exists (open question 4). In
      // Beta the rail resolves DEMO (Beta-aware), so this never 503s there.
      let feeResolution: Awaited<ReturnType<typeof resolvePlatformInvoice>> | undefined
      if (isHostedCanvasTicket) {
        feeResolution = await resolvePlatformInvoice(hostedCanvasFeeSats!, feeMemo)
        if (!feeResolution.ok) {
          return res.status(503).json({
            error: 'PLATFORM_PAYMENT_NOT_CONFIGURED',
            code: 'BAD_REQUEST' as TicketErrorCode,
            message: 'The hosted-canvas fee cannot be collected right now — try again shortly.',
          })
        }
      }
      const feeRail = feeResolution?.ok ? feeResolution.rail : undefined
      const feeInvoice = feeResolution?.ok && feeResolution.rail === 'LN' ? feeResolution.invoice.bolt11 : undefined
      const feePaymentHash =
        feeResolution?.ok && feeResolution.rail === 'LN'
          ? feeResolution.invoice.paymentHash
          : isHostedCanvasTicket
            ? LNBitsProvider.generatePaymentHash() // DEMO: synthetic hash (no bolt11), mirrors ADR-255 D2
            : undefined

      // ADR-184: offers may opt into three-phase hold-invoice escrow.
      // ADR-394: re-gate at ticket creation — the offer-create/update gate
      // (escrow-gate.ts) can be bypassed by a stale/beta offer row, so never
      // trust `offer.useEscrow` alone to drive the custodial hold path on a
      // production host.
      const useEscrow = Boolean(offer.useEscrow) && isEscrowEnabled()
      let lightningInvoice: string | undefined
      let paymentHash: string | undefined
      let escrowStatus: string | undefined
      let escrowPhase1Hash: string | undefined
      let escrowPhase1Preimage: string | undefined
      let escrowPhase1Deadline: Date | null = null
      // ADR-253/FU-253-E: NONE (Direct-Pay) vs CUSTODIAL_LEGACY (the only
      // escrow mechanism actually wired today — the ICP canister, ADR-254,
      // has no app-side wiring yet).
      let escrowProvider: 'NONE' | 'CUSTODIAL_LEGACY' = 'NONE'
      let directPayRail: string | undefined
      let cashuMintUrl: string | undefined
      let cashuSellerPubkey: string | undefined
      let sellerInvoiceSource: string | undefined
      let sellerVerifyUrl: string | undefined

      if (useEscrow) {
        const phaseAmount = Math.round(amountSats * 0.25)
        const provider = offer.lightningSubWalletAdminKey && payments instanceof LNBitsProvider
          ? payments.createSubWalletProvider(offer.lightningSubWalletAdminKey)
          : payments
        const preimageHash = LNBitsProvider.generatePaymentHash()
        const holdInvoice = await provider.createHoldInvoice(
          phaseAmount,
          preimageHash,
          `Escrow Phase 1 (25%): ${offer.title}`,
        )
        escrowStatus = 'PHASE_1_PENDING'
        escrowProvider = 'CUSTODIAL_LEGACY'
        escrowPhase1Hash = holdInvoice.paymentHash
        escrowPhase1Preimage = preimageHash
        escrowPhase1Deadline = computeEscrowDeadline('PHASE_1_PENDING', offer.phase2WindowHours)
        lightningInvoice = holdInvoice.bolt11
        paymentHash = holdInvoice.paymentHash
        // ADR-241 D3: register so /api/beta/demo-pay and the invoice poll can
        // find this hash — hold invoices were previously invisible to both.
        // ADR-209: isHold=true routes the poll's confirmation to getHoldState.
        registerInvoice(paymentHash, lightningInvoice, phaseAmount, `Escrow Phase 1 (25%): ${offer.title}`, true)
      } else {
        // ADR-253 Stufe 1: non-escrow tickets pay the SELLER directly — via
        // their own Lightning address/NWC wallet, or (last resort) a Cashu
        // P2PK token the BUYER's own client has to mint/lock. The platform
        // never creates or holds an LN invoice here, so it is deliberately
        // NOT passed to registerInvoice() (that map exists only to let the
        // platform's own webhook/poll find platform-issued invoices; an LN
        // rail ticket is confirmed exclusively via the buyer's preimage, see
        // POST /:id/confirm-direct-payment below; a Cashu rail ticket has no
        // invoice/preimage at all — see PATCH /api/tickets/:id's guard).
        // ADR-255 D2: DEMO is the exception — its only confirmation path is
        // /api/beta/demo-pay itself, so it IS registered (with a synthetic
        // hash, no real invoice) purely so that route's idempotency check
        // has something to key off.
        const resolution = await resolveSellerInvoice(prisma, sellerPubkey, amountSats, `Order: ${offer.title}`)
        if (!resolution.ok) {
          return res.status(422).json({
            error: 'SELLER_PAYMENT_NOT_CONFIGURED',
            code: 'SELLER_PAYMENT_NOT_CONFIGURED' as TicketErrorCode,
            message: 'The seller has not configured a payment method yet.',
          })
        }
        if (resolution.rail === 'LN') {
          paymentHash = resolution.invoice.paymentHash
          lightningInvoice = resolution.invoice.bolt11
          directPayRail = 'LN'
          // ADR-399 D1: remember where the invoice was minted so the server
          // can detect settlement itself (services/directPaySettlement.ts).
          sellerInvoiceSource = resolution.invoice.source
          sellerVerifyUrl = resolution.invoice.verifyUrl
        } else if (resolution.rail === 'CASHU') {
          cashuSellerPubkey = resolution.cashu.pubkey
          cashuMintUrl = resolution.cashu.mintUrl
          directPayRail = 'CASHU'
        } else {
          paymentHash = LNBitsProvider.generatePaymentHash()
          directPayRail = 'DEMO'
          registerInvoice(paymentHash, '', amountSats, `Order: ${offer.title}`)
        }
      }

      // ADR-270 D6: Resolve frozen variantLabel for child offer if not explicitly provided
      const resolvedVariantLabel =
        variantLabel ||
        (offer.variantValues ? formatVariantLabel(offer.variantValues as Record<string, string>) : undefined)

      // ADR-308 D2 Stage 1 (Approval) / closes ADR-305 FU-401's ticket-lifecycle
      // gap: an AGENT_SETUP ticket is born ACCEPTED when its AgentProfile opted
      // out of human approval — every other offerType keeps the existing
      // always-PENDING behavior unchanged.
      // ADR-308 D2 Stage 2 (Quality Gate): snapshot AgentProfile.humanInLoop
      // onto the ticket at creation, same query as Stage 1's approval check.
      let initialStatus = 'PENDING'
      let qualityGateRequired = false
      if (offer.offerType === 'AGENT_SETUP' && offer.agentProfileId) {
        const agentProfile = await prisma.agentProfile.findUnique({
          where: { id: offer.agentProfileId },
          select: { requireHumanApproval: true, humanInLoop: true },
        })
        if (agentProfile && !agentProfile.requireHumanApproval) initialStatus = 'ACCEPTED'
        if (agentProfile?.humanInLoop) qualityGateRequired = true
      }

      // DB write — surface its message in the 500 (ADR-179 Fix A.3).
      // FU-841: the stock reservation (compare-and-swap decrement) and the
      // ticket row commit together — two buyers racing for the last unit can
      // never both get a ticket. A reservation is released by the stock tick
      // (services/ticketStock.ts) once the ticket is CANCELLED or its unpaid LN
      // invoice has expired. The seller invoice issued above is simply never
      // paid if the reservation loses the race.
      const ticket = await prisma.$transaction(async (tx) => {
        if (bounty) {
          // ADR-397 D4: lock the bounty row and re-check it is still ASSIGNED —
          // a concurrent revert of the selection makes this throw (409).
          const claimed = await tx.agentTask.updateMany({
            where: { id: bounty.agentTaskId, status: 'ASSIGNED' },
            data: { updatedAt: new Date() },
          })
          if (claimed.count === 0) throw new BountyTicketConflictError()
          if (bounty.unlinkTicketId) {
            await tx.ticket.updateMany({ where: { id: bounty.unlinkTicketId, status: 'CANCELLED' }, data: { agentTaskId: null } })
          }
        }
        const stockReserved = await reserveOfferStock(tx, offer.id, offer.stock, quantity)
        return tx.ticket.create({
          data: {
            // ADR-397 D6: the brief is frozen here — later bounty edits never
            // change what the agent was hired for.
            ...(bounty ? { agentTaskId: bounty.agentTaskId, bountyBrief: bounty.brief ? { ...bounty.brief } : undefined } : {}),
            stockReserved,
            checkoutId: checkoutId || undefined,
            offerId,
            buyerPubkey,
            sellerPubkey,
            status: initialStatus,
            amountSats,
            quantity,
            lightningInvoice,
            paymentHash,
            offerType: offer.offerType || 'PRODUCT',
            // ADR-312 D6: snapshot the offer's billing model onto the ticket at
            // creation — AGENT_SETUP only, defaults to ONE_TIME (the only fully
            // implemented mode) when the offer never set one.
            agentBillingModel: offer.offerType === 'AGENT_SETUP' ? (offer.agentBillingModel ?? 'ONE_TIME') : undefined,
            // ADR-396 D3 (FU-851): pin the booked agent config (still sealed to
            // the seller's key) + its hash; later offer edits only affect new bookings.
            ...(offer.offerType === 'AGENT_SETUP' && offer.agentConfigSealed
              ? { agentConfigSealedSnapshot: offer.agentConfigSealed, agentConfigHash: createHash('sha256').update(offer.agentConfigSealed).digest('hex') }
              : {}),
            qualityGateRequired,
            deliveryAddress: deliveryAddress || undefined,
            // FU-842: delivery terms are the offer's, not the client's copy.
            // deliveryCostSats records the shipping that IS part of amountSats.
            deliveryTimeDays: isShippable ? offer.deliveryTimeDays ?? undefined : undefined,
            deliveryCostSats: shippingSats || undefined,
            deliveryNotes: isShippable ? offer.deliveryNotes ?? undefined : undefined,
            visibility: offer.visibility,
            disputeMode: offer.disputeMode,
            escrowEnabled: useEscrow,
            escrowStatus: escrowStatus ?? 'NONE',
            escrowProvider,
            escrowPhase1Hash,
            escrowPhase1Preimage,
            escrowPhase1Deadline,
            directPayRail,
            cashuMintUrl,
            cashuSellerPubkey,
            sellerInvoiceSource,
            sellerVerifyUrl,
            variantLabel: resolvedVariantLabel || undefined,
            // ADR-370 D2 (Phase 1): snapshot the offer's canvas binding for all
            // providers (G3). Values are server-sanitized via readCanvasConfig.
            ...ticketCanvasSnapshotColumns(offer.offerType || 'PRODUCT', offer.agentConfigMeta),
            // ADR-372 D2: snapshot the hosted-canvas fee rate + computed fee onto
            // the ticket (doop-hosted AGENT_SETUP only) so later env/offer changes
            // never rewrite a running ticket (same discipline as ADR-312 D6).
            hostedCanvasFeeBps,
            hostedCanvasFeeSats,
            // ADR-372 D3: 1:1 fee-collection row (created only for doop-hosted
            // AGENT_SETUP). The buyer pays this separately to PLATFORM_LN_ADDRESS.
            ...(isHostedCanvasTicket
              ? {
                  platformFee: {
                    create: {
                      amountSats: hostedCanvasFeeSats!,
                      feeBps: hostedCanvasFeeBps!,
                      memo: feeMemo,
                      rail: feeRail!,
                      invoice: feeInvoice ?? null,
                      paymentHash: feePaymentHash ?? null,
                      // FU-838: where the reconcile tick looks up settlement.
                      issuer: feeResolution?.ok && feeResolution.rail === 'LN' ? feeResolution.source : null,
                      verifyUrl: feeResolution?.ok && feeResolution.rail === 'LN' ? feeResolution.invoice.verifyUrl ?? null : null,
                    },
                  },
                }
              : {}),
          },
          include: {
            offer: { select: { id: true, title: true, priceSats: true } },
            platformFee: true,
          },
        })
      })

      console.log(`[TicketCreate] Created ticket ${ticket.id} for offer ${offerId} (${amountSats} sats)`)

      // ADR-374: server-backed in-app notification for the seller (best-effort,
      // never fails the purchase).
      notifyTicketCreated(prisma, {
        ticketId: ticket.id,
        sellerPubkey,
        buyerPubkey,
        offerTitle: offer.title,
        detail: {
          offerType: ticket.offerType ?? offer.offerType ?? undefined,
          ticketType: offer.ticketType ?? undefined,
          amountSats: ticket.amountSats ?? undefined,
          escrowStatus: ticket.escrowStatus ?? undefined,
          createdAt: ticket.createdAt ? ticket.createdAt.toISOString() : undefined,
        },
      }).catch((err) => console.error('[notifications] ticket-created failed:', err instanceof Error ? err.message : err))

      let payloadCommitment: string | undefined
      if (requestedTier >= 1) {
        const commercialPayload: CommercialPayload = {
          offerId: offer.id,
          title: offer.title,
          priceSats: amountSats,
          ...(deliveryAddress && typeof deliveryAddress === 'string' ? { shippingAddress: deliveryAddress } : {}),
          ...(ticket.deliveryNotes ? { notes: ticket.deliveryNotes } : {}),
        }
        payloadCommitment = await computePayloadCommitment(commercialPayload)
      }

      const ticketEventInput = {
        id: ticket.id,
        offerId,
        buyerPubkey,
        sellerPubkey,
        status: ticket.status,
        offerType: ticket.offerType || undefined,
        ticketType: offer.ticketType || undefined,
        visibility: requestedTier as 0 | 1 | 2,
        payloadCommitment,
      }
      nostrService
        .publishTicketCreated(ticketEventInput)
        .catch(err => console.error('[Nostr] Failed to publish Kind 30407 (TicketCreated):', err))

      const nostrEventTemplate = {
        kind: NOSTR_KINDS.TICKET_CREATED_NEW,
        pubkey: buyerPubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: buildTicketCreatedTags(ticketEventInput),
        content: '',
      }

      return res.json({
        success: true,
        ticket,
        invoice: lightningInvoice,
        paymentHash,
        amountSats,
        nostrEventTemplate,
        // ADR-372 D1/D3: the separate fee invoice (doop-hosted AGENT_SETUP only)
        // so the buy funnel can render the second payment step without a refetch.
        feeRail: feeRail ?? null,
        feeInvoice: feeInvoice ?? null,
        feePaymentHash: feePaymentHash ?? null,
        feeSats: hostedCanvasFeeSats ?? null,
      })
    } catch (error: unknown) {
      // ADR-397 D4: the bounty was reverted or already ticketed concurrently.
      // A unique violation on agentTaskId is the same race lost at the index.
      const isBountyUniqueRace =
        (error as { code?: string } | null)?.code === 'P2002' &&
        JSON.stringify((error as { meta?: unknown }).meta ?? '').includes('agentTaskId')
      if (error instanceof BountyTicketConflictError || isBountyUniqueRace) {
        return res.status(409).json({
          error: 'BOUNTY_TICKET_CONFLICT',
          code: 'BAD_REQUEST' as TicketErrorCode,
          message: 'This bounty was changed or already ticketed by another request — reload and try again.',
        })
      }
      // FU-841: lost the race for the last unit(s) inside the reservation tx.
      if (error instanceof InsufficientStockError) {
        return res.status(409).json({
          error: `Only ${error.availableStock} unit(s) of this offer are available`,
          code: 'INSUFFICIENT_STOCK' as TicketErrorCode,
          availableStock: error.availableStock,
          requestedQuantity: error.requestedQuantity,
        })
      }
      const message = error instanceof Error ? error.message : String(error)
      // ADR-394 (hardens ADR-179): classify by evidence, not by the former
      // "anything that is not a Prisma error must be an upstream payment
      // error" catch-all — that mislabelled genuine server bugs as seller
      // outages. A Prisma failure is identified by its shape FIRST — its
      // message routinely names columns such as `paymentHash` or
      // `lightningInvoice`, which would otherwise match the upstream marker
      // below. Then a provider/rail failure carries a stable marker (or is a
      // Node network error); everything else is an honest UNKNOWN.
      if (isPrismaErrorLike(error)) {
        console.error('[TicketCreate] DB error:', error)
        return res.status(500).json({
          error: 'Database error',
          code: 'DB_ERROR' as TicketErrorCode,
          details: message,
        })
      }
      const errCode = (error as { code?: unknown } | null)?.code
      const upstreamLikely =
        /lnbits|lightspark|upstream|invoice|payment|seller wallet|nwc|alby|fetch failed/i.test(message) ||
        (typeof errCode === 'string' && /^E[A-Z]+$/.test(errCode))
      if (upstreamLikely) {
        console.error('[TicketCreate] upstream payment error:', error)
        // FU-26 (ADR-179): never echo the raw upstream body — it can contain
        // internal hosts, ports, or key material. The full error is logged
        // above; the client gets a sanitised human-readable summary.
        return res.status(502).json({
          error: 'Payment upstream error',
          code: 'PAYMENT_UPSTREAM_ERROR' as TicketErrorCode,
          details: sanitiseUpstreamError(message),
        })
      }
      console.error('[TicketCreate] unexpected error:', error)
      return res.status(500).json({
        error: 'Failed to create ticket',
        code: 'UNKNOWN' as TicketErrorCode,
        details: message,
      })
    }
  })

  // ADR-253 Stufe 1: direct-pay tickets are never confirmed by a platform
  // webhook or poll (the platform never held the invoice) — the buyer
  // reports the preimage they received from paying the seller's own
  // invoice, and this is the only proof of payment we can check. Reuses
  // confirmPaymentByHash() unmodified — the same state machine every other
  // confirmation path (webhook, poll, reconcile tick) already advances.
  router.post('/:id/confirm-direct-payment', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string
      const { preimage } = req.body as { preimage?: string }
      if (!preimage) {
        return res.status(400).json({ error: 'preimage is required', code: 'BAD_REQUEST' as TicketErrorCode })
      }

      const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
      if (!callerPubkey) {
        return res.status(401).json({ error: 'UNAUTHORIZED', code: 'BAD_REQUEST' as TicketErrorCode })
      }

      const ticket = await prisma.ticket.findUnique({ where: { id } })
      if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found', code: 'NOT_FOUND' as TicketErrorCode })
      }
      if (callerPubkey !== ticket.buyerPubkey) {
        return res.status(403).json({ error: 'Only the buyer may confirm this payment', code: 'FORBIDDEN' as TicketErrorCode })
      }
      if (ticket.escrowEnabled || !ticket.paymentHash || !['PENDING', 'ACCEPTED'].includes(ticket.status)) {
        return res.status(400).json({
          error: 'Ticket is not awaiting a direct-pay confirmation',
          code: 'BAD_REQUEST' as TicketErrorCode,
        })
      }

      if (!verifyPreimage(preimage, ticket.paymentHash)) {
        return res.status(400).json({ error: 'PREIMAGE_MISMATCH', code: 'BAD_REQUEST' as TicketErrorCode })
      }

      const updated = await confirmPaymentByHash(prisma, ticket.paymentHash, { preimage, nostrService })
      return res.json({ success: true, updated })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[TicketConfirmDirectPayment] error:', error)
      return res.status(500).json({ error: 'Failed to confirm payment', code: 'DB_ERROR' as TicketErrorCode, details: message })
    }
  })

  // ADR-399 D3: Cashu token delivery. The buyer's client locks a token to the
  // seller's Cashu key (P2PK, NUT-11) and hands it over here. The server can't
  // spend it, only store it for the seller, who redeems it into their own
  // wallet and then confirms PAID through the existing seller self-report
  // path. Set once (compare-and-swap), so a reload can never produce a second
  // payment record.
  router.post('/:id/cashu-token', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string
      const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
      if (!callerPubkey) {
        return res.status(401).json({ error: 'UNAUTHORIZED', code: 'BAD_REQUEST' as TicketErrorCode })
      }
      const { token } = req.body as { token?: unknown }
      if (typeof token !== 'string' || !/^cashu[AB][A-Za-z0-9_\-+/=]+$/.test(token) || token.length > CASHU_TOKEN_MAX_LENGTH) {
        return res.status(400).json({ error: 'A cashuA…/cashuB… token is required', code: 'BAD_REQUEST' as TicketErrorCode })
      }

      const ticket = await prisma.ticket.findUnique({ where: { id }, include: { offer: { select: { title: true } } } })
      if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found', code: 'NOT_FOUND' as TicketErrorCode })
      }
      if (callerPubkey !== ticket.buyerPubkey) {
        return res.status(403).json({ error: 'Only the buyer may deliver the Cashu payment', code: 'FORBIDDEN' as TicketErrorCode })
      }
      if (ticket.directPayRail !== 'CASHU' || !['PENDING', 'ACCEPTED'].includes(ticket.status)) {
        return res.status(400).json({ error: 'Ticket is not awaiting a Cashu payment', code: 'BAD_REQUEST' as TicketErrorCode })
      }

      const sentAt = new Date()
      const cas = await prisma.ticket.updateMany({
        where: { id, cashuTokenSentAt: null, status: { in: ['PENDING', 'ACCEPTED'] } },
        data: { cashuToken: token, cashuTokenSentAt: sentAt },
      })
      if (cas.count !== 1) {
        return res.status(409).json({
          error: 'CASHU_TOKEN_ALREADY_SENT',
          code: 'BAD_REQUEST' as TicketErrorCode,
          message: 'A Cashu payment was already delivered for this ticket.',
        })
      }

      createNotification(prisma, {
        ownerPubkey: ticket.sellerPubkey,
        type: 'ticket',
        title: 'Cashu payment received: redeem it',
        message: `${ticket.offer?.title ?? 'Your order'}: open the ticket and click "Redeem & confirm".`,
        relatedId: ticket.id,
        actionUrl: `/tickets/${ticket.id}`,
        meta: { role: 'seller', ticketId: ticket.id, amountSats: ticket.amountSats ?? undefined, buyerPubkey: ticket.buyerPubkey, sellerPubkey: ticket.sellerPubkey },
      }).catch((err) => console.error('[notifications] cashu-token failed:', err instanceof Error ? err.message : err))

      return res.json({ success: true, cashuTokenSentAt: sentAt.toISOString() })
    } catch (error: unknown) {
      console.error('[TicketCashuToken] error:', error instanceof Error ? error.message : error)
      return res.status(500).json({ error: 'Failed to store the Cashu payment', code: 'DB_ERROR' as TicketErrorCode })
    }
  })

  // ADR-372 D3.4/D7.2: hosted-canvas fee confirmation. The buyer pays the
  // SEPARATE Colabonate fee invoice and self-reports:
  //   - LN rail:   the preimage from paying the platform's own LUD-16 invoice
  //                (same self-verifying proof as confirm-direct-payment).
  //   - DEMO rail: beta-only simulated payment — no preimage; requires
  //                isBetaMode() (defense-in-depth) and debits the buyer's DEMO
  //                ledger by feeSats (consistent with the seller-leg debit so
  //                "demo balance ⇒ price + fee" stays honest).
  // When the fee confirms AND the seller leg is already confirmed, this route
  // flips the ticket PENDING|ACCEPTED → PAID and enqueues provisioning
  // (exactly-once — enqueueProvisioningOnPaid is idempotent). Otherwise the
  // ticket stays where it is until the seller leg confirms (two-confirm gate,
  // orchestrated with confirmPaymentByHash — see paymentConfirmation.ts D7.3).
  router.post('/:id/confirm-canvas-fee', async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string
      const callerPubkey = (req as Request & { authPubkey?: string }).authPubkey
      if (!callerPubkey) {
        return res.status(401).json({ error: 'UNAUTHORIZED', code: 'BAD_REQUEST' as TicketErrorCode })
      }

      const ticket = await prisma.ticket.findUnique({ where: { id }, include: { platformFee: true } })
      if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found', code: 'NOT_FOUND' as TicketErrorCode })
      }
      if (callerPubkey !== ticket.buyerPubkey) {
        return res.status(403).json({ error: 'Only the buyer may confirm the fee' })
      }
      const fee = ticket.platformFee
      if (!fee) {
        return res.status(400).json({ error: 'This ticket has no hosted-canvas fee', code: 'BAD_REQUEST' as TicketErrorCode })
      }

      // Idempotent: confirming an already-PAID fee is a no-op success.
      if (fee.status === 'PAID') {
        return res.json({ success: true, alreadyPaid: true, updated: [] })
      }

      if (fee.rail === 'LN') {
        const { preimage } = req.body as { preimage?: string }
        if (!preimage || !fee.paymentHash || !verifyPreimage(preimage, fee.paymentHash)) {
          return res.status(400).json({ error: 'PREIMAGE_MISMATCH', code: 'BAD_REQUEST' as TicketErrorCode })
        }
      } else if (fee.rail === 'DEMO') {
        // Defense in depth: resolvePlatformInvoice only issues DEMO in beta —
        // a DEMO fee row must never confirm outside beta (mirrors the
        // workspace-recharge DEMO_RAIL_DISABLED guard, ADR-351).
        if (!isBetaMode()) {
          return res.status(403).json({ error: 'DEMO_RAIL_DISABLED', message: 'demo rail is only available in beta mode' })
        }
        // The debit IS the simulated payment — fail before marking PAID so a
        // short demo balance never produces a paid-but-unfunded fee row.
        try {
          await debitDemoWallet(prisma, callerPubkey, fee.amountSats)
        } catch (err) {
          return res.status(402).json({
            error: 'DEMO_BALANCE_EXHAUSTED',
            code: 'BAD_REQUEST' as TicketErrorCode,
            message: err instanceof Error ? err.message : 'Demo balance exhausted',
          })
        }
      } else {
        return res.status(400).json({ error: 'Unknown fee rail', code: 'BAD_REQUEST' as TicketErrorCode })
      }

      // ADR-394 FU-838: shared CAS settlement (also used by the server-side
      // reconcile tick). Two-confirm gate (ADR-372 D7.3): the ticket flips to
      // PAID only once BOTH legs are done, evaluated from fresh rows, and the
      // PAID side-effects run exactly once even if the tick races this call.
      const updated = await settlePlatformFee(prisma, fee.id, nostrService)
      const paidFee = await prisma.ticketPlatformFee.findUnique({ where: { id: fee.id } })

      return res.json({ success: true, updated, fee: paidFee })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[TicketConfirmCanvasFee] error:', error)
      return res.status(500).json({ error: 'Failed to confirm fee', code: 'DB_ERROR' as TicketErrorCode, details: message })
    }
  })

  return router
}
