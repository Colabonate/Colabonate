/**
 * RemoteCandidateApproval — shared approve path for remote offer candidates
 * (ADR-423).
 *
 * Consumers:
 *   - routes/remote-candidate.ts  (manual single approve + approve-all batch)
 *   - runRemoteAutoApproveTick    (background auto-approval, see below)
 *
 * Auto-approval modes (FoundationSettings, both default off):
 *   - immediate: remoteCandidatesAutoApprove=true → every PENDING_REVIEW
 *     candidate is approved on the next tick (default every 15 min).
 *   - timer: remoteCandidatesAutoApproveDays=N (1–29) → candidates pending
 *     longer than N days are approved on the next tick. Acts as a curation
 *     window: the founder can reject manually before the timer fires
 *     (REJECTED is terminal and never resurrected).
 *   - immediate takes precedence over the timer.
 */

import { Prisma, type PrismaClient, type OfferType, type RemoteOfferCandidate } from '@prisma/client'
import type { Event } from 'nostr-tools'
import { normalizeOfferEvent } from './nostr-normalizer.js'
import { getFoundationSettings } from '../lib/foundation-settings.js'
import { invalidateListCache } from '../middleware/cache.js'

/** reviewedBy marker for approvals made by the background tick (no FK, plain string column). */
export const SYSTEM_REVIEWER = 'system:auto-approve'

/** Batch size for the tick's internal loop (matches the approve-all route cap). */
const TICK_BATCH_SIZE = 200
/** Safety guard: at most 100 batches per tick run (20k candidates). */
const TICK_MAX_BATCHES = 100

// Shared by the manual routes and the auto-approve tick. Throws on any
// failure (bad normalization, DB error) — callers decide how to handle that
// (500 for a single approve, per-item catch for batches).
export async function approveCandidate(prisma: PrismaClient, candidate: RemoteOfferCandidate, reviewerPubkey: string) {
  // Re-normalize from the stored raw event at approve time so improvements
  // to the normalizer (e.g. the ADR-277 D9.5 location→ISO country
  // derivation) also apply to candidates fetched before those improvements
  // existed — not just to new ingest traffic.
  const normalized = candidate.rawEvent
    ? normalizeOfferEvent(candidate.rawEvent as unknown as Event, candidate.remoteRelay)
    : null
  if (!normalized) {
    throw new Error('Candidate no longer passes normalization (hidden, malformed, or raw event missing)')
  }

  return prisma.$transaction(async (tx) => {
    // Shadow user for the remote author — Offer.creator has an FK to
    // User.pubkey, and external Nostr authors have no local User row.
    await tx.user.upsert({
      where: { pubkey: candidate.remoteAuthor },
      create: { pubkey: candidate.remoteAuthor },
      update: {},
    })

    // ADR-363 D4: addressable-event identity — a re-published NIP-99 listing
    // (new event id, same `d` tag) is the SAME logical offer. If it was
    // already approved, update that offer in place instead of creating a
    // duplicate; only new listings (no `d` tag, or no matching ACTIVE offer)
    // are created fresh. The candidate row's remoteEventId/remoteDTag are
    // refreshed by the subscriber on every re-publish, so this always reflects
    // the newest event.
    const existing = candidate.remoteDTag
      ? await tx.offer.findFirst({
          where: {
            creatorPubkey: candidate.remoteAuthor,
            remoteDTag: candidate.remoteDTag,
            status: 'ACTIVE',
          },
        })
      : null

    // Shared create/update payload. Typed as the unchecked input so the
    // scalar FK (creatorPubkey) is allowed and `source: 'REMOTE'` stays a
    // literal rather than widening to string.
    const data: Prisma.OfferUncheckedCreateInput = {
      title: normalized.title,
      description: normalized.description,
      // ADR-277 D9.1/R2/R9: priceSats is a non-nullable column — non-sats listings store
      // 0 as a display sentinel (never a real price) and carry the actual published
      // price in priceAmount/priceCurrency instead. Every price-displaying/purchasing
      // call site must check priceCurrency before trusting priceSats (see
      // BaseOfferCard.offerPriceLabel, DetailPriceHero.foreignPrice, tickets.ts POST /).
      priceSats: normalized.priceSats ?? 0,
      priceAmount: normalized.priceAmount ?? null,
      priceCurrency: normalized.priceCurrency ?? null,
      originUrl: normalized.originUrl ?? null,
      remoteSellerPubkey: normalized.remoteSellerPubkey ?? null,
      // Normalizer validates offerType ∈ {PRODUCT, SERVICE, ITEM}.
      offerType: (normalized.offerType || 'PRODUCT') as OfferType,
      // Non-nullable column — an unmapped foreign category stays '' (uncategorized).
      categoryCode: normalized.categoryCode ?? '',
      gammaTags: normalized.gammaTags ?? [],
      country: normalized.country || null,
      region: normalized.region || null,
      city: normalized.city || null,
      location: normalized.location || null,
      // ADR-363 review fix: explicit DbNull (not undefined) so the in-place
      // update path CLEARS these columns when a re-published listing removes
      // its images/specs — Prisma treats undefined as "leave unchanged".
      images: normalized.images?.length ? normalized.images : Prisma.DbNull,
      source: 'REMOTE',
      isRemote: true,
      language: normalized.language || null,
      creatorPubkey: candidate.remoteAuthor,
      status: 'ACTIVE',
      publishedAt: new Date(),
      productType: normalized.productType ?? null,
      physicalType: normalized.physicalType ?? null,
      stock: normalized.stock ?? null,
      listingVisibility: normalized.visibility || 'on-sale',
      specs: (normalized.specs?.length ? normalized.specs : Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
      weight: normalized.weight ?? null,
      dimensions: normalized.dim ?? null,
      nostrEventId: candidate.remoteEventId,
      remoteDTag: candidate.remoteDTag ?? null,
    }

    let newOffer: { id: string }
    if (existing) {
      newOffer = await tx.offer.update({ where: { id: existing.id }, data })
    } else {
      newOffer = await tx.offer.create({ data })
    }

    // Write to outbox for Meilisearch sync
    await tx.outboxEvent.create({
      data: {
        aggregate: 'offer',
        aggregateId: newOffer.id,
        eventType: 'upsert',
        payload: { source: 'remote', candidateId: candidate.id } as any,
      },
    })

    // Mark candidate as approved
    await tx.remoteOfferCandidate.update({
      where: { id: candidate.id },
      data: {
        status: 'APPROVED',
        reviewedBy: reviewerPubkey,
        reviewedAt: new Date(),
        promotedOfferId: newOffer.id,
      },
    })

    return newOffer
  })
}

export interface ApproveBatchResult {
  approved: number
  failed: number
  failures: Array<{ id: string; error: string }>
  /** PENDING_REVIEW candidates still matching the same filter after the batch. */
  remainingPending: number
}

/**
 * Approve up to `limit` PENDING_REVIEW candidates (oldest first), one at a
 * time so a single bad candidate doesn't abort the batch. A candidate whose
 * stored raw event no longer passes normalization is auto-REJECTED so the
 * batch keeps making forward progress. Shared by the manual approve-all
 * route and the auto-approve tick.
 */
export async function approvePendingCandidates(
  prisma: PrismaClient,
  opts: {
    limit: number
    reviewerPubkey: string
    /** Only candidates fetched before this timestamp (timer mode). */
    pendingSince?: Date
    /** rejectedReason recorded for normalization failures. */
    rejectReason?: string
  },
): Promise<ApproveBatchResult> {
  const where = {
    status: 'PENDING_REVIEW' as const,
    ...(opts.pendingSince ? { fetchedAt: { lt: opts.pendingSince } } : {}),
  }
  const rejectReason = opts.rejectReason ?? 'auto-rejected: failed normalization'

  const candidates = await prisma.remoteOfferCandidate.findMany({
    where,
    orderBy: { fetchedAt: 'asc' },
    take: opts.limit,
  })

  let approved = 0
  const failures: Array<{ id: string; error: string }> = []
  for (const candidate of candidates) {
    try {
      await approveCandidate(prisma, candidate, opts.reviewerPubkey)
      approved++
    } catch (err) {
      failures.push({ id: candidate.id, error: err instanceof Error ? err.message : 'Unknown error' })
      // Don't retry a candidate that fails normalization forever — mark it
      // rejected so the next batch makes forward progress.
      await prisma.remoteOfferCandidate.update({
        where: { id: candidate.id },
        data: { status: 'REJECTED', reviewedBy: opts.reviewerPubkey, reviewedAt: new Date(), rejectedReason: rejectReason },
      }).catch(() => {})
    }
  }

  const remainingPending = await prisma.remoteOfferCandidate.count({ where })
  return { approved, failed: failures.length, failures, remainingPending }
}

/**
 * ADR-423 auto-approval tick. Reads the FoundationSettings fresh on every
 * run, so admin changes apply without a restart:
 *   - immediate mode → drain the whole PENDING_REVIEW queue (looped batches)
 *   - timer mode (N days) → drain everything pending longer than N days
 *   - both off → no-op
 * Invalidates the offers list cache once per run when anything was approved.
 */
export async function runRemoteAutoApproveTick(prisma: PrismaClient, now: Date = new Date()): Promise<void> {
  const settings = await getFoundationSettings(prisma)

  let pendingSince: Date | undefined
  let mode: 'immediate' | 'timer' | undefined
  if (settings.remoteCandidatesAutoApprove) {
    mode = 'immediate'
  } else if (settings.remoteCandidatesAutoApproveDays !== null) {
    mode = 'timer'
    pendingSince = new Date(now.getTime() - settings.remoteCandidatesAutoApproveDays * 24 * 60 * 60 * 1000)
  }
  if (!mode) return

  let approved = 0
  let failed = 0
  let remaining = 1 // enter the loop; recomputed from the DB below
  for (let batch = 0; remaining > 0 && batch < TICK_MAX_BATCHES; batch++) {
    const result = await approvePendingCandidates(prisma, {
      limit: TICK_BATCH_SIZE,
      reviewerPubkey: SYSTEM_REVIEWER,
      pendingSince,
    })
    approved += result.approved
    failed += result.failed
    remaining = result.remainingPending
  }

  if (approved > 0 || failed > 0) {
    console.log(`[RemoteAutoApprove] tick (${mode}${mode === 'timer' ? `, ${settings.remoteCandidatesAutoApproveDays}d` : ''}): approved=${approved}, failed=${failed}`)
    await invalidateListCache('offers')
  }
}
