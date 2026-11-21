// ADR-305 live smoke test: creates a throwaway user/session/AgentProfile
// against the running dev server + local Postgres, then exercises the
// offers.ts AGENT_SETUP validation (D3) over real HTTP. Run with:
//   DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr305-agent-setup-smoke.ts
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
  const pubkey = randomBytes(32).toString('hex')
  const token = randomBytes(32).toString('hex')
  await prisma.user.create({ data: { pubkey, identityLevel: 2 } })
  await prisma.session.create({
    data: { pubkey, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 3600_000) },
  })
  const agentProfile = await prisma.agentProfile.create({
    data: {
      ownerPubkey: pubkey,
      name: 'smoke-test-agent',
      capabilities: ['text-generation'],
      tools: [{ name: 'python', description: 'exec', protocol: 'stdio' }],
      isPublic: true,
    },
  })
  const otherPubkey = randomBytes(32).toString('hex')
  await prisma.user.create({ data: { pubkey: otherPubkey } })
  const otherAgentProfile = await prisma.agentProfile.create({
    data: { ownerPubkey: otherPubkey, name: 'not-mine', capabilities: ['x'], tools: [] },
  })

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const post = (body: unknown) => fetch(`${BASE_URL}/api/offers`, { method: 'POST', headers, body: JSON.stringify(body) })

  try {
    // 1. Missing agentProfileId
    let r = await post({ title: 'Agent', priceSats: 1000, categoryCode: 'services/other', offerType: 'AGENT_SETUP' })
    check('missing agentProfileId -> 400', r.status === 400, await r.json())

    // 2. Foreign agentProfileId (not owned by caller)
    r = await post({ title: 'Agent', priceSats: 1000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', agentProfileId: otherAgentProfile.id, agentConfigMeta: { capabilities: ['x'] } })
    check('foreign agentProfileId -> 400', r.status === 400, await r.json())

    // 3. Missing agentConfigMeta.capabilities
    r = await post({ title: 'Agent', priceSats: 1000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', agentProfileId: agentProfile.id })
    check('missing agentConfigMeta.capabilities -> 400', r.status === 400, await r.json())

    // 4. Invalid agentBillingModel
    r = await post({ title: 'Agent', priceSats: 1000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', agentProfileId: agentProfile.id, agentConfigMeta: { capabilities: ['x'] }, agentBillingModel: 'WEEKLY' })
    check('invalid agentBillingModel -> 400', r.status === 400, await r.json())

    // 5. deliveryTemplateId not applicable
    r = await post({ title: 'Agent', priceSats: 1000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', agentProfileId: agentProfile.id, agentConfigMeta: { capabilities: ['x'] }, deliveryTimeDays: 3 })
    check('deliveryTimeDays rejected -> 400', r.status === 400, await r.json())

    // 6. agentProfileId set on non-AGENT_SETUP offer
    r = await post({ title: 'Not agent', priceSats: 1000, categoryCode: 'services/other', offerType: 'SERVICE', agentProfileId: agentProfile.id })
    check('agentProfileId on SERVICE -> 400', r.status === 400, await r.json())

    // 7. Valid AGENT_SETUP offer -> 200, fields persisted
    r = await post({
      title: 'My Agent Setup', priceSats: 5000, categoryCode: 'services/other', offerType: 'AGENT_SETUP',
      agentProfileId: agentProfile.id,
      agentConfigMeta: { capabilities: ['text-generation'], modelProvider: 'openai' },
      agentBillingModel: 'ONE_TIME',
      personaPackRef: 'nostr:event123',
    })
    const body = await r.json()
    check('valid AGENT_SETUP -> 200', r.status === 200, body)
    check('offer.agentProfileId persisted', body?.offer?.agentProfileId === agentProfile.id, body?.offer?.agentProfileId)
    check('offer.agentBillingModel persisted', body?.offer?.agentBillingModel === 'ONE_TIME', body?.offer?.agentBillingModel)
    check('offer.agentConfigMeta persisted', body?.offer?.agentConfigMeta?.capabilities?.[0] === 'text-generation', body?.offer?.agentConfigMeta)
  } finally {
    await prisma.offer.deleteMany({ where: { creatorPubkey: pubkey } })
    await prisma.agentProfile.deleteMany({ where: { ownerPubkey: { in: [pubkey, otherPubkey] } } })
    await prisma.session.deleteMany({ where: { pubkey } })
    await prisma.user.deleteMany({ where: { pubkey: { in: [pubkey, otherPubkey] } } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
