// FU-492/493/495 live smoke test (ADR-326 D10.3/D10.4/D10.7) — exercises the
// companyId ownership validation + derivation chain over real HTTP against a
// throwaway server instance:
//   FU-492: POST/PATCH /api/agent-profiles accept + ownership-validate companyId.
//   FU-493: POST/PATCH /api/offers derive an AGENT_SETUP offer's companyId
//           from its AgentProfile.companyId, ignoring any client-sent value.
//   FU-495: POST/PATCH /api/agent-networks accept + ownership-validate companyId.
// Run with (spin a throwaway server first — the :4001 dev instance does not
// hot-reload):
//   $env:APP_PORT='4099'; npx tsx apps/server/index.ts
//   $env:DATABASE_URL='<from .env>'; npx tsx apps/server/scripts/fu492-495-agent-company-branding-smoke.ts
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

async function makeUser(withLnAddress = true) {
  const pubkey = randomBytes(32).toString('hex')
  const token = randomBytes(32).toString('hex')
  await prisma.user.create({ data: { pubkey, identityLevel: 2, ...(withLnAddress ? { lnAddress: `${pubkey.slice(0, 8)}@ln.tld` } : {}) } })
  await prisma.session.create({
    data: { pubkey, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 3600_000) },
  })
  return { pubkey, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }
}

async function main() {
  const owner = await makeUser()
  const stranger = await makeUser()

  const call = (headers: Record<string, string>, path: string, method = 'GET', body?: unknown) =>
    fetch(`${BASE_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })

  const cleanup = { agentProfileIds: [] as string[], offerIds: [] as string[], companyIds: [] as string[], networkIds: [] as string[] }

  try {
    const ownerCompany = await prisma.company.create({ data: { ownerPubkey: owner.pubkey, name: 'fu492-owner-co' } })
    const strangerCompany = await prisma.company.create({ data: { ownerPubkey: stranger.pubkey, name: 'fu492-stranger-co' } })
    cleanup.companyIds.push(ownerCompany.id, strangerCompany.id)

    // ── FU-492: POST /api/agent-profiles companyId ownership ───────────
    let r = await call(owner.headers, '/api/agent-profiles', 'POST', {
      name: 'fu492-agent', capabilities: ['writing'], companyId: strangerCompany.id,
    })
    check('POST agent-profile w/ someone else\'s companyId -> 400', r.status === 400, { status: r.status, body: await r.json() })

    r = await call(owner.headers, '/api/agent-profiles', 'POST', {
      name: 'fu492-agent', capabilities: ['writing'], companyId: ownerCompany.id,
    })
    let data = await r.json()
    check('POST agent-profile w/ own companyId -> 201', r.status === 201, { status: r.status, data })
    const agentProfileId = data.agentProfile?.id as string
    cleanup.agentProfileIds.push(agentProfileId)
    check('agent-profile companyId persisted', data.agentProfile?.companyId === ownerCompany.id, data.agentProfile)

    // ── FU-492: PATCH clears companyId back to private ──────────────────
    r = await call(owner.headers, `/api/agent-profiles/${agentProfileId}`, 'PATCH', { companyId: null })
    data = await r.json()
    check('PATCH agent-profile companyId:null -> 200', r.status === 200, { status: r.status, data })
    check('agent-profile companyId cleared', data.agentProfile?.companyId === null, data.agentProfile)

    r = await call(owner.headers, `/api/agent-profiles/${agentProfileId}`, 'PATCH', { companyId: strangerCompany.id })
    check('PATCH agent-profile w/ someone else\'s companyId -> 400', r.status === 400, { status: r.status, body: await r.json() })

    // re-attach owner's company for the FU-493 derivation test below
    r = await call(owner.headers, `/api/agent-profiles/${agentProfileId}`, 'PATCH', { companyId: ownerCompany.id })
    data = await r.json()
    check('PATCH agent-profile re-attach own companyId -> 200', r.status === 200 && data.agentProfile?.companyId === ownerCompany.id, data)

    // ── FU-493: POST /api/offers AGENT_SETUP derives companyId, ignores client value ──
    r = await call(owner.headers, '/api/offers', 'POST', {
      title: 'fu493-agent-offer', priceSats: 1000, categoryCode: 'services/it-services',
      offerType: 'AGENT_SETUP', agentProfileId, status: 'DRAFT',
      agentConfigMeta: { capabilities: ['writing'] },
      companyId: strangerCompany.id, // deliberately wrong — must be ignored/overridden
    })
    data = await r.json()
    check('POST AGENT_SETUP offer -> 200/201', r.status === 200 || r.status === 201, { status: r.status, data })
    const offerId = data.offer?.id as string
    cleanup.offerIds.push(offerId)
    check('offer.companyId derived from AgentProfile (not the spoofed value)', data.offer?.companyId === ownerCompany.id, data.offer)

    // ── FU-493: PATCH re-derives even when companyId isn't sent at all ──
    r = await call(owner.headers, `/api/agent-profiles/${agentProfileId}`, 'PATCH', { companyId: null })
    check('agent-profile companyId cleared (2nd time) -> 200', r.status === 200)

    r = await call(owner.headers, `/api/offers/${offerId}`, 'PATCH', { title: 'fu493-agent-offer-renamed' })
    data = await r.json()
    check('PATCH offer (unrelated field) -> 200', r.status === 200, { status: r.status, data })
    check('offer.companyId re-derived to null after AgentProfile lost its company', data.offer?.companyId === null, data.offer)

    // ── FU-495: POST /api/agent-networks companyId ownership ───────────
    r = await call(owner.headers, '/api/agent-networks', 'POST', {
      name: 'fu495-network', companyId: strangerCompany.id,
    })
    check('POST agent-network w/ someone else\'s companyId -> 400', r.status === 400, { status: r.status, body: await r.json() })

    r = await call(owner.headers, '/api/agent-networks', 'POST', {
      name: 'fu495-network', companyId: ownerCompany.id,
    })
    data = await r.json()
    check('POST agent-network w/ own companyId -> 201', r.status === 201, { status: r.status, data })
    const networkId = data.network?.id as string
    cleanup.networkIds.push(networkId)
    check('agent-network companyId persisted', data.network?.companyId === ownerCompany.id, data.network)

    r = await call(owner.headers, `/api/agent-networks/${networkId}`, 'PATCH', { companyId: strangerCompany.id })
    check('PATCH agent-network w/ someone else\'s companyId -> 400', r.status === 400, { status: r.status, body: await r.json() })

    r = await call(owner.headers, `/api/agent-networks/${networkId}`, 'PATCH', { companyId: null })
    data = await r.json()
    check('PATCH agent-network companyId:null -> 200', r.status === 200 && data.network?.companyId === null, data)
  } finally {
    for (const id of cleanup.offerIds) await prisma.offer.deleteMany({ where: { id } }).catch(() => {})
    for (const id of cleanup.networkIds) await prisma.agentNetwork.deleteMany({ where: { id } }).catch(() => {})
    for (const id of cleanup.agentProfileIds) await prisma.agentProfile.deleteMany({ where: { id } }).catch(() => {})
    for (const id of cleanup.companyIds) await prisma.company.deleteMany({ where: { id } }).catch(() => {})
    await prisma.session.deleteMany({ where: { pubkey: { in: [owner.pubkey, stranger.pubkey] } } })
    await prisma.user.deleteMany({ where: { pubkey: { in: [owner.pubkey, stranger.pubkey] } } })
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  await prisma.$disconnect()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
