/**
 * Phase 4 UX-Polish Smoke Test (ADR-152 / Plan §Phase 4.2 + 4.4)
 *
 * Verifies the server-side reputation-exclusion behaviour:
 *
 *  4.2  A creator who set their ProfileVisibility = PRIVATE has their offers
 *       hidden from the public marketplace browse (GET /api/offers) and from
 *       search (GET /api/search, DB backend), while the owner can still see
 *       their own offers via GET /api/offers?creatorPubkey=… (owner-exempt).
 *  4.4  The wallet transactions stream (GET /api/wallet/transactions) exposes
 *       the ticket's trade-visibility so the UI can flag private tickets.
 *
 * NOTE (4.2 scope): this covers the DB-backed listing + search paths. The
 * company-keyed vendor page (/buy/vendors/:id) and a Meilisearch backend
 * are intentionally out of scope here — the user-centric profile page
 * (/u/:pubkey) already hides everything for PRIVATE profiles, and the dev
 * environment runs with SEARCH_BACKEND=database.
 *
 * Run with:
 *   cd apps/server && DATABASE_URL="postgresql://colabonate:dev@localhost:5434/colabonate" \
 *     ../../apps/colabonate-app/node_modules/.bin/tsx scripts/phase4-ux-smoke-test.ts
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set (e.g. postgresql://colabonate:dev@localhost:5434/colabonate)')
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const BASE = process.env.API_URL ?? 'http://localhost:4001'

// Distinct pubkeys so we never collide with real users.
const PUBLIC_PUBKEY = '4'.repeat(63) + 'a'   // profileVisibility = PUBLIC
const PRIVATE_PUBKEY = '4'.repeat(63) + 'b'  // profileVisibility = PRIVATE
const TOKEN = `phase4-${Date.now()}`

let publicUserId: string | null = null
let privateUserId: string | null = null
let publicOfferId: string | null = null
let privateOfferId: string | null = null
let ticketId: string | null = null

async function fetchJson(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
  return res.json()
}

async function main() {
  console.log('=== Phase 4 UX Smoke Test (4.2 profile filter + 4.4 wallet visibility) ===\n')

  // 1. Two creators: one PUBLIC profile, one PRIVATE profile.
  console.log('1) Creating test users (PUBLIC vs PRIVATE profile)...')
  const publicUser = await prisma.user.create({
    data: { pubkey: PUBLIC_PUBKEY, lnAddress: `${PUBLIC_PUBKEY.slice(0, 8)}@ln.test`, profileVisibility: 'PUBLIC' },
  })
  publicUserId = publicUser.id
  const privateUser = await prisma.user.create({
    data: { pubkey: PRIVATE_PUBKEY, lnAddress: `${PRIVATE_PUBKEY.slice(0, 8)}@ln.test`, profileVisibility: 'PRIVATE' },
  })
  privateUserId = privateUser.id
  console.log(`   ✓ PUBLIC  user ${publicUser.pubkey.slice(0, 10)}…`)
  console.log(`   ✓ PRIVATE user ${privateUser.pubkey.slice(0, 10)}…`)

  // 2. An ACTIVE, published offer per creator with a unique searchable title.
  console.log('\n2) Creating ACTIVE offers (unique token in title)...')
  const publicOffer = await prisma.offer.create({
    data: {
      title: `[TEST] ${TOKEN} public offer`,
      description: 'phase4 smoke',
      priceSats: 1000,
      category: 'Goods', categoryCode: 'goods',
      creatorPubkey: PUBLIC_PUBKEY,
      offerType: 'ITEM', ticketType: 'SMART_ORDER', source: 'LOCAL',
      status: 'ACTIVE', publishedAt: new Date(),
      visibility: 'PUBLIC',
    },
  })
  publicOfferId = publicOffer.id
  const privateOffer = await prisma.offer.create({
    data: {
      title: `[TEST] ${TOKEN} private offer`,
      description: 'phase4 smoke',
      priceSats: 1000,
      category: 'Goods', categoryCode: 'goods',
      creatorPubkey: PRIVATE_PUBKEY,
      offerType: 'ITEM', ticketType: 'SMART_ORDER', source: 'LOCAL',
      status: 'ACTIVE', publishedAt: new Date(),
      visibility: 'PUBLIC', // trade-visibility is PUBLIC; the creator's PROFILE is PRIVATE → must still hide
    },
  })
  privateOfferId = privateOffer.id
  console.log(`   ✓ public offer  ${publicOffer.id}`)
  console.log(`   ✓ private offer ${privateOffer.id}`)

  // ── 4.2a: marketplace browse hides the PRIVATE-profile creator's offer ──
  console.log('\n3) [4.2a] GET /api/offers (browse) — PRIVATE-profile offer must be absent...')
  const browse = await fetchJson(`/api/offers?first=100`)
  const browseIds: string[] = (browse.offers ?? []).map((o: any) => o.id)
  if (browseIds.includes(privateOffer.id)) {
    throw new Error('Browse leaked a PRIVATE-profile creator\'s offer (expected hidden)')
  }
  if (!browseIds.includes(publicOffer.id)) {
    throw new Error('Browse did not return the PUBLIC-profile creator\'s offer')
  }
  console.log('   ✓ PRIVATE-profile offer hidden from browse; PUBLIC-profile offer visible')

  // ── 4.2b: owner-exempt — explicit creatorPubkey still returns own offers ──
  console.log('\n4) [4.2b] GET /api/offers?creatorPubkey=<PRIVATE user> (owner-exempt)...')
  const own = await fetchJson(`/api/offers?creatorPubkey=${PRIVATE_PUBKEY}&first=100`)
  const ownIds: string[] = (own.offers ?? []).map((o: any) => o.id)
  if (!ownIds.includes(privateOffer.id)) {
    throw new Error('Owner-exempt query did not return the PRIVATE user\'s own offer (regression)')
  }
  console.log('   ✓ Owner still sees their own offers via creatorPubkey filter')

  // ── 4.2c: search hides the PRIVATE-profile creator's offer ──
  console.log('\n5) [4.2c] GET /api/search?q=<token> — PRIVATE-profile offer must be absent...')
  const search = await fetchJson(`/api/search?q=${encodeURIComponent(TOKEN)}&first=100`)
  const searchIds: string[] = (search.hits ?? []).map((o: any) => o.id)
  if (searchIds.includes(privateOffer.id)) {
    throw new Error('Search leaked a PRIVATE-profile creator\'s offer (expected hidden)')
  }
  if (!searchIds.includes(publicOffer.id)) {
    throw new Error('Search did not return the PUBLIC-profile creator\'s offer')
  }
  console.log('   ✓ PRIVATE-profile offer hidden from search; PUBLIC-profile offer visible')

  // ── 4.4: wallet transactions expose trade-visibility ──
  console.log('\n6) [4.4] GET /api/wallet/transactions — transaction carries visibility...')
  const ticket = await prisma.ticket.create({
    data: {
      offerId: privateOffer.id,
      buyerPubkey: PRIVATE_PUBKEY,
      sellerPubkey: PUBLIC_PUBKEY,
      status: 'COMPLETED',
      amountSats: 1000,
      visibility: 'PRIVATE',
      disputeMode: 'PRIVATE',
    },
  })
  ticketId = ticket.id
  const wallet = await fetchJson(`/api/wallet/transactions?pubkey=${PRIVATE_PUBKEY}`)
  const txs: any[] = wallet.transactions ?? []
  const mine = txs.find((t: any) => t.ticketId === ticket.id)
  if (!mine) throw new Error('Wallet transactions did not return the test ticket')
  if (mine.visibility !== 'PRIVATE') {
    throw new Error(`Transaction visibility = ${mine.visibility} (expected 'PRIVATE')`)
  }
  console.log(`   ✓ transaction ${ticket.id} → visibility=${mine.visibility}`)

  console.log('\n✅ All Phase 4 UX smoke test assertions passed (4.2a/4.2b/4.2c + 4.4).')
}

main()
  .catch(async (e) => {
    console.error('\n❌ Smoke test failed:', e)
    // best-effort cleanup
    try {
      if (ticketId) await prisma.ticket.delete({ where: { id: ticketId } })
      if (privateOfferId) await prisma.offer.delete({ where: { id: privateOfferId } })
      if (publicOfferId) await prisma.offer.delete({ where: { id: publicOfferId } })
      if (privateUserId) await prisma.user.delete({ where: { id: privateUserId } })
      if (publicUserId) await prisma.user.delete({ where: { id: publicUserId } })
      console.log('Cleaned up test rows on failure')
    } catch { /* ignore */ }
    process.exit(1)
  })
  .finally(async () => {
    // normal cleanup
    try {
      if (ticketId) await prisma.ticket.delete({ where: { id: ticketId } }).catch(() => {})
      if (privateOfferId) await prisma.offer.delete({ where: { id: privateOfferId } }).catch(() => {})
      if (publicOfferId) await prisma.offer.delete({ where: { id: publicOfferId } }).catch(() => {})
      if (privateUserId) await prisma.user.delete({ where: { id: privateUserId } }).catch(() => {})
      if (publicUserId) await prisma.user.delete({ where: { id: publicUserId } }).catch(() => {})
    } finally {
      await prisma.$disconnect()
    }
  })
