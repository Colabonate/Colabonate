import { Invoice } from '@getalby/lightning-tools'
import type { PrismaClient, TicketPlatformFee } from '@prisma/client'
import type { NostrRelayService } from './nostr-relay.js'
import { enqueueProvisioningOnPaid } from './canvas-provisioning.js'
import { syncAgentTaskFromTicketSafe } from './bounty-ticket.js'
import { NwcClient, isNwcRestrictedError } from './nwcClient.js'
import { verifyPreimage } from '../lib/preimage.js'

/**
 * ADR-394 FU-838: server-side settlement of the hosted-canvas platform-fee LN
 * leg (ADR-372). Before this, the fee was booked ONLY when the buyer's client
 * self-reported the preimage (`POST /api/tickets/:id/confirm-canvas-fee`); a
 * buyer who paid but never came back left the platform holding the sats while
 * the ticket stayed PENDING forever.
 *
 * Settlement sources, by how the fee invoice was issued:
 *   - NWC (production, ADR-387 D4): NIP-47 `lookup_invoice` against
 *     Colabonate's own hub via PLATFORM_NWC_URI — our own node, so a
 *     `settled` state is authoritative.
 *   - LNURL (PLATFORM_LN_ADDRESS fallback): the LUD-21 `verify` URL returned
 *     with the invoice, when the provider supports it. A third-party claim, so
 *     settlement also requires a preimage that hashes to the payment hash.
 *
 * Both the route and the tick go through `settlePlatformFee`, whose writes are
 * compare-and-swap — a buyer confirm racing the tick books the fee (and flips
 * the ticket) exactly once.
 */

type NostrLike = Pick<NostrRelayService, 'publishTicketStatus'>

/** Poll PENDING fee rows for at most this long after creation. */
const RECONCILE_WINDOW_MS = 48 * 60 * 60_000
const VERIFY_TIMEOUT_MS = 10_000

/**
 * Mark a fee PAID (CAS on PENDING) and, if the seller leg is already confirmed,
 * flip the ticket to PAID (CAS on PENDING|ACCEPTED) with the PAID side-effects.
 * Safe to call repeatedly — returns the transitions it actually performed.
 */
export async function settlePlatformFee(
  prisma: PrismaClient,
  feeId: string,
  nostrService?: NostrLike,
): Promise<string[]> {
  const updated: string[] = []
  const cas = await prisma.ticketPlatformFee.updateMany({
    where: { id: feeId, status: 'PENDING' },
    data: { status: 'PAID', confirmedAt: new Date() },
  })
  if (cas.count === 1) updated.push(`fee:${feeId}:PAID`)
  updated.push(...(await completeTicketIfBothLegsPaid(prisma, feeId, nostrService)))
  return updated
}

/**
 * ADR-372 D7.3 two-confirm gate, re-evaluated from FRESH rows: the ticket turns
 * PAID only once the fee is PAID and the seller leg is confirmed. Reading both
 * afresh (instead of trusting the caller's snapshot) is what lets the tick heal
 * the race where both legs confirmed concurrently and neither flipped the ticket.
 */
export async function completeTicketIfBothLegsPaid(
  prisma: PrismaClient,
  feeId: string,
  nostrService?: NostrLike,
): Promise<string[]> {
  const fee = await prisma.ticketPlatformFee.findUnique({ where: { id: feeId }, include: { ticket: true } })
  if (!fee || fee.status !== 'PAID' || !fee.sellerLegConfirmedAt) return []
  const ticket = fee.ticket
  const cas = await prisma.ticket.updateMany({
    where: { id: ticket.id, status: { in: ['PENDING', 'ACCEPTED'] } },
    data: { status: 'PAID' },
  })
  if (cas.count !== 1) return []

  // ADR-397 D4: a bounty ticket moves its bounty to IN_PROGRESS on PAID.
  if (ticket.agentTaskId) syncAgentTaskFromTicketSafe(prisma, ticket.id)
  enqueueProvisioningOnPaid(prisma, ticket.id).catch((err) =>
    console.error('[canvas-provision] enqueue on fee settlement failed:', err instanceof Error ? err.message : err),
  )
  if (ticket.cooperationId && nostrService) {
    nostrService.publishTicketStatus({
      id: ticket.id,
      cooperationId: ticket.cooperationId,
      status: 'PAID',
      buyerPubkey: ticket.buyerPubkey,
      sellerPubkey: ticket.sellerPubkey,
      paymentHash: fee.paymentHash ?? undefined,
      escrowStatus: undefined,
      visibility: ticket.visibility === 'PRIVATE' ? 1 : 0,
    }).catch(err => console.error('[Nostr] Failed to publish Kind 30408 (CoopTicket PAID):', err))
  }
  return [`ticket:${ticket.id}:PAID`]
}

export type FeeSettlementCheck = (fee: TicketPlatformFee) => Promise<boolean>

/**
 * Default settlement check. `nwc` is a lazily created client for
 * PLATFORM_NWC_URI shared across one tick (null when no hub is configured).
 */
export function makeFeeSettlementCheck(getNwc: () => NwcClient | null): FeeSettlementCheck {
  return async (fee) => {
    if (fee.rail !== 'LN' || !fee.paymentHash) return false

    if (fee.issuer === 'LNURL') {
      if (!fee.verifyUrl || !fee.invoice) return false
      const invoice = new Invoice({ pr: fee.invoice, verify: fee.verifyUrl })
      const settled = await withTimeout(invoice.verifyPayment(), VERIFY_TIMEOUT_MS)
      return Boolean(settled && invoice.preimage && verifyPreimage(invoice.preimage, fee.paymentHash))
    }

    // NWC-minted (or a pre-FU-838 row with no recorded issuer): ask our own hub.
    const nwc = getNwc()
    if (!nwc) return false
    try {
      const status = await nwc.lookupInvoice(fee.paymentHash)
      if (!status.paid) return false
      // Own node: `settled` is authoritative; a returned preimage must still match.
      return !status.preimage || verifyPreimage(status.preimage, fee.paymentHash)
    } catch (err) {
      if (isNwcRestrictedError(err)) {
        // Config defect, not a hub hiccup: the PLATFORM_NWC_URI connection is
        // missing the `lookup_invoice` scope (NIP-47 RESTRICTED), so paid fees
        // can never be auto-settled here. No retry heals this — say so loudly
        // (2026-09-30 Alby finding, fixed per ADR-387 D4 revised).
        console.error(
          '[PlatformFeeReconcile] PLATFORM_NWC_URI connection lacks the lookup_invoice scope (NIP-47 RESTRICTED):',
          err instanceof Error ? err.message : err,
          'Fix: Alby Hub → Connections → "Colabonate Platform (receive-only)" → Edit → enable lookup_invoice (keep pay_invoice off) — ADR-387 D4.',
        )
        return false
      }
      // Unknown hash on this hub (e.g. an LNURL-issued legacy row) or a hub
      // hiccup — not settled as far as we can prove; retry next tick.
      return false
    }
  }
}

export async function runPlatformFeeReconcileTick(
  prisma: PrismaClient,
  opts: { nostrService?: NostrLike; check?: FeeSettlementCheck; now?: Date } = {},
): Promise<string[]> {
  const now = opts.now ?? new Date()
  const updated: string[] = []

  // 1. Heal: fee PAID + seller leg confirmed, but the ticket never flipped.
  const stuck = await prisma.ticketPlatformFee.findMany({
    where: {
      status: 'PAID',
      sellerLegConfirmedAt: { not: null },
      ticket: { status: { in: ['PENDING', 'ACCEPTED'] } },
    },
    select: { id: true },
    take: 200,
  })
  for (const fee of stuck) {
    updated.push(...(await completeTicketIfBothLegsPaid(prisma, fee.id, opts.nostrService)))
  }

  // 2. Settle: PENDING LN fees the buyer may have paid without confirming.
  const pending = await prisma.ticketPlatformFee.findMany({
    where: {
      status: 'PENDING',
      rail: 'LN',
      paymentHash: { not: null },
      createdAt: { gte: new Date(now.getTime() - RECONCILE_WINDOW_MS) },
    },
    take: 200,
  })
  if (pending.length > 0) {
    let nwc: NwcClient | null | undefined
    const getNwc = () => {
      if (nwc === undefined) {
        const uri = process.env.PLATFORM_NWC_URI?.trim()
        nwc = uri ? new NwcClient(uri) : null
      }
      return nwc
    }
    const check = opts.check ?? makeFeeSettlementCheck(getNwc)
    try {
      for (const fee of pending) {
        let settled = false
        try {
          settled = await check(fee)
        } catch (err) {
          console.warn(`[PlatformFeeReconcile] check failed for fee ${fee.id}:`, err instanceof Error ? err.message : err)
        }
        if (settled) updated.push(...(await settlePlatformFee(prisma, fee.id, opts.nostrService)))
      }
    } finally {
      nwc?.close()
    }
  }

  if (updated.length > 0) console.log(`[PlatformFeeReconcile] ${updated.join(', ')}`)
  return updated
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`verify timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
