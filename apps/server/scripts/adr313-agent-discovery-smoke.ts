// ADR-313 D1/D2/D4/D5 live smoke test: verifies AGENT_SETUP offers are
// discoverable via GET /api/search — capability + minReputation filters,
// reputation-first default sort, and the agentProfile join the client card
// needs. Targets the DB fallback path (this dev env runs SEARCH_BACKEND=
// database; the Meili path shares the same filter-building logic but isn't
// live-verifiable without a running Meilisearch instance here).
// Run with:
//   DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr313-agent-discovery-smoke.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes } from 'node:crypto'

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
  await prisma.user.create({ data: { pubkey: ownerPubkey, identityLevel: 2 } })

  const lowRepProfile = await prisma.agentProfile.create({
    data: { ownerPubkey, name: 'smoke-313-low-rep', capabilities: ['translation'], tools: [], isPublic: true, reputationScore: 2.0 },
  })
  const highRepProfile = await prisma.agentProfile.create({
    data: { ownerPubkey, name: 'smoke-313-high-rep', capabilities: ['code-review', 'python'], tools: [], isPublic: true, reputationScore: 4.8 },
  })

  const makeOffer = (agentProfileId: string, title: string, billingModel: 'ONE_TIME' | 'PER_HOUR' = 'ONE_TIME') => prisma.offer.create({
    data: {
      title, priceSats: 3000, categoryCode: 'services/it-services', offerType: 'AGENT_SETUP', status: 'ACTIVE',
      creatorPubkey: ownerPubkey, agentProfileId, agentBillingModel: billingModel,
      agentConfigSealed: 'fake-nip44-ciphertext', agentConfigMeta: { capabilities: ['x'] },
      publishedAt: new Date(),
    },
  })
  const lowRepOffer = await makeOffer(lowRepProfile.id, 'ADR-313 Smoke Low-Rep Translator')
  const highRepOffer = await makeOffer(highRepProfile.id, 'ADR-313 Smoke High-Rep Coder', 'PER_HOUR')

  const search = (params: string) => fetch(`${BASE_URL}/api/search?${params}`).then(r => r.json())

  try {
    // 1. Basic offerType filter finds both, agentProfile join populated.
    let body = await search('offerType=AGENT_SETUP&first=50')
    const ids = (body.hits as any[]).map(h => h.id)
    check('offerType=AGENT_SETUP finds both smoke offers', ids.includes(lowRepOffer.id) && ids.includes(highRepOffer.id), ids)
    const highHit = (body.hits as any[]).find(h => h.id === highRepOffer.id)
    check('agentProfile joined onto the hit (name/capabilities/reputationScore)', highHit?.agentProfile?.name === 'smoke-313-high-rep' && highHit?.agentProfile?.reputationScore === 4.8 && Array.isArray(highHit?.agentProfile?.capabilities), highHit)

    // 2. D4 default sort: reputation desc when no explicit sort given.
    const highIdx = ids.indexOf(highRepOffer.id)
    const lowIdx = ids.indexOf(lowRepOffer.id)
    check('D4 default sort: higher-reputation agent ranks before lower-reputation one', highIdx !== -1 && lowIdx !== -1 && highIdx < lowIdx, { highIdx, lowIdx })

    // 3. D2 capability filter narrows to the matching offer only.
    body = await search('offerType=AGENT_SETUP&capability=python&first=50')
    const capIds = (body.hits as any[]).map(h => h.id)
    check('capability=python -> only the high-rep coder', capIds.includes(highRepOffer.id) && !capIds.includes(lowRepOffer.id), capIds)

    // 4. D2 minReputation filter excludes the low-rep offer.
    body = await search('offerType=AGENT_SETUP&minReputation=4&first=50')
    const repIds = (body.hits as any[]).map(h => h.id)
    check('minReputation=4 -> excludes the 2.0-reputation offer', repIds.includes(highRepOffer.id) && !repIds.includes(lowRepOffer.id), repIds)

    // 5. D2 agentBillingModel filter.
    body = await search('offerType=AGENT_SETUP&agentBillingModel=PER_HOUR&first=50')
    const billingIds = (body.hits as any[]).map(h => h.id)
    check('agentBillingModel=PER_HOUR -> only the PER_HOUR offer', billingIds.includes(highRepOffer.id) && !billingIds.includes(lowRepOffer.id), billingIds)

    // 6. Non-agent offers are unaffected by agent-only filters (regression).
    body = await search('offerType=SERVICE&capability=python&first=10')
    check('capability filter on a SERVICE query does not error (no crash)', Array.isArray(body.hits), body)
  } finally {
    await prisma.offer.deleteMany({ where: { creatorPubkey: ownerPubkey } })
    await prisma.agentProfile.deleteMany({ where: { ownerPubkey } })
    await prisma.user.deleteMany({ where: { pubkey: ownerPubkey } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
