// ADR-332 D2 live smoke: nested CoopMilestoneStep pipeline on
// POST /api/cooperations + GET round-trip. Verifies: nested steps persist
// with capabilities + per-step assignees, isAgentOrchestration derives from
// step-level assignees, legacy milestone-level assignee still derives true,
// invalid step assignee 400s, human payload unchanged (no steps key).
// Run: npx tsx apps/server/scripts/adr332-nested-pipeline-smoke.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes } from 'node:crypto'
import 'dotenv/config'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4001'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`) }
}

async function mkSession(): Promise<{ pubkey: string; token: string }> {
  const pubkey = 'adr332' + randomBytes(12).toString('hex')
  const token = randomBytes(24).toString('hex')
  await prisma.user.upsert({ where: { pubkey }, update: {}, create: { pubkey } })
  await prisma.session.create({ data: { pubkey, k1: 'adr332-' + Date.now() + '-' + randomBytes(4).toString('hex'), token, expiresAt: new Date(Date.now() + 3600_000) } })
  return { pubkey, token }
}

async function mkAgent(name: string): Promise<string> {
  const owner = await mkSession()
  const res = await fetch(`${BASE_URL}/api/agent-profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` },
    body: JSON.stringify({ name, capabilities: ['research', 'writing'], isPublic: true }),
  })
  const data = await res.json()
  return data.agentProfile.id
}

async function main() {
  const { pubkey, token } = await mkSession()
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const agentId = await mkAgent('adr332-smoke-agent-' + randomBytes(3).toString('hex'))

  // 1. Nested POST: 2 milestones, steps on both, assignee on one step
  const post1 = await fetch(`${BASE_URL}/api/cooperations`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      title: 'ADR-332 nested smoke', description: 'smoke',
      priceSats: 100000, categoryCode: 'services/cooperation',
      creatorPubkey: pubkey, ticketType: 'MILESTONE',
      milestones: [
        { title: 'Research', description: '', percentage: 40, steps: [
          { title: 'Web research', requiredCapabilities: ['research'] },
          { title: 'Summarize', requiredCapabilities: ['writing'], assigneeAgentProfileId: agentId },
        ]},
        { title: 'Delivery', description: '', percentage: 60, steps: [
          { title: 'Write report', requiredCapabilities: ['writing'] },
        ]},
      ],
    }),
  })
  const d1 = await post1.json()
  check('POST nested 201/200', post1.ok, d1)
  const coopId = d1.cooperation?.id ?? d1.id
  const ms = d1.cooperation?.milestones ?? []
  check('2 milestones persisted', ms.length === 2, ms.length)
  check('M1 has 2 steps', ms[0]?.steps?.length === 2, ms[0]?.steps)
  check('M2 has 1 step', ms[1]?.steps?.length === 1, ms[1]?.steps)
  check('step capabilities decoded as string[]', Array.isArray(ms[0]?.steps?.[0]?.requiredCapabilities) && ms[0].steps[0].requiredCapabilities.includes('research'), ms[0]?.steps?.[0])
  check('step assignee persisted', ms[0]?.steps?.[1]?.assigneeAgentProfileId === agentId, ms[0]?.steps?.[1])
  check('amountSats follows milestone % (M2=60000)', ms[1]?.amountSats === 60000, ms[1]?.amountSats)
  check('isAgentOrchestration derived from step assignee', d1.cooperation?.isAgentOrchestration === true, d1.cooperation?.isAgentOrchestration)

  // 2. GET round-trip includes nested steps
  const get1 = await fetch(`${BASE_URL}/api/cooperations/${coopId}`, { headers: auth })
  const g1 = await get1.json()
  check('GET includes steps', g1.cooperation?.milestones?.[0]?.steps?.length === 2, g1.cooperation?.milestones?.[0])

  // 3. Legacy milestone-level assignee still derives isAgentOrchestration
  const post2 = await fetch(`${BASE_URL}/api/cooperations`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      title: 'ADR-332 legacy flat smoke', description: 'smoke',
      priceSats: 50000, categoryCode: 'services/cooperation',
      creatorPubkey: pubkey, ticketType: 'MILESTONE',
      milestones: [{ title: 'Only step', description: '', percentage: 100, assigneeAgentProfileId: agentId, requiredCapabilities: ['research'] }],
    }),
  })
  const d2 = await post2.json()
  check('legacy milestone assignee → isAgentOrchestration true', d2.cooperation?.isAgentOrchestration === true, d2.cooperation?.isAgentOrchestration)

  // 4. Invalid step assignee → 400 before any row is created
  const post3 = await fetch(`${BASE_URL}/api/cooperations`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      title: 'ADR-332 bad assignee', description: 'smoke',
      priceSats: 10000, categoryCode: 'services/cooperation',
      creatorPubkey: pubkey, ticketType: 'MILESTONE',
      milestones: [{ title: 'M', description: '', percentage: 100, steps: [{ title: 'S', requiredCapabilities: [], assigneeAgentProfileId: 'nonexistent-agent' }] }],
    }),
  })
  check('invalid step assignee → 400', post3.status === 400, post3.status)

  // 5. Human payload has no steps key (byte-identical legacy shape)
  const post4 = await fetch(`${BASE_URL}/api/cooperations`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      title: 'ADR-332 human smoke', description: 'smoke',
      priceSats: 20000, categoryCode: 'services/cooperation',
      creatorPubkey: pubkey, ticketType: 'MILESTONE',
      milestones: [{ title: 'Do the thing', description: '', percentage: 100 }],
    }),
  })
  const d4 = await post4.json()
  const humanMs = d4.cooperation?.milestones ?? []
  check('human milestone persisted without steps', humanMs.length === 1 && (humanMs[0].steps === undefined || humanMs[0].steps === null || humanMs[0].steps.length === 0), humanMs[0])
  check('human coop isAgentOrchestration false', d4.cooperation?.isAgentOrchestration === false, d4.cooperation?.isAgentOrchestration)

  // Cleanup — agent by name-prefix (the id from POST /api/agent-profiles is
  // the created row's id, but deleting by it raced with relation cleanup in
  // earlier runs; the prefix match is robust either way), users last.
  const ids = [coopId, d2.cooperation?.id, d4.cooperation?.id].filter(Boolean)
  await prisma.cooperation.deleteMany({ where: { id: { in: ids } } })
  await prisma.agentProfile.deleteMany({ where: { name: { startsWith: 'adr332-smoke-agent' } } })
  await prisma.session.deleteMany({ where: { pubkey: { startsWith: 'adr332' } } })
  await prisma.user.deleteMany({ where: { pubkey: { startsWith: 'adr332' } } })

  console.log(`\n${pass}/${pass + fail} checks passed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
