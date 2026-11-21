// ADR-352 live smoke test: one Workspace per (Cooperation, Offer) (D1),
// resolving a specific assigneeOfferId alongside assigneeAgentProfileId
// (D1a — AgentProfile<->Offer is many-to-one), reused-unchanged config/cycle
// funding (D2/D3), and per-step completion gating the milestone's own
// COMPLETED transition (D4, closes FU-514).
// Run with:
//   DATABASE_URL=... BASE_URL=http://localhost:4098 npx tsx apps/server/scripts/adr352-cooperation-agent-pipeline-smoke.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4098'
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
  const strangerPubkey = randomBytes(32).toString('hex')
  const partnerPubkey = randomBytes(32).toString('hex')
  const buyerToken = randomBytes(32).toString('hex')
  const agentOwnerToken = randomBytes(32).toString('hex')
  const strangerToken = randomBytes(32).toString('hex')
  const partnerToken = randomBytes(32).toString('hex')

  for (const [pubkey, token] of [
    [buyerPubkey, buyerToken], [agentOwnerPubkey, agentOwnerToken], [strangerPubkey, strangerToken], [partnerPubkey, partnerToken],
  ] as const) {
    await prisma.user.create({ data: { pubkey, identityLevel: 2 } })
    await prisma.session.create({ data: { pubkey, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 3600_000) } })
  }

  const buyerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${buyerToken}` }
  const agentOwnerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${agentOwnerToken}` }
  const strangerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${strangerToken}` }
  const partnerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${partnerToken}` }

  // D1a: one AgentProfile backing TWO active AGENT_SETUP offers (the real
  // many-to-one case verified against agent-orchestration.ts's own matching
  // code) plus one DRAFT offer for the inactive-offer rejection.
  const agentProfile = await prisma.agentProfile.create({
    data: { ownerPubkey: agentOwnerPubkey, name: 'smoke-352-agent', capabilities: ['research'], tools: [], isPublic: true },
  })
  const offerA = await prisma.offer.create({
    data: {
      title: 'ADR-352 Smoke Offer A', priceSats: 2000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'ACTIVE',
      creatorPubkey: agentOwnerPubkey, agentProfileId: agentProfile.id, agentConfigSealed: 'fake', agentConfigMeta: { capabilities: ['research'] },
      estimatedWorkspaceHours: 1,
    },
  })
  const offerB = await prisma.offer.create({
    data: {
      title: 'ADR-352 Smoke Offer B (same agent, different listing)', priceSats: 4000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'ACTIVE',
      creatorPubkey: agentOwnerPubkey, agentProfileId: agentProfile.id, agentConfigSealed: 'fake', agentConfigMeta: { capabilities: ['research'] },
      estimatedWorkspaceHours: 1,
    },
  })
  const draftOffer = await prisma.offer.create({
    data: {
      title: 'ADR-352 Smoke Draft Offer', priceSats: 2000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'DRAFT',
      creatorPubkey: agentOwnerPubkey, agentProfileId: agentProfile.id, agentConfigSealed: 'fake', agentConfigMeta: { capabilities: ['research'] },
    },
  })
  // A second, unrelated agent profile — used for the "offer belongs to a
  // different agent than the one it's paired with" rejection.
  const otherAgentOwnerPubkey = randomBytes(32).toString('hex')
  await prisma.user.create({ data: { pubkey: otherAgentOwnerPubkey, identityLevel: 2 } })
  const otherAgentProfile = await prisma.agentProfile.create({
    data: { ownerPubkey: otherAgentOwnerPubkey, name: 'smoke-352-other-agent', capabilities: ['research'], tools: [], isPublic: true },
  })

  let cooperationId = ''
  let milestoneId = ''
  let stepAId = ''
  let stepBId = ''
  let workspaceId = ''
  const createdOfferPubkeys = [agentOwnerPubkey, otherAgentOwnerPubkey]
  try {
    // --- D1a validation on POST /api/cooperations ---

    let r = await fetch(`${BASE_URL}/api/cooperations`, {
      method: 'POST', headers: buyerHeaders,
      body: JSON.stringify({
        title: 'ADR-352 Smoke Coop (orphaned offer)', budgetSats: 3000,
        milestones: [{ title: 'M1', percentage: 100, assigneeOfferId: offerA.id }], // no assigneeAgentProfileId
      }),
    })
    check('assigneeOfferId without assigneeAgentProfileId -> 400', r.status === 400, await r.json())

    r = await fetch(`${BASE_URL}/api/cooperations`, {
      method: 'POST', headers: buyerHeaders,
      body: JSON.stringify({
        title: 'ADR-352 Smoke Coop (mismatched agent)', budgetSats: 3000,
        milestones: [{ title: 'M1', percentage: 100, assigneeAgentProfileId: otherAgentProfile.id, assigneeOfferId: offerA.id }],
      }),
    })
    check('assigneeOfferId owned by a different agent than assigneeAgentProfileId -> 400', r.status === 400, await r.json())

    r = await fetch(`${BASE_URL}/api/cooperations`, {
      method: 'POST', headers: buyerHeaders,
      body: JSON.stringify({
        title: 'ADR-352 Smoke Coop (draft offer)', budgetSats: 3000,
        milestones: [{ title: 'M1', percentage: 100, assigneeAgentProfileId: agentProfile.id, assigneeOfferId: draftOffer.id }],
      }),
    })
    check('assigneeOfferId pointing at a DRAFT (non-ACTIVE) offer -> 400', r.status === 400, await r.json())

    // Valid creation: one milestone with two nested steps, both assigned to
    // offerA — this is the D1 "one agent handling several steps in a row"
    // case that needs no cross-workspace handoff at all.
    r = await fetch(`${BASE_URL}/api/cooperations`, {
      method: 'POST', headers: buyerHeaders,
      body: JSON.stringify({
        title: 'ADR-352 Smoke Coop', budgetSats: 3000, partnerPubkey,
        milestones: [{
          title: 'M1', percentage: 100,
          steps: [
            { title: 'Step 1', assigneeAgentProfileId: agentProfile.id, assigneeOfferId: offerA.id, requiredCapabilities: ['research'] },
            { title: 'Step 2', assigneeAgentProfileId: agentProfile.id, assigneeOfferId: offerA.id, requiredCapabilities: ['research'] },
          ],
        }],
      }),
    })
    let body = await r.json()
    check('valid cooperation with assigneeOfferId steps -> 201/200', r.status === 200 || r.status === 201, body)
    cooperationId = body?.cooperation?.id
    check('isAgentOrchestration derived true', body?.cooperation?.isAgentOrchestration === true, body?.cooperation)
    const steps = body?.cooperation?.milestones?.[0]?.steps ?? []
    check('both steps persisted with assigneeOfferId', steps.length === 2 && steps.every((s: { assigneeOfferId?: string }) => s.assigneeOfferId === offerA.id), steps)
    milestoneId = body?.cooperation?.milestones?.[0]?.id
    stepAId = steps[0]?.id
    stepBId = steps[1]?.id

    // --- POST /api/workspaces (cooperation-anchored, D1) ---

    r = await fetch(`${BASE_URL}/api/workspaces`, {
      method: 'POST', headers: strangerHeaders,
      body: JSON.stringify({ cooperationId, offerId: offerA.id }),
    })
    check('create workspace as a non-initiator -> 403', r.status === 403, await r.json())

    r = await fetch(`${BASE_URL}/api/workspaces`, {
      method: 'POST', headers: buyerHeaders,
      body: JSON.stringify({ cooperationId, offerId: offerB.id }), // offerB never assigned in this cooperation
    })
    check('create workspace for an unassigned offer -> 400 OFFER_NOT_ASSIGNED', r.status === 400 && (await r.json())?.error === 'OFFER_NOT_ASSIGNED', null)

    r = await fetch(`${BASE_URL}/api/workspaces`, {
      method: 'POST', headers: buyerHeaders,
      body: JSON.stringify({ ticketId: 'x', cooperationId }), // XOR violation
    })
    check('ticketId + cooperationId together -> 400', r.status === 400, await r.json())

    r = await fetch(`${BASE_URL}/api/workspaces`, {
      method: 'POST', headers: buyerHeaders,
      body: JSON.stringify({ cooperationId, offerId: offerA.id }),
    })
    body = await r.json()
    check('create workspace as initiator for the assigned offer -> 201', r.status === 201, body)
    workspaceId = body?.workspace?.id
    check('workspace anchored to the cooperation, no ticket', body?.workspace?.cooperationId === cooperationId && body?.workspace?.ticketId === null, body?.workspace)
    check('mandatory funding resolved (D3, reused verbatim)', body?.mandatoryFunding?.recharge?.amountSats > 0, body?.mandatoryFunding)

    r = await fetch(`${BASE_URL}/api/workspaces`, {
      method: 'POST', headers: buyerHeaders,
      body: JSON.stringify({ cooperationId, offerId: offerA.id }),
    })
    check('re-creating the same (cooperation, offer) workspace -> 409 WORKSPACE_EXISTS', r.status === 409, await r.json())

    // --- GET /:id authorization: agent owner resolved via AgentProfile, not a Ticket ---

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}`, { headers: buyerHeaders })
    body = await r.json()
    check('GET /:id as buyer -> viewerRole buyer', r.status === 200 && body?.workspace?.viewerRole === 'buyer', body?.workspace)

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}`, { headers: agentOwnerHeaders })
    body = await r.json()
    check('GET /:id as the AgentProfile owner (no Ticket exists) -> viewerRole seller', r.status === 200 && body?.workspace?.viewerRole === 'seller', body?.workspace)

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}`, { headers: strangerHeaders })
    check('GET /:id as an unrelated stranger -> 403', r.status === 403, await r.json())

    // inject-config authorization also resolves via AgentProfile.ownerPubkey;
    // reaching 409 (not 403) here proves the seller identity resolved correctly
    // — it only fails afterwards because no canister is configured in this smoke.
    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/inject-config`, {
      method: 'POST', headers: agentOwnerHeaders, body: JSON.stringify({ senderPubkey: 'a'.repeat(64), ciphertext: 'x' }),
    })
    check('inject-config as the resolved agent owner reaches the status gate, not FORBIDDEN', r.status !== 403, await r.json())

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/inject-config`, {
      method: 'POST', headers: buyerHeaders, body: JSON.stringify({ senderPubkey: 'a'.repeat(64), ciphertext: 'x' }),
    })
    check('inject-config as the buyer -> 403', r.status === 403, await r.json())

    // --- D4: step completion + milestone confirmability gate ---

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/steps/${stepAId}/complete`, { method: 'POST', headers: strangerHeaders })
    check('complete a step as a non-buyer -> 403', r.status === 403, await r.json())

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/steps/${stepAId}/complete`, { method: 'POST', headers: buyerHeaders })
    body = await r.json()
    check('buyer completes step A -> 200 COMPLETED', r.status === 200 && body?.step?.status === 'COMPLETED', body)

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/steps/${stepAId}/complete`, { method: 'POST', headers: buyerHeaders })
    check('re-completing an already-COMPLETED step is idempotent -> 200', r.status === 200, await r.json())

    // FU-605: the milestone has no human partner (agent-only pipeline), so its
    // status must have been auto-derived from step A's completion alone —
    // PENDING -> IN_PROGRESS, since step B is still pending.
    let milestoneRow = await prisma.coopMilestone.findUnique({ where: { id: milestoneId } })
    check('FU-605: milestone auto-advanced to IN_PROGRESS after step A alone', milestoneRow?.status === 'IN_PROGRESS', milestoneRow)

    // The STEPS_INCOMPLETE guard on the milestone's own release-facing PATCH
    // route still holds even though the caller is a genuine partner with a
    // now-valid IN_PROGRESS->COMPLETED transition target.
    r = await fetch(`${BASE_URL}/api/cooperations/${cooperationId}/milestones/${milestoneId}`, {
      method: 'PATCH', headers: partnerHeaders, body: JSON.stringify({ status: 'COMPLETED' }),
    })
    body = await r.json()
    check('milestone -> COMPLETED with step B still pending -> 409 STEPS_INCOMPLETE', r.status === 409 && body?.code === 'STEPS_INCOMPLETE', body)

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/steps/${stepBId}/complete`, { method: 'POST', headers: buyerHeaders })
    check('buyer completes step B -> 200', r.status === 200, await r.json())

    // FU-605: both steps done -> auto-derived straight to COMPLETED, with zero
    // PATCH call from anyone — this is the actual fix, not just the guard.
    milestoneRow = await prisma.coopMilestone.findUnique({ where: { id: milestoneId } })
    check('FU-605: milestone auto-advanced to COMPLETED once both steps are done', milestoneRow?.status === 'COMPLETED', milestoneRow)

    const timeline = await prisma.coopMilestoneMessage.findMany({ where: { milestoneId }, orderBy: { createdAt: 'asc' } })
    check('FU-605: auto-derivation left a STARTED + COMPLETED message trail', timeline.map(m => m.action).join(',') === 'STARTED,COMPLETED', timeline)

    // The final fund-release step is completely untouched by FU-605: still an
    // explicit, initiator-only PATCH to ACCEPTED, exactly as for a human milestone.
    r = await fetch(`${BASE_URL}/api/cooperations/${cooperationId}/milestones/${milestoneId}`, {
      method: 'PATCH', headers: strangerHeaders, body: JSON.stringify({ status: 'ACCEPTED' }),
    })
    check('a stranger cannot ACCEPT (release) the milestone', r.status === 403, await r.json())

    r = await fetch(`${BASE_URL}/api/cooperations/${cooperationId}/milestones/${milestoneId}`, {
      method: 'PATCH', headers: buyerHeaders, body: JSON.stringify({ status: 'ACCEPTED' }),
    })
    body = await r.json()
    check('buyer (initiator) ACCEPTs the now-COMPLETED milestone -> 200', r.status === 200 && body?.milestone?.status === 'ACCEPTED', body)

    // A step that belongs to a DIFFERENT workspace's offer must 404, not leak
    // across engagements.
    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/steps/does-not-exist/complete`, { method: 'POST', headers: buyerHeaders })
    check('completing a non-existent step -> 404', r.status === 404, await r.json())
  } finally {
    await prisma.coopMilestoneStep.deleteMany({ where: { id: { in: [stepAId, stepBId].filter(Boolean) } } })
    await prisma.workspaceRecharge.deleteMany({ where: { workspaceId: workspaceId || '__none__' } })
    await prisma.workspace.deleteMany({ where: { id: workspaceId || '__none__' } })
    await prisma.coopMilestone.deleteMany({ where: { cooperationId: cooperationId || '__none__' } })
    await prisma.cooperation.deleteMany({ where: { initiatorPubkey: buyerPubkey } })
    await prisma.offer.deleteMany({ where: { creatorPubkey: { in: createdOfferPubkeys } } })
    await prisma.agentProfile.deleteMany({ where: { ownerPubkey: { in: createdOfferPubkeys } } })
    await prisma.session.deleteMany({ where: { pubkey: { in: [buyerPubkey, agentOwnerPubkey, strangerPubkey, partnerPubkey, otherAgentOwnerPubkey] } } })
    await prisma.user.deleteMany({ where: { pubkey: { in: [buyerPubkey, agentOwnerPubkey, strangerPubkey, partnerPubkey, otherAgentOwnerPubkey] } } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
