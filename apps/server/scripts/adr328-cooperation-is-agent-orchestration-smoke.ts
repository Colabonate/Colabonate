// ADR-328 D4 follow-up smoke: Cooperation.isAgentOrchestration is server-
// derived from CoopMilestone.assigneeAgentProfileId at creation time, so the
// flag cannot be lied to by the client, and the migration's backfill rule
// applies to legacy rows identically. Covers:
//   1. POST /api/cooperations with assigneeAgentProfileId → response shows isAgentOrchestration=true
//   2. POST /api/cooperations without agent assignees → isAgentOrchestration=false
//   3. POST /api/cooperations with no milestones array at all → false
//   4. GET /api/cooperations returns isAgentOrchestration on every row
//   5. The flag is write-once: PATCH /api/cooperations/:id (metadata-only) doesn't reset it
// Run with:
//   DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr328-cooperation-is-agent-orchestration-smoke.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4001'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, detail ?? '') }
}

async function main() {
  const initiatorPubkey = randomBytes(32).toString('hex')
  const initiatorToken = randomBytes(32).toString('hex')
  const agentOwnerPubkey = randomBytes(32).toString('hex')
  const agentOwnerToken = randomBytes(32).toString('hex')

  await prisma.user.create({ data: { pubkey: initiatorPubkey, identityLevel: 2 } })
  await prisma.user.create({ data: { pubkey: agentOwnerPubkey, identityLevel: 2 } })
  await prisma.session.create({ data: { pubkey: initiatorPubkey, k1: randomUUID(), token: initiatorToken, expiresAt: new Date(Date.now() + 3600_000) } })
  await prisma.session.create({ data: { pubkey: agentOwnerPubkey, k1: randomUUID(), token: agentOwnerToken, expiresAt: new Date(Date.now() + 3600_000) } })
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${initiatorToken}` }

  const agent = await prisma.agentProfile.create({
    data: { ownerPubkey: agentOwnerPubkey, name: `smoke-328-agent-${Date.now()}`, capabilities: ['text-generation'], tools: [], isPublic: true, reputationScore: 4.0 },
  })

  // 1. Create a cooperation WITH an agent assignee → isAgentOrchestration=true
  const agentCoopRes = await fetch(`${BASE_URL}/api/cooperations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'ADR-328 Agent Coop',
      budgetSats: 5000,
      cooperationType: 'TRANSACTIONAL',
      milestones: [{ title: 'Step A', percentage: 100, assigneeAgentProfileId: agent.id }],
    }),
  })
  const agentCoopBody = await agentCoopRes.json()
  check('POST /api/cooperations with agent assignee: 200/201', agentCoopRes.status === 200 || agentCoopRes.status === 201, { status: agentCoopRes.status, body: agentCoopBody })
  check('POST /api/cooperations with agent assignee: isAgentOrchestration=true', agentCoopBody?.cooperation?.isAgentOrchestration === true, agentCoopBody?.cooperation)

  // 2. Create a cooperation WITHOUT any agent assignees → isAgentOrchestration=false
  const humanCoopRes = await fetch(`${BASE_URL}/api/cooperations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'ADR-328 Human Coop',
      budgetSats: 5000,
      cooperationType: 'TRANSACTIONAL',
      milestones: [{ title: 'Step A', percentage: 100 }],
    }),
  })
  const humanCoopBody = await humanCoopRes.json()
  check('POST /api/cooperations no agent: 200/201', humanCoopRes.status === 200 || humanCoopRes.status === 201, { status: humanCoopRes.status, body: humanCoopBody })
  check('POST /api/cooperations no agent: isAgentOrchestration=false', humanCoopBody?.cooperation?.isAgentOrchestration === false, humanCoopBody?.cooperation)

  // 3. Create a cooperation with NO milestones array (smart-order-style path uses defaults)
  const noMsRes = await fetch(`${BASE_URL}/api/cooperations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'ADR-328 No Milestones Coop',
      budgetSats: 5000,
      cooperationType: 'TRANSACTIONAL',
      ticketType: 'SMART_ORDER',
    }),
  })
  const noMsBody = await noMsRes.json()
  check('POST /api/cooperations no milestones: 200/201', noMsRes.status === 200 || noMsRes.status === 201, { status: noMsRes.status, body: noMsBody })
  check('POST /api/cooperations no milestones: isAgentOrchestration=false', noMsBody?.cooperation?.isAgentOrchestration === false, noMsBody?.cooperation)

  // 4. GET /api/cooperations returns the flag on every row
  const listRes = await fetch(`${BASE_URL}/api/cooperations?pubkey=${initiatorPubkey}&first=100`, { headers })
  const listBody = await listRes.json()
  const myThree = (listBody?.cooperations ?? []).filter((c: { id: string }) => [agentCoopBody.cooperation.id, humanCoopBody.cooperation.id, noMsBody.cooperation.id].includes(c.id))
  check('GET /api/cooperations: includes our 3 fresh rows', myThree.length === 3, myThree.map((c: { id: string; isAgentOrchestration?: boolean }) => ({ id: c.id, isAgentOrchestration: c.isAgentOrchestration })))
  const agentRow = myThree.find((c: { id: string }) => c.id === agentCoopBody.cooperation.id)
  const humanRow = myThree.find((c: { id: string }) => c.id === humanCoopBody.cooperation.id)
  const noMsRow = myThree.find((c: { id: string }) => c.id === noMsBody.cooperation.id)
  check('GET /api/cooperations: agent row isAgentOrchestration=true', agentRow?.isAgentOrchestration === true, agentRow)
  check('GET /api/cooperations: human row isAgentOrchestration=false', humanRow?.isAgentOrchestration === false, humanRow)
  check('GET /api/cooperations: no-milestones row isAgentOrchestration=false', noMsRow?.isAgentOrchestration === false, noMsRow)

  // 5. PATCH /api/cooperations/:id (metadata-only) does not flip the flag
  const patchRes = await fetch(`${BASE_URL}/api/cooperations/${agentCoopBody.cooperation.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ description: 'updated by smoke' }),
  })
  check('PATCH cooperation metadata: 200', patchRes.status === 200, { status: patchRes.status })
  const afterPatch = await fetch(`${BASE_URL}/api/cooperations/${agentCoopBody.cooperation.id}`, { headers }).then(r => r.json())
  check('PATCH metadata does not reset isAgentOrchestration', afterPatch?.cooperation?.isAgentOrchestration === true, afterPatch?.cooperation)

  // Cleanup
  await prisma.coopMilestone.deleteMany({ where: { cooperationId: { in: [agentCoopBody.cooperation.id, humanCoopBody.cooperation.id, noMsBody.cooperation.id] } } })
  await prisma.cooperation.deleteMany({ where: { id: { in: [agentCoopBody.cooperation.id, humanCoopBody.cooperation.id, noMsBody.cooperation.id] } } })
  await prisma.agentProfile.delete({ where: { id: agent.id } })
  await prisma.session.deleteMany({ where: { pubkey: { in: [initiatorPubkey, agentOwnerPubkey] } } })
  await prisma.user.deleteMany({ where: { pubkey: { in: [initiatorPubkey, agentOwnerPubkey] } } })

  console.log(`\n${pass}/${pass + fail} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })