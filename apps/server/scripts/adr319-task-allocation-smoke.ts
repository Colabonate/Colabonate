// ADR-319 live smoke test: task publication (D1), manual + auto-apply
// applications (D2/D3), and the selection flow (D4). Covers the documented
// scope cuts: offerId required on an application, AgentTaskApplicationStatus
// values not specified by the ADR text (AWAITING_OWNER_APPROVAL gate for
// auto-applied applications on a requireHumanApproval agent), and the
// select-then-nextStep pattern instead of atomically creating a Ticket.
// Run with:
//   DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr319-task-allocation-smoke.ts
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
  const buyerPubkey = randomBytes(32).toString('hex')
  const agentOwnerPubkey = randomBytes(32).toString('hex')
  const rivalOwnerPubkey = randomBytes(32).toString('hex')
  const buyerToken = randomBytes(32).toString('hex')
  const agentOwnerToken = randomBytes(32).toString('hex')
  const rivalOwnerToken = randomBytes(32).toString('hex')

  await prisma.user.create({ data: { pubkey: buyerPubkey, identityLevel: 2, wallets: { create: { provider: 'WEBLN', mode: 'NON_CUSTODIAL', status: 'ACTIVE' } } } })
  await prisma.user.create({ data: { pubkey: agentOwnerPubkey, identityLevel: 2 } })
  await prisma.user.create({ data: { pubkey: rivalOwnerPubkey, identityLevel: 2 } })
  await prisma.session.create({ data: { pubkey: buyerPubkey, k1: randomUUID(), token: buyerToken, expiresAt: new Date(Date.now() + 3600_000) } })
  await prisma.session.create({ data: { pubkey: agentOwnerPubkey, k1: randomUUID(), token: agentOwnerToken, expiresAt: new Date(Date.now() + 3600_000) } })
  await prisma.session.create({ data: { pubkey: rivalOwnerPubkey, k1: randomUUID(), token: rivalOwnerToken, expiresAt: new Date(Date.now() + 3600_000) } })

  // Manual applicant: requireHumanApproval doesn't matter for manual apply.
  const agentProfile = await prisma.agentProfile.create({
    data: { ownerPubkey: agentOwnerPubkey, name: 'smoke-319-agent', capabilities: ['research', 'writing'], tools: [], isPublic: true },
  })
  const agentOffer = await prisma.offer.create({
    data: {
      title: 'ADR-319 Smoke Agent Offer', priceSats: 2000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'ACTIVE',
      creatorPubkey: agentOwnerPubkey, agentProfileId: agentProfile.id, agentConfigSealed: 'fake', agentConfigMeta: { capabilities: ['research', 'writing'] },
    },
  })
  // Missing capability — used for the capability-mismatch rejection.
  const weakAgentProfile = await prisma.agentProfile.create({
    data: { ownerPubkey: agentOwnerPubkey, name: 'smoke-319-weak-agent', capabilities: ['writing'], tools: [], isPublic: true },
  })
  const weakAgentOffer = await prisma.offer.create({
    data: {
      title: 'ADR-319 Smoke Weak Agent Offer', priceSats: 2000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'ACTIVE',
      creatorPubkey: agentOwnerPubkey, agentProfileId: weakAgentProfile.id, agentConfigSealed: 'fake', agentConfigMeta: { capabilities: ['writing'] },
    },
  })

  // Auto-applying rival: autoApply=true, requireHumanApproval=true (default) -> AWAITING_OWNER_APPROVAL.
  const rivalProfile = await prisma.agentProfile.create({
    data: { ownerPubkey: rivalOwnerPubkey, name: 'smoke-319-rival-agent', capabilities: ['research', 'writing'], tools: [], isPublic: true, autoApply: true, requireHumanApproval: true },
  })
  const rivalOffer = await prisma.offer.create({
    data: {
      title: 'ADR-319 Smoke Rival Offer', priceSats: 1500, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'ACTIVE',
      creatorPubkey: rivalOwnerPubkey, agentProfileId: rivalProfile.id, agentConfigSealed: 'fake', agentConfigMeta: { capabilities: ['research', 'writing'] },
    },
  })

  const buyerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${buyerToken}` }
  const agentOwnerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${agentOwnerToken}` }
  const rivalOwnerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${rivalOwnerToken}` }

  let taskId = ''
  let winningApplicationId = ''
  let rivalApplicationId = ''
  try {
    let r = await fetch(`${BASE_URL}/api/agent-tasks`, {
      method: 'POST', headers: buyerHeaders,
      body: JSON.stringify({ title: 'ADR-319 Smoke Task', description: 'Research + write a short report', requiredCapabilities: ['research', 'writing'], budgetSats: 2500 }),
    })
    let body = await r.json()
    check('POST /agent-tasks -> 201', r.status === 201, body)
    taskId = body?.task?.id
    check('task starts OPEN', body?.task?.status === 'OPEN', body?.task)

    // Capability mismatch.
    r = await fetch(`${BASE_URL}/api/agent-tasks/${taskId}/applications`, {
      method: 'POST', headers: agentOwnerHeaders,
      body: JSON.stringify({ agentProfileId: weakAgentProfile.id, offerId: weakAgentOffer.id }),
    })
    body = await r.json()
    check('apply with missing capability -> 400 CAPABILITY_MISMATCH', r.status === 400 && body?.error === 'CAPABILITY_MISMATCH', body)

    // Budget exceeded.
    r = await fetch(`${BASE_URL}/api/agent-tasks/${taskId}/applications`, {
      method: 'POST', headers: agentOwnerHeaders,
      body: JSON.stringify({ agentProfileId: agentProfile.id, offerId: agentOffer.id, proposedPriceSats: 9999 }),
    })
    body = await r.json()
    check('apply over budget -> 400 BUDGET_EXCEEDED', r.status === 400 && body?.error === 'BUDGET_EXCEEDED', body)

    // Wrong owner (rival tries to apply with the agentOwner's profile).
    r = await fetch(`${BASE_URL}/api/agent-tasks/${taskId}/applications`, {
      method: 'POST', headers: rivalOwnerHeaders,
      body: JSON.stringify({ agentProfileId: agentProfile.id, offerId: agentOffer.id }),
    })
    check('apply with a profile you do not own -> 403', r.status === 403, await r.json())

    // Valid manual application.
    r = await fetch(`${BASE_URL}/api/agent-tasks/${taskId}/applications`, {
      method: 'POST', headers: agentOwnerHeaders,
      body: JSON.stringify({ agentProfileId: agentProfile.id, offerId: agentOffer.id, message: 'I can do this', proposedPriceSats: 2000 }),
    })
    body = await r.json()
    check('valid manual application -> 201', r.status === 201, body)
    check('manual application starts PENDING', body?.application?.status === 'PENDING', body?.application)
    winningApplicationId = body?.application?.id

    // Duplicate application.
    r = await fetch(`${BASE_URL}/api/agent-tasks/${taskId}/applications`, {
      method: 'POST', headers: agentOwnerHeaders,
      body: JSON.stringify({ agentProfileId: agentProfile.id, offerId: agentOffer.id }),
    })
    check('duplicate application -> 409 ALREADY_APPLIED', r.status === 409 && (await r.json())?.error === 'ALREADY_APPLIED', null)

    // Run the auto-apply matcher tick directly (same function the server's
    // setInterval calls) so this smoke doesn't need to wait 5 minutes.
    const { runAgentTaskMatcherTick } = await import('../services/agent-task-matcher.js')
    const tickResult = await runAgentTaskMatcherTick(prisma)
    check('matcher tick applied at least the rival profile', tickResult.applied >= 1, tickResult)

    const rivalApp = await prisma.agentTaskApplication.findFirst({ where: { taskId, agentProfileId: rivalProfile.id } })
    check('auto-applied rival starts AWAITING_OWNER_APPROVAL (requireHumanApproval=true)', rivalApp?.status === 'AWAITING_OWNER_APPROVAL', rivalApp)
    rivalApplicationId = rivalApp?.id ?? ''

    // GET /:id as a non-creator, non-applicant (buyer's application view should
    // be empty for someone who is neither); as the creator, sees everything.
    r = await fetch(`${BASE_URL}/api/agent-tasks/${taskId}`, { headers: buyerHeaders })
    body = await r.json()
    check('GET /:id as creator sees both applications', body?.viewerIsCreator === true && body?.applications?.length === 2, body)

    r = await fetch(`${BASE_URL}/api/agent-tasks/${taskId}`, { headers: rivalOwnerHeaders })
    body = await r.json()
    check('GET /:id as the rival owner sees only their own application', body?.viewerIsCreator === false && body?.applications?.length === 1, body)

    // Rival owner confirms the AWAITING_OWNER_APPROVAL application.
    r = await fetch(`${BASE_URL}/api/agent-tasks/${taskId}/applications/${rivalApplicationId}`, {
      method: 'PATCH', headers: rivalOwnerHeaders, body: JSON.stringify({ action: 'confirm' }),
    })
    body = await r.json()
    check('owner confirms auto-applied application -> PENDING', r.status === 200 && body?.application?.status === 'PENDING', body)

    // Non-creator cannot select.
    r = await fetch(`${BASE_URL}/api/agent-tasks/${taskId}/select`, {
      method: 'POST', headers: agentOwnerHeaders, body: JSON.stringify({ applicationId: winningApplicationId }),
    })
    check('select by a non-creator -> 403', r.status === 403, await r.json())

    // Buyer selects the manual applicant.
    r = await fetch(`${BASE_URL}/api/agent-tasks/${taskId}/select`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ applicationId: winningApplicationId }),
    })
    body = await r.json()
    check('select -> 200', r.status === 200, body)
    check('task -> ASSIGNED with the winning offer', body?.task?.status === 'ASSIGNED' && body?.task?.selectedOfferId === agentOffer.id, body?.task)
    check('nextStep points at POST /api/tickets with the winning offerId', body?.nextStep?.method === 'POST' && body?.nextStep?.path === '/api/tickets' && body?.nextStep?.body?.offerId === agentOffer.id, body?.nextStep)

    const rejectedRival = await prisma.agentTaskApplication.findUnique({ where: { id: rivalApplicationId } })
    check('the losing application was auto-rejected', rejectedRival?.status === 'REJECTED', rejectedRival)

    // Task is no longer selectable.
    r = await fetch(`${BASE_URL}/api/agent-tasks/${taskId}/select`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ applicationId: winningApplicationId }),
    })
    check('re-selecting on an ASSIGNED task -> 409', r.status === 409, await r.json())

    // Regression coverage for the double-assignment race found in code
    // review (2026-08-19): two applications on a fresh task, selected
    // concurrently — the CAS transaction in POST /:id/select must let
    // exactly one win, never both.
    let r2 = await fetch(`${BASE_URL}/api/agent-tasks`, {
      method: 'POST', headers: buyerHeaders,
      body: JSON.stringify({ title: 'ADR-319 Smoke Race Task', description: 'Race the select route', requiredCapabilities: ['research', 'writing'], budgetSats: 2500 }),
    })
    const raceTaskBody = await r2.json()
    const raceTaskId: string = raceTaskBody?.task?.id

    r2 = await fetch(`${BASE_URL}/api/agent-tasks/${raceTaskId}/applications`, {
      method: 'POST', headers: agentOwnerHeaders,
      body: JSON.stringify({ agentProfileId: agentProfile.id, offerId: agentOffer.id, proposedPriceSats: 2000 }),
    })
    const raceAppA: string = (await r2.json())?.application?.id
    r2 = await fetch(`${BASE_URL}/api/agent-tasks/${raceTaskId}/applications`, {
      method: 'POST', headers: rivalOwnerHeaders,
      body: JSON.stringify({ agentProfileId: rivalProfile.id, offerId: rivalOffer.id, proposedPriceSats: 1500 }),
    })
    const raceAppB: string = (await r2.json())?.application?.id

    const [raceResA, raceResB] = await Promise.all([
      fetch(`${BASE_URL}/api/agent-tasks/${raceTaskId}/select`, { method: 'POST', headers: buyerHeaders, body: JSON.stringify({ applicationId: raceAppA }) }),
      fetch(`${BASE_URL}/api/agent-tasks/${raceTaskId}/select`, { method: 'POST', headers: buyerHeaders, body: JSON.stringify({ applicationId: raceAppB }) }),
    ])
    const raceStatuses = [raceResA.status, raceResB.status].sort()
    check('concurrent select: exactly one 200 and one 409/404', raceStatuses[0] === 200 && (raceStatuses[1] === 409 || raceStatuses[1] === 404), raceStatuses)

    const raceApps = await prisma.agentTaskApplication.findMany({ where: { taskId: raceTaskId } })
    const acceptedCount = raceApps.filter(a => a.status === 'ACCEPTED').length
    check('concurrent select: exactly one application ends up ACCEPTED (no double-assignment)', acceptedCount === 1, raceApps.map(a => a.status))

    await prisma.agentTaskApplication.deleteMany({ where: { taskId: raceTaskId } })
    await prisma.agentTask.deleteMany({ where: { id: raceTaskId } })
  } finally {
    await prisma.agentTaskApplication.deleteMany({ where: { taskId: { equals: taskId || '__none__' } } })
    await prisma.agentTask.deleteMany({ where: { creatorPubkey: buyerPubkey } })
    await prisma.offer.deleteMany({ where: { creatorPubkey: { in: [agentOwnerPubkey, rivalOwnerPubkey] } } })
    await prisma.agentProfile.deleteMany({ where: { ownerPubkey: { in: [agentOwnerPubkey, rivalOwnerPubkey] } } })
    await prisma.session.deleteMany({ where: { pubkey: { in: [buyerPubkey, agentOwnerPubkey, rivalOwnerPubkey] } } })
    // ADR-397 D2-B: the poster's paying wallet (Wallet has no cascade).
    await prisma.wallet.deleteMany({ where: { user: { pubkey: buyerPubkey } } })
    await prisma.user.deleteMany({ where: { pubkey: { in: [buyerPubkey, agentOwnerPubkey, rivalOwnerPubkey] } } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
