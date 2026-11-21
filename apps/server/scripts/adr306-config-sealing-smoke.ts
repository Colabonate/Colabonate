// ADR-306 D5 live smoke test: verifies that publishing an AGENT_SETUP offer
// as ACTIVE requires a non-empty agentConfigSealed blob, on both POST and
// PATCH, against the running dev server + local Postgres. Run with:
//   DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr306-config-sealing-smoke.ts
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
  // ADR-253: ACTIVE direct-pay listings need a resolvable seller payment
  // method — set one directly so this smoke isolates the ADR-306 D5 gate.
  // A Cashu rail resolves without any network call; a fake LN address no
  // longer counts since FU-754 (non-routable addresses are rejected).
  const user = await prisma.user.create({ data: { pubkey, identityLevel: 2 } })
  await prisma.wallet.create({
    data: {
      userId: user.id, provider: 'CASHU', mode: 'NON_CUSTODIAL', status: 'ACTIVE',
      cashuReceivePubkey: '02' + randomBytes(32).toString('hex'), cashuReceiveMintUrl: 'https://smoke-mint.test.invalid',
    },
  })
  await prisma.session.create({
    data: { pubkey, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 3600_000) },
  })
  const agentProfile = await prisma.agentProfile.create({
    data: {
      ownerPubkey: pubkey,
      name: 'smoke-test-agent-306',
      capabilities: ['text-generation'],
      tools: [{ name: 'python', description: 'exec', protocol: 'stdio' }],
      isPublic: true,
    },
  })

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const post = (body: unknown) => fetch(`${BASE_URL}/api/offers`, { method: 'POST', headers, body: JSON.stringify(body) })
  const patch = (id: string, body: unknown) => fetch(`${BASE_URL}/api/offers/${id}`, { method: 'PATCH', headers, body: JSON.stringify(body) })

  const sealedBlob = Buffer.from('fake-nip44-ciphertext').toString('base64')
  const base = {
    title: 'Config-Sealing Smoke Agent', priceSats: 2500, categoryCode: 'services/other', offerType: 'AGENT_SETUP',
    agentProfileId: agentProfile.id,
    agentConfigMeta: { capabilities: ['text-generation'] },
  }

  let createdId: string | undefined
  try {
    // 1. ACTIVE without agentConfigSealed -> 400
    let r = await post({ ...base, status: 'ACTIVE' })
    check('POST ACTIVE without agentConfigSealed -> 400', r.status === 400, await r.json())

    // 2. DRAFT without agentConfigSealed -> 200 (D5 only gates ACTIVE)
    r = await post({ ...base, status: 'DRAFT' })
    let body = await r.json()
    check('POST DRAFT without agentConfigSealed -> 200', r.status === 200, body)
    createdId = body?.offer?.id

    // 3. ACTIVE with agentConfigSealed -> 200
    r = await post({ ...base, status: 'ACTIVE', agentConfigSealed: sealedBlob })
    body = await r.json()
    check('POST ACTIVE with agentConfigSealed -> 200', r.status === 200, body)
    // ADR-396 D4 (FU-850): the seal is no longer echoed by offer responses —
    // verify persistence through the owner-only endpoint instead.
    check('offer response does not echo the seal (ADR-396 D4)', body?.offer?.agentConfigSealed === undefined, body?.offer?.agentConfigSealed)
    const sealRes = await fetch(`${BASE_URL}/api/offers/${body?.offer?.id}/sealed-config`, { headers })
    const sealBody = await sealRes.json()
    check('offer.agentConfigSealed persisted (owner-only read)', sealBody?.agentConfigSealed === sealedBlob, sealBody)

    // 4. PATCH the DRAFT offer from #2 to ACTIVE without ever supplying a
    // sealed blob -> 400 (D5 applies to the merged/resulting state, not just creation)
    if (!createdId) throw new Error('setup: DRAFT offer id missing')
    r = await patch(createdId, { status: 'ACTIVE' })
    check('PATCH DRAFT -> ACTIVE without agentConfigSealed -> 400', r.status === 400, await r.json())

    // 5. PATCH the same offer, supplying agentConfigSealed alongside ACTIVE -> 200
    r = await patch(createdId, { status: 'ACTIVE', agentConfigSealed: sealedBlob })
    body = await r.json()
    check('PATCH DRAFT -> ACTIVE with agentConfigSealed -> 200', r.status === 200, body)
  } finally {
    await prisma.offer.deleteMany({ where: { creatorPubkey: pubkey } })
    await prisma.agentProfile.deleteMany({ where: { ownerPubkey: pubkey } })
    await prisma.session.deleteMany({ where: { pubkey } })
    await prisma.wallet.deleteMany({ where: { user: { pubkey } } })
    await prisma.user.deleteMany({ where: { pubkey } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
