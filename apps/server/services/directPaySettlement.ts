import { Invoice } from '@getalby/lightning-tools'
import type { PrismaClient, Ticket } from '@prisma/client'
import type { NostrRelayService } from './nostr-relay.js'
import { confirmPaymentByHash } from './paymentConfirmation.js'
import { NwcClient } from './nwcClient.js'
import { createAlbyOauthProviderForUser } from './albyOauthProvider.js'
import { isNwcCoolingDown } from '../lib/nwc-cooldown.js'
import { decrypt } from '../lib/secretbox.js'
import { verifyPreimage } from '../lib/preimage.js'

/**
 * ADR-399 D2: server-side settlement of Direct-Pay LN tickets.
 *
 * Before this, a seller-issued invoice was confirmed ONLY by the buyer's
 * preimage (`POST /api/tickets/:id/confirm-direct-payment`). A buyer who paid
 * by scanning the QR with an external wallet stayed "awaiting payment" until
 * they found and pasted the preimage. The seller invoice is now checked at the
 * source that minted it (`Ticket.sellerInvoiceSource`, ADR-399 D1):
 *   - LNURL:      LUD-21 `verify` URL. A third-party claim, so it counts only
 *                 with a preimage that hashes to the payment hash.
 *   - NWC:        NIP-47 `lookup_invoice` on the seller's own wallet.
 *   - ALBY_OAUTH: the seller's own Alby account (`GET /invoices/:hash`).
 * A settled result goes through `confirmPaymentByHash`, the same state machine
 * a buyer preimage drives (two-leg fee gate, stock, bounty side effects).
 */

type NostrLike = Pick<NostrRelayService, 'publishTicketStatus'>

export type DirectPayTicket = Pick<
  Ticket,
  | 'id'
  | 'status'
  | 'escrowEnabled'
  | 'directPayRail'
  | 'paymentHash'
  | 'lightningInvoice'
  | 'sellerPubkey'
  | 'sellerInvoiceSource'
  | 'sellerVerifyUrl'
>

export interface DirectPaySettlement {
  settled: boolean
  preimage?: string
}

export type DirectPaySettlementCheck = (ticket: DirectPayTicket) => Promise<DirectPaySettlement>

/** Poll unpaid Direct-Pay tickets for at most this long after creation. */
const RECONCILE_WINDOW_MS = 48 * 60 * 60_000
const CHECK_TIMEOUT_MS = 10_000
/** Minimum gap between two on-demand checks of the same ticket. */
const ON_DEMAND_THROTTLE_MS = 10_000

const NOT_SETTLED: DirectPaySettlement = { settled: false }

export function isDirectPaySettlementCandidate(ticket: DirectPayTicket): boolean {
  return (
    !ticket.escrowEnabled &&
    ticket.directPayRail === 'LN' &&
    Boolean(ticket.paymentHash) &&
    Boolean(ticket.sellerInvoiceSource) &&
    (ticket.status === 'PENDING' || ticket.status === 'ACCEPTED')
  )
}

export function makeDirectPaySettlementCheck(prisma: PrismaClient): DirectPaySettlementCheck {
  return async (ticket) => {
    const paymentHash = ticket.paymentHash
    if (!paymentHash) return NOT_SETTLED

    if (ticket.sellerInvoiceSource === 'LNURL') {
      if (!ticket.sellerVerifyUrl || !ticket.lightningInvoice) return NOT_SETTLED
      const invoice = new Invoice({ pr: ticket.lightningInvoice, verify: ticket.sellerVerifyUrl })
      const settled = await withTimeout(invoice.verifyPayment(), CHECK_TIMEOUT_MS)
      const preimage = invoice.preimage ?? undefined
      if (!settled || !preimage || !verifyPreimage(preimage, paymentHash)) return NOT_SETTLED
      return { settled: true, preimage }
    }

    if (ticket.sellerInvoiceSource === 'NWC') {
      if (isNwcCoolingDown(ticket.sellerPubkey)) return NOT_SETTLED
      const wallet = await prisma.wallet.findFirst({
        where: { user: { pubkey: ticket.sellerPubkey }, provider: 'NWC', nwcConnectionUriEnc: { not: null } },
        select: { nwcConnectionUriEnc: true },
      })
      if (!wallet?.nwcConnectionUriEnc) return NOT_SETTLED
      // Same trust boundary as resolveViaNwc(): the server-held key decrypts the
      // seller's own connection, used in memory for one lookup, never returned.
      const client = new NwcClient(decrypt(wallet.nwcConnectionUriEnc))
      try {
        const status = await client.lookupInvoice(paymentHash)
        if (!status.paid) return NOT_SETTLED
        if (status.preimage && !verifyPreimage(status.preimage, paymentHash)) return NOT_SETTLED
        return { settled: true, ...(status.preimage ? { preimage: status.preimage } : {}) }
      } finally {
        client.close()
      }
    }

    if (ticket.sellerInvoiceSource === 'ALBY_OAUTH') {
      const seller = await prisma.user.findUnique({ where: { pubkey: ticket.sellerPubkey }, select: { id: true } })
      if (!seller) return NOT_SETTLED
      const provider = await createAlbyOauthProviderForUser(prisma, seller.id)
      const status = await withTimeout(provider.getPaymentStatus(paymentHash), CHECK_TIMEOUT_MS)
      return status.status === 'SUCCESS' ? { settled: true } : NOT_SETTLED
    }

    return NOT_SETTLED
  }
}

/** Check one ticket at its source and confirm it when settled. */
export async function settleDirectPayTicket(
  prisma: PrismaClient,
  ticket: DirectPayTicket,
  opts: { check?: DirectPaySettlementCheck; nostrService?: NostrLike } = {},
): Promise<string[]> {
  if (!isDirectPaySettlementCandidate(ticket)) return []
  const check = opts.check ?? makeDirectPaySettlementCheck(prisma)
  let result: DirectPaySettlement = NOT_SETTLED
  try {
    result = await check(ticket)
  } catch (err) {
    console.warn(`[DirectPaySettlement] check failed for ticket ${ticket.id}:`, err instanceof Error ? err.message : err)
  }
  if (!result.settled) return []
  return confirmPaymentByHash(prisma, ticket.paymentHash!, {
    preimage: result.preimage ?? null,
    nostrService: opts.nostrService,
  })
}

const lastOnDemandCheck = new Map<string, number>()

/**
 * On-demand check for `GET /api/tickets/:id/payment-status`. Throttled per
 * ticket so a client polling every few seconds does not hammer the seller's
 * wallet or LNURL provider.
 */
export async function checkDirectPayTicketNow(
  prisma: PrismaClient,
  ticket: DirectPayTicket,
  opts: { check?: DirectPaySettlementCheck; nostrService?: NostrLike; now?: number } = {},
): Promise<string[]> {
  if (!isDirectPaySettlementCandidate(ticket)) return []
  const now = opts.now ?? Date.now()
  const last = lastOnDemandCheck.get(ticket.id)
  if (last !== undefined && now - last < ON_DEMAND_THROTTLE_MS) return []
  lastOnDemandCheck.set(ticket.id, now)
  if (lastOnDemandCheck.size > 5_000) {
    for (const [id, at] of lastOnDemandCheck) if (now - at > ON_DEMAND_THROTTLE_MS) lastOnDemandCheck.delete(id)
  }
  return settleDirectPayTicket(prisma, ticket, opts)
}

export async function runDirectPayReconcileTick(
  prisma: PrismaClient,
  opts: { check?: DirectPaySettlementCheck; nostrService?: NostrLike; now?: Date } = {},
): Promise<string[]> {
  const now = opts.now ?? new Date()
  const pending = await prisma.ticket.findMany({
    where: {
      escrowEnabled: false,
      directPayRail: 'LN',
      status: { in: ['PENDING', 'ACCEPTED'] },
      paymentHash: { not: null },
      sellerInvoiceSource: { not: null },
      createdAt: { gte: new Date(now.getTime() - RECONCILE_WINDOW_MS) },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  const check = opts.check ?? makeDirectPaySettlementCheck(prisma)
  const updated: string[] = []
  for (const ticket of pending) {
    updated.push(...(await settleDirectPayTicket(prisma, ticket, { check, nostrService: opts.nostrService })))
  }
  if (updated.length > 0) console.log(`[DirectPayReconcile] ${updated.join(', ')}`)
  return updated
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`settlement check timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
