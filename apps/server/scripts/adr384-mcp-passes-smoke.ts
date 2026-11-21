// ADR-384 D11 live smoke: MCP one-time trial + dated pass stacking. Since
// ADR-410 the DEFAULT ladder is a single lifetime tier, so this smoke must run
// against a throwaway server with an explicit dated ladder override:
//   BETA_MODE=true APP_PORT=4098 MCP_PASS_TIERS='[{"id":"day","hours":24,"priceSats":2600},{"id":"week","hours":168,"priceSats":7000}]' npx tsx apps/server/index.ts
//   DATABASE_URL=postgresql://colabonate:dev@localhost:5434/colabonate BASE_URL=http://localhost:4098 \
//     npx tsx apps/server/scripts/adr384-mcp-passes-smoke.ts
// (The lifetime model itself is covered by adr410-mcp-lifetime-smoke.ts.)
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
  const a = await mkUser(3000) // enough for one day pass (2600), not for a week (7000)
  const b = await mkUser(20_000)
  const c = await mkUser(0) // fresh user for the concurrent-trial race
  const call = async (u: { token: string }, method: string, path: string, body?: unknown) => {
    const r = await fetch(`${BASE_URL}/api/mcp${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u.token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, any> }
  }
  const pubkeys = [a.pubkey, b.pubkey, c.pubkey]

  try {
    let r = await call(a, 'GET', '/access')
    check('access: paywall active, trial available, 2 env passes', r.body.paywallActive === true && r.body.trialAvailable === true && r.body.passes?.length === 2, r.body)

    // ── one-time trial ──
    r = await call(a, 'POST', '/connect', { scopes: [] })
    check('first connect -> 201 trial', r.status === 201 && r.body.passTier === 'trial', r.body)
    let conns = await call(a, 'GET', '/connections')
    const trialConn = conns.body.connections?.[0]
    const mins = trialConn ? (new Date(trialConn.expiresAt).getTime() - Date.now()) / 60000 : -1
    check('trial connection lives about 30 minutes', mins > 28 && mins <= 30.1 && trialConn.passTier === 'trial', mins)
    r = await call(a, 'POST', '/connect', { scopes: [] })
    check('second connect without a pass -> 402 TRIAL_ALREADY_USED', r.status === 402 && r.body.error === 'TRIAL_ALREADY_USED', r.body)
    r = await call(a, 'GET', '/access')
    check('access: trial no longer available', r.body.trialAvailable === false, r.body)

    const race = await Promise.all([call(c, 'POST', '/connect', { scopes: [] }), call(c, 'POST', '/connect', { scopes: [] })])
    check('concurrent first connects: exactly one trial granted', race.filter((x) => x.status === 201).length === 1 && race.filter((x) => x.status === 402).length === 1, race.map((x) => x.status))

    // ── passes ──
    r = await call(a, 'POST', '/passes/purchase', { tier: 'bogus' })
    check('purchase unknown tier -> 400', r.status === 400, r.body)
    r = await call(a, 'POST', '/passes/purchase', { tier: 'day' })
    const dayId = r.body.id as string
    check('purchase day -> 201 DEMO 2600 sats', r.status === 201 && r.body.rail === 'DEMO' && r.body.amountSats === 2600, r.body)
    r = await call(b, 'POST', `/passes/${dayId}/confirm`, {})
    check('confirm by another user -> 404', r.status === 404, r.body)
    const [c1, c2] = await Promise.all([call(a, 'POST', `/passes/${dayId}/confirm`, {}), call(a, 'POST', `/passes/${dayId}/confirm`, {})])
    check('concurrent confirms activate exactly once', [c1, c2].filter((x) => x.body.alreadyPaid === false).length === 1, [c1.body, c2.body])
    const wallet = await prisma.wallet.findFirst({ where: { userId: a.userId, provider: 'DEMO' } })
    check('demo wallet debited exactly once (3000 -> 400)', wallet?.balanceSats === 400, wallet?.balanceSats)
    r = await call(a, 'GET', '/access')
    const dayExp = new Date(r.body.activePass?.expiresAt).getTime()
    check('active day pass, about 24h out', r.body.activePass?.tier === 'day' && Math.abs(dayExp - Date.now() - 24 * 3600_000) < 60_000, r.body.activePass)

    r = await call(a, 'POST', '/connect', { scopes: [] })
    check('connect with active pass -> 201 tier day', r.status === 201 && r.body.passTier === 'day', r.body)
    conns = await call(a, 'GET', '/connections')
    const passConn = conns.body.connections?.find((x: any) => x.passTier === 'day')
    check('pass connection expires with the pass', passConn && Math.abs(new Date(passConn.expiresAt).getTime() - dayExp) < 5000, passConn)

    r = await call(a, 'POST', '/passes/purchase', { tier: 'week' })
    const weekId = r.body.id as string
    r = await call(a, 'POST', `/passes/${weekId}/confirm`, {})
    check('week pass with too little demo balance -> 402', r.status === 402 && r.body.error === 'DEMO_BALANCE_EXHAUSTED', r.body)
    const weekRow = await prisma.mcpAccessPass.findUnique({ where: { id: weekId } })
    check('failed confirm reverts the pass to PENDING (no expiry)', weekRow?.status === 'PENDING' && weekRow.expiresAt === null, weekRow)

    // b buys day then week: second extends the first instead of overlapping
    r = await call(b, 'POST', '/passes/purchase', { tier: 'day' })
    await call(b, 'POST', `/passes/${r.body.id}/confirm`, {})
    const first = (await call(b, 'GET', '/access')).body.activePass
    r = await call(b, 'POST', '/passes/purchase', { tier: 'week' })
    await call(b, 'POST', `/passes/${r.body.id}/confirm`, {})
    const second = (await call(b, 'GET', '/access')).body.activePass
    const gain = new Date(second.expiresAt).getTime() - new Date(first.expiresAt).getTime()
    check('a second pass extends the active one by its full duration', Math.abs(gain - 7 * 24 * 3600_000) < 5000, gain)
  } finally {
    await prisma.mcpConnection.deleteMany({ where: { pubkey: { in: pubkeys } } })
    await prisma.mcpAccessPass.deleteMany({ where: { pubkey: { in: pubkeys } } })
    await prisma.mcpTrial.deleteMany({ where: { pubkey: { in: pubkeys } } })
    await prisma.session.deleteMany({ where: { pubkey: { in: pubkeys } } })
    await prisma.wallet.deleteMany({ where: { userId: { in: [a.userId, b.userId, c.userId] } } })
    await prisma.user.deleteMany({ where: { pubkey: { in: pubkeys } } })
    await prisma.$disconnect()
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
