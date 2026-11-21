// ADR-351 live smoke test: Workspace compute funding (mandatory init +
// recharge) resolves against Colabonate's own platform wallet, not the
// seller — proven by using a seller with ZERO wallets/lnAddress configured
// at all, which would have failed with 422 SELLER_PAYMENT_NOT_CONFIGURED
// before this ADR. Requires the server under test to run with BETA_MODE=true
// and PLATFORM_LN_ADDRESS unset, so resolvePlatformInvoice falls back to the
// DEMO rail (no real Lightning Address needed for this smoke).
//
// Run with:
//   DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr351-platform-funding-smoke.ts
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
  const sellerPubkey = randomBytes(32).toString('hex')
  const buyerToken = randomBytes(32).toString('hex')

  await prisma.user.create({ data: { pubkey: buyerPubkey, identityLevel: 2 } })
  // Deliberately NO wallet, NO lnAddress for the seller — the whole point of
  // this smoke is that workspace funding no longer depends on it.
  await prisma.user.create({ data: { pubkey: sellerPubkey, identityLevel: 2 } })
  await prisma.session.create({ data: { pubkey: buyerPubkey, k1: randomUUID(), token: buyerToken, expiresAt: new Date(Date.now() + 3600_000) } })

  const agentProfile = await prisma.agentProfile.create({
    data: { ownerPubkey: sellerPubkey, name: 'smoke-350-agent', capabilities: ['research'], tools: [], isPublic: true },
  })
  const offer = await prisma.offer.create({
    data: {
      title: 'ADR-351 Smoke Agent Offer', priceSats: 2000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'ACTIVE',
      creatorPubkey: sellerPubkey, agentProfileId: agentProfile.id, agentConfigSealed: 'fake', agentConfigMeta: { capabilities: ['research'] },
      estimatedWorkspaceHours: 1,
    },
  })
  const ticket = await prisma.ticket.create({
    data: { offerId: offer.id, offerType: 'AGENT_SETUP', buyerPubkey, sellerPubkey, status: 'PAID' },
  })

  const buyerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${buyerToken}` }

  try {
    // Workspace creation must succeed despite the seller having zero
    // configured payment methods — pre-ADR-351 this would 422.
    let r = await fetch(`${BASE_URL}/api/workspaces`, { method: 'POST', headers: buyerHeaders, body: JSON.stringify({ ticketId: ticket.id }) })
    let body = await r.json()
    check('create workspace with zero-wallet seller -> 201 (not 422)', r.status === 201, body)
    check('mandatoryFunding present on create response', body?.mandatoryFunding?.recharge != null, body)
    check('mandatory recharge resolves DEMO rail (platform fallback, not seller)', body?.mandatoryFunding?.recharge?.rail === 'DEMO', body)
    const workspaceId = body?.workspace?.id as string
    const rechargeId = body?.mandatoryFunding?.recharge?.id as string

    // GET /:id must surface the same pending mandatory-funding state.
    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}`, { headers: buyerHeaders })
    body = await r.json()
    check('GET /:id includes mandatoryFunding', body?.workspace?.mandatoryFunding?.id === rechargeId, body)
    check('GET /:id mandatoryFunding status PENDING', body?.workspace?.mandatoryFunding?.status === 'PENDING', body)

    // Confirm (DEMO rail — no preimage needed) unlocks the mandatory funding.
    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/recharge/${rechargeId}/confirm`, { method: 'POST', headers: buyerHeaders, body: JSON.stringify({}) })
    body = await r.json()
    check('confirm mandatory funding -> PAID', r.status === 200 && body?.recharge?.status === 'PAID', body)

    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}`, { headers: buyerHeaders })
    body = await r.json()
    check('GET /:id mandatoryFunding now PAID', body?.workspace?.mandatoryFunding?.status === 'PAID', body)

    // Voluntary recharge is gated to RUNNING/SUSPENDED — base mode (no
    // canister backend configured) never flips PENDING_DEPLOY -> RUNNING on
    // its own, so simulate it via a direct DB write, mirroring
    // adr311-workspace-smoke.ts's base-mode convention.
    await prisma.workspace.update({ where: { id: workspaceId }, data: { status: 'RUNNING' } })

    // Voluntary recharge also resolves against the platform, not the seller.
    r = await fetch(`${BASE_URL}/api/workspaces/${workspaceId}/recharge`, { method: 'POST', headers: buyerHeaders, body: JSON.stringify({ amountSats: 500 }) })
    body = await r.json()
    check('voluntary recharge with zero-wallet seller -> 201 (not 422)', r.status === 201, body)
    check('voluntary recharge resolves DEMO rail (platform fallback)', body?.recharge?.rail === 'DEMO', body)
  } finally {
    await prisma.workspaceRecharge.deleteMany({ where: { workspace: { ticketId: ticket.id } } })
    await prisma.workspace.deleteMany({ where: { ticketId: ticket.id } })
    await prisma.ticket.delete({ where: { id: ticket.id } })
    await prisma.offer.delete({ where: { id: offer.id } })
    await prisma.agentProfile.delete({ where: { id: agentProfile.id } })
    await prisma.session.deleteMany({ where: { pubkey: buyerPubkey } })
    await prisma.user.deleteMany({ where: { pubkey: { in: [buyerPubkey, sellerPubkey] } } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
