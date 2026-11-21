/**
 * Phase 2.8 Private-Verdict Smoke Test (ADR-152 §A4 / PROB-002 A2)
 *
 * Verifies the end-to-end private-arbiter verdict submission flow:
 *
 *  1. Create a PRIVATE, DISPUTED ticket + an accepted PrivateArbiter row +
 *     an OPEN Dispute (via direct DB writes, no UI).
 *  2. Arbiter signs a Kind 30022 verdict event (real Schnorr key).
 *  3. POST /api/tickets/:id/private-verdict (RELEASE) — should succeed,
 *     flip ticket → COMPLETED, dispute → RESOLVED, nomination.verdictOutcome
 *     = RELEASE, and write DmMessage inbox rows for buyer + seller.
 *  4. CANCEL path on a second ticket — ticket → CANCELLED.
 *  5. Negative tests:
 *     - re-submit on already-resolved ticket → 409 VERDICT_ALREADY_SUBMITTED
 *     - bad outcome → 400
 *     - tampered signature → 401
 *     - signedEvent.pubkey != arbiterPubkey → 401
 *     - non-nominated arbiter → 403 NOT_NOMINATED
 *     - non-PRIVATE ticket → 409 PRIVATE_VERDICT_NOT_APPLICABLE
 *     - ticket not DISPUTED → 409 TICKET_NOT_DISPUTED
 *  6. Cleanup.
 *
 * Escrow hold-invoices are intentionally left unset (null preimages/hashes)
 * so the verdict state-machine is validated independent of the payment
 * provider. The escrow settle/cancel loop is a no-op for empty arrays.
 *
 * Run with:
 *   cd apps/server && DATABASE_URL="postgresql://colabonate:dev@localhost:5434/colabonate" \
 *     ../../apps/colabonate-app/node_modules/.bin/tsx scripts/phase2-8-verdict-smoke-test.ts
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set')
}

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL! })) })
const BASE = process.env.API_URL ?? 'http://localhost:4001'

// Real arbiter keypair — the verdict signature must verify server-side.
const ARBITER_SK = generateSecretKey()
const ARBITER_PUBKEY = getPublicKey(ARBITER_SK) // lowercase 64-char hex
const BUYER_PUBKEY = 'a'.repeat(63) + '8'
const SELLER_PUBKEY = 'b'.repeat(63) + '9'

const DAO_ID = 'phase2-8-dao-' + Date.now()

let sellerId: string | null = null
let buyerId: string | null = null
let offerId: string | null = null
let ticketRelease: string | null = null
let ticketCancel: string | null = null
let ticketPublic: string | null = null
let ticketNotDisputed: string | null = null
let daoCreated = false

let assertionCount = 0
function assert(cond: unknown, label: string) {
  assertionCount++
  if (cond) {
    console.log(`   ✓ ${label}`)
  } else {
    console.log(`   ✗ ${label}`)
    throw new Error(`Assertion failed: ${label}`)
  }
}

async function api(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> | undefined ?? {}),
  }
  const res = await fetch(`${BASE}${path}`, { ...opts, headers })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

/** Sign a Kind 30022 verdict event exactly like lib/nostr.ts::signVerdictIntent. */
function signVerdict(ticketId: string, outcome: 'RELEASE' | 'CANCEL', reasoning = '') {
  const createdAt = Math.floor(Date.now() / 1000)
  const template: Omit<EventTemplate, 'created_at'> = {
    kind: 30022,
    tags: [
      ['d', `verdict-${Date.now()}-${ticketId.slice(0, 8)}`],
      ['sub_type', 'private_arbiter_verdict'],
      ['ticket_id', ticketId],
      ['outcome', outcome],
      ['arbiter_pubkey', ARBITER_PUBKEY],
      ['visibility', 'PRIVATE'],
    ],
    content: JSON.stringify({
      type: 'private_arbiter_verdict',
      ticket_id: ticketId,
      arbiter_pubkey: ARBITER_PUBKEY,
      outcome,
      reasoning,
      timestamp: createdAt,
    }),
  }
  return finalizeEvent({ ...template, created_at: createdAt } as EventTemplate, ARBITER_SK)
}

/** Create a PRIVATE, DISPUTED ticket with an accepted arbiter + OPEN dispute. */
async function makeDisputedTicket(label: string): Promise<string> {
  const ticket = await prisma.ticket.create({
    data: {
      offerId: offerId!,
      buyerPubkey: BUYER_PUBKEY,
      sellerPubkey: SELLER_PUBKEY,
      status: 'DISPUTED',
      ticketType: 'SMART_ORDER',
      offerType: 'SERVICE',
      amountSats: 5000,
      visibility: 'PRIVATE',
      disputeMode: 'PRIVATE',
      escrowStatus: 'HELD',
    },
  })
  await prisma.privateArbiter.create({
    data: {
      ticketId: ticket.id,
      arbiterPubkey: ARBITER_PUBKEY,
      nominatedByBuyer: true,
      nominatedBySeller: true,
      acceptedAt: new Date(),
    },
  })
  await prisma.dispute.create({
    data: {
      disputeId: `phase2-8-disp-${label}-${Date.now()}`,
      ticketId: ticket.id,
      daoId: DAO_ID,
      status: 'OPEN',
    },
  })
  return ticket.id
}

async function cleanup() {
  console.log('\n→ Cleaning up…')
  for (const tid of [ticketRelease, ticketCancel, ticketPublic, ticketNotDisputed]) {
    if (!tid) continue
    try { await prisma.dispute.deleteMany({ where: { ticketId: tid } }) } catch {}
    try { await prisma.privateArbiter.deleteMany({ where: { ticketId: tid } }) } catch {}
    try { await prisma.dmMessage.deleteMany({ where: { ticketId: tid } }) } catch {}
    try { await prisma.ticket.delete({ where: { id: tid } }) } catch {}
  }
  if (offerId) try { await prisma.offer.delete({ where: { id: offerId } }) } catch {}
  if (buyerId) try { await prisma.user.delete({ where: { id: buyerId } }) } catch {}
  if (sellerId) try { await prisma.user.delete({ where: { id: sellerId } }) } catch {}
  if (daoCreated) try { await prisma.dao.delete({ where: { id: DAO_ID } }) } catch {}
  console.log('  ✓ done')
}

async function main() {
  console.log('=== Phase 2.8 Private-Verdict Smoke Test ===\n')
  console.log(`Arbiter: ${ARBITER_PUBKEY.slice(0, 12)}…`)
  console.log(`Buyer:   ${BUYER_PUBKEY.slice(0, 12)}…`)
  console.log(`Seller:  ${SELLER_PUBKEY.slice(0, 12)}…\n`)

  // ── 0. Setup: users, dao, offer ─────────────────────────────────────────
  const seller = await prisma.user.create({
    data: { pubkey: SELLER_PUBKEY, lnAddress: `${SELLER_PUBKEY.slice(0, 8)}@ln.test`, identityLevel: 2, colPoints: 100 },
  })
  sellerId = seller.id
  const buyer = await prisma.user.create({
    data: { pubkey: BUYER_PUBKEY, lnAddress: `${BUYER_PUBKEY.slice(0, 8)}@ln.test`, identityLevel: 1, colPoints: 100 },
  })
  buyerId = buyer.id
  await prisma.dao.create({
    data: {
      id: DAO_ID,
      name: 'Phase 2.8 Test DAO',
      codexHash: 'deadbeef'.repeat(8),
      codexVersion: 'v0-test',
      codexUrl: 'docs/test.md',
    },
  })
  daoCreated = true
  const offer = await prisma.offer.create({
    data: {
      title: '[Phase 2.8] Private-Verdict Smoke Offer',
      description: 'Phase 2.8 private-verdict flow test',
      priceSats: 5000,
      category: 'Services',
      categoryCode: 'services',
      creatorPubkey: SELLER_PUBKEY,
      offerType: 'SERVICE',
      ticketType: 'SMART_ORDER',
      source: 'LOCAL',
      visibility: 'PRIVATE',
      disputeMode: 'PRIVATE',
    },
  })
  offerId = offer.id
  console.log('0) Setup complete (users + dao + offer)\n')

  // ── 1. RELEASE verdict ──────────────────────────────────────────────────
  console.log('1) Arbiter submits RELEASE verdict…')
  ticketRelease = await makeDisputedTicket('release')
  const relEvent = signVerdict(ticketRelease, 'RELEASE', 'Seller delivered as agreed.')
  const rel = await api(`/api/tickets/${ticketRelease}/private-verdict`, {
    method: 'POST',
    body: JSON.stringify({ arbiterPubkey: ARBITER_PUBKEY, outcome: 'RELEASE', reasoning: 'Seller delivered as agreed.', signedEvent: relEvent }),
  })
  assert(rel.ok, 'RELEASE returns 200')
  assert(rel.data.success === true, 'response.success = true')
  assert(rel.data.verdict?.outcome === 'RELEASE', 'verdict.outcome = RELEASE')
  assert(rel.data.verdict?.escrowAction === 'released', 'escrowAction = released (no preimages → no-op)')
  assert(rel.data.nostrEventTemplate?.kind === 30022, 'nostrEventTemplate.kind = 30022')

  const relTicket = await prisma.ticket.findUnique({ where: { id: ticketRelease } })
  assert(relTicket?.status === 'COMPLETED', 'ticket.status = COMPLETED')
  assert(relTicket?.escrowStatus === 'RELEASED', 'ticket.escrowStatus = RELEASED')
  assert(relTicket?.deliveryConfirmedAt != null, 'ticket.deliveryConfirmedAt set')

  const relDispute = await prisma.dispute.findFirst({ where: { ticketId: ticketRelease } })
  assert(relDispute?.status === 'RESOLVED', 'dispute.status = RESOLVED')
  assert(relDispute?.outcome === 'RELEASE', 'dispute.outcome = RELEASE')
  assert(relDispute?.verdictIssuedAt != null, 'dispute.verdictIssuedAt set')
  assert(relDispute?.arbitratorPubkey === ARBITER_PUBKEY, 'dispute.arbitratorPubkey = arbiter')

  const relNom = await prisma.privateArbiter.findUnique({ where: { ticketId_arbiterPubkey: { ticketId: ticketRelease, arbiterPubkey: ARBITER_PUBKEY } } })
  assert(relNom?.verdictOutcome === 'RELEASE', 'nomination.verdictOutcome = RELEASE')
  assert(relNom?.verdictReasoning === 'Seller delivered as agreed.', 'nomination.verdictReasoning stored')
  assert(relNom?.verdictNostrEventId === relEvent.id, 'nomination.verdictNostrEventId = signed event id')

  const dms = await prisma.dmMessage.findMany({ where: { ticketId: ticketRelease } })
  assert(dms.length === 2, 'two DmMessage inbox rows written (buyer + seller)')
  const owners = dms.map(d => d.ownerPubkey).sort()
  assert(owners.includes(BUYER_PUBKEY) && owners.includes(SELLER_PUBKEY), 'DmMessages addressed to buyer + seller')
  assert(dms.every(d => d.peerPubkey === ARBITER_PUBKEY), 'DmMessage peer = arbiter')
  assert(dms.every(d => d.visibility === 'PRIVATE'), 'DmMessage visibility = PRIVATE')
  console.log()

  // ── 2. Negative: re-submit on resolved ticket ───────────────────────────
  console.log('2) Negative: re-submit verdict on resolved ticket…')
  const reEvent = signVerdict(ticketRelease, 'CANCEL')
  const reSubmit = await api(`/api/tickets/${ticketRelease}/private-verdict`, {
    method: 'POST',
    body: JSON.stringify({ arbiterPubkey: ARBITER_PUBKEY, outcome: 'CANCEL', signedEvent: reEvent }),
  })
  assert(!reSubmit.ok, 're-submit returns non-OK')
  // Ticket is now COMPLETED (not DISPUTED) so the guard order yields 409 TICKET_NOT_DISPUTED.
  assert(reSubmit.status === 409, 're-submit returns 409')
  console.log()

  // ── 3. CANCEL verdict ───────────────────────────────────────────────────
  console.log('3) Arbiter submits CANCEL verdict (separate ticket)…')
  ticketCancel = await makeDisputedTicket('cancel')
  const canEvent = signVerdict(ticketCancel, 'CANCEL', 'Item not delivered.')
  const can = await api(`/api/tickets/${ticketCancel}/private-verdict`, {
    method: 'POST',
    body: JSON.stringify({ arbiterPubkey: ARBITER_PUBKEY, outcome: 'CANCEL', reasoning: 'Item not delivered.', signedEvent: canEvent }),
  })
  assert(can.ok, 'CANCEL returns 200')
  assert(can.data.verdict?.outcome === 'CANCEL', 'verdict.outcome = CANCEL')
  const canTicket = await prisma.ticket.findUnique({ where: { id: ticketCancel } })
  assert(canTicket?.status === 'CANCELLED', 'ticket.status = CANCELLED')
  assert(canTicket?.escrowStatus === 'CANCELLED', 'ticket.escrowStatus = CANCELLED')
  const canDispute = await prisma.dispute.findFirst({ where: { ticketId: ticketCancel } })
  assert(canDispute?.outcome === 'CANCEL', 'dispute.outcome = CANCEL')
  console.log()

  // ── 4. Negative: bad outcome ────────────────────────────────────────────
  console.log('4) Negative: invalid outcome value…')
  const t4 = await makeDisputedTicket('badoutcome')
  ticketNotDisputed = t4 // reuse cleanup slot; will be deleted
  const badOutcomeEvent = signVerdict(t4, 'RELEASE')
  const badOutcome = await api(`/api/tickets/${t4}/private-verdict`, {
    method: 'POST',
    body: JSON.stringify({ arbiterPubkey: ARBITER_PUBKEY, outcome: 'SPLIT', signedEvent: badOutcomeEvent }),
  })
  assert(!badOutcome.ok, 'invalid outcome returns non-OK')
  assert(badOutcome.status === 400, 'invalid outcome returns 400')
  console.log()

  // ── 5. Negative: tampered signature ─────────────────────────────────────
  console.log('5) Negative: tampered Schnorr signature…')
  const tampered = signVerdict(t4, 'RELEASE')
  tampered.sig = tampered.sig.slice(0, -2) + (tampered.sig.endsWith('00') ? 'ff' : '00')
  const tamperedRes = await api(`/api/tickets/${t4}/private-verdict`, {
    method: 'POST',
    body: JSON.stringify({ arbiterPubkey: ARBITER_PUBKEY, outcome: 'RELEASE', signedEvent: tampered }),
  })
  assert(!tamperedRes.ok, 'tampered sig returns non-OK')
  assert(tamperedRes.status === 401, 'tampered sig returns 401')
  console.log()

  // ── 6. Negative: signedEvent.pubkey != arbiterPubkey ────────────────────
  console.log('6) Negative: pubkey mismatch (different signer)…')
  const otherSk = generateSecretKey()
  const otherPub = getPublicKey(otherSk)
  const mismatchEvent = finalizeEvent(
    { kind: 30022, created_at: Math.floor(Date.now() / 1000), tags: [['ticket_id', t4]], content: '{}' } as EventTemplate,
    otherSk,
  )
  const mismatch = await api(`/api/tickets/${t4}/private-verdict`, {
    method: 'POST',
    body: JSON.stringify({ arbiterPubkey: ARBITER_PUBKEY, outcome: 'RELEASE', signedEvent: mismatchEvent }),
  })
  assert(!mismatch.ok, 'pubkey mismatch returns non-OK')
  assert(mismatch.status === 401, 'pubkey mismatch returns 401')
  assert(otherPub !== ARBITER_PUBKEY, 'sanity: signer pubkey differs from arbiter')
  console.log()

  // ── 7. Negative: non-nominated arbiter ──────────────────────────────────
  console.log('7) Negative: signer not nominated for ticket…')
  // t4 has ARBITER nominated. Use otherSk as a valid signer whose pubkey is
  // NOT a nominated arbiter → 403 NOT_NOMINATED.
  const notNomEvent = finalizeEvent(
    { kind: 30022, created_at: Math.floor(Date.now() / 1000), tags: [['ticket_id', t4]], content: '{}' } as EventTemplate,
    otherSk,
  )
  const notNom = await api(`/api/tickets/${t4}/private-verdict`, {
    method: 'POST',
    body: JSON.stringify({ arbiterPubkey: otherPub, outcome: 'RELEASE', signedEvent: notNomEvent }),
  })
  assert(!notNom.ok, 'non-nominated returns non-OK')
  assert(notNom.status === 403, 'non-nominated returns 403')
  assert(notNom.data.error === 'NOT_NOMINATED', 'error code NOT_NOMINATED')
  console.log()

  // ── 8. Negative: non-PRIVATE ticket ─────────────────────────────────────
  console.log('8) Negative: verdict on PUBLIC-dispute ticket…')
  const publicTicket = await prisma.ticket.create({
    data: {
      offerId: offerId!,
      buyerPubkey: BUYER_PUBKEY,
      sellerPubkey: SELLER_PUBKEY,
      status: 'DISPUTED',
      ticketType: 'SMART_ORDER',
      offerType: 'SERVICE',
      amountSats: 5000,
      visibility: 'PUBLIC',
      disputeMode: 'PUBLIC',
    },
  })
  ticketPublic = publicTicket.id
  const pubEvent = signVerdict(publicTicket.id, 'RELEASE')
  const pubRes = await api(`/api/tickets/${publicTicket.id}/private-verdict`, {
    method: 'POST',
    body: JSON.stringify({ arbiterPubkey: ARBITER_PUBKEY, outcome: 'RELEASE', signedEvent: pubEvent }),
  })
  assert(!pubRes.ok, 'public-mode returns non-OK')
  assert(pubRes.status === 409, 'public-mode returns 409')
  assert(pubRes.data.error === 'PRIVATE_VERDICT_NOT_APPLICABLE', 'error code PRIVATE_VERDICT_NOT_APPLICABLE')
  console.log()

  // ── 9. Negative: ticket not DISPUTED ────────────────────────────────────
  console.log('9) Negative: verdict on non-DISPUTED ticket…')
  const acceptedTicket = await prisma.ticket.create({
    data: {
      offerId: offerId!,
      buyerPubkey: BUYER_PUBKEY,
      sellerPubkey: SELLER_PUBKEY,
      status: 'ACCEPTED',
      ticketType: 'SMART_ORDER',
      offerType: 'SERVICE',
      amountSats: 5000,
      visibility: 'PRIVATE',
      disputeMode: 'PRIVATE',
    },
  })
  await prisma.privateArbiter.create({
    data: { ticketId: acceptedTicket.id, arbiterPubkey: ARBITER_PUBKEY, nominatedByBuyer: true, nominatedBySeller: true, acceptedAt: new Date() },
  })
  const ndEvent = signVerdict(acceptedTicket.id, 'RELEASE')
  const ndRes = await api(`/api/tickets/${acceptedTicket.id}/private-verdict`, {
    method: 'POST',
    body: JSON.stringify({ arbiterPubkey: ARBITER_PUBKEY, outcome: 'RELEASE', signedEvent: ndEvent }),
  })
  assert(!ndRes.ok, 'non-disputed returns non-OK')
  assert(ndRes.status === 409, 'non-disputed returns 409')
  assert(ndRes.data.error === 'TICKET_NOT_DISPUTED', 'error code TICKET_NOT_DISPUTED')
  // track for cleanup
  try { await prisma.privateArbiter.deleteMany({ where: { ticketId: acceptedTicket.id } }) } catch {}
  try { await prisma.ticket.delete({ where: { id: acceptedTicket.id } }) } catch {}
  console.log()

  console.log(`\n✅ All ${assertionCount} Phase 2.8 private-verdict assertions passed.`)
}

main()
  .catch(err => {
    console.error('\n❌ Phase 2.8 smoke test failed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await cleanup()
    await prisma.$disconnect()
  })
