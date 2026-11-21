// ADR-410 live smoke: single lifetime MCP pass at the lowest tier price.
// Needs a throwaway server with BETA_MODE=true (DEMO rail, paywall active):
//   BETA_MODE=true APP_PORT=4098 npx tsx apps/server/index.ts
//   DATABASE_URL=postgresql://colabonate:dev@localhost:5434/colabonate BASE_URL=http://localhost:4098 \
//     npx tsx apps/server/scripts/adr410-mcp-lifetime-smoke.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4001'
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, detail ?? '') }
}

async function mkUser(balance: number) {
  const pubkey = randomBytes(32).toString('hex')
  const token = randomBytes(32).toString('hex')
  const user = await prisma.user.create({ data: { pubkey, identityLevel: 2 } })
  await prisma.wallet.create({ data: { userId: user.id, provider: 'DEMO', mode: 'NON_CUSTODIAL', balanceSats: balance } })
  await prisma.session.create({ data: { pubkey, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 3600_000) } })
  return { pubkey, token, userId: user.id }
}

async function main() {
  const a = await mkUser(10_000) // lifetime (2600) + a legacy day confirm (2600) + margin
  const call = async (u: { token: string }, method: string, path: string, body?: unknown) => {
    const r = await fetch(`${BASE_URL}/api/mcp${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u.token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }
  }
  const pubkeys = [a.pubkey]

  try {
    // ── pricing shape: single lifetime tier at the floor ──
    let r = await call(a, 'GET', '/access')
    check('access: paywall active, trial available', r.body.paywallActive === true && r.body.trialAvailable === true, r.body)
    check('access: single lifetime tier at 2600 sats (hours null)', r.body.passes?.length === 1 && r.body.passes[0]?.id === 'lifetime' && r.body.passes[0]?.hours === null && r.body.passes[0]?.priceSats === 2600, r.body.passes)

    // ── trial funnel unchanged ──
    r = await call(a, 'POST', '/connect', { scopes: [] })
    check('first connect -> 201 trial', r.status === 201 && r.body.passTier === 'trial', r.body)
    r = await call(a, 'POST', '/connect', { scopes: [] })
    check('second connect -> 402 with lifetime wording', r.status === 402 && r.body.error === 'TRIAL_ALREADY_USED' && /lifetime/i.test(r.body.message ?? ''), r.body)

    // ── legacy tiers are not sold anymore ──
    r = await call(a, 'POST', '/passes/purchase', { tier: 'bogus' })
    check('purchase unknown tier -> 400', r.status === 400, r.body)
    r = await call(a, 'POST', '/passes/purchase', { tier: 'day' })
    check('purchase legacy day tier -> 400 (ADR-410 D4)', r.status === 400, r.body)

    // ── lifetime purchase / confirm ──
    r = await call(a, 'POST', '/passes/purchase', { tier: 'lifetime' })
    const lifeId = r.body.id as string
    check('purchase lifetime -> 201 DEMO 2600 sats', r.status === 201 && r.body.rail === 'DEMO' && r.body.amountSats === 2600, r.body)
    r = await call(a, 'POST', `/passes/${lifeId}/confirm`, {})
    check('confirm lifetime -> success', r.body.success === true, r.body)
    r = await call(a, 'GET', '/access')
    check('activePass: lifetime true, expiresAt null', r.body.activePass?.tier === 'lifetime' && r.body.activePass?.lifetime === true && r.body.activePass?.expiresAt === null, r.body.activePass)

    // ── double purchase guard ──
    r = await call(a, 'POST', '/passes/purchase', { tier: 'lifetime' })
    check('second lifetime purchase -> 409 LIFETIME_ALREADY_ACTIVE', r.status === 409 && r.body.error === 'LIFETIME_ALREADY_ACTIVE', r.body)

    // ── connect with lifetime pass: bounded ~366d connection ──
    r = await call(a, 'POST', '/connect', { scopes: [] })
    check('connect with lifetime pass -> 201 tier lifetime', r.status === 201 && r.body.passTier === 'lifetime', r.body)
    const conns = await call(a, 'GET', '/connections')
    const lifeConn = conns.body.connections?.find((x: any) => x.passTier === 'lifetime')
    const days = lifeConn ? (new Date(lifeConn.expiresAt).getTime() - Date.now()) / 86_400_000 : -1
    check('lifetime connection bounded to about 366 days', days > 364 && days <= 366.1, days)

    // ── legacy PENDING day row (bought before the switch) still confirms ──
    const legacy = await prisma.mcpAccessPass.create({
      data: { pubkey: a.pubkey, tier: 'day', amountSats: 2600, rail: 'DEMO' },
    })
    r = await call(a, 'POST', `/passes/${legacy.id}/confirm`, {})
    check('legacy pending day pass confirms (no TIER_UNAVAILABLE 500)', r.body.success === true, r.body)
    const legacyRow = await prisma.mcpAccessPass.findUnique({ where: { id: legacy.id } })
    const legacyDays = legacyRow?.expiresAt ? (new Date(legacyRow.expiresAt).getTime() - Date.now()) / 86_400_000 : -1
    check('legacy day pass activated with ~24h expiry', legacyRow?.status === 'PAID' && legacyDays > 0.99 && legacyDays <= 1.01, legacyDays)

    // ── lifetime outranks a concurrent dated pass ──
    r = await call(a, 'GET', '/access')
    check('lifetime wins over the dated pass', r.body.activePass?.lifetime === true && r.body.activePass?.expiresAt === null, r.body.activePass)

    // ── DEMO ledger debited exactly twice (lifetime + legacy day) ──
    const wallet = await prisma.wallet.findFirst({ where: { userId: a.userId, provider: 'DEMO' } })
    check('demo wallet debited 10000 -> 4800', wallet?.balanceSats === 4800, wallet?.balanceSats)
  } finally {
    await prisma.mcpConnection.deleteMany({ where: { pubkey: { in: pubkeys } } })
    await prisma.mcpAccessPass.deleteMany({ where: { pubkey: { in: pubkeys } } })
    await prisma.mcpTrial.deleteMany({ where: { pubkey: { in: pubkeys } } })
    await prisma.session.deleteMany({ where: { pubkey: { in: pubkeys } } })
    await prisma.wallet.deleteMany({ where: { userId: { in: [a.userId] } } })
    await prisma.user.deleteMany({ where: { pubkey: { in: pubkeys } } })
    await prisma.$disconnect()
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
