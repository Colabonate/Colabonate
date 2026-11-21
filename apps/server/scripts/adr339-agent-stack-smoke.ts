// ADR-339 live smoke test: exercises the Agent Stack backend over real HTTP
// against a throwaway server instance —
//   D1: roster owned entries carry the newest non-archived AGENT_SETUP offer
//       projection; GET /api/agent-profiles/:id returns the sibling `offer`.
//   D3: online/offline toggle via PATCH /api/offers/:id (ADR-306 seal gate on
//       ACTIVE, DRAFT always allowed).
//   D5: ADR-340 promoted agent-catalog CRUD + membership to the unified
//       /api/catalog router with type=AGENT_SETUP + PUT /:id/agents.
// Run with (spin a throwaway server first — the :4001 dev instance does not
// hot-reload):
//   $env:APP_PORT='4099'; npx tsx apps/server/index.ts
//   $env:DATABASE_URL='<from .env>'; npx tsx apps/server/scripts/adr339-agent-stack-smoke.ts
// (BASE_URL defaults to http://localhost:4099)
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4099'
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
  // lnAddress satisfies ADR-253's seller-payment gate so the status-toggle
  // tests reach the ADR-306 seal gate instead of a 422.
  await prisma.user.create({ data: { pubkey, identityLevel: 2, lnAddress: 'smoke@ln.tld' } })
  await prisma.session.create({
    data: { pubkey, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 3600_000) },
  })
  const agentProfile = await prisma.agentProfile.create({
    data: {
      ownerPubkey: pubkey,
      name: 'adr339-smoke-agent',
      capabilities: ['text-generation'],
      tools: [],
      isPublic: true,
    },
  })
  const otherPubkey = randomBytes(32).toString('hex')
  await prisma.user.create({ data: { pubkey: otherPubkey } })
  const otherProfile = await prisma.agentProfile.create({
    data: { ownerPubkey: otherPubkey, name: 'not-mine', capabilities: ['x'], tools: [] },
  })

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const call = (path: string, method = 'GET', body?: unknown) =>
    fetch(`${BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })

  try {
    // ── D1: roster offer projection ─────────────────────────────────────
    let r = await call('/api/agent-profiles/roster')
    let data = await r.json()
    check('roster -> 200', r.status === 200)
    let ownedEntry = data?.owned?.find((p: { id: string }) => p.id === agentProfile.id)
    check('roster owned entry present', Boolean(ownedEntry))
    check('roster entry offer null before any listing', ownedEntry?.offer === null, ownedEntry?.offer)

    const offer = await prisma.offer.create({
      data: {
        title: 'Smoke Setup',
        priceSats: 1234,
        categoryCode: 'services/other',
        offerType: 'AGENT_SETUP',
        ticketType: 'SMART_ORDER',
        creatorPubkey: pubkey,
        agentProfileId: agentProfile.id,
        agentConfigSealed: Buffer.from('sealed-blob').toString('base64'),
        agentConfigMeta: { capabilities: ['text-generation'] },
        agentBillingModel: 'ONE_TIME',
        agentWorkspaceTTL: 604800,
        status: 'DRAFT',
        images: ['https://example.com/a.png', 'https://example.com/b.png'],
      },
    })

    r = await call('/api/agent-profiles/roster')
    data = await r.json()
    ownedEntry = data?.owned?.find((p: { id: string }) => p.id === agentProfile.id)
    check('roster offer projected (DRAFT)', ownedEntry?.offer?.id === offer.id, ownedEntry?.offer)
    check('roster offer carries images + price', Array.isArray(ownedEntry?.offer?.images) && ownedEntry?.offer?.priceSats === 1234, ownedEntry?.offer)

    await prisma.offer.update({ where: { id: offer.id }, data: { status: 'ARCHIVED' } })
    r = await call('/api/agent-profiles/roster')
    data = await r.json()
    ownedEntry = data?.owned?.find((p: { id: string }) => p.id === agentProfile.id)
    check('roster offer null when archived (excluded from stack)', ownedEntry?.offer === null, ownedEntry?.offer)
    await prisma.offer.update({ where: { id: offer.id }, data: { status: 'DRAFT' } })

    r = await call(`/api/agent-profiles/${agentProfile.id}`)
    data = await r.json()
    check('GET /:id returns sibling offer', data?.offer?.id === offer.id, data?.offer)
    check('GET /:id hides admin-only verification fields', !('verifiedByPubkey' in (data?.agentProfile ?? {})))

    // ── D3: online/offline toggle via PATCH /api/offers/:id ────────────
    r = await call(`/api/offers/${offer.id}`, 'PATCH', { status: 'ACTIVE' })
    check('toggle online (ACTIVE, sealed) -> 200', r.status === 200, await r.json())
    r = await call(`/api/offers/${offer.id}`, 'PATCH', { status: 'DRAFT' })
    check('toggle offline (DRAFT) -> 200', r.status === 200, await r.json())

    const unsealedOffer = await prisma.offer.create({
      data: {
        title: 'Unsealed Setup', priceSats: 10, categoryCode: 'services/other',
        offerType: 'AGENT_SETUP', ticketType: 'SMART_ORDER', creatorPubkey: pubkey,
        agentProfileId: agentProfile.id, agentConfigMeta: { capabilities: ['x'] }, status: 'DRAFT',
      },
    })
    r = await call(`/api/offers/${unsealedOffer.id}`, 'PATCH', { status: 'ACTIVE' })
    check('ACTIVE without seal blocked (ADR-306 gate)', r.status === 400, await r.json())

    // ── D5: ADR-340 unified /api/catalog with type=AGENT_SETUP + PUT /:id/agents
    r = await call('/api/catalog', 'POST', { name: 'Research Crew', type: 'AGENT_SETUP' })
    data = await r.json()
    check('create agent catalog -> 201', r.status === 201 && data?.catalog?.name === 'Research Crew', data)
    const catalogId = data?.catalog?.id
    r = await call('/api/catalog', 'POST', { name: 'Research Crew', type: 'AGENT_SETUP' })
    check('duplicate name -> 400 DUPLICATE_NAME', r.status === 400 && (await r.json())?.error === 'DUPLICATE_NAME')
    r = await call('/api/catalog', 'POST', { name: '   ', type: 'AGENT_SETUP' })
    check('empty name -> 400', r.status === 400)

    r = await call(`/api/catalog/${catalogId}/agents`, 'PUT', { agentProfileId: agentProfile.id, member: true })
    check('assign own profile -> 200', r.status === 200, await r.json())
    r = await call(`/api/catalog/${catalogId}/agents`, 'PUT', { agentProfileId: agentProfile.id, member: true })
    check('double-assign idempotent -> 200', r.status === 200)
    r = await call(`/api/catalog/${catalogId}/agents`, 'PUT', { agentProfileId: otherProfile.id, member: true })
    check('assign foreign profile -> 403', r.status === 403, await r.json())

    r = await call('/api/catalog?mine=1')
    data = await r.json()
    const listed = data?.catalogs?.find((c: { id: string }) => c.id === catalogId)
    check('mine=1 lists agent catalog', listed?.catalogType === 'AGENT_SETUP')
    check('mine=1 shows member', listed?.agentMembers?.[0]?.agentProfileId === agentProfile.id, listed)

    r = await call(`/api/catalog/${catalogId}`, 'PATCH', { name: 'Research Crew II' })
    check('rename catalog -> 200', r.status === 200 && (await r.json())?.catalog?.name === 'Research Crew II')

    // Foreign owner is locked out of someone else's catalog.
    const foreignToken = randomBytes(32).toString('hex')
    await prisma.session.create({
      data: { pubkey: otherPubkey, k1: randomUUID(), token: foreignToken, expiresAt: new Date(Date.now() + 3600_000) },
    })
    r = await fetch(`${BASE_URL}/api/catalog/${catalogId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${foreignToken}` },
    })
    check('foreign DELETE catalog -> 403', r.status === 403)

    r = await call(`/api/catalog/${catalogId}/agents`, 'PUT', { agentProfileId: agentProfile.id, member: false })
    check('unassign member -> 200', r.status === 200)
    r = await call(`/api/catalog/${catalogId}/agents`, 'PUT', { agentProfileId: agentProfile.id, member: false })
    check('double-unassign idempotent -> 200', r.status === 200)

    r = await call(`/api/catalog/${catalogId}`, 'DELETE')
    check('delete catalog -> 200', r.status === 200)
    const memberRows = await prisma.catalogAgentMember.count({ where: { catalogId } })
    check('delete cascades members away', memberRows === 0)
    r = await call('/api/catalog?mine=1')
    data = await r.json()
    check('catalog gone from mine list', !data?.catalogs?.some((c: { id: string }) => c.id === catalogId))
  } finally {
    await prisma.offer.deleteMany({ where: { creatorPubkey: pubkey } })
    await prisma.catalog.deleteMany({ where: { ownerPubkey: pubkey } })
    await prisma.agentProfile.deleteMany({ where: { ownerPubkey: { in: [pubkey, otherPubkey] } } })
    await prisma.session.deleteMany({ where: { pubkey: { in: [pubkey, otherPubkey] } } })
    await prisma.user.deleteMany({ where: { pubkey: { in: [pubkey, otherPubkey] } } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
