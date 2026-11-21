// FU-252-E / Product-Launch Sub-Plan 01 §1.2 — proves the raised limiters
// (unauthenticatedLimiter 60->120/min, searchLimiter 120->240/min, 2026-09-05
// founder decision, revised same day after this script's own first run) hold
// up against a burst from several household members behind one shared/CGNAT
// IP, for BOTH anonymous and authenticated search traffic — and that both
// limiters still enforce a real ceiling (neither is accidentally disabled).
//
// Plain Node fetch, not k6 (k6 isn't installed on this dev machine and this
// scenario doesn't need k6's VU/ramp features — a tight loop from one Node
// process already originates from a single IP, which IS the CGNAT scenario
// these limiters care about; ponytail: no new dependency for one script).
//
// IMPORTANT: run each of the two exported scenarios in ITS OWN process
// invocation, in separate fixed-rate-limit-windows (60s+ apart) — the first
// draft of this script ran both scenarios back-to-back in one process and
// got contaminated results, because both limiters are IP-keyed and a Node
// process's outbound requests all share one source IP: the second
// scenario's counter started from wherever the first scenario left it in
// the same Redis fixed window, not from zero. This is exactly the
// discovery that changed the underlying product decision (see rate-limit.ts
// comments) — worth leaving documented here, not silently avoided.
//
// Run against a throwaway server:
//   APP_PORT=4098 npx tsx index.ts
//   BASE_URL=http://localhost:4098 SCENARIO=anon npx tsx scripts/load-test/search-limiter-shared-ip-test.ts
//   (wait 65s for the window to reset)
//   BASE_URL=http://localhost:4098 SCENARIO=auth npx tsx scripts/load-test/search-limiter-shared-ip-test.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4098'
const SCENARIO = process.env.SCENARIO === 'auth' ? 'auth' : 'anon'

async function fireBurst(n: number, headers: HeadersInit): Promise<number[]> {
  const statuses: number[] = []
  const waveSize = 20
  for (let i = 0; i < n; i += waveSize) {
    const wave = Math.min(waveSize, n - i)
    const results = await Promise.all(
      Array.from({ length: wave }, () => fetch(`${BASE_URL}/api/search?q=service&first=5`, { headers }).then(r => r.status)),
    )
    statuses.push(...results)
  }
  return statuses
}

function summarize(statuses: number[]) {
  const c200 = statuses.filter(s => s === 200).length
  const c429 = statuses.filter(s => s === 429).length
  const firstRejectIndex = statuses.findIndex(s => s === 429)
  return { c200, c429, firstRejectAt: firstRejectIndex === -1 ? null : firstRejectIndex + 1 }
}

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d?: unknown) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'} ${n}`, ok ? '' : JSON.stringify(d)) }

async function runAnonScenario() {
  // unauthenticatedLimiter is now 120/min. 100 requests (below the ceiling)
  // should all pass; 40 more on top should start 429ing well before 160.
  console.log('[anon] firing 100 anonymous search requests (below the 120/min ceiling)...')
  const under = await fireBurst(100, {})
  const underSummary = summarize(under)
  check('[anon] 100 requests under the 120/min ceiling all succeed', underSummary.c200 === 100 && underSummary.c429 === 0, underSummary)

  console.log('[anon] firing 40 more to push past 120 total...')
  const over = await fireBurst(40, {})
  const overSummary = summarize(over)
  check('[anon] pushing past 120 total DOES start 429ing (limiter still real)', overSummary.c429 > 0, overSummary)
}

async function runAuthScenario() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const pubkey = randomBytes(32).toString('hex')
  const token = randomBytes(32).toString('hex')
  await prisma.user.create({ data: { pubkey, identityLevel: 2 } })
  await prisma.session.create({ data: { pubkey, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 600_000) } })
  const H = { Authorization: `Bearer ${token}` }
  try {
    // authenticatedLimiter is 300/min (not the binding constraint here);
    // searchLimiter is 240/min and IS the ceiling for authenticated search.
    console.log('[auth] firing 220 authenticated search requests (below the 240/min ceiling)...')
    const under = await fireBurst(220, H)
    const underSummary = summarize(under)
    check('[auth] 220 requests under the 240/min searchLimiter ceiling all succeed', underSummary.c200 === 220 && underSummary.c429 === 0, underSummary)

    console.log('[auth] firing 40 more to push past 240 total...')
    const over = await fireBurst(40, H)
    const overSummary = summarize(over)
    check('[auth] pushing past 240 total DOES start 429ing (limiter still real)', overSummary.c429 > 0, overSummary)
  } finally {
    await prisma.session.deleteMany({ where: { pubkey } })
    await prisma.user.deleteMany({ where: { pubkey } })
    await prisma.$disconnect()
  }
}

async function main() {
  if (SCENARIO === 'anon') await runAnonScenario()
  else await runAuthScenario()
  console.log(`[${SCENARIO}] ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
