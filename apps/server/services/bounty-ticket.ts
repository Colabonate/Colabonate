import type { PrismaClient } from '@prisma/client'

// ADR-397 D3/D4: the bounty ↔ ticket link.
//  - D3: a ticket created for a bounty charges the ACCEPTED application's
//    agreed price (proposedPriceSats), not the listing price.
//  - D4: the bounty status follows its linked ticket (PAID → IN_PROGRESS,
//    COMPLETED → COMPLETED), and the poster can revert a selection while no
//    live ticket exists.
// The decisions are pure functions (unit-tested); the DB wrappers below only
// load rows and apply compare-and-swap writes.

// Thrown inside a ticket-create or revert transaction when the bounty moved
// underneath the request (concurrent create/revert).
export class BountyTicketConflictError extends Error {}

export interface BountyTicketCheckInput {
  buyerPubkey: string
  offerId: string
  application: {
    offerId: string
    status: string
    proposedPriceSats: number | null
    task: {
      id: string
      creatorPubkey: string
      status: string
      ticket: { id: string; status: string } | null
    }
  } | null
}

export type BountyTicketDecision =
  | { ok: true; agentTaskId: string; priceSats: number | null; unlinkTicketId: string | null }
  | { ok: false; status: number; code: string; message: string; ticketId?: string }

export function evaluateBountyTicket(input: BountyTicketCheckInput): BountyTicketDecision {
  const app = input.application
  if (!app) return { ok: false, status: 404, code: 'BOUNTY_APPLICATION_NOT_FOUND', message: 'Bounty application not found' }
  if (app.task.creatorPubkey !== input.buyerPubkey) {
    return { ok: false, status: 403, code: 'BOUNTY_NOT_POSTER', message: 'Only the bounty poster can create its ticket' }
  }
  if (app.offerId !== input.offerId) {
    return { ok: false, status: 400, code: 'BOUNTY_OFFER_MISMATCH', message: 'offerId does not match the selected application' }
  }
  if (app.status !== 'ACCEPTED' || app.task.status !== 'ASSIGNED') {
    return { ok: false, status: 409, code: 'BOUNTY_NOT_ASSIGNED', message: 'This application is not the selected winner of an assigned bounty' }
  }
  const linked = app.task.ticket
  if (linked && linked.status !== 'CANCELLED') {
    return { ok: false, status: 409, code: 'BOUNTY_TICKET_EXISTS', message: 'A ticket for this bounty already exists', ticketId: linked.id }
  }
  return {
    ok: true,
    agentTaskId: app.task.id,
    priceSats: app.proposedPriceSats,
    unlinkTicketId: linked ? linked.id : null,
  }
}

// ADR-397 D6: what the agent was hired for, frozen onto the ticket.
export interface BountyBrief {
  bountyId: string
  title: string
  description: string
  acceptanceCriteria: string | null
  deadline: string | null
}

export async function resolveBountyTicket(
  prisma: PrismaClient,
  args: { applicationId: string; offerId: string; buyerPubkey: string },
): Promise<BountyTicketDecision & { brief?: BountyBrief }> {
  const application = await prisma.agentTaskApplication.findUnique({
    where: { id: args.applicationId },
    select: {
      offerId: true,
      status: true,
      proposedPriceSats: true,
      task: {
        select: {
          id: true, creatorPubkey: true, status: true, ticket: { select: { id: true, status: true } },
          title: true, description: true, acceptanceCriteria: true, deadline: true,
        },
      },
    },
  })
  const decision = evaluateBountyTicket({ buyerPubkey: args.buyerPubkey, offerId: args.offerId, application })
  if (!decision.ok || !application) return decision
  const t = application.task
  return {
    ...decision,
    brief: {
      bountyId: t.id,
      title: t.title,
      description: t.description,
      acceptanceCriteria: t.acceptanceCriteria,
      deadline: t.deadline ? t.deadline.toISOString() : null,
    },
  }
}

// Next bounty status for a linked ticket's status, or null when nothing moves.
// Monotonic: never moves a bounty backwards.
export function nextBountyStatus(taskStatus: string, ticketStatus: string): 'IN_PROGRESS' | 'COMPLETED' | null {
  if (ticketStatus === 'COMPLETED' && (taskStatus === 'ASSIGNED' || taskStatus === 'IN_PROGRESS')) return 'COMPLETED'
  if (taskStatus === 'ASSIGNED' && ['PAID', 'IN_PROGRESS', 'DISPUTED'].includes(ticketStatus)) return 'IN_PROGRESS'
  return null
}

// Idempotent; safe to call after any ticket status change. Returns the new
// bounty status when it moved.
export async function syncAgentTaskFromTicket(prisma: PrismaClient, ticketId: string): Promise<string | null> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { status: true, agentTaskId: true, agentTask: { select: { status: true } } },
  })
  if (!ticket?.agentTaskId || !ticket.agentTask) return null
  const next = nextBountyStatus(ticket.agentTask.status, ticket.status)
  if (!next) return null
  const cas = await prisma.agentTask.updateMany({
    where: { id: ticket.agentTaskId, status: ticket.agentTask.status },
    // D2-C: the first paid-ish transition (from ASSIGNED) stamps ticketPaidAt.
    data: { status: next, ...(ticket.agentTask.status === 'ASSIGNED' ? { ticketPaidAt: new Date() } : {}) },
  })
  return cas.count === 1 ? next : null
}

// Fire-and-forget wrapper for status-change sites: a bounty sync must never
// fail a payment confirmation or a ticket PATCH.
export function syncAgentTaskFromTicketSafe(prisma: PrismaClient, ticketId: string): void {
  syncAgentTaskFromTicket(prisma, ticketId).catch((err) =>
    console.error('[bounty-ticket] sync failed:', err instanceof Error ? err.message : err),
  )
}

// ── D2-B: payment-ready gate at publish ─────────────────────────────────────
// A bounty is a promise to pay an agent directly (no escrow on production), so
// publishing one requires a connected wallet that can actually pay a Lightning
// invoice from the app. Never a balance lock — the reward stays in the
// poster's own wallet until the ticket is paid.
export const PAYING_WALLET_PROVIDERS = ['NWC', 'ALBY_OAUTH', 'WEBLN', 'CASHU'] as const

export function isPayingWalletProvider(provider: string, betaMode: boolean): boolean {
  return (PAYING_WALLET_PROVIDERS as readonly string[]).includes(provider) || (betaMode && provider === 'DEMO')
}

export async function hasPayingWalletConnected(prisma: PrismaClient, pubkey: string, betaMode: boolean): Promise<boolean> {
  const wallets = await prisma.wallet.findMany({
    where: { user: { pubkey }, status: 'ACTIVE' },
    select: { provider: true },
  })
  return wallets.some(w => isPayingWalletProvider(w.provider, betaMode))
}

// ── D2-C: poster reliability signal ─────────────────────────────────────────
// Derived from the poster's own bounty tickets (no new money flow). A ticket
// counts once it is decided: paid (the bounty recorded ticketPaidAt) or
// cancelled unpaid. Open, still-unpaid tickets are not counted yet.
export interface PosterReliability {
  decided: number
  paid: number
  paidRate: number | null
  medianHoursToPay: number | null
}

export function computePosterReliability(
  rows: Array<{ ticketStatus: string; ticketCreatedAt: Date; ticketPaidAt: Date | null }>,
): PosterReliability {
  const paid = rows.filter(r => r.ticketPaidAt !== null)
  const cancelledUnpaid = rows.filter(r => r.ticketPaidAt === null && r.ticketStatus === 'CANCELLED')
  const decided = paid.length + cancelledUnpaid.length
  const hours = paid
    .map(r => Math.max(0, (r.ticketPaidAt!.getTime() - r.ticketCreatedAt.getTime()) / 3_600_000))
    .sort((a, b) => a - b)
  let median: number | null = null
  if (hours.length > 0) {
    const mid = Math.floor(hours.length / 2)
    median = hours.length % 2 === 1 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2
  }
  return {
    decided,
    paid: paid.length,
    paidRate: decided === 0 ? null : paid.length / decided,
    medianHoursToPay: median === null ? null : Math.round(median * 10) / 10,
  }
}

/** One query for all posters on a page (bounty list) — keyed by pubkey. */
export async function loadPosterReliability(prisma: PrismaClient, creatorPubkeys: string[]): Promise<Map<string, PosterReliability>> {
  const unique = [...new Set(creatorPubkeys)]
  const tasks = unique.length === 0 ? [] : await prisma.agentTask.findMany({
    where: { creatorPubkey: { in: unique }, ticket: { isNot: null } },
    select: { creatorPubkey: true, ticketPaidAt: true, ticket: { select: { status: true, createdAt: true } } },
  })
  const byPoster = new Map<string, PosterReliability>()
  for (const pk of unique) {
    byPoster.set(pk, computePosterReliability(tasks.filter(t => t.creatorPubkey === pk).map(t => ({
      ticketStatus: t.ticket!.status,
      ticketCreatedAt: t.ticket!.createdAt,
      ticketPaidAt: t.ticketPaidAt,
    }))))
  }
  return byPoster
}

// D4 recovery: the poster may revert a selection while no live ticket exists.
export function canRevertSelection(taskStatus: string, linkedTicketStatus: string | null): boolean {
  if (linkedTicketStatus === null) return taskStatus === 'ASSIGNED'
  return linkedTicketStatus === 'CANCELLED' && (taskStatus === 'ASSIGNED' || taskStatus === 'IN_PROGRESS')
}
