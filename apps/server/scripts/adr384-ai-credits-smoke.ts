// ADR-384 live smoke test: AI credit packs (purchase -> confirm -> reserve/refund).
// Mechanics test — decoupled from the production pricing by pinning a tiny
// 5-request starter tier (the pack sizes were recalibrated 2026-09-23 to
// 250/300/700; the concurrency assertions below depend on 5).
// Run against a throwaway server (own port) with BETA_MODE=true (DEMO rail) and
// AI_INTERNAL_SECRET set on BOTH server and this script:
//   AI_INTERNAL_SECRET=smoke-secret BETA_MODE=true APP_PORT=4098 \
//     AI_CREDIT_PACK_TIERS='[{"id":"starter","requests":5,"priceSats":2600}]' npx tsx apps/server/index.ts
//   DATABASE_URL=postgresql://colabonate:dev@localhost:5434/colabonate BASE_URL=http://localhost:4098 \
//     AI_INTERNAL_SECRET=smoke-secret npx tsx apps/server/scripts/adr384-ai-credits-smoke.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4001'
const SECRET = process.env.AI_INTERNAL_SECRET || ''
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, detail ?? '') }
}

// EXPECT_HOSTED=false: run against a server started WITHOUT AI_HOSTED_ENABLED and
// verify the hard gate (no sales, flag reported false, existing flows untouched).
async function gateMode() {
  const pubkey = randomBytes(32).toString('hex')
  const token = randomBytes(32).toString('hex')
  const guestsBefore = await prisma.aiGuestCredit.count()
  await prisma.user.create({ data: { pubkey, identityLevel: 2 } })
  await prisma.session.create({ data: { pubkey, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 3600_000) } })
  try {
    const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    let r = await fetch(`${BASE_URL}/api/ai/credits`, { headers: H })
    let b = await r.json() as Record<string, unknown>
    check('gate: GET reports hostedEnabled=false', r.status === 200 && b.hostedEnabled === false, b)
    r = await fetch(`${BASE_URL}/api/ai/credits/purchase`, { method: 'POST', headers: H, body: JSON.stringify({ tier: 'starter' }) })
    b = await r.json() as Record<string, unknown>
    check('gate: purchase -> 503 AI_HOSTED_NOT_ENABLED', r.status === 503 && b.error === 'AI_HOSTED_NOT_ENABLED', b)
    r = await fetch(`${BASE_URL}/api/ai/credits/guest`)
    b = await r.json() as Record<string, unknown>
    check('gate: guest GET reports hostedEnabled=false', r.status === 200 && b.hostedEnabled === false, b)
    r = await fetch(`${BASE_URL}/api/ai/credits/guest/purchase`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier: 'starter' }) })
    b = await r.json() as Record<string, unknown>
    check('gate: guest purchase -> 503 AI_HOSTED_NOT_ENABLED', r.status === 503 && b.error === 'AI_HOSTED_NOT_ENABLED', b)
    const guestsAfter = await prisma.aiGuestCredit.count()
    check('gate: a blocked guest purchase created no guest session', guestsAfter === guestsBefore, { guestsBefore, guestsAfter })
  } finally {
    await prisma.session.deleteMany({ where: { pubkey } })
    await prisma.user.deleteMany({ where: { pubkey } })
    await prisma.$disconnect()
  }
  console.log(`
${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

async function main() {
  if (process.env.EXPECT_HOSTED === 'false') return gateMode()
  if (!SECRET) throw new Error('AI_INTERNAL_SECRET must be set for the smoke')
  const pubkey = randomBytes(32).toString('hex')
  const otherPubkey = randomBytes(32).toString('hex')
  const token = randomBytes(32).toString('hex')
  const otherToken = randomBytes(32).toString('hex')

  const user = await prisma.user.create({ data: { pubkey, identityLevel: 2 } })
  const other = await prisma.user.create({ data: { pubkey: otherPubkey, identityLevel: 2 } })
  await prisma.wallet.create({ data: { userId: user.id, provider: 'DEMO', mode: 'NON_CUSTODIAL', balanceSats: 1_500 } })
  await prisma.wallet.create({ data: { userId: other.id, provider: 'DEMO', mode: 'NON_CUSTODIAL', balanceSats: 0 } })
  for (const [pk, tk] of [[pubkey, token], [otherPubkey, otherToken]]) {
    await prisma.session.create({ data: { pubkey: pk, k1: randomUUID(), token: tk, expiresAt: new Date(Date.now() + 3600_000) } })
  }
  const h = (t: string, extra: Record<string, string> = {}) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}`, ...extra })
  const internal = { 'x-ai-internal-secret': SECRET }
  let createdGuestId: string | null = null
  const call = async (path: string, t: string, init: RequestInit = {}, extra: Record<string, string> = {}) => {
    const r = await fetch(`${BASE_URL}/api/ai/credits${path}`, { ...init, headers: h(t, extra) })
    return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, unknown> }
  }

  try {
    let r = await call('', token)
    check('GET / -> 0 credits, 3 tiers', r.status === 200 && r.body.requestsRemaining === 0 && (r.body.tiers as unknown[]).length === 3, r.body)

    r = await call('/purchase', token, { method: 'POST', body: JSON.stringify({ tier: 'bogus' }) })
    check('purchase unknown tier -> 400', r.status === 400, r.body)

    r = await call('/reserve', token, { method: 'POST' })
    check('reserve without internal secret -> 403', r.status === 403, r.body)
    r = await call('/reserve', token, { method: 'POST' }, internal)
    check('reserve with 0 credits -> 409 AI_CREDITS_EXHAUSTED', r.status === 409 && r.body.error === 'AI_CREDITS_EXHAUSTED', r.body)

    r = await call('/purchase', token, { method: 'POST', body: JSON.stringify({ tier: 'starter' }) })
    check('purchase starter -> 201 DEMO rail (beta)', r.status === 201 && r.body.rail === 'DEMO' && r.body.amountSats === 1000 && r.body.requests === 5, r.body)
    const purchaseId = r.body.id as string

    r = await call(`/purchase/${purchaseId}/confirm`, otherToken, { method: 'POST', body: '{}' })
    check('confirm by another user -> 404 (ownership)', r.status === 404, r.body)

    // Two concurrent confirms must credit exactly once.
    const [c1, c2] = await Promise.all([
      call(`/purchase/${purchaseId}/confirm`, token, { method: 'POST', body: '{}' }),
      call(`/purchase/${purchaseId}/confirm`, token, { method: 'POST', body: '{}' }),
    ])
    check('concurrent confirms both 200', c1.status === 200 && c2.status === 200, [c1.body, c2.body])
    check('exactly one confirm credited (not alreadyPaid)', [c1, c2].filter((c) => c.body.alreadyPaid === false).length === 1, [c1.body, c2.body])
    r = await call('', token)
    check('balance = 5 after double-confirm', r.body.requestsRemaining === 5, r.body)
    const wallet = await prisma.wallet.findFirst({ where: { userId: user.id, provider: 'DEMO' } })
    check('demo wallet debited exactly once (1500 -> 500)', wallet?.balanceSats === 500, wallet?.balanceSats)

    // Second pack cannot be paid: demo balance 500 < 1000 -> 402, and stays PENDING.
    r = await call('/purchase', token, { method: 'POST', body: JSON.stringify({ tier: 'starter' }) })
    const p2 = r.body.id as string
    r = await call(`/purchase/${p2}/confirm`, token, { method: 'POST', body: '{}' })
    check('confirm with short demo balance -> 402', r.status === 402 && r.body.error === 'DEMO_BALANCE_EXHAUSTED', r.body)
    const p2row = await prisma.aiCreditPurchase.findUnique({ where: { id: p2 } })
    check('failed confirm reverts purchase to PENDING', p2row?.status === 'PENDING', p2row?.status)
    r = await call('', token)
    check('balance unchanged after failed confirm', r.body.requestsRemaining === 5, r.body)

    // Concurrent reserves: 8 in parallel against 5 credits -> exactly 5 win.
    const results = await Promise.all(Array.from({ length: 8 }, () => call('/reserve', token, { method: 'POST' }, internal)))
    check('8 concurrent reserves: exactly 5 ok, 3 exhausted', results.filter((x) => x.status === 200).length === 5 && results.filter((x) => x.status === 409).length === 3, results.map((x) => x.status))
    r = await call('', token)
    check('balance 0, used 5', r.body.requestsRemaining === 0 && r.body.requestsUsed === 5, r.body)

    r = await call('/refund', token, { method: 'POST' }, internal)
    check('refund -> ok, balance 1', r.body.ok === true, r.body)
    r = await call('', token)
    check('balance 1 after refund', r.body.requestsRemaining === 1 && r.body.requestsUsed === 4, r.body)
    r = await call('/refund', otherToken, { method: 'POST' }, internal)
    check('refund cannot mint credits for a user with no usage', r.body.ok === false, r.body)

    // ── D10 guest session credits (no auth header anywhere) ──
    const g = async (path: string, init: RequestInit = {}, extra: Record<string, string> = {}) => {
      const rr = await fetch(`${BASE_URL}/api/ai/credits/guest${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...extra } })
      return { status: rr.status, body: await rr.json().catch(() => ({})) as Record<string, unknown> }
    }
    let gr = await g('')
    check('guest GET without id -> 0 credits + tiers, no auth', gr.status === 200 && gr.body.requestsRemaining === 0 && (gr.body.tiers as unknown[]).length === 3, gr.body)
    gr = await g('/purchase', { method: 'POST', body: JSON.stringify({ tier: 'nope' }) })
    check('guest purchase unknown tier -> 400', gr.status === 400, gr.body)
    gr = await g('/purchase', { method: 'POST', body: JSON.stringify({ tier: 'starter', guestSessionId: 'x'.repeat(64) }) })
    check('guest purchase with malformed id -> 400', gr.status === 400, gr.body)
    gr = await g('/purchase', { method: 'POST', body: JSON.stringify({ tier: 'starter', guestSessionId: 'a'.repeat(64) }) })
    check('guest purchase with unknown well-formed id -> 404 (no session minting by guessing)', gr.status === 404, gr.body)

    gr = await g('/purchase', { method: 'POST', body: JSON.stringify({ tier: 'starter' }) })
    const guestId = gr.body.guestSessionId as string
    const gPurchase = gr.body.id as string
    check('guest purchase mints a 64-hex session id (DEMO rail)', gr.status === 201 && /^[0-9a-f]{64}$/.test(guestId) && gr.body.rail === 'DEMO', gr.body)

    gr = await g(`/purchase/${gPurchase}/confirm`, { method: 'POST', body: JSON.stringify({ guestSessionId: 'b'.repeat(64) }) })
    check('confirm with a different guest id -> 404', gr.status === 404, gr.body)
    const [gc1, gc2] = await Promise.all([
      g(`/purchase/${gPurchase}/confirm`, { method: 'POST', body: JSON.stringify({ guestSessionId: guestId }) }),
      g(`/purchase/${gPurchase}/confirm`, { method: 'POST', body: JSON.stringify({ guestSessionId: guestId }) }),
    ])
    check('guest concurrent confirms credit exactly once', [gc1, gc2].filter((c) => c.body.alreadyPaid === false).length === 1, [gc1.body, gc2.body])
    gr = await g(`?guestSessionId=${guestId}`)
    check('guest balance = 5', gr.body.requestsRemaining === 5, gr.body)

    gr = await g('/reserve', { method: 'POST', body: JSON.stringify({ guestSessionId: guestId }) })
    check('guest reserve without internal secret -> 403', gr.status === 403, gr.body)
    const gres = await Promise.all(Array.from({ length: 8 }, () => g('/reserve', { method: 'POST', body: JSON.stringify({ guestSessionId: guestId }) }, internal)))
    check('8 concurrent guest reserves: exactly 5 ok, 3 exhausted', gres.filter((x) => x.status === 200).length === 5 && gres.filter((x) => x.status === 409).length === 3, gres.map((x) => x.status))
    gr = await g('/refund', { method: 'POST', body: JSON.stringify({ guestSessionId: guestId }) }, internal)
    check('guest refund -> ok', gr.body.ok === true, gr.body)
    gr = await g(`?guestSessionId=${guestId}`)
    check('guest balance 1 after refund', gr.body.requestsRemaining === 1, gr.body)
    // A guest id can never reach an authenticated user's balance.
    const userBal = await call('', token)
    check('guest activity did not touch the authed balance', userBal.body.requestsRemaining === 1 && userBal.body.requestsUsed === 4, userBal.body)
    createdGuestId = guestId
  } finally {
    if (createdGuestId) {
      await prisma.aiCreditPurchase.deleteMany({ where: { guestSessionId: createdGuestId } })
      await prisma.aiGuestCredit.deleteMany({ where: { guestSessionId: createdGuestId } })
    }
    await prisma.aiCreditPurchase.deleteMany({ where: { pubkey: { in: [pubkey, otherPubkey] } } })
    await prisma.aiCreditBalance.deleteMany({ where: { pubkey: { in: [pubkey, otherPubkey] } } })
    await prisma.session.deleteMany({ where: { pubkey: { in: [pubkey, otherPubkey] } } })
    await prisma.wallet.deleteMany({ where: { userId: { in: [user.id, other.id] } } })
    await prisma.user.deleteMany({ where: { pubkey: { in: [pubkey, otherPubkey] } } })
    await prisma.$disconnect()
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
