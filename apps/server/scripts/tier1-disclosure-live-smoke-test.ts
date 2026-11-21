/**
 * Tier-1 Escrow Disclosure Live Smoke Test (ADR-166 Sprint 3)
 *
 * Verifies the full payload_commitment chain end-to-end against the running
 * dev server (Postgres on 5434 + server on 4001):
 *
 *  1. Seed PRIVATE offer + ticket + dispute directly via Prisma.
 *  2. Compute the expected payload_commitment from a CommercialPayload.
 *  3. Inject a Kind 30407 Nostr event into the dev server's relay pool with
 *     that commitment tag and a deterministic id; tell the server about the
 *     id by writing it to Ticket.nostrEventId.
 *  4. POST /api/disputes/:id/disclose with the original plaintext payload.
 *  5. Poll PayloadDisclosure.commitmentVerified; assert it flips to true
 *     within the async verification window.
 *  6. Cleanup.
 *
 * Run with:
 *   pnpm exec tsx apps/server/scripts/tier1-disclosure-live-smoke-test.ts
 *
 * Exit code 0 = success; non-zero = failure.
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { computePayloadCommitment, type CommercialPayload } from '@col/nostr-schema'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set')
}

const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL! })) })
const BASE = process.env.API_URL ?? 'http://localhost:4001'

// Test fixtures (deterministic 64-char hex pubkeys)
const BUYER_PUBKEY = 'a'.repeat(63) + '1'
const SELLER_PUBKEY = 'b'.repeat(63) + '2'

let offerId: string | null = null
let ticketId: string | null = null
let disputeId: string | null = null
let userId: string | null = null
let sellerId: string | null = null
let disclosureId: string | null = null
let sessionId: string | null = null

let assertionCount = 0
function assert(cond: unknown, label: string) {
  assertionCount++
  if (cond) {
    console.log(`   \u2713 ${label}`)
  } else {
    console.log(`   \u2717 ${label}`)
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

const SAMPLE_PAYLOAD: CommercialPayload = {
  offerId: '', // filled in after offer create
  title: 'Sprint-3 Tier-1 smoke test product',
  quantity: 1,
  priceSats: 25_000,
  shippingAddress: '123 Test Lane, 10115 Berlin, DE',
  contactData: 'smoke-test@example.invalid',
  notes: 'Live Tier-1 disclosure end-to-end smoke (ADR-166 Sprint 3).',
}

async function main() {
  console.log('Tier-1 Disclosure Live Smoke Test (ADR-166 Sprint 3)')
  console.log('======================================================\n')

  // --- 0. Health
  console.log('0) Health check on dev server…')
  const health = await api('/health')
  assert(health.status === 200, `dev server reachable at ${BASE}/health`)

  // --- 1. Insert users, offer, ticket, dispute directly via Prisma
  console.log('\n1) Seed PRIVATE offer + ticket + dispute in DB…')
  const buyer = await prisma.user.create({
    data: {
      pubkey: BUYER_PUBKEY,
      lnAddress: `${BUYER_PUBKEY.slice(0, 8)}@ln.test`,
      identityLevel: 2,
      colPoints: 100,
    },
  })
  userId = buyer.id

  const seller = await prisma.user.create({
    data: {
      pubkey: SELLER_PUBKEY,
      lnAddress: `${SELLER_PUBKEY.slice(0, 8)}@ln.test`,
      identityLevel: 2,
      colPoints: 100,
    },
  })
  sellerId = seller.id

  SAMPLE_PAYLOAD.offerId = `sprint3-offer-${Date.now()}`
  const offer = await prisma.offer.create({
    data: {
      id: SAMPLE_PAYLOAD.offerId,
      title: SAMPLE_PAYLOAD.title!,
      description: 'Sprint-3 Tier-1 live smoke test offer',
      priceSats: SAMPLE_PAYLOAD.priceSats!,
      category: 'Other',
      categoryCode: 'other',
      creatorPubkey: SELLER_PUBKEY,
      offerType: 'PRODUCT',
      ticketType: 'SMART_ORDER',
      source: 'LOCAL',
      visibility: 'PRIVATE',
      disputeMode: 'PUBLIC',
    },
  })
  offerId = offer.id

  const ticket = await prisma.ticket.create({
    data: {
      offerId,
      buyerPubkey: BUYER_PUBKEY,
      sellerPubkey: SELLER_PUBKEY,
      status: 'DELIVERY_STARTED',
      escrowStatus: 'DISPUTED',
      ticketType: 'DISPUTE',
      offerType: 'PRODUCT',
      visibility: 'PRIVATE',
      disputeMode: 'PUBLIC',
      amountSats: SAMPLE_PAYLOAD.priceSats!,
    },
  })
  ticketId = ticket.id

  // Ensure the Foundation DAO exists (Dispute.daoId is a non-null FK to Dao.id).
  // The dev DB may or may not have been seeded with it.
  const FOUNDATION_DAO_ID = 'colabonate-foundation'
  const existingDao = await prisma.dao.findUnique({ where: { id: FOUNDATION_DAO_ID } })
  let daoCreated = false
  if (!existingDao) {
    await prisma.dao.create({
      data: {
        id: FOUNDATION_DAO_ID,
        name: 'Colabonate Foundation DAO',
        codexHash: 'deadbeef'.repeat(8),
        codexVersion: 'v0-sprint3-smoke',
        codexUrl: 'docs/decisions/130-foundation-codex-bootstrap.md',
      },
    })
    daoCreated = true
    console.log('   created Foundation DAO (was missing)')
  }

  const dispute = await prisma.dispute.create({
    data: {
      disputeId: `dispute-sprint3-${Date.now()}`,
      ticketId,
      daoId: FOUNDATION_DAO_ID,
      status: 'OPEN',
      disclosureDeadline: new Date(Date.now() + 72 * 3600_000),
    },
  })
  disputeId = dispute.id
  assert(offerId && ticketId && disputeId, `seeded offer=${offerId.slice(0, 12)}\u2026 ticket=${ticketId.slice(0, 12)}\u2026 dispute=${disputeId.slice(0, 12)}\u2026`)

  // --- 2. Compute the commitment that the producer would have set on Kind 30407
  console.log('\n2) Compute payload_commitment that the producer should have written…')
  const expectedCommitment = await computePayloadCommitment(SAMPLE_PAYLOAD)
  assert(/^[0-9a-f]{64}$/.test(expectedCommitment), `commitment is 64-hex SHA-256 (${expectedCommitment.slice(0, 16)}\u2026)`)

  // --- 3. Inject a Kind 30407 Nostr event into the public relay that the dev
  //       server is configured to read from, carrying this commitment tag.
  //       The dev server's nostrService.getEvents() reads from the configured
  //       relay pool (which by default includes wss://relay.damus.io in dev
  //       mode), so publishing there makes the event discoverable.
  console.log('\n3) Publish Kind 30407 event with payload_commitment to public relay…')
  const ticketEventId = await publishKind30407WithCommitment({
    ticketId,
    offerId,
    buyerPubkey: BUYER_PUBKEY,
    sellerPubkey: SELLER_PUBKEY,
    visibility: 1,
    commitment: expectedCommitment,
  })
  assert(/^[0-9a-f]{64}$/.test(ticketEventId), `published Kind 30407 with id=${ticketEventId.slice(0, 16)}\u2026`)

  // Tell the server where to look for the ticket's Nostr event
  await prisma.ticket.update({
    where: { id: ticketId },
    data: { nostrEventId: ticketEventId },
  })

  // --- 4. POST /api/disputes/:id/disclose with the original payload
  console.log('\n4) POST /api/disputes/:id/disclose with original payload…')
  const disclose = await api(`/api/disputes/${disputeId}/disclose`, {
    method: 'POST',
    body: JSON.stringify({
      callerPubkey: BUYER_PUBKEY,
      payload: SAMPLE_PAYLOAD,
      method: 'plaintext',
    }),
  })
  assert(disclose.status === 200, `disclose returned 200 (got ${disclose.status})`)
  assert(disclose.data?.disclosure?.commitmentVerified === false, 'response: commitmentVerified=false (async pending)')
  disclosureId = disclose.data?.disclosure?.id

  // --- 5. Poll PayloadDisclosure for commitmentVerified === true
  console.log('\n5) Poll PayloadDisclosure.commitmentVerified (async background verification)…')
  const deadline = Date.now() + 30_000
  let finalVerified = false
  let finalState: any = null
  while (Date.now() < deadline) {
    const row = await prisma.payloadDisclosure.findUnique({ where: { id: disclosureId ?? undefined } })
    if (row?.commitmentVerified === true) {
      finalVerified = true
      finalState = row
      break
    }
    finalState = row
    await new Promise(r => setTimeout(r, 1_000))
  }
  assert(finalVerified, `PayloadDisclosure.commitmentVerified === true within 30s (final state: commitmentVerified=${finalState?.commitmentVerified})`)

  if (!finalVerified) {
    console.error('Final state:', finalState)
  }

  console.log(`\n\u2713 Tier-1 disclosure live smoke test passed (${assertionCount} assertions).`)
  console.log('  Receipt: POST /api/disputes/.../disclose \u2192 background verifyPayloadCommitment \u2192 commitmentVerified=true in DB.')
  console.log('  This is the missing end-to-end proof for ADR-152 Selective Disclosure in a real environment.')
}

async function publishKind30407WithCommitment(args: {
  ticketId: string
  offerId: string
  buyerPubkey: string
  sellerPubkey: string
  visibility: 0 | 1 | 2
  commitment: string
}): Promise<string> {
  const sk = generateSecretKey()
  const pubkey = getPublicKey(sk)
  const event = finalizeEvent(
    {
      kind: 30407,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', args.ticketId],
        ['ticket', args.ticketId],
        ['offer', args.offerId],
        ['buyer', args.buyerPubkey],
        ['seller', args.sellerPubkey],
        ['p', args.sellerPubkey],
        ['status', 'PENDING'],
        ['visibility', String(args.visibility)],
        ['payload_commitment', args.commitment],
      ],
      content: '',
    },
    sk,
  )

  // The dev server reads from the in-process Mock Relay at ws://localhost:4001
  // (see apps/server/services/nostr-relay.ts:51-62). We MUST publish there,
  // not to a public relay — the public relay is not in the server's pool.
  try {
    const relayUrl = process.env.SMOKE_RELAY_URL ?? 'ws://localhost:4001'
    await publishToRelay(relayUrl, event)
    console.log(`   published to ${relayUrl} by pubkey ${pubkey.slice(0, 12)}…`)
  } catch (err) {
    console.warn(`   could not reach mock relay (${(err as Error).message}); the test will still run, but verification depends on the dev server's relay pool.`)
  }
  return event.id
}

async function publishToRelay(url: string, event: any): Promise<void> {
  // Minimal NIP-01 publish via WebSocket. Uses global WebSocket (Node 22+).
  const ws = new (globalThis as any).WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      try { ws.close() } catch {}
      reject(new Error(`timeout connecting to ${url}`))
    }, 10_000)
    ws.onopen = () => {
      ws.send(JSON.stringify(['EVENT', event]))
      clearTimeout(t)
      // wait for OK
      ws.onmessage = (msg: any) => {
        try {
          const parsed = JSON.parse(msg.data)
          if (parsed[0] === 'OK' && parsed[1] === event.id) {
            ws.close()
            resolve()
          }
        } catch {}
      }
    }
    ws.onerror = (e: any) => {
      clearTimeout(t)
      reject(new Error(`WebSocket error: ${e?.message ?? 'unknown'}`))
    }
  })
}

async function cleanup() {
  console.log('\n\u2192 Cleaning up…')
  try { if (disclosureId) await prisma.payloadDisclosure.delete({ where: { id: disclosureId } }) } catch {}
  try { if (disputeId) await prisma.dispute.delete({ where: { id: disputeId } }) } catch {}
  try { if (ticketId) await prisma.ticket.delete({ where: { id: ticketId } }) } catch {}
  try { if (offerId) await prisma.offer.delete({ where: { id: offerId } }) } catch {}
  try { if (userId) await prisma.user.delete({ where: { id: userId } }) } catch {}
  try { if (sellerId) await prisma.user.delete({ where: { id: sellerId } }) } catch {}
  console.log('  ✓ cleanup done')
}

process.on('SIGINT', async () => {
  await cleanup()
  await prisma.$disconnect()
  process.exit(130)
})

main()
  .then(() => cleanup())
  .then(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error('\n\u2717 Smoke test failed:', err)
    await cleanup()
    await prisma.$disconnect()
    process.exit(1)
  })
