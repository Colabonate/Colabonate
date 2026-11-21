// ADR-318 D5 live smoke test: verifies the buyer-self-reported agentDisputeType
// classification on POST /tickets/:id/dispute (accepted only for AGENT_SETUP
// tickets, validated against the enum), and that a resolved DAO-Council verdict
// (POST /disputes/:id/verdict) recomputes the agent's AgentProfile.trustScore
// (ADR-317) via the ADR-318 fix to agentTrustService's dispute signal — which
// was dead code before this session (see agentTrustService.ts comment): the
// verdict routes write Ticket.status straight to COMPLETED/CANCELLED and never
// to ARBITRATION_LOST/ARBITRATION_WON, so a status-filtered dispute count
// always read 0. Also exercises the same fix in reputationService.ts
// (fetchReputationInput) for the human-reputation side of the same bug.
// Run with:
//   DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr318-dispute-accountability-smoke.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'
import { fetchReputationInput } from '../services/reputationService.js'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4001'
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const FOUNDATION_DAO_ID = 'colabonate-foundation'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { pass++; console.log(`  PASS ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`, detail ?? '') }
}

async function main() {
  const buyerPubkey = randomBytes(32).toString('hex')
  const sellerPubkey = randomBytes(32).toString('hex')
  const arbitratorPubkey = randomBytes(32).toString('hex')
  const buyerToken = randomBytes(32).toString('hex')
  const arbitratorToken = randomBytes(32).toString('hex')

  await prisma.user.create({ data: { pubkey: buyerPubkey, identityLevel: 2 } })
  const seller = await prisma.user.create({ data: { pubkey: sellerPubkey, identityLevel: 2 } })
  await prisma.user.create({ data: { pubkey: arbitratorPubkey, identityLevel: 2 } })
  await prisma.session.create({ data: { pubkey: buyerPubkey, k1: randomUUID(), token: buyerToken, expiresAt: new Date(Date.now() + 3600_000) } })
  await prisma.session.create({ data: { pubkey: arbitratorPubkey, k1: randomUUID(), token: arbitratorToken, expiresAt: new Date(Date.now() + 3600_000) } })

  const existingDao = await prisma.dao.findUnique({ where: { id: FOUNDATION_DAO_ID } })
  if (!existingDao) {
    await prisma.dao.create({
      data: {
        id: FOUNDATION_DAO_ID,
        name: 'Colabonate Foundation DAO',
        codexHash: 'deadbeef'.repeat(8),
        codexVersion: 'v0-smoke',
        codexUrl: 'docs/decisions/130-foundation-codex-bootstrap.md',
      },
    })
  }
  await prisma.daoMember.create({
    data: { daoId: FOUNDATION_DAO_ID, pubkey: arbitratorPubkey, role: 'ARBITRATOR', status: 'ACTIVE' },
  })

  const agentProfile = await prisma.agentProfile.create({
    data: { ownerPubkey: sellerPubkey, name: 'smoke-318-agent', capabilities: ['research'], tools: [], isPublic: true },
  })
  const agentOffer = await prisma.offer.create({
    data: {
      title: 'ADR-318 Smoke Agent', priceSats: 3000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'ACTIVE',
      creatorPubkey: sellerPubkey, agentProfileId: agentProfile.id,
      agentConfigSealed: 'fake-nip44-ciphertext', agentConfigMeta: { capabilities: ['research'] },
    },
  })
  const serviceOffer = await prisma.offer.create({
    data: { title: 'ADR-318 Smoke Service', priceSats: 3000, categoryCode: 'services/other', offerType: 'SERVICE', status: 'ACTIVE', creatorPubkey: sellerPubkey },
  })

  const agentTicket = await prisma.ticket.create({
    data: { offerId: agentOffer.id, buyerPubkey, sellerPubkey, status: 'IN_PROGRESS', offerType: 'AGENT_SETUP', amountSats: 3000, daoId: FOUNDATION_DAO_ID },
  })
  const serviceTicket = await prisma.ticket.create({
    data: { offerId: serviceOffer.id, buyerPubkey, sellerPubkey, status: 'IN_PROGRESS', offerType: 'SERVICE', amountSats: 3000, daoId: FOUNDATION_DAO_ID },
  })

  const buyerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${buyerToken}` }
  const arbitratorHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${arbitratorToken}` }
  const openDispute = (ticketId: string, body: Record<string, unknown>) =>
    fetch(`${BASE_URL}/api/tickets/${ticketId}/dispute`, { method: 'POST', headers: buyerHeaders, body: JSON.stringify({ callerPubkey: buyerPubkey, reason: 'not delivered', ...body }) })

  const createdDisputeIds: string[] = []
  try {
    // agentProfile.trustScore starts null — never computed until a review or dispute touches it.
    const freshProfile = await prisma.agentProfile.findUniqueOrThrow({ where: { id: agentProfile.id } })
    check('AgentProfile.trustScore is null before any dispute resolves', freshProfile.trustScore === null, freshProfile.trustScore)

    let r = await openDispute(serviceTicket.id, { agentDisputeType: 'TIMEOUT' })
    let body = await r.json()
    check('agentDisputeType rejected on a non-AGENT_SETUP ticket -> 400', r.status === 400, body)

    r = await openDispute(agentTicket.id, { agentDisputeType: 'NOT_A_REAL_TYPE' })
    body = await r.json()
    check('invalid agentDisputeType value -> 400', r.status === 400, body)

    r = await openDispute(agentTicket.id, { agentDisputeType: 'QUALITY' })
    body = await r.json()
    check('valid agentDisputeType on AGENT_SETUP ticket -> 200/201', r.status === 200 || r.status === 201, body)
    if (body?.dispute?.id) createdDisputeIds.push(body.dispute.id)

    const persistedTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: agentTicket.id } })
    check('Ticket.agentDisputeType persisted as QUALITY', persistedTicket.agentDisputeType === 'QUALITY', persistedTicket.agentDisputeType)
    check('Ticket.status is DISPUTED', persistedTicket.status === 'DISPUTED', persistedTicket.status)

    const dispute = await prisma.dispute.findFirstOrThrow({ where: { ticketId: agentTicket.id, status: { in: ['OPEN', 'COUNCIL_QUEUE'] } } })
    await prisma.dispute.update({ where: { id: dispute.id }, data: { status: 'COUNCIL_QUEUE' } })

    // Single active ARBITRATOR + no DaoConfig row -> evaluateQuorum defaults to
    // SINGLE/requiredCount=1, so this one verdict resolves the dispute immediately.
    r = await fetch(`${BASE_URL}/api/disputes/${dispute.id}/verdict`, {
      method: 'POST',
      headers: arbitratorHeaders,
      body: JSON.stringify({ callerPubkey: arbitratorPubkey, outcome: 'CANCEL', reasoning: 'agent failed to deliver' }),
    })
    body = await r.json()
    check('verdict submission -> 200', r.status === 200, body)
    check('quorum met, dispute resolved', body?.dispute?.status === 'RESOLVED' && body?.dispute?.outcome === 'CANCEL', body?.dispute)

    const resolvedTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: agentTicket.id } })
    check('Ticket.status -> CANCELLED after CANCEL verdict', resolvedTicket.status === 'CANCELLED', resolvedTicket.status)

    // Hand-computed expectation for the recomputed trustScore (ADR-317 D2
    // formula), given this is the agent's only ticket and its only dispute:
    //   verificationScore = 0 (no AgentClaim rows)
    //   completionRate = 1.0 (fallback: 1 ticket total, below the 3-ticket floor)
    //   ownerReputationNormalized = 0.55 (owner has 1 ticket, 1 lost dispute,
    //     no reviews -> rawScore 2.75 @ identityLevel-2 multiplier 1.00 -> /5.0)
    //   stakeWeight = 0 (Phase 2, FU-377)
    //   disputePenalty = 0.1 (floor: 1/1 disputes lost -> penalty formula clamps to 0.1)
    //   trustScore = 0*.35 + 1.0*.25 + 0.55*.15 + 0*.10 + 0.1*.15 = 0.3475 -> 0.35
    const updatedProfile = await prisma.agentProfile.findUniqueOrThrow({ where: { id: agentProfile.id } })
    check('AgentProfile.trustScore recomputed to the hand-computed value 0.35', updatedProfile.trustScore === 0.35, updatedProfile.trustScore)

    // Same Dispute-table-derived signal, exercised for the human reputation
    // path (reputationService.fetchReputationInput) via the seller pubkey —
    // this was reading 0/0 before the ADR-318 fix regardless of dispute history.
    const sellerReputationInput = await fetchReputationInput(sellerPubkey, prisma as any)
    check('fetchReputationInput sees the lost dispute for the seller (1/1)', sellerReputationInput.disputesLost === 1 && sellerReputationInput.disputesParticipated === 1, sellerReputationInput)

    const buyerReputationInput = await fetchReputationInput(buyerPubkey, prisma as any)
    check('fetchReputationInput does NOT count a CANCEL outcome as a buyer loss', buyerReputationInput.disputesLost === 0 && buyerReputationInput.disputesParticipated === 1, buyerReputationInput)
  } finally {
    await prisma.arbitrationVerdict.deleteMany({ where: { disputeId: { in: createdDisputeIds } } })
    await prisma.dispute.deleteMany({ where: { ticketId: { in: [agentTicket.id, serviceTicket.id] } } })
    await prisma.ticket.deleteMany({ where: { id: { in: [agentTicket.id, serviceTicket.id] } } })
    await prisma.offer.deleteMany({ where: { creatorPubkey: sellerPubkey } })
    await prisma.agentProfile.deleteMany({ where: { ownerPubkey: sellerPubkey } })
    await prisma.daoMember.deleteMany({ where: { daoId: FOUNDATION_DAO_ID, pubkey: arbitratorPubkey } })
    await prisma.session.deleteMany({ where: { pubkey: { in: [buyerPubkey, arbitratorPubkey] } } })
    await prisma.user.deleteMany({ where: { pubkey: { in: [buyerPubkey, sellerPubkey, arbitratorPubkey] } } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
