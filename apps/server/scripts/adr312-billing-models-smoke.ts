// ADR-312 D6 live smoke test: Ticket.agentBillingModel snapshot at ticket
// creation, Workspace.agentBillingModel denormalization at workspace
// creation, and canister-side billing_model plumbing (validation +
// round-trip through create_workspace/get_workspace). Two modes:
//
// - Default (server without canister backend): only the DB-level snapshot
//   checks run (ticket/workspace rows) — nothing to verify canister-side.
// - ICP_SMOKE=1 + ICP_WORKSPACE_CANISTER_ID (same value the server under test
//   runs with): additionally verifies create_workspace rejects an unknown
//   billing_model with InvalidArgs, and that a real PER_TOKEN deploy's
//   canister view round-trips billing_model="PER_TOKEN" end to end.
//
// The actual PER_TOKEN cycle-booking formula (llm::parse_token_usage +
// billing::token_cost_cycles) is covered by cargo unit tests — verifying it
// live would need a real LLM provider key returning a genuine 2xx response
// with a usage field, which this smoke (like every other ADR-31x smoke) does
// not fabricate.
//
// Run with:
//   DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr312-billing-models-smoke.ts
//   ICP_SMOKE=1 ICP_WORKSPACE_CANISTER_ID=... ICP_WORKSPACE_SERVER_SEED=... ICP_HOST=... ... (same, against a
//   canister-configured server) — the smoke calls deployWorkspace() directly for the invalid-billing-model
//   check, so it needs its OWN identity env vars, not just the server-under-test's.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'
import { deployWorkspace, getWorkspaceCanisterClient, WorkspaceCanisterError } from '../services/workspace-canister-client.js'

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
  const icpMode = process.env.ICP_SMOKE === '1' && Boolean(process.env.ICP_WORKSPACE_CANISTER_ID)

  const buyerPubkey = randomBytes(32).toString('hex')
  const sellerPubkey = randomBytes(32).toString('hex')
  const token = randomBytes(32).toString('hex')

  await prisma.user.create({ data: { pubkey: buyerPubkey, identityLevel: 2, walletModeStrategy: 'NONCUSTODIAL_ONLY' } })
  const seller = await prisma.user.create({ data: { pubkey: sellerPubkey, identityLevel: 2 } })
  // Cashu rail: no network call to resolve (unlike lnAddress).
  await prisma.wallet.create({
    data: {
      userId: seller.id, provider: 'CASHU', mode: 'NON_CUSTODIAL', status: 'ACTIVE',
      cashuReceivePubkey: '02' + randomBytes(32).toString('hex'), cashuReceiveMintUrl: 'https://smoke-mint.test.invalid',
    },
  })
  await prisma.session.create({ data: { pubkey: buyerPubkey, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 3600_000) } })

  const agentProfile = await prisma.agentProfile.create({
    data: { ownerPubkey: sellerPubkey, name: 'smoke-312-agent', capabilities: ['research'], tools: [], isPublic: true, requireHumanApproval: false },
  })

  const makeAgentOffer = (title: string, agentBillingModel?: 'ONE_TIME' | 'PER_HOUR' | 'PER_TOKEN' | 'SUBSCRIPTION') => prisma.offer.create({
    data: {
      title, priceSats: 2000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'ACTIVE',
      creatorPubkey: sellerPubkey, agentProfileId: agentProfile.id,
      agentConfigSealed: 'fake-nip44-ciphertext', agentConfigMeta: { capabilities: ['research'] },
      agentWorkspaceTTL: 3600,
      ...(agentBillingModel ? { agentBillingModel } : {}),
    },
  })
  const perTokenOffer = await makeAgentOffer('ADR-312 Smoke PER_TOKEN Agent', 'PER_TOKEN')
  const perHourOffer = await makeAgentOffer('ADR-312 Smoke PER_HOUR Agent', 'PER_HOUR')
  const defaultOffer = await makeAgentOffer('ADR-312 Smoke Default-Billing Agent') // no agentBillingModel set
  const serviceOffer = await prisma.offer.create({
    data: { title: 'ADR-312 Smoke Service', priceSats: 2000, categoryCode: 'services/other', offerType: 'SERVICE', status: 'ACTIVE', creatorPubkey: sellerPubkey },
  })

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const createTicket = (offerId: string) => fetch(`${BASE_URL}/api/tickets`, { method: 'POST', headers, body: JSON.stringify({ offerId }) })

  try {
    // ── D6: Ticket.agentBillingModel snapshot at creation ────────────────
    let r = await createTicket(perTokenOffer.id)
    let body = await r.json()
    check('POST ticket on PER_TOKEN offer -> 200/201', r.status === 200 || r.status === 201, body)
    check('ticket snapshots agentBillingModel=PER_TOKEN from offer', body?.ticket?.agentBillingModel === 'PER_TOKEN', body)
    const perTokenTicketId = body?.ticket?.id as string

    r = await createTicket(perHourOffer.id)
    body = await r.json()
    check('ticket snapshots agentBillingModel=PER_HOUR from offer', body?.ticket?.agentBillingModel === 'PER_HOUR', body)

    r = await createTicket(defaultOffer.id)
    body = await r.json()
    check('ticket defaults to agentBillingModel=ONE_TIME when offer never set one', body?.ticket?.agentBillingModel === 'ONE_TIME', body)
    const defaultTicketId = body?.ticket?.id as string

    r = await createTicket(serviceOffer.id)
    body = await r.json()
    check('SERVICE ticket has no agentBillingModel (regression: non-AGENT_SETUP untouched)', body?.ticket?.agentBillingModel == null, body)

    // ── D6: Workspace.agentBillingModel denormalization at workspace creation ──
    // Test setup only (not exercising payment logic) — flip straight to PAID.
    await prisma.ticket.update({ where: { id: perTokenTicketId }, data: { status: 'PAID' } })
    await prisma.ticket.update({ where: { id: defaultTicketId }, data: { status: 'PAID' } })

    r = await fetch(`${BASE_URL}/api/workspaces`, { method: 'POST', headers, body: JSON.stringify({ ticketId: perTokenTicketId }) })
    body = await r.json()
    check('workspace from PER_TOKEN ticket -> 201, agentBillingModel=PER_TOKEN', r.status === 201 && body?.workspace?.agentBillingModel === 'PER_TOKEN', body)
    const perTokenCanisterWorkspaceId = body?.workspace?.canisterWorkspaceId as string | null

    r = await fetch(`${BASE_URL}/api/workspaces`, { method: 'POST', headers, body: JSON.stringify({ ticketId: defaultTicketId }) })
    body = await r.json()
    check('workspace from default-billing ticket -> 201, agentBillingModel=ONE_TIME', r.status === 201 && body?.workspace?.agentBillingModel === 'ONE_TIME', body)

    if (icpMode) {
      // ── Canister-side: real PER_TOKEN deploy round-trips billing_model ──
      check('[icp] PER_TOKEN workspace deployed via canister (has canisterWorkspaceId)', typeof perTokenCanisterWorkspaceId === 'string' && perTokenCanisterWorkspaceId.length > 0, perTokenCanisterWorkspaceId)
      const client = await getWorkspaceCanisterClient()
      const view = client && perTokenCanisterWorkspaceId ? await client.getWorkspaceView(perTokenCanisterWorkspaceId) : null
      check('[icp] canister view billing_model round-trips as PER_TOKEN', view?.billingModel === 'PER_TOKEN', view)

      // ── Canister rejects an unknown billing_model at creation ──────────
      const err = await deployWorkspace({
        workspaceId: `smoke-312-invalid-${randomUUID()}`,
        buyerPubkey,
        agentProfileId: agentProfile.id,
        ttlSeconds: 3600,
        billingModel: 'NOT_A_REAL_MODEL',
      }).catch((e) => e)
      check(
        '[icp] create_workspace with unknown billing_model -> InvalidArgs',
        err instanceof WorkspaceCanisterError && 'InvalidArgs' in err.canisterError,
        err instanceof WorkspaceCanisterError ? err.canisterError : err,
      )
    } else {
      console.log('  SKIP [icp] canister billing_model checks (set ICP_SMOKE=1 + ICP_WORKSPACE_CANISTER_ID to enable)')
    }
  } finally {
    await prisma.$disconnect()
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
