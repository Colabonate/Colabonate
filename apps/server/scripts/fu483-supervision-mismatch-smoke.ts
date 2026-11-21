// FU-483 (ADR-328 D2) live smoke test: AgentTask.preferredSupervision — the
// SUPERVISION_MISMATCH enforcement on manual applications, the same gate on
// the auto-apply tick (agent-task-matcher.ts), and the GET / creatorPubkey
// filter dropping the OPEN-only default for "my tasks".
// Run with:
//   DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/fu483-supervision-mismatch-smoke.ts
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
  const humanAgentOwnerPubkey = randomBytes(32).toString('hex')
  const autoAgentOwnerPubkey = randomBytes(32).toString('hex')
  const buyerToken = randomBytes(32).toString('hex')
  const humanAgentOwnerToken = randomBytes(32).toString('hex')
  const autoAgentOwnerToken = randomBytes(32).toString('hex')

  await prisma.user.create({ data: { pubkey: buyerPubkey, identityLevel: 2, wallets: { create: { provider: 'WEBLN', mode: 'NON_CUSTODIAL', status: 'ACTIVE' } } } })
  await prisma.user.create({ data: { pubkey: humanAgentOwnerPubkey, identityLevel: 2 } })
  await prisma.user.create({ data: { pubkey: autoAgentOwnerPubkey, identityLevel: 2 } })
  await prisma.session.create({ data: { pubkey: buyerPubkey, k1: randomUUID(), token: buyerToken, expiresAt: new Date(Date.now() + 3600_000) } })
  await prisma.session.create({ data: { pubkey: humanAgentOwnerPubkey, k1: randomUUID(), token: humanAgentOwnerToken, expiresAt: new Date(Date.now() + 3600_000) } })
  await prisma.session.create({ data: { pubkey: autoAgentOwnerPubkey, k1: randomUUID(), token: autoAgentOwnerToken, expiresAt: new Date(Date.now() + 3600_000) } })

  // humanInLoop=true -> NOT autonomous. Deliberately requireHumanApproval=true
  // (schema default) so the auto-apply tick's own approval gate never masks
  // the supervision-mismatch skip as a false negative below.
  const humanAgentProfile = await prisma.agentProfile.create({
    data: { ownerPubkey: humanAgentOwnerPubkey, name: 'fu483-smoke-human-agent', capabilities: ['research'], tools: [], isPublic: true, humanInLoop: true },
  })
  const humanAgentOffer = await prisma.offer.create({
    data: {
      title: 'FU-483 Smoke Human-in-loop Offer', priceSats: 1000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'ACTIVE',
      creatorPubkey: humanAgentOwnerPubkey, agentProfileId: humanAgentProfile.id, agentConfigSealed: 'fake', agentConfigMeta: { capabilities: ['research'] },
    },
  })
  // humanInLoop=false -> autonomous. autoApply=true for the tick-gate check.
  const autoAgentProfile = await prisma.agentProfile.create({
    data: { ownerPubkey: autoAgentOwnerPubkey, name: 'fu483-smoke-autonomous-agent', capabilities: ['research'], tools: [], isPublic: true, humanInLoop: false, autoApply: true, requireHumanApproval: false },
  })
  const autoAgentOffer = await prisma.offer.create({
    data: {
      title: 'FU-483 Smoke Autonomous Offer', priceSats: 1000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'ACTIVE',
      creatorPubkey: autoAgentOwnerPubkey, agentProfileId: autoAgentProfile.id, agentConfigSealed: 'fake', agentConfigMeta: { capabilities: ['research'] },
    },
  })

  const buyerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${buyerToken}` }
  const humanAgentOwnerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${humanAgentOwnerToken}` }
  const autoAgentOwnerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${autoAgentOwnerToken}` }

  let autonomousTaskId = ''
  let noPreferenceTaskId = ''
  let cancelledTaskId = ''
  try {
    // ── Task requiring a fully autonomous agent ──────────────────────────
    let r = await fetch(`${BASE_URL}/api/agent-tasks`, {
      method: 'POST', headers: buyerHeaders,
      body: JSON.stringify({ title: 'FU-483 Smoke Autonomous Task', description: 'Needs a fully autonomous agent', requiredCapabilities: ['research'], budgetSats: 1500, preferredSupervision: 'AUTONOMOUS' }),
    })
    let body = await r.json()
    check('POST /agent-tasks with preferredSupervision=AUTONOMOUS -> 201', r.status === 201, body)
    autonomousTaskId = body?.task?.id
    check('task.preferredSupervision persisted as AUTONOMOUS', body?.task?.preferredSupervision === 'AUTONOMOUS', body?.task)

    r = await fetch(`${BASE_URL}/api/agent-tasks/${autonomousTaskId}/applications`, {
      method: 'POST', headers: humanAgentOwnerHeaders,
      body: JSON.stringify({ agentProfileId: humanAgentProfile.id, offerId: humanAgentOffer.id }),
    })
    body = await r.json()
    check('human-in-loop agent applying to AUTONOMOUS-only task -> 400 SUPERVISION_MISMATCH', r.status === 400 && body?.error === 'SUPERVISION_MISMATCH', body)

    r = await fetch(`${BASE_URL}/api/agent-tasks/${autonomousTaskId}/applications`, {
      method: 'POST', headers: autoAgentOwnerHeaders,
      body: JSON.stringify({ agentProfileId: autoAgentProfile.id, offerId: autoAgentOffer.id }),
    })
    body = await r.json()
    check('autonomous agent applying to AUTONOMOUS-only task -> 201', r.status === 201, body)

    // ── Task with no preference — both agent types can apply ────────────
    r = await fetch(`${BASE_URL}/api/agent-tasks`, {
      method: 'POST', headers: buyerHeaders,
      body: JSON.stringify({ title: 'FU-483 Smoke No-Preference Task', description: 'Any supervision mode', requiredCapabilities: ['research'], budgetSats: 1500 }),
    })
    body = await r.json()
    noPreferenceTaskId = body?.task?.id
    check('task.preferredSupervision defaults to null when omitted', body?.task?.preferredSupervision === null, body?.task)

    r = await fetch(`${BASE_URL}/api/agent-tasks/${noPreferenceTaskId}/applications`, {
      method: 'POST', headers: humanAgentOwnerHeaders,
      body: JSON.stringify({ agentProfileId: humanAgentProfile.id, offerId: humanAgentOffer.id }),
    })
    check('human-in-loop agent applying to no-preference task -> 201', r.status === 201, await r.json())

    // ── Invalid preferredSupervision value rejected ──────────────────────
    r = await fetch(`${BASE_URL}/api/agent-tasks`, {
      method: 'POST', headers: buyerHeaders,
      body: JSON.stringify({ title: 'FU-483 Smoke Invalid', description: 'bad value', requiredCapabilities: ['research'], budgetSats: 1500, preferredSupervision: 'MAYBE' }),
    })
    check('POST /agent-tasks with invalid preferredSupervision -> 400', r.status === 400, await r.json())

    // ── Auto-apply tick respects the same gate ───────────────────────────
    r = await fetch(`${BASE_URL}/api/agent-tasks`, {
      method: 'POST', headers: buyerHeaders,
      body: JSON.stringify({ title: 'FU-483 Smoke Tick Task', description: 'Autonomous only, for the auto-apply tick', requiredCapabilities: ['research'], budgetSats: 1500, preferredSupervision: 'HUMAN' }),
    })
    const tickTaskId: string = (await r.json())?.task?.id

    const { runAgentTaskMatcherTick } = await import('../services/agent-task-matcher.js')
    await runAgentTaskMatcherTick(prisma)
    const tickApps = await prisma.agentTaskApplication.findMany({ where: { taskId: tickTaskId } })
    check('auto-apply tick skips the autonomous agent for a HUMAN-only task (no application created)', tickApps.length === 0, tickApps)

    await prisma.agentTaskApplication.deleteMany({ where: { taskId: tickTaskId } })
    await prisma.agentTask.delete({ where: { id: tickTaskId } })

    // ── GET / creatorPubkey filter: drops OPEN-only default ──────────────
    r = await fetch(`${BASE_URL}/api/agent-tasks`, {
      method: 'POST', headers: buyerHeaders,
      body: JSON.stringify({ title: 'FU-483 Smoke Cancelled Task', description: 'will be cancelled', requiredCapabilities: ['research'], budgetSats: 1500 }),
    })
    cancelledTaskId = (await r.json())?.task?.id
    r = await fetch(`${BASE_URL}/api/agent-tasks/${cancelledTaskId}`, {
      method: 'PATCH', headers: buyerHeaders, body: JSON.stringify({ action: 'cancel' }),
    })
    check('PATCH /:id cancel -> 200', r.status === 200, await r.json())

    r = await fetch(`${BASE_URL}/api/agent-tasks?creatorPubkey=${buyerPubkey}`)
    body = await r.json()
    const ids: string[] = (body?.tasks ?? []).map((t: { id: string }) => t.id)
    check('GET /?creatorPubkey= (no status) includes the CANCELLED task — OPEN-only default dropped', ids.includes(cancelledTaskId), ids)
    check('GET /?creatorPubkey= includes the still-OPEN autonomous task too', ids.includes(autonomousTaskId), ids)

    r = await fetch(`${BASE_URL}/api/agent-tasks?creatorPubkey=${buyerPubkey}&status=OPEN`)
    body = await r.json()
    const openIds: string[] = (body?.tasks ?? []).map((t: { id: string }) => t.id)
    check('GET /?creatorPubkey=&status=OPEN excludes the CANCELLED task (explicit status still applies)', !openIds.includes(cancelledTaskId), openIds)

    r = await fetch(`${BASE_URL}/api/agent-tasks?creatorPubkey=${randomBytes(32).toString('hex')}`)
    body = await r.json()
    check('GET /?creatorPubkey= for an unrelated pubkey returns none of this buyer\'s tasks', !(body?.tasks ?? []).some((t: { id: string }) => ids.includes(t.id)), body?.tasks)
  } finally {
    await prisma.agentTaskApplication.deleteMany({ where: { taskId: { in: [autonomousTaskId, noPreferenceTaskId, cancelledTaskId].filter(Boolean) } } })
    await prisma.agentTask.deleteMany({ where: { creatorPubkey: buyerPubkey } })
    await prisma.offer.deleteMany({ where: { creatorPubkey: { in: [humanAgentOwnerPubkey, autoAgentOwnerPubkey] } } })
    await prisma.agentProfile.deleteMany({ where: { ownerPubkey: { in: [humanAgentOwnerPubkey, autoAgentOwnerPubkey] } } })
    await prisma.session.deleteMany({ where: { pubkey: { in: [buyerPubkey, humanAgentOwnerPubkey, autoAgentOwnerPubkey] } } })
    // ADR-397 D2-B: the poster's paying wallet (Wallet has no cascade).
    await prisma.wallet.deleteMany({ where: { user: { pubkey: buyerPubkey } } })
    await prisma.user.deleteMany({ where: { pubkey: { in: [buyerPubkey, humanAgentOwnerPubkey, autoAgentOwnerPubkey] } } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
