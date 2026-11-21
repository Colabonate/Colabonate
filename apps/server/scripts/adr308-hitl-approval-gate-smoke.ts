// ADR-308 D2 Stage 1 + Stage 2 live smoke test.
// Stage 1: POST /api/tickets creates an AGENT_SETUP ticket ACCEPTED when its
// AgentProfile opted out of human approval (requireHumanApproval=false),
// stays PENDING when approval is required (the default), and unrelated
// offerTypes (SERVICE) are completely unaffected. Closes ADR-305's FU-401
// ticket-lifecycle gap.
// Stage 2 (Quality Gate, added 2026-08-20): a ticket whose AgentProfile has
// humanInLoop=true is born with qualityGateRequired=true; the buyer cannot
// self-complete it via PATCH /api/tickets/:id until the seller has (their
// own COMPLETED transition is the review, stamping qualityApprovedAt).
// Run with:
//   DATABASE_URL=... BASE_URL=http://localhost:4001 npx tsx apps/server/scripts/adr308-hitl-approval-gate-smoke.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomBytes, randomUUID } from 'node:crypto'
import { confirmPaymentByHash } from '../services/paymentConfirmation.js'

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
  const token = randomBytes(32).toString('hex')

  await prisma.user.create({ data: { pubkey: buyerPubkey, identityLevel: 2, walletModeStrategy: 'NONCUSTODIAL_ONLY' } })
  const seller = await prisma.user.create({ data: { pubkey: sellerPubkey, identityLevel: 2 } })
  // Cashu rail: no network call to resolve (unlike lnAddress, which does a
  // real LNURL fetch and would fail against a fake domain in this smoke).
  await prisma.wallet.create({
    data: {
      userId: seller.id, provider: 'CASHU', mode: 'NON_CUSTODIAL', status: 'ACTIVE',
      cashuReceivePubkey: '02' + randomBytes(32).toString('hex'), cashuReceiveMintUrl: 'https://smoke-mint.test.invalid',
    },
  })
  await prisma.session.create({ data: { pubkey: buyerPubkey, k1: randomUUID(), token, expiresAt: new Date(Date.now() + 3600_000) } })
  const sellerToken = randomBytes(32).toString('hex')
  await prisma.session.create({ data: { pubkey: sellerPubkey, k1: randomUUID(), token: sellerToken, expiresAt: new Date(Date.now() + 3600_000) } })

  const gatedProfile = await prisma.agentProfile.create({
    data: { ownerPubkey: sellerPubkey, name: 'smoke-308-gated-agent', capabilities: ['code-review'], tools: [], isPublic: true, requireHumanApproval: true },
  })
  const autoProfile = await prisma.agentProfile.create({
    data: { ownerPubkey: sellerPubkey, name: 'smoke-308-auto-agent', capabilities: ['code-review'], tools: [], isPublic: true, requireHumanApproval: false },
  })

  const makeOffer = (agentProfileId: string, title: string) => prisma.offer.create({
    data: {
      title, priceSats: 2000, categoryCode: 'services/other', offerType: 'AGENT_SETUP', status: 'ACTIVE',
      creatorPubkey: sellerPubkey, agentProfileId,
      agentConfigSealed: 'fake-nip44-ciphertext', agentConfigMeta: { capabilities: ['code-review'] },
    },
  })
  const gatedOffer = await makeOffer(gatedProfile.id, 'ADR-308 Smoke Gated Agent')
  const autoOffer = await makeOffer(autoProfile.id, 'ADR-308 Smoke Auto-Accept Agent')

  // Stage 2: a separate profile with humanInLoop=true, independent of Stage
  // 1's requireHumanApproval — the two gates are orthogonal.
  const qualityProfile = await prisma.agentProfile.create({
    data: {
      ownerPubkey: sellerPubkey, name: 'smoke-308-quality-agent', capabilities: ['code-review'], tools: [],
      isPublic: true, requireHumanApproval: false, humanInLoop: true,
    },
  })
  const qualityOffer = await makeOffer(qualityProfile.id, 'ADR-308 Smoke Quality-Gated Agent')

  const serviceOffer = await prisma.offer.create({
    data: { title: 'ADR-308 Smoke Service', priceSats: 2000, categoryCode: 'services/other', offerType: 'SERVICE', status: 'ACTIVE', creatorPubkey: sellerPubkey },
  })

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const sellerHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${sellerToken}` }
  const createTicket = (offerId: string) => fetch(`${BASE_URL}/api/tickets`, { method: 'POST', headers, body: JSON.stringify({ offerId }) })
  const patchStatus = (ticketId: string, status: string, asHeaders: typeof headers) =>
    fetch(`${BASE_URL}/api/tickets/${ticketId}`, { method: 'PATCH', headers: asHeaders, body: JSON.stringify({ status }) })

  const createdTicketIds: string[] = []
  try {
    let r = await createTicket(gatedOffer.id)
    let body = await r.json()
    check('POST ticket on requireHumanApproval=true agent -> 200/201', r.status === 200 || r.status === 201, body)
    check('ticket stays PENDING when human approval is required (unchanged default behavior)', body?.status === 'PENDING' || body?.ticket?.status === 'PENDING', body)
    if (body?.id || body?.ticket?.id) createdTicketIds.push(body.id ?? body.ticket.id)

    r = await createTicket(autoOffer.id)
    body = await r.json()
    check('POST ticket on requireHumanApproval=false agent -> 200/201', r.status === 200 || r.status === 201, body)
    check('ticket is born ACCEPTED when human approval is opted out (ADR-308 D2 Stage 1)', body?.status === 'ACCEPTED' || body?.ticket?.status === 'ACCEPTED', body)
    if (body?.id || body?.ticket?.id) createdTicketIds.push(body.id ?? body.ticket.id)

    r = await createTicket(serviceOffer.id)
    body = await r.json()
    check('POST ticket on an unrelated SERVICE offer -> 200/201', r.status === 200 || r.status === 201, body)
    check('SERVICE ticket still defaults to PENDING (regression: non-AGENT_SETUP offerTypes untouched)', body?.status === 'PENDING' || body?.ticket?.status === 'PENDING', body)
    if (body?.id || body?.ticket?.id) createdTicketIds.push(body.id ?? body.ticket.id)

    // ADR-308 D2 Stage 2 (Quality Gate)
    r = await createTicket(qualityOffer.id)
    body = await r.json()
    check('POST ticket on humanInLoop=true agent -> 200/201', r.status === 200 || r.status === 201, body)
    const qualityTicketId = body?.id ?? body?.ticket?.id
    if (qualityTicketId) createdTicketIds.push(qualityTicketId)
    let reloadedTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: qualityTicketId } })
    check('ticket snapshots qualityGateRequired=true from AgentProfile.humanInLoop', reloadedTicket.qualityGateRequired === true, reloadedTicket)
    check('qualityApprovedAt starts unset', reloadedTicket.qualityApprovedAt === null, reloadedTicket)

    // Drive it to IN_PROGRESS directly (payment flow is covered elsewhere —
    // this smoke only exercises the quality gate on the COMPLETED edge).
    await prisma.ticket.update({ where: { id: qualityTicketId }, data: { status: 'IN_PROGRESS' } })

    r = await patchStatus(qualityTicketId, 'COMPLETED', headers) // buyer
    body = await r.json()
    check('buyer completing a gated ticket -> 409 QUALITY_REVIEW_PENDING', r.status === 409 && body?.error === 'QUALITY_REVIEW_PENDING', body)
    reloadedTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: qualityTicketId } })
    check('ticket stays IN_PROGRESS after the blocked buyer attempt', reloadedTicket.status === 'IN_PROGRESS', reloadedTicket.status)

    r = await patchStatus(qualityTicketId, 'COMPLETED', sellerHeaders) // seller
    body = await r.json()
    check('seller completing a gated ticket -> 200 COMPLETED (their review IS the approval)', r.status === 200 && (body?.ticket?.status === 'COMPLETED' || body?.status === 'COMPLETED'), body)
    reloadedTicket = await prisma.ticket.findUniqueOrThrow({ where: { id: qualityTicketId } })
    check('qualityApprovedAt stamped on seller completion', reloadedTicket.qualityApprovedAt !== null, reloadedTicket.qualityApprovedAt)

    r = await patchStatus(qualityTicketId, 'IN_PROGRESS', sellerHeaders)
    check('post-completion transition still allowed (gate is one-shot, not a lock)', r.status === 200, await r.json())

    // Regression: an auto-accept ticket (qualityGateRequired=false) lets the
    // buyer complete it directly — the two Stage-1/Stage-2 gates are orthogonal.
    r = await createTicket(autoOffer.id)
    body = await r.json()
    const ungatedTicketId = body?.id ?? body?.ticket?.id
    if (ungatedTicketId) createdTicketIds.push(ungatedTicketId)
    await prisma.ticket.update({ where: { id: ungatedTicketId }, data: { status: 'IN_PROGRESS' } })
    r = await patchStatus(ungatedTicketId, 'COMPLETED', headers) // buyer
    check('buyer completing an ungated (qualityGateRequired=false) ticket -> 200 (unaffected)', r.status === 200, await r.json())

    // Regression coverage for the confirmPaymentByHash ACCEPTED-status gap
    // found in code review (2026-08-19): an auto-accepted ticket is born
    // ACCEPTED, not PENDING — confirmPaymentByHash previously only advanced
    // 'PENDING'/'IN_PROGRESS' tickets, so a settled payment on an
    // auto-accepted ticket silently never reached PAID.
    const acceptedPaymentHash = randomBytes(32).toString('hex')
    const acceptedTicket = await prisma.ticket.create({
      data: {
        offerId: autoOffer.id, buyerPubkey, sellerPubkey, status: 'ACCEPTED',
        amountSats: 2000, paymentHash: acceptedPaymentHash, offerType: 'AGENT_SETUP',
      },
    })
    createdTicketIds.push(acceptedTicket.id)
    const confirmResult = await confirmPaymentByHash(prisma, acceptedPaymentHash)
    check('confirmPaymentByHash advances an ACCEPTED ticket', confirmResult.includes(`ticket:${acceptedTicket.id}:PAID`), confirmResult)
    const reloaded = await prisma.ticket.findUniqueOrThrow({ where: { id: acceptedTicket.id } })
    check('ACCEPTED ticket reaches PAID after payment confirmation', reloaded.status === 'PAID', reloaded.status)
  } finally {
    await prisma.ticket.deleteMany({ where: { id: { in: createdTicketIds } } })
    await prisma.offer.deleteMany({ where: { creatorPubkey: sellerPubkey } })
    await prisma.agentProfile.deleteMany({ where: { ownerPubkey: sellerPubkey } })
    await prisma.wallet.deleteMany({ where: { userId: seller.id } })
    await prisma.session.deleteMany({ where: { pubkey: { in: [buyerPubkey, sellerPubkey] } } })
    await prisma.user.deleteMany({ where: { pubkey: { in: [buyerPubkey, sellerPubkey] } } })
    await prisma.$disconnect()
  }

  console.log(`\n${pass}/${pass + fail} passed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
