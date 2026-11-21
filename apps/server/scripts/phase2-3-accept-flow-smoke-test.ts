/**
 * Phase 2.3 Accept-Flow Smoke Test (ADR-152)
 *
 * Simulates what the PrivateOfferDetail Accept button does:
 * 1. Create a PRIVATE Offer in the DB
 * 2. POST /api/tickets with that offerId
 * 3. Verify the created Ticket has visibility=PRIVATE (inherited from offer)
 * 4. Verify the created Ticket has disputeMode=PRIVATE (inherited from offer)
 * 5. Verify the Ticket has the correct offerId, buyer/seller pubkeys
 * 6. Cleanup
 *
 * This verifies Phase 1.2c "Ticket erbt visibility von Offer" still works
 * end-to-end, since the Phase 2.3 Accept button depends on it.
 *
 * Run with:
 *   cd apps/server && DATABASE_URL="..." ../../apps/colabonate-app/node_modules/.bin/tsx scripts/phase2-3-accept-flow-smoke-test.ts
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set')
}

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL! })) })
const BASE = process.env.API_URL ?? 'http://localhost:4001'

let offerId: string | null = null
let ticketId: string | null = null
let buyerId: string | null = null
let buyerPubkey: string | null = null
let buyerToken: string | null = null
let sessionId: string | null = null

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

async function main() {
  console.log('=== Phase 2.3 Accept-Flow Smoke Test ===\n')

  // 1. Find a buyer + seller user pair
  const users = await prisma.user.findMany({ take: 2 })
  if (users.length < 1) {
    console.log('No users found in DB. Seed first.')
    process.exit(1)
  }
  const seller = users[0]
  // Create a separate buyer user to avoid self-dealing
  buyerPubkey = 'phase2-3-buyer-' + Date.now()
  const buyer = await prisma.user.create({
    data: {
      pubkey: buyerPubkey,
      lnAddress: `${buyerPubkey}@ln.test`,
      identityLevel: 1,
      colPoints: 100,
    },
  })
  buyerId = buyer.id

  // Create a session for the buyer so we can call requireAuth-protected routes
  const session = await prisma.session.create({
    data: {
      pubkey: buyer.pubkey,
      k1: 'phase2-3-k1-' + Date.now(),
      token: 'phase2-3-test-token-' + Date.now(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h
    },
  })
  buyerToken = session.token
  sessionId = session.id
  console.log(`Seller: ${seller.pubkey}`)
  console.log(`Buyer:  ${buyer.pubkey}`)
  console.log(`Buyer session token: ${buyerToken!.slice(0, 20)}…`)

  // 2. Create a PRIVATE Offer owned by the seller
  console.log('\n1) Creating PRIVATE offer (seller)...')
  const offer = await prisma.offer.create({
    data: {
      title: '[Phase 2.3] Test Private Offer',
      description: 'Accept-flow smoke test',
      priceSats: 2500,
      category: 'Goods',
      categoryCode: 'goods',
      creatorPubkey: seller.pubkey,
      offerType: 'ITEM',
      ticketType: 'SMART_ORDER',
      source: 'LOCAL',
      visibility: 'PRIVATE',
      disputeMode: 'PRIVATE',
    },
  })
  offerId = offer.id
  console.log(`   ✓ Created PRIVATE offer ${offer.id}`)

  // 3. POST /api/tickets as the buyer
  console.log('\n2) Accepting offer (buyer POST /api/tickets)...')
  const res = await api('/api/tickets', {
    method: 'POST',
    body: JSON.stringify({ offerId: offer.id }),
  }, buyerToken!)

  console.log(`   Response status: ${res.status}`)
  if (!res.ok || !res.data?.ticket?.id) {
    console.log(`   ❌ FAIL: ${JSON.stringify(res.data).slice(0, 300)}`)
    process.exit(1)
  }
  ticketId = res.data.ticket.id
  console.log(`   ✓ Created ticket ${ticketId}`)

  // 4. Verify ticket has visibility=PRIVATE and disputeMode=PRIVATE
  console.log('\n3) Verifying ticket inherited visibility + disputeMode from offer...')
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId ?? undefined } })
  if (!ticket) {
    console.log('   ❌ FAIL: Ticket not in DB')
    process.exit(1)
  }
  console.log(`   ticket.visibility:  ${ticket.visibility} (expected: PRIVATE)`)
  console.log(`   ticket.disputeMode: ${ticket.disputeMode} (expected: PRIVATE)`)
  console.log(`   ticket.buyerPubkey: ${ticket.buyerPubkey} (expected: ${buyer.pubkey})`)
  console.log(`   ticket.sellerPubkey: ${ticket.sellerPubkey} (expected: ${seller.pubkey})`)
  console.log(`   ticket.amountSats:  ${ticket.amountSats} (expected: ${offer.priceSats})`)

  if (ticket.visibility !== 'PRIVATE') {
    console.log('   ❌ FAIL: ticket.visibility is not PRIVATE')
    process.exit(1)
  }
  if (ticket.disputeMode !== 'PRIVATE') {
    console.log('   ❌ FAIL: ticket.disputeMode is not PRIVATE')
    process.exit(1)
  }
  if (ticket.buyerPubkey !== buyer.pubkey) {
    console.log('   ❌ FAIL: ticket.buyerPubkey mismatch')
    process.exit(1)
  }
  if (ticket.sellerPubkey !== seller.pubkey) {
    console.log('   ❌ FAIL: ticket.sellerPubkey mismatch')
    process.exit(1)
  }
  if (ticket.amountSats !== offer.priceSats) {
    console.log('   ❌ FAIL: ticket.amountSats mismatch')
    process.exit(1)
  }
  console.log('   ✓ Ticket correctly inherited visibility, disputeMode, and pubkeys from offer')

  // 5. Cleanup
  console.log('\n4) Cleaning up test ticket, offer, session, and buyer user...')
  await prisma.ticket.delete({ where: { id: ticketId ?? undefined } })
  ticketId = null
  await prisma.offer.delete({ where: { id: offerId ?? undefined } })
  offerId = null
  if (sessionId) await prisma.session.delete({ where: { id: sessionId } }).catch(() => {})
  await prisma.user.delete({ where: { id: buyerId } })
  console.log('   ✓ Cleaned up test data')

  console.log('\n✅ All Phase 2.3 Accept-flow assertions passed.')
}

main()
  .catch(async (e) => {
    console.error('Smoke test failed:', e)
    if (ticketId) try { await prisma.ticket.delete({ where: { id: ticketId } }) } catch {}
    if (offerId) try { await prisma.offer.delete({ where: { id: offerId } }) } catch {}
    if (sessionId) try { await prisma.session.delete({ where: { id: sessionId } }) } catch {}
    if (buyerId) try { await prisma.user.delete({ where: { id: buyerId } }) } catch {}
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
