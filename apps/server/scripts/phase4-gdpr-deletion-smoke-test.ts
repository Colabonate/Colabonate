/**
 * ADR-156 GDPR Account Deletion Smoke Test
 *
 * Verifies the account-deletion service against the live DB:
 *
 *  - preCheckDeletion:  active-escrow + open-dispute blockers; event-id collection
 *  - deleteUserAccount: two-party anonymization (sentinel), own-only hard-delete,
 *                       counterparty view preserved, anonymized audit log written
 *
 * Two architectural reconciliations vs. the ADR pseudocode are exercised here:
 *   1. CLIENT-SIDE NIP-09: the server only COLLECTS event ids (collectEventIdsForUser);
 *      Kind 5 signing happens client-side. We pass synthetic nip09 results into the
 *      service to confirm they land in the audit log.
 *   2. TWO-PARTY ANONYMIZATION: the shared ticket (A seller, B buyer) must survive
 *      for B; only A's side is reassigned to the sentinel tombstone.
 *
 * Run with:
 *   cd apps/server && DATABASE_URL="postgresql://colabonate:dev@localhost:5434/colabonate" \
 *     ../../apps/colabonate-app/node_modules/.bin/tsx scripts/phase4-gdpr-deletion-smoke-test.ts
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { createHash } from 'node:crypto'
import {
  preCheckDeletion,
  deleteUserAccount,
  collectEventIdsForUser,
  SENTINEL_PUBKEY,
  DeletionBlockedError,
} from '../services/account-deletion.js'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set')
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const TOKEN = `gdpr-${Date.now()}`
// Distinct, run-scoped pubkeys (64 hex chars) — never collide with real users.
const hex = (seed: string) => {
  const h = createHash('sha256').update(`${TOKEN}-${seed}`).digest('hex')
  return h
}
const A_PUBKEY = hex('user-A') // the deleting user (seller/reviewer/dm-owner)
const B_PUBKEY = hex('user-B') // the counterparty (buyer/reviewee) — view must survive

const createdTicketIds: string[] = []
const createdOfferIds: string[] = []
let deletionLogId: string | null = null

let assertions = 0
let failures = 0
function assert(cond: boolean, msg: string): void {
  assertions++
  if (cond) {
    console.log(`   ✓ ${msg}`)
  } else {
    failures++
    console.error(`   ✗ ${msg}`)
  }
}

async function main() {
  console.log('=== ADR-156 GDPR Account Deletion Smoke Test ===\n')

  // ── Setup ──────────────────────────────────────────────────────────────
  console.log('1) Setup: user A (deleter) + user B (counterparty) + shared data...')
  await prisma.user.create({ data: { pubkey: A_PUBKEY } })
  await prisma.user.create({ data: { pubkey: B_PUBKEY } })

  const offer = await prisma.offer.create({
    data: {
      title: `[TEST] ${TOKEN} offer by A`,
      priceSats: 1000,
      categoryCode: 'goods',
      creatorPubkey: A_PUBKEY,
      offerType: 'ITEM',
      ticketType: 'SMART_ORDER',
      source: 'LOCAL',
      status: 'ACTIVE',
      publishedAt: new Date(),
      nostrEventId: hex('offer-event'),
    },
  })
  createdOfferIds.push(offer.id)

  // Shared two-party ticket (A seller, B buyer), TERMINAL escrow → must NOT block.
  const sharedTicket = await prisma.ticket.create({
    data: {
      offerId: offer.id,
      buyerPubkey: B_PUBKEY,
      sellerPubkey: A_PUBKEY,
      status: 'COMPLETED',
      escrowStatus: 'RELEASED',
      nostrEventId: hex('shared-ticket-event'),
    },
  })
  createdTicketIds.push(sharedTicket.id)

  // Active-escrow ticket (A seller, B buyer) → MUST block deletion.
  const activeTicket = await prisma.ticket.create({
    data: {
      offerId: offer.id,
      buyerPubkey: B_PUBKEY,
      sellerPubkey: A_PUBKEY,
      status: 'ACCEPTED',
      escrowStatus: 'PHASE_1_PENDING',
    },
  })
  createdTicketIds.push(activeTicket.id)

  // Review A wrote about B (A=reviewer → own speech → hard-deleted).
  await prisma.review.create({
    data: {
      ticketId: sharedTicket.id,
      reviewerPubkey: A_PUBKEY,
      revieweePubkey: B_PUBKEY,
      stars: 5,
      content: '[TEST] A reviews B',
      nostrEventId: hex('review-event'),
    },
  })

  // DM owned by A (A's inbox → hard-deleted).
  await prisma.dmMessage.create({
    data: {
      ownerPubkey: A_PUBKEY,
      peerPubkey: B_PUBKEY,
      eventId: hex('dm-event'),
      kind: 1059,
      payload: '[TEST] private DM',
      visibility: 'PRIVATE',
    },
  })

  console.log('   ✓ Setup complete (offer, 2 tickets, review, DM)')

  // ── 2. Pre-check BLOCKED by active escrow ──────────────────────────────
  console.log('\n2) preCheckDeletion(A) → blocked by active escrow...')
  const blocked = await preCheckDeletion(prisma, A_PUBKEY)
  assert(!blocked.canDelete, 'canDelete === false (active escrow present)')
  assert(blocked.blockers.activeEscrows === 1, `activeEscrows === 1 (got ${blocked.blockers.activeEscrows})`)
  assert(blocked.blockers.openDisputes === 0, 'openDisputes === 0')

  // ── 3. collectEventIdsForUser (client signs these as Kind 5) ───────────
  console.log('\n3) collectEventIdsForUser(A) → offer + shared-ticket + review ids...')
  const ids = await collectEventIdsForUser(prisma, A_PUBKEY)
  assert(ids.includes(hex('offer-event')), 'collected offer nostrEventId')
  assert(ids.includes(hex('shared-ticket-event')), 'collected shared-ticket nostrEventId')
  assert(ids.includes(hex('review-event')), 'collected review nostrEventId')

  // ── 4. Resolve blocker → pre-check passes ──────────────────────────────
  console.log('\n4) Resolve active escrow → pre-check passes...')
  await prisma.ticket.update({ where: { id: activeTicket.id }, data: { escrowStatus: 'RELEASED' } })
  const ready = await preCheckDeletion(prisma, A_PUBKEY)
  assert(ready.canDelete, 'canDelete === true after escrow resolved')
  assert(ready.eventIds.length === 3, `eventIds.length === 3 (got ${ready.eventIds.length})`)

  // ── 5. deleteUserAccount with synthetic client-side NIP-09 results ─────
  console.log('\n5) deleteUserAccount(A) → cascade + audit log...')
  const result = await deleteUserAccount(prisma, A_PUBKEY, {
    trigger: 'USER',
    nip09: {
      kind5EventId: hex('kind5-event'),
      relayResponses: {
        'wss://inbox.nostr.wine': { success: true },
        'wss://relay.test': { success: false, error: 'timeout' },
      },
    },
  })
  deletionLogId = result.deletionId
  assert(result.counts.ticketsAnonymized === 2, `ticketsAnonymized === 2 (got ${result.counts.ticketsAnonymized})`)
  assert(result.counts.offersAnonymized === 1, `offersAnonymized === 1`)
  assert(result.counts.reviewsDeleted === 1, `reviewsDeleted === 1 (A's own review)`)
  assert(result.counts.dmMessagesDeleted === 1, `dmMessagesDeleted === 1`)
  assert(result.nip09.kind5EventId === hex('kind5-event'), 'nip09 kind5 id captured in audit')
  assert(result.nip09.relaysOk === 1, `nip09 relaysOk === 1 (got ${result.nip09.relaysOk})`)

  // ── 6. User gone, sentinel exists, counterparty view preserved ─────────
  console.log('\n6) Post-deletion state...')
  const aDeleted = await prisma.user.findUnique({ where: { pubkey: A_PUBKEY } })
  assert(aDeleted === null, 'user A is deleted')

  const sentinel = await prisma.user.findUnique({ where: { pubkey: SENTINEL_PUBKEY } })
  assert(sentinel !== null, 'sentinel tombstone user exists')

  const sharedAfter = await prisma.ticket.findUnique({ where: { id: sharedTicket.id } })
  assert(sharedAfter !== null, 'shared ticket survives (B can still see it)')
  assert(sharedAfter?.sellerPubkey === SENTINEL_PUBKEY, "A's side reassigned to sentinel")
  assert(sharedAfter?.buyerPubkey === B_PUBKEY, "B's side intact (counterparty preserved)")
  assert(sharedAfter?.nostrEventId === hex('shared-ticket-event'), 'shared ticket nostrEventId intact')

  const offerAfter = await prisma.offer.findUnique({ where: { id: offer.id } })
  assert(offerAfter?.creatorPubkey === SENTINEL_PUBKEY, 'offer creator anonymized to sentinel')
  assert(offerAfter?.status === 'ARCHIVED', 'offer status set to ARCHIVED (out of active browse)')

  // FU-159-A: the anonymized offer must enqueue an outbox upsert so the
  // OutboxWorker re-syncs its Meilisearch doc (status → ARCHIVED) instead of
  // leaving a stale ACTIVE doc behind.
  const outboxEvents = await prisma.outboxEvent.findMany({
    where: { aggregate: 'offer', aggregateId: offer.id, eventType: 'upsert' },
  })
  assert(outboxEvents.length >= 1, 'FU-159-A: outbox upsert event enqueued for anonymized offer')

  const ownReview = await prisma.review.count({ where: { reviewerPubkey: A_PUBKEY } })
  assert(ownReview === 0, 'review A WROTE is hard-deleted')

  const ownDm = await prisma.dmMessage.count({ where: { ownerPubkey: A_PUBKEY } })
  assert(ownDm === 0, 'DM A OWNED is hard-deleted')

  const bAlive = await prisma.user.findUnique({ where: { pubkey: B_PUBKEY } })
  assert(bAlive !== null, 'counterparty B is untouched')

  // ── 7. Audit log is anonymized ─────────────────────────────────────────
  console.log('\n7) AccountDeletionLog (anonymized audit)...')
  const log = await prisma.accountDeletionLog.findUnique({ where: { id: result.deletionId } })
  assert(log !== null, 'audit log row written')
  assert(log?.userPubkeyHash === createHash('sha256').update(A_PUBKEY, 'utf8').digest('hex'), 'pubkey stored as SHA-256 hash')
  // The plaintext pubkey must NOT appear anywhere in the audit row.
  const serialized = JSON.stringify(log)
  assert(!serialized.includes(A_PUBKEY), 'plaintext A_PUBKEY absent from audit row')
  assert(log?.trigger === 'USER', "trigger === 'USER'")
  assert(log?.completedAt !== null, 'completedAt is set')
  assert(log?.nip09RelaysOk === 1, 'audit recorded nip09RelaysOk === 1')

  // ── 8. Idempotency: deleting A again → not-found error ─────────────────
  console.log('\n8) Re-deleting A → error (already deleted)...')
  try {
    await deleteUserAccount(prisma, A_PUBKEY)
    assert(false, 're-delete should throw')
  } catch (e) {
    assert(/not found/i.test((e as Error).message), 're-delete throws "not found"')
  }

  // ── 9. DeletionBlockedError surfaces when blocker present (on B now) ───
  console.log('\n9) deleteUserAccount(B) → blocked (B still has the now-RELEASED active ticket)...')
  // B is buyer of activeTicket (escrow RELEASED now) — no blocker. Force a blocker:
  await prisma.ticket.update({ where: { id: activeTicket.id }, data: { escrowStatus: 'PHASE_2_PENDING' } })
  try {
    await deleteUserAccount(prisma, B_PUBKEY)
    assert(false, 'B delete should be blocked')
  } catch (e) {
    assert(e instanceof DeletionBlockedError, 'throws DeletionBlockedError')
    assert((e as DeletionBlockedError).blockers.activeEscrows >= 1, 'blocker reports active escrow')
  }
  // restore for cleanup
  await prisma.ticket.update({ where: { id: activeTicket.id }, data: { escrowStatus: 'RELEASED' } })

  console.log(`\n=== ${assertions - failures}/${assertions} assertions passed ===`)
  if (failures > 0) {
    console.error(`❌ ${failures} assertion(s) FAILED`)
  } else {
    console.log('✅ All ADR-156 deletion assertions passed')
  }
}

async function cleanup() {
  // Remove test rows regardless of outcome. A is already gone; shared tickets
  // now reference sentinel — delete them directly.
  try {
    if (deletionLogId) await prisma.accountDeletionLog.delete({ where: { id: deletionLogId } }).catch(() => {})
    for (const id of createdTicketIds) await prisma.ticket.delete({ where: { id } }).catch(() => {})
    for (const id of createdOfferIds) await prisma.offer.delete({ where: { id } }).catch(() => {})
    // FU-159-A: outbox events the deletion enqueued for the test offers.
    await prisma.outboxEvent.deleteMany({ where: { aggregate: 'offer', aggregateId: { in: createdOfferIds } } }).catch(() => {})
    await prisma.review.deleteMany({ where: { reviewerPubkey: A_PUBKEY } }).catch(() => {})
    await prisma.review.deleteMany({ where: { revieweePubkey: A_PUBKEY } }).catch(() => {})
    await prisma.dmMessage.deleteMany({ where: { ownerPubkey: { in: [A_PUBKEY, B_PUBKEY] } } }).catch(() => {})
    await prisma.user.deleteMany({ where: { pubkey: { in: [B_PUBKEY] } } }).catch(() => {})
    // NOTE: sentinel user is intentionally left (idempotent tombstone).
    await pool.end()
  } catch (e) {
    console.error('cleanup error:', e)
  }
}

main()
  .catch((e) => {
    console.error('SMOKE TEST CRASHED:', e)
    failures++
    process.exitCode = 1
  })
  .finally(cleanup)
  .then(() => {
    if (failures > 0) process.exitCode = 1
  })
