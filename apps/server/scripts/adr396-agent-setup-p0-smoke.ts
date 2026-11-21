// ADR-396 P0 live smoke (FU-849/850/851) over real HTTP against a throwaway
// server instance —
//   1. The sealed agent config never leaves the server on public reads
//      (offer detail, offer list) — FU-850.
//   2. GET /api/offers/:id/sealed-config: owner gets the blob, others 403.
//   3. PATCH to ACTIVE without resending the seal still passes the publish
//      gate (the omit opt-in on the PATCH read works).
//   4. agentConfigMeta.runtime is sanitized; an unknown provider is 400; the
//      buyer detail carries the public agent facts — FU-849.
//   5. A booking pins the config (snapshot + SHA-256); later offer edits do not
//      change it; GET /api/tickets/:id/agent-config-seal is seller-only — FU-851.
// Run (spin a throwaway server first — the :4001 dev instance does not hot-reload):
//   APP_PORT=4098 npx tsx apps/server/index.ts
//   BASE_URL=http://localhost:4098 DATABASE_URL=<from .env> npx tsx apps/server/scripts/adr396-agent-setup-p0-smoke.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { createHash, randomBytes, randomUUID } from 'node:crypto'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4098'
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, detail ?? '') }
}

async function makeUser(withRail: boolean) {
  const pubkey = randomBytes(32).toString('hex')
  const token = randomBytes(32).toString('hex')
  const user = await prisma.user.create({ data: { pubkey, identityLevel: 2 } })
  await prisma.session.create({ data: { pubkey, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 3600_000) } })
  if (withRail) {
    await prisma.wallet.create({
      data: {
        userId: user.id, provider: 'CASHU', mode: 'NON_CUSTODIAL', status: 'ACTIVE',
        cashuReceivePubkey: '02' + randomBytes(32).toString('hex'), cashuReceiveMintUrl: 'https://adr396-mint.test.invalid',
      },
    })
  }
  return { pubkey, userId: user.id, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }
}

const SEAL_A = Buffer.from('sealed-config-version-A').toString('base64')
const SEAL_B = Buffer.from('sealed-config-version-B').toString('base64')

async function main() {
  const seller = await makeUser(true)
  const buyer = await makeUser(true)
  const call = (h: Record<string, string> | null, path: string, method = 'GET', body?: unknown) =>
    fetch(`${BASE_URL}${path}`, { method, headers: h ?? { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

  const profile = await prisma.agentProfile.create({
    data: {
      ownerPubkey: seller.pubkey, name: 'ADR396 Agent', capabilities: ['research'],
      tools: [{ name: 'search', description: 'Web search' }], requireHumanApproval: false, humanInLoop: true,
    },
  })
  const category = await prisma.standardCategory.findFirst({ where: { offerType: 'SERVICE', level: 2 }, select: { slug: true } })

  const base = {
    title: 'ADR396 Research Agent', description: 'smoke', priceSats: 1000, offerType: 'AGENT_SETUP',
    agentProfileId: profile.id, agentBillingModel: 'ONE_TIME', estimatedWorkspaceHours: 2, ticketType: 'SMART_ORDER',
    categoryCode: category?.slug,
  }

  try {
    // ── 4a: unknown runtime provider is rejected ────────────────────────
    let r = await call(seller.headers, '/api/offers', 'POST', {
      ...base, status: 'DRAFT', agentConfigSealed: SEAL_A,
      agentConfigMeta: { capabilities: ['research'], runtime: { provider: 'gemini', model: 'x' } },
    })
    check('4a unknown runtime provider -> 400', r.status === 400, { status: r.status })

    // ── create DRAFT with seal + runtime ────────────────────────────────
    r = await call(seller.headers, '/api/offers', 'POST', {
      ...base, status: 'DRAFT', agentConfigSealed: SEAL_A,
      agentConfigMeta: { capabilities: ['research'], runtime: { provider: 'anthropic', model: '  claude-sonnet-5 ', apiKey: 'must-not-survive' } },
    })
    let data = await r.json()
    check('create AGENT_SETUP draft -> 200', r.status === 200, { status: r.status, data })
    const offerId: string = data.offer?.id
    check('1a create response does not echo the seal', data.offer?.agentConfigSealed === undefined, data.offer?.agentConfigSealed)

    // ── 3: PATCH to ACTIVE without resending the seal ──────────────────
    r = await call(seller.headers, `/api/offers/${offerId}`, 'PATCH', { status: 'ACTIVE' })
    check('3 PATCH to ACTIVE without resending the seal passes the gate', r.status === 200, { status: r.status, body: await r.text() })

    // ── 1: public reads never carry the seal ───────────────────────────
    r = await call(null, `/api/offers/${offerId}`)
    data = await r.json()
    const detail = data.offer ?? data
    check('1b public offer detail has no agentConfigSealed', detail && !('agentConfigSealed' in detail), Object.keys(detail ?? {}))
    r = await call(null, `/api/offers?creatorPubkey=${seller.pubkey}`)
    data = await r.json()
    const listed = (data.offers ?? []).find((o: { id: string }) => o.id === offerId)
    check('1c offer list has no agentConfigSealed', !!listed && !('agentConfigSealed' in listed), listed && Object.keys(listed))

    // ── 4: runtime sanitized + public agent facts ──────────────────────
    const rt = detail.agentConfigMeta?.runtime ?? {}
    check('4b runtime sanitized to provider+model only (apiKey stripped, model trimmed)',
      rt.provider === 'anthropic' && rt.model === 'claude-sonnet-5' && Object.keys(rt).length === 2, rt)
    const ap = detail.agentProfile ?? {}
    check('4c detail carries public agent facts', Array.isArray(ap.capabilities) && ap.capabilities.includes('research')
      && Array.isArray(ap.tools) && ap.tools[0]?.name === 'search' && ap.requireHumanApproval === false && ap.humanInLoop === true, ap)
    check('4d detail carries billing + duration', detail.agentBillingModel === 'ONE_TIME' && detail.estimatedWorkspaceHours === 2, {
      billing: detail.agentBillingModel, hours: detail.estimatedWorkspaceHours })

    // ── 2: owner-only sealed-config endpoint ───────────────────────────
    r = await call(buyer.headers, `/api/offers/${offerId}/sealed-config`)
    check('2a stranger sealed-config -> 403', r.status === 403, { status: r.status })
    r = await call(null, `/api/offers/${offerId}/sealed-config`)
    check('2b anonymous sealed-config -> 401', r.status === 401, { status: r.status })
    r = await call(seller.headers, `/api/offers/${offerId}/sealed-config`)
    data = await r.json()
    check('2c owner sealed-config returns the blob', r.status === 200 && data.agentConfigSealed === SEAL_A, data)

    // ── 5: booking pins the config ─────────────────────────────────────
    r = await call(buyer.headers, '/api/tickets', 'POST', { offerId })
    data = await r.json()
    const ticketId: string | undefined = data.ticket?.id ?? data.id
    check('5a buyer books the agent -> 2xx', r.status >= 200 && r.status < 300 && !!ticketId, { status: r.status, data })
    if (ticketId) {
      const t = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { agentConfigSealedSnapshot: true, agentConfigHash: true } })
      check('5b ticket pins the sealed config', t?.agentConfigSealedSnapshot === SEAL_A, t)
      check('5c ticket stores its SHA-256', t?.agentConfigHash === createHash('sha256').update(SEAL_A).digest('hex'), t?.agentConfigHash)

      r = await call(seller.headers, `/api/offers/${offerId}`, 'PATCH', { agentConfigSealed: SEAL_B })
      check('5d seller re-seals the offer later', r.status === 200, { status: r.status })

      r = await call(seller.headers, `/api/tickets/${ticketId}/agent-config-seal`)
      data = await r.json()
      check('5e booking keeps the pinned config after the offer edit', data.agentConfigSealed === SEAL_A && data.pinned === true, data)
      r = await call(buyer.headers, `/api/tickets/${ticketId}/agent-config-seal`)
      check('5f buyer cannot read the seller seal -> 403', r.status === 403, { status: r.status })
      r = await call(seller.headers, `/api/offers/${offerId}/sealed-config`)
      data = await r.json()
      check('5g the offer itself now carries the new seal', data.agentConfigSealed === SEAL_B, data)
    }
  } finally {
    const pubkeys = [seller.pubkey, buyer.pubkey]
    const offerIds = (await prisma.offer.findMany({ where: { creatorPubkey: seller.pubkey }, select: { id: true } })).map(o => o.id)
    await prisma.notification.deleteMany({ where: { ownerPubkey: { in: pubkeys } } })
    await prisma.ticket.deleteMany({ where: { offerId: { in: offerIds } } })
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: offerIds } } })
    await prisma.offer.deleteMany({ where: { id: { in: offerIds } } })
    await prisma.agentProfile.deleteMany({ where: { ownerPubkey: seller.pubkey } })
    await prisma.wallet.deleteMany({ where: { userId: { in: [seller.userId, buyer.userId] } } })
    await prisma.session.deleteMany({ where: { pubkey: { in: pubkeys } } })
    await prisma.user.deleteMany({ where: { pubkey: { in: pubkeys } } })
    await prisma.$disconnect()
  }

  console.log(`\nADR-396 P0 smoke: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
