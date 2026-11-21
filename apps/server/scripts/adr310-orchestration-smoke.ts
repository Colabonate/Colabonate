// ADR-310 live smoke test: D1 (orchestration template schema + validation),
// D4 (capability-ranked agent matching per step), D2 steps 1-4 (template ->
// match -> Cooperation creation with per-milestone assigneeAgentProfileId).
// D2 steps 5-6 / D3 (canister-run pipeline handoff) and D6 (live in-chat
// orchestrator role) are not built this session — see the ADR's
// Implementation Record for why.
// Run with:
//   DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr310-orchestration-smoke.ts
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
  const strongOwnerPubkey = randomBytes(32).toString('hex')
  const weakOwnerPubkey = randomBytes(32).toString('hex')

  await prisma.user.create({ data: { pubkey: initiatorPubkey, identityLevel: 2 } })
  await prisma.user.create({ data: { pubkey: strongOwnerPubkey, identityLevel: 2 } })
  await prisma.user.create({ data: { pubkey: weakOwnerPubkey, identityLevel: 2 } })
  await prisma.session.create({ data: { pubkey: initiatorPubkey, k1: randomUUID(), token: initiatorToken, expiresAt: new Date(Date.now() + 3600_000) } })
  const initiatorHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${initiatorToken}` }

  // strongAgent has BOTH step-1 capabilities + a cheap price + decent reputation.
  const strongAgent = await prisma.agentProfile.create({
    data: { ownerPubkey: strongOwnerPubkey, name: 'smoke-310-strong', capabilities: ['text-generation', 'data-analysis'], tools: [], isPublic: true, reputationScore: 4.5 },
  })
  await prisma.offer.create({
    data: { title: 'ADR-310 Smoke Strong Offer', priceSats: 1000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'ACTIVE', creatorPubkey: strongOwnerPubkey, agentProfileId: strongAgent.id, agentConfigSealed: 'fake', agentConfigMeta: { capabilities: ['text-generation', 'data-analysis'] } },
  })
  // pricierAgent has the same capabilities but costs more and has lower reputation — should rank below strongAgent.
  const pricierAgent = await prisma.agentProfile.create({
    data: { ownerPubkey: strongOwnerPubkey, name: 'smoke-310-pricier', capabilities: ['text-generation', 'data-analysis'], tools: [], isPublic: true, reputationScore: 3.0 },
  })
  await prisma.offer.create({
    data: { title: 'ADR-310 Smoke Pricier Offer', priceSats: 9000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'ACTIVE', creatorPubkey: strongOwnerPubkey, agentProfileId: pricierAgent.id, agentConfigSealed: 'fake', agentConfigMeta: { capabilities: ['text-generation', 'data-analysis'] } },
  })
  // weakAgent only has ONE of the two step-1 required capabilities — must be excluded from step 1.
  const weakAgent = await prisma.agentProfile.create({
    data: { ownerPubkey: weakOwnerPubkey, name: 'smoke-310-weak', capabilities: ['text-generation'], tools: [], isPublic: true, reputationScore: 5 },
  })
  await prisma.offer.create({
    data: { title: 'ADR-310 Smoke Weak Offer', priceSats: 500, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'ACTIVE', creatorPubkey: weakOwnerPubkey, agentProfileId: weakAgent.id, agentConfigSealed: 'fake', agentConfigMeta: { capabilities: ['text-generation'] } },
  })

  let templateId = ''
  let cooperationId = ''
  try {
    const pipeline = [
      { order: 1, title: 'Market Analysis', requiredAgentCapabilities: ['text-generation', 'data-analysis'], inputFromStep: null, outputToSteps: [2] },
      { order: 2, title: 'Visual Assets', requiredAgentCapabilities: ['image-generation'], inputFromStep: 1, outputToSteps: [] },
    ]

    // D1: valid orchestration template creates cleanly.
    let r = await fetch(`${BASE_URL}/api/cooperation-templates`, {
      method: 'POST', headers: initiatorHeaders,
      body: JSON.stringify({ name: 'ADR-310 Smoke Template', cooperationType: 'TRANSACTIONAL', createdByPubkey: initiatorPubkey, isAgentOrchestration: true, orchestrationSteps: pipeline }),
    })
    let body: any = await r.json()
    check('POST template: 201 with a valid pipeline', r.status === 201, body)
    templateId = body?.template?.id
    check('POST template: isAgentOrchestration persisted', body?.template?.isAgentOrchestration === true, body)
    check('POST template: orchestrationSteps persisted with 2 steps', Array.isArray(body?.template?.orchestrationSteps) && body.template.orchestrationSteps.length === 2, body)

    // D1: invalid pipeline (duplicate order) rejected.
    r = await fetch(`${BASE_URL}/api/cooperation-templates`, {
      method: 'POST', headers: initiatorHeaders,
      body: JSON.stringify({ name: 'ADR-310 Bad Template', cooperationType: 'TRANSACTIONAL', createdByPubkey: initiatorPubkey, isAgentOrchestration: true, orchestrationSteps: [pipeline[0], { ...pipeline[0] }] }),
    })
    check('POST template: 400 on duplicate step order', r.status === 400, await r.json())

    // D1: invalid pipeline (dangling outputToSteps reference) rejected.
    r = await fetch(`${BASE_URL}/api/cooperation-templates`, {
      method: 'POST', headers: initiatorHeaders,
      body: JSON.stringify({ name: 'ADR-310 Bad Template 2', cooperationType: 'TRANSACTIONAL', createdByPubkey: initiatorPubkey, isAgentOrchestration: true, orchestrationSteps: [{ order: 1, title: 'x', requiredAgentCapabilities: ['a'], inputFromStep: null, outputToSteps: [99] }] }),
    })
    check('POST template: 400 on dangling outputToSteps reference', r.status === 400, await r.json())

    // D4: match-agents on a non-orchestration template -> 400.
    r = await fetch(`${BASE_URL}/api/cooperation-templates/mock-1/match-agents`)
    check('GET match-agents: 400 on a non-orchestration template', r.status === 400, await r.json())

    // D4: match-agents on an unknown template -> 404.
    r = await fetch(`${BASE_URL}/api/cooperation-templates/does-not-exist/match-agents`)
    check('GET match-agents: 404 on an unknown template', r.status === 404, await r.json())

    // D4: match-agents ranks correctly and excludes capability-mismatched agents.
    r = await fetch(`${BASE_URL}/api/cooperation-templates/${templateId}/match-agents`)
    body = await r.json()
    check('GET match-agents: 200', r.status === 200, body)
    const step1 = body?.matches?.find((m: any) => m.step.order === 1)
    const step2 = body?.matches?.find((m: any) => m.step.order === 2)
    check('step 1: weak agent (missing data-analysis) excluded', !step1?.candidates?.some((c: any) => c.agentProfileId === weakAgent.id), step1)
    check('step 1: strong (cheap, high reputation) ranks above pricier', step1?.candidates?.[0]?.agentProfileId === strongAgent.id, step1)
    check('step 1: both qualifying agents present', step1?.candidates?.length === 2, step1)
    check('step 2: no image-generation agent exists -> empty candidates', step2?.candidates?.length === 0, step2)

    // ADR-352 D1a (FU-606): each candidate carries its cheapest matching
    // AGENT_SETUP offer id, needed since AgentProfile<->Offer is many-to-one.
    const strongCandidate = step1?.candidates?.find((c: any) => c.agentProfileId === strongAgent.id)
    const pricierCandidate = step1?.candidates?.find((c: any) => c.agentProfileId === pricierAgent.id)
    const strongOffer = await prisma.offer.findFirst({ where: { agentProfileId: strongAgent.id } })
    const pricierOffer = await prisma.offer.findFirst({ where: { agentProfileId: pricierAgent.id } })
    check('FU-606: strong candidate carries its own offer id, not the pricier one', strongCandidate?.cheapestOfferId === strongOffer?.id, { strongCandidate, strongOffer })
    check('FU-606: pricier candidate carries its own (different) offer id', pricierCandidate?.cheapestOfferId === pricierOffer?.id && pricierCandidate?.cheapestOfferId !== strongCandidate?.cheapestOfferId, { pricierCandidate, pricierOffer })

    // D2 steps 1-4: create a Cooperation whose milestone carries the chosen assigneeAgentProfileId.
    r = await fetch(`${BASE_URL}/api/cooperations`, {
      method: 'POST', headers: initiatorHeaders,
      body: JSON.stringify({
        title: 'ADR-310 Smoke Orchestrated Coop', budgetSats: 5000, cooperationType: 'TRANSACTIONAL',
        milestones: [{ title: 'Market Analysis', percentage: 100, assigneeAgentProfileId: strongAgent.id }],
      }),
    })
    body = await r.json()
    check('POST cooperations: 201 with assigneeAgentProfileId milestone', r.status === 200 || r.status === 201, body)
    cooperationId = body?.cooperation?.id
    check('cooperation milestone: assigneeAgentProfileId persisted', body?.cooperation?.milestones?.[0]?.assigneeAgentProfileId === strongAgent.id, body?.cooperation?.milestones)

    // D2: an unknown assigneeAgentProfileId is rejected, and no orphaned Cooperation is left behind.
    r = await fetch(`${BASE_URL}/api/cooperations`, {
      method: 'POST', headers: initiatorHeaders,
      body: JSON.stringify({ title: 'ADR-310 Smoke Should Fail', budgetSats: 5000, cooperationType: 'TRANSACTIONAL', milestones: [{ title: 'X', percentage: 100, assigneeAgentProfileId: 'does-not-exist' }] }),
    })
    check('POST cooperations: 400 on unknown assigneeAgentProfileId', r.status === 400, await r.json())
    const orphaned = await prisma.cooperation.count({ where: { title: 'ADR-310 Smoke Should Fail' } })
    check('POST cooperations: no orphaned Cooperation row left behind on rejection', orphaned === 0, orphaned)
  } finally {
    if (cooperationId) await prisma.coopMilestone.deleteMany({ where: { cooperationId } })
    if (cooperationId) await prisma.cooperation.deleteMany({ where: { id: cooperationId } })
    if (templateId) await prisma.cooperationTemplate.deleteMany({ where: { id: templateId } })
    await prisma.cooperationTemplate.deleteMany({ where: { createdByPubkey: initiatorPubkey } })
    await prisma.offer.deleteMany({ where: { creatorPubkey: { in: [strongOwnerPubkey, weakOwnerPubkey] } } })
    await prisma.agentProfile.deleteMany({ where: { ownerPubkey: { in: [strongOwnerPubkey, weakOwnerPubkey] } } })
    await prisma.session.deleteMany({ where: { pubkey: initiatorPubkey } })
    await prisma.user.deleteMany({ where: { pubkey: { in: [initiatorPubkey, strongOwnerPubkey, weakOwnerPubkey] } } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
