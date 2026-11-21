// ADR-331 live smoke: closes the FU-505 audit findings. Covers the new
// CoopMilestone.requiredCapabilities + Cooperation.agentSupervision +
// AgentProfile.companyId fields, end-to-end through POST → GET → PATCH.
// Run with:
//   DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr331-resume-persistence-smoke.ts
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
  const agentOwnerPubkey = randomBytes(32).toString('hex')
  const initiatorToken = randomBytes(32).toString('hex')
  await prisma.user.create({ data: { pubkey: initiatorPubkey, identityLevel: 2 } })
  await prisma.user.create({ data: { pubkey: agentOwnerPubkey, identityLevel: 2 } })
  await prisma.session.create({ data: { pubkey: initiatorPubkey, k1: randomUUID(), token: initiatorToken, expiresAt: new Date(Date.now() + 3600_000) } })
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${initiatorToken}` }
  const agent = await prisma.agentProfile.create({
    data: { ownerPubkey: agentOwnerPubkey, name: `smoke-331-agent-${Date.now()}`, capabilities: ['text-generation', 'research'], tools: [], isPublic: true, reputationScore: 4.0 },
  })

  // 1. POST with full agent-orchestration payload → all three fields persisted.
  const createRes = await fetch(`${BASE_URL}/api/cooperations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'ADR-331 Agent Coop',
      budgetSats: 5000,
      cooperationType: 'TRANSACTIONAL',
      agentSupervision: 'autonomous',
      milestones: [
        { title: 'Step A', percentage: 50, assigneeAgentProfileId: agent.id, requiredCapabilities: ['research', 'text-generation'] },
        { title: 'Step B', percentage: 50, assigneeAgentProfileId: agent.id, requiredCapabilities: ['text-generation'] },
      ],
    }),
  })
  const createBody = await createRes.json()
  check('POST /api/cooperations full payload: 200/201', createRes.status === 200 || createRes.status === 201, { status: createRes.status, body: createBody })
  check('POST: isAgentOrchestration=true', createBody?.cooperation?.isAgentOrchestration === true, createBody?.cooperation)
  check('POST: agentSupervision="autonomous"', createBody?.cooperation?.agentSupervision === 'autonomous', createBody?.cooperation)
  check('POST: milestone 0 requiredCapabilities=["research","text-generation"]',
    JSON.stringify(createBody?.cooperation?.milestones?.[0]?.requiredCapabilities) === JSON.stringify(['research', 'text-generation']),
    createBody?.cooperation?.milestones?.[0]?.requiredCapabilities)
  check('POST: milestone 0 assigneeAgentProfileId preserved',
    createBody?.cooperation?.milestones?.[0]?.assigneeAgentProfileId === agent.id,
    createBody?.cooperation?.milestones?.[0]?.assigneeAgentProfileId)

  // 2. POST with invalid agentSupervision → 400.
  const badRes = await fetch(`${BASE_URL}/api/cooperations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'ADR-331 Bad Supervision',
      budgetSats: 5000,
      cooperationType: 'TRANSACTIONAL',
      agentSupervision: 'robotic',
      milestones: [{ title: 'Step A', percentage: 100 }],
    }),
  })
  check('POST invalid agentSupervision: 400', badRes.status === 400, { status: badRes.status })
  const badBody = await badRes.json().catch(() => ({}))
  check('POST invalid agentSupervision: error code mentions invalid', /invalid agentSupervision/.test(String(badBody.error ?? '')), badBody)

  // 3. POST with agentSupervision but no assignee → supervision IS persisted
  // (coordination-layer choice, independent of per-step matches). This is
  // what lets the wizard resume "executor='agent', no matches yet" drafts.
  const mismatchRes = await fetch(`${BASE_URL}/api/cooperations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'ADR-331 Supervision Without Agent',
      budgetSats: 5000,
      cooperationType: 'TRANSACTIONAL',
      agentSupervision: 'autonomous',
      milestones: [{ title: 'Step A', percentage: 100 }],
    }),
  })
  const mismatchBody = await mismatchRes.json()
  check('POST no-assignee + agentSupervision: 200/201', mismatchRes.status === 200 || mismatchRes.status === 201, { status: mismatchRes.status })
  check('POST no-assignee + agentSupervision: agentSupervision="autonomous" (coordination-layer, independent of matches)',
    mismatchBody?.cooperation?.agentSupervision === 'autonomous', mismatchBody?.cooperation?.agentSupervision)
  check('POST no-assignee + agentSupervision: isAgentOrchestration=false (no matches yet)',
    mismatchBody?.cooperation?.isAgentOrchestration === false, mismatchBody?.cooperation?.isAgentOrchestration)

  // 4. POST without agentSupervision → null.
  const humanRes = await fetch(`${BASE_URL}/api/cooperations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'ADR-331 Human Coop',
      budgetSats: 5000,
      cooperationType: 'TRANSACTIONAL',
      milestones: [{ title: 'Step A', percentage: 100 }],
    }),
  })
  const humanBody = await humanRes.json()
  check('POST human coop: agentSupervision=null', humanBody?.cooperation?.agentSupervision == null, humanBody?.cooperation?.agentSupervision)
  check('POST human coop: milestones[].requiredCapabilities=null', humanBody?.cooperation?.milestones?.[0]?.requiredCapabilities == null, humanBody?.cooperation?.milestones?.[0])

  // 5. GET /api/cooperations/:id reflects all three persisted fields.
  const getRes = await fetch(`${BASE_URL}/api/cooperations/${createBody.cooperation.id}`, { headers })
  const getBody = await getRes.json()
  check('GET: agentSupervision round-trips', getBody?.cooperation?.agentSupervision === 'autonomous', getBody?.cooperation)
  check('GET: requiredCapabilities round-trips as string[]',
    JSON.stringify(getBody?.cooperation?.milestones?.[0]?.requiredCapabilities) === JSON.stringify(['research', 'text-generation']),
    getBody?.cooperation?.milestones?.[0]?.requiredCapabilities)
  check('GET: assigneeAgentProfile nested include present with companyId=null',
    'companyId' in (getBody?.cooperation?.milestones?.[0]?.assigneeAgentProfile ?? {}),
    getBody?.cooperation?.milestones?.[0]?.assigneeAgentProfile)

  // 6. PATCH metadata does not reset agentSupervision or requiredCapabilities.
  const patchRes = await fetch(`${BASE_URL}/api/cooperations/${createBody.cooperation.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ description: 'updated by smoke' }),
  })
  check('PATCH metadata: 200', patchRes.status === 200, { status: patchRes.status })
  const afterPatch = await fetch(`${BASE_URL}/api/cooperations/${createBody.cooperation.id}`, { headers }).then(r => r.json())
  check('PATCH metadata: agentSupervision unchanged', afterPatch?.cooperation?.agentSupervision === 'autonomous', afterPatch?.cooperation?.agentSupervision)
  check('PATCH metadata: requiredCapabilities unchanged',
    JSON.stringify(afterPatch?.cooperation?.milestones?.[0]?.requiredCapabilities) === JSON.stringify(['research', 'text-generation']),
    afterPatch?.cooperation?.milestones?.[0]?.requiredCapabilities)

  // 7. AgentProfile.companyId round-trip — assign a Company, GET should expose it via the milestone nested include.
  const company = await prisma.company.create({ data: { ownerPubkey: randomBytes(32).toString('hex'), name: 'smoke-331-corp' } })
  const corporateAgent = await prisma.agentProfile.create({
    data: { ownerPubkey: agentOwnerPubkey, name: `smoke-331-corp-agent-${Date.now()}`, capabilities: ['text-generation'], tools: [], isPublic: true, companyId: company.id },
  })
  const corpRes = await fetch(`${BASE_URL}/api/cooperations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'ADR-331 Corporate Agent Coop',
      budgetSats: 5000,
      cooperationType: 'TRANSACTIONAL',
      milestones: [{ title: 'Step A', percentage: 100, assigneeAgentProfileId: corporateAgent.id }],
    }),
  })
  const corpBody = await corpRes.json()
  const corpGet = await fetch(`${BASE_URL}/api/cooperations/${corpBody.cooperation.id}`, { headers }).then(r => r.json())
  check('GET corporate-agent coop: assigneeAgentProfile.companyId matches',
    corpGet?.cooperation?.milestones?.[0]?.assigneeAgentProfile?.companyId === company.id,
    corpGet?.cooperation?.milestones?.[0]?.assigneeAgentProfile)

  // Cleanup
  for (const c of [createBody.cooperation, mismatchBody.cooperation, humanBody.cooperation, corpBody.cooperation]) {
    await prisma.coopMilestone.deleteMany({ where: { cooperationId: c.id } })
    await prisma.cooperation.delete({ where: { id: c.id } })
  }
  await prisma.agentProfile.delete({ where: { id: agent.id } })
  await prisma.agentProfile.delete({ where: { id: corporateAgent.id } })
  await prisma.company.delete({ where: { id: company.id } })
  await prisma.session.deleteMany({ where: { pubkey: initiatorPubkey } })
  await prisma.user.deleteMany({ where: { pubkey: { in: [initiatorPubkey, agentOwnerPubkey] } } })

  console.log(`\n${pass}/${pass + fail} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })