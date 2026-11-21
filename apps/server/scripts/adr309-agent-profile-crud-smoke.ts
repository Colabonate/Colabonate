// ADR-309 / FU-346 live smoke test: verifies the new AgentProfile CRUD API
// (POST/GET/PATCH /api/agent-profiles) the Agent Creation Wizard depends on.
// Run with:
//   DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr309-agent-profile-crud-smoke.ts
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
  const ownerPubkey = randomBytes(32).toString('hex')
  const otherPubkey = randomBytes(32).toString('hex')
  const ownerToken = randomBytes(32).toString('hex')
  const otherToken = randomBytes(32).toString('hex')

  await prisma.user.create({ data: { pubkey: ownerPubkey, identityLevel: 2 } })
  await prisma.user.create({ data: { pubkey: otherPubkey, identityLevel: 2 } })
  await prisma.session.create({ data: { pubkey: ownerPubkey, k1: randomUUID(), token: ownerToken, expiresAt: new Date(Date.now() + 3600_000) } })
  await prisma.session.create({ data: { pubkey: otherPubkey, k1: randomUUID(), token: otherToken, expiresAt: new Date(Date.now() + 3600_000) } })

  const ownerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` }
  const otherHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${otherToken}` }

  let createdId: string | undefined
  try {
    // 1. Unauthenticated -> 401
    let r = await fetch(`${BASE_URL}/api/agent-profiles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x', capabilities: ['a'] }) })
    check('POST without auth -> 401', r.status === 401, await r.json())

    // 2. Missing capabilities -> 400
    r = await fetch(`${BASE_URL}/api/agent-profiles`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ name: 'Smoke Agent 309' }) })
    check('POST without capabilities -> 400', r.status === 400, await r.json())

    // 3. Valid create -> 201
    r = await fetch(`${BASE_URL}/api/agent-profiles`, {
      method: 'POST', headers: ownerHeaders,
      body: JSON.stringify({ name: 'Smoke Agent 309', description: 'test', capabilities: ['code-review', 'text-generation'], tools: [{ name: 'python', description: 'exec' }] }),
    })
    let body = await r.json()
    check('POST valid agent profile -> 201', r.status === 201, body)
    check('requireHumanApproval defaults to true', body?.agentProfile?.requireHumanApproval === true, body)
    createdId = body?.agentProfile?.id

    // 4. GET / lists only the caller's own profiles
    r = await fetch(`${BASE_URL}/api/agent-profiles`, { headers: ownerHeaders })
    body = await r.json()
    check('GET / (owner) includes the created profile', body?.agentProfiles?.some((p: { id: string }) => p.id === createdId), body)

    r = await fetch(`${BASE_URL}/api/agent-profiles`, { headers: otherHeaders })
    body = await r.json()
    check('GET / (other user) does not include it', !body?.agentProfiles?.some((p: { id: string }) => p.id === createdId), body)

    // 5. GET /:id — not public, owner can see it, other user cannot
    r = await fetch(`${BASE_URL}/api/agent-profiles/${createdId}`, { headers: ownerHeaders })
    check('GET /:id (owner) -> 200', r.status === 200, await r.json())
    r = await fetch(`${BASE_URL}/api/agent-profiles/${createdId}`, { headers: otherHeaders })
    check('GET /:id (non-owner, not public) -> 404', r.status === 404, await r.json())

    // 6. PATCH by non-owner -> 403
    r = await fetch(`${BASE_URL}/api/agent-profiles/${createdId}`, { method: 'PATCH', headers: otherHeaders, body: JSON.stringify({ name: 'hijacked' }) })
    check('PATCH by non-owner -> 403', r.status === 403, await r.json())

    // 7. PATCH by owner -> 200, persisted
    r = await fetch(`${BASE_URL}/api/agent-profiles/${createdId}`, { method: 'PATCH', headers: ownerHeaders, body: JSON.stringify({ humanInLoop: true, requireHumanApproval: false }) })
    body = await r.json()
    check('PATCH by owner -> 200', r.status === 200, body)
    check('humanInLoop + requireHumanApproval persisted', body?.agentProfile?.humanInLoop === true && body?.agentProfile?.requireHumanApproval === false, body)
  } finally {
    if (createdId) await prisma.agentProfile.deleteMany({ where: { id: createdId } })
    await prisma.session.deleteMany({ where: { pubkey: { in: [ownerPubkey, otherPubkey] } } })
    await prisma.user.deleteMany({ where: { pubkey: { in: [ownerPubkey, otherPubkey] } } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
