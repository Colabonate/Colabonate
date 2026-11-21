/**
 * ADR-156 — GDPR Art. 17 (Right to Erasure) account-deletion service.
 *
 * Two architectural reconciliations vs. the ADR pseudocode (documented in
 * ADR-156 status→implemented and memory/project_private_trade_mode_via_nip17.md):
 *
 *  1. CLIENT-SIDE NIP-09 SIGNING. The server NEVER holds the user privkey
 *     (ADR-141 — NIP-07 mandatory). collectEventIdsForUser() gathers the
 *     Nostr event ids the user authored; the client signs + publishes the
 *     Kind 5 via NIP-07 (apps/colabonate-app/src/lib/nip09.ts) BEFORE calling
 *     delete-account, and passes {kind5EventId, relayResponses} in so the
 *     audit log is written atomically with the cascade. The ADR's
 *     publishDeletionRequest(userPrivkeyHex) sketch is therefore implemented
 *     client-side, not here.
 *
 *  2. TWO-PARTY ANONYMIZATION (not hard-delete). Per ADR-156 §"Gegenseitige
 *     Daten" the counterparty's view MUST survive — "nur die eigene Sicht
 *     wird gelöscht (nicht die der Gegenseite)". The pseudocode's deleteMany
 *     on tickets/coops contradicts that (it would also destroy the other
 *     party's record → a NEW GDPR problem for B). Resolution:
 *       - FK-anchored two-party entities (Ticket.buyerPubkey/sellerPubkey,
 *         Offer.creatorPubkey [offers may have counterparty tickets]) are
 *         reassigned to a sentinel tombstone User.
 *       - Non-FK two-party strings (Cooperation.initiator/partner,
 *         Review.revieweePubkey, PrivateArbiter.arbiterPubkey) are reassigned
 *         to the sentinel string.
 *       - Only truly-own entities with no counterparty dependence (Reviews the
 *         user WROTE, DmMessages the user OWNED, Wallet, Company, ColPoints,
 *         Sessions) are hard-deleted.
 */

import { createHash } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'

/**
 * Tombstone pubkey (64 zero hex). NOT a valid secp256k1 point, but we never
 * verify it cryptographically — it is a pure FK/display target meaning
 * "this counterparty deleted their account". Real queries filter by real
 * pubkeys, so sentinel rows never surface in normal views.
 */
export const SENTINEL_PUBKEY = '0'.repeat(64)

/**
 * Escrow states where money is NO LONGER LOCKED — deletion is safe.
 * Anything else means a hold invoice is open and deletion would lose funds.
 */
export const TERMINAL_ESCROW_STATUSES = [
  'NONE',
  'RELEASED',
  'CANCELLED',
  'REFUNDED',
  'RELEASED_FULL',
] as const

/**
 * Dispute states where the conflict is fully closed — deletion is safe.
 * RESOLVED_PENDING / APPEALED still have an active council process.
 */
export const TERMINAL_DISPUTE_STATUSES = ['RESOLVED', 'WITHDRAWN'] as const

/** SHA-256(pubkey) — the anonymized form stored in the audit log. */
export function hashPubkey(pubkey: string): string {
  return createHash('sha256').update(pubkey, 'utf8').digest('hex')
}

export interface DeletionBlockers {
  activeEscrows: number
  openDisputes: number
}

export interface DeletionPreCheck {
  pubkey: string
  canDelete: boolean
  blockers: DeletionBlockers
  /** Nostr event ids the user authored (client signs + publishes the Kind 5). */
  eventIds: string[]
  /** Coarse preview of what would be anonymized / deleted. */
  summary: Record<string, number>
}

export interface DeletionCounts {
  ticketsAnonymized: number
  offersAnonymized: number
  cooperationsAnonymized: number
  reviewsRevieweeAnonymized: number
  arbitersAnonymized: number
  reviewsDeleted: number
  dmMessagesDeleted: number
  companiesDeleted: number
  walletsDeleted: number
  newsletterRowsDeleted: number
}

export interface DeletionResult {
  deletionId: string
  pubkeyHash: string
  eventIds: string[]
  counts: DeletionCounts
  nip09: { kind5EventId: string | null; relaysOk: number }
}

export class DeletionBlockedError extends Error {
  constructor(public blockers: DeletionBlockers) {
    super(
      `Account deletion blocked: ${blockers.activeEscrows} active escrow(s), ` +
        `${blockers.openDisputes} open dispute(s). Resolve before deletion.`,
    )
    this.name = 'DeletionBlockedError'
  }
}

/**
 * Nostr event ids this user authored, across all signed entity kinds.
 * The client turns these into a single Kind 5 deletion request.
 * (Kind 1059 gift wraps are NOT collectable here — their author is a random
 * one-time key, so NIP-09 cannot delete them. Their content becomes
 * permanently unreadable once the user discards the login key.)
 */
export async function collectEventIdsForUser(
  prisma: PrismaClient,
  pubkey: string,
): Promise<string[]> {
  const [offers, tickets, reviews, coops] = await Promise.all([
    prisma.offer.findMany({
      where: { creatorPubkey: pubkey },
      select: { nostrEventId: true },
    }),
    prisma.ticket.findMany({
      where: { OR: [{ buyerPubkey: pubkey }, { sellerPubkey: pubkey }] },
      select: { nostrEventId: true },
    }),
    prisma.review.findMany({
      where: { reviewerPubkey: pubkey },
      select: { nostrEventId: true },
    }),
    prisma.cooperation.findMany({
      where: { OR: [{ initiatorPubkey: pubkey }, { partnerPubkey: pubkey }] },
      select: { nostrProposalId: true, nostrAcceptId: true },
    }),
  ])

  const ids = new Set<string>()
  for (const o of offers) if (o.nostrEventId) ids.add(o.nostrEventId)
  for (const t of tickets) if (t.nostrEventId) ids.add(t.nostrEventId)
  for (const r of reviews) if (r.nostrEventId) ids.add(r.nostrEventId)
  for (const c of coops) {
    if (c.nostrProposalId) ids.add(c.nostrProposalId)
    if (c.nostrAcceptId) ids.add(c.nostrAcceptId)
  }
  return [...ids]
}

/**
 * Pre-deletion check: blockers (active escrows / open disputes) + the event
 * ids to NIP-09-delete + a coarse preview of affected entities.
 */
export async function preCheckDeletion(
  prisma: PrismaClient,
  pubkey: string,
): Promise<DeletionPreCheck> {
  const [
    activeEscrows,
    openDisputes,
    eventIds,
    offers,
    tickets,
    reviews,
    coops,
    dms,
    companies,
    wallets,
  ] = await Promise.all([
    prisma.ticket.count({
      where: {
        OR: [{ buyerPubkey: pubkey }, { sellerPubkey: pubkey }],
        escrowStatus: { notIn: [...TERMINAL_ESCROW_STATUSES] },
      },
    }),
    prisma.dispute.count({
      where: {
        status: { notIn: [...TERMINAL_DISPUTE_STATUSES] },
        ticket: { OR: [{ buyerPubkey: pubkey }, { sellerPubkey: pubkey }] },
      },
    }),
    collectEventIdsForUser(prisma, pubkey),
    prisma.offer.count({ where: { creatorPubkey: pubkey } }),
    prisma.ticket.count({
      where: { OR: [{ buyerPubkey: pubkey }, { sellerPubkey: pubkey }] },
    }),
    prisma.review.count({
      where: { OR: [{ reviewerPubkey: pubkey }, { revieweePubkey: pubkey }] },
    }),
    prisma.cooperation.count({
      where: { OR: [{ initiatorPubkey: pubkey }, { partnerPubkey: pubkey }] },
    }),
    prisma.dmMessage.count({ where: { ownerPubkey: pubkey } }),
    prisma.company.count({ where: { ownerPubkey: pubkey } }),
    prisma.wallet.count({ where: { user: { pubkey } } }),
  ])

  const blockers: DeletionBlockers = { activeEscrows, openDisputes }
  return {
    pubkey,
    canDelete: activeEscrows === 0 && openDisputes === 0,
    blockers,
    eventIds,
    summary: {
      offers,
      tickets,
      reviews,
      cooperations: coops,
      dmMessages: dms,
      companies,
      wallets,
      nostrEvents: eventIds.length,
    },
  }
}

export interface DeleteUserAccountOptions {
  trigger?: 'USER' | 'ADMIN'
  adminPubkey?: string
  /** Best-effort NIP-09 results from the client (Kind 5 signed client-side). */
  nip09?: { kind5EventId?: string | null; relayResponses?: Record<string, { success: boolean; error?: string }> }
}

/**
 * Performs the GDPR Art. 17 account deletion.
 *
 * Order matters for FK integrity:
 *   1. anonymize two-party (reassign to sentinel) — preserves counterparty view
 *   2. hard-delete own-only entities (reviews written, owned DMs, wallet, company)
 *   3. hard-delete the User (ColPointsEvent + Session cascade via onDelete)
 *
 * The audit log is written AFTER the transaction commits, storing only the
 * SHA-256 hash of the pubkey (not re-identifiable).
 */
export async function deleteUserAccount(
  prisma: PrismaClient,
  pubkey: string,
  opts: DeleteUserAccountOptions = {},
): Promise<DeletionResult> {
  const trigger = opts.trigger ?? 'USER'

  // 1. Re-run pre-check (race safety against a blocker appearing between
  //    pre-check and delete).
  const pre = await preCheckDeletion(prisma, pubkey)
  if (!pre.canDelete) {
    throw new DeletionBlockedError(pre.blockers)
  }
  const eventIds = pre.eventIds

  // 2. Transaction: anonymize two-party, hard-delete own-only, delete user.
  const counts = await prisma.$transaction(async (tx) => {
    // Ensure tombstone User exists (FK target for anonymized rows).
    await tx.user.upsert({
      where: { pubkey: SENTINEL_PUBKEY },
      update: {},
      create: { pubkey: SENTINEL_PUBKEY },
    })

    // ── Two-party anonymization (preserve counterparty view) ──────────────
    const ticketsBuyer = await tx.ticket.updateMany({
      where: { buyerPubkey: pubkey },
      data: { buyerPubkey: SENTINEL_PUBKEY },
    })
    const ticketsSeller = await tx.ticket.updateMany({
      where: { sellerPubkey: pubkey },
      data: { sellerPubkey: SENTINEL_PUBKEY },
    })
    // Offers are anonymized (not deleted): a completed ticket may still
    // reference the offer (Ticket.offerId is non-nullable), and that ticket
    // belongs to the counterparty. ARCHIVED keeps them out of the active
    // marketplace browse.
    // FU-159-A: collect the ids first — updateMany bypasses the per-offer
    // writeWithOutbox path, so without explicit outbox events the Meilisearch
    // docs would keep their stale status=ACTIVE and the titles would stay
    // visible in /api/search/suggest (serves Meili hits without rehydration)
    // — a GDPR-relevant leak for a deleting user.
    const anonymizedOfferIds = (await tx.offer.findMany({
      where: { creatorPubkey: pubkey },
      select: { id: true },
    })).map(o => o.id)
    const offersAnon = await tx.offer.updateMany({
      where: { creatorPubkey: pubkey },
      // F-D6-01: null images + description to remove PII residue (product
      // photos may contain personal data). The offer row itself is kept as
      // a tombstone (status=ARCHIVED, creator=SENTINEL) for counterparty
      // order history, but its media content is purged.
      data: { creatorPubkey: SENTINEL_PUBKEY, status: 'ARCHIVED', images: Prisma.DbNull },
    })
    const coopsInit = await tx.cooperation.updateMany({
      where: { initiatorPubkey: pubkey },
      data: { initiatorPubkey: SENTINEL_PUBKEY },
    })
    const coopsPartner = await tx.cooperation.updateMany({
      where: { partnerPubkey: pubkey },
      data: { partnerPubkey: SENTINEL_PUBKEY },
    })
    // Reviews ABOUT the user (reviewee) are the reviewer's speech — anonymize
    // the reviewee so the review survives but is "about a deleted user".
    const reviewsReviewee = await tx.review.updateMany({
      where: { revieweePubkey: pubkey },
      data: { revieweePubkey: SENTINEL_PUBKEY },
    })
    const arbiterAnon = await tx.privateArbiter.updateMany({
      where: { arbiterPubkey: pubkey },
      data: { arbiterPubkey: SENTINEL_PUBKEY },
    })

    // ── Own-only hard deletes ─────────────────────────────────────────────
    // Reviews the user WROTE are their own speech — hard delete.
    const reviewsReviewer = await tx.review.deleteMany({
      where: { reviewerPubkey: pubkey },
    })
    // DmMessages the user OWNED (their inbox) — hard delete.
    const dms = await tx.dmMessage.deleteMany({ where: { ownerPubkey: pubkey } })

    // Company: hard-delete. Null nullable Offer.companyId references first;
    // delete CompanyReview rows about this company; Product/Catalog cascade
    // via schema onDelete: Cascade.
    const userCompanies = await tx.company.findMany({
      where: { ownerPubkey: pubkey },
      select: { id: true },
    })
    // FU-159-A: offers detached from the deleted companies change their
    // search doc too (companyName/companyLogoUrl → null) — collect for reindex.
    const companyOfferIds = userCompanies.length > 0
      ? (await tx.offer.findMany({
          where: { companyId: { in: userCompanies.map(c => c.id) } },
          select: { id: true },
        })).map(o => o.id)
      : []
    for (const c of userCompanies) {
      await tx.offer.updateMany({ where: { companyId: c.id }, data: { companyId: null } })
      await tx.companyReview.deleteMany({ where: { companyId: c.id } })
    }
    const companiesDeleted =
      userCompanies.length > 0
        ? (await tx.company.deleteMany({ where: { ownerPubkey: pubkey } })).count
        : 0

    // FU-159-A: re-sync every offer touched above with Meilisearch. 'upsert'
    // (not 'delete') mirrors the normal lifecycle (PATCH → ARCHIVED also
    // upserts): the worker refetches the row, the doc becomes ARCHIVED, and
    // /api/search + /api/search/suggest filter it out.
    const reindexOfferIds = [...new Set([...anonymizedOfferIds, ...companyOfferIds])]
    for (const aggregateId of reindexOfferIds) {
      await tx.outboxEvent.create({
        data: { aggregate: 'offer', aggregateId, eventType: 'upsert', payload: { reindex: 'account-deletion' } },
      })
    }

    // Wallet: hard-delete (user's own). Filter via the user relation.
    const wallets = await tx.wallet.deleteMany({ where: { user: { pubkey } } })

    // ADR-402 D15.4: newsletter rows go with the account — matched by the
    // bound pubkey and by the account email. Erasure wins over suppression:
    // the address leaves User too, so nothing can re-add it.
    const deletedUser = await tx.user.findUnique({ where: { pubkey }, select: { email: true } })
    const accountEmail = deletedUser?.email?.trim().toLowerCase()
    const newsletterRows = await tx.newsletterSubscriber.deleteMany({
      where: { OR: [{ pubkey }, ...(accountEmail ? [{ email: accountEmail }] : [])] },
    })

    // User: hard-delete (ColPointsEvent + Session cascade via onDelete: Cascade).
    const users = await tx.user.deleteMany({ where: { pubkey } })
    if (users.count === 0) {
      throw new Error(
        `deleteUserAccount: user ${pubkey} not found (already deleted?)`,
      )
    }

    const result: DeletionCounts = {
      ticketsAnonymized: ticketsBuyer.count + ticketsSeller.count,
      offersAnonymized: offersAnon.count,
      cooperationsAnonymized: coopsInit.count + coopsPartner.count,
      reviewsRevieweeAnonymized: reviewsReviewee.count,
      arbitersAnonymized: arbiterAnon.count,
      reviewsDeleted: reviewsReviewer.count,
      dmMessagesDeleted: dms.count,
      companiesDeleted,
      walletsDeleted: wallets.count,
      newsletterRowsDeleted: newsletterRows.count,
    }
    return result
  })

  // 3. Audit log (anonymized — pubkey hash only).
  const relayResponses = opts.nip09?.relayResponses ?? {}
  const relaysOk = Object.values(relayResponses).filter(r => r.success).length
  const log = await prisma.accountDeletionLog.create({
    data: {
      userPubkeyHash: hashPubkey(pubkey),
      trigger,
      adminPubkey: opts.adminPubkey ?? null,
      completedAt: new Date(),
      deletedEntities: counts as unknown as Prisma.InputJsonValue,
      eventIdsToDelete: eventIds,
      nip09Kind5EventId: opts.nip09?.kind5EventId ?? null,
      nip09RelaysOk: relaysOk,
      relayResponses,
      gdprLegalBasis:
        trigger === 'ADMIN'
          ? 'Art. 17 DSGVO – Right to Erasure (admin-triggered)'
          : 'Art. 17 DSGVO – Right to Erasure',
    },
  })

  return {
    deletionId: log.id,
    pubkeyHash: log.userPubkeyHash,
    eventIds,
    counts,
    nip09: { kind5EventId: log.nip09Kind5EventId, relaysOk: log.nip09RelaysOk },
  }
}
