/**
 * seed-escrow-trades.ts — deterministic EscrowTrade fixtures for the local
 * Escrow Trade Desk (/trade). Creates one trade per canister state so the
 * list, KPI filter and cockpit can be exercised end-to-end without a deployed
 * canister or a real Bitcoin funding step.
 *
 * What it creates (and what each exercises in the UI):
 *   1. A demo buyer + seller identity (User + Session), so you can log in as
 *      either role via a pasted localStorage token (see the printed block).
 *   2. Six EscrowTrade rows — one per state — with a distinct amount,
 *      milestone schedule, funding address and terms hash:
 *        PENDING_FUNDING · FUNDED · RELEASED · REFUNDED · DISPUTED · DISPUTE_SETTLED
 *   3. An append-only EscrowTradeEvent timeline per trade (the cockpit's
 *      Timeline section + the dossier's backbone).
 *
 * Idempotent: re-running wipes the prefixed fixtures and re-creates them.
 * Never touches data outside the two seed identities.
 *
 * The mirror rows are view-only app records (ADR-355 D4): the cockpit's trust
 * panel will report "Unverifiable" unless a real local replica + canister is
 * deployed — that is the honest state, not a bug. Real create/fund/action
 * requires the canister (see docs/escrow-ui/TESTING.md §4).
 *
 * Usage:
 *   cd WORKSPACE_PATH_REDACTED\Colabonate-App
 *   npx pnpm --filter server exec tsx ./scripts/seed-escrow-trades.ts
 *
 *   DATABASE_URL is auto-loaded from the repo-root .env when not already set:
 *   $env:DATABASE_URL='postgresql://colabonate:dev@127.0.0.1:5434/colabonate?schema=public'
 */
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Load DATABASE_URL from the repo-root .env when not already set (tsx does not
// auto-load .env). An explicit env value always wins.
try {
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const envFile = readFileSync(resolve(scriptDir, '../../../.env'), 'utf-8')
  if (!process.env.DATABASE_URL) {
    const m = envFile.match(/^DATABASE_URL=(.+)$/m)
    if (m) process.env.DATABASE_URL = m[1].trim()
  }
} catch { /* .env optional */ }

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set and could not be read from the repo-root .env.')
  process.exit(1)
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

// Valid 64-char hex identities (the cockpit's NIP-17 TradeChat requires valid
// hex pubkeys for gift-wrap). "abab…" = buyer, "cdcd…" = seller.
const BUYER_PUBKEY = 'ab'.repeat(32)
const SELLER_PUBKEY = 'cd'.repeat(32)
// The escrow canister principal this local replica deployed as (FU-572). The
// trust panel resolves against it when a replica is running.
const CANISTER_ID = '4caro-hl777-77775-aaaba-cai'
const IDENTITY_LEVEL = 2

const TOKEN_BUYER = randomBytes(32).toString('hex')
const TOKEN_SELLER = randomBytes(32).toString('hex')
const TOKEN_EXPIRY = new Date(Date.now() + 30 * 24 * 3600_000)

const NOW_MS = Date.now()
const DAY_MS = 86_400_000
/** ms since epoch → nanoseconds since epoch (decimal string), the wire shape. */
function nsAt(daysFromNow: number): string {
  return (BigInt(NOW_MS + daysFromNow * DAY_MS) * 1_000_000n).toString()
}
function daysAgo(d: number): Date {
  return new Date(NOW_MS - d * DAY_MS)
}
function btcAddr(tag: string): string {
  return 'tb1q' + createHash('sha1').update(tag).digest('hex').slice(0, 38)
}
function termsHash(tag: string): string {
  return createHash('sha256').update(`colabonate-escrow-seed:${tag}`).digest('hex')
}

interface Fixture {
  state: string
  canisterTradeId: string
  amountSats: number
  milestones: { pctBps: number; released: boolean }[]
  settledBuyerBps: number | null
  settledSellerBps: number | null
  createdAtDaysAgo: number
  fundedDaysAgo: number | null
  timeoutDays: number
  events: { kind: string; message: string; hoursAgo: number }[]
}

const FIXTURES: Fixture[] = [
  {
    state: 'PENDING_FUNDING',
    canisterTradeId: '1',
    amountSats: 150_000,
    milestones: [{ pctBps: 10_000, released: false }],
    settledBuyerBps: null,
    settledSellerBps: null,
    createdAtDaysAgo: 0,
    fundedDaysAgo: null,
    timeoutDays: 30,
    events: [{ kind: 'STATE_TRANSITION', message: 'trade created (awaiting deposit)', hoursAgo: 2 }],
  },
  {
    state: 'FUNDED',
    canisterTradeId: '2',
    amountSats: 250_000,
    milestones: [{ pctBps: 2_500, released: false }, { pctBps: 5_000, released: false }, { pctBps: 2_500, released: false }],
    settledBuyerBps: null,
    settledSellerBps: null,
    createdAtDaysAgo: 2,
    fundedDaysAgo: 1,
    timeoutDays: 14,
    events: [
      { kind: 'STATE_TRANSITION', message: 'trade created', hoursAgo: 50 },
      { kind: 'CHAIN_OBSERVATION', message: 'funding confirmed on-chain', hoursAgo: 26 },
    ],
  },
  {
    state: 'RELEASED',
    canisterTradeId: '3',
    amountSats: 100_000,
    milestones: [{ pctBps: 10_000, released: true }],
    settledBuyerBps: null,
    settledSellerBps: null,
    createdAtDaysAgo: 6,
    fundedDaysAgo: 5,
    timeoutDays: -1,
    events: [
      { kind: 'STATE_TRANSITION', message: 'trade created', hoursAgo: 144 },
      { kind: 'CHAIN_OBSERVATION', message: 'funding confirmed on-chain', hoursAgo: 120 },
      { kind: 'STATE_TRANSITION', message: 'milestone 0 released → RELEASED', hoursAgo: 96 },
    ],
  },
  {
    state: 'REFUNDED',
    canisterTradeId: '4',
    amountSats: 80_000,
    milestones: [{ pctBps: 10_000, released: false }],
    settledBuyerBps: null,
    settledSellerBps: null,
    createdAtDaysAgo: 12,
    fundedDaysAgo: 10,
    timeoutDays: -3,
    events: [
      { kind: 'STATE_TRANSITION', message: 'trade created', hoursAgo: 288 },
      { kind: 'CHAIN_OBSERVATION', message: 'funding confirmed on-chain', hoursAgo: 240 },
      { kind: 'STATE_TRANSITION', message: 'timeout refund claimed → REFUNDED', hoursAgo: 70 },
    ],
  },
  {
    state: 'DISPUTED',
    canisterTradeId: '5',
    amountSats: 400_000,
    milestones: [{ pctBps: 5_000, released: false }, { pctBps: 5_000, released: false }],
    settledBuyerBps: null,
    settledSellerBps: null,
    createdAtDaysAgo: 4,
    fundedDaysAgo: 3,
    timeoutDays: 5,
    events: [
      { kind: 'STATE_TRANSITION', message: 'trade created', hoursAgo: 96 },
      { kind: 'CHAIN_OBSERVATION', message: 'funding confirmed on-chain', hoursAgo: 72 },
      { kind: 'STATE_TRANSITION', message: 'dispute opened → DISPUTED', hoursAgo: 10 },
    ],
  },
  {
    state: 'DISPUTE_SETTLED',
    canisterTradeId: '6',
    amountSats: 300_000,
    milestones: [{ pctBps: 5_000, released: true }, { pctBps: 5_000, released: true }],
    settledBuyerBps: 6_000,
    settledSellerBps: 4_000,
    createdAtDaysAgo: 10,
    fundedDaysAgo: 8,
    timeoutDays: -2,
    events: [
      { kind: 'STATE_TRANSITION', message: 'trade created', hoursAgo: 240 },
      { kind: 'CHAIN_OBSERVATION', message: 'funding confirmed on-chain', hoursAgo: 192 },
      { kind: 'STATE_TRANSITION', message: 'dispute opened → DISPUTED', hoursAgo: 80 },
      { kind: 'STATE_TRANSITION', message: 'DAO verdict applied → DISPUTE_SETTLED (60/40)', hoursAgo: 60 },
    ],
  },
]

// Demo identity/contact snapshots, so the disputed trades render the frozen
// partner info (name, nip05, lightning address) the way the server captures it
// when a dispute opens. picture/banner stay null — real trades populate them
// from each party's synced Nostr kind:0 profile.
const BUYER_IDENTITY = {
  name: 'Demo Buyer',
  nip05: 'buyer@colabonate.local',
  picture: null,
  banner: null,
  lnAddress: 'seed-escrow-buyer@local',
  about: 'Local demo buyer identity for escrow UI testing.',
  capturedAt: new Date().toISOString(),
}
const SELLER_IDENTITY = {
  name: 'Demo Seller',
  nip05: 'seller@colabonate.local',
  picture: null,
  banner: null,
  lnAddress: 'seed-escrow-seller@local',
  about: 'Local demo seller identity for escrow UI testing.',
  capturedAt: new Date().toISOString(),
}

async function wipeFixtures() {
  await prisma.escrowTrade.deleteMany({
    where: {
      OR: [
        { buyerPubkey: { in: [BUYER_PUBKEY, SELLER_PUBKEY] } },
        { sellerPubkey: { in: [BUYER_PUBKEY, SELLER_PUBKEY] } },
      ],
    },
  })
  await prisma.session.deleteMany({ where: { pubkey: { in: [BUYER_PUBKEY, SELLER_PUBKEY] } } })
  await prisma.user.deleteMany({ where: { pubkey: { in: [BUYER_PUBKEY, SELLER_PUBKEY] } } })
}

async function createIdentities() {
  await prisma.user.createMany({
    data: [
      { pubkey: BUYER_PUBKEY, identityLevel: IDENTITY_LEVEL, lnAddress: 'seed-escrow-buyer@local', name: 'Demo Buyer', nip05: 'buyer@colabonate.local' },
      { pubkey: SELLER_PUBKEY, identityLevel: IDENTITY_LEVEL, lnAddress: 'seed-escrow-seller@local', name: 'Demo Seller', nip05: 'seller@colabonate.local' },
    ],
  })
  await prisma.session.create({
    data: { pubkey: BUYER_PUBKEY, k1: randomBytes(32).toString('hex'), token: TOKEN_BUYER, expiresAt: TOKEN_EXPIRY },
  })
  await prisma.session.create({
    data: { pubkey: SELLER_PUBKEY, k1: randomBytes(32).toString('hex'), token: TOKEN_SELLER, expiresAt: TOKEN_EXPIRY },
  })
}

async function createTrades() {
  const created: { id: string; state: string; canisterTradeId: string }[] = []
  for (const f of FIXTURES) {
    const trade = await prisma.escrowTrade.create({
      data: {
        canisterTradeId: f.canisterTradeId,
        canisterId: CANISTER_ID,
        network: 'ic',
        btcAddress: btcAddr(`funding-${f.canisterTradeId}`),
        buyerPubkey: BUYER_PUBKEY,
        sellerPubkey: SELLER_PUBKEY,
        buyerRefundAddress: btcAddr(`refund-${f.canisterTradeId}`),
        sellerPayoutAddress: btcAddr(`payout-${f.canisterTradeId}`),
        expectedAmountSats: f.amountSats,
        milestones: f.milestones as object,
        state: f.state,
        settledBuyerBps: f.settledBuyerBps,
        settledSellerBps: f.settledSellerBps,
        timeoutAt: nsAt(f.timeoutDays),
        fundedAt: f.fundedDaysAgo === null ? null : nsAt(-f.fundedDaysAgo),
        tradeTermsHash: termsHash(f.canisterTradeId),
        buyerIdentitySnapshot: BUYER_IDENTITY as object,
        sellerIdentitySnapshot: SELLER_IDENTITY as object,
        createdAt: daysAgo(f.createdAtDaysAgo),
      },
    })
    for (const ev of f.events) {
      await prisma.escrowTradeEvent.create({
        data: {
          tradeId: trade.id,
          kind: ev.kind,
          message: ev.message,
          detail: { state: f.state },
          createdAt: new Date(NOW_MS - ev.hoursAgo * 3600_000),
        },
      })
    }
    created.push({ id: trade.id, state: f.state, canisterTradeId: f.canisterTradeId })
  }
  return created
}

async function main() {
  console.log('▸ wiping previous fixtures…')
  await wipeFixtures()
  console.log('▸ creating demo buyer + seller identities…')
  await createIdentities()
  console.log('▸ creating six EscrowTrade fixtures (one per state) + timelines…')
  const created = await createTrades()

  const divider = '═'.repeat(72)
  console.log()
  console.log(divider)
  console.log('  ESCROW TRADE SEED — log in at http://localhost:5173/trade')
  console.log(divider)
  console.log('  Buyer view (sees all six states as the buyer):')
  console.log(`    localStorage.setItem('authToken', '${TOKEN_BUYER}')`)
  console.log(`    localStorage.setItem('pubkey',    '${BUYER_PUBKEY}')`)
  console.log()
  console.log('  Seller view (same trades, seller role):')
  console.log(`    localStorage.setItem('authToken', '${TOKEN_SELLER}')`)
  console.log(`    localStorage.setItem('pubkey',    '${SELLER_PUBKEY}')`)
  console.log(divider)
  console.log('  Created trades:')
  for (const t of created) {
    console.log(`    #${t.canisterTradeId}  ${t.state.padEnd(16)}  http://localhost:5173/trade/${t.id}`)
  }
  console.log(divider)
  console.log('  Notes:')
  console.log('  • Open http://localhost:5173/trade after pasting the block above (then reload).')
  console.log('  • The cockpit trust panel reports "Unverifiable" — that is the honest')
  console.log('    state; the seeded rows are view-only mirror records (ADR-355 D4).')
  console.log('  • Real create/fund/action needs a deployed canister — docs/escrow-ui/TESTING.md §4.')
  console.log(divider)
}

main()
  .catch((err) => {
    console.error('seed-escrow-trades failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
