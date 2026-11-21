/**
 * ADR-164 / PROB-003 B-α wiring — HTTP smoke test against the live :4001 server.
 *
 * Verifies the route-level wiring (the actual change in index.ts), not just the
 * service: that PRIVATE offer creation triggers sub-wallet provisioning when the
 * owner's strategy resolves to CUSTODIAL, and that PUBLIC offers + NONCUSTODIAL
 * owners are left alone. Provisioning is best-effort fire-and-forget after
 * res.json, so we poll the DB for the written lightningSubWalletId.
 *
 * Prereq: dev server running on :4001 (npx pnpm dev:server). In dev the LNBits
 * provider runs isMock=true (no LNBITS_ADMIN_KEY), so createSubWallet returns a
 * `mock-subwallet-*` id deterministically — no external LNBits dependency.
 *
 * Run:
 *   cd apps/server && DATABASE_URL="postgresql://colabonate:dev@localhost:5434/colabonate" \
 *     ../../apps/colabonate-app/node_modules/.bin/tsx scripts/phase8-ba-wiring-smoke-test.ts
 */
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { createHash } from 'node:crypto'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const BASE = process.env.APP_URL || 'http://localhost:4001'
const RUN = `ba-${Date.now()}`
const hex = (seed: string) => createHash('sha256').update(`${RUN}-${seed}`).digest('hex')

const A_PUBKEY = hex('hybrid-user') // HYBRID  → PRIVATE resolves CUSTODIAL → provisions
const B_PUBKEY = hex('noncust-user') // NONCUSTODIAL_ONLY → PRIVATE resolves NON_CUSTODIAL → skips

const createdOfferIds: string[] = []
const createdUserPubkeys: string[] = []
const tokenA = `${RUN}-tok-a`
const tokenB = `${RUN}-tok-b`

let assertions = 0
let failures = 0
function assert(cond: boolean, msg: string): void {
  assertions++
  if (cond) console.log(`   ✓ ${msg}`)
  else {
    failures++
    console.error(`   ✗ ${msg}`)
  }
}

async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 3000, intervalMs = 150): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const v = await fn()
    if (v) return v
    await new Promise(r => setTimeout(r, intervalMs))
  }
  return null
}

async function createAuthedUser(pubkey: string, strategy: 'HYBRID' | 'NONCUSTODIAL_ONLY', token: string): Promise<void> {
  await prisma.user.upsert({
    where: { pubkey },
    update: { walletModeStrategy: strategy },
    create: { pubkey, walletModeStrategy: strategy },
  })
  createdUserPubkeys.push(pubkey)
  await prisma.session.create({
    data: {
      pubkey,
      k1: `${RUN}-k1-${pubkey.slice(0, 8)}`,
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  })
}

async function postOffer(token: string, visibility: 'PRIVATE' | 'PUBLIC'): Promise<string> {
  const res = await fetch(`${BASE}/api/offers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: `[SMOKE ${RUN}] ${visibility} offer`,
      priceSats: 1000,
      categoryCode: 'goods',
      offerType: 'PRODUCT',
      ticketType: 'SMART_ORDER',
      status: 'DRAFT',
      visibility,
    }),
  })
  if (!res.ok) throw new Error(`POST /api/offers ${visibility} failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { offer: { id: string } }
  createdOfferIds.push(json.offer.id)
  return json.offer.id
}

async function getSubWalletId(offerId: string): Promise<string | null> {
  const o = await prisma.offer.findUnique({ where: { id: offerId }, select: { lightningSubWalletId: true } })
  return o?.lightningSubWalletId ?? null
}

async function main() {
  console.log('=== ADR-164 / B-α Wiring HTTP Smoke Test ===\n')

  console.log('1) Setup: User A (HYBRID) + User B (NONCUSTODIAL_ONLY), each with a Session...')
  await createAuthedUser(A_PUBKEY, 'HYBRID', tokenA)
  await createAuthedUser(B_PUBKEY, 'NONCUSTODIAL_ONLY', tokenB)
  console.log(`   A=${A_PUBKEY.slice(0, 8)}… (HYBRID)  B=${B_PUBKEY.slice(0, 8)}… (NONCUSTODIAL_ONLY)`)

  console.log('\n2) A creates a PRIVATE offer → should provision an isolated sub-wallet (B-α)...')
  const privateOfferId = await postOffer(tokenA, 'PRIVATE')
  console.log(`   created offer ${privateOfferId}; polling for fire-and-forget provisioning...`)
  const provisionedId = await waitFor(() => getSubWalletId(privateOfferId))
  assert(!!provisionedId, `PRIVATE offer got a lightningSubWalletId (got ${provisionedId ?? 'NULL'})`)
  assert(
    !!provisionedId && provisionedId.startsWith('mock-subwallet-'),
    `provisioned id is a real provider-issued id (mock in dev): ${provisionedId}`,
  )

  console.log('\n3) A creates a PUBLIC offer → must NOT provision a sub-wallet...')
  const publicOfferId = await postOffer(tokenA, 'PUBLIC')
  // give the fire-and-forget path a moment, then confirm it stayed null
  await new Promise(r => setTimeout(r, 600))
  const publicId = await getSubWalletId(publicOfferId)
  assert(publicId === null, `PUBLIC offer has no lightningSubWalletId (got ${publicId ?? 'NULL'})`)

  console.log('\n4) B (NONCUSTODIAL_ONLY) creates a PRIVATE offer → strategy skips B-α isolation...')
  const nonCustPrivateId = await postOffer(tokenB, 'PRIVATE')
  await new Promise(r => setTimeout(r, 600))
  const nonCustId = await getSubWalletId(nonCustPrivateId)
  assert(nonCustId === null, `NONCUSTODIAL_ONLY PRIVATE offer has no sub-wallet (got ${nonCustId ?? 'NULL'})`)

  console.log(`\n=== ${assertions} assertions, ${failures} failures ===`)
  if (failures > 0) {
    console.error('❌ B-α wiring smoke FAILED')
    process.exitCode = 1
  } else {
    console.log('✅ ADR-164 / B-α sub-wallet wiring verified end-to-end')
  }
}

main()
  .catch(err => {
    console.error('Smoke test crashed:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    // cleanup
    try {
      await prisma.offer.deleteMany({ where: { id: { in: createdOfferIds } } }).catch(() => {})
      await prisma.session.deleteMany({ where: { token: { in: [tokenA, tokenB] } } }).catch(() => {})
      await prisma.user.deleteMany({ where: { pubkey: { in: createdUserPubkeys } } }).catch(() => {})
    } finally {
      await pool.end()
    }
  })
