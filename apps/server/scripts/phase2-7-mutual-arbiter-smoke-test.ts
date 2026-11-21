/**
 * Phase 2.7 Mutual-Arbiter Smoke Test (ADR-152 §A4 / PROB-002 A2)
 *
 * Verifies the end-to-end state machine for the mutual-arbiter pattern:
 *
 *  1. Create a PRIVATE offer + ticket (via direct DB writes, no UI)
 *  2. GET /api/tickets/:id/arbiters — should return 0 nominations
 *  3. POST /api/tickets/:id/nominate-arbiter (buyer) — should succeed
 *  4. POST /api/tickets/:id/nominate-arbiter (seller, same npub) — should
 *     succeed and flip ready_for_dispute=false
 *  5. POST /api/tickets/:id/accept-arbiter (arbiter) — should succeed
 *  6. GET /api/tickets/:id/arbiters — ready_for_dispute=true
 *  7. Negative: nominate-arbiter against a non-PRIVATE ticket should
 *     return 409 MUTUAL_ARBITER_NOT_APPLICABLE
 *  8. Negative: nominate with bad hex should return 400
 *  9. Negative: accept without both nominations should return 409
 * 10. Cleanup
 *
 * Run with:
 *   cd apps/server && DATABASE_URL="postgresql://colabonate:dev@localhost:5434/colabonate" \
 *     ../../apps/colabonate-app/node_modules/.bin/tsx scripts/phase2-7-mutual-arbiter-smoke-test.ts
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set')
}

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL! })) })
const BASE = process.env.API_URL ?? 'http://localhost:4001'

// Test fixtures (deterministic 64-char hex pubkeys — avoid 000… to dodge
// accidental collisions with seeded rows)
const BUYER_PUBKEY = 'a'.repeat(63) + '1'
const SELLER_PUBKEY = 'b'.repeat(63) + '2'
const ARBITER_PUBKEY = 'c'.repeat(63) + '3'

let offerId: string | null = null
let ticketId: string | null = null
let sessionId: string | null = null
let userId: string | null = null
let sellerId: string | null = null
let offerId2: string | null = null
let ticketId2: string | null = null
let sessionId2: string | null = null

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

async function api(path: string, opts: RequestInit = {}, bearerToken?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
    ...(opts.headers as Record<string, string> | undefined ?? {}),
  }
  const res = await fetch(`${BASE}${path}`, { ...opts, headers })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

async function cleanup() {
  console.log('\n→ Cleaning up…')
  if (ticketId) try { await prisma.privateArbiter.deleteMany({ where: { ticketId } }); await prisma.ticket.delete({ where: { id: ticketId } }) } catch {}
  if (ticketId2) try { await prisma.ticket.delete({ where: { id: ticketId2 } }) } catch {}
  if (offerId) try { await prisma.offer.delete({ where: { id: offerId } }) } catch {}
  if (offerId2) try { await prisma.offer.delete({ where: { id: offerId2 } }) } catch {}
  if (sessionId) try { await prisma.session.delete({ where: { id: sessionId } }) } catch {}
  if (sessionId2) try { await prisma.session.delete({ where: { id: sessionId2 } }) } catch {}
  if (userId) try { await prisma.user.delete({ where: { id: userId } }) } catch {}
  if (sellerId) try { await prisma.user.delete({ where: { id: sellerId } }) } catch {}
  console.log('  ✓ done')
}

async function main() {
  console.log('=== Phase 2.7 Mutual-Arbiter Smoke Test ===\n')

  // ── 0. Set up seller + buyer + sessions ─────────────────────────────────
  const seller = await prisma.user.create({
    data: {
      pubkey: SELLER_PUBKEY,
      lnAddress: `${SELLER_PUBKEY.slice(0, 8)}@ln.test`,
      identityLevel: 2,
      colPoints: 100,
    },
  })
  sellerId = seller.id
  const sellerSession = await prisma.session.create({
    data: {
      pubkey: seller.pubkey,
      k1: 'phase2-7-s-k1-' + Date.now(),
      token: 'phase2-7-s-test-' + Date.now(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  })
  const sellerToken = sellerSession.token

  const buyer = await prisma.user.create({
    data: {
      pubkey: BUYER_PUBKEY,
      lnAddress: `${BUYER_PUBKEY.slice(0, 8)}@ln.test`,
      identityLevel: 1,
      colPoints: 100,
    },
  })
  userId = buyer.id
  const buyerSession = await prisma.session.create({
    data: {
      pubkey: buyer.pubkey,
      k1: 'phase2-7-b-k1-' + Date.now(),
      token: 'phase2-7-b-test-' + Date.now(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  })
  sessionId = buyerSession.id
  const buyerToken = buyerSession.token

  console.log(`Seller: ${SELLER_PUBKEY.slice(0, 12)}…`)
  console.log(`Buyer:  ${BUYER_PUBKEY.slice(0, 12)}…`)
  console.log(`Arbiter: ${ARBITER_PUBKEY.slice(0, 12)}…\n`)

  // ── 1. Create PRIVATE offer + ticket ────────────────────────────────────
  const offer = await prisma.offer.create({
    data: {
      title: '[Phase 2.7] Mutual-Arbiter Smoke Offer',
      description: 'Phase 2.7 mutual-arbiter state machine test',
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
  console.log(`1) Created PRIVATE offer ${offer.id}`)

  const ticket = await prisma.ticket.create({
    data: {
      offerId: offer.id,
      buyerPubkey: BUYER_PUBKEY,
      sellerPubkey: SELLER_PUBKEY,
      status: 'ACCEPTED',
      ticketType: 'SMART_ORDER',
      offerType: 'SERVICE',
      amountSats: offer.priceSats,
      visibility: 'PRIVATE',
      disputeMode: 'PRIVATE',
    },
  })
  ticketId = ticket.id
  console.log(`   Created PRIVATE ticket ${ticket.id}\n`)

  // ── 2. GET /arbiters initial state ──────────────────────────────────────
  console.log('2) GET /api/tickets/:id/arbiters (initial state)…')
  const initRes = await api(`/api/tickets/${ticketId}/arbiters`)
  assert(initRes.ok, 'GET /arbiters returns 200')
  assert(initRes.status === 200, 'status code 200')
  assert(Array.isArray(initRes.data.nominations), 'nominations is an array')
  assert(initRes.data.nominations.length === 0, 'nominations is empty')
  assert(initRes.data.ready_for_dispute === false, 'ready_for_dispute is false')
  assert(initRes.data.ticket?.disputeMode === 'PRIVATE', 'ticket.disputeMode = PRIVATE')
  console.log()

  // ── 3. Buyer nominates arbiter ──────────────────────────────────────────
  console.log('3) Buyer POST /nominate-arbiter…')
  const nom1 = await api(
    `/api/tickets/${ticketId}/nominate-arbiter`,
    { method: 'POST', body: JSON.stringify({ callerPubkey: BUYER_PUBKEY, arbiterPubkey: ARBITER_PUBKEY }) },
    buyerToken ?? undefined,
  )
  assert(nom1.ok, 'nominate-arbiter returns 200')
  assert(nom1.data.nomination?.nominatedByBuyer === true, 'nominatedByBuyer = true')
  assert(nom1.data.nomination?.nominatedBySeller === false, 'nominatedBySeller = false')
  assert(nom1.data.nomination?.arbiterPubkey === ARBITER_PUBKEY, 'arbiterPubkey matches')
  assert(nom1.data.awaiting === 'other_party_nomination', 'awaiting = other_party_nomination')
  console.log()

  // ── 4. Seller nominates the same npub ───────────────────────────────────
  console.log('4) Seller POST /nominate-arbiter (same npub)…')
  const nom2 = await api(
    `/api/tickets/${ticketId}/nominate-arbiter`,
    { method: 'POST', body: JSON.stringify({ callerPubkey: SELLER_PUBKEY, arbiterPubkey: ARBITER_PUBKEY }) },
    sellerToken ?? undefined,
  )
  assert(nom2.ok, 'nominate-arbiter returns 200')
  assert(nom2.data.nomination?.nominatedByBuyer === true, 'nominatedByBuyer still true')
  assert(nom2.data.nomination?.nominatedBySeller === true, 'nominatedBySeller now true')
  assert(nom2.data.awaiting === 'arbiter_acceptance', 'awaiting = arbiter_acceptance')
  console.log()

  // ── 5. Verify GET state — should have 1 nomination, not yet ready ──────
  console.log('5) GET /arbiters after both nominations…')
  const midRes = await api(`/api/tickets/${ticketId}/arbiters`)
  assert(midRes.data.nominations.length === 1, 'still 1 nomination row')
  assert(midRes.data.ready_for_dispute === false, 'ready_for_dispute is still false (not yet accepted)')
  console.log()

  // ── 6. Arbiter accepts ──────────────────────────────────────────────────
  console.log('6) Arbiter POST /accept-arbiter…')
  const acc = await api(
    `/api/tickets/${ticketId}/accept-arbiter`,
    { method: 'POST', body: JSON.stringify({ arbiterPubkey: ARBITER_PUBKEY, arbiterSignature: 'placeholder' }) },
  )
  assert(acc.ok, 'accept-arbiter returns 200')
  assert(acc.data.status === 'accepted', 'status = accepted')
  assert(acc.data.nomination?.acceptedAt, 'acceptedAt timestamp set')
  console.log()

  // ── 7. Final GET state ──────────────────────────────────────────────────
  console.log('7) GET /arbiters after acceptance…')
  const finRes = await api(`/api/tickets/${ticketId}/arbiters`)
  assert(finRes.data.ready_for_dispute === true, 'ready_for_dispute = true')
  assert(finRes.data.nominations[0]?.acceptedAt !== null, 'first nomination has acceptedAt')
  console.log()

  // ── 8. Negative: re-nominate when already accepted → 409 ────────────────
  console.log('8) Negative: re-nominate after acceptance…')
  const dupe = await api(
    `/api/tickets/${ticketId}/nominate-arbiter`,
    { method: 'POST', body: JSON.stringify({ callerPubkey: BUYER_PUBKEY, arbiterPubkey: ARBITER_PUBKEY }) },
    buyerToken ?? undefined,
  )
  assert(!dupe.ok, 're-nominate returns non-OK')
  assert(dupe.status === 409, 're-nominate returns 409')
  console.log()

  // ── 9. Negative: nominate with invalid hex ──────────────────────────────
  console.log('9) Negative: bad hex pubkey…')
  const bad = await api(
    `/api/tickets/${ticketId}/nominate-arbiter`,
    { method: 'POST', body: JSON.stringify({ callerPubkey: BUYER_PUBKEY, arbiterPubkey: 'not-hex' }) },
    buyerToken ?? undefined,
  )
  assert(!bad.ok, 'bad hex returns non-OK')
  assert(bad.status === 400, 'bad hex returns 400')
  console.log()

  // ── 10. Negative: nominate on a PUBLIC-dispute ticket ──────────────────
  console.log('10) Negative: nominate on PUBLIC-dispute ticket…')
  const publicOffer = await prisma.offer.create({
    data: {
      title: '[Phase 2.7] Public control',
      description: 'Should reject nominate-arbiter',
      priceSats: 1000,
      category: 'Services',
      categoryCode: 'services',
      creatorPubkey: SELLER_PUBKEY,
      offerType: 'SERVICE',
      ticketType: 'SMART_ORDER',
      source: 'LOCAL',
      visibility: 'PUBLIC',
      disputeMode: 'PUBLIC',
    },
  })
  offerId2 = publicOffer.id
  const publicTicket = await prisma.ticket.create({
    data: {
      offerId: publicOffer.id,
      buyerPubkey: BUYER_PUBKEY,
      sellerPubkey: SELLER_PUBKEY,
      status: 'ACCEPTED',
      ticketType: 'SMART_ORDER',
      offerType: 'SERVICE',
      amountSats: 1000,
      visibility: 'PUBLIC',
      disputeMode: 'PUBLIC',
    },
  })
  ticketId2 = publicTicket.id
  const pub = await api(
    `/api/tickets/${ticketId2}/nominate-arbiter`,
    { method: 'POST', body: JSON.stringify({ callerPubkey: BUYER_PUBKEY, arbiterPubkey: ARBITER_PUBKEY }) },
    buyerToken ?? undefined,
  )
  assert(!pub.ok, 'public-mode nominate returns non-OK')
  assert(pub.status === 409, 'public-mode nominate returns 409')
  assert(pub.data.error === 'MUTUAL_ARBITER_NOT_APPLICABLE', 'error code MUTUAL_ARBITER_NOT_APPLICABLE')
  console.log()

  // ── 11. Negative: accept without both nominations ──────────────────────
  console.log('11) Negative: accept before both-nominated (fresh ticket)…')
  const freshOffer = await prisma.offer.create({
    data: {
      title: '[Phase 2.7] Fresh PRIVATE for early-accept test',
      description: 'Should reject accept-arbiter',
      priceSats: 2000,
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
  const freshTicket = await prisma.ticket.create({
    data: {
      offerId: freshOffer.id,
      buyerPubkey: BUYER_PUBKEY,
      sellerPubkey: SELLER_PUBKEY,
      status: 'ACCEPTED',
      ticketType: 'SMART_ORDER',
      offerType: 'SERVICE',
      amountSats: 2000,
      visibility: 'PRIVATE',
      disputeMode: 'PRIVATE',
    },
  })
  // Only buyer nominates — no seller nomination yet
  await prisma.privateArbiter.create({
    data: {
      ticketId: freshTicket.id,
      arbiterPubkey: ARBITER_PUBKEY,
      nominatedByBuyer: true,
      nominatedBySeller: false,
    },
  })
  const earlyAccept = await api(
    `/api/tickets/${freshTicket.id}/accept-arbiter`,
    { method: 'POST', body: JSON.stringify({ arbiterPubkey: ARBITER_PUBKEY }) },
  )
  assert(!earlyAccept.ok, 'early accept returns non-OK')
  assert(earlyAccept.status === 409, 'early accept returns 409')
  assert(earlyAccept.data.error === 'BOTH_PARTIES_REQUIRED', 'error code BOTH_PARTIES_REQUIRED')

  // Clean up fresh test rows
  await prisma.privateArbiter.deleteMany({ where: { ticketId: freshTicket.id } })
  await prisma.ticket.delete({ where: { id: freshTicket.id } })
  await prisma.offer.delete({ where: { id: freshOffer.id } })
  console.log()

  console.log(`\n✅ All ${assertionCount} Phase 2.7 mutual-arbiter assertions passed.`)
}

main()
  .catch(async (e) => {
    console.error('\n❌ Smoke test failed:', e)
    await cleanup()
    process.exit(1)
  })
  .finally(async () => {
    await cleanup()
    await prisma.$disconnect()
  })
