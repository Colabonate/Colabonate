import type { Prisma, PrismaClient } from '@prisma/client'

// Server-backed in-app notifications (ADR-374). Written at ticket / cooperation
// / dispute lifecycle events and read via /api/notifications + the MCP
// notification tools. The feed is authoritative for the events the server
// records (FU-695 wires the client drawer to it); per-recipient `detail` is
// merged into `meta` so the drawer's cards render (role / offerTitle / status
// chips / escrow) from server rows alone.

export type NotificationType = 'ticket' | 'cooperation' | 'dispute' | 'bounty' | 'ai'

/** JSON-safe extra fields merged into a notification's meta (drawer rendering). */
export type NotificationDetail = Record<string, unknown>

export interface CreateNotificationInput {
  ownerPubkey: string
  type: NotificationType
  title: string
  message?: string
  relatedId?: string
  actionUrl?: string
  meta?: Prisma.InputJsonValue
}

/** Mirrors the client-side TRANSITION_TITLE mapping in NotificationContext. */
export const TICKET_STATUS_TITLE: Record<string, string> = {
  ACCEPTED: 'Request accepted',
  PAID: 'Payment received',
  IN_PROGRESS: 'Work started',
  COMPLETED: 'Order completed',
  DISPUTED: 'Dispute opened',
  CANCELLED: 'Ticket cancelled',
}

export const COOPERATION_STATUS_TITLE: Record<string, string> = {
  ACCEPTED: 'Cooperation accepted',
  PAID: 'Escrow funded – work can begin',
  IN_PROGRESS: 'Cooperation in progress',
  COMPLETED: 'Cooperation completed',
  CANCELLED: 'Cooperation cancelled',
}

export async function createNotification(prisma: PrismaClient, input: CreateNotificationInput) {
  return prisma.notification.create({ data: input })
}

/**
 * Retention sweep — bounds feed growth. Deletes:
 *  - rows archived longer than `archivedRetentionDays` (default 30)
 *  - rows read longer than `readRetentionDays` (default 180)
 * Keeps unread rows regardless of age (they are actionable).
 */
export async function pruneNotifications(
  prisma: PrismaClient,
  opts: { archivedRetentionDays?: number; readRetentionDays?: number; now?: Date } = {},
): Promise<{ deleted: number }> {
  const now = opts.now ?? new Date()
  const archivedBefore = new Date(now.getTime() - (opts.archivedRetentionDays ?? 30) * 24 * 3600_000)
  const readBefore = new Date(now.getTime() - (opts.readRetentionDays ?? 180) * 24 * 3600_000)
  const result = await prisma.notification.deleteMany({
    where: {
      OR: [
        { archived: true, createdAt: { lt: archivedBefore } },
        { read: true, archived: false, createdAt: { lt: readBefore } },
      ],
    },
  })
  return { deleted: result.count }
}

// ── Bounties (ADR-397 D5, closes FU-427) ───────────────────────────────────

export type BountyEvent =
  | 'application_received' // → poster
  | 'awaiting_owner_approval' // auto-apply → agent owner
  | 'selected' // → winning agent owner
  | 'rejected' // → other applicants
  | 'no_longer_eligible' // bounty edited → affected applicants
  | 'cancelled' // → applicants with a live application
  | 'expired' // → poster + applicants with a live application

const BOUNTY_EVENT_TITLE: Record<BountyEvent, string> = {
  application_received: 'New application on your bounty',
  awaiting_owner_approval: 'Your agent auto-applied — confirm the application',
  selected: 'Your agent won the bounty',
  rejected: 'Another agent was selected',
  no_longer_eligible: 'Bounty changed — your application no longer matches',
  cancelled: 'Bounty cancelled',
  expired: 'Bounty expired',
}

/**
 * One notification per distinct recipient (duplicates and empty keys
 * dropped). Best-effort by contract: callers `.catch()` and never fail the
 * bounty action on a notification error.
 */
export async function notifyBounty(
  prisma: PrismaClient,
  args: {
    event: BountyEvent
    recipients: string[]
    taskId: string
    bountyTitle: string
    message?: string
    excludePubkey?: string
  },
): Promise<void> {
  const recipients = [...new Set(args.recipients.filter(pk => pk && pk !== args.excludePubkey))]
  if (recipients.length === 0) return
  await prisma.notification.createMany({
    data: recipients.map(ownerPubkey => ({
      ownerPubkey,
      type: 'bounty',
      title: BOUNTY_EVENT_TITLE[args.event],
      message: args.message ?? args.bountyTitle,
      relatedId: args.taskId,
      actionUrl: `/bounties/${args.taskId}`,
      meta: { event: args.event, bountyTitle: args.bountyTitle },
    })),
  })
}

/** Ticket created → notify the seller (the non-acting counterparty). */
export async function notifyTicketCreated(
  prisma: PrismaClient,
  args: {
    ticketId: string
    sellerPubkey: string
    buyerPubkey: string
    offerTitle?: string | null
    detail?: NotificationDetail
  },
): Promise<void> {
  if (!args.sellerPubkey || args.sellerPubkey === args.buyerPubkey) return
  await createNotification(prisma, {
    ownerPubkey: args.sellerPubkey,
    type: 'ticket',
    title: 'New ticket received',
    message: args.offerTitle ?? `Ticket #${args.ticketId.slice(0, 8)}`,
    relatedId: args.ticketId,
    actionUrl: `/tickets/${args.ticketId}`,
    meta: {
      statusTo: 'PENDING',
      role: 'seller',
      offerTitle: args.offerTitle ?? undefined,
      buyerPubkey: args.buyerPubkey,
      sellerPubkey: args.sellerPubkey,
      ...args.detail,
    },
  })
}

/**
 * ADR-396 D5 (FU-852): a booked agent's workspace is running but still needs
 * the seller's configuration (API key, model, tools) — injection happens in the
 * seller's browser because only they can unseal it. Without this the booking
 * silently waited until the seller happened to open the workspace.
 */
export async function notifyAgentConfigNeeded(
  prisma: PrismaClient,
  args: {
    workspaceId: string
    ticketId: string
    sellerPubkey: string
    buyerPubkey: string
    offerTitle?: string | null
  },
): Promise<void> {
  if (!args.sellerPubkey || args.sellerPubkey === args.buyerPubkey) return
  await createNotification(prisma, {
    ownerPubkey: args.sellerPubkey,
    type: 'ticket',
    title: 'Your agent was booked — inject its configuration',
    message: `${args.offerTitle ?? 'Your agent'}: open the workspace and click "Inject Config" so the agent can start.`,
    relatedId: args.ticketId,
    actionUrl: `/workspaces/${args.workspaceId}`,
    meta: { role: 'seller', offerTitle: args.offerTitle ?? undefined, workspaceId: args.workspaceId, buyerPubkey: args.buyerPubkey, sellerPubkey: args.sellerPubkey },
  })
}

/**
 * ADR-413 D4: the seller leg of a hosted-canvas purchase is confirmed, but the
 * platform fee (the second, buyer→Colabonate leg) is still open. The seller has
 * no other signal that the money arrived — the ticket stays PENDING, so the
 * seller would otherwise keep waiting on a ticket that is already paid for.
 * Fired exactly once per ticket (the caller CAS-guards the transition).
 */
export async function notifySellerLegConfirmed(
  prisma: PrismaClient,
  args: {
    ticketId: string
    sellerPubkey: string
    buyerPubkey: string
    offerTitle?: string | null
    feeSats?: number | null
  },
): Promise<void> {
  if (!args.sellerPubkey || args.sellerPubkey === args.buyerPubkey) return
  const fee = args.feeSats && args.feeSats > 0 ? ` (${args.feeSats} sats)` : ''
  await createNotification(prisma, {
    ownerPubkey: args.sellerPubkey,
    type: 'ticket',
    title: 'Payment received — the platform fee is still open',
    message: `${args.offerTitle ?? `Ticket #${args.ticketId.slice(0, 8)}`}: the buyer paid the price. The Colabonate service fee${fee} is still open, so the order starts once it is confirmed.`,
    relatedId: args.ticketId,
    actionUrl: `/tickets/${args.ticketId}`,
    meta: {
      role: 'seller',
      event: 'seller_leg_confirmed',
      offerTitle: args.offerTitle ?? undefined,
      buyerPubkey: args.buyerPubkey,
      sellerPubkey: args.sellerPubkey,
      feeSats: args.feeSats ?? undefined,
    },
  })
}

/** Ticket status change → notify the non-acting party (buyer/seller). */
export async function notifyTicketStatusChange(
  prisma: PrismaClient,
  args: {
    ticketId: string
    fromStatus: string
    toStatus: string
    buyerPubkey: string
    sellerPubkey: string
    actingPubkey: string
    offerTitle?: string | null
    detail?: NotificationDetail
  },
): Promise<void> {
  const owner = args.actingPubkey === args.buyerPubkey ? args.sellerPubkey : args.buyerPubkey
  if (!owner || owner === args.actingPubkey) return
  const role = owner === args.buyerPubkey ? 'buyer' : 'seller'
  await createNotification(prisma, {
    ownerPubkey: owner,
    type: 'ticket',
    title: TICKET_STATUS_TITLE[args.toStatus] ?? 'Status changed',
    message: args.offerTitle ?? `Ticket #${args.ticketId.slice(0, 8)}`,
    relatedId: args.ticketId,
    actionUrl: `/tickets/${args.ticketId}`,
    meta: {
      statusFrom: args.fromStatus,
      statusTo: args.toStatus,
      role,
      offerTitle: args.offerTitle ?? undefined,
      buyerPubkey: args.buyerPubkey,
      sellerPubkey: args.sellerPubkey,
      ...args.detail,
    },
  })
}

/** Cooperation status change → notify the non-acting party (initiator/partner). */
export async function notifyCooperationStatusChange(
  prisma: PrismaClient,
  args: {
    cooperationId: string
    fromStatus: string
    toStatus: string
    initiatorPubkey: string
    partnerPubkey: string | null
    actingPubkey: string
    title?: string | null
    detail?: NotificationDetail
  },
): Promise<void> {
  const owner = args.actingPubkey === args.initiatorPubkey ? args.partnerPubkey : args.initiatorPubkey
  if (!owner || owner === args.actingPubkey) return
  await createNotification(prisma, {
    ownerPubkey: owner,
    type: 'cooperation',
    title: COOPERATION_STATUS_TITLE[args.toStatus] ?? 'Cooperation updated',
    message: args.title ?? `Cooperation #${args.cooperationId.slice(0, 8)}`,
    relatedId: args.cooperationId,
    actionUrl: `/coop/${args.cooperationId}`,
    meta: {
      statusFrom: args.fromStatus,
      statusTo: args.toStatus,
      role: owner === args.initiatorPubkey ? 'initiator' : 'partner',
      cooperationId: args.cooperationId,
      ...args.detail,
    },
  })
}

/** Dispute opened → notify the non-opening party (buyer/seller). */
export async function notifyDisputeOpened(
  prisma: PrismaClient,
  args: {
    ticketId: string
    buyerPubkey: string
    sellerPubkey: string
    openedByPubkey: string
    offerTitle?: string | null
    detail?: NotificationDetail
  },
): Promise<void> {
  const owner = args.openedByPubkey === args.buyerPubkey ? args.sellerPubkey : args.buyerPubkey
  if (!owner || owner === args.openedByPubkey) return
  const role = owner === args.buyerPubkey ? 'buyer' : 'seller'
  await createNotification(prisma, {
    ownerPubkey: owner,
    type: 'dispute',
    title: 'Dispute opened',
    message: args.offerTitle ?? `Ticket #${args.ticketId.slice(0, 8)}`,
    relatedId: args.ticketId,
    actionUrl: `/tickets/${args.ticketId}`,
    meta: { role, ...args.detail },
  })
}

/** Verdict issued (public or private) → notify BOTH disputants with the outcome + reasoning. */
export async function notifyVerdictIssued(
  prisma: PrismaClient,
  args: {
    ticketId: string
    buyerPubkey: string
    sellerPubkey: string
    outcome: 'RELEASE' | 'CANCEL'
    offerTitle?: string | null
    reasoning?: string | null
  },
): Promise<void> {
  const title =
    args.outcome === 'RELEASE'
      ? 'Dispute resolved – payment released'
      : 'Dispute resolved – payment cancelled'
  const message = args.offerTitle ?? `Ticket #${args.ticketId.slice(0, 8)}`
  const rows = [
    { ownerPubkey: args.buyerPubkey, role: 'buyer' as const },
    { ownerPubkey: args.sellerPubkey, role: 'seller' as const },
  ]
  for (const row of rows) {
    if (args.buyerPubkey === args.sellerPubkey) break // self-trade guard
    await createNotification(prisma, {
      ownerPubkey: row.ownerPubkey,
      type: 'dispute',
      title,
      message,
      relatedId: args.ticketId,
      actionUrl: `/tickets/${args.ticketId}`,
      meta: { outcome: args.outcome, role: row.role, offerTitle: args.offerTitle ?? undefined, reasoning: args.reasoning ?? undefined },
    })
  }
}

/** Dispute escalated to the Council queue → notify BOTH disputants (cooling-off window ended). */
export async function notifyDisputeEscalated(
  prisma: PrismaClient,
  args: {
    ticketId: string
    buyerPubkey: string
    sellerPubkey: string
    offerTitle?: string | null
  },
): Promise<void> {
  const message = args.offerTitle ?? `Ticket #${args.ticketId.slice(0, 8)}`
  const rows = [
    { ownerPubkey: args.buyerPubkey, role: 'buyer' as const },
    { ownerPubkey: args.sellerPubkey, role: 'seller' as const },
  ]
  for (const row of rows) {
    if (args.buyerPubkey === args.sellerPubkey) break // self-trade guard
    await createNotification(prisma, {
      ownerPubkey: row.ownerPubkey,
      type: 'dispute',
      title: 'Dispute escalated to the Arbitration Council',
      message,
      relatedId: args.ticketId,
      actionUrl: `/tickets/${args.ticketId}`,
      meta: { role: row.role, offerTitle: args.offerTitle ?? undefined },
    })
  }
}

/** One party nominated a mutual arbiter → notify the OTHER party. */
export async function notifyArbiterNominated(
  prisma: PrismaClient,
  args: {
    ticketId: string
    buyerPubkey: string
    sellerPubkey: string
    nominatorPubkey: string
    arbiterPubkey: string
    offerTitle?: string | null
  },
): Promise<void> {
  const owner = args.nominatorPubkey === args.buyerPubkey ? args.sellerPubkey : args.buyerPubkey
  if (!owner || owner === args.nominatorPubkey) return
  const role = owner === args.buyerPubkey ? 'buyer' : 'seller'
  await createNotification(prisma, {
    ownerPubkey: owner,
    type: 'dispute',
    title: 'Arbiter nominated',
    message: `A mutual arbiter was nominated for ${args.offerTitle ?? `ticket #${args.ticketId.slice(0, 8)}`}`,
    relatedId: args.ticketId,
    actionUrl: `/tickets/${args.ticketId}`,
    meta: { arbiterPubkey: args.arbiterPubkey, role, offerTitle: args.offerTitle ?? undefined },
  })
}

/** Mutual arbiter accepted → notify BOTH disputants. */
export async function notifyArbiterAccepted(
  prisma: PrismaClient,
  args: {
    ticketId: string
    buyerPubkey: string
    sellerPubkey: string
    arbiterPubkey: string
    offerTitle?: string | null
  },
): Promise<void> {
  const message = `The mutual arbiter accepted the role on ${args.offerTitle ?? `ticket #${args.ticketId.slice(0, 8)}`}`
  const rows = [
    { ownerPubkey: args.buyerPubkey, role: 'buyer' as const },
    { ownerPubkey: args.sellerPubkey, role: 'seller' as const },
  ]
  for (const row of rows) {
    if (args.buyerPubkey === args.sellerPubkey) break
    await createNotification(prisma, {
      ownerPubkey: row.ownerPubkey,
      type: 'dispute',
      title: 'Arbiter accepted',
      message,
      relatedId: args.ticketId,
      actionUrl: `/tickets/${args.ticketId}`,
      meta: { arbiterPubkey: args.arbiterPubkey, role: row.role, offerTitle: args.offerTitle ?? undefined },
    })
  }
}
