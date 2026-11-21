// Gate G8 (ADR-252 D2) kill-switch drill probe.
//
// Mints a throwaway user + session, calls money-creating routes with an
// authenticated request, and asserts whether the PAYMENTS_PAUSED switch is
// active. Auth runs before the kill switch on these routes, so an anonymous
// curl always gets 401 and proves nothing — this probe is the real check.
// Cleans up its own rows; no money moves (bodies are empty/invalid).
//
// Run inside the production server container:
//   docker compose -f docker-compose.production.yml --env-file .env.production \
//     exec -T -e EXPECT=paused server npx tsx apps/server/scripts/g8-kill-switch-probe.ts
// EXPECT=paused → every route must answer 503 PAYMENTS_PAUSED
// EXPECT=open   → no route may answer 503 PAYMENTS_PAUSED
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4001'
const EXPECT = process.env.EXPECT
if (EXPECT !== 'paused' && EXPECT !== 'open') {
  console.error('Set EXPECT=paused or EXPECT=open')
  process.exit(2)
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const ROUTES = [
  '/api/tickets',
  '/api/cooperations/g8-drill-nonexistent/fund-escrow',
]

async function main() {
  const pubkey = randomBytes(32).toString('hex')
  const token = randomBytes(32).toString('hex')
  let fail = 0
  await prisma.user.create({ data: { pubkey } })
  try {
    await prisma.session.create({ data: { pubkey, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 300_000) } })
    for (const route of ROUTES) {
      const res = await fetch(`${BASE_URL}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: '{}',
      })
      const body = await res.json().catch(() => ({})) as { error?: string }
      const paused = res.status === 503 && body.error === 'PAYMENTS_PAUSED'
      const ok = EXPECT === 'paused' ? paused : !paused
      if (!ok) fail++
      console.log(`  ${ok ? 'PASS' : 'FAIL'} POST ${route} -> ${res.status} ${body.error ?? ''}`)
    }
  } finally {
    await prisma.session.deleteMany({ where: { pubkey } })
    await prisma.user.deleteMany({ where: { pubkey } })
    await prisma.$disconnect()
  }
  console.log(`EXPECT=${EXPECT}: ${fail === 0 ? 'OK' : `${fail} FAILED`}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('probe error:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
